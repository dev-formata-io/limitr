# 5. Hard, soft, and observe

What should happen when a customer reaches their limit? It depends on the feature, so each limit has a **mode**:

- **`hard`** (the default) denies the call.
- **`soft`** allows it and reports the part past the limit as **overage**, which you bill.
- **`observe`** never denies. It only records the usage, which is useful for tracking a feature before you price it,
  or for trying a new limit without blocking anyone.

The engine tells you what happened through **events**. Here's the same plan with all three modes, and a handler that
prints the interesting events:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        export: { label: 'Export', price: { amount: 0.50 } }   // $0.50 per export past the limit
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
}`);
await limitr.ensureCustomer('ada');

limitr.addHandler('log', (name, value) => {
    const event = JSON.parse(value as string);
    if (name === 'meter-overage') console.log(`  ${name}: ${event.overage} over, bill $${event.overage_price}`);
    if (name === 'meter-limit') console.log(`  ${name}: denied at ${event.meter.value} of ${event.meter.limit}`);
});

for (const entitlement of ['exports_hard', 'exports_soft', 'exports_observe']) {
    console.log(entitlement);
    for (let i = 1; i <= 3; i++) console.log(`  export ${i}:`, await limitr.allow('ada', entitlement, 1));
}
```

It prints:

```text
exports_hard
  export 1: true
  export 2: true
  meter-limit: denied at 2 of 2
  export 3: false
exports_soft
  export 1: true
  export 2: true
  meter-overage: 1 over, bill $0.5
  export 3: true
exports_observe
  export 1: true
  export 2: true
  export 3: true
```

- The hard limit denies the third export and sends `meter-limit`.
- The soft limit allows it and sends `meter-overage` with how much was over and what to bill (`overage_price`, from
  the credit's price). That's the event to bill from.
- The observe limit allows everything and sends `meter-changed`, like any other recorded usage.

Handlers get every event as a name and a JSON string. They run during the call that sent them, and the call doesn't
wait for async handlers, so keep handlers quick and catch their errors. The full list of events and their payloads is
in the [events reference](../../skill/limitr/references/events.md).

Next: [Pricing and margins](06-pricing-and-margins.md)
