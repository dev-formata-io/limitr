# Limitr: Open-Source Monetization Policy
Simple, open-source policy engine for embedded monetization logic, designed for AI, developer tools, and open-source products.

> Limitr answers the question: *"Who is allowed to do what, when, and why?"*.

- Define plans, limits, and entitlements in a simple policy document, not code
- Works offline, embedded, over-the-wire, and self-hosted
- Stripe-agnostic, billing-agnostic
- Inspectable and auditable for everyone
- Evolves independently from product
- Extensible & event-driven (Stripe, Paddle, or custom internal add-ons and adapters)
- Built on [Stof](https://docs.stof.dev) (open-source data + logic runtime)

## Why
Monetization logic is a total pain for developers. It's always changing, usually compiled right into the app which causes issues (even SDKs), rarely easily inspectable/configurable, and gets complex with AI & usage-based apps.

Stripe (or payments system) alone doesn't cut it and vendor lockin with additional SaaS products (and price) is just as messy, meaning you're pretty much on your own for handling monetization.

Limitr is a simple FOSS solution that works anywhere and will take you 5 minutes to get spun up.

## Seat-Based Limits Example (TypeScript)
```typescript
import { Limitr } from 'jsr:@formata/limitr';

// Load a Limitr policy from a DB, string, file, API, etc.
// This is Stof, so you can add additional events, functions, etc. right to it if needed.
const policy = await Limitr.new(`
policy: {
    credits: {
        seat: { description: 'A single seat credit that can be tracked per subject.' }
    }
    plans: {
        free: {
            entitlements: {
                seats: {
                    description: 'Each subject (user, org, etc.) with this plan can have up to this many seats.'
                    limit: {
                        credit: 'seat'
                        value: 1
                        increment: 1
                    }
                }
            }
        }
        paid: {
            entitlements: {
                seats: {
                    description: 'Each subject (user, org, etc.) with this plan can have up to this many seats.'
                    limit: {
                        credit: 'seat'
                        value: 3
                        increment: 1
                    }
                }
            }
        }
    }
}
`);

// Create/save/load subjects (database, Stripe, etc.)
await policy.addSubject('cus_free_customer', 'free');
await policy.addSubject('cus_paid_customer', 'paid');

// Perform entitlement checks, meter usage, etc.
await policy.increment('cus_free_customer', 'seats'); // adds one seat
await policy.increment('cus_paid_customer', 'seats'); // adds one seat

// Add callbacks to the document directly or as a library function
policy.doc.lib('App', 'meter_limit', (json: string) => {
    const record = JSON.parse(json);
    if (record.subject.plan === 'free' && record.entitlement === 'seats') {
        console.log('FREE PLAN SEAT LIMIT HIT, current: ', record.subject.meters.seats.value, ' requested: ', record.invalid_value);
    }
});

// Will return false and send an meter-limit event in the doc (if App.meter_limit exists, it will also be called)
if (await policy.increment('cus_free_customer', 'seats')) throw Error("will not get here");
if (await policy.meter('cus_free_customer', 'seats', 2)) throw Error("cannot request 2 additional seats..");
if (await policy.increment('cus_paid_customer', 'seats')) {
    // paid customer can add a second seat
} else {
    throw Error("will not get here");
}
```
```bash
> deno run --allow-all typescript/examples/seats.ts
FREE PLAN SEAT LIMIT HIT, current:  1  requested:  2
FREE PLAN SEAT LIMIT HIT, current:  1  requested:  3
```
