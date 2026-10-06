<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="120" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/White-Transparent-Limitr-ComboMark.svg">
            <source height="120" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
            <img height="120" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
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

## Usage-based billing is more than a meter

Charging for usage starts simple: count API calls, tokens, seats, or storage, and send the totals to your billing
provider. Then pricing grows up:

- plans with different allowances, some that reset daily and some monthly
- limits that should block the call, and others that should allow it and bill the overage
- credit packs, free trials, and custom terms for your biggest customers
- spend caps so nobody gets a surprise invoice, and rate limits that no credit pack can lift
- AI features where every call costs you a different amount, and you need to know your margin before the invoice

The usual answer is a metering API plus a billing provider plus a lot of code in your app that decides what's allowed.
The rules end up spread across services, every check is a network call in the middle of a request, and changing a
price means changing code in several places at once.

## What Limitr does differently

**It runs in your process.** The engine is a small WebAssembly runtime inside your app. Checking a limit and recording
usage takes a millisecond or two, with no network call, no service to run, and nothing to fall over. It works the same
in Node, Bun, Deno, and the browser.

**Pricing is one document.** Plans, limits, credits, prices, costs, caps, and top-ups live in one policy you can read,
review, diff, and commit like any other config, in JSON, YAML, TOML, or [Stof](https://stof.dev). Change the policy and
every check follows it. There's no pricing logic in your code to keep in sync.

**Margin is known on every call.** The policy knows what you charge and what each call costs you, including costs that
change per call, like an AI model priced by input and output tokens. Every event carries both, so margin per call,
customer, and feature is there as it happens.

**Decide before, not after.** Most billing systems count what already happened. Limitr answers before the work runs:
allowed or not, how much room is left, what this call is worth. For AI calls whose size you only know afterwards, it
reserves room up front and learns how big calls usually are.

## Quick start

```bash
npm i @formata/limitr
```

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

The [tutorial](typescript/tutorial) walks through everything else in short, runnable chapters: limits and resets,
hard and soft limits, pricing and margins, AI calls, seats, credit packs, spend caps, and running it in production.

## What you can build with it

- **Any pricing model in one policy:** usage-based, seats, credits, flat plans, or a hybrid, per plan and per feature.
- **AI features that stay profitable:** per-model costs, per-call margins, and spend caps that stop runaway usage.
- **Prepaid credits:** credit packs with expiry, resets, and rollover, spent across features at their own rates.
- **Org-level budgets and seats:** limits and caps shared by every user in a team or org.
- **Rate limits next to paid usage:** protect your infrastructure without touching what customers pay for.
- **Custom deals:** per-customer limits and terms, with expiry, without a new plan for each one.
- **Billing events:** overage, limits hit, thresholds crossed, sent to your code as they happen.

## Open source and Limitr Cloud

The engine in this repo is open source (Apache 2.0) and free to run on your own. You keep the policy in your repo,
save customer state in your database, and bill from the events.

[Limitr Cloud](https://limitr.dev) runs the same engine with the parts around it: versioned policies you can edit and
publish to every running server without a deploy, shared customer state, ledgers and invoicing, and usage, cost, and
margin analytics across your customers. Moving to Cloud is one line (`Limitr.cloud({ token })` instead of
`Limitr.new(policy)`), and every check still runs in your process.

## Why we built it

We kept rewriting the same pricing code: counters, resets, overage, credits, and a new exception for every big
customer. Every price change meant touching the website, the app, and the backend, and getting them to agree. We wanted
pricing to be a document we could read and change, and an engine fast enough to ask before every call. Limitr is
that, built on [Stof](https://stof.dev), a runtime for documents that carry their own logic.

## Learn more

- [Tutorial](typescript/tutorial): runnable chapters, start to finish
- [Limitr skill](skill/limitr): the policy reference, every engine function, and every event, for people and AI coding
  agents (`limitr-ts` for TypeScript is in [typescript/skill](typescript/skill))
- [Docs](https://limitr.dev/spec/welcome) and [limitr.dev](https://limitr.dev)
- [Changelog](CHANGELOG.md)
- [Issues](https://github.com/dev-formata-io/limitr/issues): bugs and feature requests

Have a pricing model you're not sure fits? [Talk with the founders](https://calendly.com/d/ctjd-5gm-qqc/limitr-demo-with-founders).

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
