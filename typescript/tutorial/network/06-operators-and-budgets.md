# 6. Operators and budgets

Two policies are enough until a provider runs on more than one server (each would keep its own voucher state), or an
agent wants one spend across several providers. An **operator** is a third party both sides trust with that state:

```ts
import { Limitr } from '@formata/limitr';
import { serve } from './serve.mts';

// An operator: a policy that serves the state role. Limitr Cloud is one; any policy can be.
const operator = await Limitr.new(`policy: { network: { service: { label: 'Our operator' } } }`);
const operatorNetwork = await operator.network();

// Everyone reaches it through a channel instead of HTTP: here, a direct call to its handler. (Over HTTP, it would
// be served like a provider: serve(port, (request) => operatorNetwork.operate(request)).)
const channels = { ours: (request: Request) => operatorNetwork.operate(request) };
const ours = `ours: { url: 'https://operator.example', key: '${operatorNetwork.publicKey}', roles: ['state'], channel: true }`;

// The weather service, running as two instances (same policy, same key) behind one URL.
const policy = `
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        operators: { ${ours} }
        provider: {
            name: 'acme_weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: { forecast: { description: 'The forecast for a city', path: '/forecast', parameters: [{ name: 'city' }], entitlement: 'forecasts' } }
        }
    }
}`;
let secretKey = '';
const first = await (await Limitr.new(policy)).network({ channels, keyStore: (key) => { secretKey = key; } });
const second = await (await Limitr.new(policy)).network({ channels, secretKey });
const instances = [first, second];
let next = 0;
const server = serve(8787, (request) => {
    const instance = instances[next++ % 2];   // a load balancer, taking turns
    return instance.handle(request, ({ query }) => ({ city: query.get('city'), forecast: 'sunny' }));
});

// The agent opens a budget at the operator: 2 cents, across whichever providers it connects to with it.
const agent = await Limitr.new(`policy: { network: { operators: { ${ours} } } }`);
const network = await agent.network({ channels });
const budget = await network.budget('ours', 0.02, Date.now() + 60 * 60 * 1000);

// Its voucher allows a dollar, but spends from the budget.
await network.connect('http://localhost:8787', 'agent', 1, Date.now() + 60 * 60 * 1000, { budget });
for (const city of ['Boston', 'Denver', 'Austin']) {
    const result = await agent.runCapability('acme_weather_forecast', { city });
    console.log(city, network.refusal(result)?.reason ?? result);
}
console.log('budget:', await network.budgetInfo(budget));
server.close();
```

```
Boston {"city":"Boston","forecast":"sunny"}
Denver {"city":"Denver","forecast":"sunny"}
Austin not enough spend left (the voucher's, or its budget's)
budget: {
  budget: 'rSmQ6J0N5BpNBmGCcnpu7',
  operator: 'ours',
  seq: 1,
  spend: 0.02,
  expires: 1794108767456,
  providers: null,
  spent: 0.02,
  remaining: 0
}
```

What happened:

- **An operator is a policy too**, with `network.service`: a key, and the roles it serves (`state` here, the default).
  Limitr Cloud is one, and anyone can run their own. Policies name the operators they use in `network.operators`, at
  most one per role.
- **Two instances, one voucher.** The service's instances share its key and policy, and both use the operator for
  state. The first accepted the voucher and registered it there; the second got the next request, found the voucher
  at the operator, and checked the agent's signature on it itself (the operator can't forge one). Each request is
  claimed from the operator first, so spend and replays are exact across any number of instances (`strict`, the
  default; `bounded` trades that for fewer round trips, with leases).
- **A budget** is one spend at the operator, across whichever providers the agent connects to with it. The voucher
  allowed a dollar, but the budget allowed 2 cents, so the third forecast was refused.
- **Channels.** Operator messages are signed, so they don't need HTTP: `channels` hands them to a function, here a
  direct call to the operator's handler, and in production any connection the host already has. Answers are still
  checked with the operator's key. On a `Limitr.cloud()` engine you don't set any of this up: `limitr.network()` adds
  Cloud as the `limitr` operator, over the engine's WebSocket (when your workspace has Limitr Network). Over HTTP, an operator is served like a provider:
  `serve(port, (request) => operatorNetwork.operate(request))`.
- **It fails closed.** If the operator can't be reached, the service refuses requests (503) rather than spend what it
  can't count.
- **Keys rotate.** An operator is known by its first key, and can move to a new one (`rotation()`) without breaking
  anyone's vouchers: policies follow the chain in its manifest.

Next: [Identity and discovery](07-identity-and-discovery.md)
