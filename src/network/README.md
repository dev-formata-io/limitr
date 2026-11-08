# Limitr Network

Limitr Network lets one Limitr policy use another's services and pay for them, with no API keys exchanged and no
integration work. A service (a **provider**) publishes plans and prices from its policy. An agent, an app, or another
service (a **consumer**) signs a **voucher**: "I'll pay up to this much, on this plan, until then." The provider meters
the consumer like any of its customers, with the voucher's spend as a hard cap, and the consumer gets the provider's
routes as tools its agents can call. Every request and every receipt is signed, so both sides see the same spend and
neither can make up the other's.

The protocol is the **Limitr Network Protocol (LNP)**. It's peer to peer: two policies and HTTP. Optional
**operators** add shared state across provider instances, one budget across many providers, identity, and discovery;
anyone can run one, and Limitr Cloud is one.

It's an optional module: a policy that doesn't use it works as it always has, and never loads it.

## Quick start (TypeScript)

A provider: a policy with a plan, and a route that plan reaches.

```ts
import { Limitr } from '@formata/limitr';

const weather = await Limitr.new(`
policy: {
    credits: {
        forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } }   // a cent each, in runes
    }
    plans: {
        agent: {
            label: 'Agents'
            entitlements: {
                forecasts: { limit: { credit: 'forecast', mode: 'soft', value: 0 } }
            }
        }
    }
    network: {
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'https://weather.example.com'
            offers: ['agent']
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    method: 'GET'
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city, Ex. Boston' }]
                    entitlement: 'forecasts'      // metered before the work (or meter in the work, any way you like)
                }
            }
        }
    }
}`);

// Its identity: keep this key (vouchers are made out to it).
const network = await weather.network({ secretKey: process.env.WEATHER_SECRET_KEY });

// One web-standard handler serves the manifest, vouchers, cancels, and requests (Deno.serve, Bun.serve, Workers,
// Hono, Next.js; Node's http with a few lines, see the demo). The work runs only for requests that are signed,
// not replayed, and allowed.
export default async function handler(request: Request): Promise<Response> {
    return await network.handle(request, ({ route, customer, query }) => {
        return { city: query.get('city'), forecast: 'sunny' };
    });
}
```

A consumer: connect with a voucher, then call the route as a tool.

```ts
import { Limitr } from '@formata/limitr';

const agent = await Limitr.new('policy: {}');
const network = await agent.network({ name: 'support_agent' });

// Up to 3 cents, for an hour, on the 'agent' plan.
await network.connect('https://weather.example.com', 'agent', 0.03, Date.now() + 60 * 60 * 1000);

const tools = await agent.claudeTools();                                        // pass these to Claude
const result = await agent.runCapability('acme_weather_forecast', { city: 'Boston' });

const refused = network.refusal(result);       // a refused request is the tool's result, so an agent can act on it
if (refused) console.log(refused.status, refused.reason, refused.remaining);
```

Run the full version, two processes on your machine, in [`typescript/demos/network/`](../../typescript/demos/network/).

## What you get

- **No keys to exchange.** Each policy has an Ed25519 identity. The secret key stays in your process; the policy signs
  through a host function that signs only Network messages.
- **Spend that can't be exceeded.** A voucher's spend is a cap on its customer at the provider, and the consumer can
  cap each request too (`max`).
- **Metering however your policy says.** A request's work meters the voucher's customer like any Limitr customer (by
  calls, tokens, bytes, outcomes), and the module measures what it spent for the receipt.
- **Receipts both sides can check.** Every response carries the provider's signed receipt: what the request cost, a
  digest of the response body, and what the voucher has spent and has left.
- **Tools without integration.** Each route is a tool on the consumer's side as-is. A provider can also ship tools of
  its own in Stof, which run on the consumer's side only if it trusts the provider's logic, sealed and confined (they
  see nothing of the consumer's policy and reach the provider only through its routes).
- **Operators when you need them** (`network.operators`):
  - **state:** one voucher across any number of provider instances (`strict`, exact; or `bounded`, with leases), and
    **budgets**: one spend across many providers;
  - **identity:** "this key is Acme Corp", for consumers and providers, required by default when a provider has an
    identity operator, and an operator can require it of everyone;
  - **discovery:** public and private listings, found with signed searches; results are the providers' own signed
    manifests, so an index can't forge one.

  An operator can be reached over HTTP or through a channel your host already has, and it rotates its key without
  breaking anyone's vouchers. Any policy can be one (`network.service`).

## Where to read more

- [`SPEC.md`](SPEC.md): the design: roles, metering, operators, identity, and security notes.
- [`PROTOCOL.md`](PROTOCOL.md): the wire format, with test vectors, for implementing or auditing it.
- [The tutorial](../../typescript/tutorial/network/): a provider, a consumer, tools, operators, step by step.
- [The demo](../../typescript/demos/network/): a weather service and an agent that buys forecasts.
- `spec/`: the module's source, every shape a Stof type; `tests/`: its tests (`stof test` in the repo runs them).
