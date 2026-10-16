# 3. Customers and plans

Every customer has an ID (yours: a user ID, an org ID), a plan, and a type. Customers can point at other
customers with **refs**, which is how a user belongs to a team or an org.

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        project: { label: 'Project' }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                projects: { limit: { credit: 'project', value: 2 } }
            }
        }
        team: {
            entitlements: {
                projects: { limit: { credit: 'project', value: 50 } }
                sso: {}
            }
        }
    }
}`);

// A solo user on the default plan.
await limitr.ensureCustomer('solo_user');

// An org on the team plan, and a user who belongs to it.
// The user has no plan of its own, so it uses its org's plan.
await limitr.ensureCustomer('acme', 'team', 'org', 'Acme Inc.');
await limitr.ensureCustomer('grace', '', 'user', 'Grace', ['acme']);

console.log('solo_user sso:', await limitr.allow('solo_user', 'sso'));   // free
console.log('grace sso:', await limitr.allow('grace', 'sso'));           // team, via acme
console.log('grace projects:', await limitr.limit('grace', 'projects')); // team's limit

// Upgrading is one call. Pass false to keep the usage counted so far.
await limitr.allow('solo_user', 'projects', 2);
await limitr.setCustomerPlan('solo_user', 'team', false);
const used = await limitr.value('solo_user', 'projects');
const limit = await limitr.limit('solo_user', 'projects');
console.log('after upgrade:', used, 'of', limit);
```

It prints:

```text
solo_user sso: false
grace sso: true
grace projects: 50
after upgrade: 2 of 50
```

- `ensureCustomer(id, plan, type, label, refs)`. Everything after the ID is optional.
- A customer with no plan of its own takes its plan from its refs, then from the default plan. Grace never got a plan,
  so she's on Acme's.
- `limit` reads the limit for a customer, `value` reads their usage, and `remaining` is the difference. Reads never
  count as usage.
- `setCustomerPlan` moves a customer to another plan. Passing `false` keeps the usage counted so far, so an upgrade
  mid-month doesn't hand out a fresh allowance. Leave it out to start the meters over.

Customers can also have **alt IDs**: other identifiers that point to the same customer, such as an auth provider's
user ID or a payment provider's customer ID (`ensureCustomer(id, plan, type, label, refs, ['cus_123'])`).

IDs and alt IDs can't contain a period. To use an email, replace its periods with a placeholder of your own, or keep
the email in the customer's metadata.

Next: [Limits and resets](04-limits-and-resets.md)
