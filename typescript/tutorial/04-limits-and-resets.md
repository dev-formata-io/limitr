# 4. Limits and resets

A limit says which credit it counts and how much of it the plan includes. Most usage limits also **reset**: a daily
API quota, a monthly allowance.

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        request: { label: 'Request' }
        report: { label: 'Report' }
        storage: { label: 'Storage', stof_units: 'MB' }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                api: { limit: { credit: 'request', value: 1000, resets: true, reset_inc: 1day } }
                reports: { limit: { credit: 'report', value: 5, resets: true, reset_sch: 'monthly:1' } }
                storage: { limit: { credit: 'storage', value: 1GB } }
                burst: { limit: { credit: 'request', value: 2, resets: true, reset_inc: 1s } }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

// Values can carry units: 250MB of a 1GB (1000MB) limit.
await limitr.allow('ada', 'storage', '250MB');
console.log('storage left:', await limitr.remaining('ada', 'storage'), 'MB');

// The first use starts a period, and resets() says when the next one starts.
await limitr.allow('ada', 'reports', 1);
console.log('reports reset on:', new Date(await limitr.resets('ada', 'reports') ?? 0).toISOString());

// A short period to watch a reset happen.
console.log(await limitr.allow('ada', 'burst', 2), await limitr.allow('ada', 'burst', 1)); // true false
await new Promise((resolve) => setTimeout(resolve, 1100));
console.log('after a second:', await limitr.allow('ada', 'burst', 1)); // true: a new period started
```

It prints:

```text
storage left: 750 MB
reports reset on: 2026-11-01T00:00:00.000Z
true false
after a second: true
```

- **Units.** A credit with `stof_units: 'MB'` is counted in megabytes, and limits and calls can use any size unit:
  `1GB` is 1000MB, so `'250MB'` leaves 750.
- **Rolling periods.** `resets: true` with `reset_inc` starts a new period that long after the last one began (`1s`,
  `1hr`, `1day`, `30days`). It's 30 days if you don't say.
- **Calendar periods.** `reset_sch` lines periods up with the calendar, in UTC: `'monthly:1'` (the 1st of each month),
  `'monthly:last'`, `'weekly:mon'`, `'yearly:1-1'`, `'quarterly:1'`.
- `resets(customer, entitlement)` returns when the current period ends, in milliseconds.
- A limit with no `resets` (storage here) never resets. It's a running total, and usage can go back down with a
  negative value or `decrement`.

Nothing runs on a timer. The engine sees that a period ended the next time the meter is used or read, so there are no
cron jobs to keep alive.

Next: [Hard, soft, and observe](05-hard-soft-observe.md)
