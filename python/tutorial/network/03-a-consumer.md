# 3. A consumer

A consumer is any policy that connects to a provider. This one is an agent with an empty policy:

```python
import time

from limitr import Limitr, LimitrNetwork

# The weather service from chapter 2.
weather = Limitr('''
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city, Ex. Boston' }]
                    entitlement: 'forecasts'
                }
            }
        }
    }
}''')
service = weather.network()
server = service.serve(lambda call: {'city': call.query.get('city'), 'forecast': 'sunny'}, port=8787)

# An agent: an empty policy, and an identity of its own.
agent = Limitr('policy: {}')
network = agent.network(name='support_agent')


# Every response comes with a receipt signed by the service.
def receipts(key, receipt):
    if key == 'network-receipt':
        print(f"  receipt: cost {receipt['cost']}, spent {receipt['spent']}, {receipt['remaining']} left")


agent.add_handler('receipts', receipts)

# A voucher: up to 3 cents on the 'agent' plan, for an hour.
tools = network.connect('http://localhost:8787', 'agent', 0.03, time.time() * 1000 + 60 * 60 * 1000)
print('tools:', tools)
print('for Claude:', [tool['name'] for tool in agent.claude_tools()])

for city in ['Boston', 'Denver', 'Austin']:
    print(city, agent.run_capability('acme_weather_forecast', {'city': city}))

# The voucher is spent: the fourth is refused, as the tool's result.
result = agent.run_capability('acme_weather_forecast', {'city': 'Seattle'})
refused = LimitrNetwork.refusal(result)
print('refused:', refused['status'], refused['reason'])

# More spend is a newer voucher. Then the call goes through.
network.update('acme_weather', spend=0.10)
print('Seattle', agent.run_capability('acme_weather_forecast', {'city': 'Seattle'}))

# On the service's side, the voucher is a customer like any other.
customer = network.connection('acme_weather')['customer']
print('service sees', customer[:3] + '...', 'with', weather.value(customer, 'forecasts'), 'forecasts')

network.cancel('acme_weather')
print('after cancel:', len(agent.claude_tools()), 'tools')
server.close()
```

It prints:

```text
tools: ['acme_weather_forecast']
for Claude: ['acme_weather_forecast']
  receipt: cost 0.01, spent 0.01, 0.02 left
Boston {"city":"Boston","forecast":"sunny"}
  receipt: cost 0.01, spent 0.02, 0.01 left
Denver {"city":"Denver","forecast":"sunny"}
  receipt: cost 0.01, spent 0.03, 0.0 left
Austin {"city":"Austin","forecast":"sunny"}
  receipt: cost 0.0, spent 0.03, 0.0 left
refused: 402 not allowed: a limit, the voucher's spend, or its expiry
  receipt: cost 0.01, spent 0.04, 0.06 left
Seattle {"city":"Seattle","forecast":"sunny"}
service sees nv_... with 4.0 forecasts
after cancel: 0 tools
```

What happened:

- **`connect(url, plan, spend, expires)`** reads the manifest, checks its signature, signs a voucher for 3 cents on
  the `agent` plan for an hour, and takes the service's grant. It returns the new tools' names. The voucher agrees to
  the exact terms it read: if the service changes its prices, it needs a new voucher, so prices can't change under it.
- **Each route is a tool.** `acme_weather_forecast` is a capability in the agent's policy, so `claude_tools()` lists it
  for Claude and `run_capability()` runs it, as for any capability. For each `tool_use` block Claude sends, run
  `run_capability(block['name'], block['input'])` and send the result back as a `tool_result`.
- **Each call is signed** by the agent's key and numbered, so it can't be replayed or changed on the way. The service
  meters it under the voucher's customer and answers with a signed **receipt**, sent as a `network-receipt` event:
  what the request cost, and what the voucher has spent and has left. The agent checks the receipt matches the
  response it got.
- **The voucher's spend is a hard cap.** The fourth forecast is refused (402), and the refusal is the tool's result,
  not an error, so an agent can read it and act: tell its user, stop, or ask its host for more. `LimitrNetwork.refusal(result)`
  reads one. The agent can't raise its own spend: only the host can, with `update()`, which signs a newer voucher.
- **On the service's side** the voucher is a customer (`nv_` and the voucher's ID, type `voucher`) on its plan. Its
  usage, events, margins, and Limitr Cloud see it like any customer.
- **`cancel()`** ends the voucher on both sides and removes the tools. A voucher also ends at its expiry, so one that's
  never cancelled doesn't stay open, and the service can end one too (`revoke()`).

Next: [Metering](04-metering.md)
