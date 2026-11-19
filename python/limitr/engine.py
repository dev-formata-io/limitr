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
from typing import TYPE_CHECKING, Any, Callable, Dict, Iterator, List, Optional, Tuple, Union
from urllib.parse import urlsplit

from pystof import Doc

from .types import Cap, Customer, Decision, EntitlementSource, Estimate, Record

if TYPE_CHECKING:
    from .cloud import CloudConnection
    from .network import Channel, LimitrNetwork

log = logging.getLogger('limitr')

Policy = Union[str, Dict[str, Any], bytes, bytearray]
Context = Union[str, Dict[str, Any], None]
Event = Union[bool, str, Dict[str, Any]]
Time = Union[int, float, datetime, None]

_engine_bytes: Optional[bytes] = None
_network_bytes: Optional[bytes] = None

# The name Limitr Cloud's operator goes by in a policy (policy.network.operators.limitr).
CLOUD_OPERATOR = 'limitr'

# This SDK's version, sent to Limitr Cloud when connecting so Cloud sends a policy this SDK can read (or refuses
# clearly). Matches the package version.
SDK_VERSION = '0.8.9'


def _engine() -> bytes:
    """The compiled engine (src/spec as bstf), read once."""
    global _engine_bytes
    if _engine_bytes is None:
        _engine_bytes = resources.files('limitr').joinpath('engine.bstf').read_bytes()
    return _engine_bytes


def _network() -> bytes:
    """The compiled Network module (src/network as bstf), read once, the first time a policy uses it."""
    global _network_bytes
    if _network_bytes is None:
        _network_bytes = resources.files('limitr').joinpath('network.bstf').read_bytes()
    return _network_bytes


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
        self._cloud: Optional['CloudConnection'] = None
        self._network: Optional['LimitrNetwork'] = None
        self.deny_unconnected = True   # with Limitr Cloud: refuse calls while disconnected (see Limitr.cloud)

        self.doc.binary_import(_engine(), 'bstf')   # the compiled engine (src/spec)
        if self.doc.get('LimitrTypes') is not None:
            self.doc.seal('LimitrTypes')             # nothing parsed later can change the engine's functions
        self._import(policy, format)
        self.doc.call('<Limitr>.load')               # root.policy becomes a Limitr (JSON/YAML/TOML have no type)
        self.doc.set_max_execution_time(self._max_execution_time / 1000)
        # each document keeps its own host functions, callable from any thread (stof 0.11.4). The handler holds this
        # instance weakly: the document holds the handler, so a strong one would keep both alive forever
        self._register_handler()
        if validate:
            ok, error = self.valid()
            if not ok:
                raise ValueError(error)

    @classmethod
    def new(cls, policy: Policy = 'Limitr policy: {}', format: str = 'stof', validate: bool = True) -> 'Limitr':
        """Same as `Limitr(policy, format, validate)` (the TypeScript SDK's `Limitr.new`)."""
        return cls(policy, format, validate)

    def _register_handler(self) -> None:
        """The engine's events reach this instance's handlers. Held weakly (the document holds the handler)."""
        emit = weakref.WeakMethod(self._emit)
        self.doc.lib('App', 'event_handler', lambda key, value: _call_weak(emit, key, value))

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
            self._load_module(name)

    def _load_module(self, name: str) -> None:
        """Load a module into the document (once), seal it, and run its setup (in the lock)."""
        data, setup = self._modules[name]
        if self.doc.get(name) is None:
            self.doc.binary_import(data, 'bstf')
            if self.doc.get(name) is None:
                raise ValueError(f"Limitr: module '{name}' has no root object named '{name}'")
            self.doc.seal(name)
        if setup:
            setup(self.doc)

    def _reload_modules(self) -> None:
        """After a Cloud policy update, run each module's setup again (a setup that raises is logged)."""
        for name in self._modules:
            try:
                self._load_module(name)
            except Exception:
                log.exception("Limitr: module '%s' after a policy update", name)

    def network(self, secret_key: Optional[str] = None, key_store: Optional[Callable[[str], Any]] = None,
                name: Optional[str] = None, channels: Optional[Dict[str, 'Channel']] = None,
                cloud: bool = True) -> 'LimitrNetwork':
        """
        Limitr Network: use other policies' services and pay for them, or offer yours, peer to peer (see
        src/network/SPEC.md). Loads the Network module the first time (later calls return the same handle).

        The policy's identity is `secret_key` (base64, from LimitrNetwork.generate_key()); without one a new key is
        made and handed to `key_store`. It stays in this process: the policy signs through it and never sees it. A
        provider should keep its key: vouchers are made out to it. `name` is how this policy calls itself to
        providers. `channels` are the host's own ways to its operators, by name (policy.network.operators.<name>, with
        `channel: true`): each takes the operator's Request and returns its Response. On a Limitr.cloud() engine,
        `cloud` (True by default) uses Limitr Cloud as an operator, over the engine's connection, when the workspace
        has Limitr Network on Cloud.
        """
        from .network import LimitrNetwork
        if self._network is not None:
            return self._network
        if not secret_key:
            secret_key = Doc.generate_key()
            if key_store is not None:
                key_store(secret_key)
        network = LimitrNetwork(self, secret_key, channels)
        operator = self._cloud.network_operator() if cloud and self._cloud is not None else None

        def setup(doc: Doc) -> None:
            network._setup(doc)
            doc.call('LimitrNetwork.identity', [network.public_key, name])
            if operator is not None and self._cloud is not None:
                # Limitr Cloud, over this engine's connection
                op_name = doc.call('LimitrNetwork.host_operator', [CLOUD_OPERATOR, operator['url'], operator['key'],
                                                                   operator['label'], operator['roles']])
                if op_name:
                    network.add_channel(op_name, self._cloud.operator_channel(operator['url']))
            doc.call('LimitrNetwork.load', [])   # types and checks policy.network (raises with the reason)
            # the policy's operators: its Http::fetch may reach them
            for url in doc.call('LimitrNetwork.operator_urls', []) or []:
                self.allow_network_host(url, doc)
        self.module('LimitrNetwork', _network(), setup)
        self._network = network
        return network

    def allow_network_host(self, url: str, doc: Optional[Doc] = None) -> None:
        """
        Let the policy's Http::fetch reach a URL's host (Ex. a Network provider's), on top of what's allowed. Nothing
        changes on a Limitr Cloud engine that allows any public host.
        """
        if self._cloud is not None and self._cloud.http_hosts is True:
            return
        host = urlsplit(url).netloc
        if host:
            (doc or self.doc).allow_http_hosts([host])

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
        """Close the Limitr Cloud connection, after sending what's batched (nothing to do for a local engine)."""
        if self._cloud is not None:
            self._cloud.close()

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
        if self._has_customer(id):
            return False
        cloud = self._cloud
        if cloud is not None:
            if cloud.open.is_set():
                if cloud.add_customer(id):
                    return False   # Cloud has it
                # a new customer's plan comes from its refs when it has none: load them from Cloud first
                for ref in refs or []:
                    if ref and ref != id:
                        cloud.add_customer(ref)
            elif self.deny_unconnected:
                return False
        with self._using():
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
        if self._has_customer(id):
            return False
        cloud = self._cloud
        if cloud is not None:
            if cloud.open.is_set():
                if cloud.add_customer(id):
                    return False
            elif self.deny_unconnected:
                return False
        with self._using():
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
        """
        Grant a topup (by name) from the customer's plan. On Limitr Cloud (when it supports it), Cloud charges for the
        topup first and then grants it: this returns once the grant is here (False if the charge failed).
        """
        if self._cloud is not None and 'topup-purchase' in self._cloud.features:
            return self._cloud.purchase_topup(id, topup)
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
        if not self._precheck(customer):
            return None
        return self._call('policy.remaining', customer, entitlement, percent, grants)

    def allowance(self, customer: str, entitlement: str, grants: bool = True) -> Optional[float]:
        """What can be used right now: remaining, or less when a governor allows less. Size calls with it."""
        if not self._precheck(customer):
            return None
        return self._call('policy.allowance', customer, entitlement, grants)

    def projected_exhaustion(self, customer: str, entitlement: str, smoothed: bool = False, grants: bool = True) -> Optional[float]:
        """When the customer runs out at the current rate (ms timestamp), or None."""
        if not self._precheck(customer):
            return None
        return self._call('policy.projected_exhaustion', customer, entitlement, smoothed, grants)

    def rate(self, customer: str, entitlement: str) -> float:
        """Current consumption rate (units per ms)."""
        return self._call('policy.rate', customer, entitlement) or 0

    def acceleration(self, customer: str, entitlement: str) -> float:
        """Change in consumption rate (units per ms²)."""
        return self._call('policy.acceleration', customer, entitlement) or 0

    def value(self, customer: str, entitlement: str, percent: bool = False, grants: bool = True) -> Optional[float]:
        """Metered this period, in the credit's units."""
        if not self._precheck(customer):
            return None
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
        if not self._precheck(customer):
            return None
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
        if not self._precheck(customer):
            return self._precheck_decision(customer, entitlement, value) if detail else False
        out = self._call('policy.allow', customer, entitlement, _num(value), _event(event), None,
                         _num(overhead), force, detail)
        return out if detail else bool(out)

    def check(self, customer: str, entitlement: str, value: Union[float, str] = 0, context: Context = None,
              overhead: Optional[float] = None, detail: bool = False) -> Union[bool, Decision]:
        """
        The same decision as allow, changing nothing. Two checks can both pass when only one call fits: use
        reserve when calls run at the same time. `detail` returns the Decision instead of a bool.
        """
        if not self._precheck(customer):
            return self._precheck_decision(customer, entitlement, value) if detail else False
        out = self._call('policy.check', customer, entitlement, _num(value), None, _context(context),
                         _num(overhead), detail)
        return out if detail else bool(out)

    def increment(self, customer: str, entitlement: str, event: Event = True) -> bool:
        """allow with the limit's standard increment."""
        if not self._precheck(customer):
            return False
        return bool(self._call('policy.increment', customer, entitlement, _event(event)))

    def decrement(self, customer: str, entitlement: str, event: Event = True) -> bool:
        """allow with minus the limit's standard increment."""
        if not self._precheck(customer):
            return False
        return bool(self._call('policy.decrement', customer, entitlement, _event(event)))

    def check_increment(self, customer: str, entitlement: str) -> bool:
        if not self._precheck(customer):
            return False
        return bool(self._call('policy.check_increment', customer, entitlement))

    def check_decrement(self, customer: str, entitlement: str) -> bool:
        if not self._precheck(customer):
            return False
        return bool(self._call('policy.check_decrement', customer, entitlement))

    def set(self, customer: str, entitlement: str, value: float, event: bool = True) -> bool:
        """Move a meter to `value` (allows the difference). For accumulating usage, use allow."""
        current = self.value(customer, entitlement)
        return bool(self.allow(customer, entitlement, value - current, event)) if current is not None else False

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
        if not self._precheck(customer):
            return None
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

    # ------------------------------------------------------------------------------------------------------------
    # Limitr Cloud
    # ------------------------------------------------------------------------------------------------------------

    @classmethod
    def cloud(cls, token: str, policy: str = 'active', ws_address: str = 'wss://api.limitr.dev',
              ticket_address: str = 'https://api.limitr.dev', connect_timeout: float = 5000,
              deny_unconnected: bool = True, validate: bool = True, http_hosts: Union[List[str], bool] = True,
              max_execution_time: Optional[float] = 5000, batch_ms: float = 250) -> Optional['Limitr']:
        """
        A policy from Limitr Cloud, kept in step with it: Cloud sends the policy (and every update you publish),
        customers when a call needs them, and keeps their state, ledgers, and invoices. Every decision still runs here,
        in-process. Returns None when Cloud refuses the token; raises CloudError when the policy doesn't arrive within
        `connect_timeout` (ms).

        - `policy`: a policy ID, or 'active' (the default) to follow the workspace's active policy as it's published.
        - `deny_unconnected`: refuse calls while disconnected (the default), so no usage goes unrecorded.
        - `http_hosts`: hosts the policy's Http::fetch can reach: any public host (True, the default), a list, or
          False for none.
        - `batch_ms`: how long to collect usage before sending it to Cloud together (0 sends each right away).

        Call `close()` when you're done, so batched usage is sent.

        ```python
        policy = Limitr.cloud(os.environ['LIMITR_TOKEN'])
        if policy.allow(user_id, 'chat', tokens):
            ...
        ```
        """
        from .cloud import CloudConnection
        if not token:
            return None
        limitr = cls(validate=False)
        limitr.deny_unconnected = deny_unconnected
        if max_execution_time != 5000:
            limitr.set_max_execution_time(max_execution_time)
        limitr._cloud = CloudConnection(limitr, token, policy, ws_address, ticket_address, connect_timeout,
                                        http_hosts, batch_ms, SDK_VERSION)
        if not limitr._cloud.start():
            limitr._cloud = None
            return None
        if validate:
            ok, error = limitr.valid()
            if not ok:
                limitr.close()
                raise ValueError(error)
        return limitr

    @property
    def connected(self) -> bool:
        """Connected to Limitr Cloud right now (False for a local engine)."""
        return self._cloud is not None and self._cloud.open.is_set()

    def add_cloud_customer(self, id: str, timeout: float = 3000) -> bool:
        """
        Load a customer from Limitr Cloud (and the customers its refs lead to), waiting up to `timeout` ms. True when
        it's here. Doesn't create one (see ensure_customer). Calls about a customer load it this way on their own.
        """
        if self._has_customer(id):
            return True
        return self._cloud is not None and self._cloud.add_customer(id, timeout)

    def flush_cloud_batch(self) -> None:
        """Send the usage collected for Limitr Cloud now, instead of after batch_ms."""
        if self._cloud is not None:
            self._cloud.flush_batch()

    def _has_customer(self, id: str) -> bool:
        with self._using():
            return self.doc.call('policy.customer', [id]) is not None

    def _precheck(self, customer: str) -> bool:
        """
        Before a call about a customer: on Limitr Cloud, load the customer if it isn't here yet (False when Cloud
        doesn't have it), and refuse while disconnected when deny_unconnected.
        """
        cloud = self._cloud
        if cloud is None:
            return True
        if not cloud.open.is_set():
            return not self.deny_unconnected
        return self._has_customer(customer) or cloud.add_customer(customer)

    def _precheck_decision(self, customer: str, entitlement: str, value: Union[float, str]) -> Decision:
        """The decision when _precheck refuses: disconnected, or Cloud couldn't load the customer."""
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = 0.0
        closed = self._cloud is not None and not self._cloud.open.is_set()
        return {'allowed': False, 'reason': 'unconnected' if closed else 'no_customer', 'customer': customer,
                'entitlement': entitlement, 'value': number, 'credit': None, 'mode': None, 'used': None,
                'limit': None, 'remaining': None, 'allowance': None, 'held': 0, 'resets': None, 'access': None,
                'limit_source': None}   # type: ignore[return-value]

    def _setup_cloud_doc(self) -> None:
        """What a Cloud document needs: the time limit, HTTP to the allowed hosts, CloudWS, modules, and events."""
        cloud = self._cloud
        assert cloud is not None
        self.doc.set_max_execution_time(None if self._max_execution_time is None else self._max_execution_time / 1000)
        if cloud.http_hosts is True:
            self.doc.allow_http()
        elif cloud.http_hosts:
            self.doc.allow_http_hosts(list(cloud.http_hosts))
        conn = weakref.ref(cloud)   # the document holds these; the connection holds the document's Limitr

        def send(data: str) -> None:
            c = conn()
            if c is not None:
                c.send(data)

        def send_debounced(id: str, data: str, debounce_ms: float = 500) -> None:
            c = conn()
            if c is not None:
                c.send_debounced(id, data, debounce_ms)
        self.doc.lib('CloudWS', 'send', send)
        self.doc.lib('CloudWS', 'send_debounced', send_debounced)
        for name in self._modules:
            self._load_module(name)
        self._register_handler()

    def _cloud_policy_source(self, record: Dict[str, Any]) -> None:
        """
        A policy from Limitr Cloud (policy-only: this SDK keeps the engine it ships with): the policy document itself
        (`source`, Stof), or a record with Cloud's functions as Stof for policies from before documents. Then its
        notifications, Cloud's handlers (billing events), and the customers this engine doesn't have yet.
        """
        cloud = self._cloud
        assert cloud is not None
        added: List[str] = []
        with self._using():
            doc = self.doc
            if isinstance(record.get('source'), str):
                doc.call('policy.update_policy_internals', [record['source'], 'stof'])
            else:
                doc.call('policy.update_policy_internals', [json.dumps({'policy': record.get('policy') or {}}), 'json'])
            if cloud.init.is_set():
                self._reload_modules()
            for fn in record.get('functions') or []:
                if not isinstance(fn, dict) or not isinstance(fn.get('path'), str) or not isinstance(fn.get('source'), str):
                    continue
                node = doc.get(fn['path'])
                if not isinstance(node, str):
                    continue
                try:
                    doc.parse(fn['source'], node, 'prod')
                except Exception:
                    log.exception('Limitr Cloud: the function for %s does not parse with this SDK', fn['path'])
            if isinstance(record.get('capabilities'), str) and record['capabilities']:
                doc.call('policy.set_capabilities', [record['capabilities'], 'stof'])

            # notifications: the ones Cloud sent last time go, then the current ones are set
            for name in cloud._notifications:
                doc.remove(f'policy.notifications.{name}')
            before = set((self._record(doc.get('policy.notifications')) or {}).keys())
            if isinstance(record.get('notifications'), str) and record['notifications']:
                doc.call('policy.set_notifications', [record['notifications'], 'stof'])
            cloud._notifications = [n for n in (self._record(doc.get('policy.notifications')) or {}) if n not in before]

            # Cloud's handlers (billing events) replace the last ones
            if isinstance(record.get('handlers'), str):
                doc.remove('limitr_cloud')
                doc.parse('limitr_cloud: {\n' + record['handlers'] + '\n}', None, 'prod')

            for customer in record.get('customers') or []:
                if not isinstance(customer, dict) or not isinstance(customer.get('id'), str):
                    continue
                if doc.get(f"policy.customers.{customer['id']}") is not None:
                    continue
                customer.pop('cloud_seq', None)   # a customer this engine doesn't have yet: nothing to add back
                doc.call('policy.update_customer_internals', [json.dumps(customer), 'json'])
                added.append(customer['id'])

            if not cloud.init.is_set():
                self._setup_cloud_doc()
                cloud.init.set()
        for id in added:
            self.ensure_customer_included_topups(id, False)

    def _cloud_policy_json(self, data: str) -> None:
        """A policy update as JSON (from servers before policy-source)."""
        with self._using():
            self.doc.call('policy.update_policy_internals', [data, 'json'])
            self._reload_modules()

    def _cloud_invoices(self, data: str) -> None:
        with self._using():
            self.doc.call('policy.update_customer_invoices', [data, 'json'])

    def _cloud_customer(self, record: Dict[str, Any], data: str, rebase: Callable[[Dict[str, Any]], Optional[str]]) -> None:
        """A customer from Cloud, rebased onto this instance's unconfirmed meter changes, in the lock."""
        with self._using():
            self.doc.call('policy.update_customer_internals', [rebase(record) or data, 'json'])

    def _cloud_bstf(self, data: bytes) -> None:
        """
        A binary message: a whole policy document (from servers before policy-source), or capabilities as bstf.
        An update keeps this SDK's engine types (overrides made here stay); the first one becomes the document.
        """
        cloud = self._cloud
        assert cloud is not None
        try:
            incoming = Doc()
            incoming.binary_import(data, 'bstf')
            if incoming.get('<root.Limitr>.version') is None:
                with self._using():
                    self.doc.call('policy.set_capabilities', [data, 'bstf'])
                return
            with self._using():
                if cloud.init.is_set():
                    incoming.remove('LimitrTypes')
                    self.doc.call('policy.update_policy_internals', [bytes(incoming.binary_export('bstf')), 'bstf'])
                    self._reload_modules()
                else:
                    if incoming.get('LimitrTypes') is not None:
                        incoming.seal('LimitrTypes')
                    self.doc = incoming
                    self.doc.call('<Limitr>.load', [])
                    self._setup_cloud_doc()
                    cloud.init.set()
        except Exception:
            log.exception('Limitr Cloud: loading a policy from bstf failed')

