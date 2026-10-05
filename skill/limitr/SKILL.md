---
name: limitr
description: >
  Write, review, and debug Limitr policies: the credits, plans, entitlements, limits, caps, grants, topups, overhead
  costs, reservations, and notifications that decide what each customer may do and what it costs. Limitr policies
  are Stof documents run by the embedded Limitr engine, so use this together with the stof skill. Use for any
  `Limitr policy: {...}` document, pricing or usage-limit design, allow()/check()/reserve()/settle() semantics,
  meter or cap behavior, Limitr events, margin questions, or tests in the Limitr repo (src/spec, src/tests). For
  calling Limitr from an application, also load the SDK skill for that language (Ex. limitr-ts).
---

# Limitr

Limitr is an embedded usage and pricing engine. One **policy** document defines what customers can do (entitlements),
how much (limits), what it costs you (provider overhead), and what you charge (credit prices). The engine runs that
policy in-process and keeps **customer state** (meters, grants, caps) in the same document. Every call that consumes
something asks the engine first (`allow`), and the engine meters it, enforces limits, and emits events.

The policy is a [Stof](https://stof.dev) document, and the engine itself (`src/spec/*.stof`) is written in Stof. A
policy is mostly plain data (JSON, YAML, TOML, or Stof all work), but because it is Stof it can also carry functions:
cost functions, notification rules, and anything else the policy needs. Read the stof skill for language questions.

This file is the working guide. Details are in `references/`:

- `references/policy.md`: every policy type and field, with defaults.
- `references/api.md`: every engine function (signatures and behavior).
- `references/events.md`: event names, payloads, and notifications.
- `references/patterns.md`: common policy designs (feature flags, seats, AI tokens, org budgets, stacking).

## Layers

- **stof skill:** the language. Syntax, types, units, libraries, `using`, tests.
- **limitr skill (this one):** the policy and engine semantics, the same in every SDK.
- **SDK skills (Ex. limitr-ts):** installing, constructing the engine, calling it from application code, handling
  events, and Limitr Cloud. The SDKs are thin wrappers that call `<Limitr>.api.*` in the embedded document.

## Mental model

- **Credit:** a unit of something consumable (a seat, a request, a token, a megabyte). It can have a price (what you
  charge, in runes), an overhead cost (what it costs you, in runes), Stof units, and a pricing model.
- **Rune:** the common currency. 1 rune = 1 USD by default. The **exchange** table converts other currencies and
  credits to runes (Ex. `euro: { value: 1.14, currency: 'usd' }`).
- **Plan:** a named set of entitlements (plus topups). Each customer is on one plan, directly or through refs.
- **Entitlement:** something a plan allows. No limit means a feature flag (allowed or not). With a **limit**, it is
  metered in a credit.
- **Limit:** how much of a credit the entitlement allows, its mode (`hard`, `soft`, `observe`), whether and when it
  resets, an optional governor (rate limit), and the standard increment.
- **Customer:** an ID, a plan, a type (user, org, team, seat ...), refs to other customers, and state: **meters**
  (usage per entitlement), **overrides** (per-customer limits), **grants** (credit balances), and **caps** (spend
  ceilings).
- **Meter:** a customer's usage of one entitlement this period, plus the overhead spent, rate history, governor
  tokens, holds, and estimates. Created lazily on first use.
- **Grant:** a balance of a credit (usually from a **topup**) that covers overage before it is billed.
- **Cap:** a spend ceiling across calls, credits, and entitlements (Ex. "$50 a month on overage"). Caps only restrict.

## A policy

```stof
Limitr policy: {
    credits: {
        seat: { label: 'Seat', unit: 'seat' }
        request: { label: 'Request', unit: 'request' }
        storage: { label: 'Storage', stof_units: 'MB', price: { amount: 0.0001 } }
        ai_token: {
            label: 'AI token'
            price: { amount: 0.00002 }     // what you charge per token, in runes
            overhead_cost: 0.000003        // what one token costs you (fallback rate)
            rates: {
                sonnet: { input: 0.000003, output: 0.000015 }
                haiku: { input: 0.000001, output: 0.000005 }
            }
            // per-call provider cost; context is the event data passed to allow()
            fn overhead(units: float, context?: obj) -> float {
                const rate = self.rates.get(context?.model ?? '');
                if (rate == null) return units * self.overhead_cost;
                (context.input * rate.input) + (context.output * rate.output)
            }
        }
    }

    plans: {
        free: {
            label: 'Free'
            default: true                  // customers created without a plan get this one
            entitlements: {
                export_pdf: { description: 'Feature flag (no limit)' }
                seats: { scope: 'org', limit: { credit: 'seat', value: 3 } }
                api: { limit: { credit: 'request', value: 1000, resets: true, reset_inc: 1day } }
                storage: { limit: { credit: 'storage', value: 1GB } }
                chat: { limit: { credit: 'ai_token', value: 50_000, resets: true } }
            }
        }
        pro: {
            label: 'Pro'
            entitlements: {
                export_pdf: {}
                seats: { scope: 'org', limit: { credit: 'seat', value: 25 } }
                api: { limit: { credit: 'request', value: 100_000, resets: true, reset_sch: 'monthly:1' } }
                storage: { limit: { credit: 'storage', mode: 'soft', value: 100GB } }
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 2_000_000, resets: true } }
            }
            topups: {
                tokens_1m: { credit: 'ai_token', value: 1_000_000, price: { amount: 15 } }
            }
        }
    }
}
```

The policy is the object typed `Limitr`, conventionally named `policy` at the root. `<Limitr>.api.get()` finds it:
`root.policy`, else the first root field that is a `Limitr` instance or has the `#[limitr]` attribute. Plan and
credit names are their field names. In JSON, the same document is `{ "policy": { "credits": {...}, "plans": {...} } }`.

Validate a policy with `policy.valid()` (SDKs validate on load by default). It schema-checks every credit, plan,
entitlement, limit, topup, and exchange pair, sorts and checks tiers, and fills defaults such as a 30-day
`reset_inc`. The first error message is in `<LimitrValidation>.error_message`.

## Metering: allow and check

```stof
policy.allow(customer_id, entitlement, value = 0, event = true, cap = null, overhead?, force = false) -> bool
policy.check(customer_id, entitlement, value = 0, cap = null, context = null, overhead?) -> bool
```

- `allow` decides and, when allowed, meters: the meter moves by `value` and events fire. `check` makes the same
  decision without changing anything.
- `value` is in the credit's units. A string can carry units (`'2GB'` into an MB credit becomes `2000MB`). Negative
  values decrement. `increment` / `decrement` use the limit's standard `increment`.
- **No limit** on the entitlement: `allow` is a feature-flag check (true if the customer's plan has it).
- **Unknown customer or entitlement:** false.
- `event`: `true` (send events), `false` (no events), or event data (an object or a Stof/JSON string). Event data is
  carried on the events as `event_data` and is the cost function's `context`.
- `cap`: a call-scoped cap, a `Cap` or a map of credit to ceiling (Ex. `map(('rune', 0.5))`), checked in addition to
  the customer's standing caps.
- `overhead`: the call's actual provider cost in runes, when you know it. Skips the credit's cost function.
- `force`: record usage that already happened (past a hard limit or cap). Used by `settle`.

What decides a call, in order (nothing changes until every gate passes):

1. **Period reset.** If the limit resets and a new period started, the meter starts from zero.
2. **Caps.** Every applicable cap must have room (the caller's caps, shared caps up its refs, and the call's caps).
3. **Grants.** For overage, the customer's grants must cover what caps would otherwise see.
4. **Governor.** Hard limits with a governor need enough tokens in the bucket.
5. **Limit.** `hard`: deny past the limit (or, with `hard_trailing`, deny once the meter is already past it). `soft`:
   allow, and the part past the limit is overage (drawn from grants first, then a `meter-overage` event to bill).
   `observe`: never deny.
6. **Commit.** Meter, overhead, history, grants, and caps update. Events fire.

Reads (`value`, `remaining`, `limit`, `allowance`, `rate`, `projected_exhaustion`, `resets`, `credit_remaining`)
never meter anything, and they show the current period even before the next `allow` performs the reset. (They do
tidy up: expired grants, caps, and overrides are removed, and resetting grants roll forward.)

## Limits

```stof
limit: {
    credit: 'request'      // required: a credit name
    mode: 'hard'           // 'hard' (deny), 'soft' (allow, bill overage), 'observe' (record only)
    value: 1000            // the limit, in the credit's units (strings and units allowed: '1GB')
    increment: 1           // used by increment()/decrement()
    minimum: 0             // the meter never goes below this
    resets: true           // reset each period...
    reset_inc: 1day        // ...every duration (default 30days), or
    reset_sch: 'monthly:1' // ...on a UTC calendar schedule (exclusive with reset_inc)
    hard_trailing: false   // hard only: allow the crossing call, deny after
    grants_apply: true     // grants may cover overage on this limit
}
```

Schedules: `monthly:N`, `monthly:last`, `weekly:mon`, `nth_weekday:N:mon`, `yearly:M-D`, `quarterly:D`.

A **governor** shapes the rate below a hard limit: `governor_enabled: true`, `governor_capacity` (burst), and
`governor_refill_rate` (tokens per ms). Denials fire `meter-governed`. `allowance()` is what can run right now.

**Overrides** replace an entitlement's limit for one customer (custom deals, trials): `create_customer_override(id,
entitlement, expires?, credit?, mode?, value?, increment?, resets?, reset_inc?, reset_sch?)`. Unset fields copy the
current limit (the plan's, or an existing override), and a new override replaces the old one. An override past `override_expires_on` is removed on the next read or call.

## Customers, plans, and scope

- `create_customer(id, plan = '', type = 'user', label = 'User', refs?, alts?, metadata?)`. With no plan, the plan
  comes from the first ref that has one, then the default plan.
- **Refs** link customers (user to team to org). A customer with no plan of its own uses its refs' plan.
- **Scope:** `scope: 'org'` on an entitlement meters it on the nearest customer of that type through the refs chain
  (breadth-first). A user calling `increment('user_1', 'seats')` moves the org's seat meter. A caller with no
  customer of that type in its refs is denied.
- **Alt IDs** (`alt_ids`, `set_alt_customer_id`) let other identifiers (an email, an auth ID) resolve to a customer.
- `set_customer_plan(id, plan, overwrite_meters = false)` changes plans and fires `customer-plan-changed`.
- **Plan subscription:** `ensure_plan_subscription(id)` increments the plan's `subscription` entitlement once
  (after the `trial_period`), so a credit priced as the plan fee bills it. Never called automatically.

## Pricing and margins

- **Price** is per credit, in runes. `pricing_model`: `flat` (`price`) or `tiered`, `volume`, `stairstep` (`tiers`:
  `[{ up_to, price: { amount } }]`, last tier with no `up_to`). Tiers apply to billable units, the units past the
  limit, and the engine prices each call from where the customer already is this period.
- **Overhead** is what the provider charges you, in runes: `overhead_cost` per unit, or a credit `overhead()` cost
  function, or the actual cost passed to `allow`. Each call's overhead is recorded on `Meter.overhead` for the
  period, so later price changes never re-price earlier usage.
- **Exchange** converts between currencies and credits through runes: `exchange: { euro: { value: 1.14, currency:
  'usd' } }`. A priced credit converts through its price. `credit_exchange(in, out, value)`.
- `customer_local_margin_breakdown(id)` and `local_margin_breakdown(plan, entitlements)` give a quick revenue,
  cost, and margin snapshot. They do not account for grants or topups.

## Grants, topups, and caps

- **Topups** (on a plan) are purchasable credit packages. `apply_customer_topup(id, topup)` creates a **grant**.
  `included: true` topups are granted with the plan (`ensure_included_topups(id)`, optionally `included_scopes`).
  Grants can expire (`expires_after`) and reset (`hard`, `add`, or `rollover` with min, max, and percent).
- Grants cover **overage** (soft limits) and let hard limits run past their value while the grant lasts. The draw
  order is `exchange.grant_strategy`: `expires_first` (default), `cheapest_first`, or `valuable_first`. Grants in
  other credits are used through the exchange. `credit_remaining(id, credit)` is the balance.
- **Caps** (`add_customer_cap`) are ceilings in any credit or currency (default `rune`, so "dollars across
  everything"). Options: `overage_only`, `ignore_grants`, `observe_only` (track and notify, never deny),
  `overhead_cost` (cap your cost instead of their spend), `follow_decrements`, `hard_trailing`, `scope`
  (entitlements), `resets` / `reset_inc` / `reset_sch`, `expires_on`, `shared` / `shared_with` (applies to customers
  that reference the holder). Crossing a cap's value fires `cap-threshold-crossed` once.

## Overhead cost functions

Override `overhead(units, context?) -> float` on a credit when the cost differs per call or changes over time. It
returns runes for `units` of the credit. `context` is the call's event data (the object or parsed string passed as
`event`), or null. It can read anything in the policy, such as a rate table that Cloud updates. If it throws or
returns a non-number, the engine logs it and uses `units * overhead_cost`. When the host knows the real cost after
the call, pass it as `allow(..., overhead)` instead.

## Reservations and estimates

For calls whose usage is only known afterwards (LLM calls, jobs), reserve room first so concurrent calls can't
overspend together:

```stof
const hold = policy.reserve('user_1', 'chat', null, using new { model: 'sonnet' }, input_tokens, 'sonnet');
if (hold == null) return false;                       // not allowed right now (counts other holds)
// ... run the call ...
policy.settle('user_1', 'chat', hold, used_tokens, using new { model: 'sonnet', input: 1200, output: 300 });
// or, if it never ran: policy.release('user_1', 'chat', hold);
```

- `reserve(id, ent, value?, context?, basis?, segment?, ttl?, quantile = 0.9, overhead?) -> str` holds `value`, or
  the predicted amount when `value` is null (`estimate` at `quantile`, else the standard increment). Null when the
  call wouldn't be allowed.
- `settle(id, ent, hold, value, event?, overhead?, basis?, segment?)` drops the hold and records the actual usage
  with `force` (it already happened), then learns from it.
- Holds count on their own meter only, expire after `hold_ttl` (10 minutes), and are never billed.
- `estimate(id, ent, basis?, segment?, quantile)` returns `value`, `overhead`, `samples`, `source`, and `scope`. It
  uses the customer's own estimate after `estimate_min_samples` (5), else the policy-wide one.
- `basis` (Ex. input tokens) makes an estimate learn per unit of basis. `segment` (Ex. a model) keeps a separate
  estimate. Keep segments few: a model or a feature, never a user or request ID.

## Events and notifications

Every meter change fires an event: `meter-changed`, `meter-overage` (soft overage after grants: bill it),
`meter-limit` (denied), `meter-governed`, and `meter-reset`, plus customer, cap, and plan events. Events reach:

- **Policy notifications:** objects under `policy.notifications` with `matches(type, event) -> bool` and an optional
  `fire(event)`. Without `fire`, a match re-sends the event under the notification's name.
- **Stof functions with the event name as an attribute** (Ex. `#[meter-overage] fn bill(event: obj) {...}`).
- **The host app**, through the SDK's event handler (JSON).

Payloads and every event name are in `references/events.md`.

## Memory: never grow the document per call

Stof has no garbage collection. Every `new {}` object stays in the document until dropped, and the engine document
may live for months in a server. The engine itself creates nothing per call except state that belongs there
(meters, holds, estimate segments). Code you add must keep it that way:

- Objects passed as event data or context from Stof: `policy.allow(id, ent, 10, using new { model })`, or pass a
  Stof/JSON string (the engine parses and drops it).
- Temporary objects in policy functions (cost functions, notifications): `using tmp = new {...};` or an arena
  (`using scratch = new {}; ... new {...} on scratch`).
- Remove objects with `obj.remove(name, shallow = false)` or `drop(obj)`, not by overwriting the field.
- Run `stof test --leaks` on policy tests.

## Testing

Tests are Stof `#[test]` functions next to the policy (`stof test file.stof`, or `stof test` in the Limitr repo,
where `src/mod.stof` imports the spec as `LimitrTypes` and the tests under `#[test]`). Tests in a document run
concurrently against the same document, so give each test its own customer IDs. Always also run
`stof test --leaks`, which runs them one at a time and fails tests that leave objects behind.

```stof
import 'limitr/src/spec/mod' as self.LimitrTypes;

Limitr policy: { /* ... */ }

#[test]
fn api_is_capped() {
    const p = self.policy;
    p.create_customer('t_api_capped', 'free');
    assert(p.allow('t_api_capped', 'api', 1000));
    assert_not(p.allow('t_api_capped', 'api', 1));
    assert_eq(p.remaining('t_api_capped', 'api'), 0);
}
```

Engine changes in the Limitr repo: run `stof test` and `stof test --leaks` from the repo root, rebuild the
compiled spec with `stof run project.stof` (writes `typescript/limitr.ts`), and record behavior changes in
`CHANGELOG.md`.

## Common mistakes

1. **Forgetting `credit` on a limit**, or naming a credit that doesn't exist. `valid()` reports it; unvalidated
   policies fail at call time.
2. **Expecting a soft limit to deny.** Soft limits allow and report overage. Use `hard`, a cap, or a governor.
3. **Limit units.** `value: 1GB` with `stof_units: 'MB'` is compared in MB. A credit with no `stof_units` takes plain
   numbers.
4. **Treating `check` as a reservation.** Two concurrent `check`s can both pass. Use `reserve` / `settle`.
5. **High-cardinality segments** (user or request IDs) create an estimate per value, forever.
6. **Scoped entitlements without refs.** `scope: 'org'` denies a user with no org in its refs chain.
7. **Billing from `meter-changed`.** Bill `meter-overage` (what grants didn't cover) or read meters at period end;
   `meter-changed` fires for in-plan usage too.
8. **Caps grant nothing.** A cap only restricts; it never allows a call the limit would deny.
9. **Mutating the policy from a cost function.** Cost functions run on every call (and on `check`); keep them pure
   and allocation-free.
10. **Creating objects per call without `using`.** See Memory above.
