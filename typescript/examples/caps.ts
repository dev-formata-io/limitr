// npm i @formata/limitr
import { Limitr } from '@formata/limitr';

// JSON, YAML, TOML, or STOF (default)
const doc = `
policy: {
    credits: {
        claude_sonnet_4: {
            overhead_cost: 0.00014
            price: { amount: 0.0003 }
        }
        cloud_mb: {
            overhead_cost: 0.01
            price: { amount: 0.05 }
            stof_units: 'MB'
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
                        mode: 'soft'  // allow overage & send overage events
                        value: 16667  // ~$50 included at $0.0003/token
                        resets: true
                        reset_sch: 'monthly:1'
                    }
                }
                file_upload: {
                    description: 'Upload a file to cloud'
                    limit: {
                        credit: 'cloud_mb'
                        mode: 'soft'
                        value: 0 // overage instantly
                    }
                }
            }
        }
    }
}`;

// init, login, and create customer only if needed
const policy = await Limitr.new(doc);
const userId = 'cus_123';
await policy.ensureCustomer(userId, 'starter', 'user', 'Jane Doe', [], [], {
  email: 'jane@example.com',
});

// simulate vendor calls for the logged in user
async function llm(tokens: number) {
    await policy.allow(userId, 'ai_chat', tokens);
}
async function cloud(bytes: number | string) {
    const val = typeof bytes === 'string' ? bytes : bytes + 'bytes';
    await policy.allow(userId, 'file_upload', val);
}

await policy.addCustomerCap(userId, 0, {
    cap_id: 'cloud_only',
    observe_only: true,
    credit: 'cloud_mb',
});

// LLM pipeline
await policy.startMarginMeasurement(userId, 'pipeline', false);
await Promise.all([
    llm(6420),
    cloud('1.42GB'),
    llm(2420),
    cloud('4.2MB'),
    llm(4420),
    cloud('24.45MiB'),
]);
const res = await policy.captureMarginMeasurement(userId, 'pipeline');

if (res) {
    console.log(`Charged: $${res.charged}`);
    console.log(`Overhead: $${res.costs}`);
    console.log(`Margin: ${res.margin}%`);
}


const cloudOnly = await policy.customerCap(userId, 'cloud_only');
const mbs = cloudOnly?.meter_value ?? 0;
console.log(`\nCloud MB: ${mbs}`);
console.log(`Charged: $${await policy.creditExchange('cloud_mb', 'rune', mbs)}`);
