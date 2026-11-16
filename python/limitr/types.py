#
# Copyright 2026 Formata, Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

"""The shapes the Limitr engine returns, as typed dicts (the same fields as the TypeScript SDK's types)."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict


DecisionReason = Literal[
    'no_customer',   # no such customer
    'expired',       # the customer's access has ended (set_customer_expires)
    'not_entitled',  # neither its plan, its gives, its rules, nor its refs have the entitlement
    'taken',         # taken from the customer (take_entitlement) or by one of its rules (`access` says which)
    'no_scope',      # the entitlement is scoped to a customer type with none up the customer's refs
    'disabled',      # the entitlement's `enabled` said no for this call (Ex. a rollout or kill switch)
    'cap',           # a spend cap has no room (`cap` and `cap_customer` name it)
    'governor',      # the rate governor hasn't refilled enough (`available` says how much it has)
    'limit',         # a hard limit, with no grants left to cover the rest
    'held',          # the call fits on its own, but room held by reservations doesn't leave enough
    'unconnected',   # Limitr Cloud is disconnected, and the policy refuses calls until it's back (deny_unconnected)
]
"""Why a call was refused (a decision's `reason`)."""


class Decision(TypedDict, total=False):
    """
    What allow() or check() decided and why (with `detail=True`), and where the customer stands: after the call for
    allow(), as things are for check(). Values are in the credit's units. Fields that don't apply are None (Ex. a
    feature flag has no credit, limit, or remaining).
    """
    allowed: bool
    reason: Optional[DecisionReason]
    customer: str             # whose meter it is (Ex. the org's for an entitlement scoped to 'org')
    entitlement: str
    value: float              # the call's value
    credit: Optional[str]
    mode: Optional[Literal['hard', 'soft', 'observe']]
    used: Optional[float]     # metered this period
    limit: Optional[float]    # the limit, including grants
    remaining: Optional[float]
    allowance: Optional[float]  # what can be used right now (less when a governor allows less)
    held: float               # room held by reservations
    resets: Optional[float]   # when the meter resets (ms timestamp)
    access: Optional[str]     # 'plan', 'given', 'taken', 'rule:<name>', 'ref:<id>', 'default'
    limit_source: Optional[str]  # 'override', 'rule:<name>', 'plan', or None
    cap: str                  # reason 'cap': the cap's ID
    cap_customer: str         # reason 'cap': the customer holding it
    available: float          # reason 'governor': how much the governor has available


class EntitlementSource(TypedDict):
    """Where a customer's entitlement comes from (entitlement_source)."""
    access: str
    limit: Optional[str]
    customer: str


class Estimate(TypedDict):
    """A predicted call (estimate)."""
    value: float      # predicted usage for one call, in the credit's units
    overhead: float   # predicted provider overhead for one call, in runes (typically USD)
    samples: int      # observations behind the estimate
    source: str       # 'local' (learned in this engine) or 'cloud' (seeded or pooled by Limitr Cloud)
    scope: str        # 'customer' (this customer's own usage) or 'policy' (everyone's)


Customer = Dict[str, Any]
"""A customer record: id, plan, alt_ids, refs, type, label, meters, overrides, given, taken, rules, grants, caps,
metadata, period_start, period_end, expires."""

Cap = Dict[str, Any]
"""A standing spend cap: id, credit, value, meter_value, exchangeable, ignore_grants, overage_only, observe_only,
overhead_cost, follow_decrements, hard_trailing, shared, shared_with, scope, resets, reset_inc, reset_sch, ..."""

Record = Dict[str, Any]
EventHandler = Any
"""An event handler: `handler(name: str, value: Any)`. Objects arrive as dicts."""

__all__ = ['DecisionReason', 'Decision', 'EntitlementSource', 'Estimate', 'Customer', 'Cap', 'Record', 'EventHandler', 'List']
