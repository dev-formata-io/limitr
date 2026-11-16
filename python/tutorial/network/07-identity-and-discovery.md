# 7. Identity and discovery

A key says a message is from the same party as before, not who that party is. An identity operator vouches for that,
and a discovery operator lets agents find services:

```python
import time

from limitr import Limitr, LimitrNetwork

# Identities are key pairs. Make the service's and the agent's up front, so the operator can know them.
weather_key = LimitrNetwork.generate_key()
agent_key = LimitrNetwork.generate_key()

# An operator that serves identity and discovery, knows both keys (Ex. from its own accounts), and requires everyone
# who uses it to be identified.
operator = Limitr(f'''
policy: {{
    network: {{
        service: {{
            label: 'Our network'
            roles: ['identity', 'discovery']
            requires: ['provider', 'consumer']
            identities: {{
                '{weather_key['public_key']}': 'Acme Weather, Inc.'
                '{agent_key['public_key']}': 'Example Corp'
            }}
        }}
    }}
}}''')
operator_network = operator.network()
channels = {'ours': operator_network.operate}
ours = f"ours: {{ url: 'https://operator.example', key: '{operator_network.public_key}', roles: ['identity', 'discovery'], channel: true }}"

weather = Limitr(f'''
policy: {{
    credits: {{ forecast: {{ label: 'Forecast', unit: 'forecast', price: {{ amount: 0.01 }} }} }}
    plans: {{ agent: {{ label: 'Agents', entitlements: {{ forecasts: {{ limit: {{ credit: 'forecast', mode: 'soft', value: 0 }} }} }} }} }}
    network: {{
        operators: {{ {ours} }}
        provider: {{
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']               // with an identity operator, its vouchers need an identity ('auto')
            routes: {{ forecast: {{ description: 'The weather forecast for a city', path: '/forecast', parameters: [{{ name: 'city' }}], entitlement: 'forecasts' }} }}
        }}
    }}
}}''')
service = weather.network(channels=channels, secret_key=weather_key['secret_key'])
server = service.serve(lambda call: {'city': call.query.get('city'), 'forecast': 'sunny', 'for': call.subject}, port=8787)

# The service gets its statement (it goes in its manifest), and lists itself: private, for Example Corp.
print('weather is', service.identify())
service.list('private', subjects=['Example Corp'])

# The agent: identified too, and it only connects to identified providers.
agent = Limitr(f'policy: {{ network: {{ require_identity: true, operators: {{ {ours} }} }} }}')
network = agent.network(channels=channels, secret_key=agent_key['secret_key'])
print('agent is', network.identify())

# It finds the service by what it does (a private listing it may see), and connects to it.
found = network.discover('weather forecast')
print('found:', [f"{provider['label']} at {provider['url']}" for provider in found])
network.connect(found[0]['url'], 'agent', 1, time.time() * 1000 + 60 * 60 * 1000)
print('connected to', network.connection('acme_weather')['subject'])
print(agent.run_capability('acme_weather_forecast', {'city': 'Boston'}))
server.close()
```

It prints:

```text
weather is Acme Weather, Inc.
agent is Example Corp
found: ['Acme Weather at http://localhost:8787']
connected to Acme Weather, Inc.
{"city":"Boston","forecast":"sunny","for":"Example Corp"}
```

What happened:

- **`LimitrNetwork.generate_key()`** makes a key pair, so the operator can know the service and the agent before they
  start (an operator like Limitr Cloud knows its accounts' keys instead).
- **Identity statements.** `identify()` asks the identity operator for a signed statement: "this key is Acme Weather,
  Inc.". The service's goes in its manifest; the agent's goes with every voucher.
- **Who must have one.** A provider with an identity operator requires one from every voucher by default
  (`network.provider.identity: 'auto'`; `'optional'` or per plan with `identity_plans`), and its work sees who it's
  serving (`subject`). An agent with `require_identity` connects only to identified providers. An operator with
  `requires` refuses anyone it hasn't identified, so everyone on it is known.
- **Discovery.** `list()` puts the service's manifest in the operator's directory: public, or private to some keys or to
  identified organizations (`subjects`), like private repositories. `discover(query)` is a signed search, so the
  operator shows a private listing only to its members. The results are the services' own signed manifests,
  checked by the agent, so a directory can't forge or change one, and `connect()` reads the manifest from the
  service itself.
- **Your own network.** Nothing here depends on Limitr Cloud: a company can run an operator for its own services and
  partners, and Cloud is the public one.

That's the protocol: vouchers, metered requests, receipts, and operators when you need them. The full design is in
[`SPEC.md`](../../../src/network/SPEC.md), and the wire format, for other languages, in
[`PROTOCOL.md`](../../../src/network/PROTOCOL.md).

Back to the [table of contents](README.md).
