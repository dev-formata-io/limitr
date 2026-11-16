# Limitr Network tutorial (Python)

A short track on Limitr Network: services that sell to agents (and to each other), paid with signed vouchers instead
of API keys. Each chapter is one small program. It assumes the main [tutorial](../README.md) up to chapter 6
(policies, plans, limits, and prices); the Network adds nothing to how a policy meters, only who can be metered.

```bash
pip install limitr
```

Save an example as `example.py` and run it with `python example.py`. Each program serves the provider on a thread
(`network.serve()`, the standard library's WSGI server) and connects to it in the same program, so each runs on its
own. Every program here is run by the Python SDK's tests, so what each chapter says it prints is what it prints. The
same track in TypeScript is in [typescript/tutorial/network](../../../typescript/tutorial/network).

1. [What it is](01-what-it-is.md): providers, consumers, vouchers, and receipts
2. [A provider](02-a-provider.md): a policy that sells a route, and the one handler that serves it
3. [A consumer](03-a-consumer.md): a voucher, tools for an agent, refusals, top-ups, and cancelling
4. [Metering](04-metering.md): work that meters itself, free routes, and a most-per-request
5. [A provider's own tools](05-provider-tools.md): Stof that runs on the agent's side, and trusting it
6. [Operators and budgets](06-operators-and-budgets.md): many instances, one spend across providers, channels
7. [Identity and discovery](07-identity-and-discovery.md): who's on the other side, and finding services

The design is in [`src/network/SPEC.md`](../../../src/network/SPEC.md), the wire format in
[`PROTOCOL.md`](../../../src/network/PROTOCOL.md), and a two-process demo in [`python/demos/network`](../../demos/network/).
