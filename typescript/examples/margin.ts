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

import { Limitr } from '../main';


const policy = await Limitr.new(`
Limitr policy: {
    credits: {
        ai_token: {
            description: 'AI token'
            overhead_cost: 0.000004
            stof_units: 'int'
            price: { amount: 0.000006 }
        }

        mb_storage: {
            description: 'MB of storage'
            overhead_cost: 0.6
            stof_units: 'MB'

            pricing_model: 'tiered'
            tiers: [
                { up_to: 5, price: { amount: 0.8 } },
                { up_to: 10, price: { amount: 0.7 } },
                { up_to: 50, price: { amount: 0.6 } },
                { price: { amount: 0.55 } },
            ]
        }
    }

    plans: {
        basic: {
            label: 'Basic'
            price: { amount: 10 }
            entitlements: {
                file_storage: {
                    description: 'File storage'
                    limit: {
                        credit: 'mb_storage'
                        mode: 'soft'
                        value: 2MB
                    }
                }
            }
        }
        pro: {
            label: 'Pro'
            price: { amount: 50 }
            entitlements: {
                file_storage: {
                    description: 'File storage'
                    limit: {
                        credit: 'mb_storage'
                        mode: 'soft'
                        value: 10MB
                    }
                }

                tokens: {
                    description: 'AI tokens'
                    limit: {
                        credit: 'ai_token'
                        mode: 'soft'
                        value: 100_000
                    }
                }
            }
        }
    }
}`);


console.log(await policy.marginSnapshot('pro', new Map<string, unknown>([
    ['file_storage', '70MB'],
    ['tokens', new Map([
        ['meter', 2300000],
        ['limit', 100000]
    ])]
])));
