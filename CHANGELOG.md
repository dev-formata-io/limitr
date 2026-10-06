# Changelog

The Limitr spec (`src/spec`) defines the engine: policy types, metering, pricing, and events. Every SDK embeds the
same compiled spec, so this changelog covers the spec and the SDKs together. The version is `Limitr.version` in
`src/spec/limitr.stof`, and `pkg.stof` and each SDK package (Ex. `typescript/package.json`) use the same version.

## 0.7.0

Dynamic provider costs, reservations with usage prediction, and memory-safe API calls. Requires Stof 0.10.3.

### Added

- **Per-call overhead cost functions.** `Credit.overhead(units, context?) -> float` prices one call's provider
  overhead in runes. The default is `units * overhead_cost`. A credit in a policy can override it when the cost
  differs per call (Ex. per-model input and output token rates) or changes over time (Ex. a rate table that Cloud
  updates). `context` is the call's event data. If the function throws or returns a non-number, the fixed
  `overhead_cost` is used and the error is logged.
- **Actual cost on `allow()`.** `allow(..., overhead?)` takes the call's real cost (Ex. from the provider's
  response) and skips the cost function.
- **Overhead recorded per period.** `Meter.overhead` is the overhead actually spent this period, the sum of each
  call's overhead. It resets with the meter. Margin breakdowns read it, so a price change mid-period never re-prices
  earlier usage. Meters from before 0.7.0 (`overhead: null`) fall back to `value * overhead_cost`.
- **Overhead in events.** `meter-changed`, `meter-overage`, and `meter-limit` events carry `meter.overhead` (period
  total) and `meter.overhead_diff` (this call). `meter-governed` carries `meter.overhead`.
- **Price in events.** Meter events carry `meter.price_diff`: what the call is worth at list price, in runes (the
  billable units it adds past the limit, priced from the customer's tier position, before grants). Next to
  `overhead_diff`, every event has the call's margin. `meter-overage` adds `overage_price`: the overage grants
  didn't cover, in runes (what to bill). Null for credits with no price. Only computed when the call sends events.
- **`cap-limit` event.** A call denied by a spend cap now sends `cap-limit` with the cap, the customer holding it,
  the caller, and the call's meter values (`diff`, `overhead_diff`, `price_diff`). Before, cap denials were silent.
- **Overhead with no units.** `allow(id, ent, 0, event, null, overhead)` records a cost with no usage (Ex. a failed
  call that still cost you): it sends a `meter-changed` event and moves plain overhead caps.
- **`check(..., context?, overhead?)`** prices the call the same way `allow()` does, so a dry run agrees with the
  real call for overhead caps.
- **`allow(..., force)`** records usage that already happened: it is metered past a hard limit (like a soft one)
  and moves caps past their ceiling. Caps, grant coverage, the governor, and vouchers can't stop it.
- **Reservations.** Hold room for a call before it runs, so concurrent calls can't overspend together:
  - `reserve(id, ent, value?, context?, basis?, segment?, ttl?, quantile = 0.9, overhead?)` returns a hold ID, or
    null when the call wouldn't be allowed right now (the same check as `check()`, counting every other hold).
    Leave `value` null to hold the predicted amount, falling back to the entitlement's standard increment.
  - `settle(id, ent, hold, value, event?, overhead?, basis?, segment?)` drops the hold, records the actual usage
    with `allow(force = true)`, and learns from it. An unknown or expired hold still records the usage.
  - `release(id, ent, hold)` drops a hold without recording anything. `held(id, ent)` is the room held right now.
  - Holds live on `Meter.holds`, count against the meter's limit and the caps checked on calls to it, and are never
    metered or billed. They expire after `Limitr.hold_ttl` (default 10 minutes). Holds must be positive.
  - Another call's hold can deny a call but never turns an in-limit call into overage.
- **Usage estimates.** New `Estimate` type: a recency-weighted mean and variance of a call's value and overhead
  (constant memory, a plain average until 1/alpha samples).
  - **Per-basis estimates are declared on the entitlement:** `estimate_basis: 'input'` names the event data field
    the call's size scales with (Ex. input tokens). Estimates then learn per unit of it and scale each
    prediction by it. `estimate_segment: 'model'` names the field that picks the segment. `reserve`, `settle`,
    `estimate`, and `observe` read both from the call's event data, so hosts only pass what they already have.
    `basis` and `segment` arguments override them. A per-basis call without its basis is logged, and isn't
    learned from (it is still metered). Changing `estimate_basis` starts an estimate over.
  - `estimate(id, ent, basis?, segment?, quantile = 0.9, context?)` predicts one call: `value`, `overhead`,
    `samples`, `source` ('local' or 'cloud'), and `scope` ('customer' or 'policy').
  - `observe(id, ent, value, overhead?, basis?, segment?, context?)` records a call without a reservation.
    `settle()` calls it for you.
  - Policy-wide estimates are at `Limitr.estimates.<entitlement>.<segment>`, each customer's at
    `Meter.estimates.<segment>`. A customer's own estimate is used once it has `Limitr.estimate_min_samples`
    (default 5) observations. Segments must stay low-cardinality: a model or a feature, never a user or request ID.
  - Estimates are plain policy data, so Cloud can seed them or replace them with pooled numbers (`source: 'cloud'`).
- **TypeScript:** `allow(..., overhead?, force?)`, `check(..., context?, overhead?)`, and new `reserve(customer,
  entitlement, options)`, `settle`, `release`, `held`, `estimate(customer, entitlement, options)`, and
  `observe(customer, entitlement, value, options)` methods, with the `LimitrEstimate`, `LimitrReserveOptions`,
  `LimitrEstimateOptions`, and `LimitrObserveOptions` types.

### Changed

- **Breaking: the policy lives at `root.policy`, and `<Limitr>.api` is gone.** Call the policy's functions
  directly (`root.policy.allow(...)`, or `'policy.allow'` from an SDK's document). `<Limitr>.load()` gives
  `root.policy` its `Limitr` type (a policy parsed from JSON, YAML, or TOML has none) and returns it; SDKs call it
  once after loading or replacing a policy. A policy elsewhere in the document, or marked `#[limitr]`, is no longer
  found. The former `api`-only functions are policy functions now: `policy_bstf`, `difference_bstf`,
  `update_policy_internals`, `update_customer_internals`, `update_customer_invoices`, `set_notifications`,
  `set_capabilities`, and `claude_tools(customer_id?)` / `claude_tool_use(json, customer_id?)`, which take and
  return JSON (they replace the policy's object-based versions of the same names).
- **`limitr.stof` reads top to bottom:** public functions first, grouped by area (the policy, metering,
  reservations and estimates, reads, customers, spend caps, plans and credits, margins, notifications and
  capabilities, sync), then one marked Internal section. Helpers that belong to a type moved to it:
  `Entitlement.estimate_inputs`, `Meter.estimate`, `Customer.ensure_meter`, and `<Estimate>.key`.
- **Requires Stof 0.10.3.** The spec uses `using` declarations, `Lib::func` library calls (Ex. `Time::now()`,
  `Num::round()`), and unary `typeof`. The TypeScript package depends on `@formata/stof` 0.10.3 or later.
- **No document growth per call.** `allow()` and `check()` keep each call's temporary objects (event objects,
  call-scoped caps, event data parsed from a string) in a scratch object that is dropped on every return path.
  `Customer.caps_from_arg(arg, arena?)` creates temporary caps on that arena. The API helpers
  (`update_policy_internals`, `difference_bstf`, `set_notifications`, `set_capabilities`, `claude_tools`,
  `claude_tool_use`) drop their temporaries on every path too. The document only grows with customers, meters,
  holds, and estimate segments.
- **Event data passed as an empty string** (`allow(..., event = '')`) gives a cost function a null context. Before,
  it was an empty object.
- **TypeScript:** HTTP requests from the policy use Stof's `allowHttp()` instead of a custom fetch library.

### Fixed

- A Claude `tool_use` with input left an object in the document on every call (`Capability.claude_tool_use`).
- A call denied right after a period boundary left last period's usage on the meter, so the next call added to it.
  The new period now starts from zero even when the first call in it is denied.
- `set_customer_plan(..., overwrite_meters = true)` left each replaced meter in the document, unreferenced. It is
  now dropped.
- API helpers left temporary objects in the document on error and early-return paths.

## 0.6.21

Billing-correctness release for tier-priced credits, periods, and caps. Flat and exchange-pair credits produce the
same results and events as 0.6.20.

### Added

- **Tier position.** Tiered, volume, and stairstep credits are priced from where the customer already is this period
  (meter minus limit before the call), not as if every call were the first units. Applies to caps, grant coverage
  and draw-down, `limit()`, `remaining()`, `projected_exhaustion()`, and the voucher guard. New pricing functions:
  `Credit.priced`, `total_price`, `band`, `price_of`, `quantity_for`, and `Exchange.resolve` / `from_runes`.
- **Shared caps.** `Cap.shared` applies a cap to every customer whose refs lead to the holder (Ex. an org budget
  shared by its teams and users), optionally filtered by caller type with `shared_with`. A `customer-set` event
  fires for each other customer whose cap moved on a call.
- **Cap `hard_trailing`**, like `Limit.hard_trailing`: a call is allowed while the cap is under its ceiling before
  the call, and every call after the crossing is denied until it resets.
- **Entitlement scope through ref chains.** A scoped entitlement resolves to the nearest customer of that type
  through refs (user, then team, then org). A caller with no such customer is denied (before, it was metered on the
  caller).

### Changed

- **1e-9 decision precision.** Limit, cap, threshold, grant-coverage, voucher, and governor decisions compare at
  1e-9, so float drift can't flip them (Ex. a $2.40 cap now allows 6 x $0.40). Storage keeps full precision, and
  event numbers and read results are rounded to 1e-9.
- **Reads show the current period.** After a period boundary, `value()`, `remaining()`, `allowance()`, `rate()`,
  `acceleration()`, and projections show the new period right away instead of waiting for the next `allow()`.
  Reads roll resetting grants forward too.
- Resets no longer depend on `valid()`: limits, caps, and topup grants that reset without an interval default to
  30 days wherever they are used (before, `set_plan`, Cloud updates, and unvalidated policies never reset).
- Caps on a call are the caller's own caps, shared caps up its refs, and call-scoped caps. The meter owner's
  unshared caps no longer apply to other callers.
- `allowance()` includes governor refill since the last call. The customer margin breakdown uses the current period.

### Fixed

- `check()` ignored the governor, so `check()` and `allow()` could disagree.
- After a period reset, grant-backed hard limits were priced from last period's meter, which made calls free up to
  last period's total.
- `resets()` advanced the meter's period without zeroing its value, so last period's usage carried over.
- Grant-covered hard-limit calls weren't recorded in rate history.
- Volume band crossings could add balance to grants and vouchers. Their negative marginal price is now clamped at
  zero for grants and vouchers, and applied to caps (it is real consumption).
- A stairstep top band couldn't be bought with grants (its inverse is now `Credit.UNBOUNDED_QUANTITY`).
- Soft overage with a resetting grant drained to exactly 0 looped forever in `allow()`.
- An exchangeable cap in a stairstep-priced credit blocked every call. It is now rejected at creation and ignored
  if loaded another way.
- Topup grants are removed correctly when their topup is removed from the plan.

## 0.6.20

- Margin measurement helpers on caps (`startMarginMeasurement` / `captureMarginMeasurement` in TypeScript), with
  multi-currency support.
- `usd` is in the exchange table by default (1 usd = 1 rune).

## 0.6.19

- **Overhead caps** (`Cap.overhead_cost`): cap provider overhead instead of customer spend.
- **`Limit.hard_trailing`**: deny on the meter before the call, so one call may cross the limit.
- Event data on `allow()`: an object or string carried on the call's events as `event_data`.

## 0.6.18

- `Cap.overage_only`: only usage past the plan's included amount counts against the cap.

## 0.6.17

- **Customer spend caps**: standing caps (`add_customer_cap`) and call-scoped caps on `allow()`, `observe_only`
  caps, cap reset schedules, and the `cap-threshold-crossed` event.

## 0.6.16

- Yearly and quarterly calendar reset schedules (`yearly:M-D`, `quarterly:D`).

## 0.6.15

- **Limit governors**: a token-bucket rate ceiling below a hard limit (`governor_enabled`, `governor_capacity`,
  `governor_refill_rate`), with the `meter-governed` event and EWMA rate tracking.
- Calendar reset schedules (`reset_sch`) for limits, topups, and grants.

## 0.6.14

- `meter_obj`, `limit_obj`, and `resets` reads.

## 0.6.12

- Credit grant burndown for hard limits, `credit_exchange`, `credit_remaining`, `ensure_included_topups`, and
  `ensure_plan_subscription`. `limit()`, `remaining()`, and `value()` can include grants.

## 0.6.0 - 0.6.10

- Plan periods, trial periods, and plan subscription entitlements (0.6.0).
- Topup grants linked to their topup, and topups included with a plan by customer type (0.6.5).
- An `event` flag on `increment()`, `decrement()`, and `allow()` to turn events off for a call (0.6.6).
- Percent results for `remaining()` and `value()` (0.6.8).

## Before 0.6.0

The 0.5 series added policy validation (`valid()`, 0.5.20), tiered credit pricing (0.5.25), credit overhead costs
(0.5.28), capabilities and Claude tool use (0.5.37), margin snapshots and notifications (0.5.42), and policy
diffs. See the git history for details.
