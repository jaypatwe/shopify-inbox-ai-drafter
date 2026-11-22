import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { cacheKey, readCache, writeCache } from "./cache";
import {
  annotateIngredients,
  detectIngredientTerms,
  facilityWarning,
  findIngredient,
  normalizeForMatch,
  renderProductPage,
} from "./page-context";
import type { AnnotatedIngredient } from "./types";
import { normalizeInci } from "./glossary";
import { getFreeQuota, invalidateQuota, QuotaExhaustedError } from "./quota";
import {
  PAGE_FIELDS,
  type AnswerItem,
  type Check,
  type DraftResult,
  type Evidence,
  type Product,
} from "./types";

// ---------------------------------------------------------------------------
// Models: free OpenRouter models only. The account has no credits and never will, so a paid
// model id is rejected rather than silently failing at request time.
// ---------------------------------------------------------------------------

export const MODEL_ID = process.env.OPENROUTER_MODEL || "baidu/ernie-5.5-flash-preview:free";

/** Tried in order by OpenRouter when the primary is down or rate-limited upstream. All free, all support structured output. */
const FALLBACK_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "inclusionai/ling-3.2-flash:free"];

if (!MODEL_ID.endsWith(":free")) {
  throw new Error(`OPENROUTER_MODEL must be a free model (ending in ":free"); got "${MODEL_ID}".`);
}

const HOLDING_LINE = "I'll check with the shop and get back to you";

function model(): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local.");
  return createOpenRouter({ apiKey })(MODEL_ID);
}

/**
 * Every model call goes through here. Responses are cached by (models, system prompt, prompt), so
 * a repeat draft costs no free requests, and fixes to the code after the model call apply to
 * cached drafts without spending any. Only a prompt change triggers new requests.
 */
async function callModel<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  usage: { requests: number };
  cachedOnly?: boolean;
}): Promise<z.infer<S>> {
  const key = cacheKey({ models: [MODEL_ID, ...FALLBACK_MODELS], system: opts.system, prompt: opts.prompt });
  const hit = readCache<{ output: z.infer<S> }>(key);
  if (hit && opts.schema.safeParse(hit.output).success) return hit.output;

  if (opts.cachedOnly) throw new NotCachedError();
  const quota = await getFreeQuota();
  if (quota && quota.remaining < 1) throw new QuotaExhaustedError(quota);

  const output = await withRetry(async () => {
    opts.usage.requests++;
    const result = await generateText({
      model: model(),
      temperature: 0,
      // One SDK retry only: every retry spends one of the day's free requests.
      maxRetries: 1,
      providerOptions: { openrouter: { models: [MODEL_ID, ...FALLBACK_MODELS] } },
      maxOutputTokens: opts.maxOutputTokens,
      output: Output.object({ schema: opts.schema }),
      system: opts.system,
      prompt: opts.prompt,
    });
    return result.output as z.infer<S>;
  });
  invalidateQuota();
  writeCache(key, { output });
  return output;
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
2. Split the shopper's message into separate questions, one item each. Keep closely related questions together as one item (e.g. "do you ship to Canada and how long does it take" is one item about shipping to Canada).
3. An answered item may only say what its quotes say (simple arithmetic on page prices and sizes is fine). Every answered item needs at least one evidence quote copied word for word from one page field. For ingredients, quote the ingredient as it appears in the raw ingredient_list.
4. Whenever you name an ingredient to the shopper, write it exactly as it appears in the "as you must write it" list, with the plain-English name in brackets, e.g. "Prunus Amygdalus Dulcis Oil (sweet almond oil)". Use the plain-English names to match the shopper's words to the list: a shopper asking about "almond" means Prunus Amygdalus Dulcis Oil.
5. Ingredient present: say the product contains it and name it. If other ingredients are made from that same thing (e.g. a coconut question and an ingredient tagged "may be coconut-derived"), mention those too. Do not mention ingredients unrelated to what the shopper asked about.
6. Ingredient absent: you may say it is not in the listed ingredients. If the shopper is asking because of an allergy or sensitivity, or asks for a free-from claim ("nut-free", "paraben-free", "vegan"), and the allergen_statement does not make that exact claim, mark the item needs_shop and put the ingredient-list fact in the answer.
7. Never say a product is safe, suitable or fine for an allergy, pregnancy, babies, children or a skin condition, or that it is free from something, unless the page says so in those words. No medical advice.
8. If the allergen_statement has a "Made in a facility that also handles ..." warning and the shopper has an allergy concern, include that warning in the relevant answer, quoting it.
9. "Parfum (Fragrance)" means the page does not list what the fragrance is made of. Questions about fragrance components are needs_shop, unless that component is listed separately in the ingredient list (then say it is listed).
10. Shipping, returns, refunds, stock, restock dates, discounts, bundles, refills, other sizes, certifications (cruelty-free, vegan, organic), pregnancy, infant use and how long a product lasts are not on product pages unless a field says so. State the page facts that help (e.g. "This page lists one size, 50 ml, at 22.00 USD") and mark the rest needs_shop.
11. If the shopper names a product, type or size that does not match this page, fill product_mismatch, and still answer for this page's product.
12. Name only the ingredients that matter to the question; never paste the whole ingredient list.
13. Tone: warm, short, plain words, addressed to the shopper as "you". No greeting or sign-off, and never say the shop will check or confirm: the app adds those lines.`;

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

/** Thrown in cached-only mode when a draft would need a new (quota-spending) model request. */
export class NotCachedError extends Error {
  constructor() {
    super("Not drafted yet, and cached-only mode doesn't spend free requests.");
    this.name = "NotCachedError";
  }
}

export async function draftReply(
  input: { product: Product; message: string; shopperName?: string },
  opts: { cachedOnly?: boolean } = {},
): Promise<DraftResult> {
  const started = Date.now();
  const { product } = input;
  const message = input.message.trim();
  const page = renderProductPage(product);
  const ingredients = annotateIngredients(product);
  const checks: Check[] = [];
  const usage = { requests: 0 };

  const draft = await callModel({
    schema: draftSchema,
    system: DRAFT_SYSTEM,
    prompt: `PRODUCT PAGE\n${page}\n\nSHOPPER MESSAGE\n${message}`,
    maxOutputTokens: 4000,
    usage,
    cachedOnly: opts.cachedOnly,
  });

  // --- Step 2a: every quote must actually be on the page -----------------------------------
  const haystacks: Record<string, string> = {};
  for (const f of PAGE_FIELDS) haystacks[f] = normalizeForMatch(product[f] ?? "");
  haystacks.ingredient_list += " | " + normalizeForMatch(ingredients.map((i) => i.display).join(", "));
  haystacks.price += " | " + normalizeForMatch(`${product.price} USD $${product.price}`);

  let quotesTotal = 0;
  let quotesOk = 0;
  const items: AnswerItem[] = draft.items.map((it) => {
    const evidence: Evidence[] = it.evidence.map((e) => {
      const q = normalizeForMatch(e.quote);
      const verified = q.length > 0 && haystacks[e.field].includes(q);
      quotesTotal++;
      if (verified) quotesOk++;
      return { ...e, verified };
    });
    const item: AnswerItem = {
      question: it.question,
      status: it.status,
      // Weaker models sometimes echo the status label or the app's [tag] annotations into the text.
      answer: it.answer
        .replace(/\s*\b(needs_shop|answered)\b\.?/gi, "")
        .replace(/\s*\[[^\]]*\]/g, "")
        .trim(),
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

  // Code-detected ingredient words the model didn't report. Free models skip ingredient_checks
  // sometimes, so the dictionary answer is enforced here without relying on the model.
  const answerText = () => items.map((i) => i.answer).join(" ");
  const presentByCode: AnnotatedIngredient[][] = [];
  for (const term of detectIngredientTerms(message)) {
    const { direct, related } = findIngredient(product, term);
    const covered = ingredientClaims.some((c) => {
      const t = c.term.toLowerCase();
      return t.includes(term) || term.includes(t) || c.matched.some((m) => direct.some((d) => d.display === m));
    });
    if (covered) continue;
    const onList = direct.length > 0;
    ingredientClaims.push({ term, onList, matched: [...direct, ...related].map((d) => d.display), byCode: true });
    // Quoted facility warnings ("...also handles tree nuts") aren't ingredient claims.
    const sentences = answerText()
      .split(/(?<=[.!?])\s+/)
      .filter((x) => x.toLowerCase().includes(term) && !/facility|handles/i.test(x));
    const negated = sentences.some((x) => /\b(no|not|isn't|doesn't|does not|without|free)\b/i.test(x));
    if (onList && negated) {
      failClosed = `The draft seems to deny "${term}", but the dictionary found ${direct.map((d) => d.display).join(", ")}.`;
    } else if (!onList && sentences.length && !negated) {
      failClosed = `The draft mentions "${term}" as if present, but it is not on this page's ingredient list.`;
    } else if (onList) {
      presentByCode.push(direct);
    }
  }

  if (ingredientClaims.length) {
    checks.push({
      label: "Ingredient answers match the ingredient dictionary",
      ok: !failClosed,
      detail:
        failClosed ??
        ingredientClaims
          .map((c) => `${c.term}: ${c.onList ? "on the list" : "not on the list"}${c.byCode ? " (found by code)" : ""}`)
          .join("; "),
    });
  }

  // --- Step 2c: Latin names in answers get their plain-English bracket ------------------------
  let bracketsAdded = 0;
  // Product names can contain ingredient names ("Jojoba Squalane Face Serum"): shield them first.
  const TITLE_MARK = "\u0000TITLE\u0000";
  for (const item of items) {
    item.answer = item.answer.split(product.title).join(TITLE_MARK);
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
    item.answer = item.answer.split(TITLE_MARK).join(product.title);
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

  // --- Step 3: second-pass audit -------------------------------------------------------------
  // The review costs a second free request, so it's spent where a wrong answer can hurt someone:
  // allergy/sensitivity questions and ingredient questions. Low-stakes drafts (usage, size,
  // price) rely on the quote check, and lose any partial text on items sent to the shop.
  const highStakes = draft.allergy_or_sensitivity_concern || ingredientClaims.length > 0;
  if (!highStakes) {
    for (const it of items) if (it.status === "needs_shop") it.answer = "";
  }
  const toAudit = items.map((it, index) => ({ index, it })).filter(({ it }) => it.answer);
  if (toAudit.length && !failClosed && !highStakes) {
    checks.push({
      label: "Second-pass review skipped (not an allergy or ingredient question)",
      ok: true,
      detail: "Saves a free request. Answers are still backed by verified quotes.",
    });
  }
  if (toAudit.length && !failClosed && highStakes) {
    const audit = await callModel({
      schema: auditSchema,
      system: AUDIT_SYSTEM,
      prompt: `PRODUCT PAGE\n${page}\n\nANSWERS\n${toAudit.map(({ index, it }) => `[${index}] Q: ${it.question}\nA: ${it.answer}`).join("\n\n")}`,
      maxOutputTokens: 2000,
      usage,
      cachedOnly: opts.cachedOnly,
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

  // An ingredient the shopper asked about that is on the list must be named in the reply. If the
  // model's answer (after review) doesn't name it, add the dictionary fact.
  const factLines: string[] = [];
  for (const direct of presentByCode) {
    const t = answerText().toLowerCase();
    const named = direct.some(
      (d) =>
        t.includes(normalizeInci(d.inci)) ||
        t.includes(d.inci.toLowerCase()) ||
        (d.plain !== null && t.includes(d.plain.split(",")[0].toLowerCase())),
    );
    if (!named) factLines.push(`The ingredient list includes ${joinList(direct.map((d) => d.display))}.`);
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
      // Fixed wording: free models often return a whole sentence here instead of a short phrase.
      parts.push(`Just to be clear, these details are for our ${product.title}. If you meant a different product, let me know.`);
    }
    for (const i of items) if (i.answer) parts.push(i.answer);
    parts.push(...factLines);
    if (facilityNote) parts.push(facilityNote);
    // Fixed wording rather than a model-written summary of what's pending: the merchant already
    // sees which question is pending in the draft panel.
    const pending = items.filter((i) => i.status === "needs_shop").length;
    const answeredCount = items.length - pending;
    if (pending || items.length === 0) {
      parts.push(answeredCount && pending ? `For the rest of your question, ${HOLDING_LINE}.` : `${HOLDING_LINE}.`);
    }
    parts.push("Thanks!");
    reply = parts.join("\n\n");
  }
  if (draft.product_mismatch) {
    checks.push({ label: "Product mismatch flagged", ok: true, detail: draft.product_mismatch });
  }

  if (factLines.length && !failClosed) {
    checks.push({ label: "Ingredient fact added from the dictionary", ok: true, detail: factLines.join(" ") });
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
    requestsUsed: usage.requests,
    cached: usage.requests === 0,
  };
}

/**
 * The SDK already retries network/API errors. This also retries when a (free) model returns
 * nothing or malformed JSON, which shows up as NoOutputGeneratedError / NoObjectGeneratedError.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const name = e instanceof Error ? e.name : "";
      if (!/NoOutputGenerated|NoObjectGenerated|TypeValidation|JSONParse/i.test(name)) throw e;
    }
  }
  throw last;
}

function joinList(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}


