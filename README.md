# Inbox Reply Helper

Drafts replies to shopper chat questions using **only what's on the product page**. If the page doesn't answer the question, the reply says *"I'll check with the shop and get back to you"* rather than guessing. The merchant reviews and approves every draft.

Built with Next.js 16, the Vercel AI SDK (v7) and OpenRouter.

## Run it

```bash
npm install
cp .env.example .env.local      # then paste your OpenRouter key
npm run check:key               # confirms the key works (prints it masked)
npm run dev                     # http://localhost:3000
```

## How a draft is made

The hard requirement is that a shopper with an allergy is never told something the page doesn't say. A model can be wrong, so several independent checks sit between the model and the shopper:

1. **Plain-English ingredient dictionary** (`src/lib/glossary.ts`). Every INCI name in the catalog is mapped to a reviewed plain name, e.g. `Prunus Amygdalus Dulcis Oil (sweet almond oil)`. The model sees the annotated list, so it never has to translate Latin names from memory. `npm run check:glossary` fails if a catalog ingredient has no entry.
2. **Draft with quotes** (`src/lib/draft.ts`). The model splits the message into questions and answers each one with `answered` or `needs_shop`. Every answer has to cite exact quotes from named page fields.
3. **Quote check** (code, not AI). Each quote has to appear in that field on the page. An answer with no verified quote is downgraded to "I'll check with the shop".
4. **Ingredient check** (code, not AI). Every "is X in it?" claim is re-checked against the dictionary. If the model says almond isn't listed but the dictionary finds it, or the model names an ingredient that isn't on the page, the whole reply is held and replaced with a holding message.
5. **Plain-English brackets** (code). Any Latin ingredient name in the reply gets its plain-English name added in brackets.
6. **Second-pass review** (AI). A separate model call checks every answer against the page and pulls out anything unsupported, such as safety claims, free-from claims or outside knowledge.
7. **Facility warning** (code). If the shopper has an allergy concern and the page says *"Made in a facility that also handles tree nuts"*, that warning is always in the reply.
8. **Product mismatch** (AI-flagged, code-worded). If the shopper names a different product or size than the page they're on, the reply says which product it's answering about.

The reply's greeting, holding line and warnings are added by code. The model only writes the answer sentences.

## Evaluate

```bash
npm run eval               # all 120 questions in data/questions.csv (~$1.50 of OpenRouter credit)
npm run eval Q-001 Q-024   # specific questions
```

This writes `eval/report.md` (summary and every draft) and `eval/results.json`. Ground truth is the **product catalog**, not the CSV's `expected_answer_note` column. Many of those notes describe a different product than the `product_id` they're attached to. For example, Q-001 says DSP-003 contains almond, but its ingredient list doesn't. The report lists every such contradiction.

## Data

- `data/products.csv` is the catalog snapshot of 40 product pages (16 Nov 2026).
- `data/questions.csv` holds 120 shopper chat questions (19 Oct to 16 Nov 2026).

## Config

| Variable | Default |
|---|---|
| `OPENROUTER_API_KEY` | required |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-5.5` |
