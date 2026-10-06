# Limitr tutorial

A short book on usage-based billing with Limitr. Each chapter is one small program you can paste into a file and
run. Start at chapter 1, or jump to the one you need.

```bash
npm i @formata/limitr
```

The examples are TypeScript. Save one as `example.mts` and run it with `npx tsx example.mts`, or with Bun or Deno.
Limitr runs the same way in the browser.

1. [Why Limitr](01-why-limitr.md): where usage-based billing gets hard, and what Limitr does about it
2. [Your first policy](02-first-policy.md): plans, features, and the `allow` call
3. [Customers and plans](03-customers-and-plans.md): default plans, orgs and their users, upgrades
4. [Limits and resets](04-limits-and-resets.md): units, daily and monthly periods
5. [Hard, soft, and observe](05-hard-soft-observe.md): deny, bill the overage, or just watch
6. [Pricing and margins](06-pricing-and-margins.md): prices, costs, tiers, and the margin of every call
7. [AI calls: reserve and settle](07-reserve-and-settle.md): costs that change per call, and usage you only know afterwards
8. [Stacking entitlements](08-stacking-entitlements.md): one action, several meters
9. [Control and monetize](09-control-and-monetize.md): rate limits that protect you, next to the usage you sell
10. [Seats, top-ups, and spend caps](10-seats-topups-caps.md): org seats, prepaid credits, and budgets
11. [Running it in your app](11-running-it-in-your-app.md): one engine per server, middleware, and saving state
12. [Validation and errors](12-validation-and-errors.md): policy formats and what happens when something's wrong
13. [Going to Cloud](13-going-to-cloud.md): the same code, with managed policies, billing, and analytics

The policy reference, every engine function, and every event are in the [Limitr skill](../../skill/limitr), which
is written for people and AI coding agents alike.
