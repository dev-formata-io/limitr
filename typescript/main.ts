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

import { StofDoc, initStof, isStofInitialized } from "@formata/stof";
import { limitrApi } from "./limitr.js";
import { LimitrGate, waitOnOpen } from "./gate.js";


/**
 * Cloud init options.
 */
export interface LimitrCloudInit {
    /** Limitr Cloud API token. */
    token: string;

    /** Policy ID - leave undefined (or "active") for continuous updates. */
    policy?: string;

    /** Alternate WebSocket address. */
    wsAddress?: string;

    /** Alternate auth ticket address. */
    ticketAddress?: string;

    /** Connect timeout (waits 5s by default). */
    connectTimeout?: number;

    /** When disconnected/failure mode, deny "allow" checks to preserve distributed state? */
    denyUnconnected?: boolean;

    /** Validate the cloud policy once loaded (recommended and on by default)? */
    validate?: boolean;
}


/**
 * Internal event handler type.
 */
export type LimitrEventHandler = (key: string, value: unknown)=>void;


/**
 * Limitr monetization policy.
 */
export class Limitr {
    /** StofDoc. */
    doc: StofDoc;

    /** Gate. */
    protected gate: LimitrGate = new LimitrGate();

    /** Deny allows if cloud connection interrupted (recommended)? */
    denyUnconnected: boolean = true;
    protected ws?: WebSocket;
    protected wsInit: boolean = false;
    protected wsTimeout?: ReturnType<typeof setTimeout>;

    /** Optional named event handlers for all Limitr events. */
    protected eventHandlers: Map<string, LimitrEventHandler> = new Map();


    /**
     * Constructor.
     * Make sure StofDoc.initialize() has been called for Stof first.
     */
    constructor(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof') {
        if (!isStofInitialized()) {
            console.warn('Warning: Limitr created before Stof initialization. Call await initStof() or use Limitr.new() instead.');
        }
        this.doc = new StofDoc();
        this.doc.parse(limitrApi, 'bstf');
        this.doc.parse(policy, format);
    }


    /**
     * Add an event handler by name to this Limitr policy.
     */
    addHandler(name: string, handler: LimitrEventHandler) {
        this.eventHandlers.set(name, handler);
        this.doc.lib('App', 'event_handler', (key: string, value: unknown) => {
            for (const [_, handler] of this.eventHandlers) handler(key, value);
        });
    }


    /**
     * Remove an event handler by name.
     */
    removeHandler(name: string): boolean {
        return this.eventHandlers.delete(name);
    }


    /**
     * Clear event handlers.
     */
    clearHandlers() {
        this.eventHandlers = new Map();
    }


    /**
     * Async constructor that ensures Stof wasm initialization.
     */
    static async new(policy: string | Record<string, unknown> | Uint8Array = 'Limitr policy: {}', format: string = 'stof', validate: boolean = true): Promise<Limitr> {
        await initStof();
        const limitr = new Limitr(policy, format);
        if (validate) {
            const [valid, error] = await limitr.valid();
            if (!valid) throw new Error(error);
        }
        return limitr;
    }


    /**
     * Call a specific Stof function in this doc by path/name through the gate.
     * For complex use-cases, create your own StofDoc.
     */
    async docCall(path: string, ...args: unknown[]): Promise<unknown> {
        return await this.gate.run(() => this.doc.call(path, ...args));
    }


    /**
     * Is this policy valid?
     * @returns Whether this policy is valid and if not, what the current error is as a string.
     */
    async valid(): Promise<[boolean, string]> {
        const valid = await this.gate.run(() => this.doc.call('<Limitr>.api.valid')) as boolean;
        if (valid) return [true, ''];
        const error = this.doc.get('<LimitrValidation>.error_message') as string;
        return [false, error];
    }


    /**
     * Difference between this policy and another.
     * This policy is treated as the schema for the diff operation.
     */
    async difference(other: Limitr, symmetric: boolean = false): Promise<Record<string, unknown>> {
        const bstf = await other.docCall('<Limitr>.api.policy_bstf') as Uint8Array;
        const json = await this.gate.run(() => this.doc.call('<Limitr>.api.difference_bstf', bstf, symmetric)) as string;
        return JSON.parse(json);
    }


    /*****************************************************************************
     * Plans API.
     *****************************************************************************/

    /**
     * Get a plan record by ID (plan ID or customer ID).
     */
    async plan(id: string, def: boolean = true): Promise<Record<string, unknown> | undefined> {
        const planNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan', id, def));
        if (typeof planNode === 'string') return this.doc.record(planNode);
        return undefined;
    }


    /**
     * Get the default plan if any.
     */
    async defaultPlan(): Promise<Record<string, unknown> | undefined> {
        const planNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.default_plan'));
        if (typeof planNode === 'string') return this.doc.record(planNode);
        return undefined;
    }


    /**
     * Get a plan price by ID (plan ID or customer ID).
     */
    async planPrice(id: string): Promise<Record<string, unknown> | undefined> {
        const priceNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan_price', id));
        if (typeof priceNode === 'string') return this.doc.record(priceNode);
        return undefined;
    }


    /**
     * Get a plan price ID.
     */
    async planPriceId(id: string): Promise<string | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan_price_id', id)) as string | null;
    }


    /**
     * Get a plan amount.
     */
    async planAmount(id: string): Promise<number | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan_amount', id)) as number | null;
    }


    /**
     * Get a plan price label.
     */
    async planPriceLabel(id: string): Promise<string | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.plan_price_label', id)) as string | null;
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
     * Get a customer metadata object (if any).
     */
    async customerMetadata(id: string): Promise<Record<string, unknown> | undefined> {
        const metaNode = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer_metadata', id));
        if (typeof metaNode === 'string') return this.doc.record(metaNode);
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
     * Get the customer reference IDs for a customer.
     */
    async customerRefs(id: string): Promise<string[] | null> {
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer_refs', id)) as string[] | null;
    }


    /**
     * Set/change a customer's plan by plan ID.
     * Returns true if the plan has changed (and emits customer-set & customer-plan-changed events).
     */
    async setCustomerPlan(id: string, plan: string, overwrite_meters: boolean = true): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer_plan', id, plan, overwrite_meters)) as boolean;
    }


    /**
     * Ensure that a customer exists, creating one if necessary.
     * This takes the cloud into consideration as well.
     * NOTE: Returns true if a new customer was created (one will always exist after this).
     */
    async ensureCustomer(id: string, plan: string = '', type: string = 'user', label: string = 'User', refs: string[] | null = null, alts: string[] | null = null, metadata: string | Record<string, unknown> | null = null): Promise<boolean> {
        const existing = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', id));
        if (existing) return false;
        if (this.ws) {
            switch (this.ws.readyState) {
                case WebSocket.OPEN: {
                    if (await this.addCloudCustomer(id)) return false;
                    break;
                }
                case WebSocket.CONNECTING: {
                    await waitOnOpen(this.ws);
                    if (await this.addCloudCustomer(id)) return false;
                    break;
                }
                case WebSocket.CLOSING:
                case WebSocket.CLOSED: {
                    if (this.denyUnconnected) return false;
                    break;
                }
            }
        }
        let meta: string | null = null;
        if (typeof metadata === 'string') meta = metadata;
        else if (metadata) meta = JSON.stringify(metadata);
        await this.gate.run(() => this.doc.call('<Limitr>.api.create_customer', id, plan, type, label, refs, alts, meta));
        return true;
    }

    
    /**
     * Create a new customer and add to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     * Note: prefer ensureCustomer API in case this customer already exists.
     */
    async createCustomer(id: string, plan: string = '', type: string = 'user', label: string = 'User', refs: string[] | null = null, alts: string[] | null = null, metadata: string | Record<string, unknown> | null = null) {
        let meta: string | null = null;
        if (typeof metadata === 'string') meta = metadata;
        else if (metadata) meta = JSON.stringify(metadata);
        await this.gate.run(() => this.doc.call('<Limitr>.api.create_customer', id, plan, type, label, refs, alts, meta));
    }


    /**
     * Ensure that a customer exists, creating one by record if necessary.
     * This takes the cloud into consideration as well.
     * Returns true if a new customer was created.
     */
    async ensureSetCustomer(customer: string | Record<string, unknown>, event: boolean = true): Promise<boolean> {
        const record = typeof customer === 'string' ? JSON.parse(customer) : customer;
        const id = record.id as string;
        if (!id) throw new Error('Ensure setting a customer expects a customer record with an ID');

        const existing = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', id));
        if (existing) return false;
        if (this.ws) {
            switch (this.ws.readyState) {
                case WebSocket.OPEN: {
                    if (await this.addCloudCustomer(id)) return false;
                    break;
                }
                case WebSocket.CONNECTING: {
                    await waitOnOpen(this.ws);
                    if (await this.addCloudCustomer(id)) return false;
                    break;
                }
                case WebSocket.CLOSING:
                case WebSocket.CLOSED: {
                    if (this.denyUnconnected) return false;
                    break;
                }
            }
        }
        const res = await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer', JSON.stringify(record), event)) as string | null;
        return !!res;
    }


    /**
     * Set a customer on this policy by ID.
     * Returns a node ID to the resulting Customer.
     */
    async setCustomer(customer: string | Record<string, unknown>, event: boolean = true): Promise<string | null> {
        const customerStof = typeof customer === 'string' ? customer : JSON.stringify(customer);
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_customer', customerStof, event)) as string | null;
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
    async addAltID(existing: string, alt: string, event: boolean = true): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.set_alt_customer_id', existing, alt, event)) as boolean;
    }


    /**
     * Remove an alternative customer ID from an existing customer.
     */
    async removeAltID(alt: string, event: boolean = true): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.delete_alt_customer_id', alt, event)) as boolean;
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


    /**
     * Apply a plan topup to a customer.
     * Creates a credit grant with a topup/one-time-purchase if found on this customer's current plan.
     */
    async applyCustomerTopup(id: string, topup: string): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.apply_customer_topup', id, topup)) as boolean;
    }


    /**
     * Create a customer credit grant (recommended use in top-ups & one-time purchases).
     * Grants are applied when overage would occur (soft entitlement limits).
     * Defaults to a one-time, fixed-value credit grant.
     * More than one grant with the same "credit" can exist alongside one another.
     * Do not sync grants up with plans - if a plan includes a credit grant, just set a soft limit value (same thing).
     *
     * Ex. a soft limit of 5k tokens + a grant of 2k tokens would result in the customer
     * getting overage events (meter-overage) after 7k tokens spent.
     *
     * @returns true when the customer & credit exists, meaning the grant has been applied.
     */
    async createCustomerCreditGrant(id: string, credit: string, value: number | string, resets: boolean = false, reset_inc?: number | string, expires_on?: number, event: boolean = true): Promise<boolean> {
        return await this.gate.run(() => this.doc.call('<Limitr>.api.create_customer_credit_grant', id, credit, value, resets, reset_inc ?? null, expires_on ?? null, event)) as boolean;
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
        if (!await this.cloudPreCheckContinue(customer)) return null;
        return await this.gate.run(() => this.doc.sync_call('<Limitr>.api.remaining', customer, entitlement)) as number | null;
    }


    /**
     * Get the current meter value for a customer's entitlement.
     * Will always be in the units of the credit associated with this entitlement.
     */
    async value(customer: string, entitlement: string): Promise<number | null> {
        if (!await this.cloudPreCheckContinue(customer)) return null;
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
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.increment', customer, entitlement)) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async decrement(customer: string, entitlement: string): Promise<boolean> {
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.decrement', customer, entitlement)) as boolean;
    }


    /**
     * Allow changing this entitlement by "value" for this customer?
     * A boolean entitlement check if value is 0 or a limit does not exist for the entitlement (bool flag).
     * Changes a meter for this customer if true.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async allow(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.allow', customer, entitlement, value)) as boolean;
    }


    /**
     * Would a "check" call work for this entitlement and increment value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     */
    async checkIncrement(customer: string, entitlement: string): Promise<boolean> {
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.check_increment', customer, entitlement)) as boolean;
    }


    /**
     * Would a "check" call work for this entitlement and decrement value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     */
    async checkDecrement(customer: string, entitlement: string): Promise<boolean> {
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.check_decrement', customer, entitlement)) as boolean;
    }


    /**
     * Would an "allow" call work for this entitlement and value on this customer?
     * Does not change a meter (charge usage) for this customer, just checks if it would work.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async check(customer: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        if (!await this.cloudPreCheckContinue(customer)) return false;
        return await this.gate.run(() => this.doc.call('<Limitr>.api.check', customer, entitlement, value)) as boolean;
    }


    /**
     * Set a customer's meter value for an entitlement using 'allow(value - current)'.
     * For accumulating usage, use 'allow' or 'increment'.
     */
    async set(customer: string, entitlement: string, value: number): Promise<boolean> {
        const current = await this.value(customer, entitlement);
        if (current !== null) return await this.allow(customer, entitlement, value - current);
        return false;
    }


    /**
     * Increment modify helper.
     * @param meter Should we change customer meter values or just check if they could be changed (if false)?
     * @param up Are we incrementing or decrementing the value (if false)?
     */
    async incrementModify(customer: string, entitlement: string, meter: boolean, up: boolean): Promise<boolean> {
        return meter
            ? (up ? await this.increment(customer, entitlement) : await this.decrement(customer, entitlement))
            : (up ? await this.checkIncrement(customer, entitlement) : await this.checkDecrement(customer, entitlement));
    }


    /*****************************************************************************
     * Limitr Cloud.
     *****************************************************************************/
    
    /**
     * Initialize with cloud.limitr.dev.
     *
     * @param token API token.
     * @param address (optional) Server URL.
     * @param policy (optional) Policy ID or "active" for the active policy.
     * @param connectTimeout (optional) Time to wait when establishing an initial connection (ms).
     */
    static async cloud(options: LimitrCloudInit | string): Promise<Limitr | undefined> {
        const token = typeof options === 'string' ? options : options.token;
        if (token.length < 1) return undefined;

        const policy = typeof options === 'string' ? 'active' : options.policy ?? 'active';
        const address = typeof options === 'string' ? 'wss://api.limitr.dev' : options.wsAddress ?? 'wss://api.limitr.dev';
        const ticketAddress = typeof options === 'string' ? 'https://api.limitr.dev' : options.ticketAddress ?? 'https://api.limitr.dev';
        const timeout = typeof options === 'string' ? 5000 : options.connectTimeout ?? 5000;
        const denyUnconnected = typeof options === 'string' ? true : options.denyUnconnected ?? true;
        const validate = typeof options === 'string' ? true : options.validate ?? true;

        const response = await fetch(ticketAddress + '/wss/ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (!response.ok) return undefined;
        const { ticket } = await response.json();
        const ws = new WebSocket(address + '/wss?ticket=' + ticket);
        ws.binaryType = 'arraybuffer';
        const waitOpen = waitOnOpen(ws);

        const limitr = await Limitr.new();
        limitr.denyUnconnected = denyUnconnected;
        const awaitInit = async () => {
            await new Promise<boolean>((resolve, reject) => {
                const intervalMs = 50;
                const start = Date.now();
                const poll = () => {
                    if (limitr.wsInit) {
                        resolve(true);
                        return;
                    }
                    if (Date.now() - start > timeout) {
                        reject(new Error(`wait for WebSocket policy init timed out`));
                        return;
                    }
                    setTimeout(poll, intervalMs);
                };
                poll();
            });
        };
        const reconnect = async () => {
            const response = await fetch(ticketAddress + '/wss/ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            if (response.ok) {
                const { ticket } = await response.json();
                const ws = new WebSocket(address + '/wss?ticket=' + ticket);
                ws.binaryType = 'arraybuffer';
                
                limitr.ws = ws;
                limitr.ws.onclose = reconnect;
                limitr.ws.onmessage = (m)=>limitr.cloudMessageReceived(m);
                await waitOnOpen(ws);
            }
        };
        limitr.ws = ws;
        limitr.ws.onclose = reconnect;
        limitr.ws.onmessage = (m)=>limitr.cloudMessageReceived(m);
        await waitOpen;

        limitr.ws.send(JSON.stringify({ type: 'policy', id: policy, format: 'bstf' }));
        await awaitInit();
        if (validate) {
            const [valid, error] = await limitr.valid();
            if (!valid) throw new Error(error);
        }

        const ping = async () => {
            if (!limitr.ws || limitr.ws.readyState === WebSocket.CLOSED || limitr.ws.readyState === WebSocket.CLOSING) {
                await reconnect();
            } else if (limitr.ws.readyState === WebSocket.OPEN) {
                if (limitr._dataSendQueue.length > 0) {
                    for (const data of limitr._dataSendQueue) limitr.ws.send(data);
                    limitr._dataSendQueue = [];
                }
                limitr.ws.send('ping');
            }
            limitr.wsTimeout = setTimeout(ping, 20000);
        };
        limitr.wsTimeout = setTimeout(ping, 20000);
        if (limitr._dataSendQueue.length > 0 && limitr.ws.readyState === WebSocket.OPEN) {
            for (const data of limitr._dataSendQueue) limitr.ws.send(data);
            limitr._dataSendQueue = [];
        }
        return limitr;
    }


    /**
     * Add a customer from Limitr Cloud if not already local.
     *
     * This is also the API for vouchers, which enable inter-product transactions between
     * any services that use Limitr. Ex. Limitr user A creates a voucher that allows Limitr
     * products B, C, & D to charge user A a max of $0.5 of usage in total amongst all of them
     * only for the next 15 minutes. User A never pays B, C, or D, just sends a voucher and pays Limitr
     * for overage. Then Limitr shares revenue with B, C, & D accordingly with no additional Cloud setup.
     * All Limitr features work across services (discounts, markups, promotions, etc.) just like normal.
     * No API key management, single line of code to implement, always transparent & traceable.
     * Requires an appropriate Limitr plan - reach out if interested!
     *
     * @param id The customer ID (or alternative ID) to add from Limitr Cloud.
     * @param timeout The max amount of time to wait for the customer to arrive locally.
     * @param voucher Creates a proxy customer on this product on the voucher issuer's behalf.
     * @returns true if the customer exists and is ready to interact with.
     */
    async addCloudCustomer(id: string, timeout: number = 3000, voucher?: string): Promise<boolean> {
        if (voucher) {
            // remove local customer for re-auth via voucher every time
            await this.gate.run(() => this.doc.call('<Limitr>.api.delete_customer', id));
        } else {
            const existing = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', id));
            if (existing) return true;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        this._deniedCloudCustomers.delete(id);
        if (voucher) {
            this.ws.send(JSON.stringify({ type: 'ensure-voucher-customer', id, code: voucher }));
        } else {
            this.ws.send(JSON.stringify({ type: 'customer', id }));
        }
        
        return new Promise<boolean>((resolve) => {
            const intervalMs = 50;
            const start = Date.now();
            const poll = async () => {
                if (await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', id))) {
                    resolve(true);
                    return;
                }
                if (this._deniedCloudCustomers.has(id)) {
                    this._deniedCloudCustomers.delete(id);
                    resolve(false);
                    return;
                }
                if (Date.now() - start > timeout) {
                    resolve(false);
                    return;
                }
                setTimeout(poll, intervalMs);
            };
            poll();
        });
    }


    /**
     * Cloud pre-check.
     */
    protected async cloudPreCheckContinue(customer: string): Promise<boolean> {
        if (this.ws) {
            switch (this.ws.readyState) {
                case WebSocket.OPEN: {
                    const existing = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', customer));
                    if (!existing) return await this.addCloudCustomer(customer);
                    break;
                }
                case WebSocket.CONNECTING: {
                    await waitOnOpen(this.ws);
                    const existing = await this.gate.run(() => this.doc.sync_call('<Limitr>.api.customer', customer));
                    if (!existing) return await this.addCloudCustomer(customer);
                    break;
                }
                case WebSocket.CLOSING:
                case WebSocket.CLOSED: {
                    if (this.denyUnconnected) return false;
                    break;
                }
            }
        }
        return true;
    }


    /**
     * Close connection to Limitr Cloud.
     */
    async close() {
        const unsent = [];
        for (const [_, { timeoutHandle, data }] of this._debouncedSendMap) {
            clearTimeout(timeoutHandle);
            unsent.push(data);
        }
        this._debouncedSendMap = new Map();
        
        const handles = [];
        for (const data of unsent) handles.push(this.wsSend(data));
        await Promise.allSettled(handles);

        if (this.wsTimeout) clearTimeout(this.wsTimeout);
        this.wsInit = false;
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
            this.ws.onclose = () => {}; // clear any auto re-connect behavior
            this.ws.close();
        }
    }


    /**
     * Debounce send on cloud WebSocket.
     */
    private _debouncedSendMap: Map<string, { timeoutHandle: ReturnType<typeof setTimeout>, data: string }> = new Map();
    wsSendDebounced(id: string, data: string, debounceMs: number = 500) {
        const existing = this._debouncedSendMap.get(id);
        if (existing) {
            clearTimeout(existing.timeoutHandle);
        }

        const timeoutHandle = setTimeout(() => {
            this._debouncedSendMap.delete(id);
            this.wsSend(data);
        }, debounceMs);

        this._debouncedSendMap.set(id, { timeoutHandle, data });
    }


    /**
     * Send on the cloud WebSocket if enabled.
     */
    private _dataSendQueue: string[] = [];
    async wsSend(data: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (this._dataSendQueue.length > 0) {
                for (const data of this._dataSendQueue) this.ws.send(data);
                this._dataSendQueue = [];
            }
            this.ws.send(data);
        } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            await waitOnOpen(this.ws);
            if (this._dataSendQueue.length > 0) {
                for (const data of this._dataSendQueue) this.ws.send(data);
                this._dataSendQueue = [];
            }
            this.ws.send(data);
        } else {
            this._dataSendQueue.push(data);
        }
    }


    /**
     * Cloud message received.
     */
    private _deniedCloudCustomers: Set<string> = new Set();
    //deno-lint-ignore no-explicit-any
    protected async cloudMessageReceived(message: MessageEvent<any>) {
        const data = message.data;
        if (typeof data === 'string') {
            if (data === 'pong' || data === 'ping') return;
            try {
                const record = JSON.parse(data);
                if (record.type === 'topup-purchase-failed') {
                    for (const [_, handler] of this.eventHandlers) handler('topup-purchase-failed', record);
                } else if (!!record.error && !!record.id) {
                    if (record.type === 'customer') {
                        this._deniedCloudCustomers.add(record.id);
                    }
                } else if (!!record.policy && !!record.policy.plans) {
                    await this.gate.run(() => this.doc.sync_call('<Limitr>.api.update_policy_internals', data, 'json'));
                } else if (record.type === 'customer-invoices' && !!record.data.invoices && !!record.id) {
                    await this.gate.run(() => this.doc.sync_call('<Limitr>.api.update_customer_invoices', data, 'json'));
                } else if (!!record.type && !!record.id) {
                    await this.gate.run(() => this.doc.sync_call('<Limitr>.api.update_customer_internals', data, 'json'));
                }
            } catch {
                // nada..
            }
        } else {
            try {
                let buffer: Uint8Array;
                if (data instanceof ArrayBuffer) {
                    buffer = new Uint8Array(data);
                } else if (data instanceof Blob) {
                    buffer = new Uint8Array(await data.arrayBuffer());
                } else {
                    return; // unknown binary type
                }

                await this.gate.run(() => {
                    this.doc = new StofDoc();
                    this.doc.parse(buffer, 'bstf');
                    
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
                        const headerMap = new Map();
                        response.headers.forEach((value, key) => headerMap.set(key, value));
                        result.set('headers', headerMap);
                        result.set('content_type', response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? 'text/plain');
                        result.set('bytes', await response.bytes());
                        return result;
                    }, true);
                    this.doc.lib('CloudWS', 'send', (data: string) => {
                        this.wsSend(data);
                    });
                    this.doc.lib('CloudWS', 'send_debounced', (id: string, data: string, debounceMs: number) => {
                        this.wsSendDebounced(id, data, debounceMs);
                    });
                    if (this.eventHandlers.size > 0) {
                        this.doc.lib('App', 'event_handler', (key: string, value: unknown) => {
                            for (const [_, handler] of this.eventHandlers) handler(key, value);
                        });
                    }
                    this.wsInit = true;
                });
            } catch (e) {
                console.error('Error initializing Limitr Policy from BSTF: ', e);
            }
        }
    }
}
