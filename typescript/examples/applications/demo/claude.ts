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

import Anthropic from 'npm:@anthropic-ai/sdk';
import { claudeModel, customer, policy } from "./limitr.ts";
const client = new Anthropic({
    apiKey: 'TOKEN',
});


/**
 * Summarize some text, using Limitr for keeping track.
 */
export async function summarize(id: string, name: string, message: string): Promise<Record<string, unknown>> {
    // Get (or create) customer in Limitr Cloud
    const limitrCustomer = await customer(id, name);

    // Get the claude model to use for this customer given limits (potential downgrades)
    const model = claudeModel(limitrCustomer);

    // Count the number of tokens we are about to use (free claude service endpoint)
    const count = await claudeCountTokens(message, model);

    // Check the active policy and do metering (could be a hard limit)
    const res: Record<string, unknown> = {};
    if (policy && await policy.allow(id, 'summary_tokens', count)) {
        res.summary = await claudeSummarize(message, model);

        // add extras just for reference
        {
            res.model = model;
            res.count = count;
            
            const limitr = {} as Record<string, unknown>;
            limitr.meter = await policy.value(id, 'summary_tokens');
            limitr.remaining = await policy.remaining(id, 'summary_tokens');
            limitr.limit = await policy.limit(id, 'summary_tokens');
            res.limitr = limitr;
        }
    } else {
        res.error = 'hard token limit reached: no summary available';
    }
    return res;
}


/**
 * Count tokens with Claude, without incurring any costs.
 */
async function claudeCountTokens(message: string, model: string = 'claude-haiku-4-5-20251001'): Promise<number> {
    const res = await client.messages.countTokens({
        messages: [{ role: 'user', content: message }],
        model,
        system: 'You summarize text like Goofy'
    });
    return res.input_tokens;
}


/**
 * Summarize some text with Claude.
 */
async function claudeSummarize(message: string, model: string = 'claude-haiku-4-5-20251001'): Promise<string> {
    const msg = await client.messages.create({
        max_tokens: 1024,
        messages: [{ role: 'user', content: message }],
        model,
        system: 'You summarize text like Goofy'
    });

    if (msg.content && msg.content.length > 0 && msg.content[0].type === 'text') {
        const response = msg.content[0].text;
        return response;
    }
    return '';
}
