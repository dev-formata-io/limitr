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

import { customElement, property, state } from "lit/decorators.js";
import { LimitrElement } from "./element.js";
import { css, type CSSResult, html } from "lit";


/**
 * Pricing table for a Limitr policy, showing all visible plans for a user
 * to choose from (allows them to pick/switch plans).
 */
@customElement('limitr-pricing-table')
export class LimitrPricingTable extends LimitrElement {
    @property({ type: Boolean })
    interactive: boolean = true;

    @property({ type: Boolean })
    /** When true, emit plan select events only, without setting customer plan on policy. */
    denyPolicyChanges: boolean = false;

    @property()
    theme: 'light' | 'dark' = 'light';

    @state()
    //deno-lint-ignore no-explicit-any
    private currentPlan: any = null;

    @state()
    private loading: boolean = true;

    @state()
    private showCouponModal: boolean = false;

    @state()
    private selectedPlanForCoupon: string = '';

    @state()
    private couponCode: string = '';

    @state()
    private couponError: string = '';


    /**
     * Styles.
     */
    static override get styles(): CSSResult {
        return css`
            :host {
                display: block;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                --limitr-bg-primary: #ffffff;
                --limitr-bg-secondary: #f8f9fa;
                --limitr-bg-hover: #f1f3f5;
                --limitr-text-primary: #000000;
                --limitr-text-secondary: #6c757d;
                --limitr-border: #dee2e6;
                --limitr-accent: #000000;
                --limitr-accent-text: #ffffff;
                --limitr-radius: 12px;
                --limitr-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
                --limitr-shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.12);
            }

            :host([theme="dark"]) {
                --limitr-bg-primary: #1a1a1a;
                --limitr-bg-secondary: #2d2d2d;
                --limitr-bg-hover: #3a3a3a;
                --limitr-text-primary: #ffffff;
                --limitr-text-secondary: #a0a0a0;
                --limitr-border: #404040;
                --limitr-accent: #ffffff;
                --limitr-accent-text: #000000;
            }

            .pricing-container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 24px;
                padding: 24px;
                max-width: 1200px;
                margin: 0 auto;
            }

            .plan-card {
                background: var(--limitr-bg-primary);
                border: 2px solid var(--limitr-border);
                border-radius: var(--limitr-radius);
                padding: 32px 24px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: var(--limitr-shadow);
                position: relative;
                display: flex;
                flex-direction: column;
            }

            .plan-card.interactive:hover {
                transform: translateY(-4px);
                box-shadow: var(--limitr-shadow-hover);
                border-color: var(--limitr-accent);
            }

            .plan-card.current {
                border-color: var(--limitr-accent);
                border-width: 2px;
            }

            .current-badge {
                position: absolute;
                top: 16px;
                right: 16px;
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
                padding: 4px 12px;
                border-radius: 16px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .plan-header {
                margin-bottom: 24px;
            }

            .plan-name {
                font-size: 24px;
                font-weight: 700;
                color: var(--limitr-text-primary);
                margin: 0 0 8px 0;
            }

            .plan-price {
                display: flex;
                align-items: baseline;
                gap: 4px;
                margin: 16px 0;
            }

            .price-prefix {
                font-size: 18px;
                color: var(--limitr-text-secondary);
                font-weight: 500;
            }

            .price-amount {
                font-size: 48px;
                font-weight: 800;
                color: var(--limitr-text-primary);
                line-height: 1;
            }

            .price-suffix {
                font-size: 16px;
                color: var(--limitr-text-secondary);
                font-weight: 500;
            }

            .plan-features {
                list-style: none;
                padding: 0;
                margin: 0 0 32px 0;
                flex-grow: 1;
            }

            .feature-item {
                padding: 16px 12px;
                border-bottom: 1px solid var(--limitr-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
            }

            .feature-item:first-child {
                padding-top: 0;
            }

            .feature-item:last-child {
                border-bottom: none;
                padding-bottom: 0;
            }

            .feature-name {
                font-size: 15px;
                color: var(--limitr-text-primary);
                font-weight: 500;
                flex: 1;
                line-height: 1.5;
            }

            .feature-limit {
                font-size: 14px;
                color: var(--limitr-text-secondary);
                font-weight: 600;
                white-space: nowrap;
            }

            .select-button {
                width: 100%;
                padding: 16px;
                border: 2px solid var(--limitr-accent);
                background: transparent;
                color: var(--limitr-accent);
                font-size: 16px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .select-button:hover {
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
            }

            .select-button.current {
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
                cursor: default;
            }

            .select-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .loading {
                text-align: center;
                padding: 48px;
                color: var(--limitr-text-secondary);
                font-size: 16px;
            }

            .empty {
                text-align: center;
                padding: 48px;
                color: var(--limitr-text-secondary);
            }

            .empty-title {
                font-size: 20px;
                font-weight: 600;
                margin-bottom: 8px;
            }

            .coupon-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
                padding: 24px;
            }

            .coupon-modal {
                background: var(--limitr-bg-primary);
                border-radius: var(--limitr-radius);
                max-width: 480px;
                width: 100%;
                padding: 32px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            }

            .coupon-modal-title {
                font-size: 24px;
                font-weight: 700;
                color: var(--limitr-text-primary);
                margin: 0 0 8px 0;
            }

            .coupon-modal-description {
                font-size: 14px;
                color: var(--limitr-text-secondary);
                margin-bottom: 24px;
                line-height: 1.5;
            }

            .coupon-input-wrapper {
                margin-bottom: 24px;
            }

            .coupon-input-label {
                display: block;
                font-size: 14px;
                font-weight: 600;
                color: var(--limitr-text-primary);
                margin-bottom: 8px;
            }

            .coupon-input {
                width: 100%;
                padding: 12px 16px;
                border: 2px solid var(--limitr-border);
                border-radius: 8px;
                font-size: 16px;
                background: var(--limitr-bg-primary);
                color: var(--limitr-text-primary);
                font-family: inherit;
                transition: border-color 0.2s ease;
                box-sizing: border-box;
            }

            .coupon-input:focus {
                outline: none;
                border-color: var(--limitr-accent);
            }

            .coupon-input.error {
                border-color: #ef4444;
            }

            .coupon-error {
                color: #ef4444;
                font-size: 13px;
                margin-top: 6px;
            }

            .coupon-modal-actions {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }

            .coupon-button {
                flex: 1;
                min-width: 120px;
                padding: 12px 24px;
                border: 2px solid var(--limitr-accent);
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .coupon-button-primary {
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
            }

            .coupon-button-primary:hover {
                opacity: 0.9;
            }

            .coupon-button-secondary {
                background: transparent;
                color: var(--limitr-accent);
            }

            .coupon-button-secondary:hover {
                background: var(--limitr-bg-secondary);
            }

            .coupon-button-tertiary {
                background: transparent;
                border-color: var(--limitr-border);
                color: var(--limitr-text-secondary);
            }

            .coupon-button-tertiary:hover {
                background: var(--limitr-bg-secondary);
            }

            @media (max-width: 768px) {
                .pricing-container {
                    grid-template-columns: 1fr;
                }
                
                .coupon-modal-actions {
                    flex-direction: column;
                }
                
                .coupon-button {
                    width: 100%;
                }
            }
        `;
    }


    override async connectedCallback() {
        super.connectedCallback();
        await this.loadCurrentPlan();
    }


    override async updated(changedProperties: Map<string | number | symbol, unknown>) {
        await super.updated(changedProperties);
        
        if (changedProperties.has('policy') || changedProperties.has('customerId')) {
            await this.loadCurrentPlan();
        }
    }


    private async loadCurrentPlan() {
        this.loading = true;
        try {
            this.currentPlan = await this.getCustomerPlan();
        } catch (e) {
            console.error('Error loading customer plan:', e);
            this.currentPlan = null;
        } finally {
            this.loading = false;
        }
    }


    private async handlePlanSelect(planName: string) {
        if (!this.interactive) return;
        
        // Get the selected plan details
        const selectedPlan = this.getPlan(planName);
        const hasPaidPrice = selectedPlan?.price && selectedPlan.price.amount > 0;
        
        // Check if plan allows coupons and show coupon modal if so
        const allowsCoupons = selectedPlan?.price?.allowCoupons === true;
        if (hasPaidPrice && allowsCoupons) {
            // Show coupon modal before proceeding
            this.selectedPlanForCoupon = planName;
            this.couponCode = '';
            this.couponError = '';
            this.showCouponModal = true;
            return;
        }
        
        // Proceed with plan selection (no coupon)
        await this.completePlanSelection(planName, '');
    }

    private async completePlanSelection(planName: string, couponCode: string) {
        // Get the selected plan details
        const selectedPlan = this.getPlan(planName);
        const hasPaidPrice = selectedPlan?.price && selectedPlan.price.amount > 0;
        
        // Check if customer has payment method on file
        const customer = await this.customer();
        const hasPaymentMethod = customer?.metadata?.stripe_payment_method_type;
        
        // If selecting a paid plan without payment method, redirect to Stripe portal
        if (hasPaidPrice && !hasPaymentMethod && this.stripePortalUrl) {
            if (confirm("This plan requires a payment method. You'll be redirected to add your payment details.")) {
                globalThis.location.href = this.stripePortalUrl;
            }
            return;
        }
        
        // Set coupon code in customer metadata if provided
        if (couponCode && this.policy) {
            customer.metadata = {
                ...customer.metadata,
                stripe_coupon_code: couponCode,
                stripe_coupon_status: 'pending',
            };
            // Send customer update with coupon to server
            await this.policy.setCustomer(customer);
        }
        
        if (!this.denyPolicyChanges && this.policy && confirm("Are you sure you'd like to change plans? This may result in additional charges to your account.")) {
            // if the new plan was not set on the policy, return without emitting an event
            // overwrite_meters is false so that current period usage is kept in-tact
            // any new meters created will have a starting date equal to the latest active meter starting date from prior plan
            if (!await this.policy.setCustomerPlan(this.customerId, planName, false)) return;
        }
        const event = new CustomEvent('plan-select', {
            detail: { planName, couponCode },
            bubbles: true,
            composed: true,
        });
        this.dispatchEvent(event);
        await this.loadCurrentPlan();
        this.requestUpdate();
    }

    private async handleCouponSubmit() {
        // Basic validation
        if (!this.couponCode || this.couponCode.trim() === '' || !this.customerId) {
            this.couponError = 'Please enter a coupon code';
            return;
        }

        // Make sure the coupon is valid before applying it
        const coupon = this.couponCode.trim();
        const response = await fetch(`https://api.limitr.dev/v1/stripe-ui/coupon-check?coupon=${coupon}&customerId=${this.customerId}`);
        if (response.ok) {
            const json = await response.json();
            if (json.valid) {
                this.showCouponModal = false;
                this.completePlanSelection(this.selectedPlanForCoupon, this.couponCode.trim());
            } else {
                this.couponError = 'Not a valid coupon code';
                return;
            }
        } else {
            this.couponError = 'Not a valid coupon code';
            return;
        }
    }


    private handleCouponSkip() {
        // Close modal and proceed without coupon
        this.showCouponModal = false;
        this.completePlanSelection(this.selectedPlanForCoupon, '');
    }


    private handleCouponCancel() {
        // Close modal and don't change plans
        this.showCouponModal = false;
        this.selectedPlanForCoupon = '';
        this.couponCode = '';
        this.couponError = '';
    }


    //deno-lint-ignore no-explicit-any
    private formatPrice(price: any) {
        if (!price) return null;
        
        const amount = typeof price.amount === 'number' 
            ? price.amount.toFixed(2) 
            : price.amount;
        
        return {
            prefix: price.prefix || '',
            amount,
            suffix: price.suffix || '',
        };
    }


    /**
     * Pluralize a unit name if needed based on the value.
     */
    private pluralizeUnit(unit: string, value: number | string): string {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        
        // Don't pluralize if value is 1
        if (numValue === 1) return unit;
        
        // Units that don't need pluralization
        const nonPluralUnits = [
            'GB', 'MB', 'KB', 'TB', 'MiB', 'GiB', 'KiB', 'TiB',
            'ms', 'seconds', 'minutes', 'hours', 'days'
        ];
        if (nonPluralUnits.includes(unit)) {
            return unit;
        }
        
        // Common irregular plurals
        const irregularPlurals: Record<string, string> = {
            'seat': 'seats',
            'token': 'tokens',
            'request': 'requests',
            'call': 'calls',
            'query': 'queries',
            'credit': 'credits',
            'user': 'users',
            'member': 'members',
            'item': 'items'
        };
        if (irregularPlurals[unit.toLowerCase()]) {
            return irregularPlurals[unit.toLowerCase()];
        }
        
        // Default: add 's' for pluralization
        if (!unit.endsWith('s')) {
            return unit + 's';
        }
        
        return unit;
    }


    //deno-lint-ignore no-explicit-any
    private formatLimitValue(limit: any, creditName: string) {
        if (!limit || limit.value === undefined) return 'Unlimited';
        
        const credit = this.getCredit(creditName);
        const value = this.stofHelpers ? this.stofHelpers.sync_call('get_number_limit', limit.value, credit.stof_units ?? 'float') : limit.value;
        
        if (credit && credit.stof_units && credit.stof_units !== 'float' && credit.stof_units !== 'int') {
            return `${value} ${credit.stof_units}`;
        }
        
        if (credit && credit.label) {
            const pluralizedUnit = this.pluralizeUnit(credit.label, value);
            return `${value} ${pluralizedUnit}`;
        }
        
        return `${value}`;
    }


    //deno-lint-ignore no-explicit-any
    private renderPlanCard(plan: any, isCurrent: boolean) {
        const price = this.formatPrice(plan.price);
        const entitlements = plan.entitlements || {};
        
        // Filter out hidden entitlements
        //deno-lint-ignore no-explicit-any
        const visibleEntitlements = Object.entries(entitlements).filter(([_, ent]: [string, any]) => !ent.hidden);
        
        return html`
            <div class="plan-card ${this.interactive ? 'interactive' : ''} ${isCurrent ? 'current' : ''}">
                ${isCurrent ? html`<div class="current-badge">Current Plan</div>` : ''}
                
                <div class="plan-header">
                    <h3 class="plan-name">${plan.label || plan.name}</h3>
                    
                    ${price ? html`
                        <div class="plan-price">
                            ${price.prefix ? html`<span class="price-prefix">${price.prefix}</span>` : ''}
                            <span class="price-amount">${price.amount}</span>
                            ${price.suffix ? html`<span class="price-suffix">${price.suffix}</span>` : ''}
                        </div>
                    ` : ''}
                </div>

                <ul class="plan-features">
                    ${
                        //deno-lint-ignore no-explicit-any
                        visibleEntitlements.map(([entName, entitlement]: [string, any]) => {
                        const limit = entitlement.limit;
                        
                        return html`
                            <li class="feature-item">
                                <span class="feature-name">${entitlement.description || entName}</span>
                                ${limit ? html`
                                    <span class="feature-limit">${this.formatLimitValue(limit, limit.credit)}</span>
                                ` : html`
                                    <span class="feature-limit">✓</span>
                                `}
                            </li>
                        `;
                    })}
                </ul>

                ${this.interactive ? html`
                    <button 
                        class="select-button ${isCurrent ? 'current' : ''}"
                        ?disabled=${isCurrent}
                        @click=${() => this.handlePlanSelect(plan.name)}
                    >
                        ${isCurrent ? 'Current Plan' : 'Select Plan'}
                    </button>
                ` : ''}
            </div>
        `;
    }


    /**
     * Render.
     */
    override render(): unknown {
        if (this.loading) {
            return html`<div class="loading">Loading plans...</div>`;
        }

        const plans = this.visiblePlans;
        
        if (plans.length === 0) {
            return html`
                <div class="empty">
                    <div class="empty-title">No plans available</div>
                </div>
            `;
        }

        return html`
            <div class="pricing-container">
                ${plans.map(plan => 
                    this.renderPlanCard(plan, this.currentPlan?.name === plan.name)
                )}
            </div>

            ${this.showCouponModal ? html`
                <div class="coupon-modal-overlay" @click=${this.handleCouponCancel}>
                    <div class="coupon-modal" @click=${(e: Event) => e.stopPropagation()}>
                        <h2 class="coupon-modal-title">Have a Coupon Code?</h2>
                        <p class="coupon-modal-description">
                            Enter your coupon code to apply a discount to your subscription.
                        </p>
                        
                        <div class="coupon-input-wrapper">
                            <label class="coupon-input-label" for="coupon-input">
                                Coupon Code
                            </label>
                            <input
                                id="coupon-input"
                                type="text"
                                class="coupon-input ${this.couponError ? 'error' : ''}"
                                .value=${this.couponCode}
                                @input=${(e: Event) => {
                                    this.couponCode = (e.target as HTMLInputElement).value;
                                    this.couponError = '';
                                }}
                                @keypress=${(e: KeyboardEvent) => {
                                    if (e.key === 'Enter') {
                                        this.handleCouponSubmit();
                                    }
                                }}
                                placeholder="Enter code"
                                autocomplete="off"
                            />
                            ${this.couponError ? html`
                                <div class="coupon-error">${this.couponError}</div>
                            ` : ''}
                        </div>

                        <div class="coupon-modal-actions">
                            <button class="coupon-button coupon-button-primary" @click=${this.handleCouponSubmit}>
                                Apply Coupon
                            </button>
                            <button class="coupon-button coupon-button-secondary" @click=${this.handleCouponSkip}>
                                Skip
                            </button>
                            <button class="coupon-button coupon-button-tertiary" @click=${this.handleCouponCancel}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}
