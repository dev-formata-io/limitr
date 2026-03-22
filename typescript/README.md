# Limitr

**Pricing infrastructure for AI and usage-based software.**

```typescript
// Before: Pricing logic scattered across your codebase
if (user.plan === 'free' && user.seats >= 1) {
  throw new Error('Upgrade to add more seats');
}

// After: One source of truth, enforced in microseconds
if (await policy.increment('user_123', 'seats')) {
  // Add the seat
}
```

Limitr is an open-source pricing engine that moves your limits, quotas, and feature gates out of application code and into a declarative policy document. Define pricing once, enforce it everywhere, change it without redeploying.

Powered by [Stof](https://stof.dev) and WebAssembly for deterministic, portable, sub-millisecond enforcement across Node.js, browsers, Deno, and Bun.

> **Limitr Cloud** adds managed policies, per-customer analytics, Stripe integration, and **Limitr Network** — where agent-powered services discover and consume each other dynamically with a single auth mechanism, automatic revenue sharing, and built-in billing. [Learn more →](https://limitr.dev)

## The Problem

Your pricing logic is everywhere: hardcoded in route handlers, duplicated across services, impossible to change without deploying, and breaks when product changes the free tier.

Meanwhile, you're flying blind on margins. You can see aggregate cost graphs, but you can't tell which customers are profitable and which are burning money — especially with AI workloads where one customer can cost five times what the next one does.

**Changing "free tier gets 1 seat → 3 seats" shouldn't require a code change. Knowing which customers are profitable shouldn't require a data team.**

## How It Works

**1. Define your pricing once**
```yaml
policy:
  credits:
    seat:
      label: Seat
  plans:
    free:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 1
    pro:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 10
```

**2. Enforce everywhere**
```typescript
const policy = await Limitr.new(policyDoc);

// Seat limits
await policy.allow('user_123', 'seats', 1);

// Usage limits
await policy.allow('user_456', 'ai_tokens', 4200);

// Feature gates
await policy.allow('user_789', 'advanced_analytics');
```

**3. Change pricing without redeploying**

Update the policy document. That's it. All users see the new limits instantly.

## Install

```bash
npm install @formata/limitr
```

### Initialization (Browser Only)

Limitr uses [Stof](https://docs.stof.dev) for policy enforcement, which compiles to WebAssembly. Browser apps need to initialize WASM once before use. **Node.js, Deno, and Bun handle this automatically — skip this step.**

```typescript
// Vite
import { initStof } from '@formata/stof';
import stofWasm from '@formata/stof/wasm?url';
await initStof(stofWasm);

// Other bundlers (with WASM plugin)
import { initStof } from '@formata/stof';
import stofWasm from '@formata/stof/wasm';
await initStof(await stofWasm());
```

## Quick Start

```typescript
import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(`
policy:
  credits:
    seat:
      label: Seat
  plans:
    free:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 1
            increment: 1
    pro:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 10
            increment: 1
`, 'yaml');

await policy.createCustomer('user_123', 'free');

await policy.increment('user_123', 'seats'); // true
await policy.increment('user_123', 'seats'); // false (limit hit)
```

## When To Use This

- You have seat-based, usage-based, or hybrid pricing
- You're building AI features with token or compute limits
- Your pricing changes more than once a quarter
- You need per-customer usage visibility and margin tracking
- You support self-hosted deployments
- You want to adopt incrementally — wrap existing checks with `policy.allow()` one at a time

## Real-World Examples

**Seat-based SaaS:**
```typescript
if (await policy.increment('org_123', 'seats')) {
  await db.addUserToOrg(userId, orgId);
}
```

**AI product with token limits:**
```typescript
if (await policy.allow('user_456', 'tokens', estimatedTokens)) {
  const response = await callLLM(prompt);
}
```

**Resources with units (time, memory, etc.):**
```typescript
if (await policy.allow('user_234', 'file-storage', size + 'MiB')) {
  const response = await fileUpload(file);
}
```

**Feature gating:**
```typescript
const canExport = await policy.allow('user_789', 'pdf_export');
if (!canExport) {
  return { error: 'Upgrade to export PDFs' };
}
```

## Local vs Cloud

### Local (Open Source)

Runs entirely in your app. No external calls. Sub-millisecond enforcement. Perfect for self-hosted deployments and getting started.

```typescript
const policy = await Limitr.new(policyDoc);
```

### Cloud (Managed)

Everything in Local, plus a managed platform for teams that need visibility, Stripe integration, and network capabilities.

```typescript
const policy = await Limitr.cloud({
  token: 'limitr_...'
});
```

- **Analytics & margin tracking** — per-customer usage, COGS visibility, and margin dashboards so you know which customers are profitable
- **Stripe integration** — automatic sync, pricing tables, plan selection, and invoicing
- **Policy management** — change pricing in minutes from a dashboard, no redeploys
- **Limitr Network** — list your services for other Limitr-powered products to discover and consume dynamically, with automatic revenue sharing and built-in billing

[Learn more about Limitr Cloud →](https://limitr.dev)

## How It's Different

Every competitor in the usage-based billing space — Metronome, Orb, Schematic — runs a centralized remote API. Every enforcement check is a network call. One rules engine serves all customers. When your billing logic gets complex enough to need its own rules, you outgrow the platform.

Limitr is architecturally different:

- **Local enforcement** — policies run inside your app via WebAssembly. No network calls. Microsecond response times.
- **Isolated per customer** — each customer's policy is a self-contained document. One customer's complexity never impacts another.
- **Runtime extensible** — policies evolve without redeployment. Update a policy document and enforcement changes instantly.
- **Inter-service billing** — Limitr Network lets any Limitr-powered service bill another with no API keys to exchange and automated payouts. Built for a world where AI agents are consuming services on behalf of users.

> **Stripe knows:** "User paid for Pro plan"
> **Limitr enforces:** "User can create 10 seats, use 1M tokens, and export PDFs — and here's exactly what it's costing you per customer."

## Tech Details

- Policy engine built on [Stof](https://stof.dev), an open-source data runtime
- Compiled to WebAssembly for portable, sandboxed execution
- Sub-millisecond enforcement with no network calls
- Runs in Node.js, browsers, Deno, Bun
- Deterministic — same input, same output
- No external dependencies for local mode
- Offline-first

## Documentation

- [Full Docs](https://formata.gitbook.io/limitr)
- [Local Quick Start](https://formata.gitbook.io/limitr/local/quick-start)
- [Cloud Quick Start](https://formata.gitbook.io/limitr/cloud/quick-start)
- [Discord](https://discord.gg/Up5kxdeXZt)

## Contributing

Issues & PRs: [GitHub](https://github.com/dev-formata-io/limitr)
Questions: [Discord](https://discord.gg/Up5kxdeXZt)
Contact: info@limitr.dev

## License

Apache 2.0
