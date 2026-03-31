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
Square: {
    float x: 0
    float y: 0
    fn area() -> float { self.x * self.y }
}`);

policy.doc.lib('Std', 'pln', (...args: unknown[]) => console.log(...args)); // host funcs, like fetch - full async support
await policy.setCapabilities(`
area: {
    version: 0.1.0-beta
    description: 'Get the area of a shape'
    parameters: [
        { name: 'shape', description: 'Generator Stof that contains a "gen" field with a func' },
        { name: 'units', description: 'Stof units for the resulting area presented back to user' },
    ]
    result: 'area'

    #[run(0)]
    fn setup_area() {
        const shape = new {} on self.input; // auto cleanup next run... no mem management
        parse(self.input.shape, shape, 'stof');
        self.input.shape = shape.gen();
        self.input.units = self.input.units as str ?? 'float';
    }

    #[run(1)]
    fn calculate() {
        self.output.area = self.input.shape.area().to_units(self.input.units).round(2);
    }
}`);


const toolUse = {
    type: 'tool_use',
    id: 'toolu_21345',
    name: 'area',
    input: {
        'shape': `gen: (): obj => new Square { x: 3ft, y: 4ft }`,
        'units': 'm'
    }
};
const result = await policy.claudeToolUse(toolUse);
console.log(result);

/* {
  type: "tool_result",
  tool_use_id: "toolu_21345",
  content: "3.66",
} */