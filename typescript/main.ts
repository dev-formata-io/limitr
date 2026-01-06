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
        this.doc.stof.binaryImport(limitrApi, 'bstf', null, 'prod');
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
     * Plans API.
     *****************************************************************************/

    /**
     * Get a plan record by ID (plan ID or subject ID).
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
     * ID can be a plan ID or a subject ID.
     */
    creditFor(id: string, entitlement: string): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.credit_for', id, entitlement);
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /*****************************************************************************
     * Subjects API.
     *****************************************************************************/

    /**
     * Get a subject record by ID (or alternative IDs).
     */
    subject(id: string): Record<string, unknown> | undefined {
        const subNode = this.doc.sync_call('<Limitr>.api.subject', id);
        if (typeof subNode === 'string') return this.doc.record(subNode);
        return undefined;
    }


    /**
     * Get all subjects as a single record.
     * Subjects contain all state information, so this is all that is required to save/load.
     */
    subjects(): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.get');
        if (typeof node === 'string') {
            const subs = this.doc.get('subjects', node);
            if (typeof subs === 'string') return this.doc.record(subs);
        }
        return undefined;
    }


    /**
     * Get the subject organization subject ID if defined.
     */
    subjectOrg(id: string): string | null {
        return this.doc.sync_call('<Limitr>.api.subject_org', id) as string | null;
    }


    /**
     * Set/change a subject's plan ID.
     * Returns true if the plan has changed (and emits a subject-set event).
     */
    async setSubjectPlan(id: string, plan: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.set_subject_plan', id, plan) as boolean;
    }


    /**
     * Set/change a subject's plan ID.
     * Returns true if the plan has changed (and emits a subject-set event).
     */
    setSubjectPlanSync(id: string, plan: string): boolean {
        return this.doc.sync_call('<Limitr>.api.set_subject_plan', id, plan) as boolean;
    }

    
    /**
     * Add a new subject to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    async addSubject(id: string, plan: string, type: string = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        await this.doc.call('<Limitr>.api.create_subject', id, plan, type, label, org, alts);
    }


    /**
     * Add a new subject to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    addSubjectSync(id: string, plan: string, type: string = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        this.doc.sync_call('<Limitr>.api.create_subject', id, plan, type, label, org, alts);
    }


    /**
     * Set a subject on this policy by ID.
     * Returns a node ID to the resulting Subject.
     */
    async setSubject(id: string, subjectStof: string): Promise<string | null> {
        return await this.doc.call('<Limitr>.api.set_subject', id, subjectStof) as string | null;
    }


    /**
     * Set a subject on this policy by ID.
     * Returns a node ID to the resulting Subject.
     */
    setSubjectSync(id: string, subjectStof: string): string | null {
        return this.doc.sync_call('<Limitr>.api.set_subject', id, subjectStof) as string | null;
    }


    /**
     * Load many subjects as records.
     * This is all that is required for save/load since subjects contain all state information.
     */
    async loadSubjects(subjects: Record<string, unknown> | Record<string, unknown>[]) {
        let subs: Record<string, unknown>[] = [];
        if (!Array.isArray(subjects)) {
            for (const [k, v] of Object.entries(subjects)) {
                const val = v as Record<string, unknown>;
                val.id = k; // make sure it has the correct ID
                subs.push(val);
            }
        } else {
            subs = subjects;
        }
        for (const sub of subs) {
            const id = sub.id;
            if (typeof id === 'string') {
                await this.setSubject(id, JSON.stringify(sub));
            }
        }
    }


    /**
     * Load many subjects as records.
     * This is all that is required for save/load since subjects contain all state information.
     */
    loadSubjectsSync(subjects: Record<string, unknown> | Record<string, unknown>[]) {
        let subs: Record<string, unknown>[] = [];
        if (!Array.isArray(subjects)) {
            for (const [k, v] of Object.entries(subjects)) {
                const val = v as Record<string, unknown>;
                val.id = k; // make sure it has the correct ID
                subs.push(val);
            }
        } else {
            subs = subjects;
        }
        for (const sub of subs) {
            const id = sub.id;
            if (typeof id === 'string') {
                this.setSubjectSync(id, JSON.stringify(sub));
            }
        }
    }


    /**
     * Remove a subject by ID.
     */
    async removeSubject(id: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.delete_subject', id) as boolean;
    }


    /**
     * Remove a subject by ID.
     */
    removeSubjectSync(id: string): boolean {
        return this.doc.sync_call('<Limitr>.api.delete_subject', id) as boolean;
    }


    /**
     * Add an alternative subject ID to an existing subject.
     */
    addAltID(existing: string, alt: string): boolean {
        return this.doc.sync_call('<Limitr>.api.set_alt_subject_id', existing, alt) as boolean;
    }


    /**
     * Remove an alternative subject ID from an existing subject.
     */
    removeAltID(alt: string): boolean {
        return this.doc.sync_call('<Limitr>.api.delete_alt_subject_id', alt) as boolean;
    }


    /*****************************************************************************
     * Entitlements API.
     *****************************************************************************/

    /**
     * Get an entitlement record with a plan ID or subject ID and an entitlement name.
     */
    entitlement(id: string, entitlement: string): Record<string, unknown> | undefined {
        const node = this.doc.sync_call('<Limitr>.api.entitlement', id, entitlement);
        if (typeof node === 'string') return this.doc.record(node);
        return undefined;
    }


    /**
     * Get the limit value for a metered entitlement.
     * ID can be a subject ID or a plan ID (to get the specific entitlement from a plan).
     * Will always be in the units of the credit associated with this entitlement (ex. limit.value = '2GB', credit.stof_units = 'MB', limit = 2000).
     */
    limit(id: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.limit', id, entitlement) as number | null;
    }


    /**
     * Get the remaining balance for a subject's entitlement (limit - current (metered) value).
     * Will always be in the units of the credit associated with this entitlement.
     */
    balance(subject: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.balance', subject, entitlement) as number | null;
    }


    /**
     * Get the current meter value for a subject's entitlement.
     * Will always be in the units of the credit associated with this entitlement.
     */
    value(subject: string, entitlement: string): number | null {
        return this.doc.sync_call('<Limitr>.api.value', subject, entitlement) as number | null;
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
    async increment(subject: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.increment', subject, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement using a standard increment (defined in the Limit).
     * This is the same as using "meter" with the "cost" of a standard increment for this entitlement.
     * Returns true if changed and the limit was not hit, otherwise false and App.meter_limit lib func will be called (if present).
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    incrementSync(subject: string, entitlement: string): boolean {
        return this.doc.sync_call('<Limitr>.api.increment', subject, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async deincrement(subject: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.deincrement', subject, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     * This is the same as using "meter" with the negative "cost" of a standard increment for this entitlement.
     * Can use a string value for units in entitlement.limit.increment (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    deincrementSync(subject: string, entitlement: string): boolean {
        return this.doc.sync_call('<Limitr>.api.deincrement', subject, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by the given value.
     * Same as "check" for entitlements without a limit/meter (boolean entitlement).
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async meter(subject: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.meter', subject, entitlement, value) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by the given value.
     * Same as "check" for entitlements without a limit/meter (boolean entitlement).
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    meterSync(subject: string, entitlement: string, value: number | string = 0): boolean {
        return this.doc.sync_call('<Limitr>.api.meter', subject, entitlement, value) as boolean;
    }


    /**
     * Just perform a check to see if the entitlement exists for this subject OR if a specific value change is valid.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    async check(subject: string, entitlement: string, value: number | string = 0): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.check', subject, entitlement, value) as boolean;
    }


    /**
     * Just perform a check to see if the entitlement exists for this subject OR if a specific value change is valid.
     * Can use a string value for units (must be a valid stof number) (ex. '3GiB' or '5s').
     */
    checkSync(subject: string, entitlement: string, value: number | string = 0): boolean {
        return this.doc.sync_call('<Limitr>.api.check', subject, entitlement, value) as boolean;
    }
}
