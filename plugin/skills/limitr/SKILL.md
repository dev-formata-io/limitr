---
name: limitr
description: >
  Write, review, and debug Limitr policies: the credits, plans, entitlements, limits, caps, grants, topups, overhead
  costs, reservations, usage estimates, feature flags, and notifications that decide what each customer may do and
  what it costs.
  Limitr policies are Stof documents run by the embedded Limitr engine, so use this together with the stof skill.
  Use for any `Limitr policy: {...}` document, pricing or usage-limit design, allow()/check()/reserve()/settle()
  semantics, predicting a call's usage before it runs (Ex. output tokens from input tokens), feature flags and
  rollouts, giving or taking a customer's entitlements, meter or cap behavior,
  Limitr events, margin questions, or tests in the Limitr repo (src/spec, src/tests). For calling Limitr from an
  application, also load the SDK skill for that language (Ex. limitr-ts).
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
  events, and Limitr Cloud. The SDKs are thin wrappers that call `root.policy`'s functions in the embedded document.

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
                const input = context.input ?? 0;
                const output = context.output ?? Num::max(units - input, 0);   // reserve, before the call: no output yet
                input * rate.input + output * rate.output
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

The policy always lives at `root.policy`, and its functions are called on it directly (`root.policy.allow(...)`).
In JSON, the same document is `{ "policy": { "credits": {...}, "plans": {...} } }`. A policy parsed from JSON, YAML,
or TOML has no type yet: `<Limitr>.load()` makes `root.policy` a `Limitr` and returns it (SDKs call it on load).
Plan and credit names are their field names. In `limitr.stof`, public functions come first, grouped by area; the
marked Internal section at the end is not part of the API.

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
    resets: true           // reset each period (a reset_sch turns this on)...
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
current limit (the plan's, or an existing override), and a new override replaces the old one. An override past
`override_expires_on` is removed on the next read or call. Overrides change how much; to change whether a customer
has an entitlement at all, give or take it (below). An override can put a limit on an entitlement with no limit (a
flag), given a `credit`.

## Customers, plans, and scope

- `create_customer(id, plan = '', type = 'user', label = 'User', refs?, alts?, metadata?)`. With no plan, the plan
  comes from the first ref that has one, then the default plan.
- **Refs** link customers (user to team to org). A customer with no plan of its own uses its refs' plan.
- **Scope:** `scope: 'org'` on an entitlement meters it on the nearest customer of that type through the refs chain
  (breadth-first). A user calling `increment('user_1', 'seats')` moves the org's seat meter. A caller with no
  customer of that type in its refs is denied.
- **Alt IDs** (`alt_ids`, `set_alt_customer_id`) let other identifiers (an auth ID, a Stripe customer ID) resolve to a
  customer.
- `set_customer_plan(id, plan, overwrite_meters = false)` changes plans and fires `customer-plan-changed`. Included
  topup balances move to the new plan's included topup in the same credit by its `plan_change` (`top_up` by
  default: raise to the new amount, never lower); purchased ones stay.
- **IDs** and alt IDs can't contain a period (fields are found by '.' paths). `create_customer`, `set_customer`, and
  `set_alt_customer_id` refuse one and log an error. For an email, replace its periods with your own placeholder, or
  keep it in metadata.
- **Plan subscription:** `ensure_plan_subscription(id)` increments the plan's `subscription` entitlement once
  (after the `trial_period`), so a credit priced as the plan fee bills it. Never called automatically.

## Feature flags and per-customer access

An entitlement with no limit is a feature flag. Three things refine who has a feature:

```stof
#[type]
Rollouts: {
    #[static]
    fn beta_or_quarter(customer: Customer, entitlement: str, context?: obj) -> bool {
        (customer.metadata?.beta ?? false) || customer.bucket(entitlement) < 25
    }
}

policy: {
    plans: {
        pro: {
            entitlements: {
                ai_assistant: { enabled: <Rollouts>.beta_or_quarter, track: true }   // a shared rule
                new_checkout: {                                                     // an inline rule
                    fn enabled(customer: Customer, entitlement: str, context?: obj) -> bool { context?.country == 'US' }
                }
                old_editor: { enabled: false }                                      // a kill switch
                sso: {}
            }
        }
    }
}
```

- **`enabled`** (optional) decides whether an entitlement is on for a call: absent is on; a bool is on or off for
  everyone; a function `(customer, entitlement, context?) -> bool` decides per call. Write it inline (`fn enabled`)
  or point at a shared one (`enabled: <Rollouts>.x`), so one rule serves many features: it gets the entitlement's
  name. `customer` is the one the entitlement belongs to for the call (the org for `scope: 'org'`); `context` is
  the call's event data.
- It **only narrows**: it runs after the plan, gives, and takes, so it can't give a feature the customer doesn't
  have. It gates new usage only (`check`, `allow`, `reserve`); `settle` (usage that happened) and decrements always
  go through. Anything but `true` is off, and a failing rule is off and logged.
- **`customer.bucket(key)`** is a stable 0 to 99 per customer and key (Ex. the entitlement name) for percentage
  rollouts: `bucket < 25` is always the same quarter, raising it keeps them, and each key splits customers
  independently. It's `<Customer>.hash('<key>:<customer id>') % 100`, where `hash` is FNV-1a (32-bit, UTF-8) then
  MurmurHash3's fmix32, so a server can compute the same number.
- **Targeting one customer** (a beta list): put it in customer metadata (`create_customer(..., metadata)`,
  `set_customer`) and read `customer.metadata` in the rule.
- **`features(id, context?)`** lists the entitlements a customer can use right now (plan, less taken, plus given,
  that are on). It's access, not capacity: a used-up metered entitlement is listed; `check` answers capacity.
- **`track: true`** sends `feature-checked` (`customer`, `caller`, `entitlement`, `enabled`, `plan`,
  `event_data`) each time the entitlement is checked (`check`, `allow`, `features`). Opt-in, since checks are
  frequent; it's how a rollout or experiment is measured.

**Give and take** change whether one customer has an entitlement, whatever its plan says (custom deals, keeping a
feature through a downgrade, pausing one feature):

- `give_entitlement(id, entitlement, plan?, expires?)` uses a plan's definition of the entitlement: `plan`, or the
  closest plan that has it (the customer's own, then its refs' plans nearest first, then the policy's plans in
  order). Entitlements can't be invented: false when no plan has it. A give beats the customer's plan.
- `take_entitlement(id, entitlement, expires?)` denies it even though the plan (or a give) has it. Meters and
  overrides are kept, so a restore picks up where it left off.
- `restore_entitlement(id, entitlement)` undoes either. The latest give or take of an entitlement replaces the last.
- They're stored on the customer (`given`, `taken`), so they last through plan changes and sync with it. They're
  inherited the way plans are: a customer on its refs' plan (Ex. users on their org's plan) gets that customer's
  gives and takes; its own win. Overrides still apply on top.
- Events: `customer-entitlement-given`, `customer-entitlement-taken`, `customer-entitlement-restored`, plus
  `customer-set`.

## Pricing and margins

- **Price** is per credit, in runes. `pricing_model`: `flat` (`price`) or `tiered`, `volume`, `stairstep` (`tiers`:
  `[{ up_to, price: { amount } }]`, last tier with no `up_to`). Tiers apply to billable units, the units past the
  limit, and the engine prices each call from where the customer already is this period.
- **Overhead** is what the provider charges you, in runes: `overhead_cost` per unit, or a credit `overhead()` cost
  function, or the actual cost passed to `allow`. For AI models, prefer a credit per model and direction
  (`sonnet_input`, `sonnet_output`), each with its own price and `overhead_cost`. To give customers one balance
  across models, add an abstract credit (Ex. `ai_credit`, no price) with an exchange pair, and grant it: it pays for
  every model at its own price, no code needed. A cost function is for metering one unit across models whose cost per
  call varies (see references/patterns.md). Each call's overhead is recorded on `Meter.overhead` for the
  period, so later price changes never re-price earlier usage.
- **Exchange** converts any credit into any other through runes; currencies are credits, and `rune` / `usd` are
  built in. A pair on a priced credit replaces its price everywhere (worth, billing, grants), so models can be priced
  in an abstract credit and repriced together. Ex. `exchange: { euro: { value: 1.14, currency: 'usd' } }`. A priced
  credit converts through its price. `credit_exchange(in, out, value)` converts. To keep rates current,
  `set_exchange_pair(name, value, currency)` adds or replaces a pair at runtime (refused if it doesn't reach runes),
  and `remove_exchange_pair(name)` removes one; or override `get_pair(name)` to look rates up on every conversion
  (it's asked about credits too, so only look up known names).
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
returns a non-number, the engine logs it (`err`, the console in JavaScript) and uses `units * overhead_cost`. When the
host knows the real cost after the call, pass it as `allow(..., overhead)` instead. Several credits can share one
cost function: `overhead: <Costs>.per_model` (a field pointing at a function in a `#[type]`). A shared function
isn't defined on the credit, so `self` inside it is not the credit: keep the data it reads on the type
(`<Costs>.rates`) or elsewhere in the policy (`root.policy`).

`reserve` also calls it before the call runs when it has no learned overhead to hold (the first calls, or when you
pass `value`), with the held `units` and only the context passed to `reserve`, so fields known only afterwards (Ex.
output tokens) are missing. Default every context field with `??` (arithmetic with null is an error in Stof), Ex.
count the rest of the held units as output.

## Reservations and estimates

For calls whose usage is only known afterwards (LLM calls, jobs), reserve room first so concurrent calls can't
overspend together:

```stof
// the entitlement says what a call's size scales with, and what separates estimates
chat: { estimate_basis: 'input', estimate_segment: 'model', limit: { credit: 'ai_token', mode: 'soft', value: 2_000_000 } }
```

```stof
const hold = policy.reserve('user_1', 'chat', null, using new { model: 'sonnet', input: 1200 });
if (hold == null) return false;                       // not allowed right now (counts other holds)
// ... run the call ...
policy.settle('user_1', 'chat', hold, 1500, using new { model: 'sonnet', input: 1200, output: 300 });
// or, if it never ran: policy.release('user_1', 'chat', hold);
```

- `reserve(id, ent, value?, context?, basis?, segment?, ttl?, quantile = 0.9, overhead?) -> str` holds `value`, or
  the predicted amount when `value` is null (`estimate` at `quantile`, else the standard increment). Null when the
  call wouldn't be allowed.
- `settle(id, ent, hold, value, event?, overhead?, basis?, segment?)` drops the hold and records the actual usage
  with `force` (it already happened), then learns from it.
- Holds count on their own meter only, expire after `hold_ttl` (10 minutes), and are never billed.
- `estimate(id, ent, basis?, segment?, quantile, context?)` returns `value`, `overhead`, `samples`, `source`, and
  `scope`. It uses the customer's own estimate after `estimate_min_samples` (5), else the policy-wide one.
- **Basis:** `estimate_basis` names the event data field a call's size depends on (Ex. input tokens). Estimates
  learn a line from it: a fixed amount per call plus an amount per unit. That covers a chat answer that is about the
  same length whatever the question, a summary that grows with the text, and anything in between. Until there are 5
  calls with bases that differ, the average call is scaled by the basis (cautious holds). Without a basis, estimates
  are per call. A per-basis call missing the field is logged and not learned from.
- **Segment:** `estimate_segment` names the field that keeps separate estimates (Ex. per model). Keep its values
  few: a model or a feature, never a user or request ID.
- `basis` and `segment` arguments override the event data. A `basis` for an entitlement with no `estimate_basis`
  is ignored (and logged).
- **Predicting part of a call** (Ex. output tokens before the call runs, to set `max_tokens`, size a quote, or
  route to a model): add an entitlement with no `limit`. It is never metered, so it only learns. `observe` the part
  after each call with the call's event data, and `estimate` it before the next. See "Predict output tokens" in
  `references/patterns.md`.

## Events and notifications

Every meter change fires an event: `meter-changed`, `meter-overage` (soft overage after grants: bill its
`overage_price`), `meter-limit` (denied), `meter-governed`, and `meter-reset`. A call denied by a cap fires
`cap-limit`. Customer, cap, and plan changes have their own events. Meter events carry the call's cost
(`meter.overhead_diff`) and list price (`meter.price_diff`), both in runes. Events reach:

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
11. **Expecting `enabled` to give a feature.** It only turns one off; give the entitlement (or change the plan) to
    add it.
12. **Random rollouts.** A random number per call flips a feature between calls; use `customer.bucket(key)`.
13. **Tracking every entitlement.** `track: true` sends an event per check; track what you're measuring.
