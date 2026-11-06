# Limitr Network: protocol and module spec (draft 0.1)

Status: draft 0.1, decisions made Nov 6, 2026. The engine changes (customer expiry, old vouchers removed) are done;
the module isn't built yet.

## What it is

Limitr Network lets one Limitr policy use another's services and pay for them, with no API keys exchanged and no
integration work. A **provider** publishes plans from its policy. A **consumer** (an agent, an app, another service)
picks a plan and signs a **voucher**: "I'll pay up to this much, on this plan, until then." The provider meters the
consumer like any other customer, with the voucher's spend as a cap, and sends back **endpoints**: declarations of
what the consumer can call. The consumer turns them into capabilities in its own policy (tools an agent can use),
sealed and confined so they reach only that provider.

It's an optional module on top of the engine. A policy without it works exactly as today. The protocol is
peer-to-peer: two policies and HTTP. Discovery (finding providers) and Cloud (payments, ledgers, analytics) are
later layers that plug into the same messages; neither is needed to run it.

Everything the protocol does runs in the policy (open source, sealed, the same in every SDK). The SDK does only
two things: moving messages (HTTP), and holding secret keys.

## Roles

A policy can be a provider, a consumer, or both.

- **Provider:** has `network.provider` in its policy: its name, base URL, the plans it offers on the network, and
  its endpoints. Its identity is its key pair.
- **Consumer:** has `network.consumer`: its identity (public key), and its **connections**, one per provider it uses,
  each holding the current voucher, the provider's grant, and the capabilities built from it.

## Identity

An identity is an Ed25519 key pair (Stof's `Key` library). The public key is the identity; the secret key stays with
the host (the SDK), never in the policy document.

- A consumer with no key gets one: `Key::generate()` in the SDK, stored wherever the host keeps secrets.
- **Issued identity (later layer):** an issuer (Limitr Cloud, an identity provider, a company for its agents) signs a
  statement binding a key to a subject: `{ key, subject, issuer, expires }`, context `limitr-network/v1/identity`.
  A consumer may include it in `hello`; a provider may require it. The POC accepts self-issued keys.

The policy never holds a secret key. The SDK registers one host function, `Network::sign(context, message)`, that
signs with the policy's own key, so the protocol code (in Stof) can sign without seeing the key. It signs only under
`limitr-network/` contexts, so nothing in a policy can use the key to sign anything else.

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
| `protocol` | `limitr-network/0.1` |
| `type` | `hello`, `manifest`, `voucher`, `grant`, `receipt`, `revoke`, `cancel` |
| `from`, `to` | public keys of sender and receiver (`to` is empty in `hello` and a public `manifest`) |
| `id` | unique message ID (nanoid) |
| `issued`, `expires` | ms timestamps; a message past `expires` is refused |

### The flow

```
consumer                                   provider
   | hello (identity)              ---->      |
   |                               <----  manifest (plans, endpoints summary)
   | voucher (plan, spend, until)  ---->      |   creates a voucher customer, cap from spend
   |                               <----  grant (customer, endpoints)
   | builds sealed, confined capabilities     |
   | request (signed, per call)    ---->      |   verify, allow(), do the work
   |                               <----  response + receipt (usage, spend so far)
   | voucher (updated: more spend) ---->      |   updates the cap
   | cancel                        ---->      |   or the provider sends revoke
   | drops the capabilities                   |   closes the customer after final usage
```

1. **hello** (consumer → provider): the consumer's public key, a display name, and optionally an issued identity.
   Optional: a consumer can fetch the public manifest without one.
2. **manifest** (provider → consumer): the provider's key, name, base URL, the offered plans (built from the
   policy's plans, so prices have one source: label, entitlements and their limits, credits and their prices,
   currency), and a summary of endpoints per plan. Also served publicly at `GET /.well-known/limitr-network`.
   Its digest (`digest(manifest, true)`) is what a voucher refers to, so the consumer agreed to these exact terms.
3. **voucher** (consumer → provider): `{ voucher, seq, plan, manifest, spend: { value, currency }, expires,
   entitlements? }`. `voucher` is the consumer's ID for it (nanoid), `seq` goes up with each update,
   `manifest` is the manifest's digest, `spend` is the most the consumer will pay, `entitlements` optionally narrows
   what it may use. An update is a new voucher with the same ID and a higher `seq`: more spend, a later expiry, or
   less of either.
4. **grant** (provider → consumer): `{ voucher, seq, customer, plan, expires, endpoints: [...] }`. The provider
   accepts the voucher (it may lower `spend` or `expires`, never raise them), and lists the endpoints this plan
   reaches. Or it answers with an error message (`{ type: 'refused', reason }`, still signed).
5. **request** (consumer → provider, per call): the endpoint's HTTP call plus headers `Limitr-Network-Voucher`,
   `Limitr-Network-Key`, `Limitr-Network-Request` (a signed message `{ voucher, n, method, path, body: <digest of
   the body text>, issued }`) and its signature. `n` goes up with each call.
6. **receipt** (provider → consumer, on every response): `{ voucher, n, entitlement, value, cost, spent, remaining,
   allowed }`, signed, in a `Limitr-Network-Receipt` header. The consumer keeps the running total from receipts, so
   both sides see the same spend.
7. **revoke** (provider → consumer) and **cancel** (consumer → provider): `{ voucher, reason }`. Either side can end
   it at any time.

### Replay and ordering

A request is refused when it's expired (`issued` more than 60 seconds old, or from the future by more than 60
seconds), or when its `n` was already used. Calls can arrive out of order (an agent calls tools in parallel), so the
provider keeps the highest `n` seen and a 64-bit window below it (like IPsec), on the voucher's customer. That's a
fixed size per voucher: verifying a call never grows the document.

Vouchers use `seq` the same way: an older `seq` is refused.

## Endpoints (declarative)

A provider declares endpoints as data. No provider code runs on the consumer's side in 0.1.

```stof
network: {
    provider: {
        name: 'Acme Weather'
        url: 'https://api.acme.example'
        offers: ['agent']                      // plans offered on the network

        endpoints: {
            forecast: {
                description: 'The forecast for a city'
                method: 'GET'
                path: '/forecast'
                parameters: [{ name: 'city', description: 'City name', schema_type: 'string' }]
                entitlement: 'forecasts'       // what a call meters under
                value: 1                       // how much a call uses (or the provider reports it in the receipt)
                plans: ['agent']               // optional: which offered plans reach it
            }
        }
    }
}
```

The consumer builds, from each endpoint in a grant, a normal `Capability` (so `claude_tools()`, `run_capability`,
and tool use work as today), split in two:

- **The capability** (in `policy.capabilities`, unsealed): its name, description, parameters, input and output, as
  today. Its one `#[run]` step calls its connection with the input as a map.
- **The connection** (in `network.consumer.connections.<id>`): the grant's data and one generated function that
  makes the HTTP call. Sealed `fields: true, removable: true, reads: [], hosts: [<provider host>]`: nothing can change
  the grant or the call, it can reach only the provider's host, it sees nothing else in the policy, and it's dropped
  whole when the voucher ends. It signs requests through `Network::sign` and returns the response as a value.

The split is needed because a sealed part can't have its child objects replaced, and running a capability replaces
its `input` and `output`. Values (maps, strings) cross into the confined connection; objects don't.

**Later (0.2):** a provider can ship logic, not only declarations: Stof functions signed by the provider's key,
sealed with `{ publicKey, signature }` and confined the same way. The same connection object holds them.

## The provider's side

- **Voucher customers.** Accepting a voucher creates (or updates) a customer: ID `nv_<voucher>`, type `voucher`, on
  the voucher's plan, with:
  - a **cap** from `spend` (credit `rune`, or the voucher's currency through the exchange table), not shared;
  - an **expiry** (see the engine changes), after which `allow()` refuses and the customer is closed;
  - `network` data: the consumer's key, the voucher's `seq`, the replay window, and the manifest digest.
  These are normal customers, so the provider's metering, events, margins, and Limitr Cloud all see them as they
  see anyone else (Cloud shows type `voucher`).
- **Verifying a call.** `policy.network.verify(headers, method, path, body)` checks the signature, the voucher, the
  expiry, and replay; then the endpoint's host code calls `allow()` as usual. The SDK has one helper that does both
  and builds the receipt: `limitr.network.serve(req, entitlement, value, handler)`.
- **Ending: a tab with a closing time.** Every voucher has an `expires` (required; the provider can shorten it, up
  to its `max_voucher` duration, 30 days by default), and it's the voucher customer's `expires`. So a consumer that
  never cancels doesn't leave a tab open: at the expiry the customer stops being allowed. A revoke or cancel sets
  the expiry to now. Reaching the cap doesn't end a voucher (the consumer can send an update with more spend).
  An ended voucher customer is kept for `keep_ended` (7 days by default) so its usage can be read and billed, then
  `network.sweep()` sends `network-voucher-ended` (the customer with its final usage) and deletes it. The SDK's
  `serve` runs the sweep at most once an hour, so there's nothing for the host to call.

## The consumer's side

- `limitr.network.connect(url, plan, spend, expires)`: fetch the manifest, check it, sign a voucher, send it,
  check the grant, build the connection and its capabilities. Returns the connection.
- `limitr.network.update(connection, { spend, expires })`, `limitr.network.cancel(connection)`.
- **Spend the consumer can see:** each connection keeps the latest receipt (spent, remaining). An event
  (`network-receipt`) on every call, and `network-low` when remaining drops under a threshold, so an agent's host
  can top up (send an updated voucher) or stop.
- **Its own limits on its own agents:** a consumer can also meter its agents with its own entitlements and caps
  (Ex. "this agent may spend $5 a day across all providers"), checked before the capability runs. That's the
  engine as it is today: a capability's `#[run]` step can call `allow()` first.

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

- **Source:** `src/network/` (types `NetworkProvider`, `NetworkConsumer`, `Voucher`, `Grant`, `Receipt`,
  `Endpoint`, `Connection`, and the message functions), with its own version (`<LimitrNetwork>.version`, 0.1.0) and
  its tests in `src/network/tests/`. It builds on the engine's types (`Customer`, `Cap`, `Capability`) and never
  changes them.
- **Build:** `project.stof` compiles it next to the engine, into the same `typescript/limitr.ts`:
  `export const limitrEngine = ...` and `export const limitrNetwork = ...`. A policy that doesn't use the Network
  never loads it, so its document doesn't grow.
- **Load:** `limitr.network()` parses the module into the document as `LimitrNetwork` (once; later calls return the
  same handle) and seals it, like the engine's `LimitrTypes`. Underneath is a general `limitr.module(name, bytes)`,
  which is how anyone adds their own: compile a Stof package to `bstf`, load it by name, sealed.
- **Tests:** `pkg.stof` imports both, so `stof test` in the limitr folder runs the engine's and the Network's tests.
- **SDK (TS first):** the handle has `connect`, `update`, `cancel`, `serve`, key custody (a `secretKey` option, or a
  generated one handed to a `keyStore` callback), and HTTP transport with `fetch`.

## Payment

Out of scope for 0.1. The consumer's signed vouchers and the provider's signed receipts are a record both sides can
check, and the provider bills its voucher customers the way it bills anyone (Limitr Cloud, Stripe). Settling
between parties (Cloud as the clearing layer with a platform fee, x402, prepaid balances) is a later layer on the
same messages.

## Security notes

- Secret keys stay in the host; the policy signs through `Network::sign`.
- A voucher binds the manifest's digest, so a provider can't change terms under an existing voucher; new terms need
  a new voucher.
- A connection can reach only its provider's host, sees nothing else in the consumer's policy, and can't be changed.
- Replay is refused with timestamps and per-voucher counters, in fixed memory.
- A provider never gets more than the voucher says: the cap enforces spend on its side, and the consumer sees every
  receipt.
- What 0.1 doesn't do: key rotation (a provider's new key needs a new manifest, and existing vouchers end), and
  revocation lists for issued identities. Both come with the identity layer.

## Build order

1. Engine: customer expiry; remove the old vouchers. Tests. **Done.**
2. Module: messages (build, sign, verify), manifest from a policy, voucher and grant, voucher customers, request
   verification and receipts, connections and capabilities. Stof tests with a provider and a consumer in one
   document, messages passed as text.
3. TS SDK: `limitr.network`, key custody, HTTP transport, `serve`.
4. Demo: two Node processes (a provider with a real endpoint, a consumer agent using it as a Claude tool), in
   `typescript/demos/network/` (`examples/` stays CJ's area). As small as it can be and still show the whole flow.
5. Docs and skills: a Network section in the limitr and limitr-ts skills; a limitr.dev page.
6. Later: discovery (an index of manifests), Cloud (payments, issued identities, analytics), provider logic (0.2).
