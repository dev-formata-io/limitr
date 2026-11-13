// A live check of the recipe against the real Claude Messages API. It makes a few small model calls.
//
// 1. Paste an Anthropic API key below (or set ANTHROPIC_API_KEY in your shell).
// 2. npm install (once), build the engine package (cd ../.. && npm run build), then: npm run live
//
// Run 1: a tool loop where the customer's plan allows 1 weather lookup. The model is asked for two cities, so the
//        second lookup is answered with the reason instead of running.
// Run 2: the customer has 600 tokens. The first call's max_tokens is capped at what's left; once they run out,
//        the next call is refused before it reaches the API.
import Anthropic from '@anthropic-ai/sdk';
import { Limitr } from '@formata/limitr';
import { governedCreate, decideToolUse, TOKENS } from './limitr-messages.ts';

const ANTHROPIC_API_KEY = '';   // <- paste your key here, or leave empty to use the environment
if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Add an API key at the top of live.mjs (or set ANTHROPIC_API_KEY), then run again.');
    process.exit(1);
}

const client = new Anthropic();
const model = 'claude-haiku-5-5';
const policy = await Limitr.new(`
policy: {
    credits: {
        call: { label: 'Tool call' }
        ai_token: { label: 'AI token' }
    }
    plans: {
        one_lookup: {
            default: true
            entitlements: {
                weather: { limit: { credit: 'call', mode: 'hard', value: 1 } }
                ai_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1_000_000 } }
            }
        }
        few_tokens: {
            entitlements: {
                ai_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 600 } }
            }
        }
    }
}`);

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };
const weatherTool = {
    name: 'get_weather',
    description: 'Current weather for one city.',
    input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

// Run 1: a tool loop with one weather lookup allowed.
await policy.ensureCustomer('live_lookup', 'one_lookup');
const messages = [{ role: 'user', content: 'What is the weather in Boston and in Paris? Look them up one at a time ' +
    '(one tool call per turn). If a lookup is refused, tell me the exact reason you were given.' }];
let denials = 0;
let usage = 0;
for (let turn = 0; turn < 6; turn++) {
    const res = await governedCreate(policy, client, 'live_lookup', { model, max_tokens: 1024, messages, tools: [weatherTool] });
    if ('refused' in res) { console.log('refused:', res.refused); break; }
    const m = res.message;
    usage += m.usage.input_tokens + m.usage.output_tokens + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0);
    messages.push({ role: 'assistant', content: m.content });
    const uses = m.content.filter((b) => b.type === 'tool_use');
    if (uses.length === 0) { console.log('\nRun 1 answer:', m.content.find((b) => b.type === 'text')?.text); break; }
    const results = [];
    for (const use of uses) {
        const refusal = await decideToolUse(policy, 'live_lookup', use);
        if (refusal) { denials++; results.push(refusal); continue; }
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Sunny, 18°C in ${use.input.city}` });
    }
    messages.push({ role: 'user', content: results });
}
check(await policy.value('live_lookup', 'weather') === 1, 'one weather lookup was counted');
check(denials >= 1, 'the second lookup was answered with the reason');
check(await policy.value('live_lookup', TOKENS) === usage, 'every call\'s real usage was recorded');
check(await policy.held('live_lookup', TOKENS) === 0, 'no room left held');

// Run 2: max_tokens capped at what's left, then refused before the API once tokens run out.
await policy.ensureCustomer('live_tokens', 'few_tokens');
const ask = { model, max_tokens: 4096, messages: [{ role: 'user', content: 'Write a long story about a lighthouse.' }] };
const first = await governedCreate(policy, client, 'live_tokens', ask);
const used = await policy.value('live_tokens', TOKENS);
console.log('\nRun 2 first call:', 'message' in first ? `${first.message.usage.output_tokens} output tokens, stop: ${first.message.stop_reason}` : first.refused);
check('message' in first && first.message.usage.output_tokens < 600, 'the answer was capped at the tokens left');
check(used <= 600, `usage stayed within the allowance (${used} of 600)`);
const again = await governedCreate(policy, client, 'live_tokens', ask);
console.log('Run 2 second call:', 'refused' in again ? again.refused : 'ran');
check('refused' in again, 'the next call was refused before the API');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
