"""
Tests for Limitr Network in the Python SDK: a provider and a consumer in one process (the provider served on a thread),
handle() called directly, the WSGI app, operators through channels, and Limitr Cloud as an operator over a fake Cloud
connection. The protocol itself is tested in the engine (src/network/tests). Run: python -m pytest
"""

import io
import json
import time

import pytest

from limitr import Limitr, LimitrNetwork, Request, Response
from limitr.network import serve

PORT = 8797
HOUR = 60 * 60 * 1000


def provider_policy(port=PORT, operators=''):
    return f'''
policy: {{
    credits: {{ forecast: {{ label: 'Forecast', unit: 'forecast', price: {{ amount: 0.01 }} }} }}
    plans: {{ agent: {{ label: 'Agents', entitlements: {{ forecasts: {{ limit: {{ credit: 'forecast', mode: 'soft', value: 0 }} }} }} }} }}
    network: {{
        operators: {{ {operators} }}
        provider: {{
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:{port}'
            offers: ['agent']
            routes: {{
                forecast: {{ description: 'The forecast for a city', path: '/forecast', parameters: [{{ name: 'city' }}], entitlement: 'forecasts' }}
                free: {{ description: 'Free and unmetered', path: '/free' }}
            }}
            tools: {{ twice: {{ description: 'Two forecasts', parameters: [{{ name: 'city' }}] }} }}
            logic: r#"
                fn twice(input: map) -> unknown {{
                    self.api.call('forecast', map(('city', input.get('city'))));
                    self.api.json(self.api.call('forecast', map(('city', input.get('city')))))
                }}
            "#
        }}
    }}
}}'''


def now_plus(ms=HOUR):
    return time.time() * 1000 + ms


@pytest.fixture
def weather():
    provider = Limitr(provider_policy())
    network = provider.network()
    seen = []

    def work(call):
        seen.append(call)
        if call.route == 'free':
            return 'free text'
        if call.query.get('city') == 'Nowhere':
            raise RuntimeError('no such city')
        return {'city': call.query.get('city'), 'high': 12}
    server = network.serve(work, port=PORT)
    yield provider, network, seen
    server.close()


def agent_network(**options):
    agent = Limitr('policy: {}')
    return agent, agent.network(**options)


# -- identity --------------------------------------------------------------------------------------------------------

def test_keys_and_key_store():
    key = LimitrNetwork.generate_key()
    assert set(key) == {'secret_key', 'public_key'} and key['secret_key'] != key['public_key']
    kept = []
    policy = Limitr('policy: {}')
    network = policy.network(key_store=kept.append)
    assert len(kept) == 1 and network.public_key == LimitrNetwork(policy, kept[0]).public_key
    assert policy.network() is network   # one handle per policy
    other = Limitr('policy: {}').network(secret_key=key['secret_key'])
    assert other.public_key == key['public_key']


def test_the_key_signs_only_network_messages():
    policy = Limitr('policy: {}')
    policy.network()
    with pytest.raises(ValueError, match='signs only Limitr Network messages'):
        policy.doc.call('NetworkKey.sign', ['orders/v1', 'hello'])


# -- provider and consumer -------------------------------------------------------------------------------------------

def test_connect_call_refuse_update_cancel(weather):
    provider, _, seen = weather
    agent, network = agent_network(name='test_agent')
    receipts = []
    agent.add_handler('r', lambda key, value: receipts.append(value) if key == 'network-receipt' else None)

    tools = network.connect(f'http://localhost:{PORT}', 'agent', 0.02, now_plus())
    assert tools == ['acme_weather_forecast', 'acme_weather_free']
    assert [t['name'] for t in agent.claude_tools()] == tools

    assert json.loads(agent.run_capability('acme_weather_forecast', {'city': 'Boston'})) == {'city': 'Boston', 'high': 12}
    assert seen[-1].route == 'forecast' and seen[-1].customer.startswith('nv_') and seen[-1].subject is None
    assert agent.run_capability('acme_weather_free', {}) == 'free text'
    assert agent.run_capability('acme_weather_forecast', {'city': 'Denver'})
    assert [r['cost'] for r in receipts] == [0.01, 0.0, 0.01]

    refused = LimitrNetwork.refusal(agent.run_capability('acme_weather_forecast', {'city': 'Austin'}))
    assert refused['status'] == 402 and refused['remaining'] == 0

    network.update('acme_weather', spend=0.05)
    assert json.loads(agent.run_capability('acme_weather_forecast', {'city': 'Austin'}))['city'] == 'Austin'
    conn = network.connection('acme_weather')
    assert conn['spent'] == pytest.approx(0.03) and conn['remaining'] == pytest.approx(0.02)
    assert provider.value(conn['customer'], 'forecasts') == 3

    assert network.cancel('acme_weather') and agent.claude_tools() == []
    assert network.connection('acme_weather') is None and not network.cancel('acme_weather')


def test_provider_logic_runs_confined_and_meters(weather):
    agent, network = agent_network()
    assert network.connect(f'http://localhost:{PORT}', 'agent', 1, now_plus(), trust='logic') == \
        ['acme_weather_forecast', 'acme_weather_free', 'acme_weather_twice']
    assert json.loads(agent.run_capability('acme_weather_twice', {'city': 'Boston'}))['city'] == 'Boston'
    assert network.connection('acme_weather')['spent'] == pytest.approx(0.02)
    assert network.trust('acme_weather', 'declarations') == ['acme_weather_forecast', 'acme_weather_free']


def test_work_that_raises_still_finishes_the_request(weather):
    _, provider_network, _ = weather
    agent, network = agent_network()
    network.connect(f'http://localhost:{PORT}', 'agent', 1, now_plus())
    result = agent.run_capability('acme_weather_forecast', {'city': 'Nowhere'})
    assert result is not None and 'high' not in str(result)   # the server answered 500
    # the request was finished on the provider's side, so the voucher's queue moves on
    assert json.loads(agent.run_capability('acme_weather_forecast', {'city': 'Boston'}))['city'] == 'Boston'


def test_revoke_ends_the_voucher(weather):
    provider, provider_network, _ = weather
    agent, network = agent_network()
    network.connect(f'http://localhost:{PORT}', 'agent', 1, now_plus())
    voucher = network.connection('acme_weather')['voucher']
    message = provider_network.revoke(voucher, 'done')
    assert isinstance(message, str)
    assert LimitrNetwork.refusal(agent.run_capability('acme_weather_forecast', {'city': 'Boston'}))['status'] in (401, 402)
    assert network.revoked(message) and network.connection('acme_weather') is None


def test_handle_directly_and_as_wsgi():
    provider = Limitr(provider_policy(port=PORT + 1))
    network = provider.network()
    manifest = network.handle(Request('GET', f'http://localhost:{PORT + 1}/.well-known/limitr-network'), lambda call: None)
    assert manifest.status == 200 and manifest.json()['key'] == network.public_key
    assert json.loads(network.manifest())['key'] == network.public_key

    plain = network.handle(Request('GET', f'http://localhost:{PORT + 1}/forecast?city=Boston'), lambda call: 'never')
    assert plain.status == 401 and plain.body == 'not a Limitr Network request'

    app = network.wsgi(lambda call: 'never')
    started = {}
    environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': '/.well-known/limitr-network', 'QUERY_STRING': '',
               'HTTP_HOST': f'localhost:{PORT + 1}', 'wsgi.url_scheme': 'http', 'wsgi.input': io.BytesIO(b'')}
    body = b''.join(app(environ, lambda status, headers: started.update(status=status, headers=dict(headers))))
    assert started['status'] == '200 OK' and json.loads(body)['key'] == network.public_key
    assert started['headers']['Content-Length'] == str(len(body))


def test_refusal_and_failure_parse_only_their_own():
    assert LimitrNetwork.refusal('{"refused":{"status":402}}') == {'status': 402}
    assert LimitrNetwork.refusal('{"city":"x"}') is None and LimitrNetwork.refusal(None) is None
    assert LimitrNetwork.failure('{"failed":{"tool":"t"}}') == {'tool': 't'}
    assert LimitrNetwork.failure('{"refused":{}}') is None


# -- operators -------------------------------------------------------------------------------------------------------

def test_an_operator_through_channels_and_over_http():
    operator = Limitr("policy: { network: { service: { label: 'Ops' } } }")
    ops = operator.network()
    channels = {'ours': ops.operate}
    ours = f"ours: {{ url: 'https://operator.example', key: '{ops.public_key}', roles: ['state'], channel: true }}"
    provider = Limitr(provider_policy(port=PORT + 2, operators=ours))
    provider_network = provider.network(channels=channels)
    assert provider_network.check_operators()
    server = provider_network.serve(lambda call: {'city': call.query.get('city')}, port=PORT + 2)
    try:
        agent = Limitr(f'policy: {{ network: {{ operators: {{ {ours} }} }} }}')
        network = agent.network(channels=channels)
        budget = network.budget('ours', 0.01, now_plus())
        network.connect(f'http://localhost:{PORT + 2}', 'agent', 1, now_plus(), budget=budget)
        assert json.loads(agent.run_capability('acme_weather_forecast', {'city': 'Boston'})) == {'city': 'Boston'}
        assert LimitrNetwork.refusal(agent.run_capability('acme_weather_forecast', {'city': 'Denver'}))
        info = network.budget_info(budget)
        assert info['operator'] == 'ours' and info['spent'] == pytest.approx(0.01) and info['remaining'] == 0
    finally:
        server.close()

    # the operator over HTTP answers its manifest
    with ops.serve_operator() as http_server:
        import urllib.request
        manifest = json.load(urllib.request.urlopen(http_server.url + '/.well-known/limitr-network-operator'))
        assert manifest['key'] == ops.public_key


def test_serve_any_handler():
    with serve(lambda request: Response(201, {'x-path': request.url}, request.body or 'empty')) as server:
        import urllib.request
        response = urllib.request.urlopen(urllib.request.Request(server.url + '/a?b=c', data=b'hi', method='POST'))
        assert response.status == 201 and response.read() == b'hi'
        assert response.headers['x-path'] == server.url + '/a?b=c'


# -- Limitr Cloud as an operator ---------------------------------------------------------------------------------------

def test_cloud_is_an_operator_over_the_connection():
    from test_cloud import FakeCloud

    operator = Limitr("policy: { network: { service: { label: 'Limitr Cloud' } } }")
    ops = operator.network()
    cloud = FakeCloud()
    op_url = 'https://api.limitr.dev/network'
    original = cloud._handle
    calls = []

    def handle(ws, m, instance):
        if m.get('type') == 'hello':
            cloud.hellos.append(m)
            ws.send(json.dumps({'type': 'hello', 'features': cloud.features,
                                'network': {'url': op_url, 'key': ops.public_key, 'label': 'Limitr Cloud', 'roles': ['state']}}))
            return m.get('instance')
        if m.get('type') == 'network-operator':
            calls.append(m['path'])
            # Cloud answers the path from its operator's root (the SDK strips the operator URL's own path)
            answer = ops.operate(Request(m['method'], 'https://operator.local' + m['path'], {'content-type': 'application/json'}, m['body']))
            ws.send(json.dumps({'type': 'network-operator', 'id': m['id'], 'status': answer.status,
                                'headers': answer.headers, 'body': answer.body}))
            return instance
        return original(ws, m, instance)
    cloud._handle = handle
    policy = cloud.connect()
    try:
        network = policy.network()
        budget = network.budget('limitr', 0.5, now_plus())
        info = network.budget_info(budget)
        assert info['operator'] == 'limitr' and info['spend'] == 0.5 and info['remaining'] == 0.5
        assert calls and all(path.startswith('/limitr-network/operator/') for path in calls)
    finally:
        policy.close()
        cloud.stop()
