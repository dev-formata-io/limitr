# Limitr

**Stop hardcoding your pricing. Treat it like config.**

```typescript
// Before: Pricing logic scattered everywhere
if (user.plan === 'free' && user.seats >= 1) {
  throw new Error('Upgrade to add more seats');
}

// After: One source of truth
if (await policy.increment('user_123', 'seats')) {
  // Add the seat
}
```

Limitr is an open-source pricing engine that moves your limits, quotas, and feature gates out of application code and into a declarative policy document.

Powered by WebAssembly for deterministic, portable enforcement across Node.js, browsers, Deno, and Bun.

## The Problem

Your pricing logic is everywhere:
- Hardcoded in route handlers
- Duplicated across services
- Impossible to change without deploying
- Breaks when product changes the free tier

**Changing "free tier gets 1 seat → 3 seats" shouldn't require a code change.**

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
Update the policy document. That's it.

## Install

```bash
npm install @formata/limitr
```

### Initialization (Browser Only)

Limitr uses [Stof](https://docs.stof.dev) for policy enforcement, which compiles to WebAssembly. Browser apps need to initialize WASM once before use. **Node.js, Deno, and Bun handle this automatically—skip this step.**

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

await policy.increment('user_123', 'seats'); // true (increment -> shorthand for allow(..) with limit's "increment" value)
await policy.increment('user_123', 'seats'); // false (limit hit)
```

## When To Use This

- ✅ You have seat-based, usage-based, or hybrid pricing
- ✅ Your pricing changes more than once a quarter
- ✅ You support self-hosted deployments
- ✅ You're building an AI product with token limits
- ✅ You're tired of pricing logic in 47 different files
- ✅ Easy to adopt incrementally, wrap existing checks with `policy.allow()` one at a time

## Local vs Cloud

### Local (Open Source)
Runs entirely in your app. No external calls. Perfect for self-hosted.

```typescript
const policy = await Limitr.new(policyDoc);
```

### Cloud (Managed + Stripe)
Hosted version with Stripe integration, customer management, dashboard, and analytics.

```typescript
const policy = await Limitr.cloud({
  token: 'limitr_...'
});
```

- Change pricing in minutes without redeploys
- Built-in UI for pricing tables, plan selection, invoices
- Automatic sync with Stripe
- Analytics dashboards

[Learn more about Limitr Cloud →](https://limitr.dev)

## How It's Different

> **Stripe knows:** "User paid for Pro plan"<br/>
> **Limitr enforces:** "User can create 10 seats, use 1M tokens, and export PDFs"

Most apps:
1. Check limits in code → `if (user.plan === 'free')`
2. Take action
3. Send usage to billing system

With Limitr:
1. Check policy → `await policy.allow('user', 'action')`
2. Take action
3. Usage tracked automatically (Cloud) or synced on your schedule (Local)

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
  // Usage recorded, synced in background
}
```

**Feature gating:**
```typescript
const canExport = await policy.allow('user_789', 'pdf_export');
if (!canExport) {
  return { error: 'Upgrade to export PDFs' };
}
```

## Why Policies Are Better Than Code

Update your free tier limit at 3pm on Friday. All users see the new limit and it's enforced instantly. No deploy, no invalidation, no coordination.

**Code:**
- Scattered across files
- Requires deploys to change
- Hard to audit
- Breaks with typos

**Policy:**
- Single source of truth
- Change without deploying
- Human-readable by customers and auditors
- Type-safe (compiled to WebAssembly)

## Tech Details

- Written in [Stof](https://docs.stof.dev) (compiles to WebAssembly)
- Microsecond enforcement (no network calls)
- Runs in Node.js, browsers, Deno, Bun
- Deterministic (same input = same output)
- No external dependencies for local mode
- Offline-first (no API calls required)

## Documentation

- 📖 [Full Docs](https://formata.gitbook.io/limitr)
- 🚀 [Local Quick Start](https://formata.gitbook.io/limitr/local/quick-start)
- ☁️ [Cloud Quick Start](https://formata.gitbook.io/limitr/cloud/quick-start)
- 💬 [Discord](https://discord.gg/Up5kxdeXZt)

## Contributing

Issues & PRs: [GitHub](https://github.com/dev-formata-io/limitr)  
Questions: [Discord](https://discord.gg/Up5kxdeXZt)  
Contact: info@limitr.dev

## License

Apache 2.0
