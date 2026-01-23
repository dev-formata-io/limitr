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

//deno-lint-ignore no-import-prefix no-unversioned-import
import Anthropic from 'npm:@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: 'TOKEN' });


/**
 * Get the Claude model for a Limitr customer model, based on metadata.
 */
export function claudeModel(customer: Record<string, unknown>): string {
    if (!customer.metadata) customer.metadata = { model: 'good' };
    const meta = customer.metadata as Record<string, unknown>;
    const state = meta.model as string ?? 'good';
    switch (state) {
        case 'good': return 'claude-haiku-4-5-20251001';
        default: return 'claude-3-haiku-20240307';
    }
}


/**
 * Count tokens with Claude, without incurring any costs.
 */
export async function claudeCountTokens(message: string, model: string = 'claude-haiku-4-5-20251001'): Promise<number> {
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
export async function claudeSummarize(message: string, model: string = 'claude-haiku-4-5-20251001'): Promise<string> {
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
