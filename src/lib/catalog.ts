import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import type { Product, ShopperQuestion } from "./types";

function readCsv<T>(file: string): T[] {
  const text = readFileSync(path.join(process.cwd(), "data", file), "utf8");
  const { data, errors } = Papa.parse<T>(text, { header: true, skipEmptyLines: true });
  if (errors.length) throw new Error(`Could not parse ${file}: ${errors[0].message}`);
  return data;
}

// Read once at module scope: the catalog snapshot doesn't change per request.
const products: Product[] = readCsv<Product>("products.csv");
const questions: ShopperQuestion[] = readCsv<ShopperQuestion>("questions.csv");
const productsById = new Map(products.map((p) => [p.product_id, p]));

// product_id is the primary key that joins a question to its product page. Fail loudly at
// startup rather than ever answering a question from the wrong page.
const blankIds = products.filter((p) => !p.product_id?.trim());
if (blankIds.length) throw new Error(`products.csv: ${blankIds.length} row(s) have no product_id.`);
if (productsById.size !== products.length) {
  const seen = new Set<string>();
  const dupes = products.map((p) => p.product_id).filter((id) => seen.has(id) || !seen.add(id));
  throw new Error(`products.csv: product_id must be unique; duplicated: ${[...new Set(dupes)].join(", ")}`);
}
const orphans = questions.filter((q) => !productsById.has(q.product_id));
if (orphans.length) {
  throw new Error(
    `questions.csv: product_id not found in products.csv for ${orphans.map((q) => `${q.question_id} (${q.product_id})`).join(", ")}`,
  );
}

export function getProducts(): Product[] {
  return products;
}

export function getProduct(id: string): Product | undefined {
  return productsById.get(id);
}

export function getQuestions(): ShopperQuestion[] {
  return questions;
}
