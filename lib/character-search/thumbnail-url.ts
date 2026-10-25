import type { CharacterSource } from "./types";

export const CHARACTER_THUMBNAIL_PATH = "/api/characters/thumbnail";

export function characterThumbnailUrl(source: CharacterSource, url: string): string {
  return `${CHARACTER_THUMBNAIL_PATH}?${new URLSearchParams({ source, url })}`;
}
