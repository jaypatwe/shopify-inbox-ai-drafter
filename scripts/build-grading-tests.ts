/**
 * Turns data/answer.csv into promptfoo test cases (promptfoo/tests.generated.json).
 *
 * promptfoo's custom checks must be plain JavaScript, so everything that needs the product
 * catalog and the ingredient dictionary (TypeScript) is worked out here and handed to
 * promptfoo/checks.cjs as per-test config. The checks themselves stay simple and independent of
 * the drafting pipeline, which is the thing being graded.
 *
 * Free-quota aware: every AI-judge call is one of the day's 50 free requests. Replies already
 * judged are always included (promptfoo serves them from its cache, at no cost); new ones are
 * added only up to --max-new (default: today's remaining free requests).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { getProduct, getProducts } from "../src/lib/catalog";
import { normalizeInci } from "../src/lib/glossary";
import {
  annotateIngredients,
  facilityWarning,
  findIngredient,
  renderProductPage,
  SHOPPER_TERMS,
  splitIngredients,
} from "../src/lib/page-context";
import { getFreeQuota } from "../src/lib/quota";
import type { Product } from "../src/lib/types";

process.loadEnvFile(".env.local");

const ANSWERS = "data/answer.csv";
const OUT = "promptfoo/tests.generated.json";
const JUDGED = "promptfoo/judged.json";
/** Replies whose judge response was malformed get a new attempt number, which changes the
 * grader prompt so promptfoo's cache can't return the same broken answer. */
const ATTEMPTS = "promptfoo/judge-attempts.json";

// Words that show up in ordinary usage text ("rinse with water") and would cause false alarms.
const NOT_INGREDIENT_CLAIMS = new Set(["water"]);

/** Every ingredient-ish term a reply could mention: shopper words, catalog INCI names, short plain names. */
function vocabulary(): string[] {
  const terms = new Set(SHOPPER_TERMS);
  for (const p of getProducts()) {
    for (const ing of annotateIngredients(p)) {
      terms.add(normalizeInci(ing.inci));
      const head = ing.plain?.split(/[,;]/)[0].trim().toLowerCase();
      if (head && head.split(" ").length <= 4 && !head.startsWith("a ")) terms.add(head);
    }
  }
  return [...terms].filter((t) => t.length > 2 && !NOT_INGREDIENT_CLAIMS.has(t));
}

function isOnPage(product: Product, term: string): boolean {
  const { direct, related } = findIngredient(product, term);
  if (direct.length || related.length) return true;
  return splitIngredients(product.ingredient_list).some((i) => normalizeInci(i) === term);
}

function gradingConfig(product: Product, question: string) {
  const vocab = vocabulary();
  const ingredients = annotateIngredients(product);
  const present = vocab.filter((t) => isOnPage(product, t));
  const absent = vocab.filter((t) => !present.includes(t));
  return {
    productTitle: product.title,
    // The whole page as text: a reply quoting the page word for word is never "making it up".
    pageText: [product.title, product.description, product.ingredient_list, product.allergen_statement, product.usage_instructions, product.size, product.price]
      .join(" \n ")
      .toLowerCase(),
    presentTerms: present,
    absentTerms: absent,
    needsBracket: ingredients.filter((i) => i.display !== i.inci).map((i) => ({ inci: i.inci, display: i.display })),
    facilityWarning: facilityWarning(product),
    allergyQuestion: /allerg|react|sensitiv|intoleran|hives|rash|anaphyla|nut[- ]?free|breaks? me out|break out|irritat/i.test(question),
  };
}

async function main() {
  if (!existsSync(ANSWERS)) throw new Error(`${ANSWERS} not found. Run npm run answers first.`);
  const rows = Papa.parse<Record<string, string>>(readFileSync(ANSWERS, "utf8"), { header: true, skipEmptyLines: true }).data;
  const judged = new Set<string>(existsSync(JUDGED) ? JSON.parse(readFileSync(JUDGED, "utf8")) : []);
  const attempts: Record<string, number> = existsSync(ATTEMPTS) ? JSON.parse(readFileSync(ATTEMPTS, "utf8")) : {};

  const arg = process.argv.find((a) => a.startsWith("--max-new="));
  const quota = await getFreeQuota({ fresh: true });
  const maxNew = arg ? Number(arg.split("=")[1]) : (quota?.remaining ?? 0);

  const drafted = rows.filter((r) => r.draft_status && r.draft_status !== "pending");
  const tests = [];
  let added = 0;
  for (const r of drafted) {
    const isNew = !judged.has(r.question_id);
    if (isNew && added >= maxNew) continue;
    if (isNew) added++;
    const product = getProduct(r.product_id);
    if (!product) throw new Error(`${r.question_id}: unknown product_id ${r.product_id}`);
    const config = gradingConfig(product, r.question_text);
    tests.push({
      description: `${r.question_id} · ${r.product_id} ${product.title}`,
      vars: {
        question_id: r.question_id,
        product_id: r.product_id,
        product_title: product.title,
        question: r.question_text,
        reply: r.reply,
        draft_status: r.draft_status,
        product_page: renderProductPage(product),
        judge_attempt: attempts[r.question_id] ?? 1,
      },
      assert: [
        {
          type: "javascript",
          value: "file://checks.cjs:ingredientTruth",
          metric: "1_ingredient_truth",
          config,
        },
        {
          type: "javascript",
          value: "file://checks.cjs:replyRules",
          metric: "2_reply_rules",
          config,
        },
      ],
    });
  }

  writeFileSync(OUT, JSON.stringify(tests, null, 2));
  const waiting = drafted.length - tests.length;
  console.log(
    `Wrote ${OUT}: ${tests.length} replies to grade (${tests.length - added} already judged, ${added} new).` +
      (waiting ? ` ${waiting} drafted replies wait for tomorrow's free requests.` : "") +
      ` ${rows.length - drafted.length} questions not drafted yet.`,
  );
}

main();
