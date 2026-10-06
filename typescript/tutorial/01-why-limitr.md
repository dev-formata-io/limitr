# 1. Why Limitr

Usage-based billing sounds simple: count what customers use and charge for it. Then the real requirements show up.

- The free plan gets 50,000 AI tokens a month, Pro gets 2 million, and Enterprise gets whatever was in the contract.
- Some limits should block the call. Others should let it through and bill the overage.
- A customer bought a credit pack, so their limit is higher until the pack runs out.
- Finance wants a monthly ceiling on overage. Engineering wants a rate limit that no credit pack can lift.
- Every AI call costs you something different depending on the model and the prompt, and you want to know your
  margin before the invoice, not after.

Most teams start by writing this into their app: an `if` here, a counter in Redis there, a cron job to reset it, a
webhook to the billing system. It works until pricing changes, which for usage-based products is all the time. Then
the rules live in five places and none of them agree.

## What Limitr does

Limitr puts all of those rules in one **policy**: a document that says what each plan includes, how usage is
measured, what it costs you, and what you charge. Your app asks one question before doing anything that costs money:

```ts
if (await limitr.allow(userId, 'chat', tokens)) {
    // do the thing
}
```

The **engine** that answers runs inside your app. It's a small WebAssembly runtime, so there's no network call in the
way of the request, no service to keep up, and it works the same in Node, Bun, Deno, and the browser. It keeps each
customer's meters, checks every limit and budget, records what the call cost you, and emits events you can bill from.

## Your first look

A Pro plan with 50,000 AI tokens a month:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        ai_token: { label: 'AI token', price: { amount: 0.00002 }, overhead_cost: 0.000008 }
    }
    plans: {
        pro: {
            default: true
            entitlements: {
                chat: { limit: { credit: 'ai_token', value: 50_000, resets: true, reset_sch: 'monthly:1' } }
            }
        }
    }
}`);

await limitr.ensureCustomer('ada');
console.log(await limitr.allow('ada', 'chat', 30_000));   // true: 30k of 50k used
console.log(await limitr.allow('ada', 'chat', 30_000));   // false: this call would go past 50k
console.log(await limitr.remaining('ada', 'chat'));       // 20000
```

It prints:

```text
true
false
20000
```

That's the whole loop: describe the plan once, then ask before each call. The next chapters add customers, prices,
costs, and everything else from the list above, one piece at a time.

## How it fits with the rest of your stack

Limitr decides what's allowed and what it's worth, at the moment of the request. It doesn't take payments: your
payment provider still charges cards, and your analytics tool still makes charts. Limitr is the piece in between that
those tools don't do, the one that has to be right on every single call.

The engine is open source and free to self-host. [Limitr Cloud](https://limitr.dev) runs the same engine with
managed, versioned policies, customer state, invoicing, and analytics (chapter 13).

Next: [Your first policy](02-first-policy.md)
