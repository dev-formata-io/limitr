# Engine API

Functions on the policy at `root.policy` (`src/spec/limitr.stof`, public sections), called on it directly:
`root.policy.allow(...)` in Stof, `'policy.allow'` from an SDK. `<Limitr>.load()` types `root.policy` as a
`Limitr` (a policy parsed from JSON, YAML, or TOML has no type) and returns it. Functions in the file's
Internal section are helpers, not API.

`id` is a customer ID or alt ID. Where noted, it can also be a plan ID (plan-level reads). Values are in the
credit's units unless they say runes. Optional parameters (`name?`) default to null. Stof calls can name
arguments: `policy.add_customer_cap('org_1', 50, id = 'monthly', resets = true, reset_sch = 'monthly:1')`.

## Metering

| Function | Returns | Notes |
|---|---|---|
| `allow(id, entitlement, value = 0, event = true, cap = null, overhead?, force = false)` | bool | Decide and meter. See SKILL.md. |
| `check(id, entitlement, value = 0, cap = null, context = null, overhead?)` | bool | Same decision, no changes. |
| `features(id, context = null)` | list | Entitlement names the customer can use now (plan, less taken, plus given, `enabled`). Access, not capacity. Null if no customer. |
| `increment(id, entitlement, event = true, cap = null)` | bool | `allow` with the limit's `increment`. |
| `decrement(id, entitlement, event = true, cap = null)` | bool | `allow` with minus the increment. |
| `check_increment(id, entitlement, cap = null)` / `check_decrement(...)` | bool | |

`value` can be a string with units. `event` is true, false, an object, or a Stof/JSON string (event data and cost
function context). `cap` is a `Cap` or a map of credit to ceiling. `overhead` is the actual cost in runes.
`check`, `allow` (unless `force`), and `features` apply an entitlement's `enabled` rule to usage (value >= 0) and
send `feature-checked` for `track: true` entitlements.

## Reservations and estimates

| Function | Returns | Notes |
|---|---|---|
| `reserve(id, entitlement, value?, context?, basis?, segment?, ttl?, quantile = 0.9, overhead?)` | str | Hold ID, or null if not allowed now. |
| `settle(id, entitlement, hold_id, value = 0, event = true, overhead?, basis?, segment?)` | bool | Drop the hold, `allow(force = true)`, learn. |
| `release(id, entitlement, hold_id)` | bool | Drop a hold. False if there was none. |
| `held(id, entitlement)` | float | Room held by unexpired holds. |
| `estimate(id, entitlement, basis?, segment?, quantile = 0.9, context?)` | map | `value`, `overhead`, `samples`, `source`, `scope`, or null. |
| `observe(id, entitlement, value, overhead?, basis?, segment?, context?)` | bool | Learn from a call without a hold. |

`context` / `event` (the call's event data) supplies the entitlement's `estimate_basis` and `estimate_segment`
fields. `basis` and `segment` arguments override them.

## Reads

These meter nothing and show the current period (0 after a pending reset).

| Function | Returns | Notes |
|---|---|---|
| `value(id, entitlement, percent = false, grants = true)` | float | Meter value this period (percent of the limit). |
| `remaining(id, entitlement, percent = false, grants = true)` | float | Limit minus value, plus grants when `grants`. Null for `observe` limits. |
| `limit(id, entitlement, grants = true)` | float | The limit in meter units, plus converted grants when `grants`. `id` can be a plan. |
| `allowance(id, entitlement, grants = true)` | float | What can run right now: `remaining`, capped by governor tokens. |
| `cost(id, entitlement)` | float | The standard increment. `id` can be a plan. |
| `resets(id, entitlement)` | ms | When the meter next resets, or null. |
| `rate(id, entitlement)` / `acceleration(...)` | float | Consumption per ms, and its change. |
| `projected_exhaustion(id, entitlement, smoothed = false, grants = true)` | ms | When the limit is reached at the current rate, or null. |
| `meter_obj(id, entitlement)` / `limit_obj(...)` | Meter / Limit | The live objects (scope and overrides resolved). Don't mutate. |
| `entitlement(id, entitlement)` | Entitlement | For a customer: as it has it (gives and takes resolved, `enabled` not applied). `id` can be a plan. |
| `customer_entitlements(id)` | list | `(name, Entitlement)` pairs the customer has (plan, less taken, plus given). |
| `credit(id)` / `credit_for(id, entitlement)` | Credit | |
| `credit_exchange(in, out, value = 1)` | float | Convert between credits and currencies. |
| `set_exchange_pair(name, value, currency)` | bool | Add or replace a pair. False, with nothing changed, for `rune`, a negative value, or a pair that doesn't reach runes. |
| `remove_exchange_pair(name)` | bool | A priced credit goes back to its own price. `rune` and `usd` stay. |
| `credit_remaining(customer_id, credit)` | float | Grant balance in `credit` (other credits converted). |

## Customers

| Function | Returns | Notes |
|---|---|---|
| `create_customer(id, plan = '', type = 'user', label = 'User', refs?, alts?, metadata?)` | Customer | Creates meters and included topup grants. An existing ID is updated. Null if no plan resolves, or the ID contains a period. |
| `set_customer(stof, event = true)` | Customer | Replace a customer from its Stof/JSON (Ex. loaded from your database). |
| `customer(id)` / `customer_metadata(id)` / `customer_refs(id)` | | |
| `set_customer_refs(id, refs)` | bool | |
| `set_customer_plan(id, plan, overwrite_meters = false)` | bool | Keeps meters unless `overwrite_meters`. Moves included topup balances by the new plan's `plan_change`. |
| `delete_customer(id)` | bool | |
| `set_alt_customer_id(id, alt, event = true)` / `delete_alt_customer_id(alt, event = true)` | bool | False for an alt ID with a period. |
| `create_customer_override(id, entitlement, expires?, credit?, mode?, value?, increment?, resets?, reset_inc?, reset_sch?)` | Limit | Per-customer limit. Unset fields copy the current limit. |
| `remove_customer_override(id, entitlement)` | bool | |
| `give_entitlement(id, entitlement, plan?, expires?)` | bool | Give an entitlement whatever the plan says, defined by `plan` or the closest plan that has it. False if no plan has it. |
| `take_entitlement(id, entitlement, expires?)` | bool | Deny it even though the plan has it. Meters and overrides are kept. |
| `restore_entitlement(id, entitlement)` | bool | Undo a give or take. False when there was neither. |
| `closest_plan_with(customer, entitlement)` | Plan | The plan a give without `plan` uses. |
| `apply_customer_topup(id, topup)` | bool | Grant a plan topup (after the customer paid for it). |
| `ensure_included_topups(id, event = true)` | | Create grants for `included` topups now. |
| `ensure_plan_subscription(id)` | bool | Charge the plan's subscription entitlement once (after the trial). |

## Caps

| Function | Returns | Notes |
|---|---|---|
| `add_customer_cap(customer_id, value, id = '', credit = 'rune', exchangeable?, ignore_grants = false, overage_only = false, observe_only = false, overhead_cost = false, follow_decrements = false, scope?, resets = false, reset_inc?, reset_sch?, expires_on?, events = true, hard_trailing = false, shared = false, shared_with?)` | Cap | `id` is the cap ID (generated when empty). Null if that cap exists or the credit is unknown. |
| `customer_cap(id, cap_id)` | Cap | |
| `reset_customer_cap(id, cap_id, events = true)` | bool | Zero its `meter_value`. |
| `remove_customer_cap(id, cap_id, events = true)` | bool | |

## Plans and policy

| Function | Returns | Notes |
|---|---|---|
| `valid()` | bool | Schema-check the policy. Error in `<LimitrValidation>.error_message`. |
| `plan(id, default = true)` | Plan | Plan ID or customer ID, falling back to the default plan. |
| `plan_for(customer_id, default = true)` / `default_plan()` | Plan | |
| `set_plan(id, stof)` / `delete_plan(id)` | Plan / bool | Add or replace a plan from Stof. |
| `plan_period(id)` / `plan_trial_period(id)` / `plan_sub_entitlement_name(id)` | | |
| `set_notification(name, note)` | | |
| `capability(name)` / `set_capability(cap)` / `run_capability(name, args = map(), customer_id?)` | | |
| `run_capability_json(name, args = map(), customer_id?)` | str | `{ "result": ... }` as JSON, for SDKs (objects come back as data). |
| `customer_local_margin_breakdown(customer_id)` | map | Revenue, cost (recorded overhead), and margin this period. |
| `local_margin_breakdown(plan, entitlements, scaled = true)` | map | Margin for hypothetical usage (entitlement -> value, or a map with `value`, `overhead`, `context`). |

## Notifications, capabilities, and sync

| Function | Returns | Notes |
| --- | --- | --- |
| `set_notifications(contents, format = 'stof')` / `set_capabilities(contents, format = 'stof')` | | Register every object in `contents`. |
| `claude_tools(customer_id?)` | str | Claude tool definitions as JSON (`{ "tools": [...] }`), filtered by customer access. |
| `claude_tool_use(tool_use_json, customer_id?)` | str | Run a `tool_use` against its capability; the `tool_result` as JSON, or null. |
| `policy_bstf()` / `difference_bstf(bstf, symmetric = false)` | blob / str | Export the policy; diff another export against it (JSON). |
| `update_policy_internals(updated, format = 'json')` | | Replace plans, credits, exchange, notifications, capabilities; add new customers (Cloud). |
| `update_customer_internals(customer, format = 'json')` / `update_customer_invoices(content, format = 'json')` | | Replace a customer, or its invoices (Cloud). |
