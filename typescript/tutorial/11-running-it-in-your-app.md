# 11. Running it in your app

Three habits make Limitr easy to run in production:

1. **Create the engine once** when your server starts, and keep it. It holds every customer's meters in memory, which
   is why calls are fast. Creating one per request would start every customer from zero.
2. **Gate requests in one place**, like a middleware, so every route asks the same way.
3. **Save customer state** somewhere durable, and load it back when the server starts.

```ts
import { Limitr } from '@formata/limitr';

const policy = `
policy: {
    credits: { request: { label: 'Request' } }
    plans: {
        free: { default: true, entitlements: { api: { limit: { credit: 'request', value: 100, resets: true } } } }
    }
}`;

// Stands in for your database.
const db = new Map<string, unknown>();

// 1. Create the engine once, when your server starts, and keep it.
async function startEngine(): Promise<Limitr> {
    const limitr = await Limitr.new(policy);
    await limitr.loadCustomers(Object.fromEntries(db));         // customer state from your database
    limitr.addHandler('persist', (name, value) => {
        const event = JSON.parse(value as string);
        if (name === 'customer-set') db.set(event.id, event);   // a customer was created or replaced
        else if (event.customer?.id) db.set(event.customer.id, event.customer); // meter events carry the customer
    });
    return limitr;
}

// 2. Gate a request (Ex. inside Express, Hono, or Next.js middleware).
async function handleRequest(limitr: Limitr, userId: string): Promise<number> {
    await limitr.ensureCustomer(userId);                         // creates the customer on first sight
    if (!(await limitr.allow(userId, 'api', 1))) return 429;     // over the limit
    return 200;
}

let limitr = await startEngine();
for (let i = 0; i < 3; i++) await handleRequest(limitr, 'ada');
console.log('before restart:', await limitr.value('ada', 'api'));

limitr = await startEngine();                                    // a restart: state comes back from the database
await handleRequest(limitr, 'ada');
console.log('after restart:', await limitr.value('ada', 'api'));
```

It prints:

```text
before restart: 3
after restart: 4
```

- **Saving.** Customer records hold all of a customer's state: meters, grants, caps, and overrides. The handler
  saves them when they change: `customer-set` when a customer is created or its plan, caps, or overrides change, and
  every meter event carries the customer it changed. You can also save everything at once with `limitr.customers()`
  on an interval or at shutdown.
- **Loading.** `loadCustomers` takes an array of records or an object keyed by ID. `setCustomer(record)` loads one.
- **Awaiting.** Every method is async. `if (limitr.allow(...))` without `await` is always true.
- **Concurrency.** Each call runs on its own, one at a time, so a single `allow` is safe under load. Two calls in a
  row aren't one unit, which is why chapter 7's `reserve` exists.
- **More than one server.** Each server keeps its own engine and memory. If several servers share customers, they
  need a shared source of truth for state, which is what Limitr Cloud provides (next chapter).

Next: [Validation and errors](12-validation-and-errors.md)
