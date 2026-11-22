# Inbox Reply Helper

Drafts replies to shopper chat questions using **only what's on the product page**. If the page doesn't answer the question, the reply says *"I'll check with the shop and get back to you"* rather than guessing. The merchant reviews and approves every draft.

Built with Next.js 16, the Vercel AI SDK (v7) and **free OpenRouter models only**.

**See it work:** [`samples/sample-replies.md`](samples/sample-replies.md) has three real drafts, each matched to its product page by `product_id`.

## Run it

```bash
npm install
cp .env.example .env.local      # then paste your OpenRouter key
npm run check:key               # confirms the key works (prints it masked)
npm run dev                     # http://localhost:3000
```

## Free models only

The project runs on OpenRouter's free models with no credits, and that shapes the design:

- **50 free requests a day.** OpenRouter caps free-model use per account. The app header shows how many are left, and drafting stops with a clear message when they run out. The limit resets at midnight UTC.
- **1–2 requests per draft.** Every draft needs one request. The second-pass AI review is spent only on allergy, sensitivity and ingredient questions, where a wrong answer can hurt someone. Usage, size and price answers rely on the code checks, and the merchant approves every reply.
- **Every model response is cached** in `.cache/drafts`. Drafting the same question again uses no requests, and fixes to the code after the model call apply to saved drafts without spending any. Only a prompt change triggers new requests.
- **Code does the checking, not extra model calls.** Free models are weaker, so the ingredient yes/no check, the plain-English names, the facility warning and the reply wording are all handled in code.
- **Fallbacks.** If the main model is down or rate-limited upstream, OpenRouter tries the next free model in the list (`src/lib/draft.ts`).
- **Paid models are refused.** `OPENROUTER_MODEL` must end in `:free`, or the app won't start.

## How a draft is made

The hard requirement is that a shopper with an allergy is never told something the page doesn't say. A model can be wrong, so several independent checks sit between the model and the shopper:

1. **Plain-English ingredient dictionary** (`src/lib/glossary.ts`). Every INCI name in the catalog is mapped to a reviewed plain name, e.g. `Prunus Amygdalus Dulcis Oil (sweet almond oil)`. The model sees the annotated list, so it never has to translate Latin names from memory. `npm run check:glossary` fails if a catalog ingredient has no entry.
2. **Draft with quotes** (`src/lib/draft.ts`, 1 request). The model splits the message into questions and answers each one with `answered` or `needs_shop`. Every answer has to cite exact quotes from named page fields.
3. **Quote check** (code). Each quote has to appear in that field on the page. An answer with no verified quote becomes "I'll check with the shop".
4. **Ingredient check** (code). Ingredient words in the shopper's message (almond, coconut, vitamin E…) are detected by code and looked up in the dictionary, whether or not the model reported them. If the reply denies an ingredient that's on the list, or names one that isn't, the whole reply is held. If the reply forgets to name an ingredient that is on the list, the dictionary fact is added.
5. **Plain-English brackets** (code). Any Latin ingredient name in the reply gets its plain-English name added in brackets.
6. **Second-pass review** (AI, 1 request, allergy and ingredient questions only). A separate call checks each answer against the page and removes anything unsupported, such as safety claims, free-from claims or outside knowledge.
7. **Facility warning** (code). If the shopper has an allergy concern and the page says *"Made in a facility that also handles tree nuts"*, that warning is always in the reply.
8. **Product mismatch** (flagged by AI, worded by code). If the shopper names a different product than the page they're on, the reply says which product it's answering about.

The reply's greeting, holding line, warnings and mismatch note are fixed wording added by code. The model only writes the answer sentences.

## Evaluate

```bash
npm run eval               # all 120 questions, as far as today's free requests allow
npm run eval Q-001 Q-024   # specific questions
```

It runs one question at a time. When the day's free requests run out, it stops cleanly and lists what's left. Run it again the next day to continue: finished questions come from the cache and cost nothing. All 120 take a few days.

This writes `eval/report.md` (summary and every draft) and `eval/results.json`. Ground truth is the **product catalog**, not the CSV's `expected_answer_note` column. Many of those notes describe a different product than the `product_id` they're attached to. For example, Q-001 says DSP-003 contains almond, but its ingredient list doesn't. The report lists every such contradiction.

## Data

- `data/products.csv` is the catalog snapshot of 40 product pages (16 Nov 2026). `product_id` is its primary key.
- `data/questions.csv` holds 120 shopper chat questions (19 Oct to 16 Nov 2026), each linked to a product page by `product_id`. The app refuses to start if a `product_id` is missing, duplicated or unknown.

## Config

| Variable | Default |
|---|---|
| `OPENROUTER_API_KEY` | required |
| `OPENROUTER_MODEL` | `baidu/ernie-5.5-flash-preview:free`. Must be a free model (ending in `:free`). |
