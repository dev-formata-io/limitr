# Events and notifications

The engine reports every state change as an event. Each event is delivered, in order, to:

1. **Policy notifications** (meter and cap events only): every object in `policy.notifications` whose
   `matches(type, event)` returns true. Its `fire` runs (`fire(event)`, `fire(name, event)`, or `fire()`; async is
   fine). With no `fire`, the event is sent again under the notification's name.
2. **Stof functions whose attributes include the event name**, anywhere in the document:
   `#[meter-overage] fn bill(event: obj) { ... }` (one parameter, or none).
3. **The host app**, through the `App` library's `event_handler(name, json)` when the SDK registers it. Objects
   arrive as JSON. SDKs wrap this (Ex. `limitr.addHandler(...)` in TypeScript).

Numbers in event payloads are rounded to 1e-9. Event objects are temporary: the engine drops them after delivery,
so a handler that keeps data must copy what it needs (Ex. `copy(event.meter)` moved somewhere, or plain values).

## Meter events (from allow, increment, decrement, settle)

`allow` fires at most one of `meter-changed`, `meter-overage`, `meter-limit`, or `meter-governed` per call, plus
`meter-reset` when the call started a new period. Calls with `event = false` fire nothing, and neither do calls
denied by a cap (caps are checked before anything is metered) or calls on unknown customers or entitlements.

| Event | When |
|---|---|
| `meter-changed` | The meter moved (or overhead was recorded with no units), with no uncovered overage. |
| `meter-overage` | A soft limit (or `force`) went past the limit and grants didn't cover all of it. Bill `overage`. |
| `meter-limit` | The call was denied by the limit (hard limit, no grant coverage). |
| `meter-governed` | The call was denied by the governor (rate). |
| `meter-reset` | The call started a new period (fires with the call's own event). |

Payload of `meter-changed` and `meter-overage`:

```stof
{
    meter: {
        old: 120            // value before the call (before the reset, on a reset)
        value: 170          // value after the call
        limit: 1000         // the limit (credit units)
        diff: 50            // this call's value
        overhead: 0.0021    // provider overhead this period (runes)
        overhead_diff: 0.0004 // this call's overhead (runes)
    }
    customer: { ... }       // the customer whose meter moved (the scope owner for scoped entitlements)
    entitlement: 'chat'
    plan: 'pro'
    credit: { ... }         // the Credit
    remaining: 830          // limit - value
    event_data: { ... }     // what the caller passed as `event`, or null
    overage: 20             // meter-overage: units past the limit not covered by grants (credit units)
    grant_value_applied: 30 // when grants covered some or all of the overage (credit units)
}
```

`meter-limit` payload: `meter: { value, limit, invalid, diff, overhead, overhead_diff }` (value is unchanged,
`invalid` is what it would have been), `customer`, `entitlement`, `plan`, `credit`, `invalid_value`, `overage`,
`event_data`.

`meter-governed` payload: `meter: { value, limit, overhead }`, `customer`, `entitlement`, `plan`, `credit`,
`event_data`, and `governor: { tokens, capacity, requested }`.

## Cap events

| Event | Payload |
|---|---|
| `cap-threshold-crossed` | `customer` (cap holder), `caller`, `entitlement`, `cap`. Fires once when `meter_value` reaches `value`. |
| `customer-cap-added` | `customer`, `cap` |
| `customer-cap-reset` | `customer`, `cap` |
| `customer-cap-removed` | `customer`, `id` |

When a call moves a cap held by another customer (a shared cap up the refs chain, or the caller's own cap on a
scoped entitlement), that holder also gets a `customer-set`.

## Customer and plan events

| Event | Payload | From |
|---|---|---|
| `customer-set` | the Customer | create, set, plan change, overrides, alt IDs, caps, included topups |
| `customer-removed` | the Customer | `delete_customer` |
| `customer-plan-changed` | `previous_plan`, `new_plan`, `customer` | `set_customer_plan` |
| `customer-topup-granted` | `customer`, `topup_name`, `plan_name`, `topup` | `apply_customer_topup` |
| `plan-set` | the Plan | `set_plan` |
| `plan-removed` | the Plan | `delete_plan` |

`internal-*` events (`internal-policy-updated`, `internal-customer-updated`, `internal-customer-invoices-updated`)
come from the Cloud sync helpers.

## Which event to use

- **Bill usage:** `meter-overage` (`overage` is what to charge, after grants), or read meters at period end for
  in-plan usage priced by the plan. Prices: `credit.price` / tiers, priced from the customer's position.
- **Sync customer state to your database:** `customer-set`, plus the meter events (their `customer` carries meters).
  Meter events do not also send `customer-set` for the meter owner.
- **Upsell or warn:** a notification on `meter-changed` with a `remaining` threshold, or an `observe_only` cap
  (its `value` is the threshold) and `cap-threshold-crossed`.
- **Rate-limit telemetry:** `meter-governed` and `meter-limit`.
- **Cost tracking:** `meter.overhead_diff` on every meter event.
