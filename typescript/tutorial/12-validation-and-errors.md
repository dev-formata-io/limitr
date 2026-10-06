# 12. Validation and errors

Pricing mistakes are expensive, so Limitr checks a policy when it loads and keeps calls predictable after that.

```ts
import { Limitr } from '@formata/limitr';

// Policies can be Stof, JSON, YAML, or TOML. Here's JSON.
const limitr = await Limitr.new({
    policy: {
        credits: { request: { label: 'Request' } },
        plans: { free: { default: true, entitlements: { api: { limit: { credit: 'request', value: 10 } } } } },
    },
}, 'json');
console.log('valid:', await limitr.valid());

// An invalid policy fails when it loads, with a message that says what's wrong.
try {
    await Limitr.new(`policy: { plans: { free: { entitlements: { api: { limit: { credit: 'requests', value: 10 } } } } } }`);
} catch (error) {
    console.log('invalid:', (error as Error).message);
}

// Calls never throw for unknown customers or entitlements: they're denied.
console.log('unknown customer:', await limitr.allow('nobody', 'api', 1));
await limitr.ensureCustomer('ada');
console.log('unknown entitlement:', await limitr.allow('ada', 'apii', 1));
```

It prints:

```text
valid: [ true, '' ]
invalid: A credit named "requests" does not exist in this policy
unknown customer: false
unknown entitlement: false
```

- **Formats.** `Limitr.new(policy, format)` takes Stof (the default), JSON (as a string or an object), YAML, or TOML.
  They all describe the same policy, so you can keep it in whatever your team already uses and check it into git.
- **Validation.** `Limitr.new` validates by default and throws with a plain message, Ex. a limit naming a credit
  that doesn't exist, or a mode other than hard, soft, or observe. `valid()` returns `[ok, message]` if you want to
  check a policy yourself, Ex. in CI before deploying a pricing change.
- **Calls don't throw.** An unknown customer or entitlement is denied, so a typo can't crash a request. It also
  can't silently allow anything.
- **Sandboxed.** A policy can carry functions (chapter 7), and they run in a sandbox: no network, files, or
  environment variables unless your app explicitly allows them, Ex. `limitr.doc.allowHttp(['api.example.com'])`.

Next: [Going to Cloud](13-going-to-cloud.md)
