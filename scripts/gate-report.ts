/**
 * Turns promptfoo's output into the pilot gate decision: promptfoo/gate-report.md.
 *
 * THE GATE (the pilot passes only if all three hold):
 *   1. Coverage: all 120 questions have a drafted reply with a valid AI-judge result.
 *   2. Zero tolerance: no reply fails ingredient truth (no made-up or denied ingredients).
 *   3. Pass bar: at least 90% of replies (108 of 120) get a PASS final verdict.
 *
 * Final verdict per reply = PASS only if all three checks pass:
 *   1_ingredient_truth (code), 2_reply_rules (code), 3_ai_judge (llm-rubric, score >= 0.7).
 *
 * Also records which replies were validly judged (promptfoo/judged.json) and bumps the attempt
 * number for replies whose judge response was malformed (promptfoo/judge-attempts.json), so the
 * next run regrades them instead of re-reading the broken answer from promptfoo's cache.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";

const PASS_BAR = 0.9;
const RESULTS = "promptfoo/output/results.json";
const ANSWERS = "data/answer.csv";
const REPORT = "promptfoo/gate-report.md";
const JUDGED = "promptfoo/judged.json";
const ATTEMPTS = "promptfoo/judge-attempts.json";

type Component = { pass: boolean; score?: number; reason: string; assertion?: { metric?: string } };
type Result = {
  vars: Record<string, string>;
  success: boolean;
  error?: string;
  gradingResult?: { componentResults?: Component[] };
};

const answers = Papa.parse<Record<string, string>>(readFileSync(ANSWERS, "utf8"), { header: true, skipEmptyLines: true }).data;
const results: Result[] = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")).results.results : [];
const attempts: Record<string, number> = existsSync(ATTEMPTS) ? JSON.parse(readFileSync(ATTEMPTS, "utf8")) : {};
const byId = new Map(results.map((r) => [r.vars.question_id, r]));

const component = (r: Result, metric: string) => r.gradingResult?.componentResults?.find((c) => c.assertion?.metric === metric);

/** A judge answer we can't trust as a grade: missing, errored, or a template echo like "string". */
function judgeBroken(r: Result): string | null {
  if (r.error) return r.error;
  const j = component(r, "3_ai_judge");
  if (!j) return "no judge result";
  const reason = (j.reason ?? "").trim();
  if (reason.length < 25 || /^(string|reason|\{.*\})$/i.test(reason) || /error|could not parse|invalid json/i.test(reason.slice(0, 60)))
    return `malformed judge response: "${reason.slice(0, 60)}"`;
  return null;
}

type Row = {
  id: string;
  productId: string;
  title: string;
  state: "pending" | "not_graded" | "judge_error" | "graded";
  truth?: Component;
  rules?: Component;
  judge?: Component;
  verdict?: "PASS" | "FAIL";
  note?: string;
};

const rows: Row[] = answers.map((a) => {
  const base = { id: a.question_id, productId: a.product_id, title: a.product_title };
  if (!a.draft_status || a.draft_status === "pending") return { ...base, state: "pending" };
  const r = byId.get(a.question_id);
  if (!r) return { ...base, state: "not_graded" };
  const broken = judgeBroken(r);
  const truth = component(r, "1_ingredient_truth");
  const rules = component(r, "2_reply_rules");
  if (broken) return { ...base, state: "judge_error", truth, rules, note: broken };
  return { ...base, state: "graded", truth, rules, judge: component(r, "3_ai_judge"), verdict: r.success ? "PASS" : "FAIL" };
});

// Bookkeeping for the next run.
const judgedIds = rows.filter((r) => r.state === "graded").map((r) => r.id);
writeFileSync(JUDGED, JSON.stringify(judgedIds, null, 2) + "\n");
for (const r of rows.filter((r) => r.state === "judge_error")) attempts[r.id] = (attempts[r.id] ?? 1) + 1;
writeFileSync(ATTEMPTS, JSON.stringify(attempts, null, 2) + "\n");

// The gate.
const total = rows.length;
const graded = rows.filter((r) => r.state === "graded");
const passed = graded.filter((r) => r.verdict === "PASS");
// Ingredient truth is code, so it counts even when the judge result was broken.
const truthFailures = rows.filter((r) => r.truth && !r.truth.pass);
const need = Math.ceil(PASS_BAR * total);
const coverageOk = graded.length === total;
const truthOk = truthFailures.length === 0;
const barOk = passed.length >= need;
const gate = coverageOk && truthOk && barOk;
const gateLabel = gate ? "PASS" : !truthOk || (coverageOk && !barOk) ? "FAIL" : "NOT DECIDED YET";

const count = (metric: "truth" | "rules" | "judge") => graded.filter((r) => r[metric]?.pass).length;
const judgeScores = graded.map((r) => r.judge?.score ?? 0);
const avgJudge = judgeScores.length ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length : 0;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");

const md: string[] = [
  `# Pilot gate report`,
  ``,
  `**Gate: ${gateLabel}** · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ``,
  `No merchant sees a reply until this gate passes.`,
  ``,
  `| Gate condition | Required | Now | |`,
  `|---|---|---|---|`,
  `| Coverage: every reply drafted and judged | ${total} / ${total} | ${graded.length} / ${total} | ${coverageOk ? "✅" : "⏳"} |`,
  `| Ingredient truth: no made-up or denied ingredients | 0 failures | ${truthFailures.length} | ${truthOk ? "✅" : "❌"} |`,
  `| Final verdict PASS (all three checks) | ≥ ${need} (${PASS_BAR * 100}%) | ${passed.length} | ${barOk ? "✅" : coverageOk ? "❌" : "⏳"} |`,
  ``,
  `## Checks on the ${graded.length} graded replies`,
  ``,
  `| Check | How | Passed |`,
  `|---|---|---|`,
  `| 1. Ingredient truth | Code. Zero tolerance | ${count("truth")} / ${graded.length} |`,
  `| 2. Reply rules (plain-English names, "check with the shop", facility warning, no unsupported claims) | Code | ${count("rules")} / ${graded.length} |`,
  `| 3. AI judge (accuracy, grounding, helpfulness) | promptfoo \`llm-rubric\`, free OpenRouter model, score ≥ 0.7 | ${count("judge")} / ${graded.length} (avg score ${avgJudge.toFixed(2)}) |`,
  `| **Final verdict PASS** | All three | **${passed.length} / ${graded.length}** (${pct(passed.length, graded.length)}) |`,
  ``,
  `Progress: ${rows.filter((r) => r.state === "pending").length} not drafted yet · ${rows.filter((r) => r.state === "not_graded").length} drafted, waiting for a judge request · ${rows.filter((r) => r.state === "judge_error").length} judge errors (regraded next run). Free models allow 50 requests a day, so run \`npm run gate\` daily until coverage is complete.`,
  ``,
];

const failing = graded.filter((r) => r.verdict === "FAIL");
if (truthFailures.length) {
  md.push(`## ❌ Ingredient truth failures`, ``);
  for (const r of truthFailures) md.push(`- **${r.id}** · \`${r.productId}\` ${r.title}: ${r.truth!.reason}`);
  md.push(``);
}
if (failing.length) {
  md.push(`## Replies that failed`, ``);
  for (const r of failing) {
    const why = [r.truth, r.rules, r.judge].filter((c) => c && !c.pass).map((c) => c!.reason);
    md.push(`- **${r.id}** · \`${r.productId}\` ${r.title} (judge ${r.judge?.score?.toFixed(2) ?? "–"}): ${why.join(" · ")}`);
  }
  md.push(``);
}
const errors = rows.filter((r) => r.state === "judge_error");
if (errors.length) {
  md.push(`## Judge errors (not counted; regraded next run)`, ``);
  for (const r of errors) md.push(`- **${r.id}** · \`${r.productId}\`: ${r.note}`);
  md.push(``);
}
md.push(`## Every graded reply`, ``, `| Question | product_id | Product | Ingredient truth | Reply rules | AI judge | Verdict |`, `|---|---|---|---|---|---|---|`);
for (const r of graded) {
  md.push(
    `| ${r.id} | \`${r.productId}\` | ${r.title} | ${r.truth?.pass ? "✅" : "❌"} | ${r.rules?.pass ? "✅" : "❌"} | ${r.judge?.pass ? "✅" : "❌"} ${r.judge?.score?.toFixed(2)} | **${r.verdict}** |`,
  );
}
md.push(``);

writeFileSync(REPORT, md.join("\n"));
// Machine-readable status for the daily runner (scripts/daily-gate.sh).
writeFileSync(
  "promptfoo/gate-status.json",
  JSON.stringify(
    {
      gate: gateLabel,
      total,
      drafted: rows.filter((r) => r.state !== "pending").length,
      graded: graded.length,
      passed: passed.length,
      ingredientTruthFailures: truthFailures.length,
      judgeErrors: rows.filter((r) => r.state === "judge_error").length,
      complete: coverageOk,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(md.slice(0, 22).join("\n"));
console.log(`\nFull report: ${REPORT}`);
