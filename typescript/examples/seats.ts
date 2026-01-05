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

import { Limitr } from '../main.ts';

// Load a Limitr policy from a DB, string, file, API, etc.
const policy = await Limitr.new(`
policy: {
    credits: {
        seat: {
            description: 'A single seat credit that can be tracked per subject.'
        }
    }
    plans: {
        free: {
            entitlements: {
                seats: {
                    description: 'Each subject (user, org, etc.) with this plan can have up to this many seats.'
                    limit: {
                        credit: 'seat'
                        value: 1
                        increment: 1
                    }
                }
            }
        }
        paid: {
            entitlements: {
                seats: {
                    description: 'Each subject (user, org, etc.) with this plan can have up to this many seats.'
                    limit: {
                        credit: 'seat'
                        value: 3
                        increment: 1
                    }
                }
            }
        }
    }
}
`);

// Create/save/load subjects (database, Stripe, etc.)
await policy.addSubject('cus_free_customer', 'free');
await policy.addSubject('cus_paid_customer', 'paid');

// Perform entitlement checks, meter usage, etc.
await policy.increment('cus_free_customer', 'seats'); // adds one seat
await policy.increment('cus_paid_customer', 'seats'); // adds one seat

if (await policy.increment('cus_free_customer', 'seats')) throw Error("will not get here");
if (await policy.increment('cus_paid_customer', 'seats')) {
    // paid customer can add a second seat
}
