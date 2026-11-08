# 2. A provider

A provider is a policy with `network.provider`. Here's a weather service with one plan for agents, at a cent a
forecast:

```ts
import { Limitr } from '@formata/limitr';
import { serve } from './serve.mts';

// A weather service: a plan for agents, at a cent a forecast, and one route that plan reaches.
const weather = await Limitr.new(`
policy: {
    credits: {
        forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } }
    }
    plans: {
        agent: {
            label: 'Agents'
            entitlements: {
                forecasts: { description: 'Forecasts, a cent each', limit: { credit: 'forecast', mode: 'soft', value: 0 } }
            }
        }
    }
    network: {
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    method: 'GET'
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city, Ex. Boston' }]
                    entitlement: 'forecasts'
                }
            }
        }
    }
}`);

// Its identity. A real service keeps this key (vouchers are made out to it): pass { secretKey } from your secrets.
const network = await weather.network();
console.log('identity:', network.publicKey.slice(0, 12) + '...');

// One handler for everything: the manifest, vouchers, cancels, and requests to routes.
async function handler(request: Request): Promise<Response> {
    return await network.handle(request, ({ route, customer, query }) => {
        return { city: query.get('city'), forecast: 'sunny', high: 12 };
    });
}

// Serve it (serve.mts, below, adapts Node's http; Deno.serve(handler) or Bun.serve({ fetch: handler }) take it as is).
const server = serve(8787, handler);

// What anyone sees: the manifest, signed by the service's key.
const manifest = await (await fetch('http://localhost:8787/.well-known/limitr-network')).json();
const message = JSON.parse(manifest.message);
const terms = JSON.parse(message.body.terms);
console.log('type:', message.type, '| signed by its key:', manifest.key === network.publicKey);
console.log('plans:', Object.keys(terms.plans), '| a forecast costs', terms.credits.forecast.price, 'runes');
console.log('routes:', Object.keys(terms.routes), '| a rune is', terms.rune);

// A request without a voucher is refused, and the work never runs.
const plain = await fetch('http://localhost:8787/forecast?city=Boston');
console.log('without a voucher:', plain.status, await plain.text());

server.close();
```

`serve.mts`, which the next chapters use too:

```ts
import http from 'node:http';

/** Serve a web-standard handler (Request in, Response out) with Node's http. Deno.serve and Bun.serve take it as is. */
export function serve(port: number, handler: (request: Request) => Promise<Response>) {
    return http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: hasBody ? body : undefined });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
    }).listen(port);
}
```

```
identity: Md71kNNDqF9z...
type: manifest | signed by its key: true
plans: [ 'agent' ] | a forecast costs 0.01 runes
routes: [ 'forecast' ] | a rune is { value: 1, currency: 'usd' }
without a voucher: 401 not a Limitr Network request
```

What happened:

- **The policy is the price list.** The plan, its entitlement, and the credit's price are ordinary Limitr (main
  tutorial, chapters 2 to 6). `network.provider` adds the service's name (it names its tools: `acme_weather_forecast`),
  its URL, the plans it offers on the network, and its **routes**.
- **A route** is a request a customer may make: a method and path, its parameters (they become the tool's input), and
  optionally the entitlement it meters (`entitlement: 'forecasts'` meters one forecast before the work runs; chapter 4
  meters in the work instead). Its `description` is what an agent reads to decide when to call it.
- **`weather.network()`** loads the Network module and gives the policy an identity: a key pair. The policy signs
  through it but never holds the secret key. A real service passes its key (`{ secretKey }`) so it stays the same
  across restarts, since vouchers are made out to it; `LimitrNetwork.generateKey()` makes one.
- **One handler** serves the protocol's own paths (the manifest at `/.well-known/limitr-network`, vouchers, cancels)
  and every route. It takes and returns web-standard `Request` and `Response`, so Deno, Bun, Workers, Hono, and
  Next.js use it as is. The work function runs only for a request that's signed by a voucher's key, not a replay,
  and allowed by the policy. Whatever it returns is the response body (an object as JSON, or a `Response`).
- **The manifest** is the service's **terms**, signed by its key: its plans, what each credit costs in runes (never
  what it costs the service), and its routes. It's built from the policy, so the price an agent agrees to is the
  price the policy charges.
- **A plain request is refused** (401) before any work runs. Without a voucher there's no customer to meter.

Next: [A consumer](03-a-consumer.md)
