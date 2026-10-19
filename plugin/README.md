# Limitr

Limitr is an open-source engine for usage-based pricing. One policy decides what every customer can use, what it costs you, and what you charge, checked in-process on every call. This plugin teaches Claude how to design and debug Limitr policies and how to call the engine from your app.

## What it adds

Three skills that work together:

- `limitr`: writing, reviewing, and debugging Limitr policies. Credits, plans, entitlements, limits, caps, grants, topups, overhead costs, reservations, usage estimates, feature flags, and notifications, plus `allow`, `check`, `reserve`, and `settle` semantics, events, and margin questions. Its `references/` folder covers the policy format, the engine API, events, and common patterns.
- `limitr-ts`: using Limitr from TypeScript or JavaScript with the `@formata/limitr` package. Creating the engine, loading policies and customers, gating calls, reserving and settling LLM calls, predicting output tokens before a call, handling events, persisting customer state, and connecting to Limitr Cloud.
- `stof`: the Stof language. Limitr policies are Stof documents, so Claude uses this skill for policy syntax. It is the same skill as the standalone Stof plugin.

## Install

On claude.ai or in Cowork, add Limitr from the plugin directory. In Claude Code:

```
/plugin install limitr --marketplace dev-formata-io/limitr
```

## Use it

Ask Claude things like:

- "Design a policy with a free plan of 100k AI tokens a month and a pro plan with overage at $20 per million."
- "Gate this OpenAI call with Limitr and settle the real token count after it returns."
- "Why does `allow` return false for this customer?"
- "Add a feature flag that rolls out to 10% of customers on the pro plan."

## Data

The plugin is only Markdown instructions. It runs no code, connects to no services, and sends or stores no data. Code that Claude writes with it runs in your app. That code talks to Limitr Cloud only if you choose to connect it with your own Limitr Cloud token.

## Links

- Docs: https://limitr.dev/spec/welcome
- Source: https://github.com/dev-formata-io/limitr
- Issues: https://github.com/dev-formata-io/limitr/issues
- npm: https://www.npmjs.com/package/@formata/limitr

Limitr is open source under the Apache 2.0 license, made by Formata, Inc.
