"use server";

import { revalidatePath } from "next/cache";

export async function refreshContestAction(contestId: string) {
  revalidatePath("/");
  revalidatePath(`/contests/${contestId}`);
  revalidatePath(`/contests/${contestId}/results`);
}
