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
    <a href="https://limitr.dev/docs/introduction"><img alt="docs" src="https://img.shields.io/badge/docs-limitr.dev-purple"></a>
    <a href="https://github.com/dev-formata-io/limitr"><img alt="stars" src="https://img.shields.io/github/stars/dev-formata-io/limitr"></a>
</h1>

<p align="center">
    <b>Usage-based billing, limits, and feature flags that run inside your app, and belong to you like the rest of your code.</b>
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

Pricing is part of your product. Every business has its own units, costs, and deals, and a billing service outside
your app can only bend so far. That's why so many teams end up building it themselves.

Limitr gives you that control without the build. The engine is yours, like your code:

- **Inside your app.** Every check runs in your process, with no network call.
- **Shaped to your business.** Plans, prices, costs, limits, and every customer's deal in one policy document.
- **Extends like code.** Your own pricing functions, feature conditions, rules, and tools run in the policy, written
  in [Stof](https://stof.dev).
- **Margin on every call.** Every call is checked before the work runs, and priced at what you charge and what it
  costs you.

With Limitr Cloud or without it, it's the same engine, and it's still yours.

## What you can build with it

- **Any pricing model in one policy:** usage-based, seats, credits, flat plans, or a hybrid, per plan and per feature.
- **AI features that stay profitable:** per-model costs, per-call margins, usage predicted before the call, and spend
  caps that stop runaway usage.
- **Feature flags and rollouts:** kill switches, percentage rollouts, and rules per call, next to the plans, with
  events to measure them.
- **Custom deals and contracts:** give one customer a feature their plan doesn't have, take one away, or change
  their limits, with expiry, without a new plan for each deal. For a deal many customers sign, write it once as a
  rule in the policy and assign it to each of them (below).
- **Customers that belong together:** refs put a user in a team and a team in an org, any way you model it. A user
  with no plan of its own is on its org's plan, with the org's deals, seats, and shared budgets.
- **Prepaid credits:** credit packs with expiry, resets, and rollover, spent across features at their own rates.
- **Rate limits next to paid usage:** protect your infrastructure without touching what customers pay for.
- **Billing events:** overage, limits hit, and thresholds crossed, sent to your code as they happen.

## A deal without a new plan

A customer signs for more than their plan: 250,000 API calls a month, SSO, audit logs from your Business plan, and no
exports. Write the deal once as a rule, and give it to every customer that signs it:

```stof
rules: {
    acme_2027: {
        label: 'Acme 2027'
        given: { sso: {}, audit_log: { plan: 'business' } }
        taken: { exports: {} }
        overrides: { api: { credit: 'request', value: 250_000, resets: true, reset_sch: 'monthly:1' } }
    }
}
```

```ts
await limitr.setCustomerRules('acme', ['acme_2027']);
await limitr.entitlementSource('acme', 'api'); // { access: 'plan', limit: 'rule:acme_2027', customer: 'acme' }
```

For every customer, the order is the same: its own changes first, then its rules (highest priority first), then its
plan. Rules can also cap spend, and a rule can't invent an entitlement: a give always uses a plan's definition. A
user on its org's plan gets the org's rules too.

## Made for AI coding agents

The npm package ships three skills in `node_modules/@formata/limitr/skill`: `limitr` (the policy reference, every
engine function, and every event), `limitr-ts` (the TypeScript SDK), and `stof` (the language policies are written
in). Point your coding agent at them and it can write, review, and debug policies and integrations correctly, instead
of guessing. The Limitr skills are also packaged as zips in
[`content/`](https://github.com/dev-formata-io/limitr/tree/main/content) for uploading to an agent.

## On your own, or with Limitr Cloud

The engine is the whole product in your process, open source (Apache 2.0), and free. The same policy and the same
calls work either way, so you can start on one and move to the other.

**On your own** (`Limitr.new(policy)`), you own the parts around the engine:

- **The policy** lives in your repo, reviewed and deployed like code.
- **Customer state** lives in your database: save each customer as its events say it changed, and restore it with
  `loadCustomers` when your app starts. Load a customer's refs with it (its team and org), since its plan, deals, and
  shared caps come through them. [Running it in your app](https://github.com/dev-formata-io/limitr/blob/main/typescript/tutorial/11-running-it-in-your-app.md)
  shows the whole loop.
- **Billing periods** follow your subscriptions (`setCustomerPeriod`), or the calendar.
- **Billing** comes from the events: overage, limits, and thresholds go to your code as they happen, with the price
  and cost of each, for Stripe or whatever you bill with.

**With [Limitr Cloud](https://limitr.dev)** (`Limitr.cloud({ token })`), those parts come with it, and every check
still runs in your process:

- **Limitr Analyst,** an agent beside you on every page. It writes and tests your policy, puts a signed contract in
  place from the order form, answers questions about customers, usage, and margin with charts and dashboards, and
  shows what a price change would do to real bills before you publish. It works in a draft and proposes the rest:
  nothing is published or changed until you apply it.
- **Policies** you edit, review, and publish to every running copy of your app, with no deploy, and roll back.
- **Customers** kept for you, with the customers their refs lead to loaded alongside them.
- **Billing:** ledgers, invoices through your own Stripe, and accounts that bill a customer and everyone under it as
  one invoice.
- **Contracts:** rules on a schedule, with ramps, fees, commitments, and recognition.
- **Analytics:** usage, cost, and margin by customer, account, feature, model, or task.

Limitr Cloud has a free plan: [start free](https://cloud.limitr.dev/?signup) and have the Analyst write your first
policy.

## Learn more

- [Tutorial](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial): runnable chapters, start to
  finish
- [Limitr skill](https://github.com/dev-formata-io/limitr/tree/main/skill/limitr): the policy reference, every engine
  function, and every event (`limitr-ts` for TypeScript is in
  [typescript/skill](https://github.com/dev-formata-io/limitr/tree/main/typescript/skill))
- [Docs](https://limitr.dev/docs/introduction) and [limitr.dev](https://limitr.dev)
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
