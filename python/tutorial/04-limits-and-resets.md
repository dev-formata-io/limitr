# 4. Limits and resets

A limit says which credit it counts and how much of it the plan includes. Most usage limits also **reset**: a daily
API quota, a monthly allowance.

```python
import time
from datetime import datetime, timezone

from limitr import Limitr

policy = Limitr("""
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
                api: {
                    limit: {
                        credit: 'request', value: 1000
                        resets: true, reset_inc: 1day
                    }
                }
                reports: {
                    limit: {
                        credit: 'report', value: 5
                        resets: true, reset_sch: 'monthly:1'
                    }
                }
                storage: { limit: { credit: 'storage', value: 1GB } }
                burst: {
                    limit: {
                        credit: 'request', value: 2
                        resets: true, reset_inc: 1s
                    }
                }
            }
        }
    }
}
""")
policy.ensure_customer('ada')

# Values can carry units: 250MB of a 1GB (1000MB) limit.
policy.allow('ada', 'storage', '250MB')
print('storage left:', policy.remaining('ada', 'storage'), 'MB')

# The first use starts a period, and resets() says when the next one starts (ms).
policy.allow('ada', 'reports', 1)
next_period = datetime.fromtimestamp(policy.resets('ada', 'reports') / 1000, timezone.utc)
print('reports reset on day', next_period.day, 'of next month')

# A short period to watch a reset happen.
print('2 now:', policy.allow('ada', 'burst', 2))
# Over the limit of 2
print('1 more:', policy.allow('ada', 'burst', 1))
time.sleep(1.1)
# A new period started
print('after a second:', policy.allow('ada', 'burst', 1))
```

It prints:

```text
storage left: 750.0 MB
reports reset on day 1 of next month
2 now: True
1 more: False
after a second: True
```

- **Units.** Units are part of Stof, so a policy can say `1GB` or `1day` and mean it. A credit with
  `stof_units: 'MB'` is counted in megabytes, and limits and calls can use any size unit: `1GB` is 1000MB, so
  `'250MB'` leaves 750. Time periods work the same way (`1s`, `1hr`, `30days`).
- **Rolling periods.** `resets: true` with `reset_inc` starts a new period that long after the last one began (`1s`,
  `1hr`, `1day`, `30days`). It's 30 days if you don't say.
- **Calendar periods.** `reset_sch` lines periods up with the calendar, in UTC: `'monthly:1'` (the 1st of each month),
  `'monthly:last'`, `'weekly:mon'`, `'yearly:1-1'`, `'semiannual:1-1'` (Jan 1 and Jul 1), `'quarterly:1'`.
- `resets(customer, entitlement)` returns when the current period ends, in milliseconds.
- A limit with no `resets` (storage here) never resets. It's a running total, and usage can go back down with a
  negative value or `decrement`.

Nothing runs on a timer. The engine sees that a period ended the next time the meter is used or read, so there are no
cron jobs to keep alive.

Next: [Hard, soft, and observe](05-hard-soft-observe.md)
