# 10. Seats, top-ups, and spend caps

Three common pieces of B2B pricing, in one plan:

- **Seats** are counted on the org, no matter which user invites someone.
- **Top-ups** are credit packs a customer buys. Each purchase becomes a **grant**: a balance the customer can spend.
- **Spend caps** are budgets: "no more than $25 of overage a month."

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        seat: { label: 'Seat', price: { amount: 12 } }
        image: { label: 'Image', price: { amount: 0.04 } }
    }
    plans: {
        team: {
            default: true
            entitlements: {
                // Seats are counted on the org, whichever user invites someone. 3 included, $12 per extra seat.
                seats: { scope: 'org', limit: { credit: 'seat', mode: 'soft', value: 3 } }
                // No images included: they run on purchased credits.
                images: { limit: { credit: 'image', value: 0 } }
            }
            topups: {
                images_100: { credit: 'image', value: 100, price: { amount: 3 } }
            }
        }
    }
}`);

limitr.addHandler('billing', (name, value) => {
    if (name === 'meter-overage') {
        const event = JSON.parse(value as string);
        console.log(`  bill ${event.customer.id}: ${event.overage} ${event.entitlement} for $${event.overage_price}`);
    }
});

// Seats
await limitr.ensureCustomer('acme', 'team', 'org');
await limitr.ensureCustomer('owner', '', 'user', 'Owner', ['acme']);
for (const person of ['bo', 'cy', 'di']) {
    console.log(`invite ${person}:`, await limitr.increment('owner', 'seats'));
}
console.log('acme seats:', await limitr.value('acme', 'seats'));

// Top-ups and grants
console.log('image before buying:', await limitr.allow('owner', 'images', 1));
await limitr.applyCustomerTopup('owner', 'images_100');              // after your payment provider confirms
console.log('image after buying:', await limitr.allow('owner', 'images', 1));
console.log('images left:', await limitr.remainingCredit('owner', 'image'));

// Spend caps: at most $25 of overage a month for acme, shared by everyone in the org
await limitr.addCustomerCap('acme', 25, { cap_id: 'monthly_overage', overage_only: true, shared: true, resets: true, reset_sch: 'monthly:1' });
for (const person of ['ed', 'fa', 'gu']) {
    console.log(`invite ${person}:`, await limitr.increment('owner', 'seats'));
}
```

It prints:

```text
invite bo: true
invite cy: true
invite di: true
acme seats: 3
image before buying: false
image after buying: true
images left: 99
  bill acme: 1 seats for $12
invite ed: true
  bill acme: 1 seats for $12
invite fa: true
invite gu: false
```

**Seats.** `scope: 'org'` counts the entitlement on the nearest customer of type `org` up the user's refs, so the
owner's invites count against Acme's seats. Three are included, and each extra seat sends `meter-overage` with its
$12 price. Use `increment` when someone joins and `decrement` when they leave.

**Top-ups and grants.** The plan includes no images, so the first image is denied. After the customer pays (your
payment provider handles that part), `applyCustomerTopup` adds 100 images as a grant, and calls run on it until it's
used up. `remainingCredit` shows the balance. Grants can expire, reset, and roll over, and a topup marked `included`
comes with the plan for free.

**Spend caps.** `addCustomerCap` sets a ceiling in dollars (or any currency or credit) across calls. This one only
counts overage, resets monthly, and is `shared`, so it covers every user in the org. The first two extra seats cost
$24, so the third ($36 total) is denied. Caps only ever restrict: they never allow something the limit would deny.

Caps are also how you control your own costs: `{ overhead_cost: true }` caps what a customer can cost *you* instead of
what they spend.

Next: [Running it in your app](11-running-it-in-your-app.md)
