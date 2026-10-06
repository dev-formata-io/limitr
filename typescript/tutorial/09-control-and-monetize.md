# 9. Control and monetize

Some limits exist to make money: the customer bought 100,000 tokens a month. Others exist to protect you: no single
customer should be able to send 500 requests a second, no matter how many credits they bought.

Mixing the two in one limit causes trouble. Raise the paid allowance and you accidentally raise the safety limit
too. Keep them as separate entitlements:

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
                // Control: protects you. Bursts of 5, then 1 request a second. Never lifted by purchased credits.
                chat_rate: {
                    limit: {
                        credit: 'request', value: 1e9, grants_apply: false
                        governor_enabled: true, governor_capacity: 5, governor_refill_rate: 0.001
                    }
                }
                // Monetize: what the customer pays for. 100k tokens included, the rest billed.
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 100_000, resets: true } }
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

Next: [Seats, top-ups, and spend caps](10-seats-topups-caps.md)
