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

import { Limitr } from "../main.ts";
const policy = await Limitr.new();

policy.doc.parse(`
#[type]
#[extends('Capability')]
GetEndpoint: {
    str endpoint: '';
    list query: [];

    #[run]
    fn get_request() {
        const query = new {};
        for (const q in self.query) {
            const v = self.input.get(q);
            if (v != null) query.insert(q, v);
        }

        let endpoint = self.endpoint;
        if (query.len() > 0) endpoint += '?' + stringify('urlencoded', query);
        drop(query);
        
        // const res = await Http.fetch(endpoint); // really exists, but just testing for now
        const res = 'Calling GET for: ' + endpoint;
        self.set_result(res);
    }
}`);

policy.doc.lib('Std', 'pln', (...args: unknown[]) => console.log(...args)); // host funcs, like fetch - full async support
await policy.setCapabilities(`
GetEndpoint weather-forecast: {
    version: 0.1.0;
    description: 'Get weather example';
    parameters: [
        { name: 'latitude',  description: 'Latitude of the region for a weather forecast',  schema_type: 'number' },
        { name: 'longitude', description: 'Longitude of the region for a weather forecast', schema_type: 'number' }
    ];
    endpoint: 'https://examplegetweather.com';
    query: ['latitude', 'longitude'];
}`);

const toolUse = {
    type: 'tool_use',
    id: 'toolu_21345',
    name: 'weather-forecast',
    input: {
        latitude: 23,
        longitude: 42,
    }
};
const result = await policy.claudeToolUse(toolUse);
console.log(result);
