import "server-only";
import { serverArtifacts } from "@/lib/cache/server-artifacts";
import { artifactDigest } from "@/lib/cache/versioned-artifact-cache";
import { fetchExportAssetBytes } from "./asset-fetch";

export async function cachedExportAsset(url: string, options: {
  namespace: string;
  owner?: string;
  revision: string;
  ttlMs: number;
  maxBytes: number;
  timeoutMs?: number;
  init?: RequestInit;
  validate?: (bytes: Uint8Array) => boolean;
}) {
  const owner = await artifactDigest(options.owner ?? url);
  const load = async () => {
    const bytes = await fetchExportAssetBytes(url, options);
    if (options.validate && !options.validate(bytes)) throw new Error("Unsupported export asset format");
    return bytes;
  };
  const bytes = await serverArtifacts.getOrCreate(options.namespace, owner, options.revision, load, options.ttlMs);
  if (!options.validate || options.validate(bytes)) return bytes;
  const fresh = await load();
  await serverArtifacts.write(options.namespace, owner, options.revision, fresh, options.ttlMs);
  return fresh;
}
