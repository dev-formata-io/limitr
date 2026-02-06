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
import { LimitrElement } from './element.js';
import { css, type CSSResult, html, nothing } from "lit";
import './table.ts';


/**
 * Show a customer's current plan & usage information (if any).
 * 
 * For Stripe integration via Limitr Cloud, the following metadata fields are expected
 * in customer.metadata:
 * 
 * - stripe_subscription_id: string - Stripe subscription ID
 * - stripe_subscription_status: string - Status (active, canceled, past_due, etc.)
 * - stripe_current_period_start: number - Unix timestamp (ms)
 * - stripe_current_period_end: number - Unix timestamp (ms)
 * - stripe_cancel_at_period_end: boolean - Will cancel at end of period
 * - stripe_customer_id: string - Stripe customer ID
 * - stripe_payment_method_type: string - Payment method type (card, etc.)
 * - stripe_payment_method_last4: string - Last 4 digits of payment method
 * - stripe_payment_method_brand: string - Card brand (visa, mastercard, etc.)
 *
 * Coupon metadata fields (populated by Limitr when coupon is applied):
 * - stripe_coupon_code: string - The coupon/promo code
 * - stripe_coupon_status: string - 'pending' | 'applied' | 'invalid' | 'expired'
 * - stripe_coupon_name: string - Display name for the coupon
 * - stripe_coupon_percent_off: string - Percentage off (if percent-based)
 * - stripe_coupon_amount_off: string - Amount off in cents (if amount-based)
 * - stripe_coupon_currency: string - Currency for amount_off coupons
 * - stripe_coupon_duration: string - 'once' | 'repeating' | 'forever'
 * - stripe_coupon_duration_in_months: string - Number of months (if repeating)
 */
@customElement('limitr-current-plan')
export class LimitrCurrentPlan extends LimitrElement {
    @property({ type: Boolean })
    showStripeInfo: boolean = false;

    @property({ type: Boolean })
    hideUsage: boolean = false;

    @property({ type: Boolean })
    hideCancel: boolean = false;

    @property({ type: Boolean })
    cancelImmediately: boolean = false;

    @property()
    theme: 'light' | 'dark' = 'light';

    @property({ type: Boolean })
    /** When true, emit plan select events only, without setting customer plan on policy. */
    denyPolicyChanges: boolean = false;

    @state()
    //deno-lint-ignore no-explicit-any
    private currentPlan: any = null;

    @state()
    //deno-lint-ignore no-explicit-any
    private currentCustomer: any = null;

    @state()
    private loading: boolean = true;

    @state()
    private showPricingTable: boolean = false;


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
                --limitr-text-primary: #000000;
                --limitr-text-secondary: #6c757d;
                --limitr-border: #dee2e6;
                --limitr-accent: #000000;
                --limitr-accent-text: #ffffff;
                --limitr-radius: 12px;
                --limitr-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            }

            :host([theme="dark"]) {
                --limitr-bg-primary: #1a1a1a;
                --limitr-bg-secondary: #2d2d2d;
                --limitr-text-primary: #ffffff;
                --limitr-text-secondary: #a0a0a0;
                --limitr-border: #404040;
                --limitr-accent: #ffffff;
                --limitr-accent-text: #000000;
            }

            .container {
                margin: 0 auto;
                padding: 24px;
            }

            .plan-card {
                background: var(--limitr-bg-primary);
                border: 2px solid var(--limitr-border);
                border-radius: var(--limitr-radius);
                padding: 32px;
                box-shadow: var(--limitr-shadow);
                margin-bottom: 24px;
            }

            .plan-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 24px;
                padding-bottom: 24px;
                border-bottom: 2px solid var(--limitr-border);
            }

            .plan-info {
                flex: 1;
            }

            .plan-label {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--limitr-text-secondary);
                margin-bottom: 8px;
                font-weight: 600;
            }

            .plan-name {
                font-size: 28px;
                font-weight: 700;
                color: var(--limitr-text-primary);
                margin: 0 0 8px 0;
            }

            .plan-price {
                display: flex;
                align-items: baseline;
                gap: 4px;
                color: var(--limitr-text-secondary);
                font-size: 18px;
                font-weight: 500;
            }

            .price-amount {
                font-size: 24px;
                font-weight: 700;
                color: var(--limitr-text-primary);
            }

            .change-plan-btn {
                padding: 12px 24px;
                border: 2px solid var(--limitr-accent);
                background: transparent;
                color: var(--limitr-accent);
                font-size: 14px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                white-space: nowrap;
            }

            .change-plan-btn:hover {
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
            }

            .plan-actions {
                display: flex;
                flex-direction: column;
                gap: 12px;
                align-items: flex-end;
            }

            .cancel-plan-btn {
                padding: 8px 16px;
                border: 1px solid #dc2626;
                background: transparent;
                color: #dc2626;
                font-size: 12px;
                font-weight: 600;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                white-space: nowrap;
            }

            .cancel-plan-btn:hover {
                background: #dc2626;
                color: #ffffff;
            }

            .resume-plan-btn {
                padding: 8px 16px;
                border: 1px solid #10b981;
                background: transparent;
                color: #10b981;
                font-size: 12px;
                font-weight: 600;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                white-space: nowrap;
            }

            .resume-plan-btn:hover {
                background: #10b981;
                color: #ffffff;
            }

            .price-original {
                font-size: 16px;
                color: var(--limitr-text-secondary);
                text-decoration: line-through;
                margin-right: 8px;
            }

            .coupon-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-top: 6px;
                padding: 4px 10px;
                background: #eeffc9;
                color: #4d7c0f;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
            }

            :host([theme="dark"]) .coupon-badge {
                background: #2d4a0a;
                color: #a3e635;
            }

            .coupon-badge .coupon-tag-icon {
                font-size: 13px;
            }

            .coupon-duration {
                font-size: 11px;
                color: var(--limitr-text-secondary);
                margin-top: 2px;
            }

            .usage-section {
                margin-bottom: 32px;
            }

            .section-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--limitr-text-primary);
                margin: 0 0 16px 0;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .usage-item {
                margin-bottom: 20px;
            }

            .usage-item:last-child {
                margin-bottom: 0;
            }

            .usage-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .usage-name {
                font-size: 14px;
                font-weight: 500;
                color: var(--limitr-text-primary);
            }

            .usage-stats {
                font-size: 14px;
                font-weight: 600;
                color: var(--limitr-text-secondary);
            }

            .usage-bar {
                width: 100%;
                height: 8px;
                background: var(--limitr-bg-secondary);
                border-radius: 4px;
                overflow: hidden;
            }

            .usage-bar-fill {
                height: 100%;
                background: var(--limitr-accent);
                transition: width 0.3s ease;
                border-radius: 4px;
            }

            .usage-bar-fill.warning {
                background: #f59e0b;
            }

            .usage-bar-fill.danger {
                background: #ef4444;
            }

            .stripe-section {
                margin-bottom: 32px;
            }

            .stripe-info {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 16px;
            }

            .info-item {
                padding: 16px;
                background: var(--limitr-bg-secondary);
                border-radius: 8px;
            }

            .info-label {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--limitr-text-secondary);
                margin-bottom: 4px;
                font-weight: 600;
            }

            .info-value {
                font-size: 16px;
                font-weight: 600;
                color: var(--limitr-text-primary);
            }

            .status-badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .status-badge.active {
                background: #10b981;
                color: #ffffff;
            }

            .status-badge.canceled {
                background: #6b7280;
                color: #ffffff;
            }

            .status-badge.past_due {
                background: #ef4444;
                color: #ffffff;
            }

            .invoices-section {
                margin-top: 32px;
                padding-top: 24px;
                border-top: 2px solid var(--limitr-border);
            }

            .invoices-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .invoice-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px;
                background: var(--limitr-bg-secondary);
                border-radius: 8px;
                gap: 16px;
            }

            .invoice-info {
                flex: 1;
                min-width: 0;
            }

            .invoice-number {
                font-weight: 600;
                color: var(--limitr-text-primary);
                font-size: 14px;
            }

            .invoice-date {
                font-size: 12px;
                color: var(--limitr-text-secondary);
                margin-top: 4px;
            }

            .invoice-amount {
                font-weight: 600;
                color: var(--limitr-text-primary);
                white-space: nowrap;
            }

            .invoice-download {
                padding: 8px 16px;
                border: 2px solid var(--limitr-accent);
                background: transparent;
                color: var(--limitr-accent);
                font-size: 13px;
                font-weight: 600;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-decoration: none;
                white-space: nowrap;
            }

            .invoice-download:hover {
                background: var(--limitr-accent);
                color: var(--limitr-accent-text);
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

            .modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                padding: 24px;
            }

            .modal-content {
                background: var(--limitr-bg-primary);
                border-radius: var(--limitr-radius);
                max-width: 1200px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
            }

            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 24px 24px 16px;
                border-bottom: 2px solid var(--limitr-border);
                position: sticky;
                top: 0;
                background: var(--limitr-bg-primary);
                z-index: 1;
            }

            .modal-title {
                font-size: 24px;
                font-weight: 700;
                color: var(--limitr-text-primary);
                margin: 0;
            }

            .close-btn {
                background: transparent;
                border: none;
                font-size: 28px;
                color: var(--limitr-text-secondary);
                cursor: pointer;
                padding: 4px 8px;
                line-height: 1;
                transition: color 0.2s ease;
            }

            .close-btn:hover {
                color: var(--limitr-text-primary);
            }

            @media (max-width: 768px) {
                .container {
                    padding: 16px;
                }

                .plan-card {
                    padding: 24px;
                }

                .plan-header {
                    flex-direction: column;
                    gap: 16px;
                }

                .plan-actions {
                    width: 100%;
                    align-items: stretch;
                }

                .change-plan-btn,
                .cancel-plan-btn,
                .resume-plan-btn {
                    width: 100%;
                }

                .stripe-info {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }


    override connectedCallback() {
        super.connectedCallback();
        this.loadData();
    }


    override async updated(changedProperties: Map<string | number | symbol, unknown>) {
        await super.updated(changedProperties);

        if (changedProperties.has('policy')) {
            // Re-register handler if policy changed (including first time it's set)
            //deno-lint-ignore no-explicit-any
            const oldPolicy: any = changedProperties.get('policy');
            if (oldPolicy) oldPolicy.removeHandler(this.policyHandlerId);
            if (this.policy) {
                this.policy.addHandler(this.policyHandlerId, (key: string, _value: unknown) => {
                    if (key.includes('internal')) {
                        this.loadData();
                    }
                });
            }
        }
        
        if (changedProperties.has('policy') || changedProperties.has('customerId')) {
            await this.loadData();
        }
    }


    @state()
    protected _internalHideCancel: boolean = false;

    private async loadData() {
        this.loading = true;
        this._internalHideCancel = false;
        try {
            this.currentPlan = await this.getCustomerPlan();
            this.currentCustomer = await this.customer();
            
            const defaultPlan = await this.policy.defaultPlan()
            if (defaultPlan && this.currentPlan) {
                this._internalHideCancel = defaultPlan.name === this.currentPlan.name;
            }
        } catch (e) {
            console.error('Error loading current plan data:', e);
            this.currentPlan = null;
            this.currentCustomer = null;
        } finally {
            this.loading = false;
        }
        this.requestUpdate();
    }


    private handleChangePlan() {
        this.showPricingTable = true;
    }


    private handleClosePricingTable() {
        this.showPricingTable = false;
    }


    private async handlePlanSelected(e: CustomEvent) {
        // Re-emit the event for parent components to handle
        const event = new CustomEvent('plan-change', {
            detail: e.detail,
            bubbles: true,
            composed: true,
        });
        this.dispatchEvent(event);
        this.showPricingTable = false;
        await this.loadData();
    }


    private handleCancelPlan() {
        if (confirm("Are you sure you'd like to cancel your subscription?")) {
            // Emit event for parent to handle the cancellation
            const event = new CustomEvent('plan-cancel', {
                detail: {
                    planName: this.currentPlan?.name,
                    customerId: this.customerId
                },
                bubbles: true,
                composed: true,
            });
            this.dispatchEvent(event);

            if (!this.denyPolicyChanges && this.policy) {
                this.policy.wsSend(JSON.stringify({
                    type: 'cancel-subscription',
                    at_period_end: !this.cancelImmediately,
                    customer: this.currentCustomer,
                }));
            }
        }
    }


    private handleResumeSubscription() {
        if (confirm("Are you sure you'd like to resume your subscription?")) {
            // Emit event for parent to handle resuming the subscription
            const event = new CustomEvent('subscription-resume', {
                detail: {
                    planName: this.currentPlan?.name,
                    customerId: this.customerId
                },
                bubbles: true,
                composed: true,
            });
            this.dispatchEvent(event);

            if (!this.denyPolicyChanges && this.policy && !this.cancelImmediately) {
                this.policy.wsSend(JSON.stringify({
                    type: 'resume-stripe-subscription',
                    id: this.customerId,
                }));
            }
        }
    }


    /**
     * Pluralize a unit name if needed based on the value.
     */
    private pluralizeUnit(unit: string, value: number | string): string {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        
        if (numValue === 1) return unit;
        
        const nonPluralUnits = [
            'GB', 'MB', 'KB', 'TB', 'MiB', 'GiB', 'KiB', 'TiB',
            'ms', 'seconds', 'minutes', 'hours', 'days',
            'storage', 'data', 'bandwidth'
        ];
        
        if (nonPluralUnits.includes(unit)) {
            return unit;
        }
        
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
        
        if (!unit.endsWith('s')) {
            return unit + 's';
        }
        
        return unit;
    }


    //deno-lint-ignore no-explicit-any
    private getCouponDetails(metadata: any): { hasDiscount: boolean; discountedAmount: number; originalAmount: number; label: string; durationLabel: string } | null {
        if (!metadata?.stripe_coupon_status || metadata.stripe_coupon_status !== 'applied') {
            return null;
        }

        const price = this.currentPlan?.price;
        if (!price || price.amount === undefined) return null;

        const originalAmount = typeof price.amount === 'string' ? parseFloat(price.amount) : price.amount;
        let discountedAmount = originalAmount;
        let label = '';

        if (metadata.stripe_coupon_percent_off) {
            const percentOff = parseFloat(metadata.stripe_coupon_percent_off);
            discountedAmount = originalAmount * (1 - percentOff / 100);
            label = `${percentOff}% off`;
        } else if (metadata.stripe_coupon_amount_off) {
            const amountOff = parseFloat(metadata.stripe_coupon_amount_off) / 100; // cents -> dollars
            discountedAmount = Math.max(0, originalAmount - amountOff);
            label = `$${amountOff.toFixed(2)} off`;
        }

        // Duration label
        let durationLabel = '';
        const duration = metadata.stripe_coupon_duration;
        if (duration === 'once') {
            durationLabel = 'First period only';
        } else if (duration === 'repeating' && metadata.stripe_coupon_duration_in_months) {
            durationLabel = `First ${metadata.stripe_coupon_duration_in_months} months`;
        }
        // 'forever' = no duration label, it's just the price now

        return {
            hasDiscount: discountedAmount < originalAmount,
            discountedAmount,
            originalAmount,
            label,
            durationLabel,
        };
    }


    /**
     * Check if subscription status is active/valid (not terminated or never activated)
     */
    //deno-lint-ignore no-explicit-any
    private hasActiveSubscription(metadata: any): boolean {
        if (!metadata?.stripe_subscription_id) return false;
        const status = metadata.stripe_subscription_status;
        // Valid statuses: active, trialing, past_due (still active, just payment issue)
        // Invalid: canceled, incomplete_expired, incomplete (never activated), unpaid
        // TODO: remove incomplete - just here for weird testing state
        return status && ['active', 'trialing', 'past_due', 'incomplete'].includes(status);
    }


    //deno-lint-ignore no-explicit-any
    private formatLimitValue(limit: any, creditName: string) {
        if (!limit || limit.value === undefined) return 'Unlimited';
        
        const credit = this.getCredit(creditName);
        const value = limit.value;
        
        if (credit && credit.stof_units && credit.stof_units !== 'float' && credit.stof_units !== 'int') {
            return `${value} ${credit.stof_units}`;
        }
        
        if (credit && credit.unit) {
            const pluralizedUnit = this.pluralizeUnit(credit.unit, value);
            return `${value} ${pluralizedUnit}`;
        }
        
        return `${value}`;
    }


    private formatUsageValue(usage: number, creditName: string): string {
        const credit = this.getCredit(creditName);
        
        if (credit && credit.stof_units && credit.stof_units !== 'float' && credit.stof_units !== 'int') {
            return `${usage} ${credit.stof_units}`;
        }
        
        if (credit && credit.unit) {
            const pluralizedUnit = this.pluralizeUnit(credit.unit, usage);
            return `${usage} ${pluralizedUnit}`;
        }
        
        return `${usage}`;
    }


    //deno-lint-ignore no-explicit-any
    private getUsagePercentage(usage: number, limit: any): number {
        if (!limit || limit.value === undefined) return 0;
        const limitValue = typeof limit.value === 'string' ? parseFloat(limit.value) : limit.value;
        return Math.min(100, (usage / limitValue) * 100);
    }


    private getUsageClass(percentage: number): string {
        if (percentage >= 90) return 'danger';
        if (percentage >= 75) return 'warning';
        return '';
    }


    private formatDate(timestamp: number): string {
        return new Date(timestamp).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }


    //deno-lint-ignore no-explicit-any
    private renderStripeInfo(metadata: any) {
        if (!metadata || !metadata.stripe_subscription_id) return null;

        const status = metadata.stripe_subscription_status || 'unknown';
        const periodStart = metadata.stripe_current_period_start;
        const periodEnd = metadata.stripe_current_period_end;
        const paymentType = metadata.stripe_payment_method_type;
        const last4 = metadata.stripe_payment_method_last4;
        const brand = metadata.stripe_payment_method_brand;
        const cancelAtPeriodEnd = metadata.stripe_cancel_at_period_end;

        return html`
            <div class="stripe-section">
                <h3 class="section-title">Subscription Details</h3>
                <div class="stripe-info">
                    <div class="info-item">
                        <div class="info-label">Status</div>
                        <div class="info-value">
                            <span class="status-badge ${status}">${status}</span>
                            ${cancelAtPeriodEnd ? html`<div style="font-size: 12px; margin-top: 4px; color: var(--limitr-text-secondary);">Cancels at period end</div>` : ''}
                        </div>
                    </div>
                    ${periodStart ? html`
                        <div class="info-item">
                            <div class="info-label">Current Period</div>
                            <div class="info-value" style="font-size: 14px;">
                                ${this.formatDate(periodStart)}<br/>
                                to ${this.formatDate(periodEnd)}
                            </div>
                        </div>
                    ` : ''}
                    ${paymentType && last4 ? html`
                        <div class="info-item">
                            <div class="info-label">Payment Method</div>
                            <div class="info-value">
                                ${brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : paymentType} •••• ${last4}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }


    //deno-lint-ignore no-explicit-any
    private renderUsage(plan: any, customer: any) {
        if (this.hideUsage || !plan || !customer) return null;

        const entitlements = plan.entitlements || {};
        const meters = customer.meters || {};
        
        // Filter to visible entitlements with limits, usage, and the correct scope.
        const customerType = customer.type as string;
        //deno-lint-ignore no-explicit-any
        const usageItems = Object.entries(entitlements).filter(([entName, ent]: [string, any]) => {
            return !ent.hidden && ent.limit && meters[entName] !== undefined && (!ent.scope || ent.scope === customerType);
        });

        if (usageItems.length === 0) return null;

        return html`
            <div class="usage-section">
                <h3 class="section-title">Usage</h3>
                ${
                    //deno-lint-ignore no-explicit-any
                    usageItems.map(([entName, entitlement]: [string, any]) => {
                    const limit = entitlement.limit;
                    const usage = meters[entName]?.value || 0;
                    const percentage = this.getUsagePercentage(usage, limit);
                    const usageClass = this.getUsageClass(percentage);

                    return html`
                        <div class="usage-item">
                            <div class="usage-header">
                                <span class="usage-name">${entitlement.description || entName}</span>
                                <span class="usage-stats">
                                    ${this.formatUsageValue(usage, limit.credit)} / ${this.formatLimitValue(limit, limit.credit)}
                                </span>
                            </div>
                            <div class="usage-bar">
                                <div class="usage-bar-fill ${usageClass}" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                    `;
                })}
            </div>
        `;
    }


    /**
     * Render invoices section if invoices are available in policy.
     */
    private renderInvoices() {
        if (!this.policy || !this.customerId) return null;

        const policy = this.policyRecord;
        if (!policy.invoices || !policy.invoices[this.customerId]) return null;

        const responseObject = policy.invoices[this.customerId];
        const invoices = responseObject?.data.invoices;
        if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
            return null;
        }

        return html`
            <div class="invoices-section">
                <h3 class="section-title">Recent Invoices</h3>
                <div class="invoices-list">
                    ${invoices.map((invoice: any) => html`
                        <div class="invoice-item">
                            <div class="invoice-info">
                                <div class="invoice-number">${invoice.number || invoice.id}</div>
                                <div class="invoice-date">${this.formatDate(invoice.created)}</div>
                            </div>
                            <div class="invoice-amount">
                                ${this.formatCurrency(invoice.total, invoice.currency)}
                            </div>
                            <div class="invoice-status">
                                <span class="status-badge ${invoice.status}">${invoice.status}</span>
                            </div>
                            ${invoice.invoice_pdf || invoice.hosted_invoice_url ? html`
                                <a 
                                    href="${invoice.invoice_pdf || invoice.hosted_invoice_url}" 
                                    target="_blank" 
                                    class="invoice-download"
                                >
                                    Download
                                </a>
                            ` : nothing}
                        </div>
                    `)}
                </div>
            </div>
        `;
    }


    /**
     * Format currency value
     */
    private formatCurrency(amountInCents: number, currency: string = 'usd'): string {
        const amount = amountInCents / 100;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency.toUpperCase(),
        }).format(amount);
    }


    /**
     * Render.
     */
    override render(): unknown {
        if (this.loading) {
            return html`<div class="loading">Loading plan information...</div>`;
        }

        if (!this.currentPlan) {
            return html`
                <div class="empty">
                    <div class="empty-title">No Plan Selected</div>
                    <p>You don't have an active plan yet.</p>
                </div>
            `;
        }

        const price = this.currentPlan.price;
        const metadata = this.currentCustomer?.metadata || {};
        const hasActiveSubscription = this.hasActiveSubscription(metadata);
        const cancelAtPeriodEnd = metadata.stripe_cancel_at_period_end === true || metadata.stripe_cancel_at_period_end === 'true';
        const coupon = this.getCouponDetails(metadata);

        return html`
            <div class="container">
                <div class="plan-card">
                    <div class="plan-header">
                        <div class="plan-info">
                            <div class="plan-label">Current Plan</div>
                            <h2 class="plan-name">${this.currentPlan.label || this.currentPlan.name}</h2>
                            ${price ? html`
                                <div class="plan-price">
                                    ${coupon?.hasDiscount ? html`
                                        <span class="price-original">${price.prefix || ''}${typeof price.amount === 'number' ? price.amount.toFixed(2) : price.amount}</span>
                                    ` : ''}
                                    ${price.prefix || ''}
                                    <span class="price-amount">${coupon?.hasDiscount ? coupon.discountedAmount.toFixed(2) : (typeof price.amount === 'number' ? price.amount.toFixed(2) : price.amount)}</span>
                                    ${price.suffix || ''}
                                </div>
                                ${coupon?.hasDiscount ? html`
                                    <div class="coupon-badge">
                                        <span class="coupon-tag-icon">🏷️</span>
                                        ${metadata.stripe_coupon_name || metadata.stripe_coupon_code} — ${coupon.label}
                                    </div>
                                    ${coupon.durationLabel ? html`
                                        <div class="coupon-duration">${coupon.durationLabel}</div>
                                    ` : ''}
                                ` : ''}
                            ` : ''}
                        </div>
                        <div class="plan-actions">
                            <button class="change-plan-btn" @click=${this.handleChangePlan}>
                                Change Plan
                            </button>
                            ${this.stripePortalUrl ? html`
                                <button class="change-plan-btn" @click=${() => globalThis.location.href = this.stripePortalUrl}>
                                    Manage Billing
                                </button>
                            ` : nothing}
                            ${!this.hideCancel && !this._internalHideCancel && hasActiveSubscription ? html`
                                ${cancelAtPeriodEnd ? html`
                                    <button class="resume-plan-btn" @click=${this.handleResumeSubscription}>
                                        Resume Subscription
                                    </button>
                                ` : html`
                                    <button class="cancel-plan-btn" @click=${this.handleCancelPlan}>
                                        Cancel Plan
                                    </button>
                                `}
                            ` : nothing}
                        </div>
                    </div>

                    ${this.renderUsage(this.currentPlan, this.currentCustomer)}
                    ${this.showStripeInfo && hasActiveSubscription ? this.renderStripeInfo(metadata) : ''}
                    ${this.renderInvoices()}
                </div>
            </div>

            ${this.showPricingTable ? html`
                <div class="modal-overlay" @click=${this.handleClosePricingTable}>
                    <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
                        <div class="modal-header">
                            <h2 class="modal-title">Select a Plan</h2>
                            <button class="close-btn" @click=${this.handleClosePricingTable}>&times;</button>
                        </div>
                        <limitr-pricing-table
                            .policy=${this.policy as any}
                            .customerId=${this.customerId}
                            .stripePortalUrl=${this.stripePortalUrl}
                            ?denyPolicyChanges=${this.denyPolicyChanges}
                            theme=${this.theme}
                            @plan-select=${this.handlePlanSelected}
                            ?requestStripeInvoices=${false}
                            ?requestStripePortalUrl=${false}
                            ?interactive=${true}
                        ></limitr-pricing-table>
                    </div>
                </div>
            ` : ''}
        `;
    }
}
