# 7. Identity and discovery

A key says a message is from the same party as before, not who that party is. An identity operator vouches for that,
and a discovery operator lets agents find services:

```ts
import { Limitr, LimitrNetwork } from '@formata/limitr';
import { serve } from './serve.mts';

// Identities are key pairs. Make the service's and the agent's up front, so the operator can know them.
const weatherKey = await LimitrNetwork.generateKey();
const agentKey = await LimitrNetwork.generateKey();

// An operator that serves identity and discovery, knows both keys (Ex. from its own accounts), and requires everyone
// who uses it to be identified.
const operator = await Limitr.new(`
policy: {
    network: {
        service: {
            label: 'Our network'
            roles: ['identity', 'discovery']
            requires: ['provider', 'consumer']
            identities: {
                '${weatherKey.publicKey}': 'Acme Weather, Inc.'
                '${agentKey.publicKey}': 'Example Corp'
            }
        }
    }
}`);
const operatorNetwork = await operator.network();
const channels = { ours: (request: Request) => operatorNetwork.operate(request) };
const ours = `ours: { url: 'https://operator.example', key: '${operatorNetwork.publicKey}', roles: ['identity', 'discovery'], channel: true }`;

const weather = await Limitr.new(`
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        operators: { ${ours} }
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']               // with an identity operator, its vouchers need an identity ('auto')
            routes: { forecast: { description: 'The weather forecast for a city', path: '/forecast', parameters: [{ name: 'city' }], entitlement: 'forecasts' } }
        }
    }
}`);
const service = await weather.network({ channels, secretKey: weatherKey.secretKey });
const server = serve(8787, (request) => service.handle(request, ({ query, subject }) => ({ city: query.get('city'), forecast: 'sunny', for: subject })));

// The service gets its statement (it goes in its manifest), and lists itself: private, for Example Corp.
console.log('weather is', await service.identify());
await service.list('private', { subjects: ['Example Corp'] });

// The agent: identified too, and it only connects to identified providers.
const agent = await Limitr.new(`policy: { network: { require_identity: true, operators: { ${ours} } } }`);
const network = await agent.network({ channels, secretKey: agentKey.secretKey });
console.log('agent is', await network.identify());

// It finds the service by what it does (a private listing it may see), and connects to it.
const found = await network.discover('weather forecast');
console.log('found:', found.map((provider) => `${provider.label} at ${provider.url}`));
await network.connect(found[0].url, 'agent', 1, Date.now() + 60 * 60 * 1000);
console.log('connected to', (await network.connection('acme_weather'))?.subject);
console.log(await agent.runCapability('acme_weather_forecast', { city: 'Boston' }));
server.close();
```

```
weather is Acme Weather, Inc.
agent is Example Corp
found: [ 'Acme Weather at http://localhost:8787' ]
connected to Acme Weather, Inc.
{"city":"Boston","forecast":"sunny","for":"Example Corp"}
```

What happened:

- **`LimitrNetwork.generateKey()`** makes a key pair, so the operator can know the service and the agent before they
  start (an operator like Limitr Cloud knows its accounts' keys instead).
- **Identity statements.** `identify()` asks the identity operator for a signed statement: "this key is Acme Weather,
  Inc.". The service's goes in its manifest; the agent's goes with every voucher.
- **Who must have one.** A provider with an identity operator requires one from every voucher by default
  (`network.provider.identity: 'auto'`; `'optional'` or per plan with `identity_plans`), and its work sees who it's
  serving (`subject`). An agent with `require_identity` connects only to identified providers. An operator with
  `requires` refuses anyone it hasn't identified, so everyone on it is known.
- **Discovery.** `list()` puts the service's manifest in the operator's directory: public, or private to some keys or to
  identified organizations (`subjects`), like private repositories. `discover(query)` is a signed search, so the
  operator shows a private listing only to its members. The results are the services' own signed manifests,
  checked by the agent, so a directory can't forge or change one, and `connect()` reads the manifest from the
  service itself.
- **Your own network.** Nothing here depends on Limitr Cloud: a company can run an operator for its own services and
  partners, and Cloud is the public one.

That's the protocol: vouchers, metered requests, receipts, and operators when you need them. The full design is in
[`SPEC.md`](../../../src/network/SPEC.md), and the wire format, for other languages, in
[`PROTOCOL.md`](../../../src/network/PROTOCOL.md).

Back to the [table of contents](README.md).
