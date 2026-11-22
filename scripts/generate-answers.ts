/**
 * Drafts a reply for every shopper question and writes data/answer.csv, the input to the
 * promptfoo grading gate (npm run grade).
 *
 *   npm run answers                 # draft as many as today's free quota allows
 *   npm run answers -- --cached-only  # rebuild the CSV from saved drafts, spending nothing
 *
 * Free models only: each draft costs 1-2 of the day's 50 free requests, so a full pass takes
 * several days. Every model response is cached in .cache/drafts, so each run re-uses finished
 * drafts at no cost and continues where the last one stopped. Questions not drafted yet are
 * written with draft_status "pending" and an empty reply.
 */
import { writeFileSync } from "node:fs";
import Papa from "papaparse";
import { getProduct, getQuestions } from "../src/lib/catalog";
import { draftReply, MODEL_ID, NotCachedError } from "../src/lib/draft";
import { QuotaExhaustedError } from "../src/lib/quota";

process.loadEnvFile(".env.local");

const OUT = "data/answer.csv";
const cachedOnly = process.argv.includes("--cached-only");

async function main() {
  const questions = getQuestions();
  const rows: Record<string, string | number>[] = [];
  let requests = 0;
  let quotaHit: string | null = null;

  for (const [i, q] of questions.entries()) {
    const product = getProduct(q.product_id)!;
    const base = {
      question_id: q.question_id,
      product_id: q.product_id,
      product_title: product.title,
      shopper_first_name: q.shopper_first_name,
      question_category: q.question_category,
      question_text: q.question_text,
      answerable_from_page: q.answerable_from_page,
    };
    if (process.stdout.isTTY) process.stdout.write(`\r  ${i + 1}/${questions.length} ${q.question_id}   `);
    try {
      // Once the quota is gone, only cached drafts can still be produced (they cost nothing).
      const d = await draftReply({ product, message: q.question_text, shopperName: q.shopper_first_name }, { cachedOnly });
      requests += d.requestsUsed;
      rows.push({
        ...base,
        reply: d.reply,
        draft_status: d.overall,
        allergy_concern: String(d.allergyConcern),
        checks_failed: d.checks.filter((c) => !c.ok).map((c) => c.label).join("; "),
        model: d.model,
      });
    } catch (e) {
      if (e instanceof NotCachedError) {
        // expected in --cached-only mode
      } else if (!(e instanceof QuotaExhaustedError)) {
        console.error(`\n  ${q.question_id} failed: ${e instanceof Error ? e.message : e}`);
      } else {
        quotaHit = e.message;
      }
      rows.push({ ...base, reply: "", draft_status: "pending", allergy_concern: "", checks_failed: "", model: "" });
    }
  }

  writeFileSync(OUT, Papa.unparse(rows, { quotes: true }) + "\n");
  const done = rows.filter((r) => r.draft_status !== "pending").length;
  console.log(`\n\nWrote ${OUT}: ${done}/${rows.length} replies drafted with ${MODEL_ID} (${requests} free requests used this run).`);
  if (done < rows.length) {
    console.log(`${rows.length - done} still pending${quotaHit ? `: ${quotaHit}` : "."} Run npm run answers again tomorrow to continue.`);
  }
}

main();
