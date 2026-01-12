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
  plans:
    free:
      entitlements:
        usage:
          limit:
            credit: unit
            value: 1GB
            resets: true
            reset_inc: 24hr # automatically resets meter after this long (stof units)
    pro:
      entitlements:
        usage:
          limit:
            credit: unit
            value: 5GB
            resets: true
            reset_inc: 24hr
`, 'yaml');

// load customers (Stripe, user db, etc.) (helpers exist for batches of records)
await policy.addCustomer('free_user', 'free');
await policy.addCustomer('pro_user', 'pro');

// Override limits per customer
await policy.addCustomer('override_user', 'pro');
await policy.createCustomerOverride('override_user', 'usage', '10GB');
assert(await policy.allow('override_user', 'usage', '9GB'));
assertFalse(await policy.allow('override_user', 'usage', '1001MB')); // over by 1MB

// start metering usage per customer and let Limitr handle the rest
// default units, value, balance, limit, etc. all in units of the credit
assert(await policy.allow('free_user', 'usage', '20.5MB'));
assert(await policy.allow('free_user', 'usage', 500));

assertEquals(await policy.value('free_user', 'usage'), 520.5);
assertEquals(Math.round(await policy.remaining('free_user', 'usage') as number), 479);
assertEquals(Math.round(await policy.limit('free_user', 'usage') as number), 1000);

// hard limit of 1GB, so this fails and meter-limit emitted
assertFalse(await policy.allow('free_user', 'usage', 1 + 'GB'));

// print the entitlement record (can be customer or plan)
console.log(policy.entitlement('free', 'usage'));
