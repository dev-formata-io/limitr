# 7. AI calls: reserve and settle

AI calls break two assumptions from the earlier chapters:

1. **You don't know the size of the call until it's done.** You know the prompt, but not how many tokens the answer
   will use.
2. **The cost isn't one number per token.** It depends on the model, and input and output tokens are priced
   differently.

Limitr handles the first with **reserve and settle**: hold room before the call, then record what it really used.
It handles the second with a **cost function** in the policy.

```ts
import { Limitr } from '@formata/limitr';

const limitr = await Limitr.new(`
policy: {
    credits: {
        ai_token: {
            label: 'AI token'
            price: { amount: 0.00002 }
            overhead_cost: 0.000005               // fallback cost per token
            rates: {                              // what each model costs you, per token
                large: { input: 0.000003, output: 0.000015 }
                small: { input: 0.000001, output: 0.000005 }
            }
            // The cost of one call, from the event data you pass (model, input and output tokens).
            fn overhead(units: float, context?: obj) -> float {
                const rate = self.rates.get(context?.model ?? '');
                if (rate == null) return units * self.overhead_cost;
                (context.input * rate.input) + (context.output * rate.output)
            }
        }
    }
    plans: {
        pro: {
            default: true
            entitlements: {
                // A call's size scales with its input tokens, and each model learns its own estimate.
                chat: {
                    estimate_basis: 'input'
                    estimate_segment: 'model'
                    limit: { credit: 'ai_token', mode: 'hard', value: 100_000, resets: true }
                }
            }
        }
    }
}`);
await limitr.ensureCustomer('ada');

// Pretend model call: the output is about twice the input.
const callModel = async (model: string, input: number, ratio: number) => ({ model, input, output: Math.round(input * ratio) });

const calls = [[500, 1.8], [800, 2.1], [1200, 2.3], [400, 1.9], [1000, 2.0], [900, 2.2]];
for (const [input, ratio] of calls) {
    const context = { model: 'large', input };
    const hold = await limitr.reserve('ada', 'chat', { context });   // holds the predicted size of this call
    if (!hold) { console.log('not enough room for this call'); break; }
    const held = await limitr.held('ada', 'chat');

    const usage = await callModel('large', input, ratio);                   // run the call
    await limitr.settle('ada', 'chat', hold, usage.input + usage.output, usage);
    console.log(`input ${input}: held ${Math.round(held)}, used ${usage.input + usage.output}`);
}

const estimate = await limitr.estimate('ada', 'chat', { context: { model: 'large', input: 2000 } });
console.log(`a 2,000-token prompt on 'large' should use about ${Math.round(estimate?.value ?? 0)} tokens and cost $${estimate?.overhead.toFixed(4)}`);
```

It prints:

```text
input 500: held 1, used 1400
input 800: held 2240, used 2480
input 1200: held 3771, used 3960
input 400: held 1332, used 1160
input 1000: held 3271, used 3000
input 900: held 2916, used 2880
a 2,000-token prompt on 'large' should use about 6538 tokens and cost $0.0741
```

What happened:

- **The cost function.** The `ai_token` credit has an `overhead(units, context)` function. `context` is the event data
  you pass with the call (`{ model, input, output }` here), so each call is priced from the model's own input and
  output rates. A credit without one uses its fixed `overhead_cost`. Because the rates are part of the policy, you
  can change them when a provider changes its prices, without touching your app.
- **reserve** checks that the call is allowed and holds room for it, so ten calls running at once can't all squeeze
  past the limit. With no `value`, it holds what it predicts the call will use. It returns a hold ID, or `null` when
  the call shouldn't run.
- **settle** records what the call really used (the provider tells you) and lets go of the hold. If the call fails,
  `release` the hold instead. Holds also expire on their own after 10 minutes.
- **Learning.** Every settle teaches the engine how big calls are. The first call had nothing to learn from, so it held
  a single token; after that, holds track the real usage. `estimate_basis: 'input'` says that a call's size scales
  with its input, so a long prompt holds more than a short one. `estimate_segment: 'model'` keeps a separate estimate
  per model, since a small model and a large one answer differently.
- **estimate** asks for a prediction without holding anything, here for a 2,000-token prompt. It answers at the 90th
  percentile by default (`quantile: 0.9`), so most calls come in under it.

If your provider reports the exact cost of a call, pass it as `overhead` to `settle` (or `allow`) and the engine
records that instead of computing it.

Next: [Stacking entitlements](08-stacking-entitlements.md)
