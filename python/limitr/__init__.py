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

"""Limitr: usage and margin control for AI products. The open-source engine, in-process."""

from .cloud import CloudError
from .engine import Limitr
from .network import LimitrNetwork, NetworkCall, Request, Response
from .types import Cap, Customer, Decision, DecisionReason, EntitlementSource, Estimate

__version__ = '0.8.9'
__all__ = ['Limitr', 'CloudError', 'LimitrNetwork', 'NetworkCall', 'Request', 'Response', 'Decision', 'DecisionReason', 'EntitlementSource', 'Estimate', 'Customer', 'Cap', '__version__']
