/** Fails if any ingredient in the catalog has no plain-English entry in src/lib/glossary.ts. */
import { getProducts } from "../src/lib/catalog";
import { lookupIngredient } from "../src/lib/glossary";
import { splitIngredients } from "../src/lib/page-context";

const missing = new Map<string, string[]>();
for (const p of getProducts()) {
  for (const inci of splitIngredients(p.ingredient_list)) {
    if (!lookupIngredient(inci)) missing.set(inci, [...(missing.get(inci) ?? []), p.product_id]);
  }
}
if (missing.size) {
  console.error("Ingredients with no plain-English name:");
  for (const [inci, ids] of missing) console.error(`  ${inci}  (${ids.join(", ")})`);
  process.exit(1);
}
console.log("Every catalog ingredient has a plain-English name.");
