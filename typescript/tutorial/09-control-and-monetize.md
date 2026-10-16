# 9. Control and monetize

Some limits exist to make money: the customer bought 100,000 tokens a month. Others exist to protect you: no single
customer should be able to send 500 requests a second, no matter how many credits they bought.

Often one entitlement does both. When the limit you sell is also the limit you need, a monthly allowance with a hard
limit is control and pricing at once, and that's all many products need.

Split them when they pull apart: when you need rules the customer doesn't pay for (a rate limit, an abuse ceiling,
a cap per request), or when billing has to match exactly what a provider charged you. Then each side gets its own
entitlement and its own strategy, and raising a paid allowance never raises a safety limit by accident:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        request: { label: 'Request' }
        ai_token: { label: 'AI token', price: { amount: 0.00002 } }
    }
    plans: {
        pro: {
            default: true
            entitlements: {
                // Control: protects you. Bursts of 5, then 1 request a second.
                // Never lifted by purchased credits.
                chat_rate: {
                    limit: {
                        credit: 'request', value: 1e9, grants_apply: false
                        governor_enabled: true
                        governor_capacity: 5, governor_refill_rate: 0.001
                    }
                }
                // Monetize: what the customer pays for. 100k tokens included, the rest billed.
                chat: {
                    limit: {
                        credit: 'ai_token', mode: 'soft', value: 100_000
                        resets: true
                    }
                }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

async function chat(customer: string, tokens: number): Promise<string> {
    if (!(await limitr.check(customer, 'chat_rate', 1))) return 'slow down';
    if (!(await limitr.check(customer, 'chat', tokens))) return 'out of tokens';
    await limitr.allow(customer, 'chat_rate', 1);
    await limitr.allow(customer, 'chat', tokens);
    return 'ok';
}

const results = [];
for (let i = 0; i < 7; i++) results.push(await chat('ada', 1_500));
console.log(results.join(', '));
await new Promise((resolve) => setTimeout(resolve, 1100));
console.log('a second later:', await chat('ada', 1_500));
```

It prints:

```text
ok, ok, ok, ok, ok, slow down, slow down
a second later: ok
```

- **`chat_rate` is control.** Its huge `value` means the limit itself never matters. The **governor** does the work:
  a bucket of 5 requests that refills at 0.001 per millisecond (one a second). A burst of 5 goes through, then the
  customer has to slow down. `grants_apply: false` means purchased credits never lift it.
- **`chat` is monetize.** It's the allowance the customer pays for, soft past 100,000 tokens so overage is billed.
- Your code checks control first, so a denied request says why: "slow down" is different from "out of tokens".
- `allowance(customer, entitlement)` tells you how much can run right now, counting the governor, which is handy for
  a UI or for spacing out a batch job.

The same split works for AI billing: control in a token count of your own, the same for every model, and billing in
per-model credits filled with what the provider reported. See
[AI costs per model](https://limitr.dev/docs/how-to/ai-token-costs#control-in-your-own-count-bill-in-the-providers).

Next: [Seats, top-ups, and spend caps](10-seats-topups-caps.md)
