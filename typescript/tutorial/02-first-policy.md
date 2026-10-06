# 2. Your first policy

A policy has two main parts:

- **Credits** are the things you count: requests, tokens, seats, exports, megabytes. Each credit can have a price and
  a cost, which we'll get to in chapter 6.
- **Plans** list **entitlements**: what a customer on that plan can do. An entitlement with no limit is a feature
  flag. An entitlement with a limit is metered in one of your credits.

```ts
import { Limitr } from '@formata/limitr';

// A policy: one free plan with two features.
const limitr = await Limitr.new(`
policy: {
    plans: {
        free: {
            default: true
            entitlements: {
                export_csv: {}
                api: { limit: { credit: 'request', value: 3 } }
            }
        }
    }
    credits: {
        request: { label: 'API request' }
    }
}`);

await limitr.ensureCustomer('ada'); // no plan given, so Ada gets the default plan (free)

console.log(await limitr.allow('ada', 'export_csv')); // true: the plan has it
console.log(await limitr.allow('ada', 'export_pdf')); // false: the plan doesn't

for (let call = 1; call <= 4; call++) {
    console.log(`request ${call}:`, await limitr.allow('ada', 'api', 1));
}
console.log('used:', await limitr.value('ada', 'api'), 'remaining:', await limitr.remaining('ada', 'api'));
```

It prints:

```text
true
false
request 1: true
request 2: true
request 3: true
request 4: false
used: 3 remaining: 0
```

A few things to notice:

- `ensureCustomer` creates the customer the first time and does nothing after that, so it's safe to call on every
  request. A customer created without a plan gets the plan marked `default: true`.
- `allow` returns a plain `true` or `false`. For a feature flag it checks the plan. For a limit, it also counts the
  usage when the answer is yes, so the fourth request is denied because the first three used the limit up.
- A denied call changes nothing. `value` is still 3.
- An entitlement the plan doesn't have (or a customer that doesn't exist) is simply denied. Nothing throws.

The policy above is written in [Stof](https://stof.dev), the format Limitr runs on. It's JSON with less punctuation,
so plain JSON works too, and so do YAML and TOML (chapter 12). Stof also lets a policy carry its own functions, which
chapter 7 uses for per-call costs.

Next: [Customers and plans](03-customers-and-plans.md)
