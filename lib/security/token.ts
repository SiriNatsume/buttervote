import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

const allowedReturnToPrefixes = ["/contests/", "/groups/", "/me/"];

export function generateRandomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function timingSafeEqualString(input: string | null | undefined, expected: string) {
  if (!input) {
    return false;
  }

  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

export function safeReturnTo(input?: string | null) {
  const value = input?.trim();

  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(value, "https://local.invalid");
    const isAllowed =
      url.pathname === "/" ||
      allowedReturnToPrefixes.some((prefix) => url.pathname.startsWith(prefix));

    if (!isAllowed) {
      return "/";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function getEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
