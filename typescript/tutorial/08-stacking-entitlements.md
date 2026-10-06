# 8. Stacking entitlements

One action in your product often needs more than one meter. Generating a report counts as one report against the
plan's monthly allowance, and it also uses AI tokens that you bill past an included amount. Give each its own
entitlement, check them all, then count them all:

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
                reports: { limit: { credit: 'report', value: 3, resets: true, reset_sch: 'monthly:1' } }
                report_tokens: { limit: { credit: 'ai_token', mode: 'soft', value: 20_000, resets: true } }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

// One action, two meters: the report count (hard) and the tokens it uses (soft, billed past 20k).
async function generateReport(customer: string, tokens: number): Promise<boolean> {
    const allowed = await limitr.check(customer, 'reports', 1) && await limitr.check(customer, 'report_tokens', tokens);
    if (!allowed) return false;
    await limitr.allow(customer, 'reports', 1);
    await limitr.allow(customer, 'report_tokens', tokens);
    return true;
}

for (let i = 1; i <= 4; i++) console.log(`report ${i}:`, await generateReport('ada', 8_000));
console.log('reports:', await limitr.value('ada', 'reports'), 'tokens:', await limitr.value('ada', 'report_tokens'));
```

It prints:

```text
report 1: true
report 2: true
report 3: true
report 4: false
reports: 3 tokens: 24000
```

- `check` gives the same answer as `allow` without counting anything, so the action only runs when every meter has
  room, and a denied report doesn't leave tokens counted.
- Each entitlement keeps its own credit, mode, and reset. Here the report count is hard (three a month) while the
  tokens are soft (billed past 20,000), so the fourth report is denied by the count, not by tokens.
- Stacking is also how plans differ. The same action can be counted but free on one plan (an `observe` limit) and
  capped on another (`hard`), with no change to your code.

`check` followed by `allow` is two calls, so under heavy concurrency another request can slip in between them. When
that matters, `reserve` each entitlement first (chapter 7) and settle them after.

Next: [Control and monetize](09-control-and-monetize.md)
