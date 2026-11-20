# Limitr for Python

**Most flexible usage billing & limits for AI.** Credits, metering, caps, and custom deals for every user and agent,
in one policy that runs in your app and changes live.

Limitr decides what each customer can use and what it costs. You write your plans, limits, and prices in one
policy file. Before your app does something a customer pays for (a model call, an export, an API request), it asks
Limitr: is this allowed? Limitr answers, counts the usage, and tells you what to bill and what it cost you. It runs
inside your app, and [Limitr Cloud](https://limitr.dev) is the hosted side when you want it.

```
pip install limitr
```

## Quick start

Here's a policy, `policy.yaml`. AI tokens cost the customer $20 per million and cost you $8. The free plan gets 50k
tokens a month. The pro plan gets 2M, can go over (and pay for it), and can export PDFs:

```yaml
policy:
  credits:
    ai_token: { price: { amount: 0.00002 }, overhead_cost: 0.000008 }
  plans:
    free:
      default: true
      entitlements:
        chat: { limit: { credit: ai_token, value: 50000, resets: true } }
    pro:
      entitlements:
        chat: { limit: { credit: ai_token, mode: soft, value: 2000000, resets: true } }
        export_pdf: {}   # no limit: a feature flag
```

```python
from limitr import Limitr

limitr = Limitr(open('policy.yaml').read(), 'yaml')
limitr.add_handler('billing', lambda name, event: print('bill acme:', event['overage_price']) if name == 'meter-overage' else None)

limitr.ensure_customer('acme', 'pro')
limitr.allow('acme', 'export_pdf')        # True
limitr.allow('acme', 'chat', 2_100_000)   # True, 100k over the limit, so it prints "bill acme: 2.0"

limitr.ensure_customer('ada')             # no plan given, so ada is on free
d = limitr.check('ada', 'chat', 60_000, detail=True)
print(d['allowed'], d['reason'], d['remaining'])   # False limit 50000.0
```

Policies can also be JSON, TOML, a dict, or [Stof](https://stof.dev) (the default, for functions and rules of your
own). The [tutorial](https://github.com/dev-formata-io/limitr/tree/main/python/tutorial) goes from here in 15 short,
runnable chapters.

## LLM calls: reserve, then settle

A call's size is only known when it's done, and calls run at the same time. Hold room first, then record what the call
really used:

```python
hold = limitr.reserve('ada', 'chat', 4096)         # or leave the value out to hold the predicted size
if not hold:
    return 'out of tokens'
res = client.messages.create(model=model, max_tokens=4096, messages=messages)
limitr.settle('ada', 'chat', hold, res.usage.input_tokens + res.usage.output_tokens,
              {'model': model, 'input': res.usage.input_tokens, 'output': res.usage.output_tokens})
```

## Events and state

```python
limitr.add_handler('billing', lambda name, event: print(name, event))   # objects arrive as dicts

saved = limitr.customers()          # all customer state: store it anywhere
restored = Limitr(policy_source)
restored.load_customers(saved)
```

Event handlers run during the call that sent the event, so don't call the policy from one; queue the work instead.

## Limitr Cloud

The same calls, with the policy, customer state, ledgers, invoices, contracts, and Limitr Analyst managed in
[Limitr Cloud](https://limitr.dev):

```python
import os
from limitr import Limitr

limitr = Limitr.cloud(os.environ['LIMITR_TOKEN'])   # None if Cloud refuses the token (it logs why)

limitr.ensure_customer('ada')       # loaded from Cloud if it has her, else created here
if limitr.allow('ada', 'chat', 1200):
    ...

limitr.close()                      # on shutdown: sends the usage still batched
```

The policy follows what you publish in Cloud, live. A customer the engine hasn't seen is loaded from Cloud the first
time a call needs it, and usage goes back to Cloud over a WebSocket, batched (`batch_ms`, 250 by default). Calls are
refused while the connection is down (`deny_unconnected=True`, the default), and it reconnects on its own.

## Limitr Network

Services that sell to agents, and agents that pay for them, with signed vouchers instead of API keys. A service
publishes its plans and routes from its policy, and serves them with one handler:

```python
network = weather.network(secret_key=os.environ['WEATHER_SECRET_KEY'])
app = network.wsgi(lambda call: {'city': call.query.get('city'), 'forecast': 'sunny'})   # gunicorn, Flask, Django
```

An agent signs a voucher (up to this much, on this plan, until then) and gets the service's routes as tools:

```python
agent = Limitr('policy: {}')
tools = agent.network().connect('https://weather.example', 'agent', 0.03, time.time() * 1000 + 3_600_000)
agent.claude_tools()                                          # pass to Claude as `tools`
agent.run_capability('acme_weather_forecast', {'city': 'Boston'})
```

The [Network tutorial](https://github.com/dev-formata-io/limitr/tree/main/python/tutorial/network) covers metering,
a provider's own tools, operators and budgets, and identity and discovery, and
[`demos/network`](https://github.com/dev-formata-io/limitr/tree/main/python/demos/network) runs a provider and an agent
in two processes. It's the same protocol as the TypeScript SDK's, so either side can be either language.

## Notes

- Every method is one engine call, run one at a time (a lock guards the document), so a single `allow` is safe across
  threads. Use `reserve` and `settle` when concurrent calls must not overspend together.
- Method names match the TypeScript SDK in snake_case (`ensureCustomer` is `ensure_customer`), and options are
  keyword arguments (`allow(customer, entitlement, value, detail=True)`).
- Skills teach your coding agent to use Limitr: `limitr-py` (this SDK), `limitr` (policies, every engine function,
  and every event), `limitr-network`, and `stof`. Install them in your project with
  `npx skills add dev-formata-io/limitr` (needs Node.js; works with Claude Code, Cursor, Codex, and most other
  agents). They're also zips on the [latest release](https://github.com/dev-formata-io/limitr/releases/latest) (for Claude Desktop and
  claude.ai), and in the Limitr plugin for Claude Code (`/plugin marketplace add dev-formata-io/limitr`).

Docs: [limitr.dev](https://limitr.dev). Policy semantics: the [policy reference](https://limitr.dev/docs/reference/policy).
Source: [github.com/dev-formata-io/limitr](https://github.com/dev-formata-io/limitr). Chat:
[Discord](https://discord.gg/AUyAUnxAZJ). Apache 2.0.
