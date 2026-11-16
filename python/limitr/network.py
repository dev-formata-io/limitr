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
Limitr Network for Python. The protocol lives in the policy (the LimitrNetwork module, src/network): this file only
holds the policy's key, lets its Http::fetch reach the providers it connects to, and turns HTTP requests and responses
into the module's NetworkRequest and NetworkResponse maps. The same API as the TypeScript SDK's, in snake_case, with
Request and Response classes in place of the web-standard ones, and a WSGI app and a small server for serving them.
"""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from http import HTTPStatus
from socketserver import ThreadingMixIn
from typing import TYPE_CHECKING, Any, Callable, Dict, Iterable, Iterator, List, Literal, Optional, TypedDict, Union
from urllib.parse import parse_qsl, urlsplit
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

from pystof import Doc

if TYPE_CHECKING:
    from .engine import Limitr


Trust = Literal['declarations', 'logic']
"""How far a consumer trusts a provider: 'declarations' (the default: its routes are tools as-is, and none of its code
runs here) or 'logic' (its own tools run here too, sealed and confined, reaching it only through its routes)."""


@dataclass
class Request:
    """An HTTP request: what a provider's handle() and an operator's operate() take, and what a channel is given."""
    method: str = 'GET'
    url: str = ''
    headers: Dict[str, str] = field(default_factory=dict)
    body: str = ''

    def header(self, name: str) -> Optional[str]:
        """A header by name (any case)."""
        name = name.lower()
        for key, value in self.headers.items():
            if key.lower() == name:
                return value
        return None


@dataclass
class Response:
    """An HTTP response: what handle() and operate() return, what a channel returns, and what work() may return."""
    status: int = 200
    headers: Dict[str, str] = field(default_factory=dict)
    body: str = ''

    def json(self) -> Any:
        return json.loads(self.body)


Channel = Callable[[Request], Response]
"""A host's own way to an operator (see Limitr.network(channels=...)): the operator's request in, its response out."""


@dataclass
class NetworkCall:
    """An allowed request to one of this policy's routes, for its work (see LimitrNetwork.handle())."""
    route: str
    """The route's name (from the policy's network.provider.routes)."""
    customer: str
    """The voucher's customer (its route's declared metering, if any, already done; meter the rest with it)."""
    request: Request
    """The request, as it came in."""
    body: str
    """The request's body text."""
    query: Dict[str, str]
    """The request's query string, parsed (the first value of each name)."""
    subject: Optional[str] = None
    """Who the consumer is, from its identity statement (checked against this provider's identity operator), if any."""


class Discovered(TypedDict):
    """A provider found by LimitrNetwork.discover(): its own signed manifest, checked."""
    key: str
    name: str
    label: str
    url: str
    terms: str


class Connection(TypedDict, total=False):
    """A consumer's connection to a provider (LimitrNetwork.connection(name))."""
    name: str
    label: str
    url: str
    subject: Optional[str]
    issuer: Optional[str]
    provider: str
    voucher: str
    seq: int
    plan: str
    spend: float
    expires: float
    spent: float
    remaining: float
    customer: Optional[str]
    budget: Optional[str]
    budget_remaining: Optional[float]
    max: Optional[float]
    trust: Trust
    may_call: List[str]
    routes: List[str]
    tools: List[str]


class Budget(TypedDict):
    """A budget at a state operator (LimitrNetwork.budget_info(id)): one spend across many providers."""
    budget: str
    operator: str
    seq: int
    spend: float
    expires: float
    providers: Optional[List[str]]
    spent: float
    remaining: float


class Refusal(TypedDict):
    """A refused request to a provider's route: a tool's result (not an error), so an agent can act on it."""
    provider: str
    status: int
    reason: str
    spent: float
    remaining: float
    budget_remaining: Optional[float]
    expires: float


class Failure(TypedDict):
    """A provider's tool (trust 'logic') that failed: an error in it, or running past the network's tool_time."""
    provider: str
    tool: str
    reason: str


Work = Callable[[NetworkCall], Any]
Time = Union[int, float, datetime]


def _ms(time: Time) -> int:
    """A time as whole ms since the epoch (like JavaScript's Date.now()): vouchers carry whole ms."""
    return int(time.timestamp() * 1000) if isinstance(time, datetime) else int(time)


def _request_map(request: Request) -> Dict[str, Any]:
    """A Request as the module's NetworkRequest map."""
    return {
        'method': request.method.upper(),
        'url': request.url,
        'headers': {str(k).lower(): str(v) for k, v in request.headers.items()},
        'body': request.body,
    }


def _to_request(request: Any) -> Request:
    """The module's NetworkRequest map as a Request."""
    request = request if isinstance(request, dict) else {}
    headers = request.get('headers') or {}
    return Request(method=str(request.get('method') or 'GET').upper(), url=str(request.get('url') or ''),
                   headers={str(k): str(v) for k, v in (headers.items() if isinstance(headers, dict) else [])},
                   body=str(request.get('body') or ''))


class LimitrNetwork:
    """
    Limitr Network for one Limitr instance: offer this policy's services, or use other policies' and pay for them, peer
    to peer (see src/network/SPEC.md). Get it with `limitr.network()`.
    """

    def __init__(self, limitr: 'Limitr', secret_key: str, channels: Optional[Dict[str, Channel]] = None):
        self.limitr = limitr
        self._secret_key = secret_key
        self._channels: Dict[str, Channel] = dict(channels or {})
        self.public_key: str = Doc.public_key(secret_key)
        """This policy's identity (its public key)."""
        self._request_header = ''
        self._queues: Dict[str, List[Any]] = {}   # voucher -> [lock, waiting]
        self._queues_lock = threading.Lock()

    def add_channel(self, operator: str, channel: Channel) -> None:
        """Carry an operator's messages (policy.network.operators.<name>, with `channel: true`) through `channel`."""
        self._channels = {**self._channels, operator: channel}

    @staticmethod
    def generate_key() -> Dict[str, str]:
        """
        A new identity (an Ed25519 key pair): `secret_key`, to keep in your secrets store and pass to
        `limitr.network(secret_key=...)`, and `public_key`, which others know it by (Ex. an operator that identifies it).
        """
        secret = Doc.generate_key()
        return {'secret_key': secret, 'public_key': Doc.public_key(secret)}

    def _setup(self, doc: Doc) -> None:
        """
        The host's part for a document: NetworkKey::sign, which signs as this policy, only Limitr Network messages
        (limitr-network/ contexts), and NetworkChannel::send. The policy never sees the key.
        """
        secret = self._secret_key
        prefix = doc.get('<Network>.CONTEXT')
        if not isinstance(prefix, str) or not prefix:
            raise ValueError('Limitr Network: the module has no signing context')
        self._request_header = str(doc.get('<Network>.REQUEST_HEADER') or '')

        def sign(context: str, message: str) -> str:
            if not isinstance(context, str) or not context.startswith(prefix):
                raise ValueError(f'NetworkKey::sign signs only Limitr Network messages ({prefix} contexts)')
            return Doc.sign(secret, context, message)

        def send(operator: str, request: Any) -> Dict[str, Any]:
            channel = self._channels.get(operator)
            if channel is None:
                raise ValueError(f"no channel for operator '{operator}' (Limitr.network(channels=...))")
            response = channel(_to_request(request))
            return {'status': int(response.status), 'headers': {k.lower(): v for k, v in response.headers.items()},
                    'body': response.body}

        doc.lib('NetworkKey', 'sign', sign)
        doc.lib('NetworkChannel', 'send', send, True)

    def _call(self, path: str, *args: Any) -> Any:
        return self.limitr._call(path, *args)

    # ------------------------------------------------------------------------------------------------------------
    # Provider
    # ------------------------------------------------------------------------------------------------------------

    def handle(self, request: Request, work: Work) -> Response:
        """
        Answer a request to this policy's network: its manifest, vouchers, cancels, and requests to its routes. A
        request to a route is checked (signature, voucher, replay) first, and its route's declared metering runs; only
        an allowed one runs `work`, whose result is the response body (a str as text, a Response as is, anything else
        as JSON). The work meters as the policy says, with `call.customer` (the voucher's customer:
        `limitr.allow(...)`, reserve and settle), capped for the request: what the request spent goes in the
        provider's signed receipt, made after the work, with the body's SHA-256. Requests on one voucher run one at a
        time here (others in parallel). If `work` raises, the request is still finished (it costs what it metered),
        and the error is raised on.

        Serve it with any framework (see wsgi() and serve() for the standard library's).
        """
        req = _request_map(request)
        with self._queued(self._voucher_of(req)):
            return self._answer(request, req, work)

    def _answer(self, request: Request, req: Dict[str, Any], work: Work) -> Response:
        answer = self._call('LimitrNetwork.handle', req) or {}
        status = int(answer.get('status') or 500)
        headers: Dict[str, str] = dict(answer.get('headers') or {})
        route, customer, n = answer.get('route'), answer.get('customer'), answer.get('request')
        if status != 200 or not route or not customer or n is None:
            return Response(status, headers, str(answer.get('body') or ''))

        text = ''
        failure: Optional[BaseException] = None
        try:
            query = dict(parse_qsl(urlsplit(request.url).query, keep_blank_values=True))
            subject = answer.get('subject')
            result = work(NetworkCall(route=route, customer=customer, request=request, body=req['body'], query=query,
                                      subject=subject if isinstance(subject, str) and subject else None))
            if isinstance(result, Response):
                status = result.status
                headers.update(result.headers)
                text = result.body
            elif isinstance(result, str):
                headers['content-type'] = 'text/plain'
                text = result
            else:
                headers['content-type'] = 'application/json'
                text = json.dumps(result, separators=(',', ':'))
        except BaseException as error:   # finished either way, below
            failure = error
        # finished either way: it costs what it metered, and the receipt says so (with the body's SHA-256)
        finish = self._call('LimitrNetwork.done', customer, n, text if failure is None else '') or {}
        if failure is not None:
            raise failure
        headers.update(finish)
        return Response(status, headers, text)

    def _voucher_of(self, req: Dict[str, Any]) -> Optional[str]:
        """The voucher a request is under (from its signed request header), or None."""
        signed = req['headers'].get(self._request_header) if self._request_header else None
        if not signed:
            return None
        try:
            voucher = json.loads(signed).get('voucher')
        except (ValueError, AttributeError):
            return None
        return voucher if isinstance(voucher, str) else None

    @contextmanager
    def _queued(self, key: Optional[str]) -> Iterator[None]:
        """Run requests on one voucher one at a time (so a request's cap counts only its own spend)."""
        if key is None:
            yield
            return
        with self._queues_lock:
            entry = self._queues.setdefault(key, [threading.Lock(), 0])
            entry[1] += 1
        try:
            with entry[0]:
                yield
        finally:
            with self._queues_lock:
                entry[1] -= 1
                if entry[1] == 0 and self._queues.get(key) is entry:
                    del self._queues[key]

    def manifest(self) -> str:
        """This policy's signed manifest (its terms). handle() serves it at GET /.well-known/limitr-network."""
        return self._call('LimitrNetwork.manifest')

    def revoke(self, voucher: str, reason: str = '') -> Optional[str]:
        """
        End a voucher from this side: it stops being allowed now. Returns the signed revoke to send the consumer, if
        you can reach it (it learns anyway on its next call, which is refused).
        """
        return self._call('LimitrNetwork.revoke', voucher, reason)

    def sweep(self) -> int:
        """
        Remove voucher customers that ended more than a week ago (the policy's network.provider.keep_ended), after a
        'network-voucher-ended' event with each. handle() runs it at most once an hour.
        """
        return int(self._call('LimitrNetwork.sweep') or 0)

    def wsgi(self, work: Work) -> Callable[..., Iterable[bytes]]:
        """
        handle() as a WSGI app: serve it with any WSGI server (gunicorn, waitress, wsgiref), or mount it in a Flask or
        Django app.
        """
        return _wsgi_app(lambda request: self.handle(request, work))

    def serve(self, work: Work, port: int = 0, host: str = '127.0.0.1') -> 'Server':
        """
        Serve handle() on a thread with the standard library (a small threaded WSGI server): for demos, tests, and
        local tools. Port 0 picks a free one (see `server.url`). `server.close()` stops it.
        """
        return serve(lambda request: self.handle(request, work), port, host)

    # ------------------------------------------------------------------------------------------------------------
    # Consumer
    # ------------------------------------------------------------------------------------------------------------

    def connect(self, url: str, plan: str, spend: float, expires: Time, budget: Optional[str] = None,
                trust: Optional[Trust] = None, may_call: Optional[List[str]] = None,
                max: Optional[float] = None) -> List[str]:
        """
        Start using a provider: read its manifest, sign a voucher for one of its plans (up to `spend` runes, until
        `expires`), and take its grant. Its routes become tools here ('<provider>_<route>', capabilities run like
        any other: limitr.run_capability, limitr.claude_tools). Returns their names. A new voucher for a provider
        replaces the old one.

        A refused request is the tool's result (see refusal()), not an error, so an agent can act on it. Raising
        spend is the host's decision: update().

        `budget` (see budget()) spends from that budget too, one spend across several providers (the provider must
        accept the budget's operator). `trust='logic'` runs the provider's own tools here too ('<provider>_<tool>'),
        sealed and confined: they see nothing of this policy, call no host, and reach the provider only through its
        routes (each request signed for this voucher and metered there). `may_call` lets them call those other
        connections' routes too, spending their vouchers. `max` is the most one request may spend (runes).
        """
        self.limitr.allow_network_host(url)
        return list(self._call('LimitrNetwork.connect', url, plan, float(spend), _ms(expires), budget, trust,
                               may_call, None if max is None else float(max)) or [])

    def trust(self, name: str, trust: Trust, may_call: Optional[List[str]] = None) -> List[str]:
        """
        Change how far this policy trusts a connection's provider ('declarations' or 'logic'), and which other
        connections its tools may call (unchanged when not given). Its tools here are made again; returns their names.
        """
        return list(self._call('LimitrNetwork.trust', name, trust, may_call) or [])

    def budget(self, operator: str, spend: float, expires: Time, providers: Optional[List[str]] = None,
               id: Optional[str] = None) -> str:
        """
        Open a budget at one of the policy's state operators (by its name in policy.network.operators): up to `spend`
        runes across every provider connected with it, until `expires`, only with `providers` (public keys) when
        given. Returns its ID. Pass `id` to change an existing budget (an expiry of now ends it).
        """
        return self._call('LimitrNetwork.budget', operator, float(spend), _ms(expires), providers, id)

    def list(self, visibility: Literal['public', 'private'] = 'public', members: Optional[List[str]] = None,
             subjects: Optional[List[str]] = None) -> bool:
        """
        List this provider at its discovery operator: public, or private to `members` (public keys) and `subjects`
        (who the operator identified, Ex. an organization). List again after the terms change.
        """
        return bool(self._call('LimitrNetwork.list', visibility, members, subjects))

    def unlist(self) -> bool:
        """Remove this provider's listing at its discovery operator."""
        return bool(self._call('LimitrNetwork.unlist'))

    def discover(self, query: str = '', limit: int = 20, operator: Optional[str] = None) -> List[Discovered]:
        """
        Search a discovery operator for providers (every word of `query` in a provider's name, label, or its routes'
        and tools' descriptions; empty for all). The search is signed, so listings private to this policy's key (or,
        with an identity statement from that operator, to who it is) come back too. Each result is a provider's own
        signed manifest, checked here.
        """
        found = self._call('LimitrNetwork.discover', query, limit, operator) or []
        return [{'key': str(item.get('key')), 'name': str(item.get('name')), 'label': str(item.get('label')),
                 'url': str(item.get('url')), 'terms': str(item.get('terms'))} for item in found if isinstance(item, dict)]

    def rotation(self, public_key: str) -> str:
        """
        Rotate this policy's key (for an operator): returns a statement, signed by the key it has now, that its key is
        now `public_key`. Add it to the policy's network.service.rotations (in order), then start with the new secret
        key: policies that name the operator by its first key follow the chain from its manifest.
        """
        return self._call('LimitrNetwork.rotation', public_key)

    def identify(self, operator: Optional[str] = None) -> str:
        """
        Get an identity statement for this policy's key from an identity operator (by its name in
        policy.network.operators; the one serving 'identity' when omitted). Every voucher carries it from now on, for
        providers that require one. Returns who the operator says this policy is.
        """
        return self._call('LimitrNetwork.identify', operator)

    def budget_info(self, id: str) -> Optional[Budget]:
        """A budget by ID: its spend, and what it has spent and has left."""
        out = self._call('LimitrNetwork.budget_info', id)
        return json.loads(out) if out else None

    @staticmethod
    def refusal(result: Any) -> Optional[Refusal]:
        """A tool's result as a refusal, when it is one (None otherwise)."""
        if not isinstance(result, str) or not result.startswith('{"refused"'):
            return None
        try:
            return json.loads(result)['refused']
        except (ValueError, KeyError):
            return None

    @staticmethod
    def failure(result: Any) -> Optional[Failure]:
        """A provider tool's result as a failure, when it is one (None otherwise)."""
        if not isinstance(result, str) or not result.startswith('{"failed"'):
            return None
        try:
            return json.loads(result)['failed']
        except (ValueError, KeyError):
            return None

    # ------------------------------------------------------------------------------------------------------------
    # Operators
    # ------------------------------------------------------------------------------------------------------------

    def check_operators(self) -> bool:
        """Check every operator in the policy (its signed manifest, roles, and modes). Raises with the reason when one is off."""
        return bool(self._call('LimitrNetwork.check_operators'))

    def operate(self, request: Request) -> Response:
        """
        When this policy is an operator (policy.network.service): answer a request to it, its manifest and the state
        role's messages. Like handle(), served with any framework (operator_wsgi() and serve_operator() for the
        standard library's).
        """
        answer = self._call('LimitrNetwork.operate', _request_map(request)) or {}
        return Response(int(answer.get('status') or 500), dict(answer.get('headers') or {}), str(answer.get('body') or ''))

    def operator_wsgi(self) -> Callable[..., Iterable[bytes]]:
        """operate() as a WSGI app."""
        return _wsgi_app(self.operate)

    def serve_operator(self, port: int = 0, host: str = '127.0.0.1') -> 'Server':
        """Serve operate() on a thread with the standard library (see serve())."""
        return serve(self.operate, port, host)

    def update(self, name: str, spend: Optional[float] = None, expires: Optional[Time] = None) -> List[str]:
        """Change a connection's voucher (more or less spend, a later or earlier expiry), and take the new grant."""
        return list(self._call('LimitrNetwork.update', name, None if spend is None else float(spend),
                               None if expires is None else _ms(expires)) or [])

    def cancel(self, name: str) -> bool:
        """
        Stop using a provider: tells it (its voucher ends now), and removes the connection and its capabilities here.
        False when there's no such connection.
        """
        return bool(self._call('LimitrNetwork.cancel', name))

    def revoked(self, message: str) -> bool:
        """A provider's revoke: removes that connection and its capabilities. True when it was valid."""
        return bool(self._call('LimitrNetwork.revoked', message))

    def connection(self, name: str) -> Optional[Connection]:
        """A connection by its provider's name: its voucher, and what it has spent and has left."""
        out = self._call('LimitrNetwork.connection', name)
        return json.loads(out) if out else None


# ----------------------------------------------------------------------------------------------------------------
# Serving with the standard library
# ----------------------------------------------------------------------------------------------------------------

def _wsgi_app(answer: Callable[[Request], Response]) -> Callable[..., Iterable[bytes]]:
    """A WSGI app around a Request -> Response function."""
    def app(environ: Dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
        headers: Dict[str, str] = {}
        for key, value in environ.items():
            if key.startswith('HTTP_'):
                headers[key[5:].replace('_', '-').lower()] = value
        if environ.get('CONTENT_TYPE'):
            headers['content-type'] = environ['CONTENT_TYPE']
        try:
            length = int(environ.get('CONTENT_LENGTH') or 0)
        except ValueError:
            length = 0
        body = environ['wsgi.input'].read(length).decode('utf-8', 'replace') if length > 0 else ''
        host = environ.get('HTTP_HOST') or f"{environ.get('SERVER_NAME', 'localhost')}:{environ.get('SERVER_PORT', '80')}"
        query = environ.get('QUERY_STRING') or ''
        url = f"{environ.get('wsgi.url_scheme', 'http')}://{host}{environ.get('PATH_INFO') or '/'}" + (f'?{query}' if query else '')
        try:
            response = answer(Request(environ.get('REQUEST_METHOD', 'GET'), url, headers, body))
        except Exception:
            response = Response(500, {'content-type': 'text/plain'}, 'internal error')
        data = response.body.encode()
        out = [(k, v) for k, v in response.headers.items() if k.lower() != 'content-length']
        out.append(('Content-Length', str(len(data))))
        try:
            reason = HTTPStatus(response.status).phrase
        except ValueError:
            reason = ''
        start_response(f'{response.status} {reason}'.strip(), out)
        return [data]
    return app


def serve(handler: Callable[[Request], Response], port: int = 0, host: str = '127.0.0.1') -> 'Server':
    """
    Serve a Request -> Response function on a thread with the standard library (a small threaded WSGI server): Ex.
    a provider's `lambda request: network.handle(request, work)`. For demos, tests, and local tools; in production,
    serve LimitrNetwork.wsgi() (or call handle() from your framework). Port 0 picks a free one (see `server.url`).
    """
    return Server(_wsgi_app(handler), host, port)


class _ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass


class Server:
    """A WSGI app served on a thread (LimitrNetwork.serve()). `url` is where it is; close() stops it."""

    def __init__(self, app: Callable[..., Iterable[bytes]], host: str = '127.0.0.1', port: int = 0):
        self._server = make_server(host, port, app, server_class=_ThreadingWSGIServer, handler_class=_QuietHandler)
        self.port: int = self._server.server_address[1]
        self.url: str = f'http://{"localhost" if host in ("127.0.0.1", "localhost") else host}:{self.port}'
        self._thread = threading.Thread(target=self._server.serve_forever, name='limitr-network-server', daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def __enter__(self) -> 'Server':
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
