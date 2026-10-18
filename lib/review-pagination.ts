import { z } from "zod";

export const REVIEW_PAGE_SIZE = 50;

const cursorSchema = z.object({
  created_at: z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))),
  id: z.string().uuid(),
});
export type ReviewCursor = z.infer<typeof cursorSchema>;

export function encodeReviewCursor(row: ReviewCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(row))).toString("base64url");
}

export function decodeReviewCursor(value?: string): ReviewCursor | null {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function reviewCursorFilter(cursor: ReviewCursor, backwards: boolean) {
  // Validate at the query boundary: both values become PostgREST filter text.
  const row = cursorSchema.parse(cursor);
  const comparison = backwards ? "lt" : "gt";
  return `created_at.${comparison}.${row.created_at},and(created_at.eq.${row.created_at},id.${comparison}.${row.id})`;
}
