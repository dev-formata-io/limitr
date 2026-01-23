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


// Connect to Limitr Cloud and stay synced with "active" policy
import { Limitr } from '../../../main.ts';
export const policy = await Limitr.cloud({ token: 'TOKEN' });
if (!policy) throw new Error('Could not connect to Limitr Cloud');


// Add a local Limitr event handler
policy.addHandler(async (key: string, value: unknown) => {
    switch (key) {
        case 'meter-reset':
        case 'meter-overage': {
            const record = JSON.parse(value as string);
            const customer = record.customer as Record<string, unknown>;
            const meta = customer.metadata as Record<string, unknown>;

            // downgrade AI models with overage, upgrade with reset
            if (record.entitlement === 'summary_tokens') {
                const prev = meta.model ?? 'good';
                meta.model = key === 'meter-overage' ? 'bad' : 'good';

                if (meta.model !== prev) {
                    console.log(`changing customer "${customer.id}" AI model from "${prev}" to "${meta.model}"`);
                    await policy.setCustomer(customer);
                }
            }
            break;
        }
    }
});


/**
 * Get or create a new cloud customer.
 * TEST HELPER: customer would normally be created in app via signup or something.
 */
export async function customer(id: string, name: string): Promise<Record<string, unknown>> {
    if (!policy) throw new Error('no active policy');

    let customer: Record<string, unknown> | undefined;
    if (await policy.ensureCustomer(id, 'starter', 'user', name)) {
        // init new customer
        customer = await policy.customer(id);
        if (customer && !customer.metadata) {
            customer.metadata = { model: 'good' };
            await policy.setCustomer(customer);
        }
    } else {
        // already existed in cloud or local
        customer = await policy.customer(id);
    }

    if (!customer) throw new Error('unreachable');
    return customer;
}
