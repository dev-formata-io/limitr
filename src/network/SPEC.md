# Limitr Network: protocol and module spec (0.1)

The protocol is the **Limitr Network Protocol (LNP)**; on the wire its name is `limitr-network` (`<Network>.NAME`).

Status: 0.1, Nov 7, 2026. Built: the engine changes, the protocol module (`src/network/spec/`, typed, with its
tests), routes and tools (the provider's own Stof, run sealed and confined on the consumer's side, on Stof 0.11.3),
operators (the state, identity, and discovery roles, strict and bounded state, budgets, key rotation, and a reference
operator), identity on both sides, metering by a cap per request with receipts after the work, terms in runes, the
TypeScript SDK (`limitr.network()`, `typescript/network.ts`, with operator channels), and the demo
(`typescript/demos/network/`). 71 tests in `src/network/tests/`. Next: the README, the protocol document with test
vectors, a tutorial, and the limitr-network skill; then the Cloud operator.

## What it is

Limitr Network lets one Limitr policy use another's services and pay for them, with no API keys exchanged and no
integration work. A **provider** publishes plans from its policy. A **consumer** (an agent, an app, another service)
picks a plan and signs a **voucher**: "I'll pay up to this much, on this plan, until then." The provider meters the
consumer like any other customer, with the voucher's spend as a cap, and grants its **routes**: declarations of what
the consumer can call. The consumer turns them into tools in its own policy (capabilities an agent can use), sealed
and confined so they reach only that provider. A provider can also ship **tools** of its own, in Stof, that run on the
consumer's side (only if it trusts the provider's logic), sealed and confined, calling the provider's routes.

It's an optional module on top of the engine. A policy without it works exactly as today. The protocol is
peer-to-peer: two policies and HTTP. **Operators** (see below) are optional parties both sides trust with part of the
network: shared state across provider instances, one budget across many providers, identity, and discovery (and
later payment). The role is open (anyone can run an operator); Limitr Cloud is one. None is needed to run it.

Everything the protocol does runs in the policy (open source, sealed, the same in every SDK), including its HTTP:
the consumer's side calls providers with the policy's own `Http::fetch`. So an SDK, in any language, does only three
things:

1. **Hold the key:** register `NetworkKey::sign` (see Identity).
2. **Allow HTTP** to the hosts the policy connects to (`Http::fetch` is off, or limited to listed hosts, by default).
3. **Convert requests** (provider): its framework's request into a `NetworkRequest` map, and the `NetworkResponse` map
   back. The TS SDK takes and returns web-standard `Request` and `Response`, so Deno, Bun, Workers, Hono, and
   Next.js use it as is; Node's `http` needs a few lines (see the demo).

## Roles

A policy can be a provider, a consumer, or both.

- Every Network policy has `network.key` (its public key) and optionally `network.name` (how it calls itself).
- **Provider:** also has `network.provider`: its name, label, base URL, the plans it offers on the network, its
  routes, and optionally its tools and their logic.
- **Consumer:** gets `network.connections`, one per provider it uses (by the provider's name), each holding the
  current voucher, the provider's grant, and the tools built from it; and `network.budgets`, its budgets at
  state operators.
- **Operator:** a policy with `network.service` serves the state, identity, and discovery roles (the reference
  operator); any policy lists the operators it uses in `network.operators`.

## Identity

An identity is an Ed25519 key pair (Stof's `Key` library). The public key is the identity; the secret key stays with
the host (the SDK), never in the policy document.

- A consumer with no key gets one: `Key::generate()` in the SDK, stored wherever the host keeps secrets. The public
  key goes in the policy as `network.key`.
- **Issued identity (built):** an identity operator (Limitr Cloud, an identity provider, a company for its agents)
  signs a statement binding a key to a subject: an `identity` message (to anyone, its expiry the statement's) whose
  body is `{ key, subject, expires }` (`NetworkIdentity`). A consumer gets one with `identify(operator?)` (it sends a
  signed `identify`, and the operator answers `identified` with `{ statement }` for a key it knows) and sends it
  with every voucher (`voucher.identity`). A provider checks it against the identity operator its terms name: signed
  by it, for the key that signed the voucher, current. The voucher's expiry is never later than the statement's, and
  the voucher's customer keeps who it is (`metadata.network.subject` and `issuer`; in TS, `call.subject` in the
  work).
- **Who needs one:** `network.provider.identity` is `'auto'` by default (required when the provider has an identity
  operator, optional when it doesn't: with no one to vouch for a key, requiring one would refuse everyone),
  `'required'`, or `'optional'`, and `identity_plans` sets it per plan (Ex. `{ free: 'optional' }`). Each plan's
  requirement is in the terms (`plans.<name>.identity`), so a consumer knows before it signs. A plan that requires
  an identity with no identity operator doesn't validate. Without an identity operator, keys are self-issued.
- **The provider's side too:** a provider's own statement (its `identify()`) goes in its manifest (`{ terms,
  identity }`: not in the terms, so renewing it changes no voucher). A consumer with `network.require_identity`
  connects only to providers its identity operator vouches for (for the manifest's key, current); either way the
  connection keeps who the provider is (`subject`, `issuer`).
- **Operators can require it:** `service.requires: ['provider', 'consumer']` (in its manifest as `requires`) makes an
  operator refuse anyone it hasn't identified: a provider registering a voucher or listing itself, a consumer whose
  voucher it's asked to register, or that opens a budget or searches. It must serve identity to require it. So
  "everyone on this operator is identified" is a guarantee of the operator, not a convention.
- **Whose word counts:** each side checks statements against its own identity operator (one per role). Trusting
  several issuers (Ex. two private networks recognizing each other) is for later.

The policy never holds a secret key. The SDK registers one host function, `NetworkKey::sign(context, message)`, that
signs with the policy's own key, so the protocol code (in Stof) can sign without seeing the key. It signs only under
`limitr-network/` contexts, so nothing in a policy can use the key to sign anything else. (A policy can instead have
a `network.signer` function, which is how the Stof tests sign; it can't reach the host's key either.)

## Messages

Every message is JSON text, signed exactly as sent:

```json
{
    "message": "{\"protocol\":\"limitr-network/0.1\",\"type\":\"voucher\",...}",
    "key": "<sender's public key>",
    "signature": "<Key::sign(secret, 'limitr-network/v1/<type>', message)>"
}
```

The receiver checks the signature under the context for the message's type before parsing `message`. Signing the
text (not a re-export of an object) means both sides check the same bytes. A context per type means a signature
on one kind of message can't be passed off as another.

Every `message` has:

| Field | Meaning |
|---|---|
| `protocol` | `limitr-network/0.1` (see Versions) |
| `type` | between peers: `manifest`, `voucher`, `grant`, `refused`, `receipt`, `revoke`, `cancel`; with any operator: `operator` (its manifest), `rotate` (a key rotation); state: `budget`/`budgeted`, `register`/`registered`, `find`/`found`, `claim`/`claimed`, `lease`/`leased`, `settle`/`settled`, `end`/`ended`; identity: `identify`/`identified`, `identity` (a statement); discovery: `list`/`listed`, `unlist`/`unlisted`, `search`/`results` |
| `from`, `to` | public keys of sender and receiver (`to` is empty in a public `manifest`) |
| `id` | unique message ID (nanoid) |
| `issued`, `expires` | ms timestamps; a message past `expires` is refused |

### The flow

```
consumer                                   provider
   | GET /.well-known/limitr-network ---->    |
   |                               <----  manifest (plans, credits, routes, tools, logic)
   | voucher (plan, spend, until)  ---->      |   creates a voucher customer, cap from spend
   |                               <----  grant (customer, the routes and tools it reaches)
   | builds sealed, confined tools            |
   | request (signed, per call)    ---->      |   verify, cap the request, do the work (it meters)
   |                               <----  response + receipt (what it cost, spend so far)
   | voucher (updated: more spend) ---->      |   updates the cap
   | cancel                        ---->      |   or the provider sends revoke
   | drops the tools                          |   closes the customer after final usage
```

1. **manifest** (provider → anyone, `GET /.well-known/limitr-network`): the provider's key, and its **terms**: name,
   label, base URL, its rune (`rune: { value, currency }`, see Runes), the offered plans (label, period, and each
   entitlement's description and limit), the credits they use (what they cost the consumer in runes, priced through
   the provider's exchange, never what they cost the provider), the routes, and the tools with their
   logic (see Routes and tools). The terms are built
   from the policy, so prices have one source, field by field with their defaults, so they read the same however
   the engine has used the plans. They travel as JSON text (the manifest's body is `{ terms: "<JSON>" }`), and their
   digest, the SHA-256 (lowercase hex) of that text's UTF-8 bytes, is what a voucher refers to: the consumer agreed
   to exactly these terms, and checking it takes nothing but SHA-256 (no JSON to re-serialize identically). Every
   digest in the protocol is a plain SHA-256 like this one (Stof's `sha256`), so any language can compute it.
2. **voucher** (consumer → provider, `POST /limitr-network/voucher`): `{ voucher, seq, plan, terms, spend, expires,
   name }`. `voucher` is the consumer's ID for it (nanoid), `seq` goes up with each update, `terms` is the terms'
   digest, `spend` is the most the consumer will pay (runes), `name` is how the consumer calls itself. An update is a
   new voucher with the same ID and a higher `seq`: more spend, a later expiry, or less of either. The plan stays
   (another plan, another voucher).
3. **grant** (provider → consumer, the answer to the voucher): `{ voucher, seq, customer, plan, spend, expires, url,
   routes, tools }`. The provider accepts the voucher (it may lower `expires`, never raise it) and lists, by name, the
   routes and tools the plan reaches (the consumer refuses a grant naming any its terms don't have). Or it answers `refused` (`{ voucher, reason }`, still signed): a plan it doesn't offer, changed
   terms, no spend, an expiry in the past, an older `seq`, or a voucher another key holds.
4. **request** (consumer → provider, per call): the route's HTTP call plus two headers:
   `Limitr-Network-Request` (the JSON text `{ protocol, type: 'request', voucher, n, method, path, body: <SHA-256 of
   the body text>, issued, max? }`) and `Limitr-Network-Signature` (its signature, context `limitr-network/v1/request`).
   `path` includes the query string. `n` goes up with each call. The provider checks it with the key the voucher
   came from. `max` (optional, runes) is the most this request may spend.
5. **receipt** (provider → consumer, on every response it can tie to a voucher, made after the work): `{ voucher, n,
   allowed, cost, body, spent, remaining, budget_remaining }`, signed, in a `Limitr-Network-Receipt` header. `cost` is
   what this request spent (runes), `body` the SHA-256 of the response body as sent. The consumer refuses a 2xx
   response without a receipt for its `n` or with a `body` that doesn't match, and keeps the latest, so both sides see
   the same spend.
6. **revoke** (provider → consumer) and **cancel** (consumer → provider, `POST /limitr-network/cancel`):
   `{ voucher, reason }`. Either side can end it at any time. (0.1 doesn't push a revoke: the provider's host sends it
   however it can, and the consumer learns anyway on its next call, which is refused.)

### Versions and names

- `protocol` is `<name>/<major>.<minor>`. Peers need the same name and major version; before 1.0, the same minor
  too (a 0.x minor can change anything). Receivers ignore fields they don't know, so after 1.0 a minor version only
  adds; optional features are advertised in manifests (a provider's terms, an operator's manifest), never assumed.
- HTTP from a policy (to providers and operators) waits at most `network.request_timeout` (30 seconds by default)
  and reads at most `network.max_response` (10 MB by default): a slower or larger response is status 0, with the
  reason as its body, so a provider can't hang a consumer or make it hold more than that.
- Every wire name (the protocol string, signature contexts, headers, and paths) starts with the protocol's name and
  is a constant on `Network` (`NAME`, `PROTOCOL`, `CONTEXT`, `REQUEST_HEADER`, `SIGNATURE_HEADER`, `RECEIPT_HEADER`,
  and the paths). A test checks they all derive from `NAME`, and the TS SDK reads the signing context from the
  module, so a rename is one block.
- Every URL the protocol uses (a provider's, an operator's) must be `https://`; `http://` only to this machine
  (`localhost`, `127.0.0.1`).

### Replay and ordering

A request is refused when it's expired (`issued` more than 60 seconds old, or from the future by more than 60
seconds), or when its `n` was already used. Calls can arrive out of order (an agent calls tools in parallel), so the
provider keeps the highest `n` seen and the last 64 request numbers (anything older than the window is refused), on
the voucher's customer. That's a fixed size per voucher: verifying a call never grows the document.

Vouchers use `seq` the same way: an older `seq` is refused.

## Routes and tools

A provider's declarations are in two parts. **Routes** are the provider's side, and the protocol's trust boundary: what
a request may do, and how it's metered. The provider never trusts code once it runs on someone else's machine, so
every request to a route is signed by the voucher's key, checked for replay, and metered by the provider's own policy,
whoever's code made it. **Tools** are the consumer's side: what its agent runs. Each route is a tool as-is (so nobody
has to write Stof to use the protocol), and a provider can also ship tools of its own, in Stof.

```stof
network: {
    provider: {
        name: 'acme_weather'                   // letters, numbers, _ and -: names its tools (acme_weather_forecast)
        label: 'Acme Weather'
        url: 'https://api.acme.example'
        offers: ['agent']                      // plans offered on the network

        routes: {
            forecast: {
                description: 'The forecast for a city'
                method: 'GET'
                path: '/forecast'
                parameters: [{ name: 'city', description: 'City name', schema_type: 'string' }]
                entitlement: 'forecasts'       // what a request meters under
                value: 1                       // how much a request uses
                plans: ['agent']               // optional: which offered plans reach it
                tool: true                     // optional: a tool as-is on the consumer's side (the default)
            }
        }

        tools: {                               // optional: tools of its own, a function each in `logic`
            compare: {
                description: 'Which of two cities will be warmer'
                parameters: [{ name: 'a', description: 'A city' }, { name: 'b', description: 'Another city' }]
            }
        }
        logic: r#"
            fn compare(input: map) -> unknown {
                const a = self.high(input.get('a'));
                const b = self.high(input.get('b'));
                map(('warmer', a >= b ? input.get('a') : input.get('b')))
            }
            fn high(city: str) -> int { self.api.json(self.api.call('forecast', map(('city', city)))).get('high') }
        "#
    }
}
```

The terms carry the routes, the tools, and the logic as text, so a voucher agrees to exactly that code (changing it
changes the terms' digest, and the provider refuses an update for terms that have changed). A grant lists the routes
and tools its plan reaches, by name. `fits()` checks a provider with tools: `logic` parses as untrusted source with a
function for each tool, and no tool has a route's name.

### Trust is the consumer's choice

Per connection, `trust` is `'declarations'` (the default: routes are tools as-is, and none of the provider's code runs)
or `'logic'` (its own tools run too). It's set with `connect(url, plan, spend, expires, budget?, trust?, may_call?)`
and changed with `trust(name, trust, may_call?)`, which makes the connection's tools again (no new voucher). With
`'logic'`, the consumer checks that the logic parses as untrusted source before it signs a voucher.

### What the consumer builds

From the grant, in `policy.capabilities` (so `claude_tools()`, `run_capability`, and tool use work as for any
capability):

- **A tool per route** the grant reaches (unless the route says `tool: false`): a `NetworkCapability` whose one
  `#[run]` step calls its connection with the input as a map.
- **With trust `'logic'`, a tool per provider tool** the grant reaches: a `NetworkToolCapability` that runs the
  function of the same name in the connection's toolbox.

And in the connection (`network.connections.<provider name>`, a `NetworkConnection`): the voucher's state (its ID,
`seq`, request counter, and the latest `spent` and `remaining`), what the provider offers (`offer`: the terms' routes,
tools, and logic), what the grant reaches (`routes`, `tools`), and the parts that reach the provider:

- **The link** (`NetworkLink`): the provider's URL and the one function that makes the HTTP call. Sealed
  `fields: true, removable: true, reads: [], hosts: [<provider host>], libs: ['Http', 'Str', 'Std', 'Map']`: nothing
  can change where calls go, it reaches only the provider's host, it sees nothing else in the policy, and it's dropped
  whole when the voucher ends. The request is signed (`Network.sign`) before it's handed to the link, and the response
  comes back as a value.
- **The toolbox** (with trust `'logic'`): the provider's logic, parsed with the `untrusted` profile (declarations only:
  literal values, no imports, no types, nothing runs while it's parsed) and sealed once with everything:
  `fields: true` (it keeps no state and makes no objects), `removable: true`, `reads: []` (nothing of the consumer's
  policy), `hosts: []` (no network of its own), `libs: <Network>.TOOL_LIBS` (`Std`, `Str`, `Num`, `List`, `Map`, `Set`,
  `Tup`, `Time`, `Ver`: no `Http`, no host libraries such as `NetworkKey`), `time: network.tool_time` (30 seconds by
  default, its requests' waits included), and its gate as its only way out.
- **The gate** (`calls`), outside the toolbox, handed to it as `self.api`: `call(route, args, provider?)` makes a
  request to one of this provider's routes, signed for this voucher (it can't sign vouchers, budgets, or anything
  else, so a tool can never raise its own spend), and returns the response body; `json(text)` reads JSON text as a
  value. Both run as themselves and hand back only values (maps, lists, strings, numbers).

Tool results are text (a string as is, anything else as JSON). A refused request ends the tool, and its result is the
refusal (below), unless the tool catches it. A tool that fails (an error, or running past `tool_time`) has the result
`{ "failed": { provider, tool, reason } }`, after a `network-tool-failed` event with those fields.

**Several providers together:** a consumer can let a trusted connection's tools call its other connections' routes
(`may_call: ['acme_maps']`, Ex. its own providers working together): `self.api.call('locate', args, 'acme_maps')`
spends that connection's voucher. Only the consumer grants this, never the provider, because it spends the consumer's
other vouchers.

The split between capability and connection is needed because a sealed part can't have its child objects replaced,
and running a capability replaces its `input` and `output`. Values (maps, strings) cross into the sealed parts;
objects don't.

## The provider's side

- **Voucher customers.** Accepting a voucher creates (or updates) a customer: ID `nv_<voucher>`, type `voucher`, on
  the voucher's plan, with:
  - a **cap** named `network` from `spend`, in runes, on everything the customer uses;
  - an **expiry** (see the engine changes), after which `allow()` refuses;
  - `metadata.network`: the consumer's key, the voucher's ID and `seq`, the replay window, and the terms digest.
  These are normal customers, so the provider's metering, events, margins, and Limitr Cloud all see them as they
  see anyone else (Cloud shows type `voucher`).
- **Handling requests.** `NetworkProvider.handle(request)` takes a `NetworkRequest` map (`{ method, url, headers,
  body }`, header names in any case) and returns a `NetworkResponse` map (`{ status, headers, body }`). It routes the
  protocol's own paths (manifest, voucher, cancel) itself. For a request to a route it checks the signature, the
  voucher, and replay, finds the route, and starts the request (`begin`, see Metering); a refusal comes back as a
  finished response (401 for the signature, voucher, replay, route, or a bad `max`; 402 for limits, spend, or expiry,
  with the reason and a receipt). An allowed request comes back with `status: 200`, the `route`, `customer`, and
  `request` (its `n`), and no body: the host does the work, then calls `done(customer, n, body)`, which returns the
  signed receipt for the `limitr-network-receipt` header (the module's `Network.done(customer, request, body)` returns
  the header map). `serve(request, work)` does all three for a Stof function. In TS:
  `network.handle(request, ({ route, customer, subject, query, body }) => result)` does it for you. Requests a provider's own
  tools make (on the consumer's side) come in the same way.
- **Ending: a tab with a closing time.** Every voucher has an `expires` (required; the provider can shorten it, up
  to its `max_voucher` duration, 30 days by default), and it's the voucher customer's `expires`. So a consumer that
  never cancels doesn't leave a tab open: at the expiry the customer stops being allowed. A revoke or cancel sets
  the expiry to now. Reaching the cap doesn't end a voucher (the consumer can send an update with more spend).
  An ended voucher customer is kept for `keep_ended` (7 days by default) so its usage can be read and billed, then
  `sweep()` sends `network-voucher-ended` (the customer with its final usage) and deletes it. `handle` runs the
  sweep at most once an hour (`last_sweep`), so there's nothing for the host to call.

## The consumer's side

- In the module: `Network.connect(url, plan, spend, expires)` does the whole round trip with the policy's
  `Http::fetch`: GET the manifest, check it, sign a voucher (the connection is kept as a `NetworkConnection` under
  `network.connections.<provider name>`), POST it, take the grant, and build the connection's link and tools. It
  returns the tools' names. `trust(name, trust, may_call?)` changes how far it trusts the provider,
  `update(name, spend?, expires?)` sends a newer voucher, `cancel(name)` sends a cancel and removes the connection,
  `revoked(envelope)` takes a provider's revoke. Running a route's tool calls `NetworkConnection.call(route, args)`; a
  provider's tool, `NetworkConnection.run_tool(tool, args)`.
- In the SDK (`const network = await limitr.network()`): the same calls, as passthroughs
  (`network.connect(url, plan, spend, expires, { budget, trust, mayCall, max })`, `network.trust(name, trust, mayCall?)`,
  `network.update(name, { spend, expires })`, `network.cancel(name)`, `network.connection(name)`). `connect` first
  allows HTTP to the provider's host.
- **Spend the consumer can see:** each connection keeps the latest receipt's `spent` and `remaining`, and a
  `network-receipt` event (`{ name, label, voucher, n, cost, allowed, spent, remaining }`) goes out on
  every call, so an agent's host can top up (an updated voucher) or stop.
- **Its own limits on its own agents:** a consumer can also meter its agents with its own entitlements and caps
  (Ex. "this agent may spend $5 a day across all providers"), checked before the tool runs. That's the engine as it
  is today: a capability's `#[run]` step can call `allow()` first.

## Refusals are results

A refused request comes back to the consumer as the tool's result, not an error, so an agent can read it and act
(tell its user, stop, or ask its host for more spend):

```json
{ "refused": { "provider": "acme_weather", "status": 402, "reason": "...", "spent": 0.03, "remaining": 0,
  "budget_remaining": null, "expires": 1794018421463 } }
```

A `network-refused` event carries the same fields. Only a provider that can't be reached at all throws. The agent
can't raise its own spend (nor can a provider's tool): a voucher's spend changes only through `update()` (the host's
decision, or a capability
the host chooses to give it, under the consumer's own caps).

## Operators

An operator is a key, a URL, and the **roles** it serves. A policy maps roles to operators in `network.operators`
(at most one operator per role, so a network's "operator" can be several: Ex. one for identity, another for the
rest). Each role is a small contract with its own messages; an operator supports the roles it chooses.

```stof
network: {
    operators: {
        cloud: {
            url: 'https://operator.example'
            key: '<operator public key>'
            roles: ['state']
            state: { mode: 'strict' }          // NetworkStateConfig, every field defaulted
        }
        ids: { url: 'https://id.example', key: '<key>', roles: ['identity'] }
    }
}
```

| Role | What it does | 0.1 |
|---|---|---|
| `state` | Holds voucher and budget state (spend, replay, expiry) | built |
| `revoke` | Pushes revokes and cancels to the other side | contract |
| `identity` | Identity statements (key to subject); key rotation and revocation lists later | built (statements) |
| `payment` | Clears usage between parties (ledger, rev share, settlement) | contract |
| `discovery` | An index of manifests, public and private listings | built |

Extension roles are namespaced (`<domain>/<role>`, Ex. `acme.com/audit`), and ignored by anything that doesn't know
them; core role names are reserved. Each operator publishes a signed manifest (`GET
/.well-known/limitr-network-operator`, type `operator`: its label, roles, supported state modes, key rotations, and
who it requires to be identified), and takes messages at `POST /limitr-network/operator/<type>` (or through the
host's channel, see For the Cloud operator), every one signed by its sender and answered (or refused) signed by the
operator. A policy checks an operator's answers against the key it configured for it (or a key it rotated to, by a
chain from that key), never a key a message carries (`checkOperators()` reads and checks every manifest).

**Who trusts whom.** A provider's terms list the operators it accepts, by role (`operators: { state: <key> }`), so a
voucher agrees to them with the rest of the terms. A consumer names an operator for a budget.

### The state role

The provider always checks signatures, time, its own replay window, and its own limits (`check()`) locally. What
moves to the state operator is what has to be shared across provider instances: replay, and spend against the
voucher and its budget.

- **Register and find.** A provider registers each voucher it accepts (`register`: the consumer's signed voucher, the
  expiry it granted, the customer). The operator checks the consumer's signature itself, and the budget. Another
  instance that gets a call for a voucher it hasn't seen asks for it (`find`), checks the consumer's signature
  itself (the operator can't forge one), and admits it. So instances self-heal, and a restart loses nothing.
- **strict** (the default): each call is claimed first (`claim`: the request number and the call's price in runes).
  The operator checks the request number against its window (wider than a provider's: 1024) and the spend left, and
  charges it. Exact across any number of instances, one round trip a call. A call it refuses is never metered: the
  price is quoted from the voucher's own `network` cap with the same figures `check()` and `allow()` use (the
  period's meter, the credit's tiers and overhead), then metered with `allow()`. If what's metered ever differs from
  the quote, the difference goes with the next message as `adjust`.
- **bounded:** an instance takes a `lease` of the voucher's spend (a share of it, `lease`, 10% by default, and at
  least the call that needs it), spends it locally, and `settle`s it (`[n, runes]` per call) every `settle_every`
  (30 seconds) or when it runs out. Spend overshoots by at most the outstanding leases. A replay across instances
  is **caught at settle, not prevented**: the operator charges each request number once and returns the
  duplicates (a `network-duplicates` event on the provider). A lease past its end (`lease_ttl`, capped by the
  operator) is released, and unsettled spend on it isn't charged.
- **offline:** `'refuse'` (the default) fails closed: 503, and a bounded lease whose settle failed isn't spent.
  `'local'` (bounded only) keeps spending what's left of the current lease.
- **end:** a revoke or cancel at one instance ends the voucher at the operator, so every instance's next claim is
  refused.

`NetworkStateConfig` defaults: `mode: 'strict'`, `lease: 0.1`, `settle_every: 30s`, `lease_ttl: 5min`,
`offline: 'refuse'`. An operator's manifest says which modes it supports.

### Budgets

One spend across many providers. A consumer signs a `budget` to its state operator: `{ budget, seq, spend, expires,
providers? }` (`providers`: the provider keys it may be spent with; any provider that trusts the operator when
absent). A voucher names it (`budget`, and the operator's key in `operator`), and still has its own spend under it.
The provider must accept that operator for state; the operator checks, when the voucher is registered, that the
budget is the same consumer's, open, and for this provider. Every claim and lease counts against both. A newer `seq`
changes it; an expiry of now ends it. Receipts carry `budget_remaining`.

### The reference operator

Any policy can be an operator: `network.service` (`NetworkOperatorService`: the state, identity, and discovery
roles, `requires`, and `rotations`), with its network key as the operator's key. It holds budgets, vouchers,
identities, and listings in its own document, answers the messages above, and is what the
tests run against. A hosted operator (Limitr Cloud) answers the same messages from its own store. In TS:
`network.operate(request)` is its web-standard handler.

## Engine changes (the voucher rework, done)

- **The old vouchers are gone:** `Customer.ensure_voucher`, the `limitr_voucher*` metadata checks in `allow()` and
  `update_customer_internals`, and the TS SDK's `addVoucher` and `limitr_v1_` path. (Left over from an early Cloud
  POC; the server's leftovers go in the Cloud pass.)
- **Customer expiry** (general, not only for vouchers): `Customer.expires` (ms, null never), set with
  `set_customer_expires(id, expires)` (TS `setCustomerExpires`). From then on the customer has no entitlements:
  `allow()` and `check()` refuse, like an entitlement it doesn't have. Its meters, grants, and caps are kept, and a
  later time gives access back. Useful on its own for trials and temporary access.
- **Spend comes from caps.** A voucher's spend is a cap, so everything caps already do (exchange, overage only,
  thresholds, events) applies, and there's one way to limit spend.

## The module, and how modules work

The Network is the first Limitr module, and the pattern for the ones after it (ours or anyone's):

- **Source:** `src/network/spec/`, one file per part, every shape a Stof type with its defaults and schemas, so
  the policy's `network: { ... }` is checked like the rest of the policy (and a port reads the types, not the code):
  - `network.stof`: `Network`, the policy's `network` (its `key`, `name`, `provider`, `connections`), the protocol's
    constants (`<Network>.VERSION` 0.1.0, paths, skew, window), envelopes (sign, open, verify), and the consumer's
    calls (`connect`, `update`, `cancel`, `revoked`). `<Network>.load(policy)` types and checks it.
  - `provider.stof`: `NetworkProvider` (manifest, `handle`, accept, revoke, sweep), `NetworkRoute`, `NetworkTool`, and
    `NetworkVoucherState` (a voucher customer's `metadata.network`, with the replay window).
  - `connection.stof`: `NetworkConnection` (a voucher, its grant, its spend), `NetworkLink` (the sealed, confined
    fetch), `NetworkCapability` (a route's tool), and `NetworkToolCapability` (a provider's tool, run in the
    connection's toolbox).
  - `message.stof`: the messages (`NetworkMessage`, `NetworkVoucher`, `NetworkRotation`, `NetworkIdentity`,
    `NetworkGrant`, `NetworkReceipt`, `NetworkSignedRequest`, `NetworkBudgetMessage`, `NetworkStateRequest`,
    `NetworkStateAnswer`) and the transport shapes (`NetworkRequest`, `NetworkResponse`).
  - `operator.stof`: `NetworkOperator` (an operator a policy uses: url, key, roles, role configs, its channel or
    transport, and `ask()`, `check()`, `follow()` for rotations, `verify_identity()`), `NetworkStateConfig`,
    `NetworkOperatorManifest`, and `NetworkBudget` (a consumer's budget).
  - `service.stof`: the reference operator, `NetworkOperatorService` (state, identity, discovery, requirements, its
    rotations), with `NetworkBudgetState`, `NetworkVoucherRecord`, and `NetworkLeaseRecord`.
  - `discovery.stof`: `NetworkListing`, `NetworkSearch`, and `NetworkListingRecord` (a listing an operator holds).
  - `api.stof`: entry points for the document's policy (`LimitrNetwork.connect`, `LimitrNetwork.handle`, ...) that
    SDKs call by path with plain values, one line each.

  Tests in `src/network/tests/`. It builds on the engine's types (`Customer`, `Cap`, `Capability`) and never
  changes them. Two optional functions on `network` stand in for the host, for tests and hosts that want them:
  `signer(context, message)` (sign without `NetworkKey::sign`) and `transport(request)` (send without
  `Http::fetch`; the tests pass messages between two policies in one document this way).
- **Build:** `project.stof` compiles it next to the engine, into the same `typescript/limitr.ts`:
  `export const limitrEngine = ...` and `export const limitrNetwork = ...`. A policy that doesn't use the Network
  never loads it, so its document doesn't grow.
- **Load:** `limitr.network()` parses the module into the document as `LimitrNetwork` (once; later calls return the
  same handle) and seals it, like the engine's `LimitrTypes`. Underneath is a general `limitr.module(name, bytes,
  setup?)`, which is how anyone adds their own: compile a Stof package to `bstf` (its root object named `name`),
  load it by name, sealed. A document from Limitr Cloud gets the same modules, set up again.
- **Tests:** `pkg.stof` imports both, so `stof test` in the limitr folder runs the engine's and the Network's tests.
- **SDK (TS first):** `await limitr.network({ secretKey, keyStore, name, channels })` returns the handle (`handle`,
  `connect`, `trust`, `update`, `cancel`, `revoked`, `connection`, `manifest`, `revoke`, `sweep`, `budget`,
  `budgetInfo`, `identify`, `list`, `unlist`, `discover`, `rotation`, `refusal`, `failure`, `checkOperators`,
  `operate`), each a passthrough to the module's entry points. All HTTP is the policy's
  `Http::fetch` (requests from the confined link); connecting lets the policy reach that provider's host, and
  loading lets it reach its operators.

## Payment

Not built in 0.1. The consumer's signed vouchers and the provider's signed receipts (each request's cost, bound to
the response body) are a record both sides can check, and the provider bills its voucher customers the way it bills
anyone (Limitr Cloud, Stripe). Settling between parties is the payment role, whose contract is under For the Cloud
operator; it's built with the Cloud operator.

## Security notes

- Secret keys stay in the host; the policy signs through `NetworkKey::sign`, only under `limitr-network/` contexts.
- A voucher binds the terms' digest, so a provider can't change terms under an existing voucher; new terms need a
  new voucher (the provider refuses an update for terms that have changed).
- A connection can reach only its provider's host, sees nothing else in the consumer's policy, and can't be changed.
- Replay is refused with timestamps and per-voucher counters, in fixed memory.
- None of a provider's code runs on the consumer's side unless the consumer chooses `trust: 'logic'`. Then its logic is
  exactly what the voucher agreed to (it's in the terms), parsed as declarations only, and sealed: it reads nothing of
  the consumer's policy, makes no objects, calls no host and no library outside `TOOL_LIBS` (so not `NetworkKey`),
  can't end or outlive the call that runs it, and stops at `tool_time`. Its one way out is the gate, which signs
  requests to that provider's routes for that voucher only (and, with `may_call`, the routes of the connections the
  consumer named): every one is checked and metered by the provider like any other, so a tool can spend the voucher
  only as its own requests would, and can't raise its spend. The tool's result is the provider's word, like any
  response body: treat it as data, not instructions.
- A provider never gets more than the voucher says: the cap enforces spend on its side, and the consumer sees every
  receipt.
- With a state operator: replay and spend are exact across instances in strict mode; bounded trades exactness for
  speed (overshoot up to the outstanding leases; cross-instance replays caught and not charged at settle). The
  operator can't forge a consumer's voucher (instances check its signature themselves), and every operator answer is
  checked against the configured key. An operator can refuse or stop answering (a provider fails closed by default).
- A receipt binds the response body (its SHA-256) and what the request cost, so a consumer can prove what it got for
  what it was charged; a 2xx response without a matching receipt is refused.
- Identity statements are checked against the checker's own identity operator (for the key that signed the voucher
  or manifest, current), never a key a statement carries; a voucher never outlasts its consumer's statement. An
  operator rotates its key by a chain of statements from its first key, and a chain that skips a key already
  followed is refused.
- An index (discovery) can't forge or change a provider: results are the providers' own signed manifests, checked by
  the searcher, and connecting reads the manifest from the provider's URL.
- What 0.1 doesn't do: key rotation for providers and consumers (a provider's new key needs a new manifest, and
  existing vouchers end; operators rotate), revocation lists for issued identities (a statement holds until it
  expires), trusting several identity issuers, pushed revokes (the revoke role's contract; a missed revoke is learned
  on the next call), payment between parties, and limits on request body size (the host's).

## Decided for 0.1 (Nov 6 to 7, 2026), built

Decided with CJ after the operators were built, because they change the wire format, so they went in before 0.1 is
frozen and before the Cloud operator is built. All are built (routes and tools: see Routes and tools); what's left
here is how each works and what the Cloud operator still adds.

### Metering: a cap for each request (built)

The protocol authenticates every request (signature, replay, the voucher open); how it's charged is the provider
policy's business. There are no metering modes:

- **The work gets the voucher's customer ID** and uses it like any Limitr customer: `allow()`, `reserve()` and
  `settle()`, by calls, outcomes, bytes, tokens, whatever the policy says.
- **The module puts a cap on that customer for the request** (removed before the response), and reads its meter at
  the end: that's what the request spent, for the receipt and the operator. Caps stack, so a request can have an
  enforcing cap and an observing one together, on top of the voucher's own `network` cap.
- **A route's declared metering is optional sugar:** a route with an `entitlement` (and `value`) has the
  module call `allow()` before the work, as built today; without one the work meters; a request nothing meters is
  free.
- **With a state operator, the request cap enforces.** An observing cap measures after the fact, and an instance's
  local voucher cap can't see what the others spent, so at the start of a request the provider holds an amount at
  the operator (the route's estimate, `hold`, when it declares one; else a share of the voucher's spend), and the
  request cap's ceiling is that hold: past it, `allow()` inside the work returns false like any limit. At the end
  the actual spend is settled and the rest released. The settle rides on the next request's hold, so strict stays
  one round trip a request (a final settle goes on an interval). Without an operator the voucher's own cap enforces,
  and the request cap only measures.
- **The consumer can cap a request too:** the signed request can carry a most-for-this-request (`max`, runes), which
  becomes another enforcing cap for that request.
- **Requests on one voucher run one at a time per instance** (`handle()` queues them by voucher), so a request's cap
  counts only its own spend; different vouchers run in parallel. For heavy parallelism on one voucher, a later
  `call.allow(...)` can pass the request's cap explicitly instead.
- **The receipt is made after the work,** with what the request actually spent: `handle()` already wraps the work,
  and calls one more module entry point when it's done (settle, remove the cap, sign the receipt).

As built:

- `handle()` → `begin(customer, n, route, max)`: with a state operator, `check()` the route's declared entitlement
  first (so a request the provider's limits refuse holds nothing), then hold `hold_for()`: the route's `quote()` when
  it declares an entitlement, else its `hold` (runes), else the voucher's spend × the operator's `config.hold` (0.1).
  Strict claims it at the operator (carrying the last request's `adjust`); bounded takes it from the instance's lease.
  The request cap (`<NetworkProvider>.REQUEST_CAP`, `network_request`) enforces that ceiling, or the lease's
  remainder, or `max`, whichever is least; with no operator and no `max` it only observes. A declared entitlement is
  then metered with `allow()`; a refusal there is a 402 whose receipt comes from `done()`.
- `done(customer, n, body)`: the cost is the request cap's meter, rounded to 9 places; the cap is removed. Strict
  adds `cost - held` to the voucher's `adjust`, sent with its next claim, or by `settle_due()` (a `find` with the
  adjust) once `settle_every` has passed; bounded adds the cost to the lease's `lease_used`. Then it signs the
  receipt. A request left open (the host never called `done`) has its cap replaced by the next one.
- The consumer's `connect(..., max)` puts `max` on every signed request of that connection.
- The TS `handle` runs requests one at a time per voucher (a queue), so a request's cap measures only its own work;
  work that throws is answered as a 500 after `done` (its receipt still goes out).

### Runes

A rune is the network's unit of value: every price in a provider's terms is in runes (`Price.amount` is in runes),
and budgets and vouchers spend runes. An operator with the payment role defines what a rune is worth in money (Limitr
Cloud: 1 rune = 1 USD), and settles at its rate. A provider's own exchange (its credits to runes) decides its rune
prices; what those runes are worth is the operator's. Peer to peer, without a payment role, a rune is whatever the
two sides settle on.

- **The terms state the provider's rune** (built): `rune: { value, currency }`, its exchange's `rune` pair (1 rune is
  `value` of `currency`; 1 USD by default), so a consumer sees what the provider takes a rune to be, next to the
  operator's rate (what money settles at). It's in the terms, so the voucher agrees to it.
- **Credits are priced through the exchange** (built): a credit's `price` (and `tiers`) in the terms is what the
  policy charges, resolved the way `price_units()` resolves it (`Exchange.resolve`): an exchange pair takes
  precedence (Ex. `forecast: { value: 0.01, currency: 'usd' }` is 0.01 runes), a credit that resolves to another
  takes that credit's pricing model with its tiers in this credit's units (`up_to / factor`, `price × factor`), and a
  credit with no price is 0.

### Consumers with several instances

A voucher's request counter lives in one consumer process, so two instances sharing a voucher refuse each other's
calls as replays. A voucher belongs to one consumer process; several instances each have their own voucher, under
one budget.

### For the Cloud operator

- **Transport** (built): operator messages are signed envelopes, so they don't depend on the transport. HTTP is the
  default binding; an operator can use its own channel (Limitr Cloud has a WebSocket to every engine). An operator
  with `channel: true` is reached through the host (`NetworkChannel::send(name, request)`; in TS,
  `limitr.network({ channels: { <name>: (request) => response } })`, web-standard, so another policy's
  `network.operate` is one); a policy can also give an operator its own `fn transport(request) -> response`. Either
  way, answers are still checked with the operator's key, and a channel the host doesn't have is an error (never a
  fallback to HTTP).
- **Role contracts, as messages:**
  - revoke (contract): the operator relays the provider's own signed revoke, unchanged, to the consumer (over its
    channel, Ex. Cloud's WebSocket), and the consumer takes it with `revoked(envelope)`, which checks it with the
    provider's key, so whoever delivers it, only the provider can end a voucher this way (tested). A revoke is valid
    for 5 minutes, so a relay delivers it promptly; a consumer that misses one learns on its next call, which is
    refused. Cancels go the other way the same way.
  - discovery (**built**): a provider lists itself with `list(visibility, members?, subjects?)` (a signed `list`
    message: `{ manifest, visibility, members, subjects }`, `NetworkListing`; its manifest must be signed by the key
    that lists it, and listing again replaces it; `unlist()` removes it). `'public'` listings are found by anyone;
    `'private'` ones only by their `members` (public keys) and `subjects` (who the operator itself identified, Ex. an
    organization). Anyone searches with `discover(query, limit)` (a signed `search`: `{ query, limit, identity? }`,
    `NetworkSearch`, answered `results`: `{ manifests }`), so the operator knows who's asking and shows a private
    listing only to its members, like public and private repositories. A query matches every word in a provider's
    name, label, and its routes' and tools' descriptions. Results are the providers' own signed manifests, unchanged;
    the consumer checks each one's signature and leaves out any that don't check out, so an index can't forge or
    change a provider, and `connect()` to a result's URL reads the manifest from the provider itself. The reference
    operator serves it (`service.roles` with `'discovery'`, listings in `service.listings`). Anyone can run one: a
    private network is an operator of its own.
  - identity: statements on vouchers (**built**, see Identity; the reference operator issues them for the keys in
    its `service.identities`); on budgets, later.
  - payment (contract): what a consumer owes a provider is already signed twice over: the voucher (what it agreed to
    spend, on which terms) and the provider's receipts (signed `receipt` messages: each request's `cost`, and the
    voucher's `spent`). A payment operator that also serves state settles from its own claims (what it charged). One
    that doesn't settles from batches of signed receipts: a `settle` message from the provider,
    `{ voucher, envelope: <the consumer's signed voucher>, receipts: [<signed receipts>] }`, which the operator checks
    (the consumer's signature on the voucher, the provider's on each receipt, request numbers that don't repeat, and
    a total within the voucher's spend), then charges at its rate for a rune (Cloud: 1 USD). Built with the Cloud
    operator.
- **Operator keys** (built): an operator's identity is its first key (what terms, budgets, and statements' issuers
  name, so they don't change when it rotates). It rotates with a statement signed by the key it has now
  (`rotation(new_key)`: a `rotate` message, `{ key, previous }`, `NetworkRotation`), publishes its rotations in
  order in its manifest (`service.rotations`), and signs with the new key. A policy that gets an answer (or an
  identity statement) under a key it doesn't know reads the manifest again and follows the chain from the first key,
  each rotation checked against the key before it (`NetworkOperator.follow()`, kept as `current`). A chain that
  doesn't pass through the key it followed to before is refused, so a retired (Ex. stolen) key can't start another
  one. An operator still takes messages addressed to a key it rotated from. Identity statements signed before a
  rotation are refused after it (get a new one).
- **Quotes:** a state operator charges what a provider claims; the consumer audits every receipt against the signed
  terms.

## Build order

1. Engine: customer expiry; remove the old vouchers. Tests. **Done.**
2. Module: messages (build, sign, verify), manifest from a policy, voucher and grant, voucher customers, request
   verification and receipts, connections and capabilities. Stof tests with a provider and a consumer in one
   document, messages passed as text. **Done** (18 tests, on Stof 0.11.1). Then restructured into types (one file
   per part), with the handshake in Stof and requests as `NetworkRequest` and `NetworkResponse` maps.
3. TS SDK: `limitr.network()` (`typescript/network.ts`): `handle(Request) -> Response` for providers; `connect`,
   `update`, `cancel`, `revoked`, `connection` for consumers; key custody (`secretKey`, or a generated one handed to
   `keyStore`); and `limitr.module(name, bytes)` underneath. **Done.**
4. Demo: two Node processes (a weather service, and an agent that buys forecasts and uses them as Claude tools), in
   `typescript/demos/network/`. **Done.**
4b. Operators: roles, the state role (strict and bounded, offline behavior), budgets, the reference operator,
   refusals as results, https only, version rules, wire names from one constant. **Done** (17 tests in
   `src/network/tests/operator.stof`; an operator, two provider instances, and a budget checked over real HTTP).
4c. Validation: the policy's `valid()` runs every loaded module's `#[limitr_valid]` check; the Network's checks
   `policy.network` and how the provider fits the policy (offered plans exist, route entitlements are in the
   plans they reach, no two routes on one method and path). **Done.**
4d. The agreed items above, in this order: the Stof release (seal library allowlist, a time limit per confined
   call: Stof 0.11.2, **done**); routes and tools with trust and grants (**done**, with the Stof 0.11.3 fixes it
   found); a cap for each request (holds with an operator, the consumer's
   `max`, requests queued by voucher, receipts after the work: **done**); the provider's rune and exchange-priced terms (**done**); the
   operator transport hook (**done**); the role contracts (identity and discovery **built**, revoke and payment as contracts: **done**); operator keys (**done**).
5. Docs and skills: `src/network/README.md`, a protocol document with test vectors (`PROTOCOL.md`), a tutorial
   track (`typescript/tutorial/network/`), and a `limitr-network` skill; a limitr.dev section.
6. Then: Limitr Cloud as the first official operator (a preset that fills in its URL, key, and roles), serving every
   role, with the engine-side clients for revoke, identity, payment, and discovery built alongside it.

## Notes from building 0.1

- **Times are `ms`.** In Stof, `Time::now() + 30days` is in days and a time read from JSON is a plain number, so
  comparing them compares their numbers in different units. Every time the module compares is declared `ms`.
- **Terms are written field by field.** A plan's JSON changes once the engine has used it (it fills in the typed
  defaults), and an int and a float of the same value are different JSON, so the terms are built from named fields
  with defaults, numbers as floats. Their digest is over that JSON text.
- **Stof fixes this found** (released in Stof 0.11.1): `copy()` of nested objects, digests of objects in lists,
  dropping an object that holds only removable seals, and a refusal leaking into another call.
- **Make the object before a call that can throw.** A function that fills an object it's given (Ex. `open(envelope,
  type, into)`) can throw before it returns; an object made inline in the call (`new {}` as an argument) is then never
  dropped. Make it first (`using msg = new {}`), so it's dropped either way. `stof test --leaks` checks for this.
- **Event values are JSON.** An object sent with an event reaches the host's handlers as JSON text, so the
  `network-receipt` event sends a small receipt, not the connection.
- **An arrow's captures are shared.** Stof keeps one function per arrow literal, and evaluating it again replaces
  what it captured, so two processes running the same arrow at once (Ex. `serve(request, (route, ...) => ...)` in
  tests that run in parallel) see each other's variables. The work passed to `serve` should be a named function (its
  `self` is its object) or an arrow that uses only its parameters. The module itself has no capturing arrows. (A
  Stof fix, captures per evaluation, is for the next Stof release.)
- **Stof fixes routes and tools found** (Stof 0.11.3): confined code could end its caller's whole call with `exit()`
  (past its try/catch), read the host's environment through `Std` with system access allowed, import files or add
  types to the document through `parse`, and keep running (and calling its gates) after it returned, through an
  `async` block it didn't await. None of these is possible now, so a provider's tools get only what the toolbox seal
  says.
- **A toolbox makes no objects.** Fields frozen means confined code can't add objects either, so a tool can't grow the
  consumer's document from one run to the next (Stof has no garbage collection). Tools work with values; the gate's
  `json()` turns a response into maps and lists, made and dropped outside the toolbox.
