import "server-only";
import { cache } from "react";
import { connection } from "next/server";

// One wall-clock reference per real server request; never a prerendered time.
export const getRequestTime = cache(async () => {
  await connection();
  return Date.now();
});
