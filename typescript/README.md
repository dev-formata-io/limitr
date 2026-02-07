# Limitr
**Open-source policy engine for plans, limits, and usage enforcement.**

Limitr embeds monetization logic directly in your app. No hard-coded pricing, no redeploys to change limits.

## What It Does
Define pricing in a policy document, not application code:
- **Plans & entitlements** - seat limits, usage caps, feature gates
- **Offline enforcement** - runs locally, no API calls required
- **Event-driven** - react to limit hits, overages, denials
- **Portable** - works anywhere JavaScript runs
- **Inspectable** - customers and auditors can read your limits

## Why Limitr?
Billing systems (Stripe, etc.) handle payments. **Limitr handles enforcement.**

Most apps hardcode limits in `pricing.ts`:
```typescript
if (user.plan === 'free' && user.seats >= 1) {
  throw new Error('Upgrade to add more seats');
}
```

This breaks down with usage-based pricing, AI products, and self-hosted deployments.

**Limitr separates policy from code** so limits are explicit, testable, and easy to evolve.

## Install
```bash
npm install @formata/limitr
```

### Initialization
Limitr uses [Stof](https://docs.stof.dev) for policy enforcement (@formata/stof). This is sandboxed WebAssembly, and needs to be initialized once before use.

> This step is for font-end (browser) apps only. For Node.js, Deno, & Bun, this step is handled automatically by Limitr (you can skip this).

```typescript
// Vite
import { initStof } from '@formata/stof';
import stofWasm from '@formata/stof/wasm?url';
await initStof(stofWasm);

// Browser with bundler - Pass WASM explicitly (e.g. @rollup/plugin-wasm)
import { initStof } from '@formata/stof';
import stofWasm from '@formata/stof/wasm';
await initStof(await stofWasm());

// Node.js, Deno, & Bun - Auto-detects and loads WASM (you can skip this though, Limitr does it)
import { initStof } from '@formata/stof';
await initStof();
```

## Quick Start (Local)
```typescript
import { Limitr } from '@formata/limitr';

// Define policy (YAML, JSON, TOML, STOF) (load from DB, API, file, etc.)
const policy = await Limitr.new(`
policy:
  credits:
    seat:
      description: A single seat in our app.
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

// Create/load customers
await policy.createCustomer('user_123', 'free');
await policy.createCustomer('user_456', 'pro');

// Enforce limits
await policy.increment('user_123', 'seats'); // true - succeeds (1/1 used)
await policy.increment('user_123', 'seats'); // false - fails (limit hit)

await policy.increment('user_456', 'seats'); // true - succeeds (1/10 used)
await policy.allow('user_456', 'seats', 5);  // true - succeeds (6/10 used)
```

## Common Use Cases

**Seat-based plans:**
```typescript
if (await policy.increment('org_123', 'seats')) {
  // Add user to org
}
```

**Usage-based limits:**
```typescript
if (await policy.allow('user_456', 'chat_ai_tokens', 4200)) {
  // allowed: process LLM request
  // usage recorded and synced in the background (*Limitr Cloud)
} else {
  // denied: limit exceeded
}
```

**Feature gates:**
```typescript
const hasAdvancedFeatures = await policy.allow('user_789', 'advanced_analytics');
```

## Local vs Cloud

### Local (Open Source)
```typescript
const policy = await Limitr.new(policyDocument);
```
- Runs entirely in your app
- No external dependencies
- Perfect for self-hosted deployments

### Cloud (Fully Managed w/Stripe + UI)
```typescript
const policy = await Limitr.cloud({
  token: 'limitr_...'
});
```
- Syncs policy and customer data automatically
- Stripe integration built-in (no Stripe dependencies in your app)
- UI included (pricing tables, plan selection, invoices, cancel/resume, etc)
- Dashboard for managing plans and customers
- Analytics & events (payments, revenue, margins)
- Create/change pricing in a couple of minutes without redeploys

[Learn more about Limitr Cloud →](https://limitr.dev)

## Documentation
- 📖 [Full Documentation](https://formata.gitbook.io/limitr)
- 🚀 [Local Quick Start](https://formata.gitbook.io/limitr/local/quick-start)
- ☁️ [Cloud Quick Start](https://formata.gitbook.io/limitr/cloud/quick-start)
- 💬 [Discord Community](https://discord.gg/Up5kxdeXZt)

## Who It's For
- AI products with usage-based pricing
- Developer tools with seat or API limits
- SaaS apps that need flexible pricing
- Open-source projects offering paid tiers
- Anyone tired of hardcoding pricing logic

## Built With [Stof](https://docs.stof.dev)
Limitr policies are written in Stof, a data + logic language that compiles to WebAssembly. This makes policies:
- **Deterministic** - same input always produces same output
- **Portable** - runs in Node.js, browsers, Deno, Bun
- **Auditable** - human-readable policy documents

## License
Apache 2.0 - See [LICENSE](LICENSE)

## Contributing
- Issues & PRs: [GitHub](https://github.com/dev-formata-io/limitr)
- Questions: [Discord](https://discord.gg/Up5kxdeXZt)
- Contact: info@limitr.dev
