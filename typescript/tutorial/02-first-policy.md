# 2. Your first policy

A policy has two main parts:

- **Credits** are the things you count: requests, tokens, seats, exports, megabytes. Each credit can have a price and
  a cost, which we'll get to in chapter 6.
- **Plans** list **entitlements**: what a customer on that plan can do. An entitlement with no limit is a feature
  flag (chapter 15 adds rollouts and kill switches). An entitlement with a limit is metered in one of your credits.

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

## How a policy is written

If you can read JSON, you can read a Stof policy. Here's the same policy again, with the differences called out:

```stof
policy: {
    credits: {
        request: { label: 'API request' }   // comments start with //
    }
    plans: {
        free: {
            default: true                    // no comma needed at the end of a line
            entitlements: {
                export_csv: {}
                api: { limit: { credit: 'request', value: 3 } }
            }
        }
    }
}
```

- Keys don't need quotes, and commas between fields are optional.
- Strings can use single or double quotes.
- Numbers can use underscores (`50_000`) and carry units (`250MB`, `1day`), which chapter 4 uses.

Written as JSON, it's the same policy:

```json
{ "policy": { "credits": { "request": { "label": "API request" } },
  "plans": { "free": { "default": true, "entitlements": { "export_csv": {}, "api": { "limit": { "credit": "request", "value": 3 } } } } } } }
```

Limitr loads either one, and YAML and TOML too (chapter 12). Stof is the default because a policy sometimes needs
more than data: chapter 7 adds a function that prices each AI call from the model it used.

When the policy loads, the engine reads it with its own Stof types (a plan, a credit, a limit), which is how it fills
in defaults and checks for mistakes, like a limit that names a credit that doesn't exist.

Next: [Customers and plans](03-customers-and-plans.md)
