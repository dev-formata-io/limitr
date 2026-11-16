# 12. Validation and errors

Pricing mistakes are expensive, so Limitr checks a policy when it loads and keeps calls predictable after that.

```python
from limitr import Limitr

# Policies can be Stof, JSON, YAML, TOML, or a dict. Here's a dict.
policy = Limitr({
    'policy': {
        'credits': {'request': {'label': 'Request'}},
        'plans': {
            'free': {
                'default': True,
                'entitlements': {'api': {'limit': {'credit': 'request', 'value': 10}}},
            },
        },
    },
})
print('valid:', policy.valid())

# An invalid policy fails when it loads, with a message that says what's wrong.
# Here, a limit counts a credit that doesn't exist.
try:
    Limitr("""
    policy: {
        plans: {
            free: { entitlements: { api: { limit: { credit: 'requests', value: 10 } } } }
        }
    }
    """)
except ValueError as error:
    print('invalid:', error)

# Calls never raise for unknown customers or entitlements: they're denied.
print('unknown customer:', policy.allow('nobody', 'api', 1))
policy.ensure_customer('ada')
print('unknown entitlement:', policy.allow('ada', 'apii', 1))
```

It prints:

```text
valid: (True, '')
invalid: A credit named "requests" does not exist in this policy
unknown customer: False
unknown entitlement: False
```

- **Formats.** `Limitr(policy, format)` takes Stof (the default), JSON (as text, or a dict), YAML, or TOML.
  They all describe the same policy, so you can keep it in whatever your team already uses and check it into git.
- **Validation.** `Limitr(...)` validates by default and raises `ValueError` with a plain message, Ex. a limit naming a credit
  that doesn't exist, or a mode other than hard, soft, or observe. `valid()` returns `(ok, message)` if you want to
  check a policy yourself, Ex. in CI before deploying a pricing change.
- **Calls don't raise.** An unknown customer or entitlement is denied, so a typo can't crash a request. It also
  can't silently allow anything.
- **Sandboxed.** A policy can carry functions (chapter 7), and they run in Stof's sandbox: no network, files, or
  environment variables unless your app explicitly allows them, Ex. `policy.doc.allow_http_hosts(['api.example.com'])`.
- **Time limit.** A call that runs longer than 5 seconds fails instead of blocking every call after it, Ex. a cost
  function stuck in a loop. You'll only see this if a policy function goes wrong. Change it with
  `policy.set_max_execution_time(ms)`, or pass `None` for no limit.

Next: [Going to Cloud](13-going-to-cloud.md)
