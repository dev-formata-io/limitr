# 5. A provider's own tools

Routes become tools as they are. A provider can also ship tools of its own, written in Stof, that run on the agent's
side and call its routes: checking arguments before a paid call, combining several calls, shaping a response.

```python
import time

from limitr import Limitr

HIGHS = {'Boston': 12, 'Denver': 15, 'Austin': 27}

weather = Limitr('''
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        provider: {
            name: 'acme_weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                forecast: { description: 'The forecast for a city', path: '/forecast', parameters: [{ name: 'city' }], entitlement: 'forecasts' }
            }

            // A tool of its own: Stof that runs on the agent's side, calling the route above.
            tools: {
                warmest: {
                    description: 'Which of a few cities will be warmest today'
                    parameters: [{ name: 'cities', description: 'City names, separated by commas' }]
                }
            }
            logic: r#"
                fn warmest(input: map) -> unknown {
                    let best = null;
                    for (const city in input.get('cities').split(',')) {
                        const forecast = self.api.json(self.api.call('forecast', map(('city', city.trim()))));
                        if (best == null || forecast.get('high') > best.get('high')) best = forecast;
                    }
                    best
                }
            "#
        }
    }
}''')
service = weather.network()


def work(call):
    city = call.query.get('city', '')
    return {'city': city, 'high': HIGHS.get(city, 20)}


server = service.serve(work, port=8787)

agent = Limitr('policy: {}')
network = agent.network()

# By default an agent trusts a provider's declarations: its routes are tools, and none of its code runs.
print('declarations:', network.connect('http://localhost:8787', 'agent', 1, time.time() * 1000 + 60 * 60 * 1000))

# Trusting its logic adds its own tools, run here, sealed and confined.
print('logic:', network.trust('acme_weather', 'logic'))
print(agent.run_capability('acme_weather_warmest', {'cities': 'Boston, Denver, Austin'}))
print('spent:', network.connection('acme_weather')['spent'], '(three forecasts, each signed and metered)')
server.close()
```

It prints:

```text
declarations: ['acme_weather_forecast']
logic: ['acme_weather_forecast', 'acme_weather_warmest']
{"city":"Austin","high":27}
spent: 0.03 (three forecasts, each signed and metered)
```

What happened:

- **`tools` and `logic`.** Each tool is declared like a route's tool (a description and parameters) and implemented by
  a function of the same name in `logic`, Stof source that takes the tool's input as a map. `self.api.call(route,
  args)` makes a request to one of the provider's routes and returns its body; `self.api.json(text)` reads JSON.
- **Trust is the agent's choice.** By default an agent trusts a provider's declarations only: its routes are tools and
  none of its code runs. `trust('acme_weather', 'logic')` (or `connect(..., trust='logic')`) adds its own tools.
- **Sealed and confined.** The logic is part of the terms the voucher agreed to, so it's exactly the code the agent
  read. It's loaded as declarations only and sealed: it sees nothing of the agent's policy, keeps no state, calls no
  host (no HTTP of its own, no keys), and runs for at most 30 seconds (`network.tool_time`).
- **It can only spend like requests do.** Its one way out is `self.api`, which signs requests to this provider's routes
  for this voucher only, and every one is checked and metered by the service like any other. `warmest` made three
  forecast requests: three cents. A tool can't sign a voucher, so it can never raise its own spend.
- **A tool's result is the provider's word,** like any response. Treat it as data, not instructions.

Next: [Operators and budgets](06-operators-and-budgets.md)
