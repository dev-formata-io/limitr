# 4. Metering

A route doesn't have to meter a fixed amount. Its work can meter the voucher's customer however the policy says, like
any Limitr customer, and the request costs whatever it metered:

```python
import time

from limitr import Limitr, LimitrNetwork, Response

# Two credits this time: forecasts at a cent, and AI summaries priced by the token.
weather = Limitr('''
policy: {
    credits: {
        forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } }
        token: { label: 'Token', unit: 'token', price: { amount: 0.00002 } }
    }
    plans: {
        agent: {
            label: 'Agents'
            entitlements: {
                forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } }
                summaries: { limit: { credit: 'token', mode: 'soft', value: 0 } }
            }
        }
    }
    network: {
        provider: {
            name: 'acme_weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                // No entitlement: the work meters, however it likes.
                week: { description: 'Forecasts for the next few days', path: '/week', parameters: [{ name: 'city' }, { name: 'days' }] }
                summary: { description: 'An AI summary of the week', path: '/summary', parameters: [{ name: 'city' }] }
                status: { description: 'Is the service up', path: '/status' }
            }
        }
    }
}''')
service = weather.network()


def work(call):
    if call.route == 'week':
        # One forecast per day asked for.
        days = int(call.query.get('days', 7))
        if not weather.allow(call.customer, 'forecasts', days):
            return Response(402, body='not within this request')
        return {'city': call.query.get('city'), 'days': days, 'forecast': 'sunny all week'}
    if call.route == 'summary':
        # An LLM call: what it costs isn't known until it's done (chapter 7 of the main tutorial).
        tokens = 1500
        if not weather.allow(call.customer, 'summaries', tokens):
            return Response(402, body='not within this request')
        return {'summary': f"A calm, sunny week in {call.query.get('city')}."}
    return {'ok': True}   # status: nothing meters it, so it's free


server = service.serve(work, port=8787)

agent = Limitr('policy: {}')
network = agent.network()
agent.add_handler('receipts', lambda key, receipt: print('  cost:', receipt['cost']) if key == 'network-receipt' else None)

# The agent caps every request at 5 cents, on top of the voucher's dollar.
network.connect('http://localhost:8787', 'agent', 1, time.time() * 1000 + 60 * 60 * 1000, max=0.05)

print('3 days:', agent.run_capability('acme_weather_week', {'city': 'Boston', 'days': 3}))
print('summary:', agent.run_capability('acme_weather_summary', {'city': 'Boston'}))
print('status:', agent.run_capability('acme_weather_status', {}))

# 7 days would be 7 cents: more than one request may spend, so the work's allow() says no.
week = agent.run_capability('acme_weather_week', {'city': 'Boston', 'days': 7})
refused = LimitrNetwork.refusal(week)
print('7 days:', refused['reason'] if refused else week)
print('spent:', network.connection('acme_weather')['spent'])
server.close()
```

It prints:

```text
  cost: 0.03
3 days: {"city":"Boston","days":3,"forecast":"sunny all week"}
  cost: 0.03
summary: {"summary":"A calm, sunny week in Boston."}
  cost: 0.0
status: {"ok":true}
  cost: 0.0
7 days: not within this request
spent: 0.06
```

What happened:

- **The work meters.** Routes without an `entitlement` leave it to the work, which gets the voucher's `customer` and
  calls `allow()` (or `reserve()` and `settle()`, main tutorial chapter 7) as it would for any customer: by forecasts
  asked for, by tokens, by bytes, by outcomes. Three days cost 3 cents; the summary, 1,500 tokens, cost 3 cents too.
- **What a request spent** is measured for its receipt: the module puts a cap on the voucher's customer for each
  request and reads it afterwards. Requests on one voucher run one at a time, so each receipt is exactly that
  request's cost.
- **A route nothing meters is free.** `status` cost 0.
- **The consumer can cap a request.** `connect(..., max=0.05)` signs a most-per-request into every request, and
  the service enforces it: past it, `allow()` in the work says no, like any limit. The 7-day request would have cost
  7 cents, so the work refused it and nothing was charged. The voucher's own spend (a dollar here) caps them all.
- **Declared or in the work.** `entitlement: 'forecasts'` on a route (chapters 2 and 3) is shorthand for metering one
  before the work. Use it for simple per-call prices, and meter in the work when the cost depends on the request.

Next: [A provider's own tools](05-provider-tools.md)
