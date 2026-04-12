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

// Default "new" functionality is to validate as well, and throw if invalid
const start = await Limitr.new(`
policy: {
    credits: {
        seat: {
            unit: 'seat'
            description: 'A seat.'
            label: 'Seat'
            stof_units: 'int'
        }
        storage_gb: {
            unit: 'storage'
            description: 'A Gigabyte of storage.'
            label: 'GB Storage'
            stof_units: 'GB'
            price: {
                amount: 3
            }
        }
    }
    plans: {
        free: {
            label: 'Free Plan'
            default: true
            price: { amount: 100 }
            entitlements: {
                seats: {
                    description: 'How many seats available on the free plan?'
                    scope: 'org'
                    limit: {
                        credit: 'seat'
                        value: 1
                        increment: 1
                    }
                }
                file_storage: {
                    description: 'How much file storage (GB) available on the free plan?'
                    scope: 'user'
                    limit: {
                        credit: 'storage_gb'
                        value: '34TiB'
                    }
                }
            }
        }
    }
}`);

const end = await Limitr.new(`
policy: {
    credits: {
        seat: {
            unit: 'seat'
            description: 'A seat.'
            label: 'Seat'
            stof_units: 'int'
        }
        storage_gb: {
            unit: 'storage'
            description: 'A Gigabyte of storage.'
            label: 'GB Storage'
            stof_units: 'GB'
            price: {
                amount: 3
            }
        }
    }
    plans: {
        free: {
            label: 'Free Plan'
            default: true
            price: { amount: 100 }
            entitlements: {
                seats: {
                    description: 'How many seats available on the free plan?'
                    scope: 'org'
                    limit: {
                        credit: 'seat'
                        value: 3
                        increment: 1
                    }
                }
                file_storage: {
                    description: 'How much file storage (GB) available on the free plan?'
                    scope: 'user'
                    limit: {
                        credit: 'storage_gb'
                        value: '34TiB'
                    }
                }
            }
        }
    }
}`);

const diff = await start.difference(end);
console.log(JSON.stringify(diff, undefined, 4));
