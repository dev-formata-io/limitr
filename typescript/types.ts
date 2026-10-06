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
    overhead_cost: boolean;
    follow_decrements: boolean;
    hard_trailing: boolean;
    shared: boolean;
    shared_with: string[] | null;
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
    /** When true, meter_value will be incremented according to the credit's overhead cost. */
    overhead_cost?: boolean;
    /** When true, a decrement (negative allow value) reduces this cap's meter_value too, rather than being ignored. Useful for end-of-month billing corrections. */
    follow_decrements?: boolean;
    /**
     * When true, a call is allowed while the cap is under its ceiling before the call, and is committed in full
     * even if it overshoots - every call after that is denied until the cap resets or is reset. Mirrors a Limit's
     * hard_trailing. Useful when the real cost isn't known until after the call (e.g. LLM output).
     */
    hard_trailing?: boolean;
    /**
     * When true, this cap also applies to every customer that references this one, directly or
     * through a ref chain (e.g. an org budget shared by its teams and users). Unshared caps only
     * apply to calls made as the customer holding them.
     */
    shared?: boolean;
    /** For shared caps: only apply to callers of these customer types (e.g. ['user']). Omit for all. */
    shared_with?: string[];
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

    /**
     * If true (default), set-customer & customer-cap-added events will fire when creating the spend Cap.
     * Set to false for temporary spend caps (per pipeline, etc.).
     */
    send_events?: boolean;
}


/**
 * A predicted call (Limitr.estimate).
 */
export interface LimitrEstimate {
    /** Predicted usage for one call, in the credit's units. */
    value: number;
    /** Predicted provider overhead for one call, in runes (typically USD). */
    overhead: number;
    /** Observations behind the estimate. */
    samples: number;
    /** 'local' (learned in this engine) or 'cloud' (seeded or pooled by Limitr Cloud). */
    source: string;
    /** 'customer' (this customer's own usage) or 'policy' (everyone's). */
    scope: string;
}


/**
 * Options for Limitr.estimate.
 */
export interface LimitrEstimateOptions {
    /** The call's event data (ex. { model, input }): supplies the entitlement's estimate_basis and estimate_segment fields. */
    context?: string | Record<string, unknown>;
    /** How cautious: 0.5 = a typical call, 0.9 (default) = 9 in 10 calls use this or less. */
    quantile?: number;
    /** Overrides the basis read from `context` (only for entitlements that declare estimate_basis). */
    basis?: number;
    /** Overrides the segment read from `context`. */
    segment?: string;
}


/**
 * Options for Limitr.observe.
 */
export interface LimitrObserveOptions {
    /** The call's provider overhead in runes (default: the credit's cost function with `context`). */
    overhead?: number;
    /** The call's event data (ex. { model, input, output }): cost function context, estimate_basis, estimate_segment. */
    context?: string | Record<string, unknown>;
    /** Overrides the basis read from `context` (only for entitlements that declare estimate_basis). */
    basis?: number;
    /** Overrides the segment read from `context`. */
    segment?: string;
}


/**
 * Options for Limitr.reserve.
 */
export interface LimitrReserveOptions {
    /** Amount to hold. Leave unset to hold the predicted amount (estimate). */
    value?: number | string;
    /** The call's event data (ex. { model, input }): the cost function's context, and the entitlement's
     *  estimate_basis / estimate_segment fields (kept on the hold, so settle learns from the call). */
    context?: string | Record<string, unknown>;
    /** Overrides the basis read from `context` (only for entitlements that declare estimate_basis). */
    basis?: number;
    /** Overrides the segment read from `context`. */
    segment?: string;
    /** How long the hold lasts if never settled, in ms (default: the policy's hold_ttl, 10 minutes). */
    ttl?: number;
    /** How cautious a predicted hold is: 0.5 = a typical call, 0.9 (default) = 9 in 10 calls use this or less. */
    quantile?: number;
    /** The hold's provider overhead in runes (default: predicted, or the credit's cost function). */
    overhead?: number;
}
