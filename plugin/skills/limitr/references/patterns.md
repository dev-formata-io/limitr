# Policy patterns

Common designs. Each is a fragment of a `Limitr policy: {...}`.

## Feature flags

An entitlement with no limit is a flag: `allow(id, 'export_pdf')` is true when the customer's plan has it.

```stof
plans: {
    free: { entitlements: { basic_export: {} } }
    pro: { entitlements: { basic_export: {}, export_pdf: {}, sso: {} } }
}
```

## Rollouts, kill switches, and experiments

`enabled` narrows a flag (or any entitlement) per call; `track: true` measures it. Keep shared rules in a type:

```stof
#[type]
Rollouts: {
    #[static]
    /// The beta (customer metadata), plus a share of everyone else that grows with `percent`.
    fn share(customer: Customer, entitlement: str, percent: int) -> bool {
        (customer.metadata?.beta ?? false) || customer.bucket(entitlement) < percent
    }

    #[static]
    fn quarter(customer: Customer, entitlement: str, context?: obj) -> bool {
        <Rollouts>.share(customer, entitlement, 25)
    }
}

plans: {
    pro: {
        entitlements: {
            ai_assistant: { enabled: <Rollouts>.quarter, track: true }
            old_editor: { enabled: false }              // kill switch
            new_checkout: {
                fn enabled(customer: Customer, entitlement: str, context?: obj) -> bool {
                    context?.country == 'US'            // from the call's event data
                }
            }
        }
    }
}
```

- **Widen a rollout** by raising the number: everyone already in stays in. Each entitlement name buckets
  independently, so the same customers aren't first for everything.
- **An A/B test** is a rollout at 50 with `track: true`: `feature-checked` says who saw which side, and meter events
  say what they did next.
- **Per-customer targeting** (a beta, a design partner) goes in customer metadata, which the rule reads.
- **Front end:** send `features(id, context)` to the browser; it lists what the customer can use right now.
- A rule only narrows. To give a feature outside the plan, give the entitlement (below).

## Seats on the org

Meter seats on the org, whatever customer calls. Users ref their org.

```stof
credits: { seat: { label: 'Seat', unit: 'seat', price: { amount: 12 } } }
plans: { team: { entitlements: { seats: { scope: 'org', limit: { credit: 'seat', mode: 'soft', value: 5 } } } } }
```

`create_customer('org_1', 'team', 'org')`, `create_customer('user_1', '', 'user', 'Ada', ['org_1'])`, then
`increment('user_1', 'seats')` on invite and `decrement` on removal. Five seats are included; seat six fires
`meter-overage` (bill it).

## Separate control from monetization

Often one entitlement does both: when the limit you sell is the limit you need, a hard allowance is control and
pricing at once. Split them when they differ: rules the customer doesn't pay for (rate limits, abuse ceilings, a cap
per request), or billing that must match exactly what a provider charged. Then one entitlement decides whether a call
may run and another prices it. Keep control limits `hard`, with `grants_apply: false` so purchased credits never
lift a safety ceiling. Check both, then meter both.

```stof
credits: {
    request: { label: 'Request' }
    token: { label: 'Token', price: { amount: 0.00002 } }
}
plans: {
    starter: {
        entitlements: {
            chat_rate: { limit: { credit: 'request', value: 1e9, grants_apply: false,
                governor_enabled: true, governor_capacity: 5, governor_refill_rate: 0.001 } } // 5 burst, 1/s
            chat: { limit: { credit: 'token', mode: 'soft', value: 100_000, resets: true } }
        }
    }
}
```

```stof
if (p.check(id, 'chat_rate', 1) && p.check(id, 'chat', estimate)) {
    p.allow(id, 'chat_rate', 1);
    p.allow(id, 'chat', estimate);
}
```

## Stacking entitlements

Several entitlements can meter one action at different grains: a per-call count, tokens, and a daily ceiling. Each
has its own credit, mode, and reset, and the action runs only when every one allows it. Use `check` on all first
(or `reserve` on each), then `allow` each. Stacking is also how plans differ: the same action can be free and
counted on one plan (`observe`) and capped on another (`hard`).

## Prepaid credit burndown

Customers buy credits, and every feature spends them at its own rate. Set the feature limits to 0 (nothing
included), price each feature's credit, and grant the shared credit (here through an included topup). Hard limits
run on grants until the balance runs out.

```stof
exchange: { ai_credit: { value: 0.01, currency: 'usd' } }   // 1 credit = $0.01
credits: {
    ai_credit: { label: 'AI credit' }
    image: { label: 'Image', price: { amount: 0.04 } }       // 4 credits per image
    token: { label: 'Token', price: { amount: 0.00002 } }    // 2 credits per 1,000 tokens
}
plans: {
    starter: {
        default: true
        entitlements: {
            images: { limit: { credit: 'image', value: 0 } }
            chat: { limit: { credit: 'token', value: 0 } }
        }
        topups: {
            credits_1000: { credit: 'ai_credit', value: 1000, price: { amount: 10 }, included: true }
        }
    }
}
```

`credit_remaining(id, 'ai_credit')` is the balance. Sell more with `apply_customer_topup(id, 'credits_1000')`.

## AI tokens per model: a credit per model and direction

The simplest way to price AI usage, and the default to suggest: one credit per model and direction, each with its own
price and `overhead_cost`. No code, so it works in JSON, YAML, and TOML too. Each credit is its own invoice line, and
matches the provider's bill.

```stof
credits: {
    sonnet_input: { price: { amount: 0.000006 }, overhead_cost: 0.000003 }
    sonnet_output: { price: { amount: 0.00003 }, overhead_cost: 0.000015 }
}
plans: {
    pay_as_you_go: {
        default: true
        entitlements: {
            sonnet_input: { limit: { credit: 'sonnet_input', mode: 'soft' } }    // every token billed
            sonnet_output: { limit: { credit: 'sonnet_output', mode: 'soft' } }
        }
    }
}
```

Flow: after the model call, `allow(id, 'sonnet_input', usage.input_tokens)` and `allow(id, 'sonnet_output',
usage.output_tokens)`. `allow` decides and records in one pass. To gate as well:

- **Gate before, bill after:** `check` before the call; after it, `allow` with `force = true` so the call that
  crosses a hard limit is still recorded (it happened), and the next `check` is denied (a trailing limit).
- **Control in your own count, bill in the provider's:** a control entitlement in a neutral credit (Ex. `token`,
  your count of the prompt plus `max_tokens`, hard, maybe a governor), allowed or reserved before the call, and the
  per-model billing entitlements allowed after it with the provider's numbers. Control stays the same across
  providers; billing stays exact. More credits and entitlements, which is fine.
- **One budget across models:** a spend cap (runes) counts every credit at its price; `hard_trailing = true` suits
  usage recorded after the call.

## AI tokens with a cost function

When you meter one unit across models (one `ai_token` meter) and want each call's cost to follow the model, price
the cost with a cost function (Stof only). To sell customers one balance across models, you don't need this: keep
per-model credits and grant an abstract `ai_credit` (see Prepaid credit burndown).
Use reservations for calls whose size is only known afterwards.

```stof
credits: {
    ai_token: {
        price: { amount: 0.00002 }
        overhead_cost: 0.000003
        rates: { sonnet: { input: 0.000003, output: 0.000015 }, haiku: { input: 0.000001, output: 0.000005 } }
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
    pro: {
        entitlements: {
            // a call's size scales with its input tokens; each model keeps its own estimate
            chat: { estimate_basis: 'input', estimate_segment: 'model',
                limit: { credit: 'ai_token', mode: 'soft', value: 2_000_000, resets: true } }
        }
    }
}
```

Flow: `reserve(id, 'chat', null, { model, input })` (a null value holds the predicted amount, sized by the input),
run the model, then `settle(id, 'chat', hold, total_tokens, { model, input, output })`, optionally passing the
provider's reported cost as `overhead`. Each event's `meter.price_diff` minus `meter.overhead_diff` is that call's
margin. Cloud can update `rates` without a deploy. An `overhead_cost: true` cap limits what a customer can cost
you (Ex. `add_customer_cap(id, 20, id = 'cost_guard', overhead_cost = true, resets = true)`).

## Predict output tokens

An entitlement with no `limit` is never metered, so it can learn anything about a call. Here it learns output tokens
from input tokens, per model, next to the metered `chat` entitlement:

```stof
entitlements: {
    chat: { estimate_basis: 'input', estimate_segment: 'model',
        limit: { credit: 'ai_token', mode: 'soft', value: 2_000_000, resets: true } }
    // never metered: learns output tokens from input tokens, per model
    chat_output: { estimate_basis: 'input', estimate_segment: 'model' }
}
```

After each call, record the output with the event data you already pass to `settle`. Before a call, ask for it:

```stof
policy.observe(id, 'chat_output', usage.output, context = using new { model: model, input: usage.input });
const typical = policy.estimate(id, 'chat_output', quantile = 0.5, context = using new { model: model, input: input });
// typical.get('value'): predicted output tokens (null until something has been learned for that model)
```

- **What it learns.** A fixed amount per call plus an amount per input token. Chat traffic (about 300 tokens
  whatever the question) predicts about 300 for a 20-token prompt and for a 4,000-token one; summaries (a quarter of
  the input) predict 5 and 1,000.
- **Quantile.** 0.5 is the typical answer (a quote, a progress bar). 0.9 is a cautious one (`max_tokens`, a budget
  check).
- **Scope.** Each customer's own estimate takes over after 5 calls; before that, every customer's calls together.
- **Segments.** If one model serves very different tasks (chat and summaries), segment by both: add a field such
  as `kind: 'sonnet:chat'` to the event data and set `estimate_segment: 'kind'`. Keep the values few.
- **Holds already use it.** `reserve` on `chat` with no value predicts total tokens the same way, so a short
  question with a long answer holds enough. The separate entitlement is for when you need the output alone.

## Budgets for orgs and teams

A shared cap on the org applies to every user and team whose refs lead to it. Caps on the team stack under it.

```stof
policy.add_customer_cap('org_1', 500, id = 'org_monthly', shared = true, resets = true, reset_sch = 'monthly:1');
policy.add_customer_cap('team_a', 100, id = 'team_monthly', shared = true, resets = true, reset_sch = 'monthly:1');
```

A user in team A is stopped by whichever budget runs out first. `shared_with = ['user']` limits a shared cap to
calls made by users.

## Trials and custom deals

- **Trial:** `trial_period: 14days` on the plan delays `ensure_plan_subscription`. For a usage trial, give a
  temporary override: `create_customer_override(id, 'chat', Time::now() + 14days, null, null, 1_000_000)`.
- **Custom deal:** a permanent override for one customer (`value`, `mode`, or reset schedule), or a hidden plan
  (`hidden: true`) for a group of customers.
- **A feature outside the plan:** `give_entitlement(id, 'sso')` (from the closest plan with it) or
  `give_entitlement(id, 'api', 'enterprise')` (that plan's limit). Add `expires` for a trial of a higher plan's
  feature. Overrides still apply on top.
- **Keep a feature through a downgrade:** give it before `set_customer_plan`; gives are stored on the customer.
- **Pause one feature** (abuse, unpaid invoice): `take_entitlement(id, 'exports')`, then `restore_entitlement`.
  Usage so far is kept. On an org, it applies to the users on the org's plan.

## Soft limits with a spend ceiling

Allow overage, but cap what the customer can be billed: a soft limit plus an `overage_only` cap in their currency
(here `euro`, which needs an exchange pair such as `euro: { value: 1.14, currency: 'usd' }`).

```stof
policy.add_customer_cap(id, 15, id = 'overage_eur', credit = 'euro', overage_only = true, resets = true, reset_sch = 'monthly:1');
```

## Analytics only

`mode: 'observe'` meters and emits events but never denies: usage tracking, shadow-launching a limit before
enforcing it, or attributing cost per feature. An `observe_only` cap tracks spend across entitlements and fires
`cap-threshold-crossed` at its value, without denying.
