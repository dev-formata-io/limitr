
import { Limitr } from '../main.ts';

// Create our policy - could also come from Cloud (see docs)
const doc = `
policy: {
    credits: {
        claude_sonnet_4: {
            description: 'Claude sonnet 4 token'
            resets: true
            overhead_cost: 1.5e-7
            price: { amount: 0.0003 }
        }
    }

    plans: {
        starter: {
            label: 'Starter Plan'
            entitlements: {
                ai_chat: {
                    description: 'AI chat feature'
                    limit: {
                        credit: 'claude_sonnet_4'
                        mode: 'soft'           // allow overage (not hard limit)
                        value: 0               // start overage right away
                        resets: true
                        reset_sch: 'monthly:1' // meter resets on the 1st of every month
                    }
                }
            }
        }
    }
}`;
const policy = await Limitr.new(doc);

// Create a customer
await policy.createCustomer('cus_123', 'starter', 'user', 'Jane Doe', [], [], { email: 'jane@example.com' });

// Place a $2 cap on pipeline spend
await policy.addCustomerCap('cus_123', 2, { cap_id: 'pipeline_usd_cap' });

// Spend!!! Call into LLMs, upload files, do GPU stuff, etc. Limitr handles it all
if (await policy.allow('cus_123', 'ai_chat', 6420)) {
    // call to llm chat allowed and recorded - full API to help here with any token strategy
}

// Block overspend
if (await policy.allow('cus_123', 'ai_chat', 2000)) {
    console.error('WILL NOT GET HERE');
}

// Remove the temp cap on spend
const cap = await policy.customerCap('cus_123', 'pipeline_usd_cap');
await policy.removeCustomerCap('cus_123', 'pipeline_usd_cap');

console.log(`Customer spent $${cap?.meter_value ?? 0} in pipeline`);
