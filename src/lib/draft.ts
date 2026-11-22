import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  annotateIngredients,
  facilityWarning,
  findIngredient,
  normalizeForMatch,
  renderProductPage,
} from "./page-context";
import { normalizeInci } from "./glossary";
import {
  PAGE_FIELDS,
  type AnswerItem,
  type Check,
  type DraftResult,
  type Evidence,
  type Product,
} from "./types";

export const MODEL_ID = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5.5";

const HOLDING_LINE = "I'll check with the shop and get back to you";

function model() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local.");
  return createOpenRouter({ apiKey })(MODEL_ID);
}

// ---------------------------------------------------------------------------
// Step 1: draft. The model splits the message into questions and answers each one with quotes.
// ---------------------------------------------------------------------------

const draftSchema = z.object({
  allergy_or_sensitivity_concern: z
    .boolean()
    .describe("True if the shopper mentions an allergy, reaction, sensitivity, or avoiding something for health reasons, for themselves or someone else."),
  product_mismatch: z
    .string()
    .nullable()
    .describe("If the shopper names a product, product type or size that does not match this page (e.g. asks about 'the body butter' on a lip balm page, or a '30ml bottle' when the page size is 50 g), the words that complete 'you mentioned ___', e.g. 'the body butter', 'a 30ml bottle'. Otherwise null."),
  items: z
    .array(
      z.object({
        question: z.string().describe("The shopper's question, restated briefly."),
        topic: z
          .string()
          .describe("2-8 words that complete the sentence 'I'll check with the shop about ___', e.g. 'shipping to Canada', 'use during pregnancy', 'whether it's suitable for a nut allergy'."),
        status: z.enum(["answered", "needs_shop"]),
        answer: z
          .string()
          .describe("1-3 sentences to the shopper. For needs_shop: only the page facts that partly help, or an empty string. Never say the shop will check or confirm; that line is added automatically."),
        evidence: z
          .array(
            z.object({
              field: z.enum(PAGE_FIELDS),
              quote: z.string().describe("Exact text copied from that field. Must be a substring of the field."),
            }),
          )
          .describe("Quotes that support the answer. Required for answered items."),
      }),
    )
    .describe("One item per separate question in the message."),
  ingredient_checks: z
    .array(
      z.object({
        term: z.string().describe("The ingredient or ingredient family the shopper asked about, in their words, e.g. 'almond', 'vitamin E'."),
        on_list: z.boolean().describe("True if an ingredient that IS this thing appears on the ingredient list."),
        matched_ingredients: z
          .array(z.string())
          .describe("The matching ingredients exactly as written in the raw ingredient list, including ones made from it."),
      }),
    )
    .describe("One entry per ingredient the shopper asks about. Empty if none."),
});

const DRAFT_SYSTEM = `You draft replies for a skincare shop's chat inbox. A merchant reviews every draft before it is sent. Shoppers make purchase and allergy decisions from these replies, so a wrong answer is far worse than saying the shop will check.

RULES
1. Use only the PRODUCT PAGE given to you. Do not use general knowledge about ingredients, cosmetics, the brand, shipping, returns or policies. If the page does not state it, the item is needs_shop.
2. Split the shopper's message into separate questions, one item each.
3. An answered item may only say what its quotes say (simple arithmetic on page prices and sizes is fine). Every answered item needs at least one evidence quote copied word for word from one page field. For ingredients, quote the ingredient as it appears in the raw ingredient_list.
4. Whenever you name an ingredient to the shopper, write it exactly as it appears in the "as you must write it" list, with the plain-English name in brackets, e.g. "Prunus Amygdalus Dulcis Oil (sweet almond oil)". Use the plain-English names to match the shopper's words to the list: a shopper asking about "almond" means Prunus Amygdalus Dulcis Oil.
5. Ingredient present: say the product contains it and name it. If other ingredients are made from it (tagged e.g. "coconut-derived"), mention those too.
6. Ingredient absent: you may say it is not in the listed ingredients. If the shopper is asking because of an allergy or sensitivity, or asks for a free-from claim ("nut-free", "paraben-free", "vegan"), and the allergen_statement does not make that exact claim, mark the item needs_shop and put the ingredient-list fact in the answer.
7. Never say a product is safe, suitable or fine for an allergy, pregnancy, babies, children or a skin condition, or that it is free from something, unless the page says so in those words. No medical advice.
8. If the allergen_statement has a "Made in a facility that also handles ..." warning and the shopper has an allergy concern, include that warning in the relevant answer, quoting it.
9. "Parfum (Fragrance)" means the page does not list what the fragrance is made of. Questions about fragrance components are needs_shop, unless that component is listed separately in the ingredient list (then say it is listed).
10. Shipping, returns, refunds, stock, restock dates, discounts, bundles, refills, other sizes, certifications (cruelty-free, vegan, organic), pregnancy, infant use and how long a product lasts are not on product pages unless a field says so. State the page facts that help (e.g. "This page lists one size, 50 ml, at 22.00 USD") and mark the rest needs_shop.
11. If the shopper names a product, type or size that does not match this page, fill product_mismatch, and still answer for this page's product.
12. Tone: warm, short, plain words, addressed to the shopper as "you". No greeting or sign-off, and never say the shop will check or confirm: the app adds those lines.`;

// ---------------------------------------------------------------------------
// Step 3: audit. A second model call checks every answer against the page.
// ---------------------------------------------------------------------------

const auditSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      supported: z.boolean(),
      problem: z.string().describe("Empty if supported. Otherwise the specific unsupported statement."),
    }),
  ),
});

const AUDIT_SYSTEM = `You audit draft answers for a skincare shop before a shopper sees them. You are given the product page and numbered answers.
An answer is supported only if every factual statement in it is stated on the page, or is simple arithmetic on page prices and sizes.
Mark supported = false if an answer:
- states anything not on the page (general ingredient knowledge, policies, shipping, stock, certifications)
- calls the product safe, suitable, gentle enough, or free from something without the page saying so
- gets an ingredient's presence or absence wrong
- names an ingredient differently from the page's ingredient list
Saying the page doesn't list something, or that the shop will check, is supported.`;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function draftReply(input: {
  product: Product;
  message: string;
  shopperName?: string;
}): Promise<DraftResult> {
  const started = Date.now();
  const { product, message } = input;
  const page = renderProductPage(product);
  const ingredients = annotateIngredients(product);
  const checks: Check[] = [];

  const { output: draft } = await generateText({
    model: model(),
    temperature: 0,
    maxOutputTokens: 1500,
    output: Output.object({ schema: draftSchema }),
    system: DRAFT_SYSTEM,
    prompt: `PRODUCT PAGE\n${page}\n\nSHOPPER MESSAGE\n${message}`,
  });

  // --- Step 2a: every quote must actually be on the page -----------------------------------
  const haystacks: Record<string, string> = {};
  for (const f of PAGE_FIELDS) haystacks[f] = normalizeForMatch(product[f] ?? "");
  haystacks.ingredient_list += " | " + normalizeForMatch(ingredients.map((i) => i.display).join(", "));
  haystacks.price += " | " + normalizeForMatch(`${product.price} USD $${product.price}`);

  let quotesTotal = 0;
  let quotesOk = 0;
  const items: (AnswerItem & { topic: string })[] = draft.items.map((it) => {
    const evidence: Evidence[] = it.evidence.map((e) => {
      const q = normalizeForMatch(e.quote);
      const verified = q.length > 0 && haystacks[e.field].includes(q);
      quotesTotal++;
      if (verified) quotesOk++;
      return { ...e, verified };
    });
    const item: AnswerItem & { topic: string } = {
      question: it.question,
      topic: it.topic,
      status: it.status,
      answer: it.answer.trim(),
      evidence,
    };
    if (item.status === "answered" && !evidence.some((e) => e.verified)) {
      item.status = "needs_shop";
      item.answer = "";
      item.downgradeReason = "No quote from the product page backed this answer.";
    }
    return item;
  });
  checks.push({
    label: "Every quote was found on the product page",
    ok: quotesOk === quotesTotal,
    detail: `${quotesOk} of ${quotesTotal} quotes verified`,
  });

  // --- Step 2b: ingredient yes/no claims must agree with the dictionary lookup ---------------
  let failClosed = null as string | null;
  const onListNorm = new Set(ingredients.map((i) => normalizeInci(i.inci)));
  const ingredientClaims: DraftResult["ingredientClaims"] = [];
  for (const c of draft.ingredient_checks) {
    const { direct, related } = findIngredient(product, c.term);
    const invented = c.matched_ingredients.filter((m) => !onListNorm.has(normalizeInci(m)));
    if (!c.on_list && direct.length > 0) {
      failClosed = `The draft said "${c.term}" is not on the list, but the dictionary found ${direct.map((d) => d.display).join(", ")}.`;
    } else if (invented.length > 0) {
      failClosed = `The draft named ingredients that are not on this page: ${invented.join(", ")}.`;
    } else if (c.on_list && direct.length === 0 && related.length === 0 && c.matched_ingredients.length === 0) {
      failClosed = `The draft said "${c.term}" is on the list, but no matching ingredient was found.`;
    }
    ingredientClaims.push({ term: c.term, onList: c.on_list, matched: [...direct, ...related].map((d) => d.display) });
  }
  if (ingredientClaims.length) {
    checks.push({
      label: "Ingredient answers match the ingredient dictionary",
      ok: !failClosed,
      detail: failClosed ?? ingredientClaims.map((c) => `${c.term}: ${c.onList ? "on the list" : "not on the list"}`).join("; "),
    });
  }

  // --- Step 2c: Latin names in answers get their plain-English bracket ------------------------
  let bracketsAdded = 0;
  for (const item of items) {
    for (const ing of ingredients) {
      if (!ing.plain) continue;
      // The label as written (if it needs a bracket), plus the label with its own bracket dropped
      // ("Butyrospermum Parkii Butter"), which models sometimes write.
      const variants = new Set<string>();
      if (ing.display !== ing.inci) variants.add(ing.inci);
      const stripped = ing.inci.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      if (stripped !== ing.inci) variants.add(stripped);
      for (const v of variants) {
        // Case-sensitive on purpose: catches label-style names, leaves "contains glycerin" alone.
        const re = new RegExp(`${escapeRegex(v)}(?!\\s*\\()`, "g");
        item.answer = item.answer.replace(re, () => {
          bracketsAdded++;
          return ing.display;
        });
      }
    }
  }
  const unbracketed = items.flatMap((item) =>
    ingredients.filter((ing) => !ing.plain && item.answer.toLowerCase().includes(ing.inci.toLowerCase())),
  );
  checks.push({
    label: "Ingredient names include a plain-English name",
    ok: unbracketed.length === 0,
    detail: unbracketed.length
      ? `No dictionary entry for: ${unbracketed.map((u) => u.inci).join(", ")}`
      : bracketsAdded
        ? `${bracketsAdded} plain-English name(s) added`
        : "OK",
  });

  // --- Step 3: second-pass audit of everything the shopper will read -------------------------
  const toAudit = items.map((it, index) => ({ index, it })).filter(({ it }) => it.answer);
  if (toAudit.length && !failClosed) {
    const { output: audit } = await generateText({
      model: model(),
      temperature: 0,
      maxOutputTokens: 600,
      output: Output.object({ schema: auditSchema }),
      system: AUDIT_SYSTEM,
      prompt: `PRODUCT PAGE\n${page}\n\nANSWERS\n${toAudit.map(({ index, it }) => `[${index}] Q: ${it.question}\nA: ${it.answer}`).join("\n\n")}`,
    });
    const problems: string[] = [];
    for (const r of audit.results) {
      const item = items[r.index];
      if (!item || r.supported) continue;
      problems.push(r.problem);
      item.downgradeReason = `Second-pass review: ${r.problem}`;
      item.status = "needs_shop";
      item.answer = "";
    }
    checks.push({
      label: "Second-pass review found every answer supported by the page",
      ok: problems.length === 0,
      detail: problems.length ? `${problems.length} answer(s) held back: ${problems.join(" | ")}` : `${toAudit.length} answer(s) reviewed`,
    });
  }

  // --- Step 4: facility warning and mismatch notes -------------------------------------------
  const facility = facilityWarning(product);
  const allergyConcern = draft.allergy_or_sensitivity_concern;
  let facilityNote: string | null = null;
  if (facility && allergyConcern) {
    const mentioned = items.some((i) => /facility/i.test(i.answer));
    if (!mentioned) facilityNote = `Please also note that the product page says: "${facility}"`;
    checks.push({
      label: "Facility allergen warning included",
      ok: true,
      detail: mentioned ? "Included in the answer" : "Added to the reply",
    });
  }

  // --- Step 5: assemble -------------------------------------------------------------------
  const name = input.shopperName?.trim();
  const greeting = name ? `Hi ${name}, thanks for reaching out!` : "Hi, thanks for reaching out!";
  let reply: string;
  let finalItems: AnswerItem[] = items;
  if (failClosed) {
    finalItems = items.map((i) => ({
      ...i,
      status: "needs_shop" as const,
      answer: "",
      downgradeReason: "Held: the ingredient check failed.",
    }));
    reply = `${greeting}\n\nI want to be completely sure I get this right, so I'll check with the shop and get back to you shortly.\n\nThanks!`;
  } else {
    const parts: string[] = [greeting];
    if (draft.product_mismatch) {
      parts.push(
        `Just to be clear: you mentioned ${draft.product_mismatch.replace(/\.$/, "")}, but these details are for our ${product.title}. If you meant a different product, let me know.`,
      );
    }
    for (const i of items) if (i.answer) parts.push(i.answer);
    if (facilityNote) parts.push(facilityNote);
    const pending = items.filter((i) => i.status === "needs_shop").map((i) => i.topic);
    if (pending.length || items.length === 0) {
      parts.push(
        pending.length ? `I'll check with the shop about ${joinList(pending)} and get back to you.` : `${HOLDING_LINE}.`,
      );
    }
    parts.push("Thanks!");
    reply = parts.join("\n\n");
  }
  if (draft.product_mismatch) {
    checks.push({ label: "Product mismatch flagged", ok: true, detail: draft.product_mismatch });
  }

  const answered = finalItems.filter((i) => i.status === "answered").length;
  const overall = answered === 0 ? "needs_shop" : answered === finalItems.length ? "answered" : "partial";

  return {
    productId: product.product_id,
    productTitle: product.title,
    reply,
    overall,
    items: finalItems,
    ingredientClaims,
    facilityWarning: facility,
    allergyConcern,
    productMismatch: draft.product_mismatch,
    checks,
    model: MODEL_ID,
    ms: Date.now() - started,
  };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function joinList(xs: string[]) {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
