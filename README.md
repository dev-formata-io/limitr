<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="120" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/White-Transparent-Limitr-ComboMark.svg">
            <source height="120" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
            <img height="120" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
        </picture>
    </a>
    <br>
    <a href="https://limitr.dev"><img src="https://img.shields.io/badge/Limitr-Orchestration%20Layer-purple?logo=gitbook&logoColor=white"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=npm%3A%40formata%2Flimitr&color=darkorange"></a>
    <a href="https://stof.dev"><img src="https://img.shields.io/badge/Stof-Data%20Runtime-darkgreen?logoColor=white"></a>
</h1>

<p align="center">
    <em><b>Limitr</b> is the <b>orchestration layer</b> for usage-based billing: one embedded engine, evaluating one versioned policy document, that <b>prices</b> what a call costs, <b>decides</b> what users are allowed to do, and <b>scores</b> what it means for the account — at runtime.</em>
</p>

## Motivation

A price change touches everything: marketing site, frontend, backend services, all of it. And costs are always changing. To account for unit economics and new product development, pricing changes frequently as a result, especially for anything usage based.

Creating and maintaining the code that sets and enforces access and limits is a bottleneck for shipping features, and gets complex quickly with rules for separate accounts, plans, credit balances, or anything beyond a flat subscription.

We wanted a config document to easily understand and coordinate all things usage and pricing — something we could reason about, version, and commit — to define packaging, prices, credits, token limits, overhead costs, and everything needed to enforce what every user and agent can do, how much usage they get at every moment, and what it costs each of us.

That's how Limitr started. Now, it's a full managed orchestration layer for usage rules, pricing, and packaging. The local engine evaluates one policy document — real logic, never duplicated across code bases or services — self-hosted for free or managed in [Limitr Cloud](https://limitr.dev).

## Pricing & usage rules in a single policy document

Use JSON, YAML, TOML, or Stof. Gets converted to [Stof](https://stof.dev) immediately with rules directly in the document itself. The runtime is wasm, runs in-process, and evaluates all policy checks and metering locally. For Cloud, syncs via background WebSocket connection two-ways.

```json
{
  "policy": {
    "credits": {
      "claude_sonnet_5": { "overhead_cost": 0.000002, "price": { "amount": 0.000003 } }
    },
    "exchange": { "euro": { "value": 1.14, "currency": "usd" } },
    "plans": {
      "pro": {
        "entitlements": {
          "ai_chat": { "limit": { "credit": "claude_sonnet_5", "value": 10000, "resets": true } }
        }
      }
    }
  }

  // Stof adds rules right inside the policy as a first-class datatype.
  // Can override, extend, and otherwise create tooling on top of Limitr for yourself.
  fn helper() -> str { "rules that run safely and travel with the settings" }
}
```

```bash
npm i @formata/limitr
```

The engine runs locally, and is the same for both the open-source and managed solution. Everything is event-driven, all events are emitted locally as well for custom handling without webhooks.

Cloud uses the same events for remote analytics, ledgers, billing, etc., but references the secure remote policy for invoicing and accurate, secure pricing. Customer state is also managed and synced across services.

```typescript
import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(policyString);
// const policy = await Limitr.cloud({ token }); // Cloud setup - everything else is the same

// €15 cap across all calls on overage only
await policy.addCustomerCap(userId, 15, { credit: 'euro', overage_only: true });

// hard limits block outright, soft limits allow overage, observe is meter only
if (await policy.allow(userId, 'ai_chat', tokenQuantity)) {
  llmCall(messages);
} else {
  alert('Limit hit, purchase more or wait');
}
```

## What can Limitr help you do?

- **Ship any pricing model inside one hybrid policy** - usage-based, seat-based, hybrid, credits, trials, rollovers, custom deals, whatever you need per account, vendor, and feature.
- **Attribute every AI agent's usage** - broken down by vendor, feature, contract, or customer.
- **Enforce and bill every API call** - decide whether the call is allowed and bill accordingly.
- **Credit pools & sharing** - credit definitions with exchanges, balance burndown, and overage handling.
- **Custom rates and overrides** - per-customer or per-account rules, pricing, and behavior.
- **Pricing per feature, not the whole model** - move from flat to usage, per-feature, without a deploy.
- **Get alerted when a threshold is crossed** - trial limits, upsell triggers, anomalies, the instant it happens.

## Where open-source ends and Cloud starts

This enforcement engine is the boots-on-the-ground layer for deciding what customers and agents have access to, changing state via metering, and governing costly operations like LLM calls at runtime.

It includes everything for creating and managing customer objects, handling events, defining credits, plans, overrides, etc. And can absolutely be used on its own, open-source and free.

However, it is far from a full billing solution on its own.

Customer state storage, ledgers, account-level billing rules, secure financial-grade invoicing, pushing policy and customer changes to running services, etc. are all outside of the scope of the open-source project, and why we built [Limitr Cloud](https://limitr.dev) when we needed something more robust ourselves.

The versioned, no-code policies with live-editing combined with customer dashboards, analytics, custom enterprise rules, multi-service coordination, collaboration, couponing, alerting, and intelligence for AI policy edits, forecasting, contract creation, etc. really turns this runtime architecture into a real billing infrastructure you can rely on and scale with, each policy and ruleset unique to your needs.

[Happy to chat](https://calendly.com/d/ctjd-5gm-qqc/limitr-demo-with-founders) if this sounds helpful for you and your team.

## Learn More

- [Site](https://limitr.dev) — website with all the marketing speak
- [Docs](https://limitr.dev/spec/welcome) — the real stuff — full spec, references, use-cases, and examples.
- [GitHub](https://github.com/dev-formata-io/limitr) — code, bugs, and feature requests
- [Stof](https://stof.dev) — wasm runtime and format at the core of Limitr — use it wisely for your own projects and learn how to extend Limitr to do all sorts of things (model switching, agent coordination with billing, etc.)

## License

Apache 2.0. See LICENSE for details.

<br/><br/><br/>

<h3 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source width="100%" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/White-Transparent-Limitr-ComboMark.svg">
            <source width="100%" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
            <img width="100%" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
        </picture>
    </a>
</h3>
