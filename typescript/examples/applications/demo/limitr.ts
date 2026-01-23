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

import { Limitr } from '../../../main.ts';


// Active cloud policy.
export const policy = await Limitr.cloud({ token: 'TOKEN' });
if (!policy) throw new Error('Could not connect to Limitr Cloud');


// Add a handler to the policy for downgrading customer models when overages are hit.
policy.addHandler(async (key: string, value: unknown) => {
    switch (key) {
        case 'meter-overage': {
            const record = JSON.parse(value as string);
            const customer = record.customer as Record<string, unknown>;
            const meta = customer.metadata as Record<string, unknown>;

            if (record.entitlement === 'summary_tokens' && meta.model === 'good') {
                meta.model = 'bad'; // downgrade model
                console.log((new Date()).toString(), 'downgrading user model: bad');
                await policy.setCustomer(customer);
            }
            break;
        }
        case 'meter-changed': {
            const record = JSON.parse(value as string);
            const customer = record.customer as Record<string, unknown>;
            const meta = customer.metadata as Record<string, unknown>;

            const remaining = record.remaining as number;
            if (record.entitlement === 'summary_tokens' && meta.model === 'bad' && remaining > 0) {
                meta.model = 'good'; // upgrade model
                console.log((new Date()).toString(), 'upgrading user model: good');
                await policy.setCustomer(customer);
            }
            break;
        }
    }
});


/**
 * Get or create a new cloud customer (TEST HELPER: would normally be created in app via signup or something).
 */
export async function customer(id: string, name: string): Promise<Record<string, unknown>> {
    if (!policy) throw new Error('no active policy');

    let customer: Record<string, unknown> | undefined;
    if (await policy.ensureCustomer(id, 'starter', 'user', name)) {
        // this customer is brand new (just created)
        customer = await policy.customer(id);
        if (customer && !customer.metadata) {
            customer.metadata = { model: 'good' };
            await policy.setCustomer(customer);
        }
    } else {
        // this customer was added from Limitr Cloud, or already local
        customer = await policy.customer(id);
    }

    if (!customer) throw new Error('unreachable');
    return customer;
}


/**
 * Get the Claude model for this Limitr customer, based on metadata.
 */
export function claudeModel(customer: Record<string, unknown>): string {
    if (!customer.metadata) customer.metadata = { model: 'good' };
    const meta = customer.metadata as Record<string, unknown>;
    const state = meta.model as string ?? 'good';
    switch (state) {
        case 'good': return 'claude-haiku-4-5-20251001';
        default: return 'claude-3-haiku-20240307';
    }
}
