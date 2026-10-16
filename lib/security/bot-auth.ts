import "server-only";
import { timingSafeEqualString } from "@/lib/security/token";

export function isAuthorizedBot(request: Request) {
  const secret = process.env.BOT_API_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret && timingSafeEqualString(header?.startsWith("Bearer ") ? header.slice(7) : null, secret));
}
