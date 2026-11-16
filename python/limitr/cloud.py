#
# Copyright 2026 Formata, Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

"""
The Limitr Cloud connection: one WebSocket to Cloud per policy, the same protocol as the TypeScript SDK.

Cloud sends the policy (and updates to it), customers when asked for them, and answers; the engine sends usage and
customer changes through Cloud's handlers (`CloudWS::send`), numbered so a customer Cloud sends back never sets a
meter back. Every decision still runs in-process: the connection only keeps this engine and Cloud in step.

A reader thread receives messages and reconnects when the connection drops (saying which customers it holds and
catching up on the policy); a keeper thread pings every 20 seconds and sends what was queued while disconnected.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import ClientConnection, connect

if TYPE_CHECKING:
    from .engine import Limitr

log = logging.getLogger('limitr')

# What this SDK can take from Limitr Cloud, sent in hello. 'policy-source': Cloud sends the policy only, and this SDK
# keeps the engine it ships with. 'meter-seq': meter messages are numbered and confirmed (see _number_meter_message).
CLOUD_ACCEPTS = ['policy-source', 'meter-seq']

PING_S = 20.0                       # how often the keeper pings (and reconnects a dropped connection)
METER_PENDING_S = 5 * 60.0          # how long an unconfirmed meter change is added back onto a customer from Cloud
MAX_CLOUD_REFS = 64                 # the most customers a customer's refs load from Cloud with it
MAX_PENDING_PER_CUSTOMER = 5000
RECONNECT_MAX_S = 20.0
CLOUD_HELLO_S = 3.0                 # how long limitr.network() waits for Cloud's reply to hello
CLOUD_OPERATOR_S = 30.0             # how long an operator request over the connection waits for its answer


def _random_id() -> str:
    return uuid.uuid4().hex


class CloudError(Exception):
    pass


class CloudConnection:
    """The connection to Limitr Cloud for one Limitr policy (see Limitr.cloud)."""

    def __init__(self, limitr: 'Limitr', token: str, policy: str, ws_address: str, ticket_address: str,
                 connect_timeout: float, http_hosts: Any, batch_ms: float, sdk: str):
        self.limitr = limitr
        self.token = token
        self.policy = policy
        self.ws_address = ws_address.rstrip('/')
        self.ticket_address = ticket_address.rstrip('/')
        self.connect_timeout = connect_timeout / 1000
        self.http_hosts = http_hosts
        self.batch_s = max(0.0, batch_ms) / 1000
        self.sdk = sdk
        self.instance = _random_id()

        self.features: Set[str] = set()
        self.hello = threading.Event()       # Cloud replied to hello (with its features and Network operator)
        self._network_operator: Optional[Dict[str, Any]] = None
        self._operator_requests: Dict[str, Callable[[Dict[str, Any]], None]] = {}
        self.init = threading.Event()        # the first policy arrived and the document is set up
        self.open = threading.Event()        # a connection is open
        self._closing = False

        self._ws: Optional[ClientConnection] = None
        self._send_lock = threading.Lock()   # one send at a time, and the queue with it
        self._queue: List[str] = []          # sent once connected
        self._batch: List[str] = []
        self._batch_timer: Optional[threading.Timer] = None
        self._debounced: Dict[str, threading.Timer] = {}
        self._debounced_data: Dict[str, str] = {}
        self._state_lock = threading.Lock()  # batch, debounce, and meter numbering state

        self._meter_seq = 0
        self._meter_pending: Dict[str, List[Dict[str, Any]]] = {}
        self._denied: Set[str] = set()
        self._no_refs: Set[str] = set()
        self._topups: Dict[str, Callable[[bool], None]] = {}
        self._notifications: List[str] = []

        self._reader: Optional[threading.Thread] = None
        # messages are handled on a worker thread, in order, so the reader always receives: an operator's answer
        # gets through while an engine call (holding the engine's lock) waits on it
        self._inbox: 'queue.Queue[Any]' = queue.Queue()
        self._worker: Optional[threading.Thread] = None
        self._keeper: Optional[threading.Thread] = None
        self._wake = threading.Event()

    # --------------------------------------------------------------------------------------------------------------
    # Connecting
    # --------------------------------------------------------------------------------------------------------------

    def _ticket(self) -> Optional[str]:
        """A connection ticket for the API token (POST /wss/ticket), or None when Cloud refuses it."""
        request = urllib.request.Request(
            self.ticket_address + '/wss/ticket', data=json.dumps({'token': self.token}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=self.connect_timeout or 5) as response:
                return json.loads(response.read().decode()).get('ticket')
        except urllib.error.HTTPError as error:
            # Cloud answered and refused (Ex. a revoked token, or a plan without connected engines): say why
            try:
                reason = json.loads(error.read().decode()).get('error') or error.reason
            except (ValueError, OSError, AttributeError):
                reason = error.reason
            log.warning('Limitr Cloud refused the connection (%s): %s', error.code, reason)
            return None
        except (urllib.error.URLError, ValueError, OSError) as error:
            log.debug('Limitr Cloud ticket failed: %s', error)
            return None

    def _connect(self) -> bool:
        """Open a connection and say hello: who this is, the customers it holds, and the policy it follows."""
        ticket = self._ticket()
        if not ticket:
            return False
        try:
            # entered like a context manager (closed in close()): newer websockets releases expect it
            ws = connect(f'{self.ws_address}/wss?ticket={ticket}', open_timeout=self.connect_timeout or 5,
                         max_size=None).__enter__()
        except Exception as error:   # refused, timed out, or not a WebSocket
            log.debug('Limitr Cloud connection failed: %s', error)
            return False
        hello: Dict[str, Any] = {'type': 'hello', 'sdk': self.sdk, 'policy': self.policy, 'accepts': CLOUD_ACCEPTS,
                                 'instance': self.instance}
        if self.init.is_set():
            # a new connection starts with no subscriptions on Cloud's side: the customers this engine holds
            hello['customers'] = list(self.limitr.customers().keys())
        with self._send_lock:
            self._ws = ws
            ws.send(json.dumps(hello))
            ws.send(json.dumps({'type': 'policy', 'id': self.policy, 'format': 'bstf'}))
            self.open.set()
            self._flush_queue()
        return True

    def start(self) -> bool:
        """Connect, then wait for the policy. False when Cloud refuses the token or doesn't answer in time."""
        if not self._connect():
            return False
        self._worker = threading.Thread(target=self._work_loop, name='limitr-cloud-worker', daemon=True)
        self._worker.start()
        self._reader = threading.Thread(target=self._read_loop, name='limitr-cloud-reader', daemon=True)
        self._reader.start()
        if not self.init.wait(self.connect_timeout or None):
            self.close()
            raise CloudError('waiting for the Limitr Cloud policy timed out')
        self._keeper = threading.Thread(target=self._keep_loop, name='limitr-cloud-keeper', daemon=True)
        self._keeper.start()
        return True

    def _read_loop(self) -> None:
        """Receive messages until closed, reconnecting when the connection drops."""
        backoff = 1.0
        while not self._closing:
            ws = self._ws
            if ws is not None:
                try:
                    for message in ws:
                        backoff = 1.0
                        if not self._received_now(message):
                            self._inbox.put(message)
                except ConnectionClosed:
                    pass
                except Exception:   # a message that breaks handling must never end the connection
                    log.exception('Limitr Cloud: handling a message failed')
                    continue
            with self._send_lock:
                self._ws = None
                self.open.clear()
            if self._closing:
                break
            if not self._connect():
                self._wake.wait(backoff)
                self._wake.clear()
                backoff = min(backoff * 2, RECONNECT_MAX_S)

    def _work_loop(self) -> None:
        """Handle received messages in order, until closed."""
        while True:
            message = self._inbox.get()
            if message is None:
                break
            try:
                self._received(message)
            except Exception:   # a message that breaks handling must never stop the others
                log.exception('Limitr Cloud: handling a message failed')

    def _keep_loop(self) -> None:
        """Ping every 20 seconds, sending what's queued."""
        while not self._closing:
            self._wake.wait(PING_S)
            self._wake.clear()
            if self._closing:
                break
            with self._send_lock:
                if self._ws is not None:
                    try:
                        self._flush_queue()
                        self._ws.send('ping')
                    except ConnectionClosed:
                        pass

    def wait_open(self) -> bool:
        """Wait for an open connection, up to the connect timeout."""
        return self.open.wait(self.connect_timeout or None)

    def close(self) -> None:
        """Send what's batched and debounced, then close."""
        with self._state_lock:
            if self._batch_timer:
                self._batch_timer.cancel()
                self._batch_timer = None
            for timer in self._debounced.values():
                timer.cancel()
            unsent = list(self._debounced_data.values())
            self._debounced.clear()
            self._debounced_data.clear()
        self.flush_batch()
        for data in unsent:
            self.send_now(data)
        self._closing = True
        self._wake.set()
        self._inbox.put(None)
        self.init.clear()
        with self._send_lock:
            ws, self._ws = self._ws, None
            self.open.clear()
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    # --------------------------------------------------------------------------------------------------------------
    # Sending
    # --------------------------------------------------------------------------------------------------------------

    def _flush_queue(self) -> None:
        """Send what was queued while disconnected (with _send_lock held)."""
        if self._ws is None:
            return
        while self._queue:
            self._ws.send(self._queue[0])
            self._queue.pop(0)

    def send_now(self, data: str) -> None:
        """Send now, or queue it until connected."""
        with self._send_lock:
            if self._ws is not None:
                try:
                    self._flush_queue()
                    self._ws.send(data)
                    return
                except ConnectionClosed:
                    pass
            self._queue.append(data)

    def send(self, data: str) -> None:
        """
        Send a message from the engine (Cloud's handlers call this). With Cloud's 'batch', messages are collected for
        batch_ms and sent as one `{"type": "batch", "messages": [...]}`, in order.
        """
        if 'meter-seq' in self.features:
            data = self._number_meter_message(data)
        if self.batch_s > 0 and 'batch' in self.features:
            with self._state_lock:
                self._batch.append(data)
                if self._batch_timer is None:
                    self._batch_timer = threading.Timer(self.batch_s, self._batch_due)
                    self._batch_timer.daemon = True
                    self._batch_timer.start()
            return
        self.send_now(data)

    def _batch_due(self) -> None:
        with self._state_lock:
            self._batch_timer = None
        self.flush_batch()

    def flush_batch(self) -> None:
        """Send the collected batch now."""
        with self._state_lock:
            messages, self._batch = self._batch, []
        if not messages:
            return
        self.send_now(messages[0] if len(messages) == 1 else '{"type":"batch","messages":[' + ','.join(messages) + ']}')

    def send_debounced(self, id: str, data: str, debounce_ms: float = 500) -> None:
        """Send after debounce_ms, keeping only the latest message for an id."""
        def due() -> None:
            with self._state_lock:
                self._debounced.pop(id, None)
                latest = self._debounced_data.pop(id, None)
            if latest is not None:
                self.send(latest)
        with self._state_lock:
            if id in self._debounced:
                self._debounced[id].cancel()
            timer = threading.Timer(max(0.0, float(debounce_ms)) / 1000, due)
            timer.daemon = True
            self._debounced[id] = timer
            self._debounced_data[id] = data
            timer.start()

    def _number_meter_message(self, data: str) -> str:
        """
        Number a message that changes a meter (a set-customer with usage, or a meter-overage) and keep its change until
        Cloud confirms it: a customer Cloud sends carries `cloud_seq`, the last of this instance's messages already in
        its meters, and the rest are added back onto it (rebase), so a copy Cloud read before these arrived can't set
        this engine's meters back.
        """
        if not (data.startswith('{"type":"set-customer"') or data.startswith('{"type":"meter-overage"')):
            return data
        try:
            m = json.loads(data)
        except ValueError:
            return data
        customer = m.get('customer') if isinstance(m.get('customer'), dict) else {}
        id = customer.get('id')
        usage = m.get('usage') if m.get('type') == 'set-customer' else m
        entitlement = usage.get('resource') if isinstance(usage, dict) else None
        if not isinstance(id, str) or not isinstance(entitlement, str):
            return data
        try:
            diff = float(usage.get('diff') if m.get('type') == 'set-customer' else (m.get('diff') if m.get('diff') is not None else m.get('overage')) or 0)
        except (TypeError, ValueError):
            diff = 0.0
        try:
            overhead = max(0.0, float(usage.get('overhead_diff') or 0))
        except (TypeError, ValueError):
            overhead = 0.0
        if diff == 0 and overhead == 0:
            return data
        with self._state_lock:
            self._meter_seq += 1
            seq = self._meter_seq
            pending: Dict[str, Any] = {'seq': seq, 'entitlement': entitlement, 'diff': diff, 'overhead': overhead,
                                       'at': time.time()}
            started = ((customer.get('meters') or {}).get(entitlement) or {}).get('started')
            if isinstance(started, (int, float)):
                pending['started'] = started
            items = self._meter_pending.setdefault(id, [])
            items.append(pending)
            if len(items) > MAX_PENDING_PER_CUSTOMER:
                del items[:len(items) - MAX_PENDING_PER_CUSTOMER]
        return '{"seq":' + str(seq) + ',' + data[1:]

    def _rebase(self, record: Dict[str, Any]) -> Optional[str]:
        """
        A customer from Cloud, with this instance's meter changes it doesn't have yet added back. Changes from an older
        period than Cloud's meter are over; one from a newer period (a reset here Cloud hasn't seen) starts the meter
        over first. A server without 'meter-seq' sends no cloud_seq: as is (None).
        """
        acked = record.get('cloud_seq')
        if not isinstance(acked, (int, float)) or isinstance(acked, bool):
            return None
        del record['cloud_seq']
        now = time.time()
        with self._state_lock:
            cid = str(record.get('id'))
            pending = [p for p in self._meter_pending.get(cid, [])
                       if p['seq'] > acked and now - p['at'] < METER_PENDING_S]
            if pending:
                self._meter_pending[cid] = pending
            else:
                self._meter_pending.pop(cid, None)
        meters = record.get('meters')
        if pending and isinstance(meters, dict):
            for p in pending:
                meter = meters.get(p['entitlement'])
                if not isinstance(meter, dict):
                    meter = meters[p['entitlement']] = {'started': p.get('started', now * 1000), 'value': 0, 'overhead': 0}
                started = meter.get('started') if isinstance(meter.get('started'), (int, float)) else None
                if 'started' in p and started is not None and p['started'] < started:
                    continue   # an older period's
                if 'started' in p and started is not None and p['started'] > started:
                    meter['started'] = p['started']
                    meter['value'] = 0
                    meter['overhead'] = 0
                meter['value'] = float(meter.get('value') or 0) + p['diff']
                meter['overhead'] = float(meter.get('overhead') or 0) + p['overhead']
        return json.dumps(record)

    # --------------------------------------------------------------------------------------------------------------
    # Customers and topups
    # --------------------------------------------------------------------------------------------------------------

    def add_customer(self, id: str, timeout_ms: float = 3000) -> bool:
        """
        Load a customer from Cloud (and the customers its refs lead to). True when it's here and ready. Doesn't
        create a customer (see ensure_customer).
        """
        limitr = self.limitr
        if limitr._has_customer(id):
            return True
        if not self.open.is_set():
            return False
        with self._state_lock:
            self._denied.discard(id)
        self.send_now(json.dumps({'type': 'customer', 'id': id}))
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            if limitr._has_customer(id):
                limitr.ensure_customer_included_topups(id, False)
                if id not in self._no_refs:
                    self.add_refs(id)
                return True
            with self._state_lock:
                if id in self._denied:
                    self._denied.discard(id)
                    return False
            time.sleep(0.02)
        return False

    def add_refs(self, id: str, seen: Optional[Set[str]] = None) -> None:
        """Load the customers a customer's refs lead to, at any depth (Ex. a user's team and org)."""
        seen = seen if seen is not None else {id}
        for ref in self.limitr.customer_refs(id) or []:
            if not isinstance(ref, str) or not ref or ref in seen or len(seen) >= MAX_CLOUD_REFS:
                continue
            seen.add(ref)
            if not self.limitr._has_customer(ref):
                self._no_refs.add(ref)
                try:
                    if not self.add_customer(ref):
                        continue
                finally:
                    self._no_refs.discard(ref)
            self.add_refs(ref, seen)

    def purchase_topup(self, id: str, topup: str, timeout_ms: float = 30000) -> bool:
        """Cloud charges for the topup, then grants it (the grant arrives with the customer's update)."""
        request = _random_id()
        done = threading.Event()
        result = {'ok': False}

        def answer(ok: bool) -> None:
            result['ok'] = ok
            done.set()
        self._topups[request] = answer
        try:
            self.send_now(json.dumps({'type': 'purchase-topup', 'request': request, 'id': id, 'topup': topup}))
            done.wait(timeout_ms / 1000)
        finally:
            self._topups.pop(request, None)
        return result['ok']

    # --------------------------------------------------------------------------------------------------------------
    # Receiving
    # --------------------------------------------------------------------------------------------------------------

    def _received_now(self, data: Any) -> bool:
        """
        The messages handled on the reader itself (they never wait on the engine): Cloud's reply to hello, and an
        operator's answer. True when handled.
        """
        if not isinstance(data, str) or not data.startswith('{') or ('"hello"' not in data and '"network-operator"' not in data):
            return False
        try:
            record = json.loads(data)
        except ValueError:
            return False
        if not isinstance(record, dict):
            return False
        kind = record.get('type')
        if kind == 'hello':
            # the server's reply: what it supports, and its Limitr Network operator for this workspace
            features = record.get('features')
            self.features = set(f for f in features if isinstance(f, str)) if isinstance(features, list) else set()
            op = record.get('network')
            if isinstance(op, dict) and isinstance(op.get('url'), str) and isinstance(op.get('key'), str) \
                    and isinstance(op.get('roles'), list):
                self._network_operator = {
                    'url': op['url'], 'key': op['key'],
                    'label': op['label'] if isinstance(op.get('label'), str) else 'Limitr Cloud',
                    'roles': [r for r in op['roles'] if isinstance(r, str)],
                }
            else:
                self._network_operator = None
            self.hello.set()
            return True
        if kind == 'network-operator':
            # an operator's answer, over this connection (see operator_channel)
            rid = record.get('id')
            answer = self._operator_requests.get(rid) if isinstance(rid, str) else None
            if answer:
                answer(record)
            return True
        return False

    # --------------------------------------------------------------------------------------------------------------
    # Limitr Network over this connection
    # --------------------------------------------------------------------------------------------------------------

    def network_operator(self) -> Optional[Dict[str, Any]]:
        """Limitr Cloud's operator for this workspace, once Cloud has replied to hello (None without one)."""
        self.hello.wait(CLOUD_HELLO_S)
        return self._network_operator

    def operator_channel(self, base: str) -> Callable[[Any], Any]:
        """
        An operator channel over this connection: { type: 'network-operator', id, method, path, body }, answered by
        Cloud with { type: 'network-operator', id, status, headers, body }. The path is the request's, under the
        operator's URL. Messages are signed envelopes, checked by the policy with the operator's key either way.
        """
        from urllib.parse import urlsplit

        from .network import Response
        prefix = urlsplit(base).path.rstrip('/')

        def channel(request: Any) -> Any:
            url = urlsplit(request.url)
            path = url.path or '/'
            if prefix and (path == prefix or path.startswith(prefix + '/')):
                path = path[len(prefix):] or '/'
            if url.query:
                path += '?' + url.query
            body = '' if request.method.upper() in ('GET', 'HEAD') else request.body
            if not self.open.is_set():
                return Response(503, {}, json.dumps({'error': 'not connected to Limitr Cloud'}))
            id = _random_id()
            done = threading.Event()
            reply: Dict[str, Any] = {}

            def answer(record: Dict[str, Any]) -> None:
                reply.update(record)
                done.set()
            self._operator_requests[id] = answer
            try:
                self.send_now(json.dumps({'type': 'network-operator', 'id': id, 'method': request.method.upper(),
                                          'path': path, 'body': body}))
                if not done.wait(CLOUD_OPERATOR_S):
                    return Response(504, {}, json.dumps({'error': "Limitr Cloud didn't answer"}))
            finally:
                self._operator_requests.pop(id, None)
            status = reply.get('status')
            status = status if isinstance(status, int) and 200 <= status <= 599 else 502
            headers = reply.get('headers')
            headers = headers if isinstance(headers, dict) else {}
            return Response(status, {str(k): v for k, v in headers.items() if isinstance(v, str)},
                            reply['body'] if isinstance(reply.get('body'), str) else '')
        return channel

    def _received(self, data: Any) -> None:
        if isinstance(data, (bytes, bytearray)):
            self.limitr._cloud_bstf(bytes(data))
            return
        if data in ('ping', 'pong'):
            return
        try:
            record = json.loads(data)
        except ValueError:
            return
        if not isinstance(record, dict):
            return
        kind = record.get('type')
        limitr = self.limitr
        if kind == 'topup-purchase':
            # Cloud's answer to purchase-topup (the customer update with the grant came first)
            request = record.get('request')
            answer = self._topups.get(request) if isinstance(request, str) else None
            if answer:
                answer(bool(record.get('ok')))
            if not record.get('ok'):
                limitr._emit('topup-purchase-failed', record)
        elif kind == 'topup-purchase-failed':
            limitr._emit('topup-purchase-failed', record)
        elif kind == 'policy-source':
            limitr._cloud_policy_source(record)
        elif kind in ('hello', 'network-operator'):
            self._received_now(data)
        elif kind == 'sdk-unsupported':
            log.error(record.get('message') or f'Limitr Cloud needs a newer SDK (this is {self.sdk})')
            limitr._emit('sdk-unsupported', record)
        elif record.get('error') and record.get('id'):
            if kind == 'customer':
                with self._state_lock:
                    self._denied.add(record['id'])
        elif isinstance(record.get('policy'), dict) and record['policy'].get('plans'):
            limitr._cloud_policy_json(data)
        elif kind == 'customer-invoices' and isinstance(record.get('data'), dict) and record['data'].get('invoices') \
                and record.get('id'):
            limitr._cloud_invoices(data)
        elif kind and record.get('id'):
            # a customer from Cloud: rebased in the engine's lock, so no call can meter (and number) a change between
            limitr._cloud_customer(record, data, self._rebase)
            limitr.ensure_customer_included_topups(record['id'], False)
            refs = record.get('refs')
            if isinstance(refs, list) and refs and self.open.is_set():
                # refs that changed in Cloud (Ex. a user moved to another org): load the new ones, off this thread
                threading.Thread(target=self.add_refs, args=(record['id'],), daemon=True).start()
