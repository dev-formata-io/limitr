import { Limitr } from '@formata/limitr';

const policy = await Limitr.new(`policy: {
credits: {
  claude_sonnet_5: { overhead_cost: 2e-6, price: { amount: 3e-6 } }
}
exchange: {
    // 1 Euro = 1.14 USD
    euro: { value: 1.14, currency: 'usd' }
    cfa_franc: { value: 0.0017, currency: 'usd' }
}
plans: {
  pro: {
    label: 'Pro Plan'
    entitlements: {
      ai_chat: {
        description: 'AI chat feature'
        limit: { credit: 'claude_sonnet_5', mode: 'soft', value: 10_000, resets: true }
      }
    }
  }
}}`);

const userId = 'cus_123';
await policy.createCustomer(userId, 'pro');

async function llm(tokens: number) {
    if (await policy.allow(userId, 'ai_chat', tokens)) { /* Call to LLM */ }
    else { throw Error('token limit hit, purchase topup to continue') }
}

await policy.startMarginMeasurement(userId, 'ai_pipeline', undefined, undefined, 'usd');
await Promise.allSettled([
    llm(4200),
    llm(6000), // 10k tokens included in pro plan (200 over right now)
    llm(4000),
    llm(6580),
    llm(3560),
    llm(42000),
    llm(6302945),
]);

const res = await policy.captureMarginMeasurement(userId, 'ai_pipeline');
console.log(`User charged: $${res?.charged}`);
console.log(`Overhead cost: $${res?.costs}`);
console.log(`Margin: ${res?.margin}%`);;

/*
User charged: $0.03
Overhead cost: $0.04
Margin: -28.51%
*/