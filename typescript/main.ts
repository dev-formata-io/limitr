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
import { LimitrGate } from "./gate.ts";


/**
 * Cloud init options.
 */
export interface LimitrCloudInit {
    token: string;
    policy?: string;
    address?: string;
}


/**
 * Limitr monetization policy.
 */
export class Limitr {
    /** StofDoc. */
    doc: StofDoc;

    /** Gate. */
    protected gate: LimitrGate = new LimitrGate();

    /** WebSocket cloud connection. */
    protected ws?: WebSocket;


    /**
     * Constructor.
     * Make sure StofDoc.initialize() has been called for Stof first.
     */
    constructor(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof') {
        this.doc = new StofDoc();
        this.doc.parse(limitrApi, 'bstf');
        this.doc.parse(policy, format);
    }


    /**
     * Async constructor that ensures Stof wasm initialization.
     */
    static async new(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof'): Promise<Limitr> {
        await StofDoc.initialize();
        return new Limitr(policy, format);
    }


    /*****************************************************************************
     * Limitr Cloud.
     *****************************************************************************/
    
    /**
     * Initialize with cloud.limitr.dev.
     *
     * @param token API token to use with cloud.limiter.dev.
     * @param address Server URL.
     * @param policy Policy ID or "active" for the active policy.
     */
    static async cloud(options: LimitrCloudInit | string): Promise<Limitr | undefined> {
        const token = typeof options === 'string' ? options : options.token;
        if (token.length < 1) return undefined;

        const policy = typeof options === 'string' ? 'active' : options.policy ?? 'active';
        const address = typeof options === 'string' ? 'wss://api.limitr.dev' : options.address ?? 'wss://api.limitr.dev';
        const ws = new WebSocket(address + '/wss', { headers: { 'Authorization': `Bearer ${token}` }});

        const limitr = await Limitr.new();
        limitr.addCloudLib();
        limitr.ws = ws;
        limitr.ws.onmessage = (m)=>limitr.cloudMessageReceived(m);
        limitr.ws.send(JSON.stringify({ type: 'policy', id: policy, format: 'bstf' }));
        setTimeout(()=>limitr.cloudPing(address, token), 20000);
        return limitr;
    }


    /**
     * Start cloud WebSocket ping & reconnect loop.
     */
    protected cloudPing(address: string, token: string) {
        if (this.ws) this.ws.send('ping');
        else {
            const ws = new WebSocket(address + '/wss', { headers: { 'Authorization': `Bearer ${token}` }});
            this.ws = ws;
            this.ws.onmessage = (m)=>this.cloudMessageReceived(m);
        }
        setTimeout(()=>this.cloudPing(address, token), 20000);
    }


    /**
     * Add cloud doc library to Stof doc.
     */
    protected addCloudLib() {
        // async Http.fetch
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

        // CloudWS.send
        this.doc.lib('CloudWS', 'send', (data: string) => {
            if (this.ws) this.ws.send(data);
        });
    }


    /**
     * Cloud message received.
     */
    //deno-lint-ignore no-explicit-any
    protected async cloudMessageReceived(message: MessageEvent<any>) {
        const data = message.data;
        if (typeof data === 'string') {
            if (data === 'pong' || data === 'ping') return;
            try {
                const record = JSON.parse(data);
                if (!!record.policy && !!record.policy.plans) {
                    await this.gate.runFront(() => this.doc.sync_call('<Limitr>.api.update_policy_internals', data, 'json'));
                } else if (record.type === 'user' || record.type === 'org') {
                    await this.gate.runFront(() => this.doc.sync_call('<Limitr>.api.update_customer_internals', data, 'json'));
                }
            } catch {
                // nada..
            }
        } else {
            try {
                const doc = new StofDoc();
                if (doc.parse(data, 'bstf')) this.doc = doc;
            } catch {
                // nada..
            }
        }
    }


    /**
     * Add a customer from the cloud.
     */
    async addCloudCustomer(id: string, timeout: number = 5000): Promise<boolean> {
        const existing = await this.customer(id);
        if (existing || !this.ws) return false;
        await this.gate.runFront(() => this.doc.sync_call('<Limitr>.api.set_customer', `{ id: "${id}", placeholder: true }`, false));
        this.ws.send(JSON.stringify({ type: 'customer', id }));
        return new Promise<boolean>((resolve, reject) => {
            const intervalMs = 50;
            const start = Date.now();
            const poll = async () => {
                const cus = await this.customer(id);
                if (cus && !cus.placeholder) {
                    resolve(true);
                    return;
                }
                if (Date.now() - start > timeout) {
                    reject(new Error(`addCloudCustomer(${id}) timed out`));
                    return;
                }
                setTimeout(poll, intervalMs);
            };
            poll();
        });
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
