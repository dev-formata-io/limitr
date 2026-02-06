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

import { LitElement, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import type { Limitr } from '@formata/limitr';
import { nanoid } from 'nanoid';


/**
 * Limitr LitElement base class.
 */
export class LimitrElement extends LitElement {
    @property({ type: Object })
    policy!: Limitr;

    @property()
    customerId: string = '';

    @property()
    stripePortalUrl: string = '';

    @property({ type: Boolean })
    requestStripePortalUrl: boolean = false;

    @property({ type: Boolean })
    requestStripeInvoices: boolean = false;

    /** Unique ID for making sure this UI component is updated with events. */
    protected policyHandlerId: string = nanoid(14);
    
    /** Track if we've requested portal URL */
    private stripePortalRequested: boolean = false;
    
    /** Track if we've requested invoices */
    private invoicesRequested: boolean = false;


    /**
     * Updated.
     */
    override async updated(changedProperties: PropertyValues) {
        super.updated(changedProperties);

        if (changedProperties.has('policy')) {
            const oldPolicy = changedProperties.get('policy');
            if (oldPolicy) oldPolicy.removeHandler(this.policyHandlerId);
            if (this.policy) {
                this.policy.addHandler(this.policyHandlerId, (key: string, _value: unknown) => {
                    if (key.includes('internal')) this.requestUpdate();
                });
            }
        }
        
        // Request Stripe portal URL once when policy and customerId are available
        if (this.policy && this.customerId && this.requestStripePortalUrl && !this.stripePortalRequested && !this.stripePortalUrl) {
            // Make sure customer is loaded first
            const customer = await this.customer();
            if (customer && customer.id) {
                this.stripePortalRequested = true;

                // Set up one-time listener for the portal URL
                const portalUrlPromise = new Promise<string>((resolve) => {
                    const listenerId = 'portal-url-' + Math.random();
                    const timeoutId = setTimeout(() => {
                        this.policy.removeHandler(listenerId);
                        resolve(''); // timeout, return empty
                    }, 5000);
                    
                    this.policy.addHandler(listenerId, (key: string, json: unknown) => {
                        if (key.includes('internal-customer-updated')) {
                            const jsonCustomer = JSON.parse(json as string);
                            if (jsonCustomer.id === this.customerId && jsonCustomer.metadata && !!jsonCustomer.metadata.stripe_customer_portal_session_url) {
                                clearTimeout(timeoutId);
                                this.policy.removeHandler(listenerId);
                                resolve(jsonCustomer.metadata.stripe_customer_portal_session_url as string);
                            }
                        }
                    });
                });
                
                // Send request
                await this.policy.wsSend(JSON.stringify({
                    type: 'customer-stripe-portal',
                    id: this.customerId,
                    return_url: globalThis.location.href,
                }));
                
                // Wait for response
                this.stripePortalUrl = await portalUrlPromise;
            }
        }
        
        // Request invoices once when policy and customerId are available
        if (this.policy && this.customerId && this.requestStripeInvoices && !this.invoicesRequested) {
            this.invoicesRequested = true;
            await this.policy.wsSend(JSON.stringify({
                type: 'customer-invoices',
                id: this.customerId
            }));
        }
    }


    /**
     * Disconnected callback.
     */
    override disconnectedCallback(): void {
        super.disconnectedCallback();
        if (this.policy) {
            this.policy.removeHandler(this.policyHandlerId);
        }
    }


    /**
     * Get limitr policy as a JS object record (Record<string, unknown> as any).
     * This includes credits, plans, etc. defined in the policy,
     * and is all of the policy information needed for Limitr UI components.
     */
    //deno-lint-ignore no-explicit-any
    get record(): any {
        return this.policy ? this.policy.doc.record() : { policy: {} };
    }


    /**
     * Get policy record as a JS object record (Record<string, unknown> as any).
     * This object contains two fields we actually care about: credits: Record<string, unknown> and plans: Record<string, unknown>.
     */
    //deno-lint-ignore no-explicit-any
    get policyRecord(): any {
        const record = this.record;
        return record.policy ? record.policy : {};
    }


    /**
     * Get credits record as a JS object record (Record<string, unknown> as any).
     * Inside this object are credits (credit name is field name, credit object as value).
     * These credits will be referenced by our UI anytime usage needs to be displayed for this customer,
     * or anytime credits/units are referenced within a plan entitlement limit.
     * Each credit object has a unit (e.g., credit, token, seat, etc.), a description, a label (human facing string), and a stof_units field (e.g., 'float', 'int', 'GB', 'MiB', 'seconds', etc.).
     */
    //deno-lint-ignore no-explicit-any
    get creditsRecord(): any {
        const policy = this.policyRecord;
        return policy.credits ? policy.credits : {};
    }


    /**
     * Get plans record as a JS object record (Record<string, unknown> as any).
     * Inside this object are all of the plans offered for this customer (plan name is the key, plan object is the value).
     * Some plans may have a "hidden" boolean field, if this is present and true, the plan should not be displayed nor considered for selection by the customer.
     * Each plan will have a label (human facing string),an optional price object (with an id, amount, prefix string, and suffix string),
     * and an entitlements object. Inside the entitlement object, each key will be an entitlement name, and the value will be an entitlement object.
     * Each entitlement object will have an enabled boolean field, a description string, an optional scope string, and an optional limit object.
     * If a limit is defined on the entitlement, it will contain a credit id (string that references a credit by name), a mode string (hard, soft, or observe),
     * a value (string or number representing the limit max value), an optional increment value (string or number for how much a meter for this entitlement should change per increment),
     * a resets boolean field (does a meter for this limit reset periodically), and a reset_inc field (ms after a meter starts for it to reset). 
     */
    //deno-lint-ignore no-explicit-any
    get plansRecord(): any {
        const policy = this.policyRecord;
        return policy.plans ? policy.plans : {};
    }


    /**
     * Get the current customer record directly as a JS object record (Record<string, unknown> as any).
     * This represents the current customer & state of the customer we are currently working with within this policy.
     * Each customer will have a string (primary) "id" field, a plan string field (referencing the current customer's plan by name ex plansRecord[customer.plan]),
     * an alt_ids array with additional unique string IDs that can be used to reference this customer (might include this.customerId) within the Limitr policy,
     * a refs array with additional string IDs of other linked customers in the Limitr policy (if a plan is missing on this.customer(), need to look through these refs for which plan to use),
     * a type string field (what type of customer is this e.g., user, org, workspace, etc. - if an entitlement scope is set, it must correlate to this type per user),
     * a label string field (human facing label for the customer, like a display name), a meters object with all current usage information for this customer,
     * an overrides object with all current limit overrides if any (each key references an entitlement key/name, and value is a limit that overrides the entitlement limit object with an
     * optional override_expires_on timestamp/ms since epoch to ignore override after), and finally, a metadata object. This metadata object is a catch all for subscription info, etc.
     */
    //deno-lint-ignore no-explicit-any
    async customer(id: string = this.customerId): Promise<any> {
        return this.policy && id ? await this.policy.customer(id) ?? {} : {};
    }


    /**
     * Get visible plans (excluding hidden ones)
     */
    // deno-lint-ignore no-explicit-any
    get visiblePlans(): any[] {
        const plans = this.plansRecord;
        return Object.entries(plans)
            //deno-lint-ignore no-explicit-any
            .filter(([_, plan]: [string, any]) => !plan.hidden)
            //deno-lint-ignore no-explicit-any
            .map(([name, plan]: [string, any]) => ({ name, ...plan }));
    }


    /**
     * Get a specific plan by name
     */
    // deno-lint-ignore no-explicit-any
    getPlan(planName: string): any {
        return this.plansRecord[planName] || null;
    }


    /**
     * Get a specific credit by name
     */
    // deno-lint-ignore no-explicit-any
    getCredit(creditName: string): any {
        return this.creditsRecord[creditName] || null;
    }


    /**
     * Get customer's current plan object (resolves through refs if needed)
     */
    // deno-lint-ignore no-explicit-any
    async getCustomerPlan(): Promise<any> {
        const customer = await this.customer();
        if (!customer.id) return null;
        
        // Check if customer has a direct plan
        if (customer.plan) {
            const plan = this.getPlan(customer.plan);
            if (plan) {
                plan.name = customer.plan;
                return plan;
            }
        }
        
        // Check refs for a plan
        if (customer.refs && customer.refs.length > 0) {
            for (const refId of customer.refs) {
                const refCustomer = await this.customer(refId);
                if (refCustomer.plan) {
                    const plan = this.getPlan(refCustomer.plan);
                    if (plan) {
                        plan.name = refCustomer.plan;
                        return plan;
                    }
                }
            }
        }
        
        return null;
    }
    

    /**
     * Get effective limit for an entitlement (considering overrides)
     */
    // deno-lint-ignore no-explicit-any
    async getEntitlementLimit(entitlementName: string): Promise<any> {
        const customer = await this.customer();
        
        // Check for override first
        if (customer.overrides && customer.overrides[entitlementName]) {
            const override = customer.overrides[entitlementName];
            
            // Check if override has expired
            if (override.override_expires_on) {
                const now = Date.now();
                if (now > override.override_expires_on) {
                    // Override expired, fall through to plan limit
                } else {
                    return override;
                }
            } else {
                return override;
            }
        }
        
        // Get plan entitlement limit
        const plan = await this.getCustomerPlan();
        if (plan && plan.entitlements && plan.entitlements[entitlementName]) {
            return plan.entitlements[entitlementName].limit || null;
        }
        
        return null;
    }
}
