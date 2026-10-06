---
name: limitr-ts
description: >
  Use Limitr from TypeScript or JavaScript with the @formata/limitr package: create the engine, load policies and
  customers, gate calls with allow/check, reserve and settle LLM calls, handle events, persist customer state, and
  connect to Limitr Cloud. Use for code that imports @formata/limitr or calls Limitr.new / Limitr.cloud, and for
  integrating usage limits, credits, or pricing into a Node, Deno, Bun, or browser app. Load the limitr skill for
  policy semantics and the stof skill for Stof syntax.
---

# Limitr for TypeScript

`@formata/limitr` embeds the Limitr engine (the Stof spec compiled to BSTF) in a Stof WebAssembly document and
wraps the policy's functions (at `root.policy`) as async methods. It runs in-process in Node, Deno, Bun, and browsers. No network
calls happen in any hot path; Cloud mode syncs over a background WebSocket.

This skill covers the TypeScript API. What a policy means and how a call is decided is in the **limitr** skill; read
it before designing a policy or explaining a result.

## Install

```bash
npm i @formata/limitr
```

The package depends on `@formata/stof` (0.10.3 or later for Limitr 0.7). Import only from `@formata/limitr`.

## Create the engine

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        request: { label: 'Request' }
        ai_token: { price: { amount: 0.00002 }, overhead_cost: 0.000003 }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                export_pdf: {}
                api: { limit: { credit: 'request', value: 1000, resets: true, reset_inc: 1day } }
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 50_000, resets: true } }
            }
        }
    }
}`);
```

- `Limitr.new(policy, format = 'stof', validate = true)` initializes the wasm runtime, loads the engine and the
  policy, and throws with the validation message if the policy is invalid. `policy` can be a string (Stof, JSON,
  YAML, TOML), an object with `format = 'json'`, or BSTF bytes with `format = 'bstf'`.
- `new Limitr(policy, format)` is the synchronous constructor; call `await initStof()` (from `@formata/stof`) first.
- `await limitr.valid()` returns `[ok, message]`. `await limitr.version()` is the engine version.
- Create one engine per process (or per policy) and keep it. It holds all customer state in memory.

## Customers

```ts
await limitr.ensureCustomer(userId, 'pro', 'user', 'Ada', [orgId], [email]); // creates if missing, true if created
await limitr.createCustomer(orgId, 'pro', 'org', 'Acme');                     // returns the customer record
await limitr.setCustomerPlan(userId, 'team');                                 // plan change
await limitr.customer(userId);                                                // LimitrCustomer | undefined
```

Arguments are `(id, plan = '', type = 'user', label = 'User', refs = null, alts = null, metadata = null)`. An empty
plan inherits from refs, then the policy's default plan. Use refs for user to team to org, and alts for other IDs
(email, auth subject, Stripe customer) that should resolve to the same customer.

Note: `setCustomerPlan(id, plan, overwrite_meters = true)` resets meters by default in TypeScript; pass `false` to
keep usage across the plan change.

## Gate calls

```ts
if (!(await limitr.allow(userId, 'export_pdf'))) return forbidden();        // feature flag
if (!(await limitr.allow(userId, 'api', 1))) return tooManyRequests();      // meter one request
await limitr.allow(userId, 'storage', '250MB');                               // units in a string
await limitr.increment(orgId, 'seats');                                       // the limit's increment
const ok = await limitr.check(userId, 'api', 50);                             // dry run, changes nothing
```

`allow(customer, entitlement, value = 0, event = true, overhead?, force = false)`:

- `event`: `true`, `false` (no events), or event data (an object or string). Event data is sent with the events as
  `event_data` and is the context for the credit's `overhead()` cost function (Ex. `{ model, input, output }`).
- `overhead`: the call's real provider cost in runes (USD by default), when you have it. It overrides the cost
  function.
- `force`: record usage that already happened, even past a hard limit or cap.

Reads: `value`, `remaining`, `limit`, `allowance`, `cost`, `resets`, `rate`, `acceleration`,
`projectedExhaustion`, `remainingCredit`, `meterObject`, `limitObject`, `entitlement`, `plan`, `credit`,
`creditExchange`. Each is `(customer, entitlement, ...)` and returns plain values or records.

Each method call is atomic (calls go through a promise queue, one at a time), but two calls are not: another
request can run between a `check` and the following `allow`. When concurrent requests must not overspend, use
`reserve`.

## LLM calls: reserve, then settle

The policy's `chat` entitlement declares `estimate_basis: 'input'` and `estimate_segment: 'model'` (see the limitr
skill), so the event data alone sizes each prediction:

```ts
const hold = await limitr.reserve(userId, 'chat', { context: { model, input: inputTokens } });
if (!hold) return paymentRequired();
try {
    const res = await callModel(model, messages);
    await limitr.settle(userId, 'chat', hold, res.usage.input_tokens + res.usage.output_tokens,
        { model, input: res.usage.input_tokens, output: res.usage.output_tokens });
} catch (e) {
    await limitr.release(userId, 'chat', hold);
    throw e;
}
```

- `reserve(customer, entitlement, { value?, context?, basis?, segment?, ttl?, quantile?, overhead? })` returns a hold
  ID or null (not allowed now). Without `value`, it holds the predicted amount (`estimate`), or the standard
  increment until something has been learned.
- `settle(customer, entitlement, holdId, value, event?, overhead?, basis?, segment?)` records the real usage and
  learns from it. Pass the provider's reported cost as `overhead` when you have it.
- `release` drops a hold; `held` is the room held now. Unsettled holds expire after the policy's `hold_ttl` (10 min).
- `estimate(customer, entitlement, { context?, quantile?, basis?, segment? })` returns `{ value, overhead, samples,
  source, scope }` or null. `observe(customer, entitlement, value, { context?, overhead?, basis?, segment? })`
  records a call without a hold.
- `basis` and `segment` options override what the event data says. They are rarely needed.
- Keep the segment field's values low-cardinality (a model name, a feature), never a user or request ID.

## Spend caps

```ts
await limitr.addCustomerCap(orgId, 500, { cap_id: 'org_monthly', shared: true, resets: true, reset_sch: 'monthly:1' });
await limitr.addCustomerCap(userId, 15, { credit: 'euro', overage_only: true });
await limitr.customerCap(orgId, 'org_monthly');      // LimitrCap (meter_value is spend so far)
await limitr.resetCustomerCap(orgId, 'org_monthly');
await limitr.removeCustomerCap(orgId, 'org_monthly');
```

Options (`LimitrCapOptions`): `cap_id`, `credit` (default `'rune'`), `exchangeable`, `ignore_grants`,
`overage_only`, `observe_only`, `overhead_cost`, `follow_decrements`, `hard_trailing`, `shared`, `shared_with`,
`scope`, `resets`, `reset_inc` (ms), `reset_sch`, `expires_on` (ms), `send_events`. Returns null if the cap ID
already exists.

Margins for a pipeline or session: `startMarginMeasurement(customer, capId, overage_only = true, ignore_grants =
true, credit = 'rune')` adds two observe-only caps (charged and costs); `captureMarginMeasurement(customer, capId)`
returns `{ charged, costs, margin, rawMargin }` and removes them. `customerMarginSnapshot(customer)` is the
customer's margin this period.

## Grants and topups

`applyCustomerTopup(customer, topup)` after a purchase, `ensureCustomerIncludedTopups(customer)` for included
topups, `remainingCredit(customer, credit)` for the balance, and `ensureCustomerPlanQuantity(customer)` to charge
the plan's subscription entitlement once (after its trial).

## Events

```ts
limitr.addHandler('billing', async (key, value) => {
    const event = typeof value === 'string' ? JSON.parse(value) : value;
    if (key === 'meter-overage') await billing.charge(event.customer.id, event.entitlement, event.overage_price);
    if (key === 'customer-set') await db.customers.put(event.id, event);
});
```

- Handlers receive `(name, value)`, where objects arrive as JSON strings. All handlers get every event.
  `removeHandler(name)` and `clearHandlers()` manage them.
- Handlers are called during the engine call that emitted the event, and async handlers are not awaited: the call
  returns without waiting for them. Catch errors inside async handlers, and don't assume a handler finished when
  `allow` returns.
- Event names and payloads are in the limitr skill (`references/events.md`). Common ones: `meter-changed`,
  `meter-overage`, `meter-limit`, `meter-governed`, `meter-reset`, `cap-limit`, `cap-threshold-crossed`,
  `customer-set`. Meter events carry the call's cost (`meter.overhead_diff`) and list price (`meter.price_diff`) in
  runes, which together give its margin.
- In Cloud mode, `topup-purchase-failed` also arrives from Cloud.

## Persist customer state

Customer records hold all state (meters, grants, caps, overrides). Without Cloud, save them and load them back:

- Save on `customer-set` and on meter events (their `customer` carries its meters), or periodically via
  `limitr.customers()`.
- Load on startup with `loadCustomers(records)` (an array, or an object keyed by ID), or `setCustomer(record)` one
  at a time. `ensureSetCustomer(record)` sets one only if it is missing.

## Change the policy at runtime

`setPlan(id, planStof)`, `deletePlan(id)`, `setNotifications(stof)`, `setCapabilities(stof)`, and
`difference(otherLimitr)` (a diff of two policies). For anything else, call the engine directly:
`await limitr.docCall('policy.some_function', ...args)`. `limitr.doc` is the underlying `StofDoc`, for
registering host functions the policy can call (`limitr.doc.lib('App', 'name', fn)`) or allowing HTTP from the
policy (`limitr.doc.allowHttp()`).

## Limitr Cloud

```ts
const limitr = await Limitr.cloud({ token: process.env.LIMITR_TOKEN! });
```

- Cloud sends the active policy (and updates to it), and customers on demand. Everything else is the same API.
- Options: `policy` (an ID, or `'active'`), `connectTimeout` (5s), `denyUnconnected` (default true: deny `allow`
  while disconnected, to protect shared state), `validate`.
- A customer not loaded locally is fetched from Cloud on first use (`addCloudCustomer`), and `ensureCustomer`
  creates it only when Cloud doesn't have it. `addVoucher(code)` redeems a Limitr voucher as a customer.
- Call `await limitr.close()` on shutdown to flush pending updates.

## Common mistakes

1. **Not awaiting.** Every method is async; `if (limitr.allow(...))` is always true.
2. **Re-creating the engine per request.** All state lives in the instance. Create it once.
3. **`check` then `allow` under concurrency.** Not atomic across requests; use `reserve` / `settle`.
4. **Reading event payloads without parsing.** Object payloads are JSON strings.
5. **Missing the basis.** On an entitlement with `estimate_basis`, every `reserve` and `settle` needs that field
   in its event data. Without it, the call is metered but not learned from, and the engine logs it.
6. **High-cardinality `segment` values.** Each one keeps an estimate in memory forever.
7. **Losing state on restart** without Cloud. Persist customers from events and load them on boot.
8. **Forgetting `overhead` when the provider reports cost.** Without it, the credit's cost function or fixed
   `overhead_cost` prices the call.
