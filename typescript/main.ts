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

import { StofDoc } from "@formata/stof";
import { limitrApi } from "./limitr.ts";


/**
 * Internally ensure there's no overlap between policy calls.
 * This may happen with the Limitr.cloud ttl (or patterns like it).
 * A common WASM in TS thing.
 */
class StofGate {
    //deno-lint-ignore no-explicit-any
    private queue: any = Promise.resolve();

    run<T>(fn: () => Promise<T> | T): Promise<T> {
        const next = this.queue.then(fn);
        this.queue = next.catch(() => {});
        return next;
    }
}


/**
 * Cloud init options.
 */
export interface LimitrCloudInit {
    token: string;
    ttl?: number;
    policy?: string;
    address?: string;
}


/**
 * Limitr base class.
 * Note: Any sync_calls on this doc will not work with async TS lib functions (ex. fetch).
 *       This is okay for a lot of calls, especially without HTTP adapters and events, but keep it in mind.
 */
export class Limitr {
    /** StofDoc. */
    doc: StofDoc;

    /** Gate. */
    gate: StofGate = new StofGate();

    /** Cloud policy pull interval. */
    interval?: unknown;


    /**
     * Constructor.
     * Make sure StofDoc.initialize() has been called for Stof first.
     * This will always add the Limitr Stof types, etc.
     */
    constructor(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof') {
        this.doc = new StofDoc();
        if (format === 'cloud.limitr.dev' && policy instanceof Uint8Array) {
            // no timeout, query, or bearer options
            this.doc.lib('Http', 'fetch', async (
                url: string,
                method: string = 'GET',
                body: BodyInit | undefined | null = null,
                headers: Map<string, string> = new Map()): Promise<Map<string, unknown>> => {
                const response = await fetch(url, {
                    method,
                    body: body ?? undefined,
                    headers: Object.fromEntries(headers.entries()),
                });
                const result = new Map<string, unknown>();
                result.set('status', response.status);
                result.set('ok', response.ok);
                result.set('headers', new Map(response.headers));
                result.set('content_type', response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? 'text/plain');
                result.set('bytes', await response.bytes());
                return result;
            }, true);
            this.doc.parse(policy, 'bstf');
        } else {
            this.doc.stof.binaryImport(limitrApi, 'bstf', null, 'prod');
            this.doc.parse(policy, format);
        }
    }


    /**
     * Async constructor that ensures Stof wasm initialization.
     */
    static async new(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof'): Promise<Limitr> {
        await StofDoc.initialize();
        return new Limitr(policy, format);
    }


    /**
     * Initialize with cloud.limitr.dev.
     *
     * @param token API token to use with cloud.limiter.dev.
     * @param address Server URL.
     * @param policy Policy ID or "active" for the active policy.
     * @param ttl Policy time-to-live - if set, the policy will be updated on an interval (use with "active" policy, recommended to be > 5000ms if possible).
     */
    static async cloud(options: LimitrCloudInit | string): Promise<Limitr | undefined> {
        const token = typeof options === 'string' ? options : options.token;
        if (token.length < 1) return undefined;

        const ttl = typeof options === 'string' ? null : options.ttl ?? null;
        const policy = typeof options === 'string' ? 'active' : options.policy ?? 'active';
        const address = typeof options === 'string' ? 'https://api.limitr.dev' : options.address ?? 'https://api.limitr.dev';

        const response = await fetch(address + `/v1/limitr/policies/${policy}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            await StofDoc.initialize();
            const bytes = await response.bytes();
            const result = new Limitr(bytes, 'cloud.limitr.dev');
            if (ttl !== null) {
                result.interval = setInterval(async () => {
                    const response = await fetch(address + `/v1/policies/${policy}`, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                        const doc = result.doc;
                        const json = await response.text();
                        result.gate.run(() => doc.sync_call('<Limitr>.api.update_policy_internals', json, 'json'));
                    }
                }, ttl);
            }
            return result;
        }
        return undefined;
    }


    /*****************************************************************************
     * Plans API.
     *****************************************************************************/

    /**
     * Get a plan record by ID (plan ID or customer ID).
     */
    async plan(id: string): Promise<Record<string, unknown> | undefined> {
        const planNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan', id));
        if (typeof planNode === 'string') return this.doc.record(planNode);
        return undefined;
    }
    
    
    /**
     * Set a plan on this policy by name/ID.
     * Returns a node ID to the resulting Plan.
     */
    async setPlan(id: string, planStof: string): Promise<string | null> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_plan', id, planStof)) as string | null;
    }


    /**
     * Delete a plan by ID.
     */
    async deletePlan(id: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.delete_plan', id)) as boolean;
    }


    /*****************************************************************************
     * Credits API.
     *****************************************************************************/
    
    /**
     * Get a credit record by ID/type.
     */
    async credit(id: string): Promise<Record<string, unknown> | undefined> {
        const node = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.credit', id));
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /**
     * Get a credit record for a specific entitlement.
     * ID can be a plan ID or a customer ID.
     */
    async creditFor(id: string, entitlement: string): Promise<Record<string, unknown> | undefined> {
        const node = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.credit_for', id, entitlement));
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /*****************************************************************************
     * Customers API.
     *****************************************************************************/

    /**
     * Get a customer record by ID (or alternative IDs).
     */
    async customer(id: string): Promise<Record<string, unknown> | undefined> {
        const subNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', id));
        if (typeof subNode === 'string') return this.doc.record(subNode);
        return undefined;
    }


    /**
     * Get all customers as a single record.
     * Customers contain all state information, so this is all that is required to save/load.
     */
    async customers(): Promise<Record<string, unknown> | undefined> {
        const node = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.get'));
        if (typeof node === 'string') {
            const subs = this.doc.get('customers', node);
            if (typeof subs === 'string') return this.doc.record(subs);
        }
        return undefined;
    }


    /**
     * Get the customer organization customer ID if defined.
     */
    async customerOrg(id: string): Promise<string | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer_org', id)) as string | null;
    }


    /**
     * Set/change a customer's plan ID.
     * Returns true if the plan has changed (and emits a customer-set event).
     */
    async setCustomerPlan(id: string, plan: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer_plan', id, plan)) as boolean;
    }


    /**
     * Load customer from the cloud.
     */
    async addCloudCustomer(token: string, id: string, address: string = 'https://api.limitr.dev'): Promise<boolean> {
        const response = await fetch(address + `/v1/customers/${id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.ok) {
            const json = JSON.stringify(await response.json());
            const cus = await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer', json, false)) as string | null;
            return cus !== null;
        }
        return false;
    }

    
    /**
     * Add a new customer to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    async addCustomer(id: string, plan: string, type: 'user' | 'org' = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        await this.gate.run(() => this.doc.call('<Limitr>.api.create_customer', id, plan, type, label, org, alts));
    }


    /**
     * Set a customer on this policy by ID.
     * Returns a node ID to the resulting Customer.
     */
    async setCustomer(customerStof: string): Promise<string | null> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer', customerStof, true)) as string | null;
    }


    /**
     * Load many customers as records.
     * This is all that is required for save/load since customers contain all state information.
     */
    async loadCustomers(customers: Record<string, unknown> | Record<string, unknown>[]) {
        let subs: Record<string, unknown>[] = [];
        if (!Array.isArray(customers)) {
            for (const [k, v] of Object.entries(customers)) {
                const val = v as Record<string, unknown>;
                val.id = k; // make sure it has the correct ID
                subs.push(val);
            }
        } else {
            subs = customers;
        }
        const handles: Promise<string | null>[] = [];
        for (const sub of subs) {
            const id = sub.id;
            if (typeof id === 'string') {
                handles.push(this.setCustomer(JSON.stringify(sub)));
            }
        }
        await Promise.allSettled(handles);
    }


    /**
     * Remove a customer by ID.
     * If a cloud customer, they will not be removed from the cloud.
     */
    async removeCustomer(id: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.delete_customer', id)) as boolean;
    }


    /**
     * Add an alternative customer ID to an existing customer.
     */
    async addAltID(existing: string, alt: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_alt_customer_id', existing, alt)) as boolean;
    }


    /**
     * Remove an alternative customer ID from an existing customer.
     */
    async removeAltID(alt: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.delete_alt_customer_id', alt)) as boolean;
    }


    /**
     * Create a new customer override (limit).
     * Overrides are specific to customers, and they override the limit defined on a specific entitlement for that customer.
     *
     * If the customer already has an override for this entitlement, it will be replaced.
     */
    async createCustomerOverride(id: string, entitlement: string, value?: string | number, expires_on?: number, credit?: string, mode?: string, increment?: number | string, resets?: boolean, reset_inc?: number | string): Promise<string | null> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.create_customer_override', id, entitlement, expires_on ?? null, credit ?? null, mode ?? null, value ?? null, increment ?? null, resets ?? null, reset_inc ?? null)) as string | null;
    }


    /**
     * Remove a customer override (limit).
     */
    async removeCustomerOverride(id: string, entitlement: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.remove_customer_override', id, entitlement)) as boolean;
    }


    /*****************************************************************************
     * Entitlements API.
     *****************************************************************************/

    /**
     * Get an entitlement record with a plan ID or customer ID and an entitlement name.
     */
    async entitlement(id: string, entitlement: string): Promise<Record<string, unknown> | undefined> {
        const node = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.entitlement', id, entitlement));
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /**
     * Get the limit value for a metered entitlement.
     * ID can be a customer ID or a plan ID (to get the specific entitlement from a plan).
     * Will always be in the units of the credit associated with this entitlement (ex. limit.value = '2GB', credit.stof_units = 'MB', limit = 2000).
     */
    async limit(id: string, entitlement: string): Promise<number | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.limit', id, entitlement)) as number | null;
    }


    /**
     * Get the remaining balance for a customer's entitlement (limit - current (metered) value).
     * Will always be in the units of the credit associated with this entitlement.
     */
    async remaining(customer: string, entitlement: string): Promise<number | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.remaining', customer, entitlement)) as number | null;
    }


    /**
     * Get the current meter value for a customer's entitlement.
     * Will always be in the units of the credit associated with this entitlement.
     */
    async value(customer: string, entitlement: string): Promise<number | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.value', customer, entitlement)) as number | null;
    }


    /**
     * Get the cost for a standard increment on an entitlement (if set on its limit).
     */
    async cost(id: string, entitlement: string): Promise<number | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.cost', id, entitlement)) as number | null;
    }

    
    /**
     * Try changing the value of a metered entitlement using a standard increment (defined in the Limit).
     * This is the same as using "meter" with the "cost" of a standard increment for this entitlement.
     * Returns true if changed and the limit was not hit, otherwise false and App.meter_limit lib func will be called (if present).
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async increment(customer: string, entitlement: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.increment', customer, entitlement)) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async deincrement(customer: string, entitlement: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.deincrement', customer, entitlement)) as boolean;
    }


    /**
     * Allow changing this entitlement by "value" for this customer?
     * A boolean entitlement check if value is 0 or a limit does not exist for the entitlement (bool flag).
     * Changes a meter for this customer if true.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async allow(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.allow', customer, entitlement, value)) as boolean;
    }


    /**
     * Would an "allow" call work for this entitlement and value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async check(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.check', customer, entitlement, value)) as boolean;
    }
}
