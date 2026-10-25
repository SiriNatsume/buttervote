import { handleCharacterThumbnail } from "@/lib/character-search/thumbnail-proxy";

// Only allowlisted, signature-checked public catalogue portraits are served.
// No application cookies, private storage, sessions or user data are involved.
export const GET = (request: Request) => handleCharacterThumbnail(request);
export const HEAD = GET;
