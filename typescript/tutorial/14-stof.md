# 14. The language underneath: Stof

Every chapter so far has used [Stof](https://stof.dev) a little: policies written in it (chapter 2), units like `1GB`
and `1day` (chapter 4), and a cost function (chapter 7). This chapter looks at Stof directly, for when you want more
from a policy than `allow` and friends give you.

Limitr is a Stof document: the engine (its types and functions) plus your policy, loaded together.
`limitr.doc` is that document, so you can read it, export it, and ask it questions from your app:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        request: { label: 'Request' }
        ai_token: { label: 'AI token', price: { amount: 0.00002 } }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                api: { limit: { credit: 'request', value: 1000, resets: true } }
            }
        }
        pro: {
            entitlements: {
                api: { limit: { credit: 'request', value: 50_000, resets: true } }
                chat: {
                    limit: {
                        credit: 'ai_token', mode: 'soft', value: 2_000_000
                        resets: true
                    }
                }
                sso: {}
            }
        }
    }
}`);

// 1. Read any value by its path.
console.log(limitr.doc.get('policy.plans.pro.entitlements.chat.limit.value'));

// 2. Export any part of the policy, as JSON (or YAML, TOML, or Stof).
console.log(limitr.doc.stringify('json', 'policy.plans.free.entitlements.api.limit'));

// 3. Ask a question the API doesn't have a method for, without adding anything to the policy.
const plans = await limitr.doc.callSource(`
    fn plans_with(entitlement: str) -> list {
        const names = [];
        for (const (name, plan) in self.plans.fields()) {
            if (plan.entitlements.contains(entitlement)) names.push_back(name);
        }
        names
    }
`, ['sso'], 'policy');
console.log('plans with sso:', plans);
```

It prints:

```text
2000000
{"credit":"request","value":1000.0,"resets":true,"mode":"hard","hard_trailing":false,"grants_apply":true,"increment":1.0,"minimum":null,"reset_inc":2592000000.0,"reset_sch":null,"override_expires_on":null,"governor_enabled":false,"governor_capacity":null,"governor_refill_rate":null,"ewma_alpha":0.2}
plans with sso: [ 'pro' ]
```

- **Paths.** Everything in a document has a path made of names: `policy.plans.pro.entitlements.chat.limit.value`.
  `get` and `stringify` take one.
- **Types fill in the rest.** The exported limit has far more fields than the policy wrote. When the policy loads,
  the engine reads it with its Stof types, and each type has a default for every field: `mode` is `hard`, `increment`
  is 1, and `reset_inc` is 30 days in milliseconds. That's also where the engine's validation lives (chapter 12).
- **Functions over the policy.** `callSource` runs a Stof function as if it were defined on `policy` (so `self` is the
  policy) and leaves nothing behind. Here it walks the plans: `self.plans.fields()` lists each plan as a name and a
  value, and `(name, plan)` takes the pair apart.
- **Reads, not writes.** Read and export through `limitr.doc` as much as you like. To change customers, meters, or
  plans, use Limitr's methods (Ex. `setPlan`, `setCustomer`). They keep the meters consistent and send the events
  your app and Cloud listen for.

## Why Limitr is built on it

Pricing is data with rules attached. Most tools keep the data in one place (a config file, a database) and the rules
in another (your code, a billing service), and the two drift apart. Stof keeps them in one document:

- **One document, everywhere.** The same policy, with its functions, runs in Node, Bun, Deno, the browser, and Limitr
  Cloud, and gives the same answers in each.
- **Data you can work with.** A policy is text you can commit and review, export as JSON, and diff (Cloud shows a
  diff of every policy change).
- **Safe to run.** Policy functions run in a sandbox: no network, files, or environment variables unless your app
  allows them, and a time limit on every call. That's what lets a policy carry logic at all, including a policy that
  someone else (or a model) edited.

To go further, [stof.dev](https://stof.dev) has the language guide and a playground where you can paste a policy and
run Stof in your browser.

Next: [Feature flags and custom deals](15-feature-flags.md)
