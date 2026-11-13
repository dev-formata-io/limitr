# Changelog

The Limitr spec (`src/spec`) defines the engine: policy types, metering, pricing, and events. Every SDK embeds the
same compiled spec, so this changelog covers the spec and the SDKs together. The version is `Limitr.version` in
`src/spec/limitr.stof`, and `pkg.stof` and each SDK package (Ex. `typescript/package.json`) use the same version.

## 0.8.6

### Added

- **Decision details on `allow()` and `check()`.** A new last parameter, `detail = false`: with it, both return a map
  instead of a bool, saying what was decided and why. `reason` is null when allowed, else one of `no_customer`,
  `expired`, `not_entitled`, `taken`, `no_scope`, `disabled`, `cap`, `governor`, `limit`, or `held`, so every way a
  call can be refused is told apart. The map also has whose meter it is, the call's value, and where the customer
  stands (after the call for `allow()`, as things are for `check()`): `used`, `limit`, `remaining`, `allowance`,
  `held`, `resets`, `access`, and `limit_source`, plus `cap` and `cap_customer` for a cap, and `available` for a
  governor. Without `detail` nothing changes: both still return a bool, and the hot path only adds a branch.
  16 tests in `src/tests/decisions.stof`.
- **TypeScript:** `allow(..., force, detail)` and `check(..., overhead, detail)` overloads return a typed
  `LimitrDecision` (with `LimitrDecisionReason`) when `detail` is true. A call the Cloud connection check refuses
  reports `unconnected` or `no_customer`.

### Changed

- **Holds spend the governor.** `reserve()` lets a call in, so it now spends a governor's tokens for the amount it
  holds, like `allow()`. `settle()` trues them up to the real usage (below zero when the call used more, since it
  already happened, so the next calls wait for the refill), and `release()` gives them back. Before, a hold only
  checked the governor and `settle()` skipped it, so a rate limit metered only through `reserve()` / `settle()` never
  limited anything. A settle without a known hold (unknown or expired) spends nothing, a hold made when the period
  has ended but the meter hasn't reset spends nothing, and only hard limits are governed, as with `allow()`. 11 tests
  in `src/tests/stacking.stof`.

### Docs

- **Limitr with the Claude Agent SDK** (`typescript/skill/limitr-ts/references/claude-agent-sdk.md`): a recipe that
  governs agents with plain hooks and options, so `query()` stays as it is: tools a customer can't use are hidden
  (`features` into `disallowedTools`), each tool call is decided and counted in `PreToolUse` (denied with the
  decision's reason), each model response is metered from the stream (once per response ID, subagents included),
  and a run stops in `PostToolBatch` when its tokens run out. Typechecked against `@anthropic-ai/claude-agent-sdk`
  0.3.323, tested against the engine with the hooks' real input shapes, and checked live (a denied tool call's
  reason reaches the model; a run out of tokens stops before its next model request). The tested copy, its tests,
  and the live check are in `typescript/recipes/claude-agent-sdk/`.
- **Limitr with the Claude Messages API** (`typescript/skill/limitr-ts/references/claude-messages.md`): a recipe
  around each `client.messages.create` call and each tool use in the app's own loop: only the tools a customer can
  use are offered, the input is counted, a hard token limit caps `max_tokens` at what's left (less what calls in
  flight hold), room for the whole call is held while it runs and the real usage settled after (an API error
  releases it), and refused tool uses are answered with a `tool_result` carrying the reason. Typechecked against
  `@anthropic-ai/sdk` 1.8.0, tested against the engine, and checked live (a refused tool use's reason reaches the
  model; `max_tokens` keeps a call within the tokens left, and the next call is refused before the API). The tested
  copy, its tests, and the live check are in `typescript/recipes/claude-messages/`.
- **Stacking entitlements, in an order that never half-counts:** gates (`check`), then holds (`reserve`), then counts
  (`allow`), releasing the holds when a count is refused, then `settle`. Tutorial chapter 8 is rewritten around it,
  with the limitr skill's patterns and reservation notes, the limitr-ts skill, and 2 tests in
  `src/tests/stacking.stof`.

## 0.8.5

### Added

- **Limitr Network 0.1: the Limitr Network Protocol (LNP).** `src/network/` (see `src/network/SPEC.md`): one policy
  uses another's services and pays for them, peer to peer, with signed messages and no shared secrets. A provider
  publishes its terms from its policy; a consumer signs a voucher (a plan, a spend in runes, an expiry); the provider
  meters a voucher customer with the spend as a cap and grants the routes (and tools) its plan reaches; every request
  is signed, checked for replay, metered, and answered with a signed receipt. It's a module compiled next to the
  engine (`typescript/limitr.ts` exports `limitrNetwork`) and loaded only by policies that use it. Every shape is a
  Stof type with schemas (`src/network/spec/`), so the policy's `network` is checked like the rest of it (the
  policy's `valid()` runs it), and the whole protocol, HTTP included (`Http::fetch`, at most
  `network.request_timeout` and `network.max_response`), runs in the policy: an SDK in any language only holds the
  key, allows the hosts, and converts requests. Digests are plain SHA-256 of text (the terms travel as JSON text, so
  a voucher agrees to their exact bytes). URLs must be https (http only to localhost); peers check versions; every
  wire name derives from one constant (`limitr-network`). 75 tests in `src/network/tests/`, run by `stof test` with
  the engine's.
- **Routes and tools.** A provider declares **routes** (`network.provider.routes`: what a request may do; every
  request is checked and metered by its policy, whoever's code made it), and each is a tool on the consumer's side
  as-is (no Stof needed). A provider can also ship **tools** of its own (`network.provider.tools`, functions in
  `network.provider.logic`, Stof source that's part of the terms). They run on the consumer's side only when it
  trusts the provider's logic (`trust: 'logic'`; `'declarations'` is the default): parsed as untrusted source, sealed
  and confined (nothing of the consumer's policy, no hosts, only `<Network>.TOOL_LIBS`, `network.tool_time` per run),
  reaching the provider only through a gate, `self.api.call(route, args)`, which signs requests for that voucher only.
  With `may_call`, a trusted provider's tools can call the consumer's other connections' routes. A refused request is
  the tool's result (`{ "refused": { ... } }`, and a `network-refused` event); a failed tool is
  `{ "failed": { ... } }`.
- **Metering: a cap for each request, receipts after the work.** A request's work meters the voucher's customer like
  any Limitr customer (`allow()`, `reserve()`/`settle()`), and a cap the module puts on it for the request
  (`network_request`) measures what it spent. A route's declared `entitlement` is optional (metered before the work);
  without one the work meters, and a request nothing meters is free. With a state operator the request first holds
  what it may spend (the route's quote, its `hold`, or the voucher's spend times `config.hold`), and the cap enforces it.
  The consumer can cap each request (`connect(..., max)`, signed into it). Receipts are made after the work
  (`{ voucher, n, allowed, cost, body, spent, remaining, budget_remaining }`, `body` the response body's SHA-256),
  and the consumer refuses a 2xx response without a matching one. Hosts call `done(customer, n, body)` after the work
  (`serve(request, work)` does it all for a Stof function; TypeScript `handle` does it, one request at a time per
  voucher).
- **Terms in runes.** A provider's terms state its rune (`rune: { value, currency }`, from its exchange) and price
  each credit (and its tiers) through the exchange, the way the policy charges it.
- **Operators.** Optional parties both sides trust with roles (`network.operators`, at most one per role): `state`
  (voucher and budget state across any number of provider instances, `strict` by default or `bounded` with leases,
  fail-closed by default when offline; **budgets**: one spend across many providers), `identity`, and `discovery`
  are built; `revoke` and `payment` are contracts (in the spec) for the Cloud operator; extension roles are
  namespaced. Any policy can be an operator (`network.service`, the reference operator, serving state, identity,
  and discovery). An operator is named by its first key and can rotate it (`rotation(newKey)`, published in its
  manifest; policies follow the chain, and a chain that skips a key already followed is refused). An operator with
  `channel: true` is reached through the host instead of HTTP (TypeScript `limitr.network({ channels })`, a
  web-standard function; never a fallback to HTTP).
- **Limitr Cloud as an operator.** On a `Limitr.cloud()` engine whose workspace has Limitr Network, `limitr.network()`
  adds Cloud as `network.operators.limitr`, for each role it serves (state, identity, discovery) that no operator in
  the policy does, and carries its messages over the engine's WebSocket. A policy that names Cloud's operator itself
  keeps its entry and gets the channel. `limitr.network({ cloud: false })` opts out. (`Network.host_operator()` does
  this for any host-carried operator.)
- **Policy updates bring a module's part.** `update_policy_internals` runs every loaded module's
  `#[limitr_policy_updated]` (the policy, the update's policy). The Network module takes a new `policy.network` in
  place and keeps the policy's own state (key, identity, connections, budgets, a provider's leases, an operator's
  vouchers, budgets, and listings), so a policy published on Limitr Cloud changes running engines' networks without
  dropping a connection. The TypeScript SDK runs each module's setup again after an update. Each operator has its
  `name` (its key in `network.operators`, set on load): channels go by it.
- **Identity.** An identity operator signs "this key is <subject>" (`identify()`). A consumer sends its statement with
  every voucher; a provider requires one by default when it has an identity operator (`network.provider.identity:
  'auto'`, `'required'`, or `'optional'`, per plan with `identity_plans`; the terms say which), never lets a voucher
  outlast it, and its work sees who the consumer is (`metadata.network.subject`; TypeScript `call.subject`). A
  provider's statement goes in its manifest, and a consumer with `network.require_identity` connects only to
  providers its identity operator vouches for. An operator can require identity of providers, consumers, or both
  (`service.requires`, in its manifest).
- **Discovery.** A provider lists itself at a discovery operator (`list('public' | 'private', members, subjects)`,
  `unlist()`), and anyone searches it (`discover(query)`). Searches are signed, so private listings show only to their
  members (by key, or by who the operator identified), and results are the providers' own signed manifests, checked
  on the searcher's side, so an index can't forge one.
- **TypeScript: `limitr.network()` and `limitr.module()`.** `await limitr.network({ secretKey, name, channels })`
  loads the Network module (sealed) and gives this policy an identity; the secret key stays in the process, and the
  policy signs through a host function that signs only Network messages. Providers serve
  `network.handle(request, work)`, a web-standard handler (`Request` in, `Response` out, for Deno, Bun, Workers,
  Hono, Next.js, or Node with a small adapter), running `work` only for allowed requests (`{ route, customer,
  subject, query, body }`). Consumers `connect(url, plan, spend, expires, { budget, trust, mayCall, max })`, run the
  provider's tools as capabilities (`runCapability`, `claudeTools`), and `trust`, `update`, `cancel`, or read a
  `connection(name)`. Also `budget()`, `identify()`, `list()`, `unlist()`, `discover()`, `rotation()`,
  `refusal(result)`, `failure(result)`, `checkOperators()`, and `operate(request)` (a policy that is an operator);
  `LimitrNetwork.generateKey()` makes an identity up front.
  Every call sends a `network-receipt` event. `limitr.module(name, bytes)` is the general way to add a sealed module
  to a policy (Cloud documents get the same modules).
- **Demo, docs, and a tutorial track:** `typescript/demos/network/` (a weather service and an agent that buys
  forecasts from it, two processes); `src/network/README.md`; `src/network/PROTOCOL.md`, the wire format with test
  vectors (checked by `src/network/tests/vectors.stof`); `typescript/tutorial/network/`, seven chapters; and a
  `limitr-network` skill.
- **Customer expiry.** `Customer.expires` (ms), set with `set_customer_expires(id, expires)` (TypeScript
  `setCustomerExpires`): from then on the customer has no entitlements, so `allow()` and `check()` refuse. Its
  meters, grants, and caps are kept, and a later time (or null, never) gives its access back. For trials, temporary
  access, and Limitr Network vouchers.

### Changed

- **Stof 0.11.3** (`@formata/stof ^0.11.3`). The engine is compiled with it (`typescript/limitr.ts`); policies,
  customers, and their exports are unchanged. It has what Limitr Network's provider tools build on: parsing source
  from somewhere else as declarations only (the `untrusted` profile), confined seals that limit the libraries a part
  calls (`libs`), how long it runs (`time`), and the functions outside it that it may call (gates, `calls`), and
  (0.11.3) confined code that can't end its caller (`exit`), reach the host's environment, parse files or graphs,
  or keep running after it returns.
- The skills say Limitr needs Stof 0.11.3 or later, and the limitr-ts skill covers Limitr Cloud as an engine's
  operator. The `limitr-network` skill ships with the package (`skill/limitr-network`) and the Claude plugin.

### Removed

- **The old vouchers.** `Customer.ensure_voucher`, the `limitr_voucher*` metadata checks in `allow()` and
  `update_customer_internals`, and the TypeScript SDK's `addVoucher` and `limitr_v1_` customer IDs. They were left
  from an early Cloud proof of concept and never used; Limitr Network replaces them (`src/network/SPEC.md`).

## 0.8.4

### Changed

- **Stof 0.11.0** (`@formata/stof ^0.11.0`). For the engine:
  - **The sealed engine is sealed more tightly.** Code parsed into the document later (a policy, a Cloud
    function) can no longer change the engine's fields in place through a shared list or map, and assigning to a
    sealed field is refused before anything is written.
  - **Destructuring respects `#[private]`:** `const { field } = obj` from outside the object is `null`, like
    `obj.field`.
  - The engine is compiled with Stof 0.11 (`typescript/limitr.ts`). Policies, customers, and their exports are
    unchanged.
  - Stof 0.11 also adds keys and signatures (the `Key` library) and confined seals (`reads`, `hosts`) for code from
    somewhere else, which Limitr Network will build on.
- The skills say Limitr needs Stof 0.11.0 or later. The Stof skill (from `@formata/stof`) covers seals, keys, and
  confinement.

## 0.8.3

### Security

- **The engine is sealed.** The TypeScript SDK seals the engine's types (`LimitrTypes`) right after loading them,
  with Stof 0.10.10's sealing. A policy, a Cloud function, or anything else parsed into the document later can't
  change, remove, or replace the engine's functions, or declare a type with an engine type's name (Ex.
  `#[type] Limitr`); it fails with a "sealed" error and the engine is unchanged. Fields still change as the engine
  runs, and policies customize behavior the same ways as before: functions on their own typed objects (Ex. a
  credit's `overhead`), their own types (including subtypes that override engine functions, Ex. `Limitr MyLimitr`),
  and `#[init]` functions. The engine Limitr Cloud sends on first connect is sealed the same way.
- **Cloud policies stay off your private network.** `httpHosts: true` (the default) now means any public host:
  `localhost`, private network addresses, and the cloud metadata service are refused unless you list them in
  `httpHosts`. (`limitr.doc.allowHttp()` on a `Limitr.new` engine works the same way.)

### Changed

- **Stof 0.10.11** (`@formata/stof ^0.10.11`), for sealing. It also brings a memory limit on every policy call (256
  MB of growth, `limitr.doc.setMaxMemory(bytes)` to change it), private network addresses blocked for `Http`, and
  stricter HTML export.
- The skills say which version they describe (0.8.3) and the Stof version Limitr needs (0.10.11 or later).
- **The stof skill comes from Stof.** `@formata/stof` now ships its skill (`node_modules/@formata/stof/skill/stof`),
  so this package no longer copies it into `skill/stof`; it ships the `limitr` and `limitr-ts` skills. The skills
  say where to find it. `npm run plugin` (part of `prepublishOnly`) refreshes the Claude plugin's skills from
  `skill/limitr`, `typescript/skill/limitr-ts`, and the installed Stof package.

## 0.8.2

### Changed

- **Stof 0.10.9** (`@formata/stof ^0.10.9`). For the engine, that means:
  - **Memory stays flat.** Every `allow()` left about 14 KB in memory for the life of the engine, because Stof kept
    each object a call created and dropped. A long-running engine (Ex. a `Limitr.cloud` instance in a server) now
    stays flat however many calls it checks.
  - **Errors from policy functions say what went wrong.** When an entitlement's `enabled` rule or a credit's
    `overhead` function fails, the engine logs the error's message (Ex. "cannot multiply null: the right value is
    null or missing"), where it logged only an error code. The entitlement is still off, and the call still falls back
    to `overhead_cost`.
  - Policies can use what's new in Stof: messages on asserts (`assert_eq(total, 42, 'total after refunds')`), the
    message of a caught error (`catch (e, message)`), and `Infinity` and `NaN`. The Stof skill in the package covers
    them.
- The skills say which version they describe (0.8.2) and the Stof version Limitr needs (0.10.9 or later).

## 0.8.1

### Fixed

- **A meter kept across a plan change follows the new plan's credit.** `set_customer_plan` keeps a customer's meters
  (without `overwrite_meters`), but a kept meter stayed on the old plan's credit when the new plan prices the same
  entitlement on another one (Ex. a `subscription` on `pro_month`, then on `business_month`), so it was priced and
  limited as the old plan. The meter now takes the new plan's credit, and keeps its value.

## 0.8.0

### Added

- **Rules: one set of changes for many customers.** `policy.rules` holds named rules, each a set of the changes a
  customer can have of its own, in the same shapes: `given` (entitlement -> `{ plan? }`), `taken` (entitlement ->
  `{}`), `overrides` (entitlement -> `Limit`), and `caps` (name -> `Cap`), plus `prices` for Limitr Cloud's invoices
  (the engine doesn't read them), a `label`, and a `priority`. A rule has no customers or dates of its own.
- **`Customer.rules`** lists the rules that apply to a customer, set with `set_customer_rules(id, rules, event =
  true)` (TypeScript: `setCustomerRules(id, rules)`), which sends `customer-rules-set` (`customer`, `rules`,
  `previous`) and `customer-set`. Names the policy doesn't have are kept and skipped. Limitr Cloud sets them from
  contracts.
- **One order everywhere:** for access and for limits, the customer's own change comes first, then its rules
  (highest `priority` first, ties in the order the policy writes them), then its plan. A rule's gives and takes
  reach customers on its plan through refs (users on their org's plan), as the customer's own do; a rule's limit
  applies to the meter of the customer that has the rule, as an override does.
- **Rule caps keep usage per customer:** a customer's copy of a rule's cap is `caps['rule:<rule>:<cap>']`, made
  the first time it's needed, following the rule's definition (usage kept) when the policy changes it, and removed
  when the customer no longer has the rule. A `shared` rule cap on an org covers everyone who refs it.
- **`entitlement_source(id, entitlement)`** (TypeScript: `entitlementSource`) says where a customer's entitlement
  comes from: `access` (`given`, `taken`, `rule:<name>`, `plan`, `ref:<customer id>`, or `default`), `limit`
  (`override`, `rule:<name>`, `plan`, or null), and `customer` (whose meter it is). `rule(name)` returns a rule.
- **Validation:** a rule can't invent entitlements (a give or take needs a plan that defines it, and a named plan
  must define it), its limits and caps are checked like a customer's, its credits must exist, it can't carry dates
  (`expires_on`, `override_expires_on`), and its name can't contain a colon.
- **A semi-annual reset schedule:** `reset_sch: 'semiannual:M-D'` resets twice a year, on month M day D and six
  months later (Ex. `'semiannual:1-1'` is Jan 1 and Jul 1; a day past a month's end is its last day), for limits,
  credit packs, grants, and caps. `Limitr.reset_period_start(now, reset_sch)` gives any schedule's current period
  start. Limitr Cloud bills contract fees on it (a fee invoiced twice a year).

### Changed

- `update_policy_internals` with a whole policy (plans included) replaces the rules too (none when it has none).
  Customers keep their rule names.
- Cap IDs starting with `rule:` are reserved for rule caps: a customer cap with such an ID that no rule of the
  customer's defines is removed the next time the customer's caps are checked. Policies can't use `rules` at the top
  of `policy` for anything else.

### Fixed

- **A meter that resets and is metered back to the same value reports it.** A call that starts a new period (a reset)
  and leaves the meter at the value it had last period (Ex. a fee of 1 a period, or a subscription incremented by 1
  each cycle) sent no `meter-overage`, `meter-changed`, or `meter-reset`, because it compared against last period's
  value. A reset is always a change now, so hosts and Limitr Cloud see each period's usage.
- **A customer Limitr Cloud sends no longer sets back meters this engine changed since** (TypeScript SDK). Cloud reads
  a customer when it sends it; a call metered after that read used to be lost from this engine's meter until Cloud
  sent the customer again. The SDK now has an instance ID (in `hello`) and numbers each message that changes a meter
  (`seq`); Cloud says with each customer the last one it has (`cloud_seq`), and the SDK adds back the rest before
  loading it. Needs a Cloud server with `meter-seq`; with an older server, nothing changes.
- **A customer loaded from Limitr Cloud comes with the customers its refs lead to** (TypeScript SDK). An app that
  asked Cloud for a user got only the user, so a user on its org's plan was on the default plan (and without the
  org's gives, rules, and shared caps) until the app loaded the org itself. The SDK now loads a customer's refs with
  it, at any depth (up to 64), when they change, and before `ensureCustomer` creates a customer with refs.

## 0.7.5

### Added

- **Resets each billing period: `reset_sch: 'period'`.** A limit, topup (and its grants), or cap with this schedule
  resets when the customer's billing period starts again, not on the calendar or a fixed interval from first use.
  The period is the customer's new `period_start` and `period_end` fields: Limitr Cloud keeps them in step with the
  customer's ledger, and without Cloud you set them from your subscription with `set_customer_period`
  (TypeScript: `setCustomerPeriod(id, start, end?)`). `end` is optional (one plan period after the start). Past the
  end, the next period starts at the end and each after it runs the plan's `period`, the same boundary Cloud moves
  to, so a period is never reset twice. A customer with no dates follows the plan's calendar period (the 1st of the
  month, Jan 1, Monday, or midnight UTC). `resets()` gives the period's end. `Customer.billing_period(now, every)` and
  `Limitr.billing_period(customer)` return the period as `[start, end]`.
- **`<LimitrValidation>.valid_reset_sch`**: one check for every `reset_sch`, which now accepts `'period'`.
- **Exchange pair events.** `set_exchange_pair` sends `exchange-pair-set` (`name`, `value`, `currency`, and the
  `previous_value` and `previous_currency`, null for a new pair), and `remove_exchange_pair` sends
  `exchange-pair-removed` (with the rate it had), so a host or Limitr Cloud can record revaluations. Both take
  `event = true` (TypeScript: `setExchangePair(name, value, currency, event)`, `removeExchangePair(name, event)`).

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

- **Meter events carry the call's cap consumption.** `meter-changed`, `meter-overage`, `meter-reset`, and
  `meter-limit` are now sent after the call's caps are updated, so the customer in the event shows what the call
  added to each cap's `meter_value`. Before, they were sent first, and a host or Cloud that keeps the customer from
  the event kept every cap a call behind (Cloud's copies stayed at 0, so a cap never held across an engine restart or
  a Cloud edit).
- **TypeScript: a reconnected Cloud client stayed out of date.** After a dropped connection, the new connection had
  no subscriptions on the Cloud side, so published policy changes and customer updates stopped arriving. On
  reconnect the SDK now sends `hello` with the customers it holds, and asks for the current policy.
- **A plan with a trial and no subscription said nothing.** A `trial_period` delays the plan's subscription, so a
  plan without one is refused; `valid()` now says why (Ex. `Plan "team" has a trial period but no "subscription"
  entitlement for it to delay`) instead of failing with an empty message. Any credit or plan that fails validation
  without its own message now names itself.

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
