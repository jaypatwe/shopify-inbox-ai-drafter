"use client";

import { useMemo, useState } from "react";
import { annotateIngredients, facilityWarning } from "@/lib/page-context";
import { TAG_LABELS, type ConcernTag } from "@/lib/glossary";
import type { DraftResult, Product, ShopperQuestion } from "@/lib/types";

type Props = { products: Product[]; questions: ShopperQuestion[] };

const COMPOSE = "__compose__";

const CATEGORY_LABEL: Record<string, string> = {
  allergen: "Allergen",
  ingredient: "Ingredient",
  usage: "Usage",
  size_price: "Size & price",
  other: "Other",
};

export function InboxApp({ products, questions }: Props) {
  const productsById = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const [selected, setSelected] = useState<string>(questions[0]?.question_id ?? COMPOSE);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftResult>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [compose, setCompose] = useState({ productId: products[0]?.product_id ?? "", name: "", message: "" });
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");

  const visible = questions.filter((q) => {
    if (filter !== "all" && q.question_category !== filter) return false;
    if (!search) return true;
    const p = productsById.get(q.product_id);
    return `${q.question_text} ${q.shopper_first_name} ${p?.title ?? ""} ${q.question_id}`.toLowerCase().includes(search.toLowerCase());
  });

  const current = selected === COMPOSE ? null : questions.find((q) => q.question_id === selected) ?? null;
  const product = current ? productsById.get(current.product_id) : productsById.get(compose.productId);
  const message = current ? current.question_text : compose.message;
  const shopperName = current ? current.shopper_first_name : compose.name;
  const draft = drafts[selected];

  async function generate() {
    if (!product || !message.trim()) return;
    const key = selected;
    setLoading(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.product_id, message, shopperName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setDrafts((d) => ({ ...d, [key]: data }));
      setEdited((e) => ({ ...e, [key]: data.reply }));
      setSent((s) => ({ ...s, [key]: false }));
    } catch (e) {
      setError((er) => ({ ...er, [key]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLoading(null);
    }
  }

  function open(id: string) {
    setSelected(id);
    setMobilePane("detail");
  }

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">Inbox reply helper</h1>
          <p className="truncate text-xs text-ink-3">Drafts only use what&rsquo;s on the product page. You approve every reply.</p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-xs text-ink-3 sm:flex">
          <span className="inline-block size-2 rounded-full bg-ok" />
          {products.length} product pages · {questions.length} chats
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr] xl:grid-cols-[320px_minmax(0,1fr)_460px]">
        {/* Inbox list */}
        <aside className={`${mobilePane === "list" ? "flex" : "hidden"} min-h-0 flex-col border-r border-line bg-panel md:flex`}>
          <div className="space-y-2 border-b border-line p-3">
            <button
              onClick={() => open(COMPOSE)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                selected === COMPOSE ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-panel-2"
              }`}
            >
              + Try your own question
            </button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-1">
              {["all", ...Object.keys(CATEGORY_LABEL)].map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    filter === c ? "bg-ink text-panel" : "bg-panel-2 text-ink-2 hover:text-ink"
                  }`}
                >
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((q) => {
              const p = productsById.get(q.product_id);
              const d = drafts[q.question_id];
              return (
                <li key={q.question_id}>
                  <button
                    onClick={() => open(q.question_id)}
                    className={`block w-full border-b border-line px-3 py-2.5 text-left transition ${
                      selected === q.question_id ? "bg-accent-soft" : "hover:bg-panel-2"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{q.shopper_first_name}</span>
                      <span className="shrink-0 text-[11px] text-ink-3">{q.question_id}</span>
                    </div>
                    <div className="truncate text-xs text-ink-2">{p?.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{q.question_text}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-2">{CATEGORY_LABEL[q.question_category] ?? q.question_category}</span>
                      {d && <StatusPill overall={d.overall} small />}
                      {sent[q.question_id] && <span className="text-[10px] font-medium text-ok">Approved</span>}
                    </div>
                  </button>
                </li>
              );
            })}
            {!visible.length && <li className="p-4 text-sm text-ink-3">No chats match.</li>}
          </ul>
        </aside>

        {/* Conversation + product page */}
        <main className={`${mobilePane === "detail" ? "block" : "hidden"} min-h-0 overflow-y-auto md:block`}>
          <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
            <button onClick={() => setMobilePane("list")} className="text-sm text-accent md:hidden">
              ← All chats
            </button>

            {selected === COMPOSE ? (
              <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
                <h2 className="text-sm font-semibold">Try your own question</h2>
                <label className="block text-xs text-ink-2">
                  Product page
                  <select
                    value={compose.productId}
                    onChange={(e) => setCompose((c) => ({ ...c, productId: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
                  >
                    {products.map((p) => (
                      <option key={p.product_id} value={p.product_id}>
                        {p.title} ({p.product_id})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-ink-2">
                  Shopper first name (optional)
                  <input
                    value={compose.name}
                    onChange={(e) => setCompose((c) => ({ ...c, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
                  />
                </label>
                <label className="block text-xs text-ink-2">
                  Shopper message
                  <textarea
                    value={compose.message}
                    onChange={(e) => setCompose((c) => ({ ...c, message: e.target.value }))}
                    rows={3}
                    placeholder="e.g. Is there almond in this? I have a nut allergy."
                    className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
                  />
                </label>
              </section>
            ) : (
              current && (
                <section className="rounded-xl border border-line bg-panel p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
                    <span>
                      {current.shopper_first_name} · {new Date(current.chat_received_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span>{current.question_id}</span>
                  </div>
                  <p className="rounded-2xl rounded-tl-sm bg-panel-2 px-3.5 py-2.5 text-[15px] leading-relaxed">{current.question_text}</p>
                </section>
              )
            )}

            {product && <ProductPage product={product} draft={draft} />}
          </div>
        </main>

        {/* Draft panel */}
        <section
          className={`${mobilePane === "detail" ? "block" : "hidden"} min-h-0 overflow-y-auto border-l border-line bg-panel md:col-span-2 md:block xl:col-span-1`}
        >
          <div className="space-y-4 p-4 md:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">AI draft</h2>
              {draft && <span className="text-[11px] text-ink-3">{(draft.ms / 1000).toFixed(1)}s · {draft.model.split("/")[1]}</span>}
            </div>

            <button
              onClick={generate}
              disabled={!!loading || !product || !message.trim()}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 dark:text-black"
            >
              {loading === selected ? "Drafting and checking against the page…" : draft ? "Redraft" : "Draft reply"}
            </button>

            {error[selected] && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error[selected]}</p>}

            {loading === selected && (
              <ol className="space-y-1.5 text-xs text-ink-3">
                <li>1. Drafting answers with quotes from the page</li>
                <li>2. Checking every quote is really on the page</li>
                <li>3. Checking ingredient answers against the dictionary</li>
                <li>4. Second-pass review of each answer</li>
              </ol>
            )}

            {draft && loading !== selected && (
              <>
                <StatusPill overall={draft.overall} />

                <div>
                  <textarea
                    value={edited[selected] ?? draft.reply}
                    onChange={(e) => {
                      setEdited((x) => ({ ...x, [selected]: e.target.value }));
                      setSent((s) => ({ ...s, [selected]: false }));
                    }}
                    rows={10}
                    className="w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => setSent((s) => ({ ...s, [selected]: true }))}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        sent[selected] ? "bg-ok-soft text-ok" : "bg-ink text-panel hover:opacity-90"
                      }`}
                    >
                      {sent[selected] ? "✓ Approved" : "Approve reply"}
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(edited[selected] ?? draft.reply)}
                      className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-panel-2"
                    >
                      Copy
                    </button>
                  </div>
                  {edited[selected] !== undefined && edited[selected] !== draft.reply && (
                    <p className="mt-1.5 text-xs text-warn">Edited by you. The checks below apply to the original draft.</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Safety checks</h3>
                  <ul className="space-y-1.5">
                    {draft.checks.map((c, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className={c.ok ? "text-ok" : "text-bad"}>{c.ok ? "✓" : "✕"}</span>
                        <span>
                          {c.label}
                          {c.detail && <span className="block text-xs text-ink-3">{c.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">What the shopper asked</h3>
                  <ul className="space-y-2">
                    {draft.items.map((it, i) => (
                      <li key={i} className="rounded-lg border border-line p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{it.question}</p>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              it.status === "answered" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
                            }`}
                          >
                            {it.status === "answered" ? "From page" : "Shop to check"}
                          </span>
                        </div>
                        {it.downgradeReason && <p className="mt-1 text-xs text-warn">{it.downgradeReason}</p>}
                        {it.evidence.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {it.evidence.map((e, j) => (
                              <li key={j} className="text-xs text-ink-2">
                                <span className={e.verified ? "text-ok" : "text-bad"}>{e.verified ? "✓" : "✕ not on page"}</span>{" "}
                                <span className="font-mono text-[10px] text-ink-3">{e.field}</span> &ldquo;{e.quote}&rdquo;
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {!draft && !loading && !error[selected] && (
              <p className="text-sm text-ink-3">
                The draft answers only from the product page. If the page doesn&rsquo;t say, the reply tells the shopper you&rsquo;ll check with the shop.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusPill({ overall, small }: { overall: DraftResult["overall"]; small?: boolean }) {
  const map = {
    answered: { label: "Answered from page", cls: "bg-ok-soft text-ok" },
    partial: { label: "Partly answered · shop to check the rest", cls: "bg-warn-soft text-warn" },
    needs_shop: { label: "Shop to check", cls: "bg-warn-soft text-warn" },
  }[overall];
  const label = small ? { answered: "Answered", partial: "Partial", needs_shop: "Shop to check" }[overall] : map.label;
  return (
    <span className={`inline-block rounded-full font-medium ${map.cls} ${small ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"}`}>
      {label}
    </span>
  );
}

function ProductPage({ product, draft }: { product: Product; draft?: DraftResult }) {
  const ingredients = annotateIngredients(product);
  const quotes = (draft?.productId === product.product_id ? draft.items : []).flatMap((i) =>
    i.evidence.filter((e) => e.verified),
  );
  const quotesFor = (field: string) => quotes.filter((q) => q.field === field).map((q) => q.quote);
  const ingQuotes = quotesFor("ingredient_list").join(" | ").toLowerCase();
  const facility = facilityWarning(product);

  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Product page · {product.product_id}</p>
          <h2 className="text-base font-semibold">{product.title}</h2>
        </div>
        <div className="text-right text-sm">
          <span className="font-semibold">
            <Highlight text={`$${product.price}`} quotes={quotesFor("price").length ? [`$${product.price}`] : []} />
          </span>
          <span className="text-ink-3"> · </span>
          <Highlight text={product.size} quotes={quotesFor("size")} />
        </div>
      </div>
      <dl className="space-y-3 px-4 py-3 text-sm">
        <Field label="Description">
          <Highlight text={product.description} quotes={quotesFor("description")} />
        </Field>
        <Field label="Ingredients, with plain-English names">
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {ingredients.map((i) => {
              const hit = ingQuotes.includes(i.inci.toLowerCase());
              const concern = i.tags.length > 0;
              return (
                <li
                  key={i.inci}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    hit ? "border-accent bg-mark" : concern ? "border-warn/40 bg-warn-soft/50" : "border-line bg-panel-2"
                  }`}
                >
                  <span className="font-medium">{i.inci}</span>
                  {i.plain && i.display !== i.inci && <span className="text-ink-2"> ({i.plain})</span>}
                  {i.tags.length > 0 && (
                    <span className="ml-1 text-[10px] text-warn">{i.tags.map((t) => TAG_LABELS[t as ConcernTag]).join(" · ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Field>
        <Field label="Allergen statement">
          {product.allergen_statement ? (
            <span className={facility ? "font-medium text-warn" : ""}>
              <Highlight text={product.allergen_statement} quotes={quotesFor("allergen_statement")} />
            </span>
          ) : (
            <span className="text-ink-3">Empty on this page</span>
          )}
        </Field>
        <Field label="How to use">
          <Highlight text={product.usage_instructions} quotes={quotesFor("usage_instructions")} />
        </Field>
        <p className="text-[11px] text-ink-3">
          {product.page_url} · updated {product.last_updated}
          {quotes.length > 0 && " · highlighted text was quoted in the draft"}
        </p>
      </dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 leading-relaxed">{children}</dd>
    </div>
  );
}

function Highlight({ text, quotes }: { text: string; quotes: string[] }) {
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const q of quotes) {
    const needle = q.trim().replace(/\.$/, "").toLowerCase();
    if (!needle) continue;
    const at = lower.indexOf(needle);
    if (at >= 0) ranges.push([at, at + needle.length]);
  }
  if (!ranges.length) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s < pos) s = pos;
    if (s > pos) out.push(text.slice(pos, s));
    if (e > s) out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    pos = Math.max(pos, e);
  });
  out.push(text.slice(pos));
  return <>{out}</>;
}
