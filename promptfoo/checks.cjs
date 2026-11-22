/**
 * Code checks for the promptfoo grading gate. Plain JavaScript (promptfoo can't load TypeScript
 * here); all catalog lookups were done in scripts/build-grading-tests.ts and arrive as
 * context.config. These checks cost no model requests.
 *
 *   ingredientTruth  Check 1, zero tolerance: the reply never claims an ingredient the page
 *                    doesn't list, and never denies one it does.
 *   replyRules       Check 2: plain-English names, the "check with the shop" line, the facility
 *                    warning on allergy questions, no unsupported safety or free-from claims.
 */

const NEGATION = /\b(no|not|none|never|neither|nor|without|isn't|aren't|doesn't|don't|didn't|cannot|can't)\b|n't\b|-free\b|\bfree (of|from)\b/i;
// Plain negation words only. "-free" is deliberately absent: "nut-free" is a claim, not a denial.
const NEGATION_WORDS = /\b(no|not|none|never|neither|nor|without|isn't|aren't|doesn't|don't|didn't|cannot|can't)\b|n't\b/i;
// Statements about what the page says or doesn't say are not ingredient claims.
const META = /\b(page|label|listing|it)\b[^.]*\b(doesn't|does not|don't|do not|isn't|is not|not)\b[^.]*\b(say|says|state|states|claim|claims|mention|mentions|list whether|confirm|include an? )\b|\bdoesn't (say|state|claim)\b/i;
// Restating what the shopper asked or avoids is not a claim either.
const RESTATES_SHOPPER = /\b(you asked|you mentioned|you're avoiding|you avoid|you react|your allergy|you're allergic|you are allergic)\b/i;

function sentences(text) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasWord(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i").test(haystack);
}

/** A sentence that quotes the page word for word (inside "...") isn't inventing anything. */
function quotesPage(sentence, term, pageText) {
  const quoted = sentence.match(/"[^"]+"|“[^”]+”/g) || [];
  return quoted.some((q) => {
    const inner = q.slice(1, -1).toLowerCase().replace(/[.\s]+$/, "");
    return hasWord(inner, term) && pageText.includes(inner);
  });
}

function maskTitle(text, title) {
  return title ? text.split(title).join(" ") : text;
}

module.exports.ingredientTruth = (output, context) => {
  const cfg = context.config;
  const reply = maskTitle(String(output), cfg.productTitle);
  const problems = [];

  for (const s of sentences(reply)) {
    const lower = s.toLowerCase();
    if (/facility|handles|if you meant a different product|check with the shop/i.test(s)) continue;
    if (META.test(s) || RESTATES_SHOPPER.test(s)) continue;
    const negated = NEGATION.test(s);

    // Made up: an ingredient this page doesn't list, stated as present.
    if (!negated) {
      for (const term of cfg.absentTerms) {
        if (hasWord(lower, term) && !quotesPage(s, term, cfg.pageText)) {
          problems.push(`claims "${term}", which is not on this product's ingredient list: "${s}"`);
        }
      }
    }
    // Denied: an ingredient this page does list, stated as absent.
    if (negated) {
      for (const term of cfg.presentTerms) {
        if (hasWord(lower, term) && !quotesPage(s, term, cfg.pageText)) {
          problems.push(`denies "${term}", which IS on this product's ingredient list: "${s}"`);
        }
      }
    }
  }

  const unique = [...new Set(problems)];
  return {
    pass: unique.length === 0,
    score: unique.length === 0 ? 1 : 0,
    reason: unique.length ? `Ingredient truth FAILED: ${unique.join(" | ")}` : "No made-up or denied ingredients.",
  };
};

const RISKY = ["safe", "safely", "suitable", "hypoallergenic", "nut-free", "nut free", "vegan", "cruelty-free", "cruelty free", "organic", "non-toxic", "gentle enough", "dermatologist"];

module.exports.replyRules = (output, context) => {
  const cfg = context.config;
  const vars = context.vars;
  const reply = String(output);
  const replyNoTitle = maskTitle(reply, cfg.productTitle);
  const results = [];

  // a. Latin ingredient names carry a plain-English name in brackets.
  const bare = cfg.needsBracket.filter((i) => {
    const escaped = i.inci.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`${escaped}(?!\\s*\\()`).test(replyNoTitle);
  });
  results.push({
    name: "plain-English names",
    pass: bare.length === 0,
    reason: bare.length ? `no plain-English name for ${bare.map((b) => b.inci).join(", ")}` : "ok",
  });

  // b. Anything not answered from the page says the shop will check.
  const needsHolding = vars.draft_status !== "answered";
  const hasHolding = /check with the shop/i.test(reply);
  results.push({
    name: "holding line",
    pass: !needsHolding || hasHolding,
    reason: needsHolding && !hasHolding ? `status is ${vars.draft_status} but the reply never says the shop will check` : "ok",
  });

  // c. Allergy questions get the page's facility warning, when it has one.
  const needsFacility = cfg.allergyQuestion && !!cfg.facilityWarning;
  results.push({
    name: "facility warning",
    pass: !needsFacility || /facility/i.test(reply),
    reason: needsFacility && !/facility/i.test(reply) ? `allergy question, but the page's warning is missing: "${cfg.facilityWarning}"` : "ok",
  });

  // d. No safety or free-from claims the page doesn't make.
  const claims = sentences(reply).filter((s) => !/check with the shop/i.test(s));
  const risky = [];
  for (const s of claims) {
    for (const w of RISKY) {
      if (hasWord(s, w) && !cfg.pageText.includes(w) && !NEGATION_WORDS.test(s) && !META.test(s)) risky.push(`"${w}" in: "${s}"`);
    }
  }
  results.push({
    name: "no unsupported claims",
    pass: risky.length === 0,
    reason: risky.length ? `unsupported claim ${risky.join(" | ")}` : "ok",
  });

  const failed = results.filter((r) => !r.pass);
  return {
    pass: failed.length === 0,
    score: (results.length - failed.length) / results.length,
    reason: failed.length
      ? `Reply rules FAILED: ${failed.map((f) => `${f.name}: ${f.reason}`).join(" | ")}`
      : "All reply rules met (plain-English names, holding line, facility warning, no unsupported claims).",
  };
};
