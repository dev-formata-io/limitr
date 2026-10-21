# Changelog

The Limitr spec (`src/spec`) defines the engine: policy types, metering, pricing, and events. Every SDK embeds the
same compiled spec, so this changelog covers the spec and the SDKs together. The version is `Limitr.version` in
`src/spec/limitr.stof`, and `pkg.stof` and each SDK package (Ex. `typescript/package.json`) use the same version.

## 0.7.4

### Added

- **TypeScript: the SDK tells Limitr Cloud its version.** `Limitr.cloud` sends a `hello` message with
  `LIMITR_SDK_VERSION` (now exported) before it asks for the policy, and Cloud replies with the features it supports.
  An SDK older than the server supports gets a clear `sdk-unsupported` message (logged with `console.error` and sent
  to handlers as `sdk-unsupported`) instead of a policy it can't load.
- **TypeScript: the SDK keeps its own engine on Limitr Cloud.** The SDK says in `hello` that it can take a
  policy-only push (`policy-source`). Cloud then sends the policy, its functions as Stof source (rollout rules, cost
  functions, capabilities, notifications, and the Cloud handlers), and the customers, and the SDK loads them into the
  engine it ships with, parsing the functions with its own Stof runtime. Before, Cloud's first push replaced the whole
  engine with the server's, so every SDK had to be able to read the server's engine version.
  A policy Cloud keeps as a Stof document is sent as the document itself (`source`, with its functions and
  capabilities in it), and the SDK loads it with `update_policy_internals(source, 'stof')`.
- **TypeScript: batched Cloud messages.** When the server supports it (its `hello` reply lists `batch`), the SDK
  collects usage and customer updates for `batchMs` (250 by default, `0` to turn it off) and sends them together.
  Cloud records each customer's batch at once. Batches are sent on `close()` too.
- **TypeScript: topups are paid before they're granted on Limitr Cloud.** When the server supports it (`topup-purchase`
  in its `hello` reply), `applyCustomerTopup` asks Cloud to buy the topup. Cloud charges for it, then sends the
  customer with the new grant, and the call resolves `true` once the grant is here, or `false` if the charge failed.
  A call that hears nothing back within 30 seconds resolves `false`; if Cloud did complete the purchase, the grant
  still arrives with the customer's next update. Before, the SDK granted the topup itself and Cloud charged after.
- **Policy updates carry `estimate_min_samples` and `hold_ttl`** (`update_policy_internals`), so a Cloud policy can
  set them.

### Changed

- **Requires Stof 0.10.8** (`@formata/stof` ^0.10.8). The engine is built with it, and Cloud policies can use what
  0.10.7 and 0.10.8 add: `List.map`, `List.filter`, and `List.any` with a function, async `#[run]` steps that are
  awaited, functions in definition order, the html and xml formats, and `Obj.set` / `Obj.unset`. With 0.10.8, an
  engine holds about half the memory it did.

- **TypeScript: Cloud policies can reach any host over HTTP by default.** `httpHosts` now defaults to `true` (it was
  `['api.limitr.dev']`), so policy capabilities can call the services they list. Pass a list of hosts to allow only
  those, or `false` for no network access. `Limitr.new()` policies still have no network access unless you call
  `limitr.doc.allowHttp(...)`.

### Fixed

- **TypeScript: a reconnected Cloud client stayed out of date.** After a dropped connection, the new connection had
  no subscriptions on the Cloud side, so published policy changes and customer updates stopped arriving. On
  reconnect the SDK now sends `hello` with the customers it holds, and asks for the current policy.

## 0.7.3

### Fixed

- **TypeScript: a throwing event handler no longer fails the call.** An error thrown (or a promise rejected) in a
  handler reached the caller of `allow`, after the usage was already recorded, so a bug in analytics code looked
  like a failed call that had in fact been metered. Handler errors are now logged with `console.error`, the other
  handlers still run, and the call returns normally.
- **A reset schedule means it resets.** A limit, cap, or topup with `reset_sch` and no `resets: true` never reset.
  `reset_sch` now turns `resets` on: in validation, in `create_customer_override` and `add_customer_cap`, and when
  the engine reads limits, caps, and grants (so unvalidated policies, like plans from `set_plan`, reset too).
- **TypeScript: `runCapability` returns objects as records.** An object result came back as an internal node ID; it's
  plain data now (through the new `run_capability_json`). Text, numbers, and lists are unchanged.

### Added

- **Exchange pairs at runtime:** `set_exchange_pair(name, value, currency)` and `remove_exchange_pair(name)` in the
  engine, and `setExchangePair`, `exchangePair`, and `removeExchangePair` in TypeScript. A pair that doesn't reach
  runes (an unknown currency or a cycle) is refused, and the old rate stays.
- **The stof skill ships in the npm package** (`skill/stof`, copied from `skill/stof` in this repo at publish), next
  to the limitr and limitr-ts skills, so agents have the language reference for writing and overriding policies.
- Tests for capabilities, exchange pairs, reset schedules, and overriding engine functions.

### Docs

- **Overriding engine functions:** extend `Limitr` with a type (or put the function on the policy) and call the
  engine's version with `self.allow<Limitr>(...)`. Overrides keep the engine function's signature, since SDKs pass
  arguments by position.
- **Capabilities:** `#[run]` steps are plain functions that `await` async work inside (an `async fn` step is started
  without waiting for it).
- The TypeScript SDK comment on the call time limit says "in-process" instead of a timing figure.
- **AI pricing per model.** The skills and tutorial present a credit per model and direction (`sonnet_input`,
  `sonnet_output`) as the default for AI usage, with patterns for gating it (gate before and bill after, control in
  your own count next to per-model billing, one budget across models), and selling them as one abstract AI credit
  through the exchange. A cost function is for metering one unit across models.
- **The exchange** is documented as converting any credit into any other: abstract credits over discrete ones, prices
  set through the exchange, currencies, and live rates (`get_pair`).
- **Control and monetize** can share one entitlement; the docs say when to split them.
- **Capabilities** are described as general functions for the host app, services, and AI tools, including loading
  data from an API.
- Tutorial code samples are shorter per line and easier to read; chapter 4 no longer prints a date that changes
  every month.

## 0.7.2

### Fixed

- **Customer and alt IDs with a period are refused.** The policy finds customers by '.' paths, so before, an ID with
  a period (Ex. an email) created nothing usable, silently. `create_customer` and `set_customer` now return null,
  `set_alt_customer_id` returns false, and loading a customer or policy skips the ID, each with an error logged
  (`<Customer>.valid_id`). To use an email, replace its periods with your own placeholder, or keep it in metadata.
- **Calendar grants start in the current period.** A grant on a `reset_sch` schedule was reset on its first read,
  so a new `reset_mode: 'add'` grant doubled. Grants now record the current period when they're created.
- **Tool results are text.** `claude_tool_use` returned a number as a number when a capability's result came from a
  typed function; it's always a string now, as the Claude API expects.
- **Capabilities written in a policy** are named after their field in `claude_tools()` (before, their name was
  empty unless they were added with `set_capabilities`).
- **TypeScript:** `ensureCustomer` returns false when the customer couldn't be created (no plan resolves, or the ID
  has a period), and `loadCustomers` uses each record's own `id` when it has one.

### Changed

- **Included topups follow plan changes.** `set_customer_plan` now moves a customer's included topup balances to the
  new plan (no separate `ensure_included_topups` call). A balance carries into the new plan's included topup in the
  same credit, by that topup's new `plan_change` field:
  - `'top_up'` (default): raise the balance to the new topup's value, never lower it. Downgrades keep the larger
    balance, and moving between plans can't add more than the larger plan's amount.
  - `'replace'`: start over at the new topup's value.
  - `'keep'`: leave the balance as it is until the next reset.

  The grant then follows the new topup's definition (resets, expiry, rollover). Purchased topups stay with the
  customer and keep following the plan they were bought on. An included balance the new plan has nothing for, in
  that credit and for that customer type, is removed. Grants record the plan their topup came from (`Grant.plan`);
  grants from before 0.7.2 are treated as coming from the plan being left.
- **Docs:** the limitr skill corrects the shared cost function note (a shared `overhead` function's `self` is not
  the credit), the `internal-self-updated` event name, and removes a plan reuse example that didn't validate. The
  README and tutorial say "in-process" instead of timing figures, and the tutorial and skills no longer use an email
  as an alt ID.

## 0.7.1

### Changed

- **The npm package's README is the repository's README.** `npm run readme` (part of `prepublishOnly`) copies
  `README.md` and `LICENSE` from the repository root into the package, so the two can't drift apart. The README was
  rewritten, and the package now ships its license file.
- **npm package details:** a description, author, issue tracker, the `typescript` directory in `repository`, and
  more keywords.

## 0.7.0

Dynamic provider costs, reservations with usage prediction, feature flags with per-customer access, and memory-safe
API calls. Requires Stof 0.10.6.

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
    the call's size depends on (Ex. input tokens). Estimates then learn a line from it: a fixed amount per call
    plus an amount per unit, so a short question with a long answer predicts a long answer, and a summary still
    grows with its text. Until there are 5 calls with bases that differ (`Estimate.fitted()`), the average call
    is scaled by the basis. `estimate_segment: 'model'` names the field that picks the segment. `reserve`, `settle`,
    `estimate`, and `observe` read both from the call's event data, so hosts only pass what they already have.
    `basis` and `segment` arguments override them. A per-basis call without its basis is logged, and isn't
    learned from (it is still metered). Changing `estimate_basis` starts an estimate over.
  - `estimate(id, ent, basis?, segment?, quantile = 0.9, context?)` predicts one call: `value`, `overhead`,
    `samples`, `source` ('local' or 'cloud'), and `scope` ('customer' or 'policy').
  - `observe(id, ent, value, overhead?, basis?, segment?, context?)` records a call without a reservation.
    `settle()` calls it for you. An entitlement with no limit is never metered, so it can learn part of a call
    on its own (Ex. output tokens from input tokens, to predict an answer's length before the call).
  - Policy-wide estimates are at `Limitr.estimates.<entitlement>.<segment>`, each customer's at
    `Meter.estimates.<segment>`. A customer's own estimate is used once it has `Limitr.estimate_min_samples`
    (default 5) observations. Segments must stay low-cardinality: a model or a feature, never a user or request ID.
  - Estimates are plain policy data, so Cloud can seed them or replace them with pooled numbers (`source: 'cloud'`).
- **Feature flag rules.** An entitlement's optional `enabled` decides whether it's on for a call, after the
  customer's plan, gives, and takes: absent (on), a bool (`false` is a kill switch for everyone), or a function
  `(customer, entitlement, context?) -> bool`, written inline or as a field pointing at a shared one (Ex.
  `enabled: <Rollouts>.beta_or_quarter`). It only narrows, gates new usage only (`check`, `allow`, `reserve`; never
  `settle` or a decrement), and a rule that fails is off (logged).
- **Stable rollout buckets.** `customer.bucket(key)` is a number from 0 to 99 that never changes for a customer and
  key, and each key splits customers independently. It's `<Customer>.hash('<key>:<customer id>') % 100`, where
  `hash` is FNV-1a (32-bit, UTF-8) then MurmurHash3's fmix32, so a server computes the same number.
- **`features(id, context?)`** lists the entitlements a customer can use right now.
- **`track: true`** on an entitlement sends `feature-checked` (`customer`, `caller`, `entitlement`, `enabled`,
  `plan`, `event_data`) each time it's checked, for measuring rollouts and experiments.
- **Give and take entitlements per customer.** `give_entitlement(id, entitlement, plan?, expires?)` gives a customer
  an entitlement whatever its plan says, using the definition from `plan` or the closest plan that has it (no plan
  defines it: false). `take_entitlement(id, entitlement, expires?)` denies one the plan has, keeping its meter and
  overrides. `restore_entitlement` undoes either. Both are stored on the customer (`given`, `taken`), last through
  plan changes, and are inherited the way plans are (users on their org's plan get the org's). Events:
  `customer-entitlement-given`, `-taken`, and `-restored`.
- **Shared cost functions.** A credit's `overhead` can be a field pointing at a shared function (Ex.
  `overhead: <Costs>.per_model`).
- **TypeScript:** `allow(..., overhead?, force?)`, `check(..., context?, overhead?)`, and new `reserve(customer,
  entitlement, options)`, `settle`, `release`, `held`, `estimate(customer, entitlement, options)`,
  `observe(customer, entitlement, value, options)`, `features(customer, context?)`, `giveEntitlement`,
  `takeEntitlement`, and `restoreEntitlement` methods, with the `LimitrEstimate`, `LimitrReserveOptions`,
  `LimitrEstimateOptions`, and `LimitrObserveOptions` types. `LimitrCustomer` has `given` and `taken`.

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
- **Requires Stof 0.10.6.** The spec uses `using` declarations, `Lib::func` library calls (Ex. `Time::now()`,
  `Num::round()`), and unary `typeof` (0.10.3). 0.10.4 keeps calls fast as customers are added (dropping a call's
  temporary objects no longer searches the whole document) and fixes the policy diff below. With 0.10.6, a
  capability's `#[run]` steps run in the order they're written (before, functions ran in no set order), and
  `err(..)` lines from the engine (Ex. a cost function that fails) reach the console in JavaScript. The TypeScript
  package depends on `@formata/stof` 0.10.6 or later.
- **TypeScript: a time limit on policy calls.** A policy call that runs longer than 5 seconds fails instead of
  blocking every call after it (Ex. a custom cost function stuck in a loop). Engine calls take a few milliseconds.
  Change it with `limitr.setMaxExecutionTime(ms | null)` or `Limitr.cloud({ maxExecutionTime })`. Before, the limit
  was Stof's default of 2 minutes.
- **No document growth per call.** `allow()` and `check()` keep each call's temporary objects (event objects,
  call-scoped caps, event data parsed from a string) in a scratch object that is dropped on every return path.
  `Customer.caps_from_arg(arg, arena?)` creates temporary caps on that arena. The API helpers
  (`update_policy_internals`, `difference_bstf`, `set_notifications`, `set_capabilities`, `claude_tools`,
  `claude_tool_use`) drop their temporaries on every path too. The document only grows with customers, meters,
  holds, and estimate segments.
- **Event data passed as an empty string** (`allow(..., event = '')`) gives a cost function a null context. Before,
  it was an empty object.
- **TypeScript:** HTTP requests from the policy use Stof's `allowHttp()` instead of a custom fetch library. A Cloud
  policy can only reach Limitr Cloud (`api.limitr.dev`); `Limitr.cloud({ httpHosts })` changes the list (`true` for
  any host, `false` for none). A `Limitr.new` policy has no network access unless you allow it
  (`limitr.doc.allowHttp([...])`).
- **TypeScript:** the compiled engine export is `limitrEngine` (was `limitrApi`), and the npm package ships the
  `limitr` and `limitr-ts` skills in `skill/`. `typescript/tutorial` is a step-by-step tutorial with runnable
  examples, and `content/limitr.zip` and `content/limitr-ts.zip` are the skills packaged for upload.

### Fixed

- A Claude `tool_use` with input left an object in the document on every call (`Capability.claude_tool_use`).
- `create_customer_override` on an entitlement with no limit (a feature flag) failed. It now creates a limit
  (given a `credit`).
- `customer_local_margin_breakdown` only counted the customer's plan's entitlements. It now uses the entitlements
  the customer has (given ones included, taken ones left out).
- Entitlement lookups for a customer took several engine calls per `allow`/`check`. Resolving gives, takes, and the
  plan in one pass makes them slightly faster than before.
- A call denied right after a period boundary left last period's usage on the meter, so the next call added to it.
  The new period now starts from zero even when the first call in it is denied.
- `set_customer_plan(..., overwrite_meters = true)` left each replaced meter in the document, unreferenced. It is
  now dropped.
- API helpers left temporary objects in the document on error and early-return paths.
- `difference_bstf` (and TypeScript `difference`) always reported lists of objects as changed (Ex. a credit's price
  tiers), since it compared the objects by ID. They now match by value (Stof 0.10.4).
- `difference_bstf` with an export of the same policy (or one loaded from the same BSTF) overwrote the policy's
  objects while diffing, leaving it empty. The export is now parsed as a copy (Stof 0.10.4).
- `update_policy_internals(bstf, 'bstf')` with an update holding the same objects as the running policy (Ex. Cloud
  resending a policy this engine loaded from Cloud) emptied the policy's plans and credits. It now replaces them
  (Stof 0.10.4).

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
