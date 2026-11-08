# 5. A provider's own tools

Routes become tools as they are. A provider can also ship tools of its own, written in Stof, that run on the agent's
side and call its routes: checking arguments before a paid call, combining several calls, shaping a response.

```ts
import { Limitr } from '@formata/limitr';
import { serve } from './serve.mts';

const HIGHS: Record<string, number> = { Boston: 12, Denver: 15, Austin: 27 };

const weather = await Limitr.new(`
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
}`);
const service = await weather.network();
const server = serve(8787, (request) => service.handle(request, ({ query }) => {
    const city = query.get('city') ?? '';
    return { city, high: HIGHS[city] ?? 20 };
}));

const agent = await Limitr.new('policy: {}');
const network = await agent.network();

// By default an agent trusts a provider's declarations: its routes are tools, and none of its code runs.
console.log('declarations:', await network.connect('http://localhost:8787', 'agent', 1, Date.now() + 60 * 60 * 1000));

// Trusting its logic adds its own tools, run here, sealed and confined.
console.log('logic:', await network.trust('acme_weather', 'logic'));
console.log(await agent.runCapability('acme_weather_warmest', { cities: 'Boston, Denver, Austin' }));
console.log('spent:', (await network.connection('acme_weather'))?.spent, '(three forecasts, each signed and metered)');
server.close();
```

```
declarations: [ 'acme_weather_forecast' ]
logic: [ 'acme_weather_forecast', 'acme_weather_warmest' ]
{"city":"Austin","high":27}
spent: 0.03 (three forecasts, each signed and metered)
```

What happened:

- **`tools` and `logic`.** Each tool is declared like a route's tool (a description and parameters) and implemented by
  a function of the same name in `logic`, Stof source that takes the tool's input as a map. `self.api.call(route,
  args)` makes a request to one of the provider's routes and returns its body; `self.api.json(text)` reads JSON.
- **Trust is the agent's choice.** By default an agent trusts a provider's declarations only: its routes are tools and
  none of its code runs. `trust('acme_weather', 'logic')` (or `connect(..., { trust: 'logic' })`) adds its own tools.
- **Sealed and confined.** The logic is part of the terms the voucher agreed to, so it's exactly the code the agent
  read. It's loaded as declarations only and sealed: it sees nothing of the agent's policy, keeps no state, calls no
  host (no HTTP of its own, no keys), and runs for at most 30 seconds (`network.tool_time`).
- **It can only spend like requests do.** Its one way out is `self.api`, which signs requests to this provider's routes
  for this voucher only, and every one is checked and metered by the service like any other. `warmest` made three
  forecast requests: three cents. A tool can't sign a voucher, so it can never raise its own spend.
- **A tool's result is the provider's word,** like any response. Treat it as data, not instructions.

Next: [Operators and budgets](06-operators-and-budgets.md)
