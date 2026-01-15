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


/**
 * Internally ensure there's no overlap between policy calls.
 * Supports both tail-append and head-prepend execution.
 * WASM-safe promise gating.
 */
export class LimitrGate {
    // Earliest scheduled work
    private head: Promise<unknown> = Promise.resolve();

    // Latest scheduled work
    private tail: Promise<unknown> = this.head;


    /**
     * Run at the back of this scheduler (non-priority).
     */
    run<T>(fn: () => Promise<T> | T): Promise<T> {
        const next = this.tail.then(fn);
        this.tail = next.catch(() => {});
        return next;
    }


    /**
     * Run at the front of this scheduler.
     */
    runFront<T>(fn: () => Promise<T> | T): Promise<T> {
        let release!: () => void;
        const blocker = new Promise<void>(resolve => {
            release = resolve;
        });
        const prevTail = this.tail;
        this.tail = blocker;
        const next = Promise.resolve()
            .then(fn)
            .finally(() => {
                this.tail = prevTail;
                release();
            });
        return next;
    }
}


/**
 * Helper function for waiting for the WebSocket to open.
 */
export function waitOnOpen(ws: WebSocket): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onError = (err: Event) => {
            cleanup();
            reject(err);
        };
        const cleanup = () => {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
        };
        ws.addEventListener("open", onOpen);
        ws.addEventListener("error", onError);
    });
}
