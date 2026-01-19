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

import { assert } from 'jsr:@std/assert@^1.0.16';
import { Limitr } from "../main.ts";


const limitr = await Limitr.new(`
policy: {
    credits: {
        seat: {
            unit: 'seat'
            description: 'A single seat.'
            label: 'Seat'
        }
    }
    plans: {
        free: {
            label: 'Free'
            entitlements: {
                #[type('FreeSeats')]
                Entitlement seats: {
                    description: 'How many seats per customer are allowed.'
                    limit: {
                        credit: 'seat'
                        value: 3
                        increment: 1
                    }
                }
            }
        }
        paid: {
            label: 'Paid'
            entitlements: {
                #[init]
                fn copy_seats() {
                    self.seats = new FreeSeats {};
                    self.seats.limit.value = 10;
                }
            }
        }
    }
}
`);
console.log(limitr.plan('paid'));

// Create a test customer to play with
const sid = 'cus_example_id';
await limitr.createCustomer(sid, 'free', 'org', 'Formata', null, ['formata']);

// Check the seats policy for our customer
limitr.doc.lib('App', 'meter_limit', (json: string) => {
    const record = JSON.parse(json);
    console.log('LIMIT HIT FOR: ', record);
});
assert(await limitr.increment(sid, 'seats'));
assert(await limitr.increment(sid, 'seats'));
assert(await limitr.increment('formata', 'seats'));
assert(!(await limitr.increment(sid, 'seats'))); // hit max

assert(await limitr.deincrement(sid, 'seats')); // remove one seat
assert(await limitr.increment(sid, 'seats')); // add another seat


// Create a paid customer to test with
await limitr.createCustomer('cus_paid', 'paid');
assert(await limitr.allow('cus_paid', 'seats', 10)); // take up all 10
assert(!(await limitr.increment('cus_paid', 'seats')));


// Update the free plan to have 5 seats
await limitr.setPlan('free', `
label: 'Free'
entitlements: {
    Entitlement seats: {
        description: 'How many seats per organization are allowed.'
        Limit limit: {
            credit: 'seat'
            value: 5
            increment: 1
        }
    }
}
`);
console.log(limitr.creditFor(sid, 'seats'));