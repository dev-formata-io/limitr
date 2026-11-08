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

//
// Limitr Network for TypeScript. The protocol lives in the policy (the LimitrNetwork module, src/network): this file
// only holds the policy's key, lets its Http::fetch reach the providers it connects to, and turns web Requests and
// Responses into the module's NetworkRequest and NetworkResponse maps.
//

import { StofDoc, initStof } from "@formata/stof";
import type { Limitr } from "./main.js";


/**
 * Limitr Network options (limitr.network()).
 */
export interface LimitrNetworkInit {
    /**
     * This policy's identity: its secret key (base64, from StofDoc.generateKey()). It stays in this process: the
     * policy signs through it and never sees it. Without one, a new key is made (and handed to keyStore). A provider
     * should keep its key: vouchers are made out to it.
     */
    secretKey?: string;

    /** Called with a newly made secret key, so the host can keep it (Ex. in its secrets store). */
    keyStore?: (secretKey: string) => void | Promise<void>;

    /** How this policy calls itself to providers (Ex. 'support_agent'). */
    name?: string;

    /**
     * The host's own ways to its operators, by name (policy.network.operators.<name>, with `channel: true`): Ex. a
     * connection it already has to one. Each takes the operator's request and returns its response (web-standard, so
     * another policy's `network.operate` is one). Operator messages are signed envelopes, so a channel can't change
     * them: answers are still checked with the operator's key.
     */
    channels?: Record<string, LimitrNetworkChannel>;
}


/** A provider found by LimitrNetwork.discover(): its own signed manifest, checked. */
export interface LimitrNetworkDiscovered {
    /** Its public key (what signed its manifest). */
    key: string;
    name: string;
    label: string;
    /** Where it is: connect() to it (its manifest is read again from there). */
    url: string;
    /** Its terms, as JSON text. */
    terms: string;
}


/** A host's own way to an operator (see LimitrNetworkInit.channels). */
export type LimitrNetworkChannel = (request: Request) => Promise<Response>;


/**
 * An allowed request to one of this policy's routes, for its work (see LimitrNetwork.handle()).
 */
export interface LimitrNetworkCall {
    /** The route's name (from the policy's network.provider.routes). */
    route: string;
    /** The voucher's customer (its route's declared metering, if any, already done; meter the rest with it). */
    customer: string;
    /** Who the consumer is, from its identity statement (checked against this provider's identity operator), if any. */
    subject?: string;
    /** The request, as it came in (its body is already read: use `body`). */
    request: Request;
    /** The request's body text. */
    body: string;
    /** The request's query string, parsed. */
    query: URLSearchParams;
}


/**
 * How far a consumer trusts a provider: 'declarations' (the default: its routes are tools as-is, and none of its code
 * runs here) or 'logic' (its own tools run here too, sealed and confined, reaching it only through its routes).
 */
export type LimitrNetworkTrust = 'declarations' | 'logic';


/**
 * Options for connecting to a provider (limitr.network().connect()).
 */
export interface LimitrNetworkConnectOptions {
    /** A budget to spend from too (see budget()): the provider must accept the budget's operator. */
    budget?: string;
    /** How far to trust the provider ('declarations' by default). */
    trust?: LimitrNetworkTrust;
    /** With trust 'logic': other connections (by provider name) its tools may call too, spending their vouchers. */
    mayCall?: string[];
    /** The most one request may spend (runes): the provider caps the request there too. */
    max?: number;
}


/**
 * A consumer's connection to a provider (limitr.network().connection(name)).
 */
export interface LimitrNetworkConnection {
    /** The provider's name (and the prefix of its tools' names). */
    name: string;
    label: string;
    url: string;
    /** Who the provider is (its identity statement, checked with this policy's identity operator), and who said so. */
    subject?: string | null;
    issuer?: string | null;
    /** The provider's public key. */
    provider: string;
    voucher: string;
    seq: number;
    plan: string;
    /** The most this voucher spends (runes), until `expires` (ms). */
    spend: number;
    expires: number;
    /** What it has spent and has left, from the provider's latest receipt. */
    spent: number;
    remaining: number;
    /** The voucher's customer on the provider's side. */
    customer: string | null;
    /** The budget it spends from (see budget()), and what that budget has left, from the latest receipt. */
    budget: string | null;
    budget_remaining: number | null;
    /** The most one request may spend (runes), or null. */
    max: number | null;
    /** How far this policy trusts the provider, and the other connections its tools may call. */
    trust: LimitrNetworkTrust;
    may_call: string[];
    /** The routes and tools the provider's grant reaches, by name. */
    routes: string[];
    tools: string[];
}


/**
 * A budget at a state operator (limitr.network().budgetInfo(id)): one spend across many providers.
 */
export interface LimitrNetworkBudget {
    budget: string;
    /** The operator holding it (policy.network.operators.<name>). */
    operator: string;
    seq: number;
    /** The most it spends (runes) across its providers, until `expires` (ms). */
    spend: number;
    expires: number;
    /** The providers (public keys) it may be spent with; any that trust the operator when null. */
    providers: string[] | null;
    spent: number;
    remaining: number;
}


/**
 * A refused request to a provider's route: a tool's result (not an error), so an agent can act on it. Parse a result
 * that starts with `{"refused"` (see LimitrNetwork.refusal()).
 */
export interface LimitrNetworkRefusal {
    /** The provider's name. */
    provider: string;
    /** 402: a limit, the voucher's spend, its budget, or its expiry. 401: the request itself. 503: the provider's state
     * operator can't be reached. */
    status: number;
    reason: string;
    spent: number;
    remaining: number;
    budget_remaining: number | null;
    expires: number;
}


/**
 * A provider's tool (trust 'logic') that failed: an error in it, or running past the network's tool_time. A tool's
 * result (not an error). Parse a result that starts with `{"failed"` (see LimitrNetwork.failure()).
 */
export interface LimitrNetworkFailure {
    /** The provider's name. */
    provider: string;
    tool: string;
    reason: string;
}


/**
 * Limitr Network for one Limitr instance: offer this policy's services, or use other policies' and pay for them, peer
 * to peer (see src/network/SPEC.md). Get it with `await limitr.network()`.
 */
export class LimitrNetwork {
    /** This policy's identity (its public key). */
    readonly publicKey: string;

    /** The signed request's header name (set up from the module), and each voucher's requests in progress here. */
    private requestHeader = '';
    private queues = new Map<string, Promise<unknown>>();

    constructor(private limitr: Limitr, private secretKey: string, private channels: Record<string, LimitrNetworkChannel> = {}) {
        this.publicKey = StofDoc.publicKey(secretKey);
    }


    /**
     * A new identity (an Ed25519 key pair): its secret key, to keep in your secrets store and pass to
     * `limitr.network({ secretKey })`, and its public key, which others know it by (Ex. an operator that identifies it).
     */
    static async generateKey(): Promise<{ secretKey: string, publicKey: string }> {
        await initStof();
        const secretKey = StofDoc.generateKey();
        return { secretKey, publicKey: StofDoc.publicKey(secretKey) };
    }


    /**
     * The host's part for a document: NetworkKey::sign, which signs as this policy, only Limitr Network messages
     * (limitr-network/ contexts). The policy never sees the key.
     */
    setup(doc: StofDoc) {
        const secret = this.secretKey;
        const prefix = doc.get('<Network>.CONTEXT') as string; // the protocol's signing contexts (Ex. 'limitr-network/v1/')
        if (typeof prefix !== 'string' || prefix.length < 1) throw new Error('Limitr Network: the module has no signing context');
        this.requestHeader = String(doc.get('<Network>.REQUEST_HEADER') ?? '');
        doc.lib('NetworkKey', 'sign', (context: string, message: string) => {
            if (typeof context !== 'string' || !context.startsWith(prefix)) {
                throw new Error(`NetworkKey::sign signs only Limitr Network messages (${prefix} contexts)`);
            }
            return StofDoc.sign(secret, context, message);
        }, false, ['context', 'message']);
        doc.lib('NetworkChannel', 'send', async (operator: string, request: unknown) => {
            const channel = Object.prototype.hasOwnProperty.call(this.channels, operator) ? this.channels[operator] : undefined;
            if (typeof channel !== 'function') throw new Error(`no channel for operator '${operator}' (LimitrNetworkInit.channels)`);
            const response = await channel(LimitrNetwork.toRequest(request));
            const headers = new Map<string, string>();
            response.headers.forEach((value, key) => headers.set(key.toLowerCase(), value));
            return new Map<string, unknown>([['status', response.status], ['headers', headers], ['body', await response.text()]]);
        }, true, ['operator', 'request']);
    }


    /** Turn the module's NetworkRequest map into a web Request. */
    private static toRequest(request: unknown): Request {
        const get = (from: unknown, key: string): unknown => from instanceof Map ? from.get(key) : (from as Record<string, unknown> | null)?.[key];
        const method = String(get(request, 'method') ?? 'GET').toUpperCase();
        const headers = new Headers();
        const raw = get(request, 'headers');
        const entries = raw instanceof Map ? [...raw.entries()] : Object.entries((raw ?? {}) as Record<string, unknown>);
        for (const [key, value] of entries) headers.set(String(key), String(value));
        const body = String(get(request, 'body') ?? '');
        return new Request(String(get(request, 'url')), { method, headers, body: method === 'GET' || method === 'HEAD' || body.length < 1 ? undefined : body });
    }


    /** Turn a web Request into the module's NetworkRequest map. */
    private static async requestMap(request: Request): Promise<Map<string, unknown>> {
        const headers = new Map<string, string>();
        request.headers.forEach((value, key) => headers.set(key.toLowerCase(), value));
        return new Map<string, unknown>([
            ['method', request.method],
            ['url', request.url],
            ['headers', headers],
            ['body', await request.text()],
        ]);
    }


    /*****************************************************************************
     * Provider.
     *****************************************************************************/

    /**
     * Answer a request to this policy's network: its manifest, vouchers, cancels, and requests to its routes. A
     * request to a route is checked (signature, voucher, replay) first, and its route's declared metering runs; only
     * an allowed one runs `work`, whose result is the response body (a string as text, anything else as JSON, or a
     * Response). The work meters as the policy says, with `customer` (the voucher's customer: `limitr.allow(...)`,
     * reserve and settle), capped for the request: what the request spent goes in the provider's signed receipt, made
     * after the work, with the body's SHA-256. Requests on one voucher run one at a time here (others in parallel).
     * The requests a provider's own tools make (on the consumer's side) come here the same way. If `work` throws, the
     * request is still finished (it costs what it metered), and the error is thrown on.
     *
     * A web-standard handler: use it directly with Deno.serve, Bun.serve, Cloudflare Workers, Hono, Next.js routes, or
     * any server that speaks Request and Response.
     */
    async handle(request: Request, work: (call: LimitrNetworkCall) => unknown): Promise<Response> {
        const req = await LimitrNetwork.requestMap(request);
        return await this.queued(this.voucherOf(req), () => this.answer(request, req, work));
    }


    /** handle(), for one request (queued by its voucher). */
    private async answer(request: Request, req: Map<string, unknown>, work: (call: LimitrNetworkCall) => unknown): Promise<Response> {
        const body = req.get('body') as string;
        const answer = await this.limitr.docCall('LimitrNetwork.handle', req) as Map<string, unknown>;

        let status = answer.get('status') as number;
        const replyHeaders = new Headers(Object.fromEntries(answer.get('headers') as Map<string, string>));
        const route = answer.get('route') as string | undefined;
        const customer = answer.get('customer') as string | undefined;
        const n = answer.get('request') as number | undefined;
        if (status !== 200 || !route || !customer || n == null) {
            return new Response(answer.get('body') as string, { status, headers: replyHeaders });
        }

        let text = '';
        let failure: unknown = undefined;
        try {
            const subject = answer.get('subject') as string | undefined;
            const result = await work({ route, customer, ...(subject ? { subject } : {}), request, body, query: new URL(request.url).searchParams });
            if (result instanceof Response) {
                status = result.status;
                result.headers.forEach((value, key) => replyHeaders.set(key, value));
                text = await result.text();
            } else if (typeof result === 'string') {
                replyHeaders.set('content-type', 'text/plain');
                text = result;
            } else {
                replyHeaders.set('content-type', 'application/json');
                text = JSON.stringify(result ?? null);
            }
        } catch (error) {
            failure = error;
        }
        // finished either way: it costs what it metered, and the receipt says so (with the body's SHA-256)
        const finish = await this.limitr.docCall('LimitrNetwork.done', customer, n, failure === undefined ? text : '') as Map<string, string>;
        if (failure !== undefined) throw failure;
        for (const [key, value] of finish) replyHeaders.set(key, value);
        return new Response(text, { status, headers: replyHeaders });
    }


    /** The voucher a request is under (from its signed request header), or null. */
    private voucherOf(req: Map<string, unknown>): string | null {
        const signed = (req.get('headers') as Map<string, string>).get(this.requestHeader);
        if (!signed) return null;
        try {
            const voucher = (JSON.parse(signed) as { voucher?: unknown }).voucher;
            return typeof voucher === 'string' ? voucher : null;
        } catch {
            return null;
        }
    }


    /** Run requests on one voucher one at a time (so a request's cap counts only its own spend); others in parallel. */
    private async queued<T>(key: string | null, run: () => Promise<T>): Promise<T> {
        if (key == null) return await run();
        const before = this.queues.get(key) ?? Promise.resolve();
        const mine = before.then(run, run);
        const tail = mine.then(() => undefined, () => undefined);
        this.queues.set(key, tail);
        try {
            return await mine;
        } finally {
            if (this.queues.get(key) === tail) this.queues.delete(key);
        }
    }


    /** This policy's signed manifest (its terms). handle() serves it at GET /.well-known/limitr-network. */
    async manifest(): Promise<string> {
        return await this.limitr.docCall('LimitrNetwork.manifest') as string;
    }


    /**
     * End a voucher from this side: it stops being allowed now. Returns the signed revoke to send the consumer, if you
     * can reach it (it learns anyway on its next call, which is refused).
     */
    async revoke(voucher: string, reason: string = ''): Promise<string | null> {
        return await this.limitr.docCall('LimitrNetwork.revoke', voucher, reason) as string | null;
    }


    /**
     * Remove voucher customers that ended more than a week ago (the policy's network.provider.keep_ended), after a
     * 'network-voucher-ended' event with each. handle() runs it at most once an hour.
     */
    async sweep(): Promise<number> {
        return await this.limitr.docCall('LimitrNetwork.sweep') as number;
    }


    /*****************************************************************************
     * Consumer.
     *****************************************************************************/

    /**
     * Start using a provider: read its manifest, sign a voucher for one of its plans (up to `spend` runes, until
     * `expires`), and take its grant. Its routes become tools here ('<provider>_<route>', capabilities run like any
     * other: limitr.runCapability, limitr.claudeTools). Returns their names. A new voucher for a provider replaces the
     * old one.
     *
     * A refused request is the tool's result (see refusal()), not an error, so an agent can act on it. Raising spend
     * is the host's decision: update().
     *
     * Options: `budget` (see budget()) spends from that budget too, one spend across several providers (the provider
     * must accept the budget's operator). `trust: 'logic'` runs the provider's own tools here too
     * ('<provider>_<tool>'), sealed and confined: they see nothing of this policy, call no host, and reach the
     * provider only through its routes (each request signed for this voucher and metered there). `mayCall` lets them
     * call those other connections' routes too, spending their vouchers.
     */
    async connect(url: string, plan: string, spend: number, expires: number | Date, options: LimitrNetworkConnectOptions = {}): Promise<string[]> {
        this.limitr.allowNetworkHost(url);
        return await this.limitr.docCall('LimitrNetwork.connect', url, plan, spend, ms(expires), options.budget ?? null, options.trust ?? null, options.mayCall ?? null, options.max ?? null) as string[];
    }


    /**
     * Change how far this policy trusts a connection's provider ('declarations' or 'logic'), and which other
     * connections its tools may call (unchanged when not given). Its tools here are made again; returns their names.
     */
    async trust(name: string, trust: LimitrNetworkTrust, mayCall?: string[]): Promise<string[]> {
        return await this.limitr.docCall('LimitrNetwork.trust', name, trust, mayCall ?? null) as string[];
    }


    /**
     * Open a budget at one of the policy's state operators (by its name in policy.network.operators): up to `spend`
     * runes across every provider connected with it, until `expires`, only with `providers` (public keys) when given.
     * Returns its ID. Pass `id` to change an existing budget (an expiry of now ends it).
     */
    async budget(operator: string, spend: number, expires: number | Date, options: { providers?: string[], id?: string } = {}): Promise<string> {
        return await this.limitr.docCall('LimitrNetwork.budget', operator, spend, ms(expires), options.providers ?? null, options.id ?? null) as string;
    }


    /**
     * List this provider at its discovery operator: public, or private to `members` (public keys) and `subjects` (who
     * the operator identified, Ex. an organization). List again after the terms change.
     */
    async list(visibility: 'public' | 'private' = 'public', options: { members?: string[], subjects?: string[] } = {}): Promise<boolean> {
        return await this.limitr.docCall('LimitrNetwork.list', visibility, options.members ?? null, options.subjects ?? null) as boolean;
    }


    /** Remove this provider's listing at its discovery operator. */
    async unlist(): Promise<boolean> {
        return await this.limitr.docCall('LimitrNetwork.unlist') as boolean;
    }


    /**
     * Search a discovery operator for providers (every word of `query` in a provider's name, label, or its routes' and
     * tools' descriptions; empty for all). The search is signed, so listings private to this policy's key (or, with
     * an identity statement from that operator, to who it is) come back too. Each result is a provider's own signed
     * manifest, checked here.
     */
    async discover(query = '', options: { limit?: number, operator?: string } = {}): Promise<LimitrNetworkDiscovered[]> {
        const found = await this.limitr.docCall('LimitrNetwork.discover', query, options.limit ?? 20, options.operator ?? null) as unknown[];
        return (found ?? []).map((item) => {
            const get = (key: string) => item instanceof Map ? item.get(key) : (item as Record<string, unknown>)[key];
            return { key: String(get('key')), name: String(get('name')), label: String(get('label')), url: String(get('url')), terms: String(get('terms')) };
        });
    }


    /**
     * Rotate this policy's key (for an operator): returns a statement, signed by the key it has now, that its key is
     * now `publicKey` (StofDoc.publicKey(newSecretKey)). Add it to the policy's network.service.rotations (in order),
     * then start with the new secret key: policies that name the operator by its first key follow the chain from its
     * manifest, so their terms, vouchers, and budgets go on.
     */
    async rotation(publicKey: string): Promise<string> {
        return await this.limitr.docCall('LimitrNetwork.rotation', publicKey) as string;
    }


    /**
     * Get an identity statement for this policy's key from an identity operator (by its name in
     * policy.network.operators; the one serving 'identity' when omitted). Every voucher carries it from now on, for
     * providers that require one. Returns who the operator says this policy is.
     */
    async identify(operator?: string): Promise<string> {
        return await this.limitr.docCall('LimitrNetwork.identify', operator ?? null) as string;
    }


    /** A budget by ID: its spend, and what it has spent and has left. */
    async budgetInfo(id: string): Promise<LimitrNetworkBudget | undefined> {
        const json = await this.limitr.docCall('LimitrNetwork.budget_info', id) as string | null;
        return json ? JSON.parse(json) as LimitrNetworkBudget : undefined;
    }


    /** A tool's result as a refusal, when it is one (undefined otherwise). */
    refusal(result: unknown): LimitrNetworkRefusal | undefined {
        if (typeof result !== 'string' || !result.startsWith('{"refused"')) return undefined;
        try {
            return (JSON.parse(result) as { refused: LimitrNetworkRefusal }).refused;
        } catch {
            return undefined;
        }
    }


    /** A provider tool's result as a failure, when it is one (undefined otherwise). */
    failure(result: unknown): LimitrNetworkFailure | undefined {
        if (typeof result !== 'string' || !result.startsWith('{"failed"')) return undefined;
        try {
            return (JSON.parse(result) as { failed: LimitrNetworkFailure }).failed;
        } catch {
            return undefined;
        }
    }


    /*****************************************************************************
     * Operators.
     *****************************************************************************/

    /** Check every operator in the policy (its signed manifest, roles, and modes). Throws with the reason when one is off. */
    async checkOperators(): Promise<boolean> {
        return await this.limitr.docCall('LimitrNetwork.check_operators') as boolean;
    }


    /**
     * When this policy is an operator (policy.network.service): answer a request to it, its manifest and the state
     * role's messages. A web-standard handler, like handle().
     */
    async operate(request: Request): Promise<Response> {
        const answer = await this.limitr.docCall('LimitrNetwork.operate', await LimitrNetwork.requestMap(request)) as Map<string, unknown>;
        const headers = new Headers(Object.fromEntries(answer.get('headers') as Map<string, string>));
        return new Response(answer.get('body') as string, { status: answer.get('status') as number, headers });
    }


    /** Change a connection's voucher (more or less spend, a later or earlier expiry), and take the new grant. */
    async update(name: string, change: { spend?: number, expires?: number | Date }): Promise<string[]> {
        return await this.limitr.docCall('LimitrNetwork.update', name, change.spend ?? null, change.expires != null ? ms(change.expires) : null) as string[];
    }


    /**
     * Stop using a provider: tells it (its voucher ends now), and removes the connection and its capabilities here.
     * False when there's no such connection.
     */
    async cancel(name: string): Promise<boolean> {
        return await this.limitr.docCall('LimitrNetwork.cancel', name) as boolean;
    }


    /** A provider's revoke: removes that connection and its capabilities. True when it was valid. */
    async revoked(message: string): Promise<boolean> {
        return await this.limitr.docCall('LimitrNetwork.revoked', message) as boolean;
    }


    /** A connection by its provider's name: its voucher, and what it has spent and has left. */
    async connection(name: string): Promise<LimitrNetworkConnection | undefined> {
        const json = await this.limitr.docCall('LimitrNetwork.connection', name) as string | null;
        return json ? JSON.parse(json) as LimitrNetworkConnection : undefined;
    }
}


/** A time as ms. */
function ms(time: number | Date): number {
    return time instanceof Date ? time.getTime() : time;
}
