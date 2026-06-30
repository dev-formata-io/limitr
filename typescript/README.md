# Limitr

**The pricing runtime for usage-based software.**

Limitr is an embedded runtime for observing, enforcing, pricing, and optimizing usage-based software. Define plans, entitlements, limits, and credits as a single config document; manage them in one place, enforce them everywhere — in-process, no network call on the hot path, powered by WebAssembly.

```bash
npm install @formata/limitr
```

> **Limitr Cloud** adds managed policies, real-time alerting, billing/Stripe integration, and per-customer analytics on top of the same engine. [Learn more →](https://limitr.dev)


## What you can do with it

- **Cap what a feature can cost you** — a hard spend ceiling in real currency, independent of any plan, so a runaway loop or noisy customer can't turn into a five-figure bill.
- **Enforce plans and limits** — seats, tokens, outcomes, storage, API calls; declarative, with resets and per-customer overrides.
- **Let customers own their own limits** — the same enforcement path, just a ceiling they chose, on a settings page.
- **Track margin for free** — Limitr already knows each credit's cost and price, so per-customer profitability falls out without a separate data pipeline.
- **Stay agile** — swap a vendor, add an AI model, or change pricing entirely by updating the policy document at runtime. No code change, no redeploy.


## Who it's for

Limitr is built for teams shipping usage-based or AI-embedded software, where cost and revenue ride on every call. You'll get the most out of it if any of these sound familiar:

- **You ship an AI feature and your margins are unpredictable.** You don't always know in advance which model or vendor a feature will call, and one bad prompt or runaway loop can cost real money before anyone notices.
- **Your pricing changes faster than you can deploy.** New plans, new vendors, new models, experiments — and every change currently means touching application code.
- **You're enforcing limits in scattered, hand-rolled checks.** Seat counts here, token limits there, a Stripe webhook somewhere else, and no single place that knows what a customer is entitled to.
- **You want to know your real per-customer margin** but don't want to build a usage-and-cost data pipeline to get it.

If your pricing is just a flat monthly subscription with no usage component, you probably don't need Limitr yet.


## A few examples

**Cap AI feature/pipeline cost — no matter which vendors it calls into.** A spend cap is a hard ceiling, denominated in real currency, independent of any plan or limit. Set it once, and every call against it — whichever entitlement, vendor, or model — is checked against the same number:

```typescript
// Attach caps to a customer object in the credit of your choice (default USD-backed)
// Can be temporary, observe-only, resetting on a schedule, an absolute max, overage-only, ignore credit grants, etc.
await policy.addCustomerCap('cus_123', 200, {
  cap_id: 'monthly_usd_cap',
  resets: true,
  reset_sch: 'monthly:1'
});

// Allow takes caps, limits, plans, etc. into account and will emit events as needed.
if (await policy.allow('cus_123', 'ai_chat', tokenCount)) {
  callLLM(prompt);
}
```

Caps are evaluated through Limitr's exchange table, so one ceiling — in USD, in credits, in whatever you like — restricts spend across every entitlement that converts to it. Swap vendors or change pricing and the cap still holds; it only cares what a credit converts to, not what it's denominated against.

**Enforce the basics declaratively.** Most of your pricing lives in the policy itself — plans and entitlements you define once:

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

**Let customers set — and own — their own limit.** The same call, just initiated by the customer instead of by you:

```typescript
// Customer dials in their own ceiling from a settings page.
await policy.addCustomerCap('user_789', 50, { cap_id: 'user_custom_cap' });

const cap = await policy.customerCap('user_789', 'user_custom_cap');
// cap.meter_value -> what they've spent this period
// cap.value       -> their current ceiling
```

No separate "customer caps" system to build — it's the same `Cap` type, the same enforcement path.

> **Because every scenario above already tells Limitr what things cost and what you charge, margin tracking falls out for free** — no extra instrumentation:
> ```typescript
> const { revenue, cost, margin } = await policy.customerMarginSnapshot('org_123');
> ```


## How It Works

A Limitr policy is a single document — YAML, JSON, or [Stof](https://stof.dev) — describing your plans, credits, exchange rates, and reset schedules. It runs inside your application via WebAssembly. No remote enforcement API, fast and sandboxed, no network call on the hot path.

**Credits** are the units your pricing is built on — `ai_input_token`, `mb_storage`, `seat`, or an abstract customer-facing `credits` pool. Each credit carries an `overhead_cost` (what it costs you) and a `price` (what you charge), which is what makes margin tracking possible without separate tooling.

**Exchange** defines how credits convert into one another — how an abstract pool drains across several entitlements, and how a USD-denominated cap can restrict spend on a token-denominated entitlement. This is what makes vendor and feature agility cheap: add a credit for a new vendor, and as long as it has an exchange path to the credits you already cap and price against, every existing cap, limit, and margin calculation keeps working. Update the policy document at runtime and customers see the new pricing immediately:

```typescript
const updatedPolicy = await db.getPolicyDocument();
policy = await Limitr.new(updatedPolicy, 'json');
```

**Caps, Limits, and Grants** are independent gates that all apply to the same call — a Limit defines what a plan includes, a Grant extends it, and a Cap restricts it regardless of either. All must pass for a call to be allowed.


## Local vs. Cloud

**Local (open source)** runs entirely inside your app. Sub-millisecond enforcement, no network dependency, works offline.

```typescript
const policy = await Limitr.new(policyDoc);
```

**Cloud (managed)** is the same in-process engine, plus:
- **AI pricing analyst** — agents to help create and iterate on pricing strategy, vendor optimization, and credit modeling
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
