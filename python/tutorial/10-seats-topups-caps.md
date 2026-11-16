# 10. Seats, top-ups, and spend caps

Three common pieces of B2B pricing, in one plan:

- **Seats** are counted on the org, no matter which user invites someone.
- **Top-ups** are credit packs a customer buys. Each purchase becomes a **grant**: a balance the customer can spend.
- **Spend caps** are budgets: "no more than $25 of overage a month."

```python
from limitr import Limitr

policy = Limitr("""
policy: {
    credits: {
        seat: { label: 'Seat', price: { amount: 12 } }
        image: { label: 'Image', price: { amount: 0.04 } }
    }
    plans: {
        team: {
            default: true
            entitlements: {
                // Seats count on the org, whichever user invites someone.
                // 3 included, $12 per extra seat.
                seats: { scope: 'org', limit: { credit: 'seat', mode: 'soft', value: 3 } }
                // No images included: they run on purchased credits.
                images: { limit: { credit: 'image', value: 0 } }
            }
            topups: {
                images_100: { credit: 'image', value: 100, price: { amount: 3 } }
            }
        }
    }
}
""")


def billing(name, event):
    if name == 'meter-overage':
        print(f"  bill {event['customer']['id']}: {event['overage']:g} {event['entitlement']} for ${event['overage_price']:g}")


policy.add_handler('billing', billing)

# Seats
policy.ensure_customer('acme', 'team', 'org')
policy.ensure_customer('owner', '', 'user', 'Owner', ['acme'])
for person in ['bo', 'cy', 'di']:
    print(f'invite {person}:', policy.increment('owner', 'seats'))
print('acme seats:', policy.value('acme', 'seats'))

# Top-ups and grants
print('image before buying:', policy.allow('owner', 'images', 1))
# After your payment provider confirms
policy.apply_customer_topup('owner', 'images_100')
print('image after buying:', policy.allow('owner', 'images', 1))
print('images left:', policy.remaining_credit('owner', 'image'))

# Spend caps: at most $25 of overage a month for acme, shared by everyone in the org
policy.add_customer_cap('acme', 25, cap_id='monthly_overage', overage_only=True, shared=True,
                        resets=True, reset_sch='monthly:1')
for person in ['ed', 'fa', 'gu']:
    print(f'invite {person}:', policy.increment('owner', 'seats'))
```

It prints:

```text
invite bo: True
invite cy: True
invite di: True
acme seats: 3.0
image before buying: False
image after buying: True
images left: 99.0
  bill acme: 1 seats for $12
invite ed: True
  bill acme: 1 seats for $12
invite fa: True
invite gu: False
```

**Seats.** `scope: 'org'` counts the entitlement on the nearest customer of type `org` up the user's refs, so the
owner's invites count against Acme's seats. Three are included, and each extra seat sends `meter-overage` with its
$12 price. Use `increment` when someone joins and `decrement` when they leave.

**Top-ups and grants.** The plan includes no images, so the first image is denied. After the customer pays (your
payment provider handles that part), `apply_customer_topup` adds 100 images as a grant, and calls run on it until it's
used up. `remaining_credit` shows the balance. Grants can expire, reset, and roll over, and a topup marked `included`
comes with the plan for free.

**Spend caps.** `add_customer_cap` sets a ceiling in dollars (or any currency or credit) across calls. This one only
counts overage, resets monthly, and is `shared`, so it covers every user in the org. The first two extra seats cost
$24, so the third ($36 total) is denied. Caps only ever restrict: they never allow something the limit would deny.

Caps are also how you control your own costs: `overhead_cost=True` caps what a customer can cost *you* instead of
what they spend.

Next: [Running it in your app](11-running-it-in-your-app.md)
