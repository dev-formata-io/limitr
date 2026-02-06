# Limitr UI
Open-source and vibe-code friendly UI library for [Limitr](https://limitr.dev).

## Example
To show a customer's current Limitr plan information, usage, Stripe subscription details, recent invoices, billing management options, cancel/resume actions, plan selection table, etc, just import and include the limitr-current-plan component like so.

> See [@formata/limitr](https://github.com/dev-formata-io/limitr) for more information on Limitr pricing policies, and check out [Limitr Cloud](https://cloud.limitr.dev) to implement your pricing in a few minutes.

```typescript
renderCurrentUserSubscription(customerId: string) {
    const policy: any = this.policy ?? new Limitr();
    return html`
        <div class="section">
            <div class="section-header">
                <h2 class="section-title">Subscription</h2>
            </div>
            <div class="section-content">
                <limitr-current-plan
                    .policy=${policy}
                    .customerId=${customerId}
                    ?showStripeInfo=${true}
                    ?cancelImmediately=${false}
                    ?requestStripeInvoices=${true}
                    ?requestStripePortalUrl=${true}
                ></limitr-current-plan>
            </div>
        </div>
    `;
}
```