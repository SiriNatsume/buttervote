const REQUEST_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 60_000;

// Used only by server-side clients. Keep the abort signal attached after fetch
// resolves: the deadline must also cover a stalled response body, not just TTFB.
export function createSupabaseFetch({
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  storageTimeoutMs = STORAGE_TIMEOUT_MS,
}: {
  requestTimeoutMs?: number;
  storageTimeoutMs?: number;
} = {}): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const timeout = AbortSignal.timeout(
      url.pathname.startsWith("/storage/v1/")
        ? storageTimeoutMs
        : requestTimeoutMs,
    );
    const callerSignal = init?.signal === undefined && input instanceof Request
      ? input.signal
      : init?.signal;

    return fetch(input, {
      ...init,
      signal: callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout,
    });
  };
}

export const supabaseFetch = createSupabaseFetch();
