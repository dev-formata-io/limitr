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
 * Limitr base class.
 * Note: Any sync_calls on this doc will not work with async TS lib functions (ex. fetch).
 *       This is okay for a lot of calls, especially without HTTP adapters and events, but keep it in mind.
 */
export class Limitr {
    /** StofDoc. */
    doc: StofDoc;


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
                body: string | Uint8Array | null = null,
                headers: Map<string, string> = new Map()): Promise<Map<string, unknown>> => {
                const response = await fetch(url, {
                    method,
                    body: body ?? undefined,
                    headers,
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
     */
    static async cloud(token: string, address: string = 'https://api.limitr.dev', policy: string = 'active'): Promise<Limitr | undefined> {
        const response = await fetch(address + `/v1/limitr/policies/${policy}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.ok) {
            await StofDoc.initialize();
            const bytes = await response.bytes();
            return new Limitr(bytes, 'cloud.limitr.dev');
        }
        return undefined;
    }


    /*****************************************************************************
     * Plans API.
     *****************************************************************************/

    /**
     * Get a plan record by ID (plan ID or customer ID).
     */
    plan(id: string): Record<string, unknown> | undefined {
        const planNode = this.doc.sync_call('<Limitr>.api.plan', id);
        if (typeof planNode === 'string') return this.doc.record(planNode);
        return undefined;
    }
    
    
    /**
     * Set a plan on this policy by name/ID.
     * Returns a node ID to the resulting Plan.
     */
    async setPlan(id: string, planStof: string): Promise<string | null> {
        return await this.doc.call('<Limitr>.api.set_plan', id, planStof) as string | null;
    }


    /**
     * Set a plan on this policy by name/ID.
     * Returns a node ID to the resulting Plan.
     */
    setPlanSync(id: string, planStof: string): string | null {
        return this.doc.sync_call('<Limitr>.api.set_plan', id, planStof) as string | null;
    }


    /**
     * Delete a plan by ID.
     */
    async deletePlan(id: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.delete_plan', id) as boolean;
    }


    /**
     * Delete a plan by ID.
     */
    deletePlanSync(id: string): boolean {
        return this.doc.sync_call('<Limitr>.api.delete_plan', id) as boolean;
    }


    /*****************************************************************************
     * Credits API.
     *****************************************************************************/
    
    /**
     * Get a credit record by ID/type.
     */
    credit(id: string): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.credit', id);
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /**
     * Get a credit record for a specific entitlement.
     * ID can be a plan ID or a customer ID.
     */
    creditFor(id: string, entitlement: string): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.credit_for', id, entitlement);
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /*****************************************************************************
     * Customers API.
     *****************************************************************************/

    /**
     * Get a customer record by ID (or alternative IDs).
     */
    customer(id: string): Record<string, unknown> | undefined {
        const subNode = this.doc.sync_call('<Limitr>.api.customer', id);
        if (typeof subNode === 'string') return this.doc.record(subNode);
        return undefined;
    }


    /**
     * Get all customers as a single record.
     * Customers contain all state information, so this is all that is required to save/load.
     */
    customers(): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.get');
        if (typeof node === 'string') {
            const subs = this.doc.get('customers', node);
            if (typeof subs === 'string') return this.doc.record(subs);
        }
        return undefined;
    }


    /**
     * Get the customer organization customer ID if defined.
     */
    customerOrg(id: string): string | null {
        return this.doc.sync_call('<Limitr>.api.customer_org', id) as string | null;
    }


    /**
     * Set/change a customer's plan ID.
     * Returns true if the plan has changed (and emits a customer-set event).
     */
    async setCustomerPlan(id: string, plan: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.set_customer_plan', id, plan) as boolean;
    }


    /**
     * Set/change a customer's plan ID.
     * Returns true if the plan has changed (and emits a customer-set event).
     */
    setCustomerPlanSync(id: string, plan: string): boolean {
        return this.doc.sync_call('<Limitr>.api.set_customer_plan', id, plan) as boolean;
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
            const cus = await this.doc.call('<Limitr>.api.set_customer', id, json, false) as string | null;
            return cus !== null;
        }
        return false;
    }

    
    /**
     * Add a new customer to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    async addCustomer(id: string, plan: string, type: string = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        await this.doc.call('<Limitr>.api.create_customer', id, plan, type, label, org, alts);
    }


    /**
     * Add a new customer to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    addCustomerSync(id: string, plan: string, type: string = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        this.doc.sync_call('<Limitr>.api.create_customer', id, plan, type, label, org, alts);
    }


    /**
     * Set a customer on this policy by ID.
     * Returns a node ID to the resulting Customer.
     */
    async setCustomer(id: string, customerStof: string): Promise<string | null> {
        return await this.doc.call('<Limitr>.api.set_customer', id, customerStof, true) as string | null;
    }


    /**
     * Set a customer on this policy by ID.
     * Returns a node ID to the resulting Customer.
     */
    setCustomerSync(id: string, customerStof: string): string | null {
        return this.doc.sync_call('<Limitr>.api.set_customer', id, customerStof, true) as string | null;
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
        for (const sub of subs) {
            const id = sub.id;
            if (typeof id === 'string') {
                await this.setCustomer(id, JSON.stringify(sub));
            }
        }
    }


    /**
     * Load many customers as records.
     * This is all that is required for save/load since customers contain all state information.
     */
    loadCustomersSync(customers: Record<string, unknown> | Record<string, unknown>[]) {
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
        for (const sub of subs) {
            const id = sub.id;
            if (typeof id === 'string') {
                this.setCustomerSync(id, JSON.stringify(sub));
            }
        }
    }


    /**
     * Remove a customer by ID.
     */
    async removeCustomer(id: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.delete_customer', id) as boolean;
    }


    /**
     * Remove a customer by ID.
     */
    removeCustomerSync(id: string): boolean {
        return this.doc.sync_call('<Limitr>.api.delete_customer', id) as boolean;
    }


    /**
     * Add an alternative customer ID to an existing customer.
     */
    addAltID(existing: string, alt: string): boolean {
        return this.doc.sync_call('<Limitr>.api.set_alt_customer_id', existing, alt) as boolean;
    }


    /**
     * Remove an alternative customer ID from an existing customer.
     */
    removeAltID(alt: string): boolean {
        return this.doc.sync_call('<Limitr>.api.delete_alt_customer_id', alt) as boolean;
    }


    /*****************************************************************************
     * Entitlements API.
     *****************************************************************************/

    /**
     * Get an entitlement record with a plan ID or customer ID and an entitlement name.
     */
    entitlement(id: string, entitlement: string): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.entitlement', id, entitlement);
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /**
     * Get the limit value for a metered entitlement.
     * ID can be a customer ID or a plan ID (to get the specific entitlement from a plan).
     * Will always be in the units of the credit associated with this entitlement (ex. limit.value = '2GB', credit.stof_units = 'MB', limit = 2000).
     */
    limit(id: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.limit', id, entitlement) as number | null;
    }


    /**
     * Get the remaining balance for a customer's entitlement (limit - current (metered) value).
     * Will always be in the units of the credit associated with this entitlement.
     */
    remaining(customer: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.remaining', customer, entitlement) as number | null;
    }


    /**
     * Get the current meter value for a customer's entitlement.
     * Will always be in the units of the credit associated with this entitlement.
     */
    value(customer: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.value', customer, entitlement) as number | null;
    }


    /**
     * Get the cost for a standard increment on an entitlement (if set on its limit).
     */
    cost(id: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.cost', id, entitlement) as number | null;
    }

    
    /**
     * Try changing the value of a metered entitlement using a standard increment (defined in the Limit).
     * This is the same as using "meter" with the "cost" of a standard increment for this entitlement.
     * Returns true if changed and the limit was not hit, otherwise false and App.meter_limit lib func will be called (if present).
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async increment(customer: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.increment', customer, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement using a standard increment (defined in the Limit).
     * This is the same as using "meter" with the "cost" of a standard increment for this entitlement.
     * Returns true if changed and the limit was not hit, otherwise false and App.meter_limit lib func will be called (if present).
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    incrementSync(customer: string, entitlement: string): boolean {
        return this.doc.sync_call('<Limitr>.api.increment', customer, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async deincrement(customer: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.deincrement', customer, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    deincrementSync(customer: string, entitlement: string): boolean {
        return this.doc.sync_call('<Limitr>.api.deincrement', customer, entitlement) as boolean;
    }


    /**
     * Allow changing this entitlement by "value" for this customer?
     * A boolean entitlement check if value is 0 or a limit does not exist for the entitlement (bool flag).
     * Changes a meter for this customer if true.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async allow(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.allow', customer, entitlement, value) as boolean;
    }


    /**
     * Allow changing this entitlement by "value" for this customer?
     * A boolean entitlement check if value is 0 or a limit does not exist for the entitlement (bool flag).
     * Changes a meter for this customer if true.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     *
     * Note: Sync apis are faster, but any Stof event handlers cannot interact with JS async (ex. fetch).
     * If you're unsure, use the "allow" function instead to be safe.
     */
    allowSync(customer: string, entitlement: string, value: number | string = 0): boolean {
        return this.doc.sync_call('<Limitr>.api.allow', customer, entitlement, value) as boolean;
    }


    /**
     * Would an "allow" call work for this entitlement and value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async check(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.check', customer, entitlement, value) as boolean;
    }


    /**
     * Would an "allow" call work for this entitlement and value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     *
     * Note: Sync apis are faster, but any Stof event handlers cannot interact with JS async (ex. fetch).
     * For check, this should be safe since events are not emitted (just a bool return).
     */
    checkSync(customer: string, entitlement: string, value: number | string = 0): boolean {
        return this.doc.sync_call('<Limitr>.api.check', customer, entitlement, value) as boolean;
    }
}
