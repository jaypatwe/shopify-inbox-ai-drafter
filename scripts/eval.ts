/**
 * Runs every shopper question in data/questions.csv through the same pipeline the app uses
 * and scores the drafts against the product catalog.
 *
 *   npm run eval              # all 120 questions
 *   npm run eval Q-001 Q-024  # just these
 *
 * Writes eval/results.json (every draft) and eval/report.md (summary).
 * The CSV's expected_answer_note column is NOT used as ground truth: many notes describe a
 * different product than the product_id they're attached to. Ground truth is the catalog itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getProduct, getQuestions } from "../src/lib/catalog";
import { draftReply, MODEL_ID } from "../src/lib/draft";
import { annotateIngredients, facilityWarning, findIngredient } from "../src/lib/page-context";
import type { DraftResult, ShopperQuestion } from "../src/lib/types";

process.loadEnvFile(".env.local");

const only = new Set(process.argv.slice(2));
const questions = getQuestions().filter((q) => !only.size || only.has(q.question_id));
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 6);

type Row = {
  q: ShopperQuestion;
  draft?: DraftResult;
  error?: string;
  findings: string[];
  labelNote?: string;
};

// Claim words in the CSV note, so we can tell whether the note's claim matches the catalog.
function noteClaimsPresent(note: string): boolean | null {
  const n = note.toLowerCase();
  if (/(neither includes|silent|no .* entr|has no|shows no|cannot confirm|not in ingredient_list|absent)/.test(n)) return false;
  if (/(includes|is present|contains|has |shows |confirmed|lists)/.test(n)) return true;
  return null;
}

function score(q: ShopperQuestion, d: DraftResult): { findings: string[]; labelNote?: string } {
  const product = getProduct(q.product_id)!;
  const findings: string[] = [];
  const reply = d.reply;

  // 1. Ingredient claims vs deterministic lookup
  if (q.ingredient_mentioned) {
    const { direct } = findIngredient(product, q.ingredient_mentioned);
    const truth = direct.length > 0;
    const m = q.ingredient_mentioned.toLowerCase();
    const claim =
      d.ingredientClaims.find((c) => {
        const t = c.term.toLowerCase();
        return t.includes(m.split(" ")[0]) || m.includes(t);
      }) ?? d.ingredientClaims[0];
    if (!d.ingredientClaims.length && d.overall !== "needs_shop") findings.push(`No ingredient check recorded for "${q.ingredient_mentioned}".`);
    if (claim && claim.onList !== truth && d.overall !== "needs_shop")
      findings.push(`CRITICAL: said "${q.ingredient_mentioned}" ${claim.onList ? "is" : "is not"} listed; catalog says ${truth ? "it is" : "it isn't"}.`);
    if (truth && d.overall !== "needs_shop" && !direct.some((i) => reply.includes(i.inci)))
      findings.push(`Reply doesn't name the matching ingredient (${direct.map((i) => i.inci).join(", ")}).`);

    const noteClaim = noteClaimsPresent(q.expected_answer_note);
    if (noteClaim !== null && noteClaim !== truth && q.ingredient_mentioned !== "fragrance") {
      return {
        findings: checkRest(),
        labelNote: `CSV note says "${q.ingredient_mentioned}" is ${noteClaim ? "present" : "not confirmed"}; ${product.title} (${product.product_id}) ingredient list says ${truth ? "present" : "absent"}.`,
      };
    }
  }
  return { findings: checkRest() };

  function checkRest(): string[] {
    // 2. Every quote verified
    const bad = d.items.flatMap((i) => i.evidence.filter((e) => !e.verified));
    if (bad.length) findings.push(`${bad.length} quote(s) not found on the page (item downgraded).`);

    // 3. Plain-English brackets
    for (const ing of annotateIngredients(product)) {
      if (ing.display === ing.inci) continue;
      const re = new RegExp(`${ing.inci.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?!\\s*\\()`);
      if (re.test(reply)) findings.push(`"${ing.inci}" appears without a plain-English name.`);
    }

    // 4. Facility warning for allergy questions
    const fw = facilityWarning(product);
    if (fw && d.allergyConcern && d.overall !== "needs_shop" && !/facility/i.test(reply))
      findings.push("Allergy question on a facility-warning product, but the warning is missing.");

    // 5. Holding line whenever something is unanswered
    if (d.items.some((i) => i.status === "needs_shop") && !/check with the shop/i.test(reply))
      findings.push("Unanswered item but no 'check with the shop' line.");

    // 6. Risky wording the page doesn't back
    const pageText = Object.values(product).join(" ").toLowerCase();
    // The holding line names topics ("whether it's suitable for…"); it isn't a claim, so skip it.
    const claims = reply.split("\n\n").filter((p) => !/check with the shop/i.test(p)).join("\n\n");
    for (const w of ["safe", "nut-free", "nut free", "vegan", "cruelty", "suitable", "hypoallergenic"]) {
      if (new RegExp(`\\b${w}\\b`, "i").test(claims) && !pageText.includes(w) && !new RegExp(`(not|can't|cannot|don't|doesn't)[^.]{0,40}${w}`, "i").test(claims))
        findings.push(`Review wording: reply uses "${w}", which the page doesn't say.`);
    }
    return findings;
  }
}

async function run() {
  console.log(`Evaluating ${questions.length} questions with ${MODEL_ID}…`);
  const rows: Row[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < questions.length) {
      const q = questions[next++];
      const product = getProduct(q.product_id);
      const row: Row = { q, findings: [] };
      try {
        if (!product) throw new Error(`Unknown product ${q.product_id}`);
        row.draft = await draftReply({ product, message: q.question_text, shopperName: q.shopper_first_name });
        Object.assign(row, score(q, row.draft));
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
      }
      rows.push(row);
      done++;
      process.stdout.write(`\r  ${done}/${questions.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log();
  rows.sort((a, b) => a.q.question_id.localeCompare(b.q.question_id));

  const ok = rows.filter((r) => r.draft);
  const by = (s: string) => ok.filter((r) => r.draft!.overall === s).length;
  const critical = ok.filter((r) => r.findings.some((f) => f.startsWith("CRITICAL")));
  const flagged = ok.filter((r) => r.findings.length);
  const quotes = ok.flatMap((r) => r.draft!.items.flatMap((i) => i.evidence));
  const labelIssues = rows.filter((r) => r.labelNote);
  const heldByChecks = ok.filter((r) => r.draft!.checks.some((c) => !c.ok));
  const avgMs = Math.round(ok.reduce((s, r) => s + r.draft!.ms, 0) / Math.max(ok.length, 1));

  const md: string[] = [
    `# Reply helper evaluation`,
    ``,
    `Model: \`${MODEL_ID}\` · ${new Date().toISOString()} · ${rows.length} questions · avg ${avgMs} ms per draft`,
    ``,
    `| Metric | Result |`,
    `|---|---|`,
    `| Drafts produced | ${ok.length} / ${rows.length}${rows.length - ok.length ? ` (${rows.length - ok.length} errors)` : ""} |`,
    `| Fully answered from page | ${by("answered")} |`,
    `| Partly answered, rest sent to shop | ${by("partial")} |`,
    `| Sent to shop ("I'll check with the shop") | ${by("needs_shop")} |`,
    `| Critical ingredient errors (said present/absent wrongly) | **${critical.length}** |`,
    `| Quotes verified on the page | ${quotes.filter((q) => q.verified).length} / ${quotes.length} |`,
    `| Drafts where a safety check held something back | ${heldByChecks.length} |`,
    `| Drafts with findings to review | ${flagged.length} |`,
    `| CSV expected-answer notes that contradict the catalog | ${labelIssues.length} |`,
    ``,
  ];
  if (critical.length || flagged.length) {
    md.push(`## Findings`, ``);
    for (const r of flagged) md.push(`- **${r.q.question_id}** (${r.q.product_id}): ${r.findings.join(" ")}`);
    md.push(``);
  }
  if (rows.some((r) => r.error)) {
    md.push(`## Errors`, ``);
    for (const r of rows.filter((r) => r.error)) md.push(`- **${r.q.question_id}**: ${r.error}`);
    md.push(``);
  }
  if (labelIssues.length) {
    md.push(`## CSV notes that contradict the catalog`, ``, `The catalog is treated as the truth; these notes should be fixed in the source data.`, ``);
    for (const r of labelIssues) md.push(`- **${r.q.question_id}**: ${r.labelNote}`);
    md.push(``);
  }
  md.push(`## Every draft`, ``);
  for (const r of rows) {
    md.push(`### ${r.q.question_id} · ${r.q.product_id} ${getProduct(r.q.product_id)?.title ?? ""} · ${r.draft?.overall ?? "error"}`, ``);
    md.push(
      `product_id: \`${r.q.product_id}\` · category: ${r.q.question_category} · answerable_from_page (CSV): ${r.q.answerable_from_page}`,
      ``,
    );
    md.push(`> **${r.q.shopper_first_name}:** ${r.q.question_text}`, ``);
    md.push(r.draft ? r.draft.reply : `Error: ${r.error}`, ``);
  }

  mkdirSync("eval", { recursive: true });
  writeFileSync("eval/results.json", JSON.stringify(rows, null, 2));
  writeFileSync("eval/report.md", md.join("\n"));
  console.log(md.slice(0, 16).join("\n"));
  if (critical.length) {
    console.log("\nCRITICAL:");
    for (const r of critical) console.log(`  ${r.q.question_id}: ${r.findings.filter((f) => f.startsWith("CRITICAL")).join(" ")}`);
  }
  console.log(`\nFull report: eval/report.md`);
}

run();
