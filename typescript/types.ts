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


/**
 * Customer interface.
 */
export interface LimitrCustomer {
    id: string;
    plan: string;
    alt_ids: string[];
    refs: string[];
    type: string;
    label: string;
    meters: Record<string, unknown>,
    overrides: Record<string, unknown>,
    grants: Record<string, unknown>,
    metadata: Record<string, unknown> | null,
    
    cloud_test?: boolean | null,
    cloud_updated?: number | null,
    cloud_created?: number | null,
}


/**
 * A standing spend cap on a customer, as returned by addCustomerCap/customerCap.
 */
export interface LimitrCap {
    id: string;
    credit: string;
    value: number;
    exchangeable: boolean;
    ignore_grants: boolean;
    overage_only: boolean;
    observe_only: boolean;
    follow_decrements: boolean;
    scope: string[] | null;
    meter_value: number;
    created_on: number;
    started: number | null;
    resets: boolean;
    reset_inc: number | null;
    reset_sch: string | null;
    last_reset: number | null;
    expires_on: number | null;
}


/**
 * Options for addCustomerCap. Every field is optional - matches the
 * defaults add_customer_cap itself applies on the Stof side (e.g. credit
 * defaults to 'rune', exchangeable is inferred from credit when omitted).
 *
 * Folding these into one options object (rather than a long parameter
 * list) means adding a new cap option later is a one-line, additive change
 * to this interface - existing call sites are never affected by argument
 * position, since there are no positions to shift.
 */
export interface LimitrCapOptions {
    /** Stable key for later resetCustomerCap/removeCustomerCap lookups. Auto-generated if omitted. */
    cap_id?: string;
    /** Credit this cap's ceiling is denominated in. Defaults to 'rune' (USD-pegged) for a cross-credit umbrella cap. */
    credit?: string;
    /** Whether this cap applies to credits other than `credit` via Exchange conversion. Inferred from `credit` when omitted - true for 'rune', false for a specific named credit. */
    exchangeable?: boolean;
    /** When true, spend a grant already covered does not count against this cap. */
    ignore_grants?: boolean;
    /** When true, only spend beyond the plan's included amount counts against this cap. */
    overage_only?: boolean;
    /** When true, this cap never denies a call - it still accumulates meter_value, purely as a spend tracker. `value` still serves as a notification threshold either way. */
    observe_only?: boolean;
    /** When true, a decrement (negative allow value) reduces this cap's meter_value too, rather than being ignored. Useful for end-of-month billing corrections. */
    follow_decrements?: boolean;
    /** Restrict this cap to specific entitlement names. Omit (or leave undefined) to apply wherever Exchange-convertible. */
    scope?: string[];
    /** Whether this cap's meter_value resets on a schedule. Defaults to false (a non-resetting standing cap). */
    resets?: boolean;
    /** Duration-based reset increment, in ms. Mutually exclusive with reset_sch. */
    reset_inc?: number;
    /** Calendar-based reset schedule (e.g. 'monthly:1'). Mutually exclusive with reset_inc. */
    reset_sch?: string;
    /** Timestamp (ms) after which this cap expires and is removed. */
    expires_on?: number;
}
