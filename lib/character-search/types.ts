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
