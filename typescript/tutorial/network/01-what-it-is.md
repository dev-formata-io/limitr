# 1. What it is

An agent that needs something it can't do (a forecast, a translation, a search) usually needs an account, an API key,
and someone to wire it in. Limitr Network replaces that with an agreement the two sides make on their own:

- A **provider** is a service with a Limitr policy. Its policy already says what it offers and what it costs (plans,
  entitlements, credits, prices). It adds `network.provider`: its name, its URL, the plans it offers on the network,
  and its **routes**, the requests a customer on those plans can make.
- A **consumer** is anything with a Limitr policy that wants to use it: an agent, an app, another service. It reads
  the provider's **terms** (its plans, prices, and routes, signed by the provider) and signs a **voucher**: "I'll pay
  up to this much, on this plan, until then."
- The provider accepts the voucher and makes a **customer** for it, like any of its customers, with the voucher's
  spend as a hard cap. It answers with a **grant**: the routes the plan reaches.
- On the consumer's side each route becomes a **tool**, a capability its agents can call (`claudeTools()` hands them
  to Claude). Each call is a signed request; the provider checks it, meters it with its policy, does the work, and
  answers with a signed **receipt**: what the request cost and what the voucher has left.

So there are no API keys to exchange: each policy has its own key pair, and the secret key never leaves its process.
The consumer can't spend more than its voucher says, and the provider can't charge for what it didn't do: both sides
hold the same signed record. Prices are in **runes**, the network's unit (a provider's terms say what a rune is to
it, 1 USD by default).

All of it runs in the policy, in the open-source engine, the same in any language. The host does three things: keep
the key, allow HTTP to the hosts the policy uses, and pass requests to one handler.

Two policies and HTTP are all it needs. **Operators**, optional parties both sides trust, add what two peers can't
do alone: one voucher across many instances of a provider, one budget across many providers, identities ("this key
is Acme Corp"), and a directory to find services in. Anyone can run one; Limitr Cloud is one. Chapters 6 and 7 cover
them.

Next: [A provider](02-a-provider.md)
