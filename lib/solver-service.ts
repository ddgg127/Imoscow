import type { SolverPayload, SolverResponse } from "./server-solver.ts";
import { solverServiceError } from "./solver-error.ts";

type ClientOptions = {
  fetch?: typeof globalThis.fetch;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};
type Pending = {
  key: string; base: string; body: string; background: boolean;
  controller: AbortController; consumers: number; timer: ReturnType<typeof setTimeout>;
  promise: Promise<SolverResponse>;
  resolve: (value: SolverResponse) => void; reject: (error: unknown) => void;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Расчёт отменён", "AbortError");
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function solverRetryDelay(retryAfter: string | null, attempt: number, now = Date.now()): number {
  const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  const specified = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now : NaN;
  // Never retry earlier than Retry-After. The whole request has a separate deadline.
  return Number.isFinite(specified) ? Math.max(0, specified) : Math.min(8000, 1000 * 2 ** attempt);
}

// One upstream calculation at a time: a free instance must not run dozens of
// counterfactual searches in parallel. Main planning precedes queued analysis.
export function createSolverServiceClient(options: ClientOptions = {}) {
  const fetchService = options.fetch ?? globalThis.fetch;
  const wait = options.wait ?? waitForRetry;
  const now = options.now ?? Date.now;
  const pending = new Map<string, Pending>();
  const queue: Pending[] = [];
  const readyUntil = new Map<string, number>();
  let running = false;

  async function request(base: string, path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; attempt < 5; attempt++) {
      signal.throwIfAborted();
      const response = await fetchService(`${base}${path}`, { ...init, signal });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      if (![429, 502, 503, 504].includes(response.status) || attempt === 4) {
        throw new Error(solverServiceError(response.status, body));
      }
      const delay = solverRetryDelay(response.headers.get("retry-after"), attempt, now());
      console.warn(`[solver] ${path}: HTTP ${response.status}; retry ${attempt + 1} in ${delay} ms`);
      await wait(delay, signal);
    }
    throw new Error("OR-Tools временно недоступен");
  }

  async function health(base: string, signal: AbortSignal): Promise<void> {
    const value = await request(base, "/health", { method: "GET" }, signal) as { status?: string; solver?: string } | null;
    if (value?.status !== "ok" || value?.solver !== "ortools") throw new Error("OR-Tools health-check не подтверждён");
    readyUntil.set(base, now() + 15_000);
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const index = Math.max(0, queue.findIndex(item => !item.background));
        const item = queue.splice(index, 1)[0];
        try {
          const signal = item.controller.signal;
          signal.throwIfAborted();
          if ((readyUntil.get(item.base) ?? 0) <= now()) await health(item.base, signal);
          const response = await request(item.base, "/solve", {
            method: "POST", headers: { "content-type": "application/json" }, body: item.body,
          }, signal) as SolverResponse | null;
          if (response?.engine !== "ortools" || !Array.isArray(response.routes)) throw new Error("Внешний сервис не подтвердил движок OR-Tools");
          item.resolve(response);
        } catch (error) { item.reject(error); }
        finally { clearTimeout(item.timer); if (pending.get(item.key) === item) pending.delete(item.key); }
      }
    } finally { running = false; }
  }

  function subscribe(item: Pending, signal?: AbortSignal): Promise<SolverResponse> {
    item.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        item.consumers--;
      };
      const onAbort = () => {
        if (settled) return;
        release();
        if (!item.consumers) {
          item.controller.abort(signal?.reason);
          if (pending.get(item.key) === item) pending.delete(item.key);
        }
        reject(abortError(signal!));
      };
      item.promise.then(value => { if (!settled) { release(); resolve(value); } }, error => { if (!settled) { release(); reject(error); } });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  return {
    solve(base: string, payload: SolverPayload, signal?: AbortSignal): Promise<SolverResponse> {
      if (signal?.aborted) return Promise.reject(abortError(signal));
      const body = JSON.stringify(payload);
      const key = `${base}\n${body}`;
      let item = pending.get(key);
      if (!item) {
        const controller = new AbortController();
        let resolve!: Pending["resolve"], reject!: Pending["reject"];
        const promise = new Promise<SolverResponse>((ok, fail) => { resolve = ok; reject = fail; });
        item = { key, base, body, background: Boolean(payload.forcedAssignments && Object.keys(payload.forcedAssignments).length), controller, consumers: 0, promise, resolve, reject,
          timer: setTimeout(() => controller.abort(new Error("OR-Tools не ответил вовремя: очередь расчётов занята. Повторите действие позже.")), options.timeoutMs ?? 180_000) };
        pending.set(key, item);
        queue.push(item);
      }
      const result = subscribe(item, signal);
      void pump();
      return result;
    },
    health,
  };
}
