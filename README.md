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
    <b>Limits, credits, and billing, inside your AI product.</b>
    <br>
    An open-source engine that decides, on every call, what each customer can do, what it costs you, and what to bill. You build on it: your rules, your UI, your coding agent. Limitr Cloud keeps every plan, price, and contract live, with no release.
</p>

Limitr is an open-source engine for usage control and billing. It meters usage (AI tokens by model, API calls,
agent runs, seats, anything you count), enforces plans and limits, prices every call at what it costs you and what you
charge, and tells your code what to bill. It's a library, not a service: it runs in your process, in Node, Bun, Deno,
or the browser, so there's nothing to deploy or self-host and no network call in the middle of a request. It's built
for usage that doesn't follow the plan, which is most AI usage.

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

## Billing you own, not billing that owns you

Pricing never sits still. Costs, usage, and deals change every month, and every change lands on your code and the
customers you already have. Most billing platforms are fast to start, and put your pricing in their system: usage is
sent to a vendor, counted on their servers, one event at a time, after it happens. Building it yourself keeps control,
and costs engineering time on every plan and every deal.

Limitr is the control without the build. The engine is yours, like your code:

- **Inside your app.** Every check runs in your process, before the work runs, with no network call.
- **Priced across the task, not one call at a time.** One task is dozens of calls across models, tools, and vendors.
  The engine sees every one with the customer, their plan, and what the task has cost so far, so it prices and limits
  the whole task as it runs.
- **Shaped to your business.** Plans, prices, costs, limits, and every customer's deal in one policy document.
- **Extends like code.** Your own pricing functions, feature conditions, rules, and tools run in the policy, written
  in [Stof](https://stof.dev).
- **Safe in your process.** A policy runs sandboxed: no files or environment, no network unless it's allowed (and
  never your private network unless you list it), and time and memory limits on every call. The engine is sealed
  when it loads, so a policy can build on it but can't change it.
- **Margin on every call,** priced at what you charge and what it costs you.
- **Never a share of your revenue,** and yours if you leave: with Limitr Cloud or without it, it's the same engine.

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
- **Services agents can buy:** sell your API to agents and other services with Limitr Network (below), metered by
  the same policy.

## Limitr Network: services agents pay for

An agent that needs a forecast, a search, or a translation usually needs an account and an API key first. With
Limitr Network, a service publishes its plans and routes from its Limitr policy, and an agent (or any app or
service with a policy) signs a **voucher**: up to this much, on this plan, until then. The service meters it like any
customer, with the voucher's spend as a hard cap; the agent gets the service's routes as tools; and every request and
receipt is signed, so both sides hold the same record. No keys exchanged, no integration work. Optional operators
(Limitr Cloud is one, set up for you on a `Limitr.cloud()` engine, and anyone can run one) add shared state across
servers, budgets across services, identities, and discovery. It's the Limitr Network Protocol (LNP): start with
[`src/network`](https://github.com/dev-formata-io/limitr/tree/main/src/network) and the
[tutorial track](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial/network).

## Every deal, enforced as written

A customer signs for more than their plan: 250,000 API calls a month, SSO, audit logs from your Business plan, and no
exports. Write the deal once as a rule, and give it to every customer that signs it. Their terms apply on their next
call, with no new plan and no engineering ticket:

```typescript
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
engine function, and every event), `limitr-ts` (the TypeScript SDK), and `limitr-network` (Limitr Network). The
fourth, `stof` (the language policies are written in), ships with Stof in `node_modules/@formata/stof/skill/stof`.
Point your coding agent at them and it
can write, review, and debug policies and integrations correctly, instead of guessing. The Limitr skills are also packaged as zips in
[`content/`](https://github.com/dev-formata-io/limitr/tree/main/content) for uploading to an agent.

## Self-hosting: on your own, or with Limitr Cloud

There is no Limitr server to deploy. The engine is the npm package, running inside your app wherever your app runs,
open source (Apache 2.0) and free. "Self-hosting" Limitr is `npm i @formata/limitr` and a policy in your repo. The
same policy and the same calls work with or without Limitr Cloud, so you can start on one and move to the other.

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

Limitr Cloud has a free plan, and never takes a share of what you bill: [start free](https://cloud.limitr.dev/?signup)
and have the Analyst write your first policy.

## Learn more

- [Tutorial](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial): runnable chapters, start to
  finish
- [Limitr skill](https://github.com/dev-formata-io/limitr/tree/main/skill/limitr): the policy reference, every engine
  function, and every event (`limitr-ts` for TypeScript is in
  [typescript/skill](https://github.com/dev-formata-io/limitr/tree/main/typescript/skill))
- [Limitr Network](https://github.com/dev-formata-io/limitr/tree/main/src/network): the protocol, its
  [wire format](https://github.com/dev-formata-io/limitr/blob/main/src/network/PROTOCOL.md), and its
  [skill](https://github.com/dev-formata-io/limitr/tree/main/skill/limitr-network)
- [Stof skill](https://github.com/dev-formata-io/stof/blob/main/content/SKILL.md): the language policies are written in
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
