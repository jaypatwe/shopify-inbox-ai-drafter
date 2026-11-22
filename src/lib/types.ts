export type Product = {
  product_id: string;
  product_handle: string;
  title: string;
  product_type: string;
  vendor: string;
  price: string;
  size: string;
  description: string;
  ingredient_list: string;
  allergen_statement: string;
  usage_instructions: string;
  page_url: string;
  last_updated: string;
};

export type ShopperQuestion = {
  question_id: string;
  product_id: string;
  chat_received_at: string;
  shopper_first_name: string;
  question_text: string;
  question_category: string;
  ingredient_mentioned: string;
  answerable_from_page: string;
  expected_answer_note: string;
};

/** Product page fields the model may cite as evidence. */
export const PAGE_FIELDS = [
  "title",
  "price",
  "size",
  "description",
  "ingredient_list",
  "allergen_statement",
  "usage_instructions",
] as const;
export type PageField = (typeof PAGE_FIELDS)[number];

export type AnnotatedIngredient = {
  inci: string;
  plain: string | null;
  /** "INCI (plain English)", the form used in replies. */
  display: string;
  tags: string[];
};

export type Evidence = { field: PageField; quote: string; verified: boolean };

export type AnswerItem = {
  question: string;
  status: "answered" | "needs_shop";
  answer: string;
  evidence: Evidence[];
  /** Why the item was downgraded from answered to needs_shop, if it was. */
  downgradeReason?: string;
};

export type Check = { label: string; ok: boolean; detail?: string };

export type DraftResult = {
  productId: string;
  productTitle: string;
  reply: string;
  overall: "answered" | "partial" | "needs_shop";
  items: AnswerItem[];
  ingredientClaims: { term: string; onList: boolean; matched: string[] }[];
  facilityWarning: string | null;
  allergyConcern: boolean;
  productMismatch: string | null;
  checks: Check[];
  model: string;
  ms: number;
};
