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
    <a href="https://pypi.org/project/limitr/"><img alt="PyPI" src="https://img.shields.io/pypi/v/limitr?color=darkorange"></a>
    <a href="https://www.npmjs.com/package/@formata/limitr"><img alt="downloads" src="https://img.shields.io/npm/d18m/%40formata%2Flimitr?label=downloads&color=darkorange"></a>
    <a href="https://github.com/dev-formata-io/limitr/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
    <a href="https://limitr.dev/docs/introduction"><img alt="docs" src="https://img.shields.io/badge/docs-limitr.dev-purple"></a>
    <a href="https://discord.gg/AUyAUnxAZJ"><img alt="discord" src="https://img.shields.io/badge/chat-discord-5865F2"></a>
</h1>

<p align="center">
    <b>Most flexible usage billing &amp; limits for AI.</b>
    <br>
    Credits, metering, caps, and custom deals for every user and agent, in one policy that runs in your app and changes live.
</p>

Limitr decides what each customer can use and what it costs. You write your plans, limits, and prices in one
policy file. Before your app does something a customer pays for (a model call, an export, an API request), it asks
Limitr: is this allowed? Limitr answers, counts the usage, and tells you what to bill and what it cost you.

The engine is open source and runs inside your app, in TypeScript/JavaScript or Python. [Limitr Cloud](https://limitr.dev)
is the hosted side: change pricing from a dashboard, keep customer data, and send invoices.

## Quick start

```bash
npm i @formata/limitr    # TypeScript / JavaScript (Node, Bun, Deno, the browser)
pip install limitr       # Python
```

Here's a policy, `policy.yaml`. AI tokens cost the customer $20 per million and cost you $8. The free plan gets 50k
tokens a month. The pro plan gets 2M, can go over (and pay for it), and can export PDFs:

```yaml
policy:
  credits:
    ai_token: { price: { amount: 0.00002 }, overhead_cost: 0.000008 }
  plans:
    free:
      default: true
      entitlements:
        chat: { limit: { credit: ai_token, value: 50000, resets: true } }
    pro:
      entitlements:
        chat: { limit: { credit: ai_token, mode: soft, value: 2000000, resets: true } }
        export_pdf: {}   # no limit: a feature flag
```

Check calls against it in TypeScript:

```ts
import { Limitr } from '@formata/limitr';
import { readFile } from 'node:fs/promises';

const limitr = await Limitr.new(await readFile('policy.yaml', 'utf8'), 'yaml');
limitr.addHandler('billing', (name, value) => {
    if (name === 'meter-overage') console.log('bill acme:', JSON.parse(value as string).overage_price);
});

await limitr.ensureCustomer('acme', 'pro');
await limitr.allow('acme', 'export_pdf');        // true
await limitr.allow('acme', 'chat', 2_100_000);   // true, 100k over the limit, so it prints "bill acme: 2"

await limitr.ensureCustomer('ada');               // no plan given, so ada is on free
await limitr.allow('ada', 'chat', 60_000);        // false: free only allows 50k
```

Or in Python:

```python
from limitr import Limitr

limitr = Limitr(open('policy.yaml').read(), 'yaml')
limitr.add_handler('billing', lambda name, event: print('bill acme:', event['overage_price']) if name == 'meter-overage' else None)

limitr.ensure_customer('acme', 'pro')
limitr.allow('acme', 'export_pdf')        # True
limitr.allow('acme', 'chat', 2_100_000)   # True, 100k over the limit, so it prints "bill acme: 2.0"

limitr.ensure_customer('ada')             # no plan given, so ada is on free
limitr.allow('ada', 'chat', 60_000)       # False: free only allows 50k
```

To change a price or a limit, you change the policy, not your code. With Limitr Cloud, the change goes live without a
deploy. The [TypeScript](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial) and
[Python](https://github.com/dev-formata-io/limitr/tree/main/python/tutorial) tutorials pick up from here, in 15 short
chapters you can run.

## How it runs

```
  your app, one process
 ┌───────────────────────────────────────┐
 │  your code ── allow() ──▶ engine      │                       Limitr Cloud (optional)
 │            ◀── true ────  · policy    │ ◀───────────────────▶ policy editor, versions,
 │                           · customers │  policy down,         customers, ledger, invoices,
 └───────────────────────────────────────┘  usage up             Limitr Analyst
   about 1 ms, no network call              (in the background)
```

Limitr isn't a service your app calls. It's an engine your app runs, like a library: the policy and your customers
live in your process, and `allow()` answers right there, in about a millisecond. A gateway sits in the path of each
request and sees only that request. A metering API counts usage after it happened and can't stop a call. The engine
sees the customer, their plan and deal, and what the task has spent across every model, so it can hold room for calls
in flight, cap a whole task, and price each call at what you charge and what it costs you.

[Limitr Cloud](https://limitr.dev) manages the engine from the side. It sends policy changes and customers to every
server and collects usage over one background connection, never in the request path. Policy code runs sandboxed: no
network, files, or environment unless your app allows them.

## Why teams use it

AI products are hard to price and hard to control. One request can trigger dozens of model calls. Model costs change
every month. Big customers sign deals that don't match your pricing page. Every change means new code, and you have to
apply it to customers you already have.

With Limitr, those changes go in the policy:

- **Control usage:** feature flags, limits, rate limits, and spending caps for customers and for your own agents.
- **Charge for it:** usage pricing, credits and top-ups, seats, overage, and custom contracts. Limitr tells your code
  what to bill, and you send it to Stripe or anything else.
- **Know your margin:** every call is priced at what you charge and what it costs you.
- **Model any customer:** a user, a team, an org, an API key, or an agent, grouped however you like.

## Why it's the most flexible

- **You own it, like code you wrote.** The engine and the policy format are open source (Apache 2.0). Add your own
  rules and functions to the policy and change any built-in behavior. New pricing or a new business model is a policy
  change, not a migration. Limitr never takes a cut of what you bill, with or without Cloud.
- **Every call is decided with the whole picture.** The engine runs in your app with every customer's plan, deal, and
  usage in view, so it can hold room for calls still running: in the [benchmark](https://github.com/dev-formata-io/limitr/tree/main/bench),
  60 agent tasks starting at once against a 1M-token allowance used 2.1M tokens when each checked a counter first,
  and 953,334 with Limitr's reserve and settle.
- **You change it live.** Plans, prices, limits, and every customer's deal live in one versioned policy you can review,
  diff, test, and roll back. With Limitr Cloud, a change reaches every server on the next call, with no deploy.

## The engine and Limitr Cloud

The engine is this package. It's free and runs inside your app. On its own (`Limitr.new(policy)`), you keep the policy
in your repo, save customer data in your own database, and handle billing in your code.
[Running it in your app](https://github.com/dev-formata-io/limitr/blob/main/typescript/tutorial/11-running-it-in-your-app.md)
shows how.

[Limitr Cloud](https://limitr.dev) does those parts for you. Your code stays the same, except for one line:

```ts
const limitr = await Limitr.cloud({ token: process.env.LIMITR_TOKEN! });   // Python: Limitr.cloud(token)
```

With Cloud you get:

- **Live pricing changes.** Edit the policy in a visual editor or as code, test it on real traffic, publish it to
  every server with no deploy, and roll back in a click.
- **Customers, invoices, and contracts.** Cloud keeps your customers and their usage, creates invoices, collects
  payment through your own Stripe, and handles contracts with ramps, fees, and commitments.
- **Limitr Analyst,** an AI agent that writes and tests your policy, answers questions about usage and margin, and
  shows what a price change would do to real bills before you publish it.

Cloud has a free plan: [start free](https://cloud.limitr.dev/?signup), or see [pricing](https://limitr.dev/pricing).

## Made for coding agents

Limitr ships skills: instructions your coding agent loads so it gets Limitr right.

- `limitr`: writing and reviewing policies, every engine function, and every event
- `limitr-ts` and `limitr-py`: the TypeScript and Python SDKs
- `limitr-network`: Limitr Network
- `stof`: the language policies are written in

Install them in your project with one command (Claude Code, Cursor, Codex, and most other coding agents):

```
npx skills add dev-formata-io/limitr
```

Add `-y` to install all of them for every agent without asking. They're also in the Claude Code plugin
(`/plugin marketplace add dev-formata-io/limitr`, then `/plugin install limitr@limitr`), as zips on the
[latest release](https://github.com/dev-formata-io/limitr/releases/latest) for Claude Desktop, claude.ai, and other
apps that take uploads (one per skill), and in the npm package (`node_modules/@formata/limitr/skill`, and `stof` in
`@formata/stof`).

## Limitr Network

Limitr Network lets your services sell to agents, and lets your agents pay for other services, without API keys or
accounts. A service lists what it sells in its policy. An agent signs a voucher, like "up to $5 on this plan until
Friday", and gets the service's endpoints as tools. The service tracks the voucher like any other customer, and both
sides keep signed receipts of every call. Learn more in the
[protocol](https://github.com/dev-formata-io/limitr/tree/main/src/network) and the tutorial, in
[TypeScript](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial/network) or
[Python](https://github.com/dev-formata-io/limitr/tree/main/python/tutorial/network). Network on Limitr Cloud is in
early access: [join the waitlist](https://limitr.dev/network).

## Learn more

- [Docs](https://limitr.dev/docs/introduction) and [limitr.dev](https://limitr.dev)
- Tutorials: [TypeScript](https://github.com/dev-formata-io/limitr/tree/main/typescript/tutorial) and
  [Python](https://github.com/dev-formata-io/limitr/tree/main/python/tutorial), each with a Network track
- [Limitr skill](https://github.com/dev-formata-io/limitr/tree/main/skill/limitr): the policy reference, every engine
  function, and every event
- [Python SDK](https://github.com/dev-formata-io/limitr/tree/main/python) and
  [changelog](https://github.com/dev-formata-io/limitr/blob/main/CHANGELOG.md)
- [Discord](https://discord.gg/AUyAUnxAZJ) and [issues](https://github.com/dev-formata-io/limitr/issues)

Not sure your pricing model fits? [Book a demo](https://calendly.com/d/ctjd-5gm-qqc/limitr-demo-with-founders).

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
