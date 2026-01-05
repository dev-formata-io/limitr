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

import { StofDoc } from '@formata/stof';
import { assert } from '@std/assert';
import { limitrApi } from "../limitr.ts";


const doc = await StofDoc.new();
doc.stof.binaryImport(limitrApi, 'bstf', null, 'prod');
doc.parse(`
Limitr policy: {
    credits: {
        Credit seat: {
            unit: 'seat'
            description: 'A single seat.'
            label: 'Seat'
        }
    }
    plans: {
        Plan free: {
            label: 'Free'
            entitlements: {
                Entitlement seats: {
                    description: 'How many seats per organization are allowed.'
                    Limit limit: {
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


// Create a test subject to play with
const sid = 'cus_example_id';
await doc.call('<Limitr>.api.create_subject', sid, 'free', 'organization', 'Organization', null, ['formata']);


// Check the seats policy for our subject
doc.lib('App', 'meter_limit', (json: string) => {
    const record = JSON.parse(json);
    console.log('LIMIT HIT FOR: ', record);
});
assert(await doc.call('<Limitr>.api.increment', 'formata', 'seats'));
assert(await doc.call('<Limitr>.api.increment', sid, 'seats'));
assert(await doc.call('<Limitr>.api.increment', 'formata', 'seats'));
assert(!(await doc.call('<Limitr>.api.increment', sid, 'seats'))); // hit max


// await doc.run(); // PRINT POLICY AS TOML