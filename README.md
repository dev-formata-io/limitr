<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="120" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/White-Transparent-Limitr-ComboMark.svg">
            <source height="120" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
            <img height="120" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
        </picture>
    </a>
    <br>
    <a href="https://limitr.dev"><img src="https://img.shields.io/badge/Limitr-Usage%20Runtime-purple?logo=gitbook&logoColor=white"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=npm%3A%40formata%2Flimitr&color=darkorange"></a>
    <a href="https://stof.dev"><img src="https://img.shields.io/badge/Stof-Data%20Runtime-darkgreen?logoColor=white"></a>
</h1>

<p align="center">
    <em><b>Limitr</b> is a <b>usage config</b> and <b>enforcement runtime</b> that decides what every <b>user</b> and <b>agent</b> is <b>allowed to do</b>, how much <b>usage they get</b>, and what it <b>costs</b>.</em>
</p>

## Motivation

Vendor costs are always changing, and so is pricing, especially usage based. Creating and maintaining the code that sets and enforces access and limits is a drain on engineering. It's a bottleneck for shipping features, and gets complex quickly with rules for separate accounts, credit burndowns, or anything beyond a flat subscription.

Put plainly, charging and controlling for usage isn't always difficult, but it becomes a real pain quickly, usually after v1 ships and your strategy starts changing.

I wanted a simple config doc to define packaging, prices, credits, token limits, overhead costs, and everytyhing that's needed to make decisions about what every user can do, how much usage they get at every moment, and what it should cost both them and us.

That's how Limitr started. Now, it's a config that contains the enforcement rules themselves, letting you define and control your credits, costs, margins, limits, and ultimately, how profitable your product is.

## Pricing & usage control is just a config

Use JSON, YAML, TOML, or STOF.

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
}
```

```bash
npm i @formata/limitr
```

```typescript
import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(jsonPolicyString);

// €15 cap across all vendors on any non-included usage (overage)
await policy.addCustomerCap(userId, 15, { credit: 'euro', overage_only: true });

// hard limits block outright, soft limits allow overage, observe is meter only
if (await policy.allow(userId, 'ai_chat', tokenQuantity)) {
  llmCall(messages);
} else {
  alert('Limit hit, purchase more or wait');
}
```

## Where does this get used?

The win here is that control code stays the same, but can be set differently per plan, user, agent, account, etc. via a config that is easy to maintain and reason about.

User state is also separate, tidy, and easy to build around (just some JSON for current meter values, etc.).

---

### Seeing usage across vendors, features, and users

The runtime does real-time exchanges, so analyzing spend in USD or in abstract credits across many vendors is built in.

Useful in cases like measuring margin per pipeline run or per outcome, and per user or agent. Most analytics is at a much higher level, like per API key, which doesn't give any sort of granularity.

---

### Enforcing usage

Everything that can be seen can be limited or controlled. Set included amounts (e.g. 5M tokens per month), downgrade LLM models when things get more expensive, put usage governors on meters to limit bursts of usage, enforce USD for an agent session, etc.

---

### Monetize usage

Set prices on the credits you want to charge for (e.g. seats, tokens, GPU seconds, base subscription, etc.). Use [Limitr Cloud](https://limitr.dev) for a fully managed billing solution, hooked up to Stripe, etc. Or, use the local events that the runtime emits to charge for usage yourself.

## Managed Solution

We built [Limitr Cloud](https://limitr.dev) to provide a turn-key solution for usage-based pricing and controls. Policies are versioned, maintained via no-code live-editor, and custom billing rules can be applied to segments of customers however you'd like.

The only thing that changes for the integration, is using `Limitr.cloud({ token })` instead of `Limitr.new(policy)`. Everything else stays the same, so start with the open source version and upgrade when you want billing, AI-native analytics, and per-contract pricing customizations.

## Learn More

- [Docs](https://limitr.dev/spec/welcome) — install docs, the full spec, references, use-cases, and examples.
- [GitHub](https://github.com/dev-formata-io/limitr) — code, bugs, and feature requests
- [Stof](https://stof.dev) — wasm runtime at the core of Limitr

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
