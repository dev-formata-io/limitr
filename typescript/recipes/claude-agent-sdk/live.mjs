// A live check of the recipe against the real Claude Agent SDK and API. It makes a few small model calls.
//
// 1. Paste an Anthropic API key below (or set ANTHROPIC_API_KEY in your shell).
// 2. npm install (once), build the engine package (cd ../.. && npm run build), then: npm run live
//
// Run 1: the customer's plan allows 1 Bash call. The agent is asked to run 2 commands, so the second is denied by
//        the PreToolUse hook and the agent sees why.
// Run 2: the customer's plan allows 1 AI token. The first response is metered (past the limit, it already happened)
//        and the PostToolBatch hook stops the run before its next model request.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Limitr } from '@formata/limitr';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { governed, metered, TOKENS } from './limitr-agent.ts';

const ANTHROPIC_API_KEY = '';   // <- paste your key here, or leave empty to use the environment
if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Add an API key at the top of live.mjs (or set ANTHROPIC_API_KEY), then run again.');
    process.exit(1);
}

const policy = await Limitr.new(`
policy: {
    credits: {
        call: { label: 'Tool call' }
        ai_token: { label: 'AI token' }
    }
    plans: {
        one_call: {
            default: true
            entitlements: {
                shell: { limit: { credit: 'call', mode: 'hard', value: 1 } }
                agent_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 10_000_000 } }
            }
        }
        no_tokens: {
            entitlements: {
                shell: { limit: { credit: 'call', mode: 'hard', value: 100 } }
                agent_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1 } }
            }
        }
    }
}`);

const cwd = mkdtempSync(join(tmpdir(), 'limitr-live-'));
const base = { model: 'claude-haiku-5-5', cwd, allowedTools: ['Bash'], maxTurns: 8, settingSources: [] };
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

async function run(customer, prompt) {
    const denials = [];
    let result = null;
    let toolUses = 0;
    const q = query({ prompt, options: await governed(policy, customer, base) });
    for await (const msg of metered(policy, customer, q)) {
        if (msg.type === 'assistant') {
            for (const block of msg.message.content) if (block.type === 'tool_use') toolUses++;
        }
        if (msg.type === 'user' && Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
                if (block.type === 'tool_result' && block.is_error) denials.push(JSON.stringify(block.content));
            }
        }
        if (msg.type === 'result') result = msg;
    }
    return { denials, result, toolUses };
}

// Run 1: the second Bash call is denied with the reason.
await policy.ensureCustomer('live_one_call', 'one_call');
const one = await run('live_one_call',
    'Use the Bash tool twice, as two separate tool calls: first run `echo one`, then run `echo two`. ' +
    'If a call is denied, tell me the exact reason you were given.');
console.log('\nRun 1 denials:', one.denials);
console.log('Run 1 answer:', one.result?.subtype === 'success' ? one.result.result : one.result?.subtype);
check(await policy.value('live_one_call', 'shell') === 1, 'one Bash call was counted');
check(one.denials.some((d) => d.includes('shell limit reached')), 'the second Bash call was denied with the reason');
check((await policy.value('live_one_call', TOKENS)) > 0, 'model tokens were metered');

// Run 2: out of tokens after the first response, so the run stops before the next model request.
await policy.ensureCustomer('live_no_tokens', 'no_tokens');
const two = await run('live_no_tokens', 'Use the Bash tool to run `echo hi`, then tell me what it printed.');
console.log('\nRun 2 result:', two.result?.subtype, two.result?.stop_reason ?? '');
console.log('Run 2 tokens metered:', await policy.value('live_no_tokens', TOKENS));
check((await policy.value('live_no_tokens', TOKENS)) > 1, 'the first response was metered past the limit');
check(two.toolUses <= 1, 'the run stopped before another model request');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
