# The Limitr Network Protocol (LNP) 0.1

This is the wire format: what goes over HTTP between a provider, a consumer, and operators, and how each side checks
it. It's for anyone implementing or auditing the protocol outside the Limitr module. [`SPEC.md`](SPEC.md) is the
design (why, and how the module builds it); this document is the contract. The test vectors at the end are checked by
`src/network/tests/vectors.stof`, and were reproduced with an independent Ed25519 and SHA-256 (Node's `crypto`).

On the wire the protocol's name is `limitr-network`. Every name below derives from it.

## Conventions

- All text is UTF-8. Bodies and messages are JSON.
- Times are integers or floats of **milliseconds** since the Unix epoch.
- Amounts are **runes** (floats), the network's unit of value (see Terms: `rune`).
- **Keys** are Ed25519. A public key is its 32 bytes in standard base64 (with padding); a secret key is its 32-byte
  seed in standard base64. A **signature** is 64 bytes in standard base64.
- A **digest** is the SHA-256 of a text's UTF-8 bytes, as 64 lowercase hex characters. The digest of the empty text is
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Receivers ignore fields they don't know.

## Signatures

A signature is Ed25519 (RFC 8032, pure, verified strictly) over these bytes:

```
"stof-signature-v1"            17 bytes, ASCII
len(context)                   8 bytes, unsigned little-endian
context                        UTF-8
message                        the exact bytes signed
```

The **context** is `limitr-network/v1/` followed by the message's type (Ex. `limitr-network/v1/voucher`), so a
signature on one kind of message is never valid as another. A verifier rebuilds the same bytes from the context it
expects and the message as received; it never re-serializes JSON.

## Envelopes

Every message except a request is sent as an **envelope**, a JSON object of three strings:

```json
{ "message": "<JSON text of the message>", "key": "<sender's public key>", "signature": "<signature of message>" }
```

`message` is JSON text (a string inside the envelope), signed exactly as sent. Parsed, it is:

| Field | Type | Meaning |
|---|---|---|
| `protocol` | string | `limitr-network/0.1` |
| `type` | string | the message type (below) |
| `from` | string | the sender's public key |
| `to` | string | the receiver's public key, or `""` for anyone (a manifest, an identity statement, a rotation) |
| `id` | string | unique per message (21-character nanoid) |
| `issued` | ms | when it was made |
| `expires` | ms | after this it's refused (5 minutes after `issued` unless a type says otherwise) |
| `body` | object | the type's body (below) |

**Opening an envelope.** In order, refuse it when:

1. it isn't JSON with string `message`, `key`, and `signature`;
2. an expected sender is known and `key` isn't it (Ex. a provider's key, an operator's key);
3. the signature doesn't verify for `key` under `limitr-network/v1/<expected type>` over `message`;
4. `protocol` isn't one we speak (see Versions), or `type` isn't the expected type;
5. `from` isn't `key`;
6. `to` is neither `""` nor our key;
7. `expires` has passed (skipped only for a message kept and checked again later, Ex. a voucher an operator stored);
8. `issued` is more than 60 seconds in the future.

### Versions

`protocol` is `<name>/<major>.<minor>`. A peer speaks a protocol with the same name and major version and, before
1.0, the same minor version. After 1.0 a minor version only adds fields and features, which are advertised (in terms
and manifests), never assumed.

## Between a provider and a consumer

```
consumer                                          provider
   GET  /.well-known/limitr-network       ---->
                                          <----   manifest
   POST /limitr-network/voucher (voucher) ---->
                                          <----   grant, or refused
   <route> + request headers              ---->
                                          <----   response + receipt header
   POST /limitr-network/cancel (cancel)   ---->        (or the provider sends a revoke)
```

Every URL is `https://`, except `http://` to `localhost` or `127.0.0.1`.

### manifest

`GET <provider url>/.well-known/limitr-network` returns an envelope of type `manifest` (to `""`, valid for a day):

```json
{ "terms": "<JSON text of the terms>", "identity": "<an identity statement envelope, optional>" }
```

`terms` is **text**: its digest is what a voucher agrees to, so a consumer computes the digest of the string as
received. `identity` is the provider's own identity statement (see Identity), outside the terms so renewing it changes
no voucher.

#### Terms

| Field | Meaning |
|---|---|
| `name` | the provider's name (letters, numbers, `_`, `-`) |
| `label` | how people see it |
| `url` | its base URL: routes are under it |
| `currency` | `rune` |
| `rune` | `{ value, currency }`: what one rune is to this provider (Ex. `{ "value": 1.0, "currency": "usd" }`) |
| `plans` | by name: `{ label, period, identity, entitlements }`; `identity` is whether a voucher for it needs an identity statement; each entitlement is `{ description, limit? }`, a limit `{ credit, mode, value, increment, resets, reset_sch?, reset_inc? }` |
| `credits` | by name: `{ label, unit, description, pricing_model, price, tiers? }`; `price` in runes per unit, `tiers` a list of `{ up_to, price }` (`up_to` null for the last) |
| `operators` | optional: the operators it accepts, `{ <role>: <operator's first public key> }` |
| `routes` | by name: `{ description, method, path, parameters, entitlement?, value?, hold?, plans?, tool }`; each parameter `{ name, description, schema_type, required }` |
| `tools` | by name: `{ description, parameters, plans? }` (the provider's own tools) |
| `logic` | with tools: their Stof source (run only by consumers that trust it) |

### voucher

`POST <provider url>/limitr-network/voucher` with an envelope of type `voucher`, to the provider:

| Body field | Meaning |
|---|---|
| `voucher` | the consumer's ID for it (letters, numbers, `_`, `-`) |
| `seq` | 1, then higher with each update (an older or equal `seq` is refused) |
| `plan` | an offered plan; it never changes (another plan is another voucher) |
| `terms` | the digest of the terms text it agrees to |
| `spend` | the most it pays, in runes (more than 0) |
| `expires` | until when (ms) |
| `name` | how the consumer calls itself |
| `budget`, `operator` | optional: a budget at a state operator, and that operator's first public key |
| `identity` | optional: the consumer's identity statement (an envelope, as text) |

The provider refuses it for: a plan it doesn't offer, an expiry in the past, terms whose digest isn't its current
terms', a budget at an operator it doesn't accept for state, an identity statement it needs and doesn't have or that
doesn't check out, an existing voucher held by another key, an older `seq`, or another plan. It may shorten
`expires` (to its longest voucher, and never past the identity statement's), never lengthen it.

### grant and refused

The answer to a voucher is **200** with an envelope of type `grant` (to the consumer):

| Body field | Meaning |
|---|---|
| `voucher`, `seq` | the voucher it accepts |
| `customer` | the provider's customer for it (`nv_<voucher>`) |
| `plan`, `spend` | as the voucher says |
| `expires` | the expiry it granted |
| `url` | its URL |
| `routes`, `tools` | the names of the routes and tools the plan reaches (a consumer refuses a grant naming any its terms don't have) |

or **400** with an envelope of type `refused`: `{ voucher, reason }`. An operator's refusal adds `spent`, `remaining`,
and `budget_remaining` when it's about a voucher it holds.

### requests

A request to a route is the route's own HTTP request (its method, `<url><path>`, a query string or body as the
provider's work expects) with two headers:

- `limitr-network-request`: JSON text, the **signed request**:

  | Field | Meaning |
  |---|---|
  | `protocol` | `limitr-network/0.1` |
  | `type` | `request` |
  | `voucher` | the voucher it's under |
  | `n` | the request number: an integer, each used once |
  | `method` | the HTTP method, upper case |
  | `path` | the path with its query string, exactly as sent |
  | `body` | the digest of the body text (of `""` with no body) |
  | `max` | optional: the most this request may spend (runes) |
  | `issued` | when it was signed (ms) |

- `limitr-network-signature`: its signature, by the voucher's key, under `limitr-network/v1/request`.

Header names are case-insensitive. The provider refuses it with **401** when: either header is missing or not JSON;
the voucher is unknown; the signature doesn't verify with the key that signed the voucher; `protocol` or `type` is
off; `method` or `path` isn't the request's; `body` isn't the digest of the body received; `issued` is more than 60
seconds from now either way; `n` isn't an integer, was already used, or is older than the last 64 numbers seen (the
provider keeps the highest `n` and the last 64); no route matches; or `max` isn't a non-negative number. A valid
request uses up its `n` whether or not it's allowed.

It refuses with **402** when the provider's limits, the voucher's spend, or its expiry don't allow it, and **503**
when its state operator can't be reached (it fails closed). A refusal's body is the reason as text.

### receipt

Every response the provider can tie to a voucher (allowed, and 402) carries a header `limitr-network-receipt`: an
envelope of type `receipt` (to the consumer), made after the work:

| Body field | Meaning |
|---|---|
| `voucher`, `n` | the request it answers |
| `allowed` | whether it was allowed |
| `cost` | what the request spent, in runes |
| `body` | the digest of the response body as sent (null for a refusal) |
| `spent`, `remaining` | the voucher's spend so far and what's left |
| `budget_remaining` | what its budget has left, or null |

A consumer refuses a **2xx** response whose receipt is missing, isn't signed by the provider, is for another voucher
or `n`, or whose `body` isn't the digest of the response body received.

### cancel and revoke

`POST <provider url>/limitr-network/cancel` with an envelope of type `cancel` (consumer to provider): `{ voucher }`.
The provider ends the voucher now (200 `{"cancelled":true}`, or 400). A **revoke** (provider to consumer) is an envelope
of type `revoke`: `{ voucher, reason }`. It's valid only signed by the provider, however it's delivered (an operator
may relay it unchanged), and a consumer that never gets one learns on its next request, which is refused.

## Operators

An operator publishes `GET <operator url>/.well-known/limitr-network-operator`, an envelope of type `operator` (to
`""`, valid for a day):

| Body field | Meaning |
|---|---|
| `label` | how people see it |
| `roles` | what it serves: `state`, `identity`, `discovery` (and `revoke`, `payment`, or namespaced `<domain>/<role>`) |
| `modes` | the state modes it supports: `strict`, `bounded` |
| `rotations` | its key rotations, in order from its first key (below), or null |
| `requires` | who must be identified by it to use it: `provider`, `consumer` |

It takes every other message at `POST <operator url>/limitr-network/operator/<type>`, an envelope signed by the
sender and addressed to the operator, and answers **200** with its answer envelope, or **400** with a `refused`
envelope (`{ voucher, reason }`), both signed by the operator; it answers 404 for a role it doesn't serve. A party
checks an operator's envelopes against the key it was configured with (or a key that key rotated to), never a key a
message carries. The transport doesn't matter: the same envelopes can go over any channel.

### Key rotation

An operator is known by its **first** key. It rotates by signing, with the key it has, an envelope of type `rotate`
(to `""`): `{ key: <new key>, previous: <the signing key> }`, and publishing the chain in its manifest's `rotations`.
To follow it, start at the first key and check each rotation in order: signed by the current key, `previous` equal to
it; the last `key` is the operator's signing key. Refuse a chain that doesn't pass through the key you followed to
before. An operator keeps taking messages addressed to a key it rotated from.

### The state role

Messages from a provider instance about a voucher (`{ voucher, ... }`, type and answer):

| Message | Body | Answer |
|---|---|---|
| `register` / `registered` | `envelope` (the consumer's signed voucher), `expires` (the expiry granted), `customer` | the voucher's figures |
| `find` / `found` | `voucher` (and `adjust`) | `envelope`, `expires`, `customer`, and the figures |
| `claim` / `claimed` | `n`, `runes` (what the request may spend), `adjust` | `n`, and the figures |
| `lease` / `leased` | `amount`, `expires` (when it should end) | `lease` (its ID), `amount` (granted), `until` |
| `settle` / `settled` | `lease`, `calls` (`[[n, runes], ...]`), `adjust` | `charged`, `duplicates` (request numbers it didn't charge) |
| `end` / `ended` | `reason` | the figures |

The figures are `{ voucher, spent, remaining, budget_remaining }`. `adjust` (runes) is what earlier requests spent
beyond, or short of, what was claimed for them. The operator checks a registered voucher's signature itself (and a
provider instance that `find`s one checks it again), keeps the last 1024 request numbers per voucher, and charges a
request number once.

From a consumer: `budget` / `budgeted`, body `{ budget, seq, spend, expires, providers? }` (an ID, higher `seq` to
change it, `providers` the provider keys it may be spent with), answered with `{ budget, seq, spent, remaining,
budget_remaining }`.

### The identity role

- `identify` / `identified` (from anyone, body `{}`): for a key the operator knows, `{ statement }`, an **identity
  statement**.
- An identity statement is an envelope of type `identity` (to `""`), signed by the operator, whose `expires` is the
  statement's: `{ key, subject, expires }`, "the key `key` is `subject`". Whoever checks it checks it against its own
  identity operator, for the key that signed the voucher (or manifest), and current.

### The discovery role

- `list` / `listed` (from a provider): `{ manifest, visibility, members, subjects }`: its manifest envelope (as text,
  signed by the same key that signs this message), `visibility` `public` or `private`, `members` (public keys) and
  `subjects` (who this operator identified) that may find a private listing. Listing again replaces it.
- `unlist` / `unlisted` (from a provider): `{}`.
- `search` / `results` (from anyone): `{ query, limit, identity? }` answered with `{ manifests }`, the matching
  manifests the searcher may see, unchanged. A searcher checks each manifest's signature and leaves out any that
  don't check out.

### Requirements

An operator whose manifest `requires` a side refuses a key it hasn't identified: `provider` for `register` and `list`,
`consumer` for the consumer of a registered voucher, `budget`, and `search`.

### Not yet specified

The `revoke` role (relaying signed revokes and cancels) and the `payment` role (settling from claims or from batches of
signed receipts) are described in [`SPEC.md`](SPEC.md) and are specified when the Limitr Cloud operator builds them.

## Test vectors

These keys are for testing only.

| | Secret (seed) | Public |
|---|---|---|
| consumer | `a47o0A9U6j7LYo/7XUvHLr+wNc8lPWPi79Pn3FPCaxI=` | `quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=` |
| provider | `f0hrbcBxEsY/2hs5j3AGA4Pv6ETSnIZvjk9bBvimM/o=` | `eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=` |

**Signed bytes.** For the context `limitr-network/v1/voucher` and an empty message, the bytes are (hex):

```
73746f662d7369676e61747572652d7631 1900000000000000 6c696d6974722d6e6574776f726b2f76312f766f7563686572
"stof-signature-v1"                 25, u64 LE       "limitr-network/v1/voucher"
```

**Terms and their digest.** The terms text:

```json
{"name":"acme_weather","label":"Acme Weather","url":"https://api.acme.example","currency":"rune","rune":{"value":1.0,"currency":"usd"},"plans":{"agent":{"label":"Agent","period":"monthly","identity":false,"entitlements":{"forecasts":{"description":"","limit":{"credit":"forecast","mode":"soft","value":0.0,"increment":1.0,"resets":false}}}}},"credits":{"forecast":{"label":"Forecast","unit":"forecast","description":"","pricing_model":"flat","price":0.01}},"routes":{"forecast":{"description":"The forecast for a city","method":"GET","path":"/forecast","parameters":[{"name":"city","description":"","schema_type":"string","required":true}],"entitlement":"forecasts","value":1.0}},"tools":{}}
```

has the digest `8737a4a6764704757806a563d6f162bfc37c901a1af512a8b1ceae123be67f8c`.

**A voucher.** The consumer's `message` text (to the provider), exactly as signed:

```json
{"protocol":"limitr-network/0.1","type":"voucher","from":"quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=","to":"eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=","id":"q3Xv9kz0Lr2Jm8wTnB5yC","issued":1794100000000.0,"expires":1794100300000.0,"body":{"voucher":"V1StGXR8_Z5jdHi6B-myT","seq":1,"plan":"agent","terms":"8737a4a6764704757806a563d6f162bfc37c901a1af512a8b1ceae123be67f8c","spend":5.0,"expires":1794200000000.0,"name":"test_agent","budget":null,"operator":null,"identity":null}}
```

signed under `limitr-network/v1/voucher` by the consumer: `jq8oPNkg4vpBfbSJzRbnzrWpTWgUGI/rw4WPxdrbnv5FzjefqBTSZXJuaJ0hRlxor/NoBk0M3o8HtX6ieJo7DA==`

The envelope as sent:

```json
{"message":"{\"protocol\":\"limitr-network/0.1\",\"type\":\"voucher\",\"from\":\"quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=\",\"to\":\"eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=\",\"id\":\"q3Xv9kz0Lr2Jm8wTnB5yC\",\"issued\":1794100000000.0,\"expires\":1794100300000.0,\"body\":{\"voucher\":\"V1StGXR8_Z5jdHi6B-myT\",\"seq\":1,\"plan\":\"agent\",\"terms\":\"8737a4a6764704757806a563d6f162bfc37c901a1af512a8b1ceae123be67f8c\",\"spend\":5.0,\"expires\":1794200000000.0,\"name\":\"test_agent\",\"budget\":null,\"operator\":null,\"identity\":null}}","key":"quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=","signature":"jq8oPNkg4vpBfbSJzRbnzrWpTWgUGI/rw4WPxdrbnv5FzjefqBTSZXJuaJ0hRlxor/NoBk0M3o8HtX6ieJo7DA=="}
```

**A request.** `GET https://api.acme.example/forecast?city=Boston` with no body (its digest is the empty text's), with
the header `limitr-network-request`:

```json
{"protocol":"limitr-network/0.1","type":"request","voucher":"V1StGXR8_Z5jdHi6B-myT","n":1,"method":"GET","path":"/forecast?city=Boston","body":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","max":null,"issued":1794100001000.0}
```

and `limitr-network-signature`: `b7ROMo1Y7tZL9nN+BqMtBoby4jJuojP1oNByW3Zqyvf0fJwksCjU0s63xnpvCZNA9M3A0leL7FxoTDtPPGBVDw==`

(For a body, Ex. `{"city":"Boston"}`, `body` would be `0fa7bd0f89782a366cf67bb0b561086ca441a453c24bcda0af0077c7917d3b65`.)

**A receipt.** For the response body `{"city":"Boston","forecast":"sunny","high":12}`, the provider's `message` text, exactly as signed:

```json
{"protocol":"limitr-network/0.1","type":"receipt","from":"eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=","to":"quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=","id":"Hk7Lw2QpZ9xVb4NcR1tYs","issued":1794100001500.0,"expires":1794100301500.0,"body":{"voucher":"V1StGXR8_Z5jdHi6B-myT","n":1,"allowed":true,"cost":0.01,"body":"98d7dd613ec1f27e03a71a7f0dea838e009924fba4bf4a36929e8a2561705ae4","spent":0.01,"remaining":4.99,"budget_remaining":null}}
```

signed under `limitr-network/v1/receipt` by the provider: `WEa1pWShF5dLu0BNsRcH7iqp7/omzC60paE7m1VWysAG5rW+JRsGYm3ZI/dKg4T8OKjIH+aVzqDMfM2WqNJ0Dg==`

The envelope as sent (the `limitr-network-receipt` header):

```json
{"message":"{\"protocol\":\"limitr-network/0.1\",\"type\":\"receipt\",\"from\":\"eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=\",\"to\":\"quMqUnOWtAeYIIxUlcMBO7HdUb5GASQMJFUZTQCFXig=\",\"id\":\"Hk7Lw2QpZ9xVb4NcR1tYs\",\"issued\":1794100001500.0,\"expires\":1794100301500.0,\"body\":{\"voucher\":\"V1StGXR8_Z5jdHi6B-myT\",\"n\":1,\"allowed\":true,\"cost\":0.01,\"body\":\"98d7dd613ec1f27e03a71a7f0dea838e009924fba4bf4a36929e8a2561705ae4\",\"spent\":0.01,\"remaining\":4.99,\"budget_remaining\":null}}","key":"eKFw/TZJJlkCuIgkPEz/Dc887hVDNlUYZm3VJvz8DyE=","signature":"WEa1pWShF5dLu0BNsRcH7iqp7/omzC60paE7m1VWysAG5rW+JRsGYm3ZI/dKg4T8OKjIH+aVzqDMfM2WqNJ0Dg=="}
```

Changing any byte of a `message` makes its signature fail. The messages' times are fixed in the past, so a checker
skips the expiry step for these.
