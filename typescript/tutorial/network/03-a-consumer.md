# 3. A consumer

A consumer is any policy that connects to a provider. This one is an agent with an empty policy:

```ts
import { Limitr } from '@formata/limitr';
import { serve } from './serve.mts';

// The weather service from chapter 2.
const weather = await Limitr.new(`
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city, Ex. Boston' }]
                    entitlement: 'forecasts'
                }
            }
        }
    }
}`);
const service = await weather.network();
const server = serve(8787, (request) => service.handle(request, ({ query }) => ({ city: query.get('city'), forecast: 'sunny' })));

// An agent: an empty policy, and an identity of its own.
const agent = await Limitr.new('policy: {}');
const network = await agent.network({ name: 'support_agent' });

// Every response comes with a receipt signed by the service.
agent.addHandler('receipts', (key, value) => {
    if (key !== 'network-receipt') return;
    const receipt = JSON.parse(value as string);
    console.log(`  receipt: cost ${receipt.cost}, spent ${receipt.spent}, ${receipt.remaining} left`);
});

// A voucher: up to 3 cents on the 'agent' plan, for an hour.
const tools = await network.connect('http://localhost:8787', 'agent', 0.03, Date.now() + 60 * 60 * 1000);
console.log('tools:', tools);
console.log('for Claude:', (await agent.claudeTools()).map((tool) => tool.name));

for (const city of ['Boston', 'Denver', 'Austin']) {
    console.log(city, await agent.runCapability('acme_weather_forecast', { city }));
}

// The voucher is spent: the fourth is refused, as the tool's result.
const result = await agent.runCapability('acme_weather_forecast', { city: 'Seattle' });
const refused = network.refusal(result);
console.log('refused:', refused?.status, refused?.reason);

// More spend is a newer voucher. Then the call goes through.
await network.update('acme_weather', { spend: 0.10 });
console.log('Seattle', await agent.runCapability('acme_weather_forecast', { city: 'Seattle' }));

// On the service's side, the voucher is a customer like any other.
const connection = await network.connection('acme_weather');
console.log('service sees', connection?.customer, 'with', await weather.value(connection!.customer!, 'forecasts'), 'forecasts');

await network.cancel('acme_weather');
console.log('after cancel:', (await agent.claudeTools()).length, 'tools');
server.close();
```

```
tools: [ 'acme_weather_forecast' ]
for Claude: [ 'acme_weather_forecast' ]
  receipt: cost 0.01, spent 0.01, 0.02 left
Boston {"city":"Boston","forecast":"sunny"}
  receipt: cost 0.01, spent 0.02, 0.01 left
Denver {"city":"Denver","forecast":"sunny"}
  receipt: cost 0.01, spent 0.03, 0 left
Austin {"city":"Austin","forecast":"sunny"}
  receipt: cost 0, spent 0.03, 0 left
refused: 402 not allowed: a limit, the voucher's spend, or its expiry
  receipt: cost 0.01, spent 0.04, 0.06 left
Seattle {"city":"Seattle","forecast":"sunny"}
service sees nv_PJgOiUpLsg9H92aRHesbT with 4 forecasts
after cancel: 0 tools
```

What happened:

- **`connect(url, plan, spend, expires)`** reads the manifest, checks its signature, signs a voucher for 3 cents on
  the `agent` plan for an hour, and takes the service's grant. It returns the new tools' names. The voucher agrees to
  the exact terms it read: if the service changes its prices, it needs a new voucher, so prices can't change under it.
- **Each route is a tool.** `acme_weather_forecast` is a capability in the agent's policy, so `claudeTools()` lists it
  for Claude and `runCapability()` runs it, as for any capability. For each `tool_use` block Claude sends, run
  `runCapability(block.name, block.input)` and send the result back as a `tool_result`.
- **Each call is signed** by the agent's key and numbered, so it can't be replayed or changed on the way. The service
  meters it under the voucher's customer and answers with a signed **receipt**, sent as a `network-receipt` event:
  what the request cost, and what the voucher has spent and has left. The agent checks the receipt matches the
  response it got.
- **The voucher's spend is a hard cap.** The fourth forecast is refused (402), and the refusal is the tool's result,
  not an error, so an agent can read it and act: tell its user, stop, or ask its host for more. `refusal(result)`
  reads one. The agent can't raise its own spend: only the host can, with `update()`, which signs a newer voucher.
- **On the service's side** the voucher is a customer (`nv_` and the voucher's ID, type `voucher`) on its plan. Its
  usage, events, margins, and Limitr Cloud see it like any customer.
- **`cancel()`** ends the voucher on both sides and removes the tools. A voucher also ends at its expiry, so one that's
  never cancelled doesn't stay open, and the service can end one too (`revoke()`).

Next: [Metering](04-metering.md)
