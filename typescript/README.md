<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="125" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_white.png">
            <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_black.png">
            <img height="125" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/limitr_black.png">
        </picture>
    </a>
    <br>
    <a href="https://limitr.dev"><img src="https://img.shields.io/badge/Limitr-Monetization%20Layer-purple?logo=gitbook&logoColor=white"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=npm%3A%40formata%2Flimitr&color=darkorange"></a>
    <a href="https://stof.dev"><img src="https://img.shields.io/badge/Stof-Data%20Runtime-darkgreen?logoColor=white"></a>
</h1>

<p align="center">
    <em><b>Limitr</b> is open-source <b>usage-based billing</b> that runs inside your app: one policy decides what every customer can use, what it costs you, and what you charge, on every call.</em>
</p>

## Install

```bash
npm i @formata/limitr
```

Works in Node, Bun, Deno, and the browser. The engine is WebAssembly with no system dependencies, and every check
runs in your process: no network call, no service to run.

## Quick start

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        ai_token: {
            price: { amount: 0.00002 }      // you charge $20 per million tokens
            overhead_cost: 0.000008         // the model costs you $8 per million
        }
    }
    plans: {
        pro: {
            default: true
            entitlements: {
                export_pdf: {}                                                   // a feature flag
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 1_000_000, resets: true, reset_sch: 'monthly:1' } }
            }
        }
    }
}`);

limitr.addHandler('billing', (name, value) => {
    if (name === 'meter-overage') console.log('bill it:', JSON.parse(value as string).overage_price);
});

await limitr.ensureCustomer(userId);
if (await limitr.allow(userId, 'chat', tokens)) {
    // call the model
}
```

- `allow` checks the customer's plan, limits, budgets, and credits, records the usage when the answer is yes, and
  sends events (`meter-overage` above is the one to bill from).
- The policy can be Stof (above), JSON, YAML, or TOML.
- Create the engine once and keep it: it holds every customer's state in memory, which is why checks are fast. Save
  customers to your database from the events and load them back on startup (`loadCustomers`).

## What's in it

- **Limits:** feature flags, hard limits that deny, soft limits that bill overage, and observe-only limits, with
  daily, monthly, or calendar resets.
- **Pricing and margins:** prices and costs per credit, tiered and volume pricing, currencies, and the margin of every
  call in its events.
- **AI calls:** per-model cost functions in the policy, and `reserve` / `settle` to hold room before a call whose size
  you only know afterwards, with estimates that learn from real usage.
- **Customers:** plans, orgs and their users, seats counted on the org, per-customer overrides, and alternate IDs.
- **Credits and budgets:** credit packs (top-ups) as grants, and spend caps per customer or shared across an org.
- **Rate limits:** a governor on any limit, kept separate from what customers pay for.

## Learn

- [Tutorial](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial): short, runnable chapters
  from your first policy to production.
- **Skills for AI coding agents** ship in this package, in `node_modules/@formata/limitr/skill/`: `limitr` (the
  policy reference, every engine function, and every event) and `limitr-ts` (this API). Point Claude Code or any
  other agent at them.
- [Docs](https://limitr.dev/spec/welcome) and [limitr.dev](https://limitr.dev)

## Limitr Cloud

[Limitr Cloud](https://limitr.dev) runs the same engine with versioned policies you publish without a deploy,
shared customer state, ledgers and invoicing, and usage, cost, and margin analytics.

```ts
const limitr = await Limitr.cloud({ token: process.env.LIMITR_TOKEN! });
// Everything else stays the same. Checks still run in your process; Cloud syncs in the background.
```

A `Limitr.new` policy is fully sandboxed: no network, file, or environment access unless you allow it. A Cloud policy
can only reach Limitr Cloud (`api.limitr.dev`) unless you pass `httpHosts`.

## License

Apache 2.0. See LICENSE for details.
