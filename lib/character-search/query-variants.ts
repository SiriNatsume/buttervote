type NameConverter = (value: string) => string;
let converters: Promise<{ simplified: NameConverter; traditional: NameConverter }> | undefined;

function loadConverters() {
  // Dictionaries are loaded once, and only when a name contains Han characters.
  // Pure JavaScript keeps the same conversion available in Workers and browsers.
  converters ??= Promise.all([import("opencc-js/cn2t"), import("opencc-js/t2cn")])
    .then(([cn2t, t2cn]) => ({
      simplified: t2cn.Converter({ from: "t", to: "cn" }),
      traditional: cn2t.Converter({ from: "cn", to: "t" }),
    }))
    .catch((error) => { converters = undefined; throw error; });
  return converters;
}

export async function getCharacterQueryVariants(query: string): Promise<string[]> {
  const original = query.trim();
  if (!original) return [];
  if (!/\p{Script=Han}/u.test(original)) return [original];

  try {
    const convert = await loadConverters();
    return [...new Set([original, convert.simplified(original), convert.traditional(original)])];
  } catch {
    // A failed lazy dictionary download must not hide otherwise usable results.
    return [original];
  }
}
