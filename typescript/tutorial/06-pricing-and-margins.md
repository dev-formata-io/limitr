# 6. Pricing and margins

Each credit can carry two numbers:

- **`price`**: what you charge for one unit.
- **`overhead_cost`**: what one unit costs you (the model provider, the GPU, the storage bill).

Both are in **runes**, Limitr's base currency. One rune is one US dollar unless you say otherwise, and an `exchange`
table converts other currencies (Ex. `exchange: { euro: { value: 1.14, currency: 'usd' } }`).

With both numbers in the policy, every call knows its own margin:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        ai_token: {
            label: 'AI token'
            price: { amount: 0.00002 }     // you charge $20 per million tokens
            overhead_cost: 0.000008        // the model costs you $8 per million
        }
        image: {
            label: 'Image'
            pricing_model: 'tiered'        // cheaper per image as volume grows
            tiers: [
                { up_to: 100, price: { amount: 0.04 } },
                { price: { amount: 0.02 } }
            ]
            overhead_cost: 0.01
        }
    }
    plans: {
        usage: {
            default: true
            entitlements: {
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 0 } }   // nothing included: every token is billed
                images: { limit: { credit: 'image', mode: 'soft', value: 0 } }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

limitr.addHandler('margin', (name, value) => {
    if (name !== 'meter-overage') return;
    const { entitlement, meter } = JSON.parse(value as string);
    const margin = meter.price_diff - meter.overhead_diff;
    console.log(`${entitlement}: charged $${meter.price_diff.toFixed(4)}, cost $${meter.overhead_diff.toFixed(4)}, margin $${margin.toFixed(4)}`);
});

await limitr.allow('ada', 'chat', 12_000);   // a 12k-token conversation
await limitr.allow('ada', 'images', 90);     // 90 images at $0.04
await limitr.allow('ada', 'images', 20);     // 10 more at $0.04, then 10 at $0.02

// The customer's totals this period (margin is a percent).
const snapshot = await limitr.customerMarginSnapshot('ada');
console.log(`revenue $${(snapshot?.get('revenue') as number).toFixed(2)}, cost $${(snapshot?.get('cost') as number).toFixed(2)}, margin ${snapshot?.get('margin')}%`);
```

It prints:

```text
chat: charged $0.2400, cost $0.0960, margin $0.1440
images: charged $3.6000, cost $0.9000, margin $2.7000
images: charged $0.6000, cost $0.2000, margin $0.4000
revenue $4.44, cost $1.20, margin 73.06%
```

- Every meter event carries `meter.price_diff` (what the call is worth at list price) and `meter.overhead_diff` (what
  it cost you). The difference is that call's margin, so you can watch margin per call, per customer, or per feature
  as it happens instead of a month later.
- The usage plan includes nothing (`value: 0`), so every unit is billable. With an allowance, units inside it show
  their cost but no price: the plan's subscription pays for them.
- **Tiers** price billable units by volume. `tiered` charges each unit at the tier it falls in, so the 20-image call
  paid $0.04 for 10 of them (finishing the first 100) and $0.02 for the other 10. `volume` prices all units at the tier the total lands in, and
  `stairstep` charges one flat fee for the tier the total lands in.
- `customerMarginSnapshot` sums revenue, cost, and margin for the customer this period, overall and per entitlement.

Costs aren't always fixed per unit. AI calls cost different amounts depending on the model and how much of the call
was input versus output. The next chapter handles that.

Next: [AI calls: reserve and settle](07-reserve-and-settle.md)
