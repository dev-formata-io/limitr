# Policy reference

Every type in a Limitr policy, its fields, and their defaults. The source of truth is `src/spec/*.stof` in the
Limitr repo. `!` marks a field that can't be null. Number fields typed `float | str` accept Stof units in a string
(`'2GB'`, `'30s'`). Durations (`ms`) accept Stof time units (`30days`, `10min`).

## Limitr (the policy)

| Field | Type | Default | Notes |
|---|---|---|---|
| `version` | ver | engine version | Set by the engine (0.7.0). |
| `credits` | obj | `{}` | Credit name -> `Credit`. |
| `plans` | obj | `{}` | Plan name -> `Plan`. |
| `exchange` | Exchange | `{}` | Currency conversion and grant strategy. |
| `notifications` | Notifications | `{}` | Notification name -> `Notification`. |
| `customers` | obj | `{}` | Customer ID -> `Customer` (engine state). |
| `alt_customer_ids` | obj | `{}` | Alt ID -> customer ID (engine state). |
| `capabilities` | obj | `{}` | Capability name -> `Capability`. |
| `estimates` | obj | `{}` | `<entitlement>.<segment>` -> `Estimate` (policy-wide). |
| `estimate_min_samples` | int | 5 | A customer's own estimate is used from this many samples. |
| `hold_ttl` | ms | `10min` | How long an unsettled reservation holds room. |

## Credit

| Field | Type | Default | Notes |
|---|---|---|---|
| `unit` | str! | `'credit'` | Singular unit name. |
| `label` | str! | `'Credit'` | Human-facing name. |
| `description` | str | `''` | |
| `resets` | bool | false | Informational: whether usage of this credit resets. |
| `overhead_cost` | float | 0 | Your provider cost per unit, in runes. Must be >= 0. |
| `pricing_model` | str! | `'flat'` | `flat`, `tiered`, `volume`, or `stairstep`. |
| `price` | Price | null | Flat price per unit. Must be null for the other models. |
| `tiers` | list | null | `PriceTier`s for tiered, volume, and stairstep. Sorted and checked by `valid()`. |
| `stof_units` | str! | `'float'` | Stof units meters keep (Ex. `'MB'`, `'s'`). `'float'` means no conversion. |

Function: `overhead(units: float, context?: obj) -> float`, the provider overhead in runes for `units` (default
`units * overhead_cost`). Override it in the policy for per-call or changing costs. Pricing helpers (used by the
engine): `priced()`, `total_price(n)`, `price_of(quantity, offset)`, `quantity_for(runes, offset)`, `band(n)`.

Pricing models, over billable units (past the limit):

- `flat`: one rate per unit.
- `tiered`: each band's units at that band's rate (like tax brackets).
- `volume`: the band the total falls in sets one rate for all units.
- `stairstep`: a flat fee per band, by the band the total falls in.

## Price and PriceTier

```stof
price: { amount: 0.00002, id: 'price_123' }       // amount in runes, id optional (Ex. a Stripe price)
tiers: [
    { up_to: 100_000, price: { amount: 0.00002 } },
    { up_to: 1_000_000, price: { amount: 0.000015 } },
    { price: { amount: 0.00001 } }                  // no up_to: the last band
]
```

## Exchange and ExchangePair

```stof
exchange: {
    grant_strategy: 'expires_first'   // 'expires_first', 'cheapest_first', or 'valuable_first'
    rune: {}                          // built in: 1 rune
    usd: { value: 1, currency: 'rune' } // built in
    euro: { value: 1.14, currency: 'usd' }
    partner_credit: { value: 0.5, currency: 'ai_token' }   // can map onto a priced credit
}
```

A pair says one unit is `value` units of `currency`. Conversions follow pairs until `rune`, or until a priced credit
(which converts through its price). `valid()` rejects pairs that can't reach runes. `get_pair(c)` is the lookup, so a
policy can override it for live rates.

## Plan

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | str | field name | Filled by the engine. |
| `label` | str! | `''` | |
| `period` | str! | `'monthly'` | `yearly`, `monthly`, `weekly`, or `daily` (billing period). |
| `subscription` | str! | `'subscription'` | Entitlement used by `ensure_plan_subscription`. |
| `trial_period` | float, str | null | Delay before `ensure_plan_subscription` charges (Ex. `14days`). |
| `entitlements` | obj! | `{}` | Entitlement name -> `Entitlement`. |
| `topups` | obj! | `{}` | Topup name -> `Topup`. |
| `hidden` | bool | false | Hide from pricing pages. |
| `default` | bool | false | Used when a customer is created without a plan. |

Plans are Stof objects, so shared pieces can be declared once and reused. Ex. mark an entitlement
`#[type('FreeSeats')]` in one plan and build it in another with `#[init] fn setup() { self.seats = new FreeSeats {};
self.seats.limit.value = 10; }`.

## Entitlement

| Field | Type | Default | Notes |
|---|---|---|---|
| `description` | str | `''` | |
| `limit` | Limit | null | No limit: a feature flag. |
| `scope` | str | null | Meter on the nearest customer of this type through refs (Ex. `'org'`). |
| `hidden` | bool | false | |
| `estimate_basis` | str | null | Event data field a call's size scales with (Ex. `'input'`). Estimates learn per unit of it. Same in every plan. |
| `estimate_segment` | str | null | Event data field that picks the estimate segment (Ex. `'model'`). Keep its values few. |

## Limit

| Field | Type | Default | Notes |
|---|---|---|---|
| `credit` | str! | `''` | Required. A credit name. |
| `mode` | str! | `'hard'` | `hard` (deny), `soft` (allow, overage billed), `observe` (never deny). |
| `value` | float, str | 0 | The limit, in the credit's units. |
| `increment` | float, str | 1 | Step for `increment()` / `decrement()`. |
| `minimum` | float, str | null | Floor for the meter. |
| `hard_trailing` | bool! | false | Hard only: allow while the meter is under the limit before the call. |
| `grants_apply` | bool | true | Grants may cover overage. Set false on governors and pure control limits. |
| `resets` | bool | false | Reset the meter each period. |
| `reset_inc` | ms | null | Period length. 30 days when `resets` and no `reset_sch`. |
| `reset_sch` | str | null | UTC calendar schedule (exclusive with `reset_inc`). |
| `override_expires_on` | ms | null | Customer overrides only. |
| `governor_enabled` | bool | false | Token-bucket rate limit below a hard limit. |
| `governor_capacity` | float, str | null | Bucket size (burst). Required with a governor. |
| `governor_refill_rate` | float | null | Tokens per ms. Required with a governor. |
| `ewma_alpha` | float | 0.2 | Smoothing for the rate trend (0 to 1). |

Schedules: `monthly:N` (day N), `monthly:last`, `weekly:mon`, `nth_weekday:N:mon` (Ex. second Tuesday),
`yearly:M-D`, `quarterly:D`.

## Topup

| Field | Type | Default | Notes |
|---|---|---|---|
| `credit` | str! | `''` | Credit granted. |
| `value` | float, str | 0 | Amount granted. |
| `price` | Price | null | What the topup costs. |
| `description` | str | `''` | |
| `included` | bool | false | Granted automatically with the plan. |
| `included_scopes` | list | null | Customer types it is included for (null: all). |
| `resets` | bool | false | Refill the grant each period. |
| `reset_inc` / `reset_sch` | ms / str | null | As on Limit. |
| `reset_mode` | str | `'hard'` | `hard` (back to value), `add` (add value), `rollover` (carry, then add). |
| `rollover_min` / `rollover_max` | float, str | null | Clamp the carried balance. |
| `rollover_pct` | float | null | Fraction of the balance carried. |
| `max_balance` | float, str | null | Ceiling after a reset. |
| `expires_after` | ms | null | Grant expires this long after purchase. |
| `reset_catchup_cap` | int | null | Max periods to catch up at once. |

## Customer (engine state)

| Field | Type | Notes |
|---|---|---|
| `id` | str! | Primary ID. |
| `plan` | str! | Plan name ('' to inherit from refs). |
| `type` | str! | Default `'user'` (Ex. org, team, seat). |
| `label` | str! | Default `'User'`. |
| `alt_ids` | list! | Other IDs that resolve to this customer. |
| `refs` | list! | IDs of related customers (Ex. a user's team and org). |
| `meters` | obj! | Entitlement -> `Meter`. |
| `overrides` | obj! | Entitlement -> `Limit`. |
| `grants` | obj! | Grant ID -> `Grant`. |
| `caps` | obj! | Cap ID -> `Cap`. |
| `metadata` | obj | Anything. `limitr_voucher*` fields are used by Cloud vouchers. |

## Meter (engine state)

| Field | Type | Notes |
|---|---|---|
| `credit` | str! | Credit metered. |
| `started` | ms | Start of the current period. |
| `value` | float | Usage this period, in the credit's units. |
| `overhead` | float | Provider overhead this period, in runes (null on meters from before 0.7.0). |
| `holds` | map | Hold ID -> map of `value`, `overhead`, `expires`, `basis`, `segment`. |
| `estimates` | obj | Segment -> `Estimate` for this customer. |
| `history` | list! | Last 3 `{ ts, delta }` entries, for rate and acceleration. |
| `ewma_rate` | float | Smoothed rate. |
| `governor_tokens`, `governor_last_refill` | | Governor state, created on first use. |

## Grant (engine state)

`id`, `credit`, `topup` (name, when from a topup), `created_on`, `granted_on`, `starting_value`, `value` (balance),
`expires_on`, and the reset fields copied from the topup (`resets`, `reset_inc`, `reset_sch`, `last_reset`,
`reset_mode`, `rollover_*`, `max_balance`, `reset_catchup_cap`). Topup grants follow their topup's definition: when
the plan's topup changes, its grants change too, and when it is removed, its grants are removed.

## Cap

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | str! | generated | Key in `customer.caps`. |
| `credit` | str! | `'rune'` | Currency or credit of the ceiling. |
| `value` | float, str | 0 | The ceiling (and the threshold for `cap-threshold-crossed`). |
| `exchangeable` | bool! | true (rune) | Convert other credits through the exchange. False: exact credit only. |
| `overage_only` | bool! | false | Only usage past included plan limits counts. |
| `ignore_grants` | bool! | false | Usage covered by grants doesn't count. |
| `observe_only` | bool! | false | Never deny, only accumulate and notify. |
| `overhead_cost` | bool! | false | Count provider overhead instead of spend. |
| `follow_decrements` | bool! | false | Decrements reduce the cap's meter. |
| `hard_trailing` | bool! | false | Allow while under before the call; deny after the crossing. |
| `shared` | bool! | false | Also applies to customers referencing the holder. |
| `shared_with` | list | null | Caller types a shared cap applies to. |
| `scope` | list | null | Entitlement names it applies to (null: all convertible). |
| `meter_value` | float | 0 | Consumption so far, in the cap's credit. |
| `resets` / `reset_inc` / `reset_sch` | | | As on Limit. Resets zero `meter_value`. |
| `expires_on` | ms | null | The cap is removed after this. |

## Estimate

| Field | Type | Default | Notes |
|---|---|---|---|
| `samples` | int | 0 | Observations (or the weight of a seeded prior). |
| `alpha` | float | 0.1 | Smoothing once there are 1/alpha samples. |
| `per_basis` | bool | false | Learned per unit of basis. Follows the entitlement's `estimate_basis`; a change starts the estimate over. |
| `value_mean` / `value_var` | float | 0 | Per call (or per unit of basis), credit units. |
| `overhead_mean` / `overhead_var` | float | 0 | Per call (or per unit of basis), runes. |
| `source` | str | `'local'` | `'cloud'` when seeded or pooled by Limitr Cloud. |
| `updated` | ms | null | Last observation. |

Segment keys replace `.` and spaces with `_` (`'claude-sonnet-4.5'` is stored as `claude-sonnet-4_5`). No segment is
`all`.

## Notification

An object under `policy.notifications`:

```stof
notifications: {
    low_balance: {
        fn matches(type: str, event: obj) -> bool { type == 'meter-changed' && event.remaining < 100 }
        fn fire(event: obj) { /* or fire(name: str, event: obj), or fire() */ }
    }
}
```

`fire` may be async. Without `fire`, a match sends the event again under the notification's name (Ex.
`low_balance`), which hosts can subscribe to.

## Capability

Named, versioned functions exposed to customers and AI tools: `name`, `description`, `version`, `parameters` (list
of `{ name, description, schema_type, required }`), `input`, `output`, `result`, and optional `plans` / `customers`
access filters. `run_capability(name, args, customer_id?)`, `claude_tools(customer_id?)`, and
`claude_tool_use(tool_use, customer_id?)` run them and produce Claude tool definitions and results.
