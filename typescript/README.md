# Limitr

**The pricing runtime for usage-based software.**

Limitr enforces plans, limits, and spend caps inside your application — no network calls, powered by WebAssembly. Define your pricing as a policy document; Limitr handles the rest.

```bash
npm install @formata/limitr
```

> **Limitr Cloud** adds managed policies, real-time alerting, billing/Stripe integration, and per-customer analytics on top of the same engine. [Learn more →](https://limitr.dev)


## Cap what an AI feature can cost you — no matter which vendor it calls

You don't always know in advance which model, API, or vendor a feature will end up calling — and you don't want a runaway loop, a bad prompt, or a noisy customer to turn into a five-figure bill before anyone notices. A spend cap is a hard ceiling, independent of any plan or limit, denominated in a real currency. Set it once, and every call against it — no matter which entitlement, which vendor, which model — gets checked against that same number:

```typescript
await policy.addCustomerCap('internal-ai-budget', 200, 'internal-ai-cap');

// Check/add any entitlement against the cap/budget.
if (await policy.allow('internal-ai-budget', 'ai_input_token', inputTokenCount)) { /* LLM call allowed */ }
```

That's the whole shape of it: a customer (here, an internal one — not a paying user, just somewhere to hang the budget), a ceiling, an id to find it again. As written, this cap never resets — it's a lifetime $200, not $200/day. The full call gives you control over that, plus conversion and scope:

```typescript
await policy.addCustomerCap(
  'internal-ai-budget', // customer this cap lives on (create one for internal only or per-user/account)
  200,                  // ceiling, in `credit` units
  'internal-ai-cap',    // your own id, for later lookup/reset/removal
  'rune',               // 'rune' = common abstract umbrella, converts via Exchange to USD, etc.
  true, false, false, null,     // exchangeable, ignore_grants, observe_only, scope — defaults
  true, undefined, 'monthly:1', // resets on the 1st of every month
);
```

Caps are evaluated through Limitr's exchange table, so one ceiling — in USD, in credits, in whatever you like — can restrict spend across every entitlement that converts to it. Swap vendors, add a new model, change your pricing entirely: the cap doesn't care what it's denominated against, only what it converts to.

The same mechanism works at every altitude — your infrastructure's budget, a customer's plan, and a customer's own preferences are all just caps with a different owner.

## Give different plan tiers different ceilings — automatically

```typescript
// Enterprise customers get a $500/mo out-of-pocket ceiling, resetting on the 1st.
await policy.addCustomerCap('org_123', 500, 'plan-spend-cap', 'rune',
  null, false, false, null, true, undefined, 'monthly:1');

// Free tier customers get $5 — enough to try real usage, not enough to surprise you.
await policy.addCustomerCap('user_789', 5, 'plan-spend-cap', 'rune',
  null, false, false, null, true, undefined, 'monthly:1');
```

## Let customers set — and own — their own spending limit

The exact same call, just initiated by the customer instead of by you:

```typescript
// Customer dials in their own (USD) ceiling from a settings page.
await policy.addCustomerCap('user_789', 50, 'self-serve-cap');
```

No separate "customer caps" system to build — it's the same `Cap` type, the same enforcement path, just a ceiling someone else chose. Want to let them check status, or relax it themselves?

```typescript
const cap = await policy.customerCap('user_789', 'self-serve-cap');
// cap.meter_value -> what they've spent this period
// cap.value        -> their current ceiling
```

## Enforce the basics: seats, tokens, storage — declaratively

Caps are dynamic and runtime-driven. Most of your pricing, though, lives declaratively in the policy itself — plans and entitlements you define once:

```yaml
plans:
  pro:
    entitlements:
      seats:
        limit: { credit: seat, value: 10 }
      ai_tokens:
        limit: { credit: ai_token, value: 1_000_000, resets: true }
```

```typescript
if (await policy.increment('org_123', 'seats')) {
  await db.addMember(userId, orgId);
} else {
  return { error: 'Seat limit reached. Upgrade your plan or remove a member.' };
}
```

## Cut a custom deal without a re-plan

A specific customer needs a specific number — without touching the plan everyone else is on:

```typescript
await policy.createCustomerOverride('big_logo_inc', 'seats', 500);
```

> **Because every scenario above already tells Limitr what things cost and what you charge, margin tracking falls out for free** — no extra instrumentation, no data pipeline. Limitr knows each credit's `overhead_cost`, each customer's actual usage, and what they were charged, so it can compute a live per-customer margin snapshot:
> ```typescript
> const { revenue, cost, margin } = await policy.customerMarginSnapshot('org_123');
> ```

## Swap vendors, change prices, ship a new model — without a deploy

Because your pricing is a document, not code, changing it doesn't require touching your application. More on this below.


## How It Works

A Limitr policy is a single document — YAML, JSON, or [Stof](https://stof.dev) — describing your plans, credits, exchange rates, and reset schedules. It runs inside your application via WebAssembly. There's no remote enforcement API, and no network call on the hot path.

**Credits** are the units your pricing is built on — `ai_input_token`, `mb_storage`, `seat`, or an abstract customer-facing `credits` pool. Each discrete credit carries an `overhead_cost` (what it costs you) and a `price` (what you charge), which is what makes margin tracking possible without separate tooling.

**Exchange** defines how credits convert into one another — how an abstract credit pool drains across several discrete entitlements, and how a USD-denominated cap can restrict spend on a token-denominated entitlement. This is also what makes vendor and feature agility cheap: swap the model behind a feature, add a new credit for a new vendor, and as long as it has an exchange path to the credits you already cap and price against, every existing cap, limit, and margin calculation keeps working — no code change, no redeploy. Update the policy document at runtime, and customers see the new pricing immediately.

```typescript
const updatedPolicy = await db.getPolicyDocument();
policy = await Limitr.new(updatedPolicy, 'json');
```

Caps, Limits, and Grants are independent gates that all apply to the same call — a Limit defines what a plan includes, a Grant extends it, and a Cap restricts it regardless of either. All must pass for a call to be allowed.


## Local vs. Cloud

**Local (open source)** runs entirely inside your app. Sub-millisecond enforcement, no network dependency, works offline.

```typescript
const policy = await Limitr.new(policyDoc);
```

**Cloud (managed)** is the same in-process engine, plus:
- **AI pricing analyst** — agents to help create & iterate on pricing strategy, vendor optimization, credit modeling, etc.
- **Real-time alerting** — Slack/email notifications when a cap crosses a threshold or a customer nears a limit
- **Billing integration** — Stripe sync, usage-based invoicing, automatic charging
- **Analytics & margin dashboards** — per-customer usage and profitability, without building the pipeline yourself
- **Policy management** — versioned, auditable pricing changes from a dashboard

```typescript
const policy = await Limitr.cloud({ token: 'limitr_...' });
```

[Learn more about Limitr Cloud →](https://limitr.dev)


## Quick Start

```typescript
import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(`{
"policy": {
  "credits": {
    "seat": { "label": "Seat" }
  },
  "plans": {
    "free": {
      "entitlements": {
        "seats": { "limit": { "credit": "seat", "value": 3 } }
      }
    }
  }
}}`, 'json');

await policy.createCustomer('org_123', 'free');
await policy.increment('org_123', 'seats'); // true — 1 of 3 used
```

## Full API & Docs

For the complete enforcement API (`allow`, `check`, `value`, `remaining`, units, notifications, tiered pricing, and the full Cap reference), see:

- [Full Docs](https://docs.limitr.dev)
- [Stof Data Runtime](https://stof.dev)
- [Discord](https://discord.gg/Up5kxdeXZt)

## Contributing

- Issues & PRs: [GitHub](https://github.com/dev-formata-io/limitr)
- Questions: [Discord](https://discord.gg/Up5kxdeXZt)
- Contact: info@limitr.dev

## License

Apache 2.0
