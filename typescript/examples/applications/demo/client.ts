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


const users: [string, string][] = [];
for (let i = 0; i < 100; i++) users.push([`usr_${i}`, `User ${i}`]);

const current = 0;
const message = `
    Tell me 5 really good jokes about software.
`;

const response = await fetch('http://127.0.0.1:4242/summarize', {
    method: 'POST',
    body: JSON.stringify({
        id: users[current][0],
        name: users[current][1],
        message,
    }),
});
console.log(await response.json());
