export const CHARACTER_SOURCES = ["bangumi", "anilist", "vndb"] as const;
export type CharacterSource = (typeof CHARACTER_SOURCES)[number];
export type CharacterSearchSource = CharacterSource | "all";

export const CHARACTER_SOURCE_LABELS: Record<CharacterSource, string> = {
  bangumi: "Bangumi",
  anilist: "AniList",
  vndb: "VNDB",
};

export type CharacterSearchItem = {
  id: string;
  source: CharacterSource;
  name: string;
  originalName: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  works: string[];
};

export type CharacterSearchResponse = {
  items: CharacterSearchItem[];
  hasMore: boolean;
  errors: { source: CharacterSource; message: string }[];
};

export function interleaveCharacterItems(items: CharacterSearchItem[]): CharacterSearchItem[] {
  const groups = CHARACTER_SOURCES.map((source) => items.filter((item) => item.source === source));
  const result: CharacterSearchItem[] = [];
  const length = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < length; index++) {
    for (const group of groups) if (group[index]) result.push(group[index]);
  }
  return result;
}
