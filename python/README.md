# Limitr for Python

Usage and margin control for AI products: limits, credits, and billing decided inside your app. Limitr is an
open-source engine that runs in-process and decides every call for each customer: what they can do, what it costs
you, and what to bill. Plans, credits, limits, costs, and contract terms live in one policy, so changing pricing is a
policy change, not a migration.

```
pip install limitr
```

## Quick start

```python
from limitr import Limitr

policy = Limitr("""
policy: {
    credits: {
        request: { label: 'Request' }
        ai_token: { label: 'AI token', price: { amount: 0.00002 } }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                api: { limit: { credit: 'request', mode: 'hard', value: 1000, resets: true } }
                chat: { limit: { credit: 'ai_token', mode: 'hard', value: 100_000, resets: true } }
            }
        }
    }
}
""")

policy.ensure_customer('ada')

if policy.allow('ada', 'api', 1):          # decide and count
    ...

d = policy.check('ada', 'api', 5000, detail=True)
if not d['allowed']:
    print(d['reason'], d['remaining'], d['resets'])   # Ex. 'limit' 999 1796083200000
```

Policies can also be YAML, JSON, or TOML (`Limitr(text, 'yaml')`) or a dict.

## LLM calls: reserve, then settle

A call's size is only known when it's done, and calls run at the same time. Hold room first, then record what the call
really used:

```python
hold = policy.reserve('ada', 'chat', 4096)         # or leave the value out to hold the predicted size
if not hold:
    return 'out of tokens'
res = client.messages.create(model=model, max_tokens=4096, messages=messages)
policy.settle('ada', 'chat', hold, res.usage.input_tokens + res.usage.output_tokens,
              {'model': model, 'input': res.usage.input_tokens, 'output': res.usage.output_tokens})
```

## Events and state

```python
policy.add_handler('billing', lambda name, event: print(name, event))   # objects arrive as dicts

saved = policy.customers()          # all customer state: store it anywhere
restored = Limitr(policy_source)
restored.load_customers(saved)
```

Event handlers run during the call that sent the event, so don't call the policy from one; queue the work instead.

## Notes

- Every method is one engine call, run one at a time (a lock guards the document), so a single `allow` is safe across
  threads. Use `reserve` and `settle` when concurrent calls must not overspend together.
- Method names match the TypeScript SDK in snake_case (`ensureCustomer` is `ensure_customer`), and options are
  keyword arguments (`allow(customer, entitlement, value, detail=True)`).
- This release is the engine. Limitr Cloud (live policy changes, ledgers, invoices, Limitr Analyst) comes next.

Docs: [limitr.dev](https://limitr.dev). Policy semantics: the [policy reference](https://limitr.dev/docs/reference/policy).
Source: [github.com/dev-formata-io/limitr](https://github.com/dev-formata-io/limitr). Apache 2.0.
