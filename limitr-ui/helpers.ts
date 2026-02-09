/**
 * Limitr UI Helpers
 * 
 * Simplified initialization functions for Limitr UI web components.
 * These helpers handle all the boilerplate for creating and configuring components.
 */

import { Limitr } from '@formata/limitr';
import { initStof } from '@formata/stof';
import { LimitrPricingTable } from './table.js';
import { LimitrCurrentPlan } from './current.js';


/**
 * Configuration for creating a pricing table
 */
export interface PricingTableConfig {
    /** CSS selector or HTMLElement where the table should be rendered */
    container: string | HTMLElement;
    /** Limitr cloud token for fetching policy */
    token: string;
    /** Whether the table should be interactive (allow plan selection) */
    interactive?: boolean;
    /** Optional current customer ID. */
    customerId?: string;
    /** Prevent users from changing their policy/plan */
    denyPolicyChanges?: boolean;
    /** Pre-initialized Limitr policy (optional, will fetch from cloud if not provided) */
    policy?: any;
    /** Theme "dark" or "light". */
    theme?: "dark" | "light";
}


/**
 * Configuration for creating a current plan component
 */
export interface CurrentPlanConfig {
    /** CSS selector or HTMLElement where the component should be rendered */
    container: string | HTMLElement;
    /** Limitr cloud token for fetching policy */
    token: string;
    /** Customer ID to display plan for */
    customerId: string;
    /** Show Stripe billing information */
    showStripeInfo?: boolean;
    /** Cancel subscription immediately instead of at period end */
    cancelImmediately?: boolean;
    /** Request Stripe invoices data */
    requestStripeInvoices?: boolean;
    /** Request Stripe portal URL */
    requestStripePortalUrl?: boolean;
    /** Pre-initialized Limitr policy (optional, will fetch from cloud if not provided) */
    policy?: any;
}


/**
 * Global initialization state
 */
let stofInitialized = false;
let limitrUiImported = false;


/**
 * Initialize STOF WASM (required for Limitr)
 * This is called automatically by helper functions, but can be called manually if needed.
 * 
 * @param wasmUrl - URL to the STOF WASM file (defaults to unpkg)
 */
export async function ensureStofInitialized(wasmUrl?: string): Promise<void> {
    if (stofInitialized) return;
    
    const url = wasmUrl || 'https://unpkg.com/@formata/stof@latest/wasm';
    await initStof(url);
    stofInitialized = true;
}


/**
 * Ensure Limitr UI components are imported and registered
 */
async function ensureLimitrUiImported(): Promise<void> {
    if (limitrUiImported) return;
    
    // Import the components (this registers them as custom elements)
    await import('@formata/limitr-ui');
    limitrUiImported = true;
}


/**
 * Resolve a container selector to an HTMLElement
 */
function resolveContainer(container: string | HTMLElement): HTMLElement {
    if (typeof container === 'string') {
        const element = document.querySelector(container);
        if (!element) {
            throw new Error(`Container not found: ${container}`);
        }
        return element as HTMLElement;
    }
    return container;
}


/**
 * Fetch or use provided policy
 */
async function getPolicy(token: string, providedPolicy?: any): Promise<any> {
    if (providedPolicy) {
        return providedPolicy;
    }
    
    await ensureStofInitialized();
    return await Limitr.cloud({ token });
}


/**
 * Create and configure a pricing table component
 * 
 * @example
 * ```typescript
 * await createPricingTable({
 *   container: '#pricing-table',
 *   token: 'test_abc123',
 *   interactive: false,
 *   denyPolicyChanges: true
 * });
 * ```
 */
export async function createPricingTable(config: PricingTableConfig): Promise<HTMLElement> {
    const {
        container,
        token,
        interactive = false,
        denyPolicyChanges = true,
        customerId,
        theme = "light",
        policy: providedPolicy
    } = config;

    // Ensure everything is initialized
    await ensureLimitrUiImported();
    
    // Get or fetch the policy
    const policy = await getPolicy(token, providedPolicy);

    // Add the customer to the policy if defined
    if (customerId) await policy.addCloudCustomer(customerId);

    // Resolve the container
    const containerElement = resolveContainer(container);

    // Create the component
    const table = document.createElement('limitr-pricing-table') as LimitrPricingTable;
    containerElement.appendChild(table);

    // Wait for the custom element to be defined
    await customElements.whenDefined('limitr-pricing-table');

    // Set properties
    table.policy = policy;
    if (customerId) table.customerId = customerId;
    table.interactive = interactive;
    table.denyPolicyChanges = denyPolicyChanges;
    if (theme) table.theme = theme;

    // Request an update
    table.requestUpdate();

    // Wait for the update to complete
    await table.updateComplete;

    return table;
}


/**
 * Create and configure a current plan component
 * 
 * @example
 * ```typescript
 * await createCurrentPlan({
 *   container: '#current-plan',
 *   token: 'test_abc123',
 *   customerId: 'cust_xyz789',
 *   showStripeInfo: true,
 *   requestStripeInvoices: true
 * });
 * ```
 */
export async function createCurrentPlan(config: CurrentPlanConfig): Promise<HTMLElement> {
    const {
        container,
        token,
        customerId,
        showStripeInfo = true,
        cancelImmediately = false,
        requestStripeInvoices = true,
        requestStripePortalUrl = true,
        policy: providedPolicy
    } = config;

    // Ensure everything is initialized
    await ensureLimitrUiImported();
    
    // Get or fetch the policy
    const policy = await getPolicy(token, providedPolicy);

    // Add the customer to the policy if needed
    await policy.addCloudCustomer(customerId);

    // Resolve the container
    const containerElement = resolveContainer(container);

    // Create the component
    const currentPlan = document.createElement('limitr-current-plan') as LimitrCurrentPlan;
    containerElement.appendChild(currentPlan);

    // Wait for the custom element to be defined
    await customElements.whenDefined('limitr-current-plan');

    // Set properties
    currentPlan.policy = policy;
    currentPlan.customerId = customerId;
    currentPlan.showStripeInfo = showStripeInfo;
    currentPlan.cancelImmediately = cancelImmediately;
    currentPlan.requestStripeInvoices = requestStripeInvoices;
    currentPlan.requestStripePortalUrl = requestStripePortalUrl;

    // Request an update
    currentPlan.requestUpdate();

    // Wait for the update to complete
    await currentPlan.updateComplete;

    return currentPlan;
}


/**
 * Initialize Limitr UI with custom WASM URL
 * This is optional - the helper functions will use defaults if not called.
 * 
 * @example
 * ```typescript
 * await initLimitrUI({
 *   wasmUrl: 'https://cdn.example.com/stof.wasm'
 * });
 * ```
 */
export async function initLimitrUI(config?: { wasmUrl?: string }): Promise<void> {
    await ensureStofInitialized(config?.wasmUrl);
    await ensureLimitrUiImported();
}
