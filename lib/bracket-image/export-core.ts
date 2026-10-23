import type { createVersionedArtifactCache } from "../cache/versioned-artifact-cache";

export type BracketExportState = {
  groupId: string;
  groupName: string;
  tournamentId: string;
  revision: string;
  cacheable: boolean;
  visibilityVersion: string;
  assets: Record<string, string | null>;
};
type Ready = {
  kind: "ready";
  png: Uint8Array;
  groupName: string;
  visibilityVersion: string;
  cache: "HIT" | "MISS" | "LIVE";
  etag: string | null;
  elapsedMs: number;
};
export type BracketExportResult = Ready | { kind: "not-found" } | { kind: "changed" } | { kind: "deferred" }
  | { kind: "not-modified"; etag: string; elapsedMs: number };
type Built = { png: Uint8Array; complete: boolean; visibilityVersion: string };
// Bump this when layout, export dimensions, or font rendering changes.
export const BRACKET_EXPORT_RENDER_VERSION = "cream-poster-v1";

function validPng(bytes: Uint8Array) {
  return bytes.byteLength > 32 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
}

export function createBracketImageExporter<Caller>({ authorize, loadState, build, cache }: {
  authorize: (caller: Caller, groupId: string) => Promise<boolean>;
  loadState: (groupId: string, tournamentId?: string | null) => Promise<BracketExportState | null>;
  build: (state: BracketExportState) => Promise<Built | null>;
  cache: Pick<ReturnType<typeof createVersionedArtifactCache>, "read" | "write">;
}) {
  const pending = new Map<string, Promise<Built | null>>();
  return async (input: {
    caller: Caller; groupId: string; tournamentId?: string | null; requestedVersion?: string;
    ifNoneMatch?: string | null; prefetch?: boolean;
  }): Promise<BracketExportResult> => {
    const started = performance.now();
    const [allowed, state] = await Promise.all([
      authorize(input.caller, input.groupId), loadState(input.groupId, input.tournamentId),
    ]);
    if (!allowed || !state || state.groupId !== input.groupId) return { kind: "not-found" } as const;
    if (input.requestedVersion && input.requestedVersion !== state.visibilityVersion) return { kind: "changed" } as const;
    const revision = `${BRACKET_EXPORT_RENDER_VERSION}:${state.tournamentId}:${state.revision}`;
    // This describes the complete rendering inputs, rather than byte identity.
    // Only complete, stable images receive a validator for in-page reuse.
    const etag = `W/"${revision}"`;
    const ready = (png: Uint8Array, hit: Ready["cache"], reusable: boolean): Ready => ({
      kind: "ready", png, groupName: state.groupName, visibilityVersion: state.visibilityVersion,
      cache: hit, etag: reusable ? etag : null, elapsedMs: Math.round(performance.now() - started),
    });
    const recheck = async () => {
      const [stillAllowed, current] = await Promise.all([
        authorize(input.caller, input.groupId), loadState(input.groupId, state.tournamentId),
      ]);
      if (!stillAllowed || !current || current.groupId !== input.groupId) return { kind: "not-found" } as const;
      if (current.revision !== state.revision || current.visibilityVersion !== state.visibilityVersion
        || current.tournamentId !== state.tournamentId || current.cacheable !== state.cacheable) return { kind: "changed" } as const;
      return null;
    };
    // Current caller authorization and a fresh DB fingerprint always precede
    // the private cache. No client-provided revision can authorize cached bytes.
    if (input.prefetch && !state.cacheable) return { kind: "deferred" };
    if (state.cacheable && input.ifNoneMatch === etag) {
      // Revalidate on every click, including access revoked while checking the
      // first snapshot. Matching browser bytes need no R2 read or PNG transfer.
      return (await recheck()) ?? {
        kind: "not-modified", etag, elapsedMs: Math.round(performance.now() - started),
      };
    }
    if (state.cacheable) {
      const hit = await cache.read("bracket-export-v1", input.groupId, revision);
      if (hit && validPng(hit)) return (await recheck()) ?? ready(hit, "HIT", true);
    }
    const pendingKey = `${input.groupId}:${revision}`;
    let promise = state.cacheable ? pending.get(pendingKey) : undefined;
    if (!promise) {
      promise = build(state);
      if (state.cacheable) pending.set(pendingKey, promise);
    }
    try {
      const built = await promise;
      if (!built || built.visibilityVersion !== state.visibilityVersion) return { kind: "changed" } as const;
      // Recheck after slow rendering OR R2 reads, for every waiting caller.
      const changed = await recheck();
      if (changed) return changed;
      if (state.cacheable && built.complete && validPng(built.png)) {
        await cache.write("bracket-export-v1", input.groupId, revision, built.png, 3_600_000);
        const changedDuringWrite = await recheck();
        if (changedDuringWrite) return changedDuringWrite;
      }
      return ready(built.png, state.cacheable ? "MISS" : "LIVE", state.cacheable && built.complete && validPng(built.png));
    } finally { if (pending.get(pendingKey) === promise) pending.delete(pendingKey); }
  };
}
