export const VOTE_IMAGE_WIDTHS = [32, 64, 96, 128, 256, 512, 640, 768, 1024, 1280] as const;
export type VoteImageWidth = (typeof VOTE_IMAGE_WIDTHS)[number];

export function getVoteImageSources(src: string, maxWidth: VoteImageWidth = 1280) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!origin) return { src };

  let url: URL;
  let storage: URL;
  try {
    url = new URL(src);
    storage = new URL(origin);
  } catch {
    // Local placeholders and browser upload previews keep their original URL.
    return { src };
  }
  if (url.origin !== storage.origin || !url.pathname.startsWith("/storage/v1/object/public/vote-images/")) {
    return { src };
  }

  const widths = VOTE_IMAGE_WIDTHS.filter((width) => width <= maxWidth);
  const optimized = (width: number) => `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=75`;
  return {
    src: optimized(maxWidth),
    srcSet: widths.map((width) => `${optimized(width)} ${width}w`).join(", "),
  };
}
