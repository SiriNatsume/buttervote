type MaintenanceBucket = {
  get: (key: string) => Promise<{ size: number; text: () => Promise<string> } | null>;
  list: (options: { prefix: string; limit: number; cursor?: string; include: ["customMetadata"] }) => Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated: boolean; cursor?: string;
  }>;
  put: (key: string, value: string) => Promise<unknown>;
  delete: (keys: string[]) => Promise<void>;
};
const PREFIX = "buttervote-artifacts/";
const CONTROL = "buttervote-artifacts-control/sweep";

/** One bounded page per existing authenticated cron invocation. */
export async function pruneExpiredArtifacts(bucket: MaintenanceBucket, now = Date.now()) {
  let cursor: string | undefined;
  const stateObject = await bucket.get(CONTROL);
  if (stateObject && stateObject.size <= 4096) {
    try {
      const value: unknown = JSON.parse(await stateObject.text());
      if (value && typeof value === "object" && "cursor" in value && typeof value.cursor === "string" && value.cursor.length <= 4096) cursor = value.cursor;
    } catch { /* A corrupt cache cursor can safely restart a sweep. */ }
  }
  const options = { prefix: PREFIX, limit: 250, include: ["customMetadata"] as ["customMetadata"] };
  let page;
  try { page = await bucket.list({ ...options, cursor }); }
  catch (error) {
    if (!cursor) throw error;
    page = await bucket.list(options); // expired/invalid cursors restart once
  }
  const expired = page.objects.filter((object) => {
    const expiresAt = Number(object.customMetadata?.expiresAt);
    return object.key.startsWith(PREFIX) && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now;
  }).map((object) => object.key);
  if (expired.length) await bucket.delete(expired);
  await bucket.put(CONTROL, JSON.stringify({ cursor: page.truncated ? page.cursor : null }));
  return expired.length;
}
