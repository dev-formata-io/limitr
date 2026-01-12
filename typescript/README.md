# Limitr: Open-Source Monetization Policy
**Limitr is an embedded, open-source policy engine for enforcing plans, limits, and usage in your application.**

It is designed for AI products, developer tools, and open-source software where monetization logic must be:
- inspectable
- portable
- deterministic
- and not hard-coded into application logic

> Limitr answers the question:
> **"What is this customer allowed to consume, right now, and what happens if it exceeds the limit?"**

- 👉 Jump to the [Quick Example](#example-seat-based-plan-enforcement-typescript)
- Additional [info and examples](https://docs.stof.dev/applications/limitr)
- [Limitr Cloud](https://limitr.dev)

## What Limitr Gives You
- Define plans, entitlements, and limits in a policy document — not application code
- Enforce limits locally and offline, embedded directly in your app
- Change limits without redeploying
- Stripe-agnostic and billing-system-agnostic
- Inspectable and auditable by developers and customers
- Event-driven enforcement (usage changes, overages, denials)
- Policy evolves independently from product code
- Built on [Stof](https://docs.stof.dev), an open-source data + logic runtime

## What Limitr Is Not
- Not a billing system
- Not a payment processor
- Not a hosted SaaS requirement
- Not a feature-flag system (outside of entitlements)

Limitr enforces **truth** about usage and limits.
Billing and payments can subscribe to Limitr’s events.

Limitr is designed to integrate cleanly with existing systems, not replace them.

## Why
Most applications implement monetization logic in files like `limits.ts`:
- seat limits
- usage caps
- plan checks
- special cases and overrides

Over time, this logic:
- becomes tightly coupled to the app
- requires redeploys to change pricing
- is hard to audit or explain
- breaks down with usage-based or AI pricing

Payments systems (like Stripe) handle money, but not **enforcement**.

Limitr separates **monetization policy** from application logic, so limits are:
- explicit
- portable
- testable
- and easy to evolve

## Who Limitr Is For
Limitr is a good fit if you are:
- Building an AI or usage-based product
- Implementing seat-based or credit-based pricing
- Shipping developer tools or infrastructure
- Supporting self-hosted or open-source deployments
- Tired of hardcoding pricing logic in application code

## Example: Seat-Based Plan Enforcement (TypeScript [JSR](https://jsr.io/@formata/limitr))
```typescript
import { Limitr } from 'jsr:@formata/limitr';

// Load a Limitr policy from a DB, string, file, API, etc.
// Stof is the default format, but can also be yaml, json, etc.
const policy = await Limitr.new(`
policy:
  credits:
    seat:
      description: 'A single seat credit that can be tracked per customer.'
  plans:
    free:
      entitlements:
        seats:
          description: 'Each customer (user, org, etc.) with this plan can have up to this many seats.'
          limit:
            credit: 'seat'
            value: 1
            increment: 1
    paid:
      entitlements:
        seats:
          description: 'Each customer (user, org, etc.) with this plan can have up to this many seats.'
          limit:
            credit: 'seat'
            value: 3
            increment: 1
`, 'yaml');

// Entitlements define features + limits (gated behaviors) on plans.
// Meters are state stored per customer per entitlement.

// Create/save/load customers (database, Stripe, etc.)
await policy.addCustomer('cus_free_customer', 'free');
await policy.addCustomer('cus_paid_customer', 'paid');

// Perform entitlement checks, meter usage, etc.
await policy.increment('cus_free_customer', 'seats'); // adds one seat
await policy.increment('cus_paid_customer', 'seats'); // adds one seat

// Add callbacks to the document directly or as a library function
policy.doc.lib('App', 'meter_limit', (json: string) => {
    const record = JSON.parse(json);
    if (record.customer.plan === 'free' && record.entitlement === 'seats') {
        console.log('FREE PLAN SEAT LIMIT HIT, current: ', record.customer.meters.seats.value, ' requested: ', record.invalid_value);
    }
});

// Will return false and emit an meter-limit event in the doc (if App.meter_limit exists, it will also be called)
if (await policy.increment('cus_free_customer', 'seats')) throw Error("will not get here");
if (await policy.allow('cus_free_customer', 'seats', 2)) throw Error("cannot request 2 additional seats..");
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

### What's happening here?
- Plans define which entitlements a customer has
- Entitlements define how a meter is allowed to change with limits
- Meters are stored on each customer as state
- Limitr enforces limits and emits events when limits are hit
- The application decides how to respond (deny, warn, bill, notify)

## License
Apache 2.0. See LICENSE for details.

## Contributing
- Open issues or discussions on [GitHub](https://github.com/dev-formata-io/limitr)
- Chat with us on [Discord](https://discord.gg/Up5kxdeXZt)

> Reach out to info@stof.dev to contact us directly
