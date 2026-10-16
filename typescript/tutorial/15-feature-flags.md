# 15. Feature flags and custom deals

Chapter 2 said an entitlement with no limit is a feature flag: on for every plan that lists it. Real launches need a
little more:

- **Rollouts:** turn a feature on for some customers first (a beta list, a quarter of everyone), then widen it.
- **Kill switches:** turn a feature off for everyone, right now.
- **Custom deals:** give one customer a feature their plan doesn't have, or take one away.

Each entitlement can have an optional `enabled` rule for the first two, and customers can be given or have features
taken for the third:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
// Rules that several features share.
#[type]
Rollouts: {
    #[static]
    /// On for customers in the beta, and for a quarter of everyone else.
    fn beta_or_quarter(customer: Customer, entitlement: str, context?: obj) -> bool {
        (customer.metadata?.beta ?? false) || customer.bucket(entitlement) < 25
    }
}

policy: {
    credits: {
        export: { label: 'Export' }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                exports: { limit: { credit: 'export', value: 10, resets: true } }
                ai_assistant: { enabled: <Rollouts>.beta_or_quarter, track: true }
                new_checkout: {
                    fn enabled(customer: Customer, entitlement: str, context?: obj) -> bool {
                        context?.country == 'US'
                    }
                }
                old_editor: { enabled: false }       // switched off for everyone
            }
        }
        pro: {
            entitlements: {
                exports: { limit: { credit: 'export', value: 1000, resets: true } }
                ai_assistant: { enabled: <Rollouts>.beta_or_quarter, track: true }
                sso: {}
            }
        }
    }
}`);

// A rollout: the same quarter of customers every time.
let on = 0;
for (let i = 0; i < 100; i++) {
    await limitr.ensureCustomer(`user_${i}`);
    if (await limitr.check(`user_${i}`, 'ai_assistant')) on++;
}
console.log(`ai_assistant is on for ${on} of 100 customers`);

// What a customer can use right now, for your front end.
await limitr.ensureCustomer('ada', 'free', 'user', 'Ada', null, null, { beta: true });
console.log('ada:', await limitr.features('ada', { country: 'US' }));
console.log('ada in Germany:', await limitr.features('ada', { country: 'DE' }));

// A custom deal: SSO on the free plan, and a pause on exports.
await limitr.giveEntitlement('ada', 'sso');
await limitr.takeEntitlement('ada', 'exports');
console.log('after the deal:', await limitr.features('ada', { country: 'US' }));
await limitr.restoreEntitlement('ada', 'exports');

// Tracked features say when they're checked, and whether they were on.
limitr.addHandler('rollout', (key, value) => {
    if (key !== 'feature-checked') return;
    const { entitlement, caller, enabled } = JSON.parse(value as string);
    console.log(`checked ${entitlement} for ${caller.id}: ${enabled ? 'on' : 'off'}`);
});
await limitr.check('ada', 'ai_assistant');
await limitr.check('user_1', 'ai_assistant');
```

It prints:

```text
ai_assistant is on for 25 of 100 customers
ada: [ 'exports', 'ai_assistant', 'new_checkout' ]
ada in Germany: [ 'exports', 'ai_assistant' ]
after the deal: [ 'ai_assistant', 'new_checkout', 'sso' ]
checked ai_assistant for ada: on
checked ai_assistant for user_1: off
```

What happened:

- **`enabled`** decides whether an entitlement is on for a call. Without it, the plan decides, as before. It can be
  `true` or `false` (`old_editor` is switched off for everyone), or a function that gets the customer, the
  entitlement's name, and the call's event data. `new_checkout` reads the country from the event data, so it's on in
  the US and off in Germany.
- **Shared rules.** `ai_assistant` points at `<Rollouts>.beta_or_quarter`, a function defined once in a Stof type
  (chapter 14) and used by both plans. Because the rule is told which entitlement it's deciding, one rule can roll out
  many features.
- **`customer.bucket(name)`** gives each customer a number from 0 to 99 that never changes for that name, so
  `bucket < 25` is the same quarter of customers on every call and every server. Raising it to 50 keeps that quarter
  and adds another. Each feature splits customers differently, so the same people aren't first for everything.
- **The beta** is customer data: Ada was created with `{ beta: true }` as her metadata, and the rule reads it.
- **`enabled` only narrows.** It runs after the plan, so a rule can turn a feature off but can't hand out one the
  customer's plan doesn't have. It gates new usage (`check`, `allow`, `reserve`); a call that already happened
  always settles. If a rule fails, the feature is off and the error is logged.
- **`features`** lists what a customer can use right now, ready to send to your front end. It's about access: a
  metered feature stays listed when its limit is used up (`check` answers that).
- **Custom deals.** `giveEntitlement` gave Ada SSO from the closest plan that has it (pass a plan name to choose),
  and `takeEntitlement` paused her exports even though her plan has them. `restoreEntitlement` undoes either, and
  both can expire. They're stored on the customer, so they last through plan changes, and an org's reach the users on
  its plan. Limit overrides still work on top: give a feature, then change its limit for that customer.
- **`track: true`** sends a `feature-checked` event each time the feature is checked, with whether it was on. That
  measures a rollout or an experiment: who saw the feature, and what they did next (Cloud does this for you).

Back to the [table of contents](README.md).
