# 5. Hard, soft, and observe

What should happen when a customer reaches their limit? It depends on the feature, so each limit has a **mode**:

- **`hard`** (the default) denies the call.
- **`soft`** allows it and reports the part past the limit as **overage**, which you bill.
- **`observe`** never denies. It only records the usage, which is useful for tracking a feature before you price it,
  or for trying a new limit without blocking anyone.

The engine tells you what happened through **events**. Here's the same plan with all three modes, and a handler that
prints the interesting events:

```python
from limitr import Limitr

policy = Limitr("""
policy: {
    credits: {
        // $0.50 per export past the limit
        export: { label: 'Export', price: { amount: 0.50 } }
    }
    plans: {
        pro: {
            default: true
            entitlements: {
                exports_hard: { limit: { credit: 'export', mode: 'hard', value: 2 } }
                exports_soft: { limit: { credit: 'export', mode: 'soft', value: 2 } }
                exports_observe: { limit: { credit: 'export', mode: 'observe', value: 2 } }
            }
        }
    }
}
""")
policy.ensure_customer('ada')


def log(name, event):
    if name == 'meter-overage':
        print(f"  {name}: {event['overage']:g} over, bill ${event['overage_price']:g}")
    if name == 'meter-limit':
        print(f"  {name}: denied at {event['meter']['value']:g} of {event['meter']['limit']:g}")


policy.add_handler('log', log)

for entitlement in ['exports_hard', 'exports_soft', 'exports_observe']:
    print(entitlement)
    for i in range(1, 4):
        print(f'  export {i}:', policy.allow('ada', entitlement, 1))
```

It prints:

```text
exports_hard
  export 1: True
  export 2: True
  meter-limit: denied at 2 of 2
  export 3: False
exports_soft
  export 1: True
  export 2: True
  meter-overage: 1 over, bill $0.5
  export 3: True
exports_observe
  export 1: True
  export 2: True
  export 3: True
```

- The hard limit denies the third export and sends `meter-limit`.
- The soft limit allows it and sends `meter-overage` with how much was over and what to bill (`overage_price`, from
  the credit's price). That's the event to bill from.
- The observe limit allows everything and sends `meter-changed`, like any other recorded usage.

Handlers get every event as a name and its data (objects arrive as dicts). They run during the call that sent them, so
keep handlers quick, and don't call the policy from one: queue the work instead. A handler that raises is logged and
skipped, and an async handler is scheduled on the running event loop. The full list of events and their payloads is
in the [events reference](../../skill/limitr/references/events.md).

Next: [Pricing and margins](06-pricing-and-margins.md)
