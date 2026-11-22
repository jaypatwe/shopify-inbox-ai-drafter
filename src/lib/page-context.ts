import { lookupIngredient, normalizeInci, TAG_LABELS } from "./glossary";
import type { AnnotatedIngredient, Product } from "./types";

export function splitIngredients(list: string): string[] {
  // Commas inside brackets ("Iron Oxides (CI 77491)") never occur in this catalog, so a plain split is safe.
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the "INCI (plain English)" display form. If the label already carries a bracket that
 * says the same thing as the plain name ("Cera Alba (Beeswax)"), the label is kept as it is.
 */
export function annotateIngredient(inci: string): AnnotatedIngredient {
  const entry = lookupIngredient(inci);
  if (!entry) return { inci, plain: null, display: inci, tags: [] };
  const bracket = inci.match(/\(([^)]*)\)/)?.[1]?.toLowerCase();
  const alreadyPlain = bracket !== undefined && entry.plain.toLowerCase().includes(bracket);
  return {
    inci,
    plain: entry.plain,
    display: alreadyPlain ? inci : `${inci} (${entry.plain})`,
    tags: entry.tags ?? [],
  };
}

export function annotateIngredients(product: Product): AnnotatedIngredient[] {
  return splitIngredients(product.ingredient_list).map(annotateIngredient);
}

/** Pulls out a "Made in a facility that also handles ..." cross-contact warning, if the page has one. */
export function facilityWarning(product: Product): string | null {
  return product.allergen_statement.match(/made in a facility[^.]*\./i)?.[0] ?? null;
}

/** The product page as the model sees it. Nothing outside this text may appear in an answer. */
export function renderProductPage(product: Product): string {
  const ingredients = annotateIngredients(product)
    .map((i, n) => {
      const tags = i.tags.length ? `  [${i.tags.map((t) => TAG_LABELS[t as keyof typeof TAG_LABELS]).join(", ")}]` : "";
      return `  ${n + 1}. ${i.display}${tags}`;
    })
    .join("\n");

  const field = (name: string, value: string) => `${name}: ${value.trim() || "(empty on the page)"}`;

  return [
    field("title", product.title),
    field("price", product.price ? `${product.price} USD` : ""),
    field("size", product.size),
    field("description", product.description),
    `ingredient_list (raw, in label order): ${product.ingredient_list}`,
    `ingredient_list (each ingredient as you must write it to a shopper, with plain-English names):\n${ingredients}`,
    field("allergen_statement", product.allergen_statement),
    field("usage_instructions", product.usage_instructions),
  ].join("\n");
}

/** Normalizes text so quote checks ignore case, spacing, curly quotes and dash styles. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

/** Deterministic ingredient lookup, independent of the model. */
const TERM_ALIASES: Record<string, { tags?: string[]; words?: string[] }> = {
  nut: { tags: ["tree_nut"] },
  nuts: { tags: ["tree_nut"] },
  "tree nut": { tags: ["tree_nut"] },
  "tree nuts": { tags: ["tree_nut"] },
  wool: { tags: ["wool"] },
  bee: { tags: ["bee"] },
  bees: { tags: ["bee"] },
  "essential oil": { tags: ["essential_oil"] },
  "essential oils": { tags: ["essential_oil"] },
  fragrance: { tags: ["fragrance"] },
  perfume: { tags: ["fragrance"] },
  parfum: { tags: ["fragrance"] },
  "vit e": { words: ["vitamin e"] },
  "vitamin e": { words: ["vitamin e"] },
  "vit c": { words: ["vitamin c"] },
  "vitamin c": { words: ["vitamin c"] },
  "shea butter": { words: ["shea"] },
  "coconut oil": { words: ["coconut oil"] },
  "almond oil": { words: ["almond"] },
  "lavender oil": { words: ["lavender"] },
  "argan oil": { words: ["argan"] },
};

/**
 * Ingredient words shoppers use. Detected in the message by code, so the ingredient yes/no check
 * runs even when a (free) model forgets to report what the shopper asked about.
 */
const SHOPPER_TERMS = [
  "almond oil", "almond", "tree nuts", "tree nut", "nuts", "nut", "peanut", "macadamia", "apricot",
  "coconut oil", "coconut", "shea butter", "shea", "cocoa butter", "cocoa", "lanolin", "wool",
  "beeswax", "honey", "propolis", "bees", "oat", "vitamin e", "vit e", "tocopherol", "vitamin c",
  "vit c", "fragrance", "perfume", "parfum", "essential oils", "essential oil", "linalool", "limonene",
  "lavender oil", "lavender", "peppermint", "tea tree", "rosehip", "aloe", "glycerin", "niacinamide",
  "retinol", "parabens", "paraben", "argan oil", "argan", "jojoba", "castor", "menthol", "camphor",
  "salicylic", "willow", "zinc", "sunflower", "squalane", "hyaluronic", "sulfate", "sulfates",
  "silicone", "silicones", "mineral oil",
];

export function detectIngredientTerms(message: string): string[] {
  let text = ` ${message.toLowerCase().replace(/[^a-z0-9\s-]/g, " ")} `;
  const found: string[] = [];
  for (const term of [...SHOPPER_TERMS].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![a-z])${term.replace(/[-]/g, "\\-")}(?![a-z])`);
    if (re.test(text)) {
      found.push(term);
      text = text.replace(new RegExp(re.source, "g"), " ");
    }
  }
  return found;
}

/**
 * Returns ingredients that are the thing asked about (`direct`, e.g. "Cocos Nucifera Oil" for
 * "coconut") and ingredients made from it (`related`, e.g. "Coco-Glucoside").
 */
export function findIngredient(
  product: Product,
  term: string,
): { direct: AnnotatedIngredient[]; related: AnnotatedIngredient[] } {
  const t = normalizeForMatch(term);
  const singular = t.replace(/s$/, "");
  const alias = TERM_ALIASES[t] ?? TERM_ALIASES[singular];
  const words = alias?.words ?? [t, singular];
  const direct: AnnotatedIngredient[] = [];
  const related: AnnotatedIngredient[] = [];
  for (const i of annotateIngredients(product)) {
    const tagHit = alias?.tags?.some((tag) => i.tags.includes(tag)) ?? false;
    const hay = `${normalizeInci(i.inci)} ${normalizeForMatch(i.inci)} ${normalizeForMatch(i.plain ?? "")}`;
    // Whole-word match, so "glycerin" doesn't match "Ethylhexylglycerin".
    const wordHit =
      !(alias?.tags && !alias.words) &&
      words.some((w) => new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![a-z])`).test(hay));
    if (!tagHit && !wordHit) continue;
    // "made from coconut oil" in a plain-English description means coconut-derived, not coconut.
    if (!tagHit && i.tags.includes("coconut_derived")) related.push(i);
    else direct.push(i);
  }
  return { direct, related };
}
