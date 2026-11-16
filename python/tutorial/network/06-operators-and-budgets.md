# 6. Operators and budgets

Two policies are enough until a provider runs on more than one server (each would keep its own voucher state), or an
agent wants one spend across several providers. An **operator** is a third party both sides trust with that state:

```python
import itertools
import time

from limitr import Limitr
from limitr.network import serve

# An operator: a policy that serves the state role. Limitr Cloud is one; any policy can be.
operator = Limitr("policy: { network: { service: { label: 'Our operator' } } }")
operator_network = operator.network()

# Everyone reaches it through a channel instead of HTTP: here, a direct call to its handler. (Over HTTP, it would
# be served like a provider: operator_network.serve_operator(port=...).)
channels = {'ours': operator_network.operate}
ours = f"ours: {{ url: 'https://operator.example', key: '{operator_network.public_key}', roles: ['state'], channel: true }}"

# The weather service, running as two instances (same policy, same key) behind one URL.
policy = f'''
policy: {{
    credits: {{ forecast: {{ label: 'Forecast', unit: 'forecast', price: {{ amount: 0.01 }} }} }}
    plans: {{ agent: {{ label: 'Agents', entitlements: {{ forecasts: {{ limit: {{ credit: 'forecast', mode: 'soft', value: 0 }} }} }} }} }}
    network: {{
        operators: {{ {ours} }}
        provider: {{
            name: 'acme_weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {{ forecast: {{ description: 'The forecast for a city', path: '/forecast', parameters: [{{ name: 'city' }}], entitlement: 'forecasts' }} }}
        }}
    }}
}}'''
keys = []
first = Limitr(policy).network(channels=channels, key_store=keys.append)
second = Limitr(policy).network(channels=channels, secret_key=keys[0])
turns = itertools.cycle([first, second])   # a load balancer, taking turns
server = serve(lambda request: next(turns).handle(request, lambda call: {'city': call.query.get('city'), 'forecast': 'sunny'}), port=8787)

# The agent opens a budget at the operator: 2 cents, across whichever providers it connects to with it.
agent = Limitr(f'policy: {{ network: {{ operators: {{ {ours} }} }} }}')
network = agent.network(channels=channels)
hour = time.time() * 1000 + 60 * 60 * 1000
budget = network.budget('ours', 0.02, hour)

# Its voucher allows a dollar, but spends from the budget.
network.connect('http://localhost:8787', 'agent', 1, hour, budget=budget)
for city in ['Boston', 'Denver', 'Austin']:
    result = agent.run_capability('acme_weather_forecast', {'city': city})
    refused = network.refusal(result)
    print(city, refused['reason'] if refused else result)
info = network.budget_info(budget)
print('budget at', info['operator'], '| spend', info['spend'], '| spent', info['spent'], '|', info['remaining'], 'left')
server.close()
```

It prints:

```text
Boston {"city":"Boston","forecast":"sunny"}
Denver {"city":"Denver","forecast":"sunny"}
Austin not enough spend left (the voucher's, or its budget's)
budget at ours | spend 0.02 | spent 0.02 | 0.0 left
```

What happened:

- **An operator is a policy too**, with `network.service`: a key, and the roles it serves (`state` here, the default).
  Limitr Cloud is one, and anyone can run their own. Policies name the operators they use in `network.operators`, at
  most one per role.
- **Two instances, one voucher.** The service's instances share its key and policy, and both use the operator for
  state. The first accepted the voucher and registered it there; the second got the next request, found the voucher
  at the operator, and checked the agent's signature on it itself (the operator can't forge one). Each request is
  claimed from the operator first, so spend and replays are exact across any number of instances (`strict`, the
  default; `bounded` trades that for fewer round trips, with leases).
- **A budget** is one spend at the operator, across whichever providers the agent connects to with it. The voucher
  allowed a dollar, but the budget allowed 2 cents, so the third forecast was refused.
- **Channels.** Operator messages are signed, so they don't need HTTP: `channels` hands them to a function, here a
  direct call to the operator's handler, and in production any connection the host already has. Answers are still
  checked with the operator's key. On a `Limitr.cloud()` engine you don't set any of this up: `limitr.network()` adds
  Cloud as the `limitr` operator, over the engine's WebSocket (when your workspace has Limitr Network). Over HTTP, an operator is served like a provider:
  `operator_network.serve_operator(port=...)`, or `operator_network.operator_wsgi()` in your own server.
- **One handler, two instances.** `serve()` from `limitr.network` serves any `Request -> Response` function: here a
  stand-in load balancer that hands each request to the next instance's `handle()`.
- **It fails closed.** If the operator can't be reached, the service refuses requests (503) rather than spend what it
  can't count.
- **Keys rotate.** An operator is known by its first key, and can move to a new one (`rotation()`) without breaking
  anyone's vouchers: policies follow the chain in its manifest.

Next: [Identity and discovery](07-identity-and-discovery.md)
