//
// Copyright 2026 Formata, Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

// A weather service that sells forecasts on Limitr Network. Its policy says what it offers (a plan for agents, at a
// cent a forecast), the routes that plan reaches, and one tool of its own (Stof that runs on the agent's side, for
// agents that trust it, calling its routes). Limitr does the rest: the manifest, vouchers, checking and metering every
// request, and receipts.
//
//   node demos/network/provider.ts

import http from 'node:http';
import { Limitr } from '@formata/limitr';

const PORT = 8787;

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
            url: 'http://localhost:${PORT}'
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

            // A tool of its own: two forecasts, compared on the agent's side (each request still signed and metered here).
            tools: {
                compare: {
                    description: 'Which of two cities will be warmer today'
                    parameters: [{ name: 'a', description: 'A city' }, { name: 'b', description: 'Another city' }]
                }
            }
            logic: r#"
                fn compare(input: map) -> unknown {
                    const a = self.forecast(input.get('a'));
                    const b = self.forecast(input.get('b'));
                    const warmer = a.get('high') >= b.get('high') ? a : b;
                    map(('warmer', warmer.get('city')), ('high', warmer.get('high')), ('by', Num::abs(a.get('high') - b.get('high'))))
                }

                fn forecast(city: str) -> map {
                    self.api.json(self.api.call('forecast', map(('city', city))))
                }
            "#
        }
    }
}
`);

// The provider's identity. Keep this key (vouchers are made out to it): here it comes from the environment, or a new
// one is made for this run.
const network = await weather.network({ secretKey: process.env.WEATHER_SECRET_KEY });

// Today's highs (C), standing in for a real forecast.
const HIGHS: Record<string, number> = { Boston: 12, Denver: 15, Austin: 27, Seattle: 11 };

// The protocol's own paths and the requests to its routes, all through one web-standard handler (Request in, Response
// out). The work runs only for requests that are signed by a voucher's key, not replayed, and allowed (within the
// voucher's spend), whether the agent's host made them or this provider's tool did, on the agent's side.
async function handler(request: Request): Promise<Response> {
    return await network.handle(request, ({ route, customer, query }) => {
        const city = query.get('city') ?? 'somewhere';
        console.log(`${customer} asked for ${route}: ${city}`);
        return { city, forecast: 'sunny', high: HIGHS[city] ?? 20 };
    });
}

// Deno.serve(handler), Bun.serve({ fetch: handler }), a Cloudflare Worker, or a Hono or Next.js route take the handler
// as is. Node's http speaks its own request and response, so it needs a few lines to turn them into web ones:
const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(`http://localhost:${PORT}${req.url ?? '/'}`, { method: req.method, headers, body: hasBody ? body : undefined });

    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
});

server.listen(PORT, () => {
    console.log(`Acme Weather on http://localhost:${PORT} (manifest at /.well-known/limitr-network)`);
    console.log(`identity: ${network.publicKey}`);
});
