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
 */
export class Limitr {
    /** StofDoc. */
    doc: StofDoc;


    /**
     * Constructor.
     * Make sure StofDoc.initialize() has been called for Stof first.
     * This will always add the Limitr Stof types, etc.
     */
    constructor(policy: string = 'Limitr policy: {}') {
        this.doc = new StofDoc();
        this.doc.stof.binaryImport(limitrApi, 'bstf', null, 'prod');
        this.doc.parse(policy);
    }


    /**
     * Async constructor that ensures Stof wasm initialization.
     */
    static async new(policy: string = 'Limitr policy: {}'): Promise<Limitr> {
        await StofDoc.initialize();
        return new Limitr(policy);
    }


    /*****************************************************************************
     * Subjects API.
     *****************************************************************************/
    
    /**
     * Add a new subject to this Limitr.
     * Use a unique ID - can always add additional unique IDs with alts (Ex. Stripe customer ID, API key, etc.).
     */
    async addSubject(id: string, plan: string, type: string = 'user', label: string = 'User', org: string | null = null, alts: string[] | null = null) {
        await this.doc.call('<Limitr>.api.create_subject', id, plan, type, label, org, alts)
    }


    /*****************************************************************************
     * Entitlements API.
     *****************************************************************************/
    
    /**
     * Try changing the value of a metered entitlement using a standard increment (defined in the Limit).
     * Returns true if changed and the limit was not hit, otherwise false and App.meter_limit lib func will be called (if present).
     */
    async increment(id: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.increment', id, entitlement) as boolean;
    }


    /**
     * Try changing the value of a metered entitlement by removing a standard increment (defined in the Limit).
     */
    async deincrement(id: string, entitlement: string): Promise<boolean> {
        return await this.doc.call('<Limitr>.api.deincrement', id, entitlement) as boolean;
    }
}
