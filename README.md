<h1 align="center">
    <a href="https://limitr.dev">
        <picture>
            <source height="120" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/White-Transparent-Limitr-ComboMark.svg">
            <source height="120" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
            <img height="120" alt="Limitr" src="https://raw.githubusercontent.com/dev-formata-io/limitr/main/content/Green-Transparent-Limitr-ComboMark.svg">
        </picture>
    </a>
    <br>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img alt="npm" src="https://img.shields.io/npm/v/@formata/limitr?color=darkorange"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img alt="downloads" src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=downloads&color=darkorange"></a>
    <a href="https://github.com/dev-formata-io/limitr/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
    <a href="https://limitr.dev/spec/welcome"><img alt="docs" src="https://img.shields.io/badge/docs-limitr.dev-purple"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img alt="stars" src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
</h1>

<p align="center">
    <b>Usage-based billing, limits, and feature flags that run inside your app.</b>
    <br>
    One policy decides what every customer can use, what it costs you, and what you charge, checked in-process on every call.
</p>

Limitr is an open-source engine for usage-based pricing. It meters usage (API calls, AI tokens, seats, storage,
anything you count), enforces plans and limits, prices every call, and tells your code what to bill. It runs in your
process, in Node, Bun, Deno, or the browser, with no service to run and no network call in the middle of a request.

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

That's a plan with a monthly AI token allowance, overage billed past it, and margin on every call. The
[tutorial](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial) builds on it in 15 short,
runnable chapters.

## Why it's different

Most usage-based billing is a metering API, a billing provider, and a lot of code in your app deciding what's
allowed. The rules spread across services, every check is a network call, and changing a price means changing code
in several places. Limitr works differently:

- **It runs in your process.** The engine is a small WebAssembly runtime inside your app. Checking a limit and
  recording usage happens in-process, with nothing to call and nothing to fall over.
- **Pricing is one document.** Plans, limits, credits, prices, costs, caps, feature rules, and top-ups live in one
  policy you can read, review, diff, and commit, in JSON, YAML, TOML, or [Stof](https://stof.dev). Change the policy
  and every check follows it.
- **Margin is known on every call.** The policy knows what you charge and what each call costs you, even when the
  cost changes per call, like an AI model priced by input and output tokens. Every event carries both.
- **It decides before the work runs.** Allowed or not, how much room is left, what the call is worth. For AI calls
  whose size you only know afterwards, it reserves room up front and predicts how big the call will be.

## What you can build with it

- **Any pricing model in one policy:** usage-based, seats, credits, flat plans, or a hybrid, per plan and per feature.
- **AI features that stay profitable:** per-model costs, per-call margins, usage predicted before the call, and spend
  caps that stop runaway usage.
- **Feature flags and rollouts:** kill switches, percentage rollouts, and rules per call, next to the plans, with
  events to measure them.
- **Custom deals:** give one customer a feature their plan doesn't have, take one away, or change their limits, with
  expiry, without a new plan for each deal.
- **Prepaid credits:** credit packs with expiry, resets, and rollover, spent across features at their own rates.
- **Org-level budgets and seats:** limits and caps shared by every user in a team or org.
- **Rate limits next to paid usage:** protect your infrastructure without touching what customers pay for.
- **Billing events:** overage, limits hit, and thresholds crossed, sent to your code as they happen.

## Made for AI coding agents

The npm package ships three skills in `node_modules/@formata/limitr/skill`: `limitr` (the policy reference, every
engine function, and every event), `limitr-ts` (the TypeScript SDK), and `stof` (the language policies are written
in). Point your coding agent at them and it can write, review, and debug policies and integrations correctly, instead
of guessing. The Limitr skills are also packaged as zips in
[`content/`](https://github.com/dev-formata-io/limitr/tree/main/content) for uploading to an agent.

## Open source and Limitr Cloud

The engine is open source (Apache 2.0) and free to run on your own. You keep the policy in your repo, save customer
state in your database, and bill from the events.

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

- [Tutorial](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial): runnable chapters, start to
  finish
- [Limitr skill](https://github.com/dev-formata-io/limitr/tree/main/skill/limitr): the policy reference, every engine
  function, and every event (`limitr-ts` for TypeScript is in
  [typescript/skill](https://github.com/dev-formata-io/limitr/tree/main/typescript/skill))
- [Docs](https://limitr.dev/spec/welcome) and [limitr.dev](https://limitr.dev)
- [Changelog](https://github.com/dev-formata-io/limitr/blob/main/CHANGELOG.md)
- [Issues](https://github.com/dev-formata-io/limitr/issues): bugs and feature requests

Have a pricing model you're not sure fits? [Talk with the founders](https://calendly.com/d/ctjd-5gm-qqc/limitr-demo-with-founders).

## License

Apache 2.0. See [LICENSE](https://github.com/dev-formata-io/limitr/blob/main/LICENSE) for details.

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
