# 13. Going to Cloud

Everything so far runs on the open-source engine, and you can ship it as is: commit the policy to your repo, save
customer state in your database, and bill from the events.

What the engine doesn't do on its own is everything around it: storing customer state across servers, ledgers and
invoices, changing a policy without a deploy, and seeing usage and margin across all of your customers. That's
[Limitr Cloud](https://limitr.dev). Your code changes by one line:

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.cloud({ token: process.env.LIMITR_TOKEN! });

// Everything else is the same as the earlier chapters.
await limitr.ensureCustomer(userId);
if (await limitr.allow(userId, 'chat', tokens)) {
    // ...
}
```

What changes behind that line:

- **The policy comes from Cloud.** You edit it in Cloud, with versions, diffs, and rollback. Publishing a change
  updates every running engine in seconds: your API servers, background workers, and front end, with no redeploy.
- **Customer state is shared.** A customer the engine hasn't seen is fetched from Cloud on first use, and changes sync
  back over a WebSocket in the background. No request ever waits on the network; every `allow` still runs in-process.
- **Billing and analytics.** Cloud keeps the ledger from the same events you saw in chapters 5 and 6, builds
  invoices, and shows usage, cost, and margin per customer, feature, and vendor.

A few options:

```ts
const limitr = await Limitr.cloud({
    token: process.env.LIMITR_TOKEN!,
    denyUnconnected: true,   // deny calls if the connection drops, so servers can't drift apart (the default)
    httpHosts: ['api.limitr.dev', 'api.example.com'],   // hosts the policy may call; only api.limitr.dev by default
});

// On shutdown, send any pending updates.
await limitr.close();
```

The engine is the same open-source code in both cases, so you can start self-hosted and move to Cloud later without
rewriting anything, or the other way around.

Back to the [table of contents](README.md).
