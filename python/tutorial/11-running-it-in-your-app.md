# 11. Running it in your app

Three habits make Limitr easy to run in production:

1. **Create the engine once** when your server starts, and keep it. It holds every customer's meters in memory, which
   is why calls are fast. Creating one per request would start every customer from zero.
2. **Gate requests in one place**, like a middleware, so every route asks the same way.
3. **Save customer state** somewhere durable, and load it back when the server starts.

```python
from limitr import Limitr

POLICY = """
policy: {
    credits: { request: { label: 'Request' } }
    plans: {
        free: {
            default: true
            entitlements: {
                api: { limit: { credit: 'request', value: 100, resets: true } }
            }
        }
    }
}
"""

# Stands in for your database.
db = {}


def start_engine():
    """1. Create the engine once, when your server starts, and keep it."""
    policy = Limitr(POLICY)

    # Customer state from your database.
    policy.load_customers(dict(db))

    # Save customers as they change.
    def persist(name, event):
        if name == 'customer-set':
            db[event['id']] = event                           # created or replaced
        elif isinstance(event, dict) and isinstance(event.get('customer'), dict):
            db[event['customer']['id']] = event['customer']   # meter events carry the customer

    policy.add_handler('persist', persist)
    return policy


def handle_request(policy, user_id):
    """2. Gate a request (Ex. inside FastAPI, Flask, or Django middleware)."""
    policy.ensure_customer(user_id)          # created on first sight
    if not policy.allow(user_id, 'api', 1):
        return 429                           # over the limit
    return 200


policy = start_engine()
for _ in range(3):
    handle_request(policy, 'ada')
print('before restart:', policy.value('ada', 'api'))

# A restart: state comes back from the database.
policy = start_engine()
handle_request(policy, 'ada')
print('after restart:', policy.value('ada', 'api'))
```

It prints:

```text
before restart: 3.0
after restart: 4.0
```

- **Saving.** Customer records hold all of a customer's state: meters, grants, caps, and overrides. The handler
  saves them when they change: `customer-set` when a customer is created or its plan, caps, or overrides change, and
  every meter event carries the customer it changed. You can also save everything at once with `policy.customers()`
  on an interval or at shutdown.
- **Loading.** `load_customers` takes a list of records or a dict keyed by ID. `set_customer(record)` loads one.
- **Threads.** Every method is one engine call, run one at a time behind a lock, so one engine is safe to share
  across a web server's threads, and a single `allow` is safe under load. Two calls in a row aren't one unit, which
  is why chapter 7's `reserve` exists. With asyncio, a local engine's calls are quick enough to make directly
  (they never touch the network).
- **More than one server.** Each server keeps its own engine and memory. If several servers share customers, they
  need a shared source of truth for state, which is what Limitr Cloud provides (next chapter).

Next: [Validation and errors](12-validation-and-errors.md)
