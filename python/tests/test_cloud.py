"""
Tests for Limitr Cloud in the Python SDK, against a fake Cloud: a ticket endpoint and a WebSocket server speaking the
same protocol (hello, policy-source, customers, numbered meter messages, batches, topups). Run: python -m pytest
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from limitr import Limitr

POLICY = """
policy: {
    credits: { req: { label: 'Request' } }
    plans: {
        free: {
            default: true
            entitlements: { api: { limit: { credit: 'req', mode: 'hard', value: 10 } } }
            topups: { more: { credit: 'req', value: 100 } }
        }
    }
}
"""

# Cloud's billing handlers come with the policy (limitr_cloud): here, every meter change goes to Cloud
HANDLERS = """
#[meter-changed]
fn cloud_meter(value: obj) {
    CloudWS::send(`{"type":"set-customer","customer":${stringify('json', value.customer)},"usage":{"resource":"${value.entitlement}","diff":${value.meter.diff}}}`);
}
"""


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


class FakeCloud:
    """A Limitr Cloud stand-in: a ticket endpoint, a WebSocket server, and the customers it keeps."""

    def __init__(self, features=('meter-seq', 'batch', 'topup-purchase')):
        self.features = list(features)
        self.policy_source = POLICY
        self.customers = {}          # Cloud's copies, by ID
        self.acked = {}              # last meter seq recorded, by instance
        self.received = []           # every message, batches unpacked
        self.hellos = []
        self.connections = []
        self.topup_ok = True
        self.refuse = False          # refuse tickets (Ex. while testing a disconnect)
        cloud = self

        class Tickets(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                ok = body.get('token') == 'good' and not cloud.refuse
                self.send_response(200 if ok else 401)
                self.end_headers()
                self.wfile.write(json.dumps({'ticket': 't1'} if ok else {'error': 'bad token'}).encode())

            def log_message(self, *args):
                pass

        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Tickets)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.ws = serve(self._session, '127.0.0.1', 0)
        threading.Thread(target=self.ws.serve_forever, daemon=True).start()
        self.ticket_address = f'http://127.0.0.1:{self.http.server_address[1]}'
        self.ws_address = f'ws://127.0.0.1:{self.ws.socket.getsockname()[1]}'

    def connect(self, **options):
        return Limitr.cloud('good', ws_address=self.ws_address, ticket_address=self.ticket_address, **options)

    def stop(self):
        self.ws.shutdown()
        self.http.shutdown()

    def drop_connections(self):
        for ws in list(self.connections):
            ws.close()

    def push(self, record):
        for ws in list(self.connections):
            try:
                ws.send(json.dumps(record))
            except ConnectionClosed:
                pass

    def _session(self, ws):
        self.connections.append(ws)
        instance = None
        try:
            for raw in ws:
                if raw == 'ping':
                    ws.send('pong')
                    continue
                message = json.loads(raw)
                for m in message['messages'] if message.get('type') == 'batch' else [message]:
                    self.received.append(m)
                    instance = self._handle(ws, m, instance)
        except ConnectionClosed:
            pass
        finally:
            self.connections.remove(ws)

    def _handle(self, ws, m, instance):
        kind = m.get('type')
        if kind == 'hello':
            self.hellos.append(m)
            ws.send(json.dumps({'type': 'hello', 'features': self.features}))
            return m.get('instance')
        if kind == 'policy':
            ws.send(json.dumps({'type': 'policy-source', 'source': self.policy_source, 'handlers': HANDLERS}))
        elif kind == 'customer':
            record = self.customers.get(m['id'])
            if record is None:
                ws.send(json.dumps({'type': 'customer', 'id': m['id'], 'error': 'not found'}))
            else:
                ws.send(json.dumps({**record, 'cloud_seq': self.acked.get(instance, 0)}))
        elif kind == 'set-customer':
            self.customers[m['customer']['id']] = m['customer']
            if 'seq' in m:
                self.acked[instance] = max(self.acked.get(instance, 0), m['seq'])
        elif kind == 'purchase-topup':
            if self.topup_ok:
                record = dict(self.customers.get(m['id'], {'id': m['id'], 'plan': 'free'}))
                record['grants'] = {'more': {'credit': 'req', 'value': 100, 'remaining': 100}}
                ws.send(json.dumps(record))
            ws.send(json.dumps({'type': 'topup-purchase', 'request': m['request'], 'ok': self.topup_ok}))
        return instance


@pytest.fixture
def cloud():
    c = FakeCloud()
    yield c
    c.stop()


def ada(used=0):
    return {'id': 'ada', 'plan': 'free', 'type': 'user', 'label': 'Ada',
            'meters': {'api': {'value': used, 'started': int(time.time() * 1000)}}}


# -- connecting ----------------------------------------------------------------------------------------------------

def test_a_refused_token_is_none(cloud):
    assert Limitr.cloud('bad', ws_address=cloud.ws_address, ticket_address=cloud.ticket_address) is None
    assert Limitr.cloud('') is None


def test_the_policy_comes_from_cloud(cloud):
    policy = cloud.connect()
    try:
        assert policy.connected
        assert policy.plan('free') is not None
        hello = cloud.hellos[0]
        assert hello['sdk'] == '0.8.8' and hello['policy'] == 'active'
        assert hello['accepts'] == ['policy-source', 'meter-seq'] and len(hello['instance']) == 32
    finally:
        policy.close()


# -- customers -----------------------------------------------------------------------------------------------------

def test_a_customer_loads_on_its_first_call(cloud):
    cloud.customers['ada'] = ada(used=7)
    policy = cloud.connect()
    try:
        assert policy.customer('ada') is None             # not here until a call needs it
        assert policy.remaining('ada', 'api') == 3        # loaded from Cloud, with Cloud's meter
        assert policy.allow('ada', 'api', 3)
        assert not policy.allow('ada', 'api', 1)
    finally:
        policy.close()


def test_a_customer_cloud_doesnt_have_is_refused(cloud):
    policy = cloud.connect()
    try:
        assert not policy.allow('nobody', 'api', 1)
        d = policy.allow('nobody', 'api', 1, detail=True)
        assert d['allowed'] is False and d['reason'] == 'no_customer'
    finally:
        policy.close()


def test_ensure_customer_uses_cloud_first(cloud):
    cloud.customers['ada'] = ada(used=4)
    policy = cloud.connect()
    try:
        assert policy.ensure_customer('ada') is False     # Cloud has it: loaded, not created
        assert policy.value('ada', 'api') == 4
        assert policy.ensure_customer('bo') is True       # new: created here, and Cloud hears of its usage
        assert policy.allow('bo', 'api', 2)
        policy.flush_cloud_batch()
        assert wait_for(lambda: cloud.customers.get('bo', {}).get('meters', {}).get('api', {}).get('value') == 2)
    finally:
        policy.close()


# -- usage ---------------------------------------------------------------------------------------------------------

def test_usage_is_numbered_and_batched(cloud):
    cloud.customers['ada'] = ada()
    policy = cloud.connect(batch_ms=10_000)
    try:
        for _ in range(3):
            assert policy.allow('ada', 'api', 1)
        assert not [m for m in cloud.received if m.get('type') == 'set-customer']   # still batched
        policy.flush_cloud_batch()
        assert wait_for(lambda: len([m for m in cloud.received if m.get('type') == 'set-customer']) == 3)
        assert [m['seq'] for m in cloud.received if m.get('type') == 'set-customer'] == [1, 2, 3]
        assert cloud.customers['ada']['meters']['api']['value'] == 3
    finally:
        policy.close()


def test_close_sends_whats_batched(cloud):
    cloud.customers['ada'] = ada()
    policy = cloud.connect(batch_ms=10_000)
    assert policy.allow('ada', 'api', 2)
    policy.close()
    assert wait_for(lambda: cloud.customers['ada']['meters']['api']['value'] == 2)


def test_a_copy_from_cloud_never_sets_a_meter_back(cloud):
    """Cloud sends a copy read before this engine's usage arrived: the usage it hasn't confirmed is added back."""
    cloud.customers['ada'] = ada()
    policy = cloud.connect(batch_ms=10_000)
    try:
        assert policy.allow('ada', 'api', 4)              # numbered, not yet sent (batched)
        stale = {**ada(used=0), 'cloud_seq': 0}           # Cloud's copy, from before the usage
        stale['meters']['api']['started'] = policy.meter_object('ada', 'api')['started']
        cloud.push(stale)
        time.sleep(0.3)
        assert policy.value('ada', 'api') == 4
    finally:
        policy.close()


# -- policy and connection -----------------------------------------------------------------------------------------

def test_a_published_policy_applies_right_away(cloud):
    cloud.customers['ada'] = ada()
    policy = cloud.connect()
    try:
        assert not policy.allow('ada', 'api', 20)
        cloud.push({'type': 'policy-source', 'source': POLICY.replace('value: 10', 'value: 50'), 'handlers': HANDLERS})
        assert wait_for(lambda: policy.check('ada', 'api', 20))
    finally:
        policy.close()


def test_disconnected_calls_are_refused_then_it_reconnects(cloud):
    cloud.customers['ada'] = ada()
    policy = cloud.connect()
    try:
        assert policy.allow('ada', 'api', 1)
        cloud.refuse = True
        cloud.drop_connections()
        assert wait_for(lambda: not policy.connected, 2)
        d = policy.allow('ada', 'api', 1, detail=True)
        assert d['allowed'] is False and d['reason'] == 'unconnected'
        cloud.refuse = False
        assert wait_for(lambda: policy.connected, 5)      # it reconnects on its own
        assert cloud.hellos[-1]['customers'] == ['ada']   # saying which customers it holds
        assert policy.allow('ada', 'api', 1)
    finally:
        policy.close()


def test_without_deny_unconnected_calls_run_locally(cloud):
    cloud.customers['ada'] = ada()
    policy = cloud.connect(deny_unconnected=False)
    try:
        assert policy.allow('ada', 'api', 1)
        cloud.refuse = True
        cloud.drop_connections()
        assert wait_for(lambda: not policy.connected, 2)
        assert policy.allow('ada', 'api', 1)
    finally:
        policy.close()


def test_topups_are_charged_by_cloud(cloud):
    cloud.customers['ada'] = ada(used=10)
    policy = cloud.connect()
    try:
        assert not policy.allow('ada', 'api', 1)
        assert policy.apply_customer_topup('ada', 'more')  # Cloud charged it, and the grant came with the customer
        assert policy.allow('ada', 'api', 1)
        failed = []
        policy.add_handler('t', lambda name, value: failed.append(name) if name == 'topup-purchase-failed' else None)
        cloud.topup_ok = False
        assert not policy.apply_customer_topup('ada', 'more')
        assert failed == ['topup-purchase-failed']
    finally:
        policy.close()


def test_a_closed_policy_is_freed(cloud):
    import gc
    import weakref
    policy = cloud.connect()
    policy.close()
    ref = weakref.ref(policy)
    del policy
    gc.collect()
    time.sleep(0.2)
    gc.collect()
    assert ref() is None
