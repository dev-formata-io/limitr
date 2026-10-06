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

One entitlement decides whether a call may run (rate limits, abuse limits), another prices it. Keep control limits
`hard`, with `grants_apply: false` so purchased credits never lift a safety ceiling. Check both, then meter both.

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

## AI tokens with per-model costs

Price your cost per call with a cost function, and use reservations for calls whose size is only known afterwards.

```stof
credits: {
    ai_token: {
        price: { amount: 0.00002 }
        overhead_cost: 0.000003
        rates: { sonnet: { input: 0.000003, output: 0.000015 }, haiku: { input: 0.000001, output: 0.000005 } }
        fn overhead(units: float, context?: obj) -> float {
            const rate = self.rates.get(context?.model ?? '');
            if (rate == null) return units * self.overhead_cost;
            (context.input * rate.input) + (context.output * rate.output)
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
