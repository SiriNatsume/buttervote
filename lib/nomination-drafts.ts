import { z } from "zod";
import { getDescriptionLimitError } from "./description-limit";

const imageSchema = z.object({
  imagePath: z.string().min(1).max(500),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  imageSize: z.number().int().positive().max(2 * 1024 * 1024),
  imageVersion: z.number().int().positive().optional(),
});

const draftSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  image: imageSchema.nullable(),
});

const savedDraftsSchema = z.object({
  version: z.literal(1),
  userId: z.string(),
  contestId: z.string(),
  nominatorDisplayName: z.string().max(120),
  drafts: z.array(draftSchema),
});

export type NominationDraftImage = z.infer<typeof imageSchema>;
export type NominationDraft = z.infer<typeof draftSchema>;
export type SavedNominationDrafts = z.infer<typeof savedDraftsSchema>;

export function nominationDraftStorageKey(userId: string, contestId: string) {
  return `buttervote:nomination-drafts:v1:${userId}:${contestId}`;
}

export function nominationDraftImagePath(userId: string, draftId: string) {
  return `nomination-drafts/${userId}/${draftId}/image.jpg`;
}

export function createNominationDraft(): NominationDraft {
  const id = globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
    });
  return { id, name: "", description: "", image: null };
}

export function hasNominationDraftContent(draft: NominationDraft) {
  return Boolean(draft.name.trim() || draft.description.trim() || draft.image);
}

export function restoreNominationDrafts(
  raw: string | null,
  userId: string,
  contestId: string,
  submittedIds: ReadonlySet<string> = new Set(),
): SavedNominationDrafts | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = savedDraftsSchema.safeParse(value);
  if (!parsed.success || parsed.data.userId !== userId || parsed.data.contestId !== contestId) {
    return null;
  }

  const seen = new Set<string>();
  return {
    ...parsed.data,
    drafts: parsed.data.drafts
      .filter((draft) => {
        if (seen.has(draft.id) || submittedIds.has(draft.id)) return false;
        seen.add(draft.id);
        return true;
      })
      .map((draft) => ({
        ...draft,
        // Only restore images belonging to this account and this draft.
        image: draft.image?.imagePath === nominationDraftImagePath(userId, draft.id)
          ? draft.image
          : null,
      })),
  };
}

export function serializeNominationDrafts(value: SavedNominationDrafts) {
  return JSON.stringify({
    ...value,
    drafts: value.drafts.filter(hasNominationDraftContent).map((draft) => ({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      image: draft.image,
    })),
  });
}

export function getNominationDraftError(
  draft: NominationDraft,
  imageRequired: boolean,
  descriptionMaxLength?: number | null,
) {
  if (!draft.name.trim()) return "请填写候选项名称。";
  if (draft.name.trim().length > 120) return "候选项名称最多 120 字。";
  const descriptionError = getDescriptionLimitError(draft.description.trim(), descriptionMaxLength);
  if (descriptionError) return descriptionError;
  if (imageRequired && !draft.image) return "本活动要求图片，请先上传这条提名的图片。";
  return null;
}
