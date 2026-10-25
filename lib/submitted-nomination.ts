import type { NominationDraft } from "./nomination-drafts";
import type { Nomination, NominationStatus } from "./types";

export type SubmittedNomination = Pick<Nomination,
  "id" | "name" | "description" | "status" | "image_path" | "updated_at">;

type Entry = NominationDraft & { state: string; submittedStatus?: NominationStatus };

export function nominationImageVersion(updatedAt?: string) {
  const version = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(version) ? version : undefined;
}

// Submitted cards are receipts, not another editable copy of the nomination.
// Keep unsent drafts untouched and use the action result until refresh arrives.
export function nominationDisplay(entry: Entry, current?: SubmittedNomination) {
  if (entry.state === "success" && current) {
    return {
      name: current.name, description: current.description ?? "", status: current.status,
      imagePath: current.image_path, imageVersion: nominationImageVersion(current.updated_at),
    };
  }
  return {
    name: entry.name, description: entry.description, status: entry.submittedStatus ?? "pending",
    imagePath: entry.image?.imagePath ?? null, imageVersion: entry.image?.imageVersion,
  };
}
