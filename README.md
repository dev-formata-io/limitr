# Limitr

**Pricing infrastructure for usage-based software.**

```typescript
// Enforce a limit
if (await policy.increment('org_123', 'seats')) {
  await db.addMember(userId, orgId);
}

// Track AI usage against a monthly allowance
if (await policy.allow('user_456', 'ai_tokens', estimatedTokens)) {
  const response = await callLLM(prompt);
}

// Gate a feature
const canExport = await policy.check('user_789', 'pdf_export');
```

Limitr is an open-source pricing engine. You define your plans, credits, and entitlements in a single policy document. Limitr enforces them — limits, resets, overages, grants, margin tracking — in your app, without network calls, powered by WebAssembly.

> **Limitr Cloud** adds managed policies, per-customer analytics, Stripe integration, and **Limitr Network** — a billing layer for services that need to discover, consume, and bill each other automatically. [Learn more →](https://limitr.dev)

---

## The Problem

Usage-based pricing sounds simple until you're maintaining it. Seat checks in route handlers. Token limits scattered across three services. A free tier that required four PRs to change from one seat to three. A "monthly reset" that resets on different days depending on which engineer wrote that part of the code.

It compounds over time. Product wants to run a trial. Engineering has to build it. Product wants to add a credit pack. Engineering has to build that too. Every pricing change is a deployment. Every deployment is a risk.

And when something does go wrong — or when you just want to know which customers are profitable — you have no visibility. You can see aggregate cost graphs, but not per-customer margin. With AI workloads especially, one customer can cost five times what another does. You won't know until you look for it, and looking for it requires work.

**Changing a free tier limit shouldn't require a code change. Knowing whether a customer is profitable shouldn't require a data team.**

---

## How It Works

A Limitr policy is a document — written in YAML, JSON, or [Stof](https://stof.dev) — that describes your entire pricing structure: plans, entitlements, credits, exchange rates, reset schedules, and overage behavior. The policy runs inside your application via WebAssembly. There's no remote enforcement API.

### Credits

Credits are the units your pricing is built on. Limitr is unit-aware, so use real units like `seconds` or `MiB` and let Limitr handle conversion & aggregation. There are two general kinds of credit:

**Discrete credits** map directly to something real: a seat, a megabyte, an API call, an AI token, a GPU second. You define their cost (`overhead_cost`) and their price to the customer, and Limitr can compute margins from that.

**Abstract credits** are an optional layer on top. They let you expose a simpler, customer-facing unit (like "credits" or "tokens") that maps to discrete credits through an exchange table. This is useful when you want customers to buy a bundle without exposing the underlying per-token or per-MB pricing — or when you want a single pool of credit to drain across multiple discrete entitlements.

```yaml
credits:
  # Discrete: maps to something real, priced per unit
  ai_input_token:
    overhead_cost: 0.000004    # what it costs you
    price: { amount: 0.000006 } # what you charge
    resets: true

  ai_output_token:
    overhead_cost: 0.000015
    price: { amount: 0.00003 }
    resets: true

  mb_storage:
    overhead_cost: 0.00002
    stof_units: MB
    price: { amount: 0.00003 }

  # Abstract: customer-facing credits that drain into real ones
  ai_credits:
    description: 'AI Credits'
```

### Exchange

The exchange table defines how credits convert into one another. This is what allows a pool of abstract credits to drain across multiple discrete entitlements — and what helps power Limitr's margin tracking.

```yaml
exchange:
  rune: { value: 1, currency: usd }
  abstract: { value: 1, currency: rune } # customer-facing abstract credit

  ai_credit:   { value: 1.25, currency: abstract }  # 1 ai_credit = 1.25 usd
  ai_input_token:  { value: 0.000006, currency: ai_credit }
  ai_output_token: { value: 0.00003,  currency: ai_credit }

  mb_storage:      { value: 0.00003,  currency: abstract }
```

With this, Limitr can tell you: 10 abstract AI credits gives a customer ~1.3M input tokens, ~267k output tokens, or ~333k MB of storage — or some mix of all three, drawn from the same pool.

### Plans and Entitlements

Plans define what each customer tier gets. Entitlements should use discrete credits — this is what makes limit enforcement accurate and margin tracking meaningful.

```yaml
plans:
  base:
    entitlements:
      ai_input:
        limit:
          credit: ai_input_token
          mode: hard     # blocks at limit value
          value: 100_000
          resets: true

      ai_output:
        limit:
          credit: ai_output_token
          mode: hard
          value: 0       # limit comes from grants/topups
          resets: true

      file_storage:
        limit:
          credit: mb_storage
          mode: soft     # allows overage, fires an event
          value: 50      # grants consumed before overage emitted

    topups:
      monthly_included:
        credit: abstract # abstract — converts to discrete via exchange
        value: 10
        price: { amount: 10 }
        resets: true     # resets monthly (default)
        included: true   # included automatically in plan
```

**Limit modes:**
- `hard` — blocks usage at the limit (allows overage with credit grants only)
- `soft` — allows overage, fires `meter-overage` events your code can handle (useful for billing overages)
- `observe` — no limit, just meters usage

### Resets

Any credit or entitlement limit can reset on a schedule. You define the interval; Limitr handles the math.

```yaml
tokens:
  limit:
    credit: ai_token
    value: 100_000
    resets: true
    reset_inc: 1day   # 100k tokens per day, automatically reset
```

Works with stof time units: `30days`, `1hr`, `5min` (not calendar-aware by default).

### Tiered Pricing

Credits support tiered pricing models out of the box.

```yaml
mb_storage:
  pricing_model: tiered
  tiers:
    - { up_to: 5,  price: { amount: 0.80 } }
    - { up_to: 10, price: { amount: 0.70 } }
    - { up_to: 50, price: { amount: 0.60 } }
    - {            price: { amount: 0.55 } }  # everything beyond
```

Limitr sorts and validates tiers at policy load time.

### Per-Customer Overrides and Org Scopes

You can override any entitlement limit for a specific customer without changing the plan:

```typescript
policy.createCustomerOverride('enterprise_org', 'seats', { value: 500 });
```

Entitlements can also be scoped to an organization, so members of the same org share a limit:

```yaml
seats:
  scope: org
  limit:
    credit: seat
    value: 10
```

Any member of `enterprise_org` incrementing `seats` draws from the same pool.

### Notifications

Define rules for when Limitr should notify you — when a customer crosses a threshold, hits half their limit, or triggers any condition you care about:

> Real-time alerting is a core functionality of [Limitr Cloud](https://limitr.dev).

```typescript
// In the Stof policy:
notifications: {
  'half-seats': {
    fn matches(type: str, event: obj) -> bool {
      type == 'meter-change' &&
      event.entitlement === 'seats' &&
      event.remaining < event.meter.limit / 2
    }
    fn fire(event: obj) { ?App.sendEmail(event.customer.id, 'half-seats-warning'); }
  }
}
```

---

## Install

```bash
npm install @formata/limitr
```

### Browser Initialization (Node.js, Deno, Bun: skip this)

```typescript
import { initStof } from '@formata/stof';
import stofWasm from '@formata/stof/wasm?url';
await initStof(stofWasm);
```

---

## Quick Start

```typescript
import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(`{
"policy": {
  "credits": {
    "seat": { "label": "Seat" },
    "mb_storage": { "label": "MB Storage", "stof_units": "MB" }
  },

  "plans": {
    "free": {
      "entitlements": {
        "seats": {
          "limit": { "credit": "seat", "value": 3 }
        },
        "storage": {
          "limit": { "credit": "mb_storage", "value": "3GB" }
        }
      }
    },

    "pro": {
      "entitlements": {
        "seats": {
          "limit": { "credit": "seat", "value": 10 }
        },
        "storage": {
          "limit": { "credit": "mb_storage", "value": "1TiB" }
        }
      }
    }
  }
}}`, 'json');

await policy.createCustomer('org_123', 'free');

await policy.increment('org_123', 'seats'); // true  — 1 of 3 used
await policy.increment('org_123', 'seats'); // true  — 2 of 3 used
await policy.increment('org_123', 'seats'); // true  — 3 of 3 used
await policy.increment('org_123', 'seats'); // false — limit hit
```

---

## The Enforcement API

Limitr exposes a deliberate API surface that will have you covered in even the most complex usage-based applications:

```typescript
// allow — consume `amount` if within limit. Returns true/false.
await policy.allow('user_123', 'ai_tokens', 4200);

// increment — consume (allow) the credit's increment amount (usually 1). Returns true/false.
await policy.increment('user_123', 'seats');

// decrement — release (-allow) one increment. Returns true/false.
await policy.decrement('user_123', 'seats');

// check — read-only. Would this be allowed? Does not consume. Returns true/false.
await policy.check('user_123', 'ai_tokens', 4200);

// value — how much has been used?
await policy.value('user_123', 'ai_tokens');         // raw
await policy.value('user_123', 'ai_tokens', true);   // as percent of limit

// remaining — how much is left (includes credit grants)?
await policy.remaining('user_123', 'ai_tokens');

// limit — what is the current enforced limit for this customer?
await policy.limit('user_123', 'seats');

// entire customer object with meters, grants, etc. (helpful for driving UI)
const customer = await policy.customer('user_123');

// entire policy document at once as JSON, YAML, etc.
const policyJson = policy.doc.stringify('json');
```

Units are respected throughout. If you defined `mb_storage` with `stof_units: MB`, you can pass `500MB`, `1GB`, or `'2000000bytes'` — Limitr converts.

---

## Real-World Examples

**Seat-based SaaS with org scope:**
```typescript
if (await policy.increment('org_123', 'seats')) {
  await db.addMember(userId, orgId);
} else {
  return { error: 'Seat limit reached. Upgrade your plan or remove a member.' };
}
```

**AI product with token burndown/billing:**
```typescript
if (await policy.allow('user_456', 'ai_tokens_hard_stop', estimatedTokens)) {
  const response = await callLLM(prompt);
  
  // track/bill actual usage after
  await policy.allow('user_456', 'ai_tokens_soft_input', actualInTokens);
  await policy.allow('user_456', 'ai_tokens_soft_output', actualOutTokens);
}
```

**Storage with unit conversion:**
```typescript
if (await policy.allow('user_234', 'file_storage', `${fileSize}bytes`)) {
  await uploadFile(file);
}
```

**Feature gate:**
```typescript
// allow is fine too, entitlements without limits are exists/doesnt checks
const canExport = await policy.check('user_789', 'pdf_export');
if (!canExport) return { error: 'Upgrade to export PDFs' };
```

**Topup / credit grant:**
```typescript
// apply a one-time or recurring credit grant to a customer
// optionally charge for these, or include them automatically in plan
await policy.applyCustomerTopup('user_123', 'ai_credits_pack');
```

**Soft-limit overage (track but don't block):**
```typescript
// In your app, handle overage events:
policy.addHandler('handler', (key: string, event: unknown) => {
  if (key === 'meter-overage') {
    db.recordOverage(event.customer.id, event.entitlement, event.overage);
    billing.queueCharge(event.customer.id, event.overage);
  }
});
```

---

## Margin Tracking

Because Limitr knows your credits' `overhead_cost`, their prices, and exactly how much each customer has used, it can compute per-customer "snapshot" margins without any external tooling.

```typescript
const breakdown = await policy.customerMarginSnapshot('user_123');

// {
//   revenue: 87.20,   — what you charged (plan + usage)
//   cost:    38.30,   — what it cost you (overhead_cost * usage)
//   margin:  48.90    — revenue - cost
// }
```

You can also model margins before any customer exists — useful for pricing decisions and calculators:

```typescript
const projected = await policy.localMarginBreakdown('pro', {
  subscription: 1,
  file_storage: '70MB',
  tokens: { meter: 100_000, limit: 100_000 }
});
```

This works because entitlements are in discrete credits with real unit costs attached. The more accurately you define your `overhead_cost` values, the more accurate your margin numbers are.

---

## Updating Pricing Without Redeploying

Because the policy is a document — not code — you can update it at runtime. Load the new version from your database or config system and reinitialize:

```typescript
const updatedPolicy = await db.getPolicyDocument();
policy = await Limitr.new(updatedPolicy, 'json');
```

> For fully managed, versioned, & turn-key, use [Limitr Cloud](https://limitr.dev) - All customers see the new limits immediately. No redeploy. No coordination.

---

## Local vs Cloud

### Local (Open Source)

Runs entirely inside your app via WebAssembly. No network calls. Sub-millisecond enforcement. Works offline. Ideal for self-hosted deployments and getting started.

```typescript
const policy = await Limitr.new(policyDoc);
```

### Cloud (Managed)

Same enforcement, plus a managed platform:

```typescript
const policy = await Limitr.cloud({ token: 'limitr_...' });
```

- **Analytics and margin dashboards** — per-customer usage and COGS visibility without building the data pipeline yourself
- **Stripe integration** — plan sync, pricing tables, usage-based invoicing
- **Real-time alterting** — send emails or Slack notifications when custom conditions are met
- **Invoicing & Usage Reporting** — accurate usage invoicing for billing & reporting created automatically
- **Policy management** — update pricing from a dashboard, versioned, auditable, no redeploys required

[Learn more about Limitr Cloud →](https://limitr.dev)

---

## How It's Different

Every major usage-based billing platform — Metronome, Orb, Schematic — runs enforcement through a remote API. Every `allow()` is a network call. Latency is the floor, and your enforcement logic lives in someone else's system.

Limitr is different:

- **Runs inside your app.** Policies execute in WebAssembly, colocated with your application. Enforcement is microseconds, not milliseconds. No network dependency.
- **Isolated per deployment.** Each instance of your policy is self-contained. No shared state with other customers or other teams.
- **The policy is a document.** You can version it, ship it with self-hosted deployments, load it from a database, or send it over the wire.
- **Margin-aware by design.** Because Limitr knows your costs and your prices, it can tell you which customers are profitable. Most billing systems only know what was charged.

> Stripe knows: "User paid for Pro."  
> Limitr knows: "User can create 10 seats, use 1M tokens, export PDFs — and here's what that's costing you, per customer, in real time."

---

## Tech Details

- Policy engine built on [Stof](https://stof.dev), an open-source data runtime
- Rust compiled to WebAssembly — sandboxed, portable, deterministic
- Sub-millisecond enforcement with no external calls
- Runs in Node.js, Deno, Bun, and browsers
- Same input always produces the same output
- No external dependencies in local mode
- Offline-capable

---

## Documentation

- [Full Docs](https://formata.gitbook.io/limitr)
- [Stof Open-Source Runtime](https://stof.dev)
- [Discord](https://discord.gg/Up5kxdeXZt)

---

## Contributing

Issues & PRs: [GitHub](https://github.com/dev-formata-io/limitr)  
Questions: [Discord](https://discord.gg/Up5kxdeXZt)  
Contact: info@limitr.dev

## License

Apache 2.0
