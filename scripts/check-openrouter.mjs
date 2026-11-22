// Verifies the OpenRouter key in .env.local without ever printing it in full.
// Run: node scripts/check-openrouter.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const key = env.OPENROUTER_API_KEY;
if (!key) {
  console.error("✗ OPENROUTER_API_KEY is empty in .env.local");
  process.exit(1);
}
const masked = `${key.slice(0, 8)}…${key.slice(-4)}`;
console.log(`Key found in .env.local: ${masked}`);

const res = await fetch("https://openrouter.ai/api/v1/key", {
  headers: { Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`✗ OpenRouter rejected the key (HTTP ${res.status})`);
  process.exit(1);
}
const { data } = await res.json();
console.log("✓ OpenRouter key is valid");
console.log(`  Label:        ${data.label ?? "-"}`);
console.log(`  Usage:        $${Number(data.usage ?? 0).toFixed(4)}`);
console.log(`  Credit limit: ${data.limit == null ? "none" : "$" + data.limit}`);
console.log(`  Free tier:    ${data.is_free_tier ? "yes" : "no"}`);
