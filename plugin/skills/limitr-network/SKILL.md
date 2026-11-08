---
name: limitr-network
description: >
  Build on Limitr Network, the Limitr Network Protocol (LNP): services (providers) that sell routes to agents and other
  services (consumers), paid with signed vouchers instead of API keys. Use for a policy's `network: { ... }` (provider,
  routes, tools and logic, operators, service), the TypeScript `limitr.network()` API (handle, connect, update, cancel,
  trust, budget, identify, list, discover, channels), vouchers, receipts, refusals, metering a request's work,
  operators (state, budgets, identity, discovery, key rotation), the wire format, and tests in src/network. Load the
  limitr skill for policy semantics, limitr-ts for the rest of the SDK, and stof for Stof syntax.
---

# Limitr Network

Limitr Network lets one Limitr policy use another's services and pay for them. A **provider** publishes plans, prices,
and **routes** from its policy. A **consumer** signs a **voucher** ("up to this much, on this plan, until then"). The
provider makes a voucher **customer** (ID `nv_<voucher>`, type `voucher`) with the spend as a cap, and grants the
routes its plan reaches; on the consumer's side each route is a **tool** (a capability). Every request is signed by
the consumer's key and every response carries the provider's signed **receipt**. Prices are in **runes** (the
provider's exchange says what a rune is; 1 USD by default).

It's an optional module (`src/network/`): a policy that doesn't call `limitr.network()` never loads it. The whole
protocol, its HTTP included, runs in the policy; the host keeps the key, allows hosts, and passes requests to one
handler.

Docs in the repo: `src/network/README.md` (overview), `src/network/SPEC.md` (design), `src/network/PROTOCOL.md`
(wire format and test vectors), `typescript/tutorial/network/` (seven runnable chapters), `typescript/demos/network/`.
Every field: `references/config.md`.

## A provider

```ts
import { Limitr } from '@formata/limitr';

const weather = await Limitr.new(`
policy: {
    credits: { forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } } }
    plans: { agent: { label: 'Agents', entitlements: { forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } } } } }
    network: {
        provider: {
            name: 'acme_weather'                  // names its tools: acme_weather_forecast
            label: 'Acme Weather'
            url: 'https://weather.example.com'    // its public URL: the manifest and routes are under it
            offers: ['agent']                     // plans offered on the network
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    method: 'GET'                 // GET and DELETE take arguments as a query string, others a JSON body
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city' }]
                    entitlement: 'forecasts'      // optional: metered before the work (value: 1 by default)
                }
            }
        }
    }
}`);

const network = await weather.network({ secretKey: process.env.WEATHER_SECRET_KEY });

export async function handler(request: Request): Promise<Response> {
    return await network.handle(request, async ({ route, customer, subject, query, body, request }) => {
        // runs only for signed, fresh, allowed requests; meter more here with `customer` if the route needs it
        return { city: query.get('city'), forecast: 'sunny' };   // an object (JSON), a string, or a Response
    });
}
```

- `handle` serves the manifest (`GET /.well-known/limitr-network`), vouchers, cancels, and every route. It's
  web-standard (Deno, Bun, Workers, Hono, Next.js as is; Node's http needs a small adapter, see the demo).
- **Keep the provider's key** (`secretKey`): vouchers are made out to it. Without one a new key is made each start
  (and given to `keyStore`). `LimitrNetwork.generateKey()` makes one up front.
- **Metering in the work:** a route without `entitlement` leaves metering to the work: `await weather.allow(customer,
  'summaries', tokens)` (or `reserve`/`settle`), by whatever the policy counts. The request's cost (for its receipt)
  is what it metered, measured by a cap the module puts on the voucher's customer for the request. A request nothing
  meters is free. Return a `Response` with status 402 when the work's `allow` says no.
- Requests on one voucher run one at a time per instance (a queue), so each receipt is exactly its request's cost.
- `revoke(voucher, reason)` ends a voucher (returns the signed revoke to deliver); `sweep()` removes ended voucher
  customers after `keep_ended` (handle runs it hourly).

### A provider's own tools

`network.provider.tools` declares tools (`{ description, parameters, plans? }`), each a function of the same name in
`network.provider.logic` (Stof source, part of the terms). They run on the consumer's side only with `trust: 'logic'`,
loaded as untrusted source and sealed: no access to the consumer's policy, no objects, no HTTP or host libraries (only
`<Network>.TOOL_LIBS`), at most `network.tool_time` (30s). Their way out is `self.api.call(route, args)` (a signed,
metered request to one of this provider's routes; returns the body) and `self.api.json(text)`.

```stof
logic: r#"
    fn warmest(input: map) -> unknown {
        let best = null;
        for (const city in input.get('cities').split(',')) {
            const f = self.api.json(self.api.call('forecast', map(('city', city.trim()))));
            if (best == null || f.get('high') > best.get('high')) best = f;
        }
        best
    }
"#
```

## A consumer

```ts
const agent = await Limitr.new('policy: {}');
const network = await agent.network({ name: 'support_agent' });

await network.connect('https://weather.example.com', 'agent', 0.03, Date.now() + 3600_000, { max: 0.01 });
const tools = await agent.claudeTools();                          // for Claude
const result = await agent.runCapability('acme_weather_forecast', { city: 'Boston' });
const refused = network.refusal(result);                          // { provider, status, reason, spent, remaining, ... }

agent.addHandler('spend', (key, value) => {
    if (key === 'network-receipt') console.log(JSON.parse(value as string));   // { name, voucher, n, cost, spent, remaining, ... }
});

await network.update('acme_weather', { spend: 0.10 });            // a newer voucher (more spend or time)
await network.trust('acme_weather', 'logic');                    // add the provider's own tools
await network.connection('acme_weather');                        // { spent, remaining, customer, subject, routes, tools, ... }
await network.cancel('acme_weather');
```

- `connect(url, plan, spend, expires, { budget, trust, mayCall, max })` reads and checks the manifest, signs the
  voucher, takes the grant, and returns the new tools' names. The voucher agrees to the terms' exact digest, so new
  terms need a new voucher.
- **A refusal is the tool's result**, not an error: `{ "refused": { status, reason, spent, remaining, ... } }`
  (and a `network-refused` event). 401: the signature, voucher, replay, or route; 402: limits, spend, or expiry; 503:
  the provider's operator is unreachable. A provider's tool that fails gives `{ "failed": { ... } }` (`failure()`).
- The agent can't raise its own spend: only the host's `update()` signs vouchers.
- `max` caps each request (runes), enforced by the provider on top of the voucher's spend.
- `mayCall: ['acme_maps']` lets a trusted provider's tools call the consumer's other connections' routes.
- One voucher belongs to one consumer process (its request numbers live there); several instances use several
  vouchers, under one budget.

## Operators

Optional parties both sides trust, by role, at most one per role, in `network.operators`:

```stof
network: {
    operators: {
        ours: { url: 'https://operator.example', key: '<its first public key>', roles: ['state', 'identity', 'discovery'],
                state: { mode: 'strict' }, channel: true }
    }
}
```

- **state:** voucher state across provider instances (`strict`: each request claimed first, exact; `bounded`: leases,
  fast, overshoot at most the outstanding leases), fail-closed by default (`offline: 'refuse'`). **Budgets:**
  `network.budget('ours', spend, expires, { providers })` then `connect(..., { budget })`; `budgetInfo(id)`.
- **identity:** `network.identify()` gets "this key is <subject>"; consumers send it with every voucher, providers put
  theirs in their manifest. A provider requires one by default when it has an identity operator
  (`provider.identity: 'auto' | 'required' | 'optional'`, per plan with `identity_plans`); the work sees `subject`.
  A consumer with `require_identity: true` connects only to identified providers.
- **discovery:** `network.list('public' | 'private', { members, subjects })`, `unlist()`, and
  `network.discover(query, { limit })` (signed; results are providers' own signed manifests: `{ key, name, label, url,
  terms }`).
- **channel: true** sends an operator's messages through the host: `limitr.network({ channels: { ours: (request) =>
  response } })` (web-standard; another policy's `network.operate` is one). Never falls back to HTTP.
- **Any policy can be an operator:** `network.service` (`roles`, `identities`, `requires`, `rotations`, ...), served
  with `network.operate(request)`. `requires: ['provider', 'consumer']` refuses keys it hasn't identified.
- **Key rotation:** an operator is named by its first key; `network.rotation(newPublicKey)` returns a statement to
  append to `service.rotations`, then it runs with the new key. Policies follow the chain; vouchers go on.
- `checkOperators()` reads and checks every operator's manifest.

## Common mistakes

1. **A new provider key each start.** Existing vouchers are made out to the old key. Pass `secretKey`.
2. **`url` that isn't the public URL.** It's in the terms and where consumers send requests.
3. **`http://` URLs.** Only `localhost` and `127.0.0.1` may be http; everything else must be https.
4. **A route's entitlement not in the plan.** The policy doesn't validate (`fits()`): every offered plan a route
   reaches must have its entitlement.
5. **Changing terms under live vouchers.** Prices, plans, routes, tools, or logic change the terms' digest; updates to
   older vouchers are refused, and consumers connect again.
6. **Treating a refusal as an exception.** Read `network.refusal(result)` and act (tell the user, stop, or top up).
7. **Requiring identity without an identity operator.** `identity: 'required'` with no operator serving identity
   doesn't validate (`'auto'` is optional then).
8. **Stof hosts: capturing arrows in `serve(request, work)`.** Stof keeps one function per arrow literal, so concurrent
   requests can see each other's captured variables; pass a named function (its `self` is its object).
9. **Sharing a voucher across consumer processes.** Their request numbers collide (refused as replays).
