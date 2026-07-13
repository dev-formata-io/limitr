<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="125" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_white.png">
            <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_black.png">
            <img height="125" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_black.png">
        </picture>
    </a>
    <br>
    <a href="https://limitr.dev"><img src="https://img.shields.io/badge/Limitr-Pricing%20Runtime-purple?logo=gitbook&logoColor=white"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=npm%3A%40formata%2Flimitr&color=darkorange"></a>
    <a href="https://stof.dev"><img src="https://img.shields.io/badge/Stof-Data%20Runtime-darkgreen?logoColor=white"></a>
</h1>

<p align="center">
    <em><b>Limitr</b> is an <b>in-process usage runtime</b> that decides what every <b>user</b> and <b>agent</b> is <b>allowed to do</b>, and what it <b>costs</b>.</em>
</p>

## Quickstart
```bash
npm i @formata/limitr
```

```typescript
// wasm runtime, works anywhere, no system dependencies
import { Limitr } from '@formata/limitr';

// Tell Limitr what users can do, how much they have, and what you charge for it
const policy = await Limitr.new(`policy: {
  credits: {
    claude_sonnet_5: { overhead_cost: 2e-6, price: { amount: 3e-6 } }
  }
  exchange: { euro: { value: 1.14, currency: 'usd' } }
  plans: {
    pro: {
      entitlements: {
        ai_chat: { limit: { credit: 'claude_sonnet_5', value: 10_000, resets: true } }
      }
    }
  }
}}`);

// High-level observability & enforcement caps - credit grants, overages, credit exchanges, etc.
await policy.startMarginMeasurement(userId, 'ai_pipeline', 'euro');

// Enforce usage limits and block calls that you or users don't want to pay for
if (await policy.allow(userId, 'ai_chat', tokens)) {
  callLLM(prompt);
} else {
  alert('Limit hit, purchase more or wait');
}

const { charged, costs, margin } = await policy.captureMarginMeasurement(userId, 'ai_pipeline');
// User charged: €0.03 · Overhead cost: €0.04 · Pipeline Margin: -28.51%
```

### Cloud
> **Limitr Cloud** adds managed policies, alerting, billing & payment integrations, and per-customer/per-feature/per-vendor analytics on top of the same engine. [Learn more →](https://limitr.dev)

```typescript
import { Limitr } from '@formata/limitr';

// Managed & always in-sync - no-code & versioned policy changes without redeploys
// No network calls in any hot paths, just a web socket in the background
const policy = await Limitr.cloud({ token });

// Everything else stays the same
```

## What Limitr Is

Everything that used to live in scattered code, webhooks, and spreadsheets now lives in one place — a policy document that Limitr reads and uses to decide what every user and agent is allowed to do, and what it costs.

Define plans, entitlements, credits, prices, overhead, and governance as a single config. Limitr manages user state, checks, and balances inside a local WebAssembly container.

It's a fast, secure, and maintainable way to ship pricing and packaging for modern software.

## Why It's Different

- **Usage policy as config** — <em>a maintainable config document instead of custom code.</em>
- **Native execution** — <em>executes 100% locally, in-process, event-driven, sandboxed, extensible, & flexible.</em>
- **Hybrid models** — <em>any pricing model, in the same policy without having to choose.</em>
- **Real per-user margins** — <em>maps vendor costs to your prices for margins computed on every request.</em>
- **Credit exchange** — <em>define credit exchanges/rollups for credit burndown models & currency exchanges.</em>

## Where This Came From

[Stof](https://stof.dev) comes out of a decade spent building parametric and geometry formats for CAD and graphics systems.

Limitr started as an internal Stof project while trying to control margins at the pace of AI model development and at the pace we now ship code.

We really wanted a config that was easy to reason about and collaborate on, that when changed, our marketing sites, front-end apps, and backend services all enforce and reflect the new usage limits, packaging, and prices immediately, without redeploys & coordination.

Friends wanted it available to them, and thus it's available to you, too.

## Advanced & Enterprise

Larger orgs, product, finance, sales, and engineering teams have requested a platform beyond embedded enforcement, where they can manage custom dealflow, product agility, and per-customer/vendor margin & analytics.

If this describes you, your org, or your needs, [Limitr Cloud](https://limitr.dev) is for you.

## Learn More

- [Limitr Docs](https://limitr.dev) — install docs, the full spec, references, use-cases, and examples.
- [GitHub Issues](https://github.com/dev-formata-io/limitr/issues) — bugs and feature requests
- [Stof Data Runtime](https://stof.dev) — wasm data runtime at the core of Limitr

## License

Apache 2.0. See LICENSE for details.
