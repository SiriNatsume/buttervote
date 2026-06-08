export function countCharacters(value?: string | null) {
  return Array.from(value ?? "").length;
}

export function getDescriptionLimitError(
  description: string | undefined | null,
  maxLength: number | null | undefined,
) {
  if (typeof maxLength !== "number" || maxLength <= 0) {
    return null;
  }

  if (countCharacters(description) > maxLength) {
    return `简介最多 ${maxLength} 字。`;
  }

  return null;
}
