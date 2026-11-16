# Limitr Network demo (Python)

Two processes on your machine: a weather service that sells forecasts, and an agent that buys them. No API keys and
no accounts: the agent signs a **voucher** (a plan, a most-it-will-spend, an expiry), the service meters it like any
customer, and every request and receipt is signed. See `src/network/SPEC.md` for the protocol.

```bash
cd python
pip install limitr                          # or `pip install -e .` from this folder
python demos/network/provider.py            # terminal 1: Acme Weather on localhost:8787
python demos/network/consumer.py            # terminal 2: the agent
```

The provider and the consumer speak the same protocol as the TypeScript SDK's, so either side can be the
[TypeScript demo](../../../typescript/demos/network/) instead: run `provider.py` here and `consumer.ts` there.

What happens:

1. **The agent connects.** It reads the service's manifest (its plans, prices, and routes, signed), signs a
   voucher for up to 3 cents for an hour, and gets the service's grant. The service now has a customer for that
   voucher, with the 3 cents as a cap.
2. **The route is a tool.** `acme_weather_forecast` shows up in `claude_tools()`, ready to pass to Claude.
3. **The agent calls it.** Each call is signed by the agent's key; the service checks it (and that it isn't a
   replay), meters it (a cent), does the work, and answers with a signed receipt. The agent sees what it has spent.
4. **The voucher runs out.** The fourth forecast is refused (402): the service never gets more than the voucher says.
5. **Top up and call.** A newer voucher raises the spend.
6. **Trust its logic.** The service also wrote a tool of its own, `compare`, in Stof (in its policy's
   `network.provider.logic`). Trusting its logic makes `acme_weather_compare` a tool here: it runs in the agent's
   policy, sealed and confined (it sees nothing of the policy, calls no host, and reaches the service only through
   its routes), and makes two forecast requests, each signed for the voucher and metered by the service.
7. **Cancel.** Cancelling ends it on both sides, and the tools are gone.

The provider serves `network.wsgi(work)` with the standard library's WSGI server; gunicorn, waitress, or a Flask or
Django mount take the same app. To use the tools with Claude, pass `agent.claude_tools()` as `tools`, and for each
`tool_use` block, run `agent.run_capability(block.name, block.input)` and send the result back as a `tool_result`.
