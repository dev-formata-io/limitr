# 8. Stacking entitlements

One action in your product often needs more than one meter. Generating a report counts as one report against the
plan's monthly allowance, and it also uses AI tokens that you bill past an included amount. Give each its own
entitlement, then go in an order where a refusal never leaves anything half counted: hold room for what you'll only
know afterwards, then count what you know now, and give the holds back if a count is refused:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        report: { label: 'Report' }
        ai_token: { label: 'AI token', price: { amount: 0.00002 } }
    }
    plans: {
        starter: {
            default: true
            entitlements: {
                reports: {
                    limit: {
                        credit: 'report', value: 3
                        resets: true, reset_sch: 'monthly:1'
                    }
                }
                report_tokens: {
                    limit: {
                        credit: 'ai_token', mode: 'soft', value: 20_000
                        resets: true
                    }
                }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

// One action, two meters: the report count (hard, known up front)
// and the tokens it uses (soft, billed past 20k, known only afterwards).
async function generateReport(customer: string): Promise<string> {
    // 1. Hold room for the tokens first: a hold is free to give back.
    const hold = await limitr.reserve(customer, 'report_tokens', { value: 10_000 });
    if (!hold) return 'out of tokens';

    // 2. Then count the report. If it's refused, give the hold back.
    if (!(await limitr.allow(customer, 'reports', 1))) {
        await limitr.release(customer, 'report_tokens', hold);
        return 'out of reports';
    }

    // 3. Run it, then record what it really used.
    const tokens = 8_000; // Ex. from the model's response
    await limitr.settle(customer, 'report_tokens', hold, tokens);
    return 'ok';
}

for (let i = 1; i <= 4; i++) {
    console.log(`report ${i}:`, await generateReport('ada'));
}
console.log('reports:', await limitr.value('ada', 'reports'),
    'tokens:', await limitr.value('ada', 'report_tokens'),
    'held:', await limitr.held('ada', 'report_tokens'));
```

It prints:

```text
report 1: ok
report 2: ok
report 3: ok
report 4: out of reports
reports: 3 tokens: 24000
held: 0
```

- **Holds first, counts last.** A hold changes no meter and sends no events, so giving it back undoes it completely.
  A count is final once it's made. Going in this order, the fourth report is refused by its count and leaves no
  tokens behind.
- **Rate limits hold either way.** A governor's tokens are spent when a call is let in: by `allow`, or by `reserve`
  for its held amount. `settle` trues them up to what the call really used, and `release` gives them back.
- **Feature flags go before both.** `check` an entitlement with no limit first: it changes nothing. To tell the
  customer why a call was refused, pass `detail` to `check` or `allow`: you get back the `reason` (Ex. `'limit'`,
  `'governor'`, `'disabled'`) and what's left.
- Each entitlement keeps its own credit, mode, and reset. Here the report count is hard (three a month) while the
  tokens are soft (billed past 20,000), so the fourth report is denied by the count, not by tokens.
- Stacking is also how plans differ. The same action can be counted but free on one plan (an `observe` limit) and
  capped on another (`hard`), with no change to your code.

Each call is atomic on its own, and holds count against every other call's check, so concurrent reports can't
overspend the tokens together. The one case this order can't make all-or-nothing is two counts in one action: the
first can go through and the second be refused. Count the one most likely to refuse first.

Next: [Control and monetize](09-control-and-monetize.md)
