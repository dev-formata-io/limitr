# Limitr Network configuration

Every field a policy sets under `network` (the module fills in the rest). Types are Stof types: `str!` required with a
default, `str` optional (null). Times are durations (`30s`, `30days`) or ms.

## network

| Field | Type | Default | Meaning |
|---|---|---|---|
| `key` | str! | `''` | This policy's public key. Set by `limitr.network()` from the secret key; never set it by hand. |
| `name` | str! | `''` | How this policy calls itself to providers (`limitr.network({ name })`). |
| `provider` | NetworkProvider | null | What this policy offers (below). |
| `operators` | obj | null | The operators it uses: a NetworkOperator each, by name, at most one per role. |
| `service` | NetworkOperatorService | null | What it serves as an operator (below). |
| `require_identity` | bool! | `false` | Connect only to providers identified by this policy's identity operator. |
| `tool_time` | ms! | `30s` | The longest a provider's tool may run here, each time. |
| `request_timeout` | ms! | `30s` | The longest it waits for an HTTP response (providers and operators). |
| `max_response` | bytes! | `10MB` | The largest response body it reads; larger is status 0. |

Kept by the module: `connections` (one `NetworkConnection` per provider used), `budgets`, `identity` (this policy's
identity statement, from `identify()`).

## network.provider

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | str! | `''` | Letters, numbers, `_`, `-`. Its tools on a consumer are `<name>_<route or tool>`. |
| `label` | str! | `''` | How people see it (the name when empty). |
| `url` | str! | `''` | Its public URL (https, or http to localhost). |
| `offers` | list! | `[]` | The plans offered on the network (others stay private). |
| `routes` | obj | null | A NetworkRoute each, by name. |
| `tools` | obj | null | A NetworkTool each, by name (each a function of the same name in `logic`). |
| `logic` | str | null | The tools' Stof source (part of the terms). |
| `identity` | str! | `'auto'` | Vouchers need an identity statement: `'required'`, `'optional'`, or `'auto'` (required when it has an identity operator). |
| `identity_plans` | obj | null | Per plan instead (Ex. `{ free: 'optional' }`). |
| `max_voucher` | ms! | `30days` | The longest a voucher may run (longer ones are shortened). |
| `keep_ended` | ms! | `7days` | How long an ended voucher's customer is kept before `sweep()` removes it. |

### routes.<name> (NetworkRoute)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `description` | str! | `''` | What it does (an agent reads this). |
| `method` | str! | `'GET'` | GET and DELETE take arguments as a query string, the others as a JSON body. |
| `path` | str! | `'/'` | Under the provider's url. No two routes on one method and path. |
| `parameters` | list! | `[]` | `{ name, description, schema_type ('string'), required (true) }` each. |
| `entitlement` | str | null | Metered before the work (`allow()` by `value`); without one, the work meters. |
| `value` | float! | `1` | How much a request uses, with `entitlement`. |
| `hold` | float | null | Strict state operator, no entitlement: what a request holds before its work (runes); else `state.hold` × the voucher's spend. |
| `plans` | list | null | Which offered plans reach it (all when null). |
| `tool` | bool! | `true` | A tool on the consumer's side as-is (false: only the provider's tools call it). |

### tools.<name> (NetworkTool)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `description` | str! | `''` | What it does. |
| `parameters` | list! | `[]` | As for a route; the function gets them as a map. |
| `plans` | list | null | Which offered plans reach it. |

## network.operators.<name> (NetworkOperator)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `url` | str! | `''` | Its URL (https, or http to localhost). |
| `key` | str! | `''` | Its first public key (its identity, even after it rotates). |
| `label` | str! | `''` | How people see it. |
| `roles` | list! | `[]` | `state`, `identity`, `discovery` (`revoke`, `payment` later; namespaced `<domain>/<role>` for extensions). |
| `state` | NetworkStateConfig | null | The state role's config (below). |
| `channel` | bool! | `false` | Reached through the host (`limitr.network({ channels })`), never HTTP. |
| `extensions` | obj | null | Extension roles' configs. |

### state (NetworkStateConfig)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | str! | `'strict'` | `'strict'` (each request claimed first, exact) or `'bounded'` (leases settled on an interval). |
| `lease` | float! | `0.1` | bounded: a lease's share of the voucher's spend. |
| `hold` | float! | `0.1` | What a request with no declared metering holds first, as a share of the voucher's spend. |
| `settle_every` | ms! | `30s` | bounded: how often a lease settles (and when it runs out). |
| `lease_ttl` | ms! | `5min` | How long a lease lasts before it's released (unsettled spend isn't charged). |
| `offline` | str! | `'refuse'` | `'refuse'` (fail closed, 503) or `'local'` (bounded: spend what's left of the lease). |

## network.service (NetworkOperatorService, the reference operator)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `label` | str! | `''` | How people see it. |
| `roles` | list! | `['state']` | Any of `state`, `identity`, `discovery`. |
| `modes` | list! | `['strict', 'bounded']` | The state modes it supports. |
| `window` | int! | `1024` | Recent request numbers it keeps per voucher. |
| `max_lease` | ms! | `10min` | The longest a lease may run. |
| `identities` | obj | null | Who's behind the keys it knows: `{ '<public key>': '<subject>' }`. It identifies only these. |
| `identity_ttl` | ms! | `30days` | How long a statement it issues holds. |
| `requires` | list! | `[]` | `'provider'`, `'consumer'`: who must be identified by it (it must serve identity). |
| `rotations` | list | null | Its key rotations, in order from its first key (`network.rotation(newKey)`). |

Kept by it: `budgets`, `vouchers`, `listings`.
