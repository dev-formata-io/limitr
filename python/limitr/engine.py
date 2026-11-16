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

"""The Limitr engine for Python: a Limitr policy run in-process in a Stof document."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import threading
import weakref
from contextlib import contextmanager
from datetime import datetime
from importlib import resources
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple, Union

from pystof import Doc

from .types import Cap, Customer, Decision, EntitlementSource, Estimate, Record

log = logging.getLogger('limitr')

Policy = Union[str, Dict[str, Any], bytes, bytearray]
Context = Union[str, Dict[str, Any], None]
Event = Union[bool, str, Dict[str, Any]]
Time = Union[int, float, datetime, None]

_engine_bytes: Optional[bytes] = None


def _engine() -> bytes:
    """The compiled engine (src/spec as bstf), read once."""
    global _engine_bytes
    if _engine_bytes is None:
        _engine_bytes = resources.files('limitr').joinpath('engine.bstf').read_bytes()
    return _engine_bytes


def _ms(value: Time) -> Optional[float]:
    """A time as ms since the epoch (a datetime, or a number already in ms)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.timestamp() * 1000
    return float(value)


def _num(value: Union[int, float, str, None]) -> Union[float, str, None]:
    """A value for the engine: numbers as floats, strings (with units, Ex. '250MB') as they are."""
    if value is None or isinstance(value, str):
        return value
    return float(value)


def _event(event: Event) -> Union[bool, str]:
    """Event data for the engine: True/False, or a dict or string sent as JSON."""
    if isinstance(event, (bool, str)):
        return event
    return json.dumps(event)


def _context(context: Context) -> Optional[str]:
    """A call's context (event data) for the engine: a dict or string sent as JSON, or None."""
    if context is None or isinstance(context, str):
        return context
    return json.dumps(context)


def _call_weak(method: 'weakref.WeakMethod', key: str, value: Any) -> None:
    """Call a weakly held method, if its instance is still around."""
    bound = method()
    if bound is not None:
        bound(key, value)


def _metadata(metadata: Union[str, Dict[str, Any], None]) -> Optional[str]:
    if metadata is None or isinstance(metadata, str):
        return metadata
    return json.dumps(metadata)


class Limitr:
    """
    A Limitr policy, run in-process: decide, meter, and price every call for each customer.

    Every method runs one engine call, one at a time (a lock guards the document), so a single `allow` is safe
    across threads. Two calls in a row are not one unit: use `reserve` and `settle` when concurrent calls must not
    overspend together.

    ```python
    from limitr import Limitr

    policy = Limitr(open('policy.stof').read())
    policy.ensure_customer('ada')
    if policy.allow('ada', 'api', 1):
        ...
    ```
    """

    def __init__(self, policy: Policy = 'Limitr policy: {}', format: str = 'stof', validate: bool = True):
        """
        Load a policy: Stof source (default), JSON / YAML / TOML text with `format`, a dict, or compiled bstf bytes.
        Raises ValueError when `validate` (the default) finds the policy isn't valid.
        """
        self.doc = Doc()
        self._lock = threading.RLock()
        self._handlers: Dict[str, Callable[[str, Any], Any]] = {}
        self._modules: Dict[str, Tuple[bytes, Optional[Callable[[Doc], None]]]] = {}
        self._max_execution_time: Optional[float] = 5000

        self.doc.binary_import(_engine(), 'bstf')   # the compiled engine (src/spec)
        if self.doc.get('LimitrTypes') is not None:
            self.doc.seal('LimitrTypes')             # nothing parsed later can change the engine's functions
        self._import(policy, format)
        self.doc.call('<Limitr>.load')               # root.policy becomes a Limitr (JSON/YAML/TOML have no type)
        self.doc.set_max_execution_time(self._max_execution_time / 1000)
        # each document keeps its own host functions, callable from any thread (stof 0.11.4). The handler holds this
        # instance weakly: the document holds the handler, so a strong one would keep both alive forever
        emit = weakref.WeakMethod(self._emit)
        self.doc.lib('App', 'event_handler', lambda key, value: _call_weak(emit, key, value))
        if validate:
            ok, error = self.valid()
            if not ok:
                raise ValueError(error)

    @classmethod
    def new(cls, policy: Policy = 'Limitr policy: {}', format: str = 'stof', validate: bool = True) -> 'Limitr':
        """Same as `Limitr(policy, format, validate)` (the TypeScript SDK's `Limitr.new`)."""
        return cls(policy, format, validate)

    @contextmanager
    def _using(self) -> Iterator[None]:
        """Run engine calls one at a time."""
        with self._lock:
            yield

    def _import(self, policy: Policy, format: str) -> None:
        if isinstance(policy, (bytes, bytearray)):
            self.doc.binary_import(bytes(policy), 'bstf' if format == 'stof' else format)
        elif isinstance(policy, dict):
            self.doc.string_import(json.dumps(policy), 'json')
        else:
            self.doc.string_import(policy, format)

    def _call(self, path: str, *args: Any) -> Any:
        with self._using():
            return self.doc.call(path, list(args))

    def _record(self, node: Any) -> Optional[Record]:
        """An object in the document (by node ID) as a plain dict."""
        if not isinstance(node, str):
            return None
        with self._using():
            return json.loads(self.doc.string_export('json', node))

    def _call_record(self, path: str, *args: Any) -> Optional[Record]:
        with self._using():
            return self._record(self.doc.call(path, list(args)))

    # ------------------------------------------------------------------------------------------------------------
    # Policy
    # ------------------------------------------------------------------------------------------------------------

    def module(self, name: str, data: bytes, setup: Optional[Callable[[Doc], None]] = None) -> None:
        """
        Load a module into this policy's document: Stof compiled to bstf whose root object is `name`. It's sealed
        like the engine, so nothing parsed later can change it, and loaded once: calling again only runs `setup`.
        """
        self._modules[name] = (data, setup)
        with self._using():
            if self.doc.get(name) is None:
                self.doc.binary_import(data, 'bstf')
                if self.doc.get(name) is None:
                    raise ValueError(f"Limitr: module '{name}' has no root object named '{name}'")
                self.doc.seal(name)
            if setup:
                setup(self.doc)

    def set_max_execution_time(self, ms: Optional[float]) -> None:
        """How long a policy call can run before it fails, in milliseconds (None for no limit). Defaults to 5 seconds."""
        self._max_execution_time = ms
        with self._using():
            self.doc.set_max_execution_time(None if ms is None else ms / 1000)

    def doc_call(self, path: str, *args: Any) -> Any:
        """Call any engine function by path, Ex. `doc_call('policy.set_customer_refs', id, refs)`."""
        return self._call(path, *args)

    def valid(self) -> Tuple[bool, str]:
        """Is this policy valid? (True, '') or (False, the first error)."""
        with self._using():
            if self.doc.call('policy.valid', []):
                return True, ''
            return False, str(self.doc.get('<LimitrValidation>.error_message') or 'invalid policy')

    def difference(self, other: 'Limitr', symmetric: bool = False) -> Record:
        """The difference between this policy and another (this one is the schema)."""
        data = other._call('policy.policy_bstf')
        return json.loads(self._call('policy.difference_bstf', bytes(data), symmetric))

    def version(self) -> str:
        """The engine version."""
        with self._using():
            ver = self.doc.get('<root.Limitr>.version')
        return str(ver) if ver is not None else 'unknown'

    def close(self) -> None:
        """Nothing to release for a local engine (here for symmetry with Limitr Cloud)."""

    # ------------------------------------------------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------------------------------------------------

    def add_handler(self, name: str, handler: Callable[[str, Any], Any]) -> None:
        """
        Add an event handler by name: `handler(event_name, value)`, called for every event (objects arrive as dicts).
        Handlers run during the engine call that sent the event, so don't call this policy from one (queue the work
        instead). A handler that raises is logged and skipped; a coroutine is scheduled on the running event loop.
        """
        self._handlers[name] = handler

    def remove_handler(self, name: str) -> bool:
        return self._handlers.pop(name, None) is not None

    def clear_handlers(self) -> None:
        self._handlers = {}

    def _emit(self, key: str, value: Any) -> None:
        if not self._handlers:
            return
        if isinstance(value, str) and value[:1] in ('{', '['):
            try:
                value = json.loads(value)
            except ValueError:
                pass
        for name, handler in list(self._handlers.items()):
            try:
                result = handler(key, value)
                if inspect.isawaitable(result):
                    try:
                        asyncio.get_running_loop().create_task(result)   # type: ignore[arg-type]
                    except RuntimeError:
                        log.error("Limitr: event handler '%s' returned a coroutine with no running event loop", name)
                        result.close() if inspect.iscoroutine(result) else None
            except Exception:
                log.exception("Limitr: event handler '%s' failed on '%s'", name, key)

    # ------------------------------------------------------------------------------------------------------------
    # Plans
    # ------------------------------------------------------------------------------------------------------------

    def plan(self, id: str, default: bool = True) -> Optional[Record]:
        """A plan record by plan ID or customer ID (the default plan when nothing else matches, unless `default` is False)."""
        return self._call_record('policy.plan', id, default)

    def default_plan(self) -> Optional[Record]:
        return self._call_record('policy.default_plan')

    def set_plan(self, id: str, plan_stof: str) -> Optional[str]:
        """Set (add or replace) a plan from Stof source. Returns the plan's node ID."""
        return self._call('policy.set_plan', id, plan_stof)

    def delete_plan(self, id: str) -> bool:
        return bool(self._call('policy.delete_plan', id))

    def plan_period(self, id: str) -> Optional[str]:
        """'yearly', 'monthly', 'weekly', 'daily', or None."""
        return self._call('policy.plan_period', id)

    def plan_trial_period(self, id: str) -> Optional[float]:
        """The plan's trial period in ms, if any."""
        return self._call('policy.plan_trial_period', id)

    def plan_sub_entitlement_name(self, id: str) -> Optional[str]:
        return self._call('policy.plan_sub_entitlement_name', id)

    # ------------------------------------------------------------------------------------------------------------
    # Credits and exchange
    # ------------------------------------------------------------------------------------------------------------

    def credit(self, id: str) -> Optional[Record]:
        return self._call_record('policy.credit', id)

    def credit_for(self, id: str, entitlement: str) -> Optional[Record]:
        """The credit an entitlement meters in, for a plan ID or customer ID."""
        return self._call_record('policy.credit_for', id, entitlement)

    def credit_exchange(self, in_credit: str, out_credit: str = 'rune', value: float = 1) -> Optional[float]:
        """Convert `value` of one credit to another, if there's an exchange path."""
        return self._call('policy.credit_exchange', in_credit, out_credit, _num(value))

    def exchange_pair(self, name: str) -> Optional[Dict[str, Any]]:
        """An exchange pair: one `name` is worth `value` of `currency`. None if there's no pair for `name`."""
        pair = self._call_record('policy.exchange.get_pair', name)
        return {'value': pair['value'], 'currency': pair['currency']} if pair else None

    def set_exchange_pair(self, name: str, value: float, currency: str = 'rune', event: bool = True) -> bool:
        """Add or replace an exchange pair (Ex. `set_exchange_pair('euro', 1.16, 'usd')`)."""
        return bool(self._call('policy.set_exchange_pair', name, _num(value), currency, event))

    def remove_exchange_pair(self, name: str, event: bool = True) -> bool:
        return bool(self._call('policy.remove_exchange_pair', name, event))

    # ------------------------------------------------------------------------------------------------------------
    # Customers
    # ------------------------------------------------------------------------------------------------------------

    def customer(self, id: str) -> Optional[Customer]:
        """A customer record by ID or alt ID."""
        return self._call_record('policy.customer', id)

    def customer_metadata(self, id: str) -> Optional[Record]:
        return self._call_record('policy.customer_metadata', id)

    def customers(self) -> Dict[str, Customer]:
        """Every customer, by ID: all the state there is, so this is what to save (see load_customers)."""
        with self._using():
            node = self.doc.call('<Limitr>.load', [])
            customers = self.doc.get('customers', node) if isinstance(node, str) else None
            return self._record(customers) or {}

    def customer_refs(self, id: str) -> Optional[List[str]]:
        return self._call('policy.customer_refs', id)

    def set_customer_plan(self, id: str, plan: str, overwrite_meters: bool = True) -> bool:
        """Change a customer's plan. True when it changed."""
        return bool(self._call('policy.set_customer_plan', id, plan, overwrite_meters))

    def set_customer_period(self, id: str, start: Time, end: Time = None, event: bool = True) -> bool:
        """
        Set a customer's billing period ('period' reset schedules follow it). `end` defaults to one plan period after
        `start`; no dates go back to the plan's calendar period. Times are datetimes or ms.
        """
        return bool(self._call('policy.set_customer_period', id, _ms(start), _ms(end), event))

    def set_customer_expires(self, id: str, expires: Time, event: bool = True) -> bool:
        """When a customer's access ends (None: never). From then on allow() and check() refuse; its usage is kept."""
        return bool(self._call('policy.set_customer_expires', id, _ms(expires), event))

    def ensure_customer_included_topups(self, id: str, event: bool = True) -> None:
        self._call('policy.ensure_included_topups', id, event)

    def ensure_customer_plan_quantity(self, id: str) -> bool:
        return bool(self._call('policy.ensure_plan_subscription', id))

    def ensure_customer(self, id: str, plan: str = '', type: str = 'user', label: str = 'User',
                        refs: Optional[List[str]] = None, alts: Optional[List[str]] = None,
                        metadata: Union[str, Dict[str, Any], None] = None) -> bool:
        """
        Make sure a customer exists, creating it if needed. True when a new customer was created; False when it
        already existed or couldn't be created (no plan resolves for it, or the ID contains a period).
        """
        with self._using():
            if self.doc.call('policy.customer', [id]) is not None:
                return False
            node = self.doc.call('policy.create_customer', [id, plan, type, label, refs, alts, _metadata(metadata)])
        return isinstance(node, str)

    def create_customer(self, id: str, plan: str = '', type: str = 'user', label: str = 'User',
                        refs: Optional[List[str]] = None, alts: Optional[List[str]] = None,
                        metadata: Union[str, Dict[str, Any], None] = None) -> Optional[Customer]:
        """
        Create a customer. IDs and alt IDs can't contain a period (Ex. an email): use your own placeholder, or keep
        the email in metadata. None when it couldn't be created. Prefer ensure_customer.
        """
        return self._call_record('policy.create_customer', id, plan, type, label, refs, alts, _metadata(metadata))

    def ensure_set_customer(self, customer: Union[str, Customer], event: bool = True) -> bool:
        """Set a customer from a record unless one with its ID exists. True when it was set."""
        record = json.loads(customer) if isinstance(customer, str) else customer
        id = record.get('id')
        if not id:
            raise ValueError('ensure_set_customer expects a customer record with an ID')
        with self._using():
            if self.doc.call('policy.customer', [id]) is not None:
                return False
            return bool(self.doc.call('policy.set_customer', [json.dumps(record), event]))

    def set_customer(self, customer: Union[str, Customer], event: bool = True) -> Optional[str]:
        """Set a customer from a record (a dict or JSON/Stof text). Returns its node ID."""
        source = customer if isinstance(customer, str) else json.dumps(customer)
        return self._call('policy.set_customer', source, event)

    def load_customers(self, customers: Union[Dict[str, Customer], List[Customer]]) -> None:
        """Load many customers from records (Ex. what customers() returned): all that's needed to restore state."""
        records = customers if isinstance(customers, list) else [
            {**record, 'id': record.get('id') or key} for key, record in customers.items()
        ]
        for record in records:
            if isinstance(record.get('id'), str):
                self.set_customer(record)

    def remove_customer(self, id: str) -> bool:
        return bool(self._call('policy.delete_customer', id))

    def add_alt_id(self, existing: str, alt: str, event: bool = True) -> bool:
        """Add an alternative ID (Ex. a Stripe customer ID or API key) to an existing customer."""
        return bool(self._call('policy.set_alt_customer_id', existing, alt, event))

    def remove_alt_id(self, alt: str, event: bool = True) -> bool:
        return bool(self._call('policy.delete_alt_customer_id', alt, event))

    def create_customer_override(self, id: str, entitlement: str, value: Union[float, str, None] = None,
                                 expires_on: Time = None, credit: Optional[str] = None, mode: Optional[str] = None,
                                 increment: Union[float, str, None] = None, resets: Optional[bool] = None,
                                 reset_inc: Union[float, str, None] = None, reset_sch: Optional[str] = None) -> Optional[str]:
        """Give a customer its own limit for an entitlement (replacing any it had). Returns the limit's node ID."""
        return self._call('policy.create_customer_override', id, entitlement, _ms(expires_on), credit, mode,
                          _num(value), _num(increment), resets, _num(reset_inc), reset_sch)

    def remove_customer_override(self, id: str, entitlement: str) -> bool:
        return bool(self._call('policy.remove_customer_override', id, entitlement))

    def give_entitlement(self, customer: str, entitlement: str, plan: Optional[str] = None, expires_on: Time = None) -> bool:
        """Give a customer an entitlement its plan doesn't have, defined by `plan` or the closest plan that has it."""
        return bool(self._call('policy.give_entitlement', customer, entitlement, plan, _ms(expires_on)))

    def take_entitlement(self, customer: str, entitlement: str, expires_on: Time = None) -> bool:
        """Take an entitlement away, even though the customer's plan has it. Meters are kept."""
        return bool(self._call('policy.take_entitlement', customer, entitlement, _ms(expires_on)))

    def restore_entitlement(self, customer: str, entitlement: str) -> bool:
        """Undo a give or take: the plan decides again."""
        return bool(self._call('policy.restore_entitlement', customer, entitlement))

    def set_customer_rules(self, customer: str, rules: List[str], event: bool = True) -> bool:
        """Set the policy's rules that apply to a customer, by name (an empty list clears them)."""
        return bool(self._call('policy.set_customer_rules', customer, rules, event))

    def entitlement_source(self, customer: str, entitlement: str) -> Optional[EntitlementSource]:
        """Where a customer's entitlement comes from, and whose meter it is."""
        out = self._call('policy.entitlement_source', customer, entitlement)
        if not out:
            return None
        return {'access': str(out.get('access') or ''), 'limit': out.get('limit'), 'customer': str(out.get('customer') or customer)}

    def apply_customer_topup(self, id: str, topup: str) -> bool:
        """Grant a topup (by name) from the customer's plan."""
        return bool(self._call('policy.apply_customer_topup', id, topup))

    def remaining_credit(self, id: str, credit: str) -> Optional[float]:
        """Credit left in a customer's grants (for an entitlement's remaining, use remaining)."""
        return self._call('policy.credit_remaining', id, credit)

    # ------------------------------------------------------------------------------------------------------------
    # Spend caps and margins
    # ------------------------------------------------------------------------------------------------------------

    def add_customer_cap(self, id: str, value: Union[float, str], cap_id: str = '', credit: str = 'rune',
                         exchangeable: Optional[bool] = None, ignore_grants: bool = False, overage_only: bool = False,
                         observe_only: bool = False, overhead_cost: bool = False, follow_decrements: bool = False,
                         scope: Optional[List[str]] = None, resets: bool = False, reset_inc: Optional[float] = None,
                         reset_sch: Optional[str] = None, expires_on: Time = None, send_events: bool = True,
                         hard_trailing: bool = False, shared: bool = False, shared_with: Optional[List[str]] = None) -> Optional[Cap]:
        """
        Add a standing spend cap: a ceiling that only restricts (every cap that applies must have room). `credit`
        defaults to 'rune' (USD-pegged): an umbrella cap over everything convertible to runes. `shared` applies it to
        every customer referencing this one (Ex. an org budget). None when `cap_id` exists or `credit` is unknown.
        """
        return self._call_record('policy.add_customer_cap', id, _num(value), cap_id, credit, exchangeable,
                                 ignore_grants, overage_only, observe_only, overhead_cost, follow_decrements, scope,
                                 resets, _num(reset_inc), reset_sch, _ms(expires_on), send_events, hard_trailing,
                                 shared, shared_with)

    def customer_cap(self, id: str, cap_id: str) -> Optional[Cap]:
        return self._call_record('policy.customer_cap', id, cap_id)

    def reset_customer_cap(self, id: str, cap_id: str, event: bool = True) -> bool:
        """Reset a cap's consumption to zero, keeping the cap."""
        return bool(self._call('policy.reset_customer_cap', id, cap_id, event))

    def remove_customer_cap(self, id: str, cap_id: str, event: bool = True) -> bool:
        return bool(self._call('policy.remove_customer_cap', id, cap_id, event))

    def start_margin_measurement(self, customer: str, cap_id: str, overage_only: bool = True,
                                 ignore_grants: bool = True, credit: str = 'rune', exchangeable: bool = True) -> None:
        """Start measuring a customer's margin: two observe-only caps, what was charged and what it cost."""
        self.add_customer_cap(customer, 0, cap_id=cap_id, credit=credit, exchangeable=exchangeable, observe_only=True,
                              overage_only=overage_only, ignore_grants=ignore_grants, send_events=False)
        self.add_customer_cap(customer, 0, cap_id=cap_id + '_costs', credit=credit, exchangeable=exchangeable,
                              overhead_cost=True, observe_only=True, send_events=False)

    def capture_margin_measurement(self, customer: str, cap_id: str, stop: bool = True) -> Optional[Record]:
        """What was charged and what it cost since start_margin_measurement, and the margin (stops it unless `stop` is False)."""
        charged = self.customer_cap(customer, cap_id)
        costs = self.customer_cap(customer, cap_id + '_costs')
        result = None
        if charged and costs:
            charged_usd = charged['meter_value']
            costs_usd = costs['meter_value']
            margin = (charged_usd - costs_usd) / charged_usd if charged_usd > 0 else 0
            result = {
                'charged': round(charged_usd, 2), 'costs': round(costs_usd, 2), 'raw_margin': margin,
                'margin': round(margin * 100, 2), 'charged_cap': charged, 'costs_cap': costs,
            }
        if stop:
            self.remove_customer_cap(customer, cap_id, False)
            self.remove_customer_cap(customer, cap_id + '_costs')
        return result

    def customer_margin_snapshot(self, customer: str) -> Optional[Dict[str, Any]]:
        return self._call('policy.customer_local_margin_breakdown', customer)

    def margin_snapshot(self, plan: str, entitlements: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._call('policy.local_margin_breakdown', plan, entitlements)

    # ------------------------------------------------------------------------------------------------------------
    # Notifications and capabilities
    # ------------------------------------------------------------------------------------------------------------

    def set_notifications(self, contents: Union[str, bytes], format: str = 'stof') -> None:
        self._call('policy.set_notifications', contents, format)

    def capability(self, name: str) -> Optional[Record]:
        return self._call_record('policy.capability', name)

    def set_capabilities(self, contents: Union[str, bytes], format: str = 'stof') -> None:
        self._call('policy.set_capabilities', contents, format)

    def run_capability(self, name: str, args: Optional[Dict[str, Any]] = None, customer: Optional[str] = None) -> Any:
        """Run a capability and return its result. None when it doesn't exist or the customer can't use it."""
        out = self._call('policy.run_capability_json', name, args or {}, customer)
        return json.loads(out).get('result') if out else None

    def claude_tools(self, customer: Optional[str] = None) -> List[Record]:
        """The policy's capabilities as Claude tools (only the customer's, when given)."""
        out = self._call('policy.claude_tools', customer)
        return json.loads(out).get('tools', []) if out else []

    def claude_tool_use(self, tool_use: Union[str, Dict[str, Any]], customer: Optional[str] = None) -> Optional[Record]:
        """Run a Claude tool_use block against the capabilities; returns its tool_result, or None."""
        source = tool_use if isinstance(tool_use, str) else json.dumps(tool_use)
        out = self._call('policy.claude_tool_use', source, customer)
        return json.loads(out) if out else None

    # ------------------------------------------------------------------------------------------------------------
    # Entitlements and reads
    # ------------------------------------------------------------------------------------------------------------

    def entitlement(self, id: str, entitlement: str) -> Optional[Record]:
        """An entitlement record, for a plan ID or customer ID."""
        return self._call_record('policy.entitlement', id, entitlement)

    def limit(self, id: str, entitlement: str, grants: bool = True) -> Optional[float]:
        """The limit, in the credit's units (with grants unless `grants` is False). A plan ID or customer ID."""
        return self._call('policy.limit', id, entitlement, grants)

    def limit_object(self, id: str, entitlement: str) -> Optional[Record]:
        """The limit that applies (a customer's own override, a rule's, or the plan's)."""
        return self._call_record('policy.limit_obj', id, entitlement)

    def meter_object(self, id: str, entitlement: str) -> Optional[Record]:
        """A customer's meter for an entitlement (the scope owner's for a scoped entitlement)."""
        return self._call_record('policy.meter_obj', id, entitlement)

    def remaining(self, customer: str, entitlement: str, percent: bool = False, grants: bool = True) -> Optional[float]:
        """limit - used, in the credit's units (negative past a soft limit)."""
        return self._call('policy.remaining', customer, entitlement, percent, grants)

    def allowance(self, customer: str, entitlement: str, grants: bool = True) -> Optional[float]:
        """What can be used right now: remaining, or less when a governor allows less. Size calls with it."""
        return self._call('policy.allowance', customer, entitlement, grants)

    def projected_exhaustion(self, customer: str, entitlement: str, smoothed: bool = False, grants: bool = True) -> Optional[float]:
        """When the customer runs out at the current rate (ms timestamp), or None."""
        return self._call('policy.projected_exhaustion', customer, entitlement, smoothed, grants)

    def rate(self, customer: str, entitlement: str) -> float:
        """Current consumption rate (units per ms)."""
        return self._call('policy.rate', customer, entitlement) or 0

    def acceleration(self, customer: str, entitlement: str) -> float:
        """Change in consumption rate (units per ms²)."""
        return self._call('policy.acceleration', customer, entitlement) or 0

    def value(self, customer: str, entitlement: str, percent: bool = False, grants: bool = True) -> Optional[float]:
        """Metered this period, in the credit's units."""
        return self._call('policy.value', customer, entitlement, percent, grants)

    def cost(self, id: str, entitlement: str) -> Optional[float]:
        """The limit's standard increment."""
        return self._call('policy.cost', id, entitlement)

    def resets(self, id: str, entitlement: str) -> Optional[float]:
        """When the meter resets (ms timestamp)."""
        return self._call('policy.resets', id, entitlement)

    def features(self, customer: str, context: Context = None) -> Optional[List[str]]:
        """
        The entitlements a customer can use right now, by name (plan, less taken, plus given, each `enabled` rule on
        for `context`). About access: a metered entitlement is listed even when used up (check answers that).
        """
        return self._call('policy.features', customer, _context(context))

    # ------------------------------------------------------------------------------------------------------------
    # Metering
    # ------------------------------------------------------------------------------------------------------------

    def allow(self, customer: str, entitlement: str, value: Union[float, str] = 0, event: Event = True,
              overhead: Optional[float] = None, force: bool = False, detail: bool = False) -> Union[bool, Decision]:
        """
        Decide and meter: True (and the meter moves by `value`) when allowed. A feature-flag check when the
        entitlement has no limit or `value` is 0. `value` can carry units in a string (Ex. '250MB').

        - `event`: True, False (no events), or event data (a dict or string): sent with the events and the cost
          function's context (Ex. `{'model': 'sonnet', 'input': 1200, 'output': 300}`).
        - `overhead`: the call's real provider cost in runes, when you know it (overrides the cost function).
        - `force`: record usage that already happened, even past a hard limit or cap.
        - `detail`: return the Decision (allowed, reason, and where the customer stands) instead of a bool.
        """
        out = self._call('policy.allow', customer, entitlement, _num(value), _event(event), None,
                         _num(overhead), force, detail)
        return out if detail else bool(out)

    def check(self, customer: str, entitlement: str, value: Union[float, str] = 0, context: Context = None,
              overhead: Optional[float] = None, detail: bool = False) -> Union[bool, Decision]:
        """
        The same decision as allow, changing nothing. Two checks can both pass when only one call fits: use
        reserve when calls run at the same time. `detail` returns the Decision instead of a bool.
        """
        out = self._call('policy.check', customer, entitlement, _num(value), None, _context(context),
                         _num(overhead), detail)
        return out if detail else bool(out)

    def increment(self, customer: str, entitlement: str, event: Event = True) -> bool:
        """allow with the limit's standard increment."""
        return bool(self._call('policy.increment', customer, entitlement, _event(event)))

    def decrement(self, customer: str, entitlement: str, event: Event = True) -> bool:
        """allow with minus the limit's standard increment."""
        return bool(self._call('policy.decrement', customer, entitlement, _event(event)))

    def check_increment(self, customer: str, entitlement: str) -> bool:
        return bool(self._call('policy.check_increment', customer, entitlement))

    def check_decrement(self, customer: str, entitlement: str) -> bool:
        return bool(self._call('policy.check_decrement', customer, entitlement))

    def set(self, customer: str, entitlement: str, value: float, event: bool = True) -> bool:
        """Move a meter to `value` (allows the difference). For accumulating usage, use allow."""
        current = self.value(customer, entitlement)
        return self.allow(customer, entitlement, value - current, event) if current is not None else False

    # ------------------------------------------------------------------------------------------------------------
    # Reservations and estimates
    # ------------------------------------------------------------------------------------------------------------

    def reserve(self, customer: str, entitlement: str, value: Union[float, str, None] = None, context: Context = None,
                basis: Optional[float] = None, segment: Optional[str] = None, ttl: Optional[float] = None,
                quantile: float = 0.9, overhead: Optional[float] = None) -> Optional[str]:
        """
        Hold room for a call before it runs (Ex. an LLM request), so concurrent calls can't overspend together.
        Returns a hold ID, or None when the call wouldn't be allowed right now (counting every other hold). Leave
        `value` unset to hold the predicted size (see estimate). A hold spends a governor's tokens like allow.
        When the call finishes, settle it with the real usage, or release it if it never ran.

        ```python
        hold = policy.reserve(user, 'chat', context={'model': model, 'input': input_tokens})
        if not hold:
            return deny()
        res = call_model(...)
        policy.settle(user, 'chat', hold, res.usage.total_tokens, {'model': model, 'input': input_tokens})
        ```
        """
        return self._call('policy.reserve', customer, entitlement, _num(value), _context(context), _num(basis),
                          segment, _num(ttl), _num(quantile), _num(overhead))

    def settle(self, customer: str, entitlement: str, hold: Optional[str], value: Union[float, str],
               event: Event = True, overhead: Optional[float] = None, basis: Optional[float] = None,
               segment: Optional[str] = None) -> bool:
        """
        Finish a reserved call: drop the hold and record the real usage (even past a hard limit: it already
        happened), then learn from it for future estimates. `event` and `overhead` work like allow.
        """
        return bool(self._call('policy.settle', customer, entitlement, hold, _num(value), _event(event),
                               _num(overhead), _num(basis), segment))

    def release(self, customer: str, entitlement: str, hold: str) -> bool:
        """Drop a hold without recording anything (the call never ran)."""
        return bool(self._call('policy.release', customer, entitlement, hold))

    def held(self, customer: str, entitlement: str) -> float:
        """Room held right now by reservations, in the credit's units."""
        return self._call('policy.held', customer, entitlement) or 0

    def estimate(self, customer: str, entitlement: str, context: Context = None, quantile: float = 0.9,
                 basis: Optional[float] = None, segment: Optional[str] = None) -> Optional[Estimate]:
        """
        Predict one call before it runs: its value and provider overhead, from this customer's own usage once
        there's enough of it, otherwise everyone's. None until something has been learned.
        """
        return self._call('policy.estimate', customer, entitlement, _num(basis), segment, _num(quantile), _context(context))

    def observe(self, customer: str, entitlement: str, value: Union[float, str], context: Context = None,
                overhead: Optional[float] = None, basis: Optional[float] = None, segment: Optional[str] = None) -> bool:
        """Record one call's usage for estimates without reserving (settle does this for you)."""
        return bool(self._call('policy.observe', customer, entitlement, _num(value), _num(overhead), _num(basis),
                               segment, _context(context)))
