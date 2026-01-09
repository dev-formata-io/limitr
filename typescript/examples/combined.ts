//
// Copyright 2026 Formata, Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Limitr } from "../main.ts";
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@^1.0.16';

// load a policy from wherever you keep policies (db, local string, server, etc.)
const policy = await Limitr.new(`
policy:
  credits:
    unit:
      description: "Represents a single MB of usage."
      stof_units: MB # magic happens here (stof units)
    seat:
      description: "A single seat in our application."
    token:
      description: "A unit of measurement for model usage."
  plans:
    free:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 3 # maximum of 3 seats in the free plan
            increment: 1 # increment 1 seat at a time
        usage:
          limit:
            credit: unit
            value: 1GB
            mode: hard # soft would allow overages
            resets: true
            reset_inc: 24hr # automatically resets meter after this long (stof units)
        davinci_tokens:
          limit:
            credit: token
            value: 500
        curie_tokens:
          limit:
            credit: token
            value: 2000
    pro:
      entitlements:
        seats:
          limit:
            credit: seat
            value: 10 # maximum of 10 seats in the pro plan
            increment: 1 # increment 1 seat at a time
        usage:
          limit:
            credit: unit
            value: 5GB
            mode: hard # soft would allow overages
            resets: true
            reset_inc: 24hr # automatically resets meter after this long (stof units)
        davinci_tokens:
          limit:
            credit: token
            value: 5000
        curie_tokens:
          limit:
            credit: token
            value: 20000
`, 'yaml');

// Load customers (users, orgs, Stripe customers, etc.)
// First lets create an org customer (for seats and anything tracked per org)
await policy.addCustomer('free_org', 'free', 'org', 'Free Org');

// Now lets create a user test customer linked to the org plan, with an additional ID (Stripe customer ID, app ID, API key, etc.)
await policy.addCustomer('free_user', '', undefined, undefined, 'free_org', ['cus_alt']);

// Now we're all set to track things for the org and user together!
// Lets increment a few seats on the org first.
assert(await policy.increment(policy.customerOrg('free_user') as string, 'seats'));
assert(await policy.allow(policy.customerOrg('cus_alt') as string, 'seats', 2));
assertFalse(await policy.increment('free_org', 'seats')); // cannot add a 4th seat to the org

// Lets track model tokens individually, not on the org
assert(await policy.allow('free_user', 'davinci_tokens', 300));
assertFalse(await policy.allow('free_user', 'davinci_tokens', 201)); // over by 1
assert(await policy.allow('free_user', 'curie_tokens', 1000));
assertFalse(await policy.allow('free_user', 'curie_tokens', 1001)); // over by 1

// Usage is tracked per user as well, and we can use any alt ID for the user
assert(await policy.allow('cus_alt', 'usage', 20 + 'MB'));
assertEquals(policy.value('free_user', 'usage') as number, 20); // always units of credit (MB)
assertFalse(await policy.allow('free_user', 'usage', '1GB')); // max of 1GB, so over by 20MB

// Now lets switch the plan for the org
assert(await policy.setCustomerPlan('free_org', 'pro'));
assert(await policy.allow('cus_alt', 'curie_tokens', 12200));
assertEquals(policy.value('cus_alt', 'curie_tokens') as number, 13200); // already had 1k from above
assertFalse(await policy.allow('cus_alt', 'curie_tokens', 7000)); // would be over by 200

// Now lets store our customers (entire state info)
console.log(policy.customers());
