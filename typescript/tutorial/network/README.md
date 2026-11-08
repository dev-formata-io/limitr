# Limitr Network tutorial

A short track on Limitr Network: services that sell to agents (and to each other), paid with signed vouchers instead
of API keys. Each chapter is one small program. It assumes the main [tutorial](../README.md) up to chapter 6
(policies, plans, limits, and prices); the Network adds nothing to how a policy meters, only who can be metered.

```bash
npm i @formata/limitr
```

The examples are TypeScript for Node 22.18 or later (it runs TypeScript directly; with an older Node, use `npx tsx`).
They serve the provider and connect to it in the same program, so each runs on its own. Chapter 2 has a small helper,
`serve.mts`, that the others use; with Deno or Bun you don't need it.

1. [What it is](01-what-it-is.md): providers, consumers, vouchers, and receipts
2. [A provider](02-a-provider.md): a policy that sells a route, and the one handler that serves it
3. [A consumer](03-a-consumer.md): a voucher, tools for an agent, refusals, top-ups, and cancelling
4. [Metering](04-metering.md): work that meters itself, free routes, and a most-per-request
5. [A provider's own tools](05-provider-tools.md): Stof that runs on the agent's side, and trusting it
6. [Operators and budgets](06-operators-and-budgets.md): many instances, one spend across providers, channels
7. [Identity and discovery](07-identity-and-discovery.md): who's on the other side, and finding services

The design is in [`src/network/SPEC.md`](../../../src/network/SPEC.md), the wire format in
[`PROTOCOL.md`](../../../src/network/PROTOCOL.md), and a two-process demo in [`demos/network`](../../demos/network/).
