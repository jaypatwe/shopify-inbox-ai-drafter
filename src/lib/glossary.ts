/**
 * Plain-English names for every INCI (Latin/technical) ingredient name in the catalog.
 *
 * Why this exists: we never let the model translate ingredient names on its own.
 * "Prunus Amygdalus Dulcis Oil" must always surface to the shopper as sweet almond oil,
 * and that translation has to come from a reviewed list, not from the model's memory.
 *
 * Every ingredient in data/products.csv must have an entry here. `npm run check:glossary`
 * fails if one is missing, so a new product can't ship with an untranslated ingredient.
 */

export type ConcernTag =
  | "tree_nut"
  | "coconut"
  | "coconut_derived"
  | "wool"
  | "bee"
  | "fragrance"
  | "fragrance_component"
  | "essential_oil"
  | "shea"
  | "oat"
  | "vitamin_e"
  | "vitamin_c"
  | "salicylate"
  | "kernel_oil"
  | "menthol_camphor";

export type GlossaryEntry = {
  /** Plain-English name shown to shoppers in brackets after the INCI name. */
  plain: string;
  /** Concern tags. Used to flag ingredients to the model and the merchant. Not shown as claims. */
  tags?: ConcernTag[];
};

/** Keys are normalized INCI names (see normalizeInci). */
const ENTRIES: Record<string, GlossaryEntry> = {
  "allantoin": { plain: "allantoin, a skin-soothing ingredient" },
  "aloe barbadensis leaf juice": { plain: "aloe vera juice" },
  "aqua": { plain: "water" },
  "arnica montana flower extract": { plain: "arnica flower extract" },
  "ascorbic acid": { plain: "vitamin C", tags: ["vitamin_c"] },
  "ascorbyl palmitate": { plain: "a form of vitamin C", tags: ["vitamin_c"] },
  "avena sativa kernel extract": { plain: "oat extract", tags: ["oat"] },
  "avena sativa kernel flour": { plain: "colloidal oat flour", tags: ["oat"] },
  "bakuchiol": { plain: "bakuchiol, a plant extract from babchi seeds" },
  "bentonite": { plain: "bentonite clay" },
  "bisabolol": { plain: "bisabolol, a soothing compound found in chamomile" },
  "butyrospermum parkii butter": { plain: "shea butter", tags: ["shea"] },
  "calendula officinalis flower extract": { plain: "calendula (marigold) flower extract" },
  "camellia japonica seed oil": { plain: "camellia seed oil" },
  "camellia sinensis leaf extract": { plain: "green tea extract" },
  "camphor": { plain: "camphor", tags: ["menthol_camphor"] },
  "caprylic/capric triglyceride": { plain: "a light oil usually made from coconut or palm oil", tags: ["coconut_derived"] },
  "cera alba": { plain: "beeswax", tags: ["bee"] },
  "ceramide np": { plain: "ceramide, a skin-barrier lipid" },
  "cetearyl alcohol": { plain: "cetearyl alcohol, a plant-derived thickener (not drying alcohol)" },
  "chamomilla recutita flower extract": { plain: "chamomile flower extract" },
  "charcoal powder": { plain: "activated charcoal" },
  "cholesterol": { plain: "cholesterol, a skin-barrier lipid" },
  "citral": { plain: "citral, a natural scent compound found in citrus oils", tags: ["fragrance_component"] },
  "citric acid": { plain: "citric acid, a pH adjuster" },
  "citronellol": { plain: "citronellol, a natural scent compound found in rose oil", tags: ["fragrance_component"] },
  "citrus aurantium dulcis peel oil": { plain: "sweet orange peel oil", tags: ["essential_oil"] },
  "citrus limon peel oil": { plain: "lemon peel oil", tags: ["essential_oil"] },
  "coco-glucoside": { plain: "a gentle cleanser made from coconut oil and sugar", tags: ["coconut_derived"] },
  "cocos nucifera oil": { plain: "coconut oil", tags: ["coconut"] },
  "cucumis sativus fruit extract": { plain: "cucumber extract" },
  "daucus carota sativa seed oil": { plain: "carrot seed oil" },
  "ethylhexylglycerin": { plain: "ethylhexylglycerin, a preservative booster" },
  "euphorbia cerifera wax": { plain: "candelilla wax, a plant wax" },
  "ferulic acid": { plain: "ferulic acid, a plant antioxidant" },
  "geraniol": { plain: "geraniol, a natural scent compound found in rose oil", tags: ["fragrance_component"] },
  "glycerin": { plain: "glycerin, a moisture-attracting ingredient" },
  "glyceryl stearate": { plain: "glyceryl stearate, an emulsifier" },
  "hamamelis virginiana water": { plain: "witch hazel water" },
  "helianthus annuus seed oil": { plain: "sunflower seed oil" },
  "iron oxides": { plain: "iron oxide mineral pigments" },
  "kaolin": { plain: "kaolin clay" },
  "lactic acid": { plain: "lactic acid, a gentle exfoliating acid" },
  "lanolin": { plain: "lanolin, wool wax from sheep's wool", tags: ["wool"] },
  "lavandula angustifolia oil": { plain: "lavender oil", tags: ["essential_oil"] },
  "limonene": { plain: "limonene, a natural scent compound found in citrus oils", tags: ["fragrance_component"] },
  "linalool": { plain: "linalool, a natural scent compound found in lavender", tags: ["fragrance_component"] },
  "macadamia integrifolia seed oil": { plain: "macadamia nut oil", tags: ["tree_nut"] },
  "mel": { plain: "honey", tags: ["bee"] },
  "melaleuca alternifolia leaf oil": { plain: "tea tree oil", tags: ["essential_oil"] },
  "mentha piperita oil": { plain: "peppermint oil", tags: ["essential_oil"] },
  "menthol": { plain: "menthol, the cooling compound from mint", tags: ["menthol_camphor"] },
  "mica": { plain: "mica, a shimmer mineral" },
  "niacinamide": { plain: "niacinamide (vitamin B3)" },
  "panthenol": { plain: "panthenol (provitamin B5)" },
  "parfum": { plain: "fragrance; the page does not list what the fragrance is made of", tags: ["fragrance"] },
  "pentylene glycol": { plain: "pentylene glycol, a moisturizing solvent" },
  "phenoxyethanol": { plain: "phenoxyethanol, a preservative" },
  "potassium sorbate": { plain: "potassium sorbate, a preservative" },
  "propolis extract": { plain: "propolis, a resin made by bees", tags: ["bee"] },
  "prunus amygdalus dulcis oil": { plain: "sweet almond oil", tags: ["tree_nut"] },
  "prunus armeniaca kernel oil": { plain: "apricot kernel oil, pressed from apricot pits", tags: ["kernel_oil"] },
  "ricinus communis seed oil": { plain: "castor oil" },
  "rosa canina fruit oil": { plain: "rosehip oil" },
  "rosa damascena flower oil": { plain: "rose oil", tags: ["essential_oil"] },
  "rosa damascena flower water": { plain: "rose water" },
  "rosmarinus officinalis leaf extract": { plain: "rosemary leaf extract" },
  "salicylic acid": { plain: "salicylic acid (BHA), an exfoliating acid", tags: ["salicylate"] },
  "salix alba bark extract": { plain: "white willow bark extract", tags: ["salicylate"] },
  "simmondsia chinensis seed oil": { plain: "jojoba oil" },
  "sodium benzoate": { plain: "sodium benzoate, a preservative" },
  "sodium c14-16 olefin sulfonate": { plain: "a foaming cleanser (surfactant)" },
  "sodium cocoyl isethionate": { plain: "a mild cleanser made from coconut fatty acids", tags: ["coconut_derived"] },
  "sodium hyaluronate": { plain: "hyaluronic acid" },
  "sodium pca": { plain: "sodium PCA, a moisture-attracting ingredient" },
  "squalane": { plain: "squalane, a lightweight moisturizing oil" },
  "stearic acid": { plain: "stearic acid, a fatty acid" },
  "stevia rebaudiana leaf extract": { plain: "stevia leaf extract" },
  "theobroma cacao seed butter": { plain: "cocoa butter" },
  "titanium dioxide": { plain: "titanium dioxide, a mineral sunscreen filter" },
  "tocopherol": { plain: "vitamin E", tags: ["vitamin_e"] },
  "urea": { plain: "urea, a skin-softening ingredient" },
  "vaccinium macrocarpon seed oil": { plain: "cranberry seed oil" },
  "vanilla planifolia fruit extract": { plain: "vanilla extract" },
  "vitis vinifera seed oil": { plain: "grapeseed oil" },
  "xanthan gum": { plain: "xanthan gum, a thickener" },
  "zinc oxide": { plain: "zinc oxide, a mineral sunscreen filter" },
  "zinc pca": { plain: "zinc PCA, a form of zinc" },
  "zingiber officinale root oil": { plain: "ginger root oil", tags: ["essential_oil"] },
};

/**
 * Drops the brackets that labels already include ("Cera Alba (Beeswax)" becomes "cera alba")
 * and lowercases, so the same INCI name matches however the label formats it.
 */
export function normalizeInci(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function lookupIngredient(inci: string): GlossaryEntry | undefined {
  return ENTRIES[normalizeInci(inci)];
}

export const TAG_LABELS: Record<ConcernTag, string> = {
  tree_nut: "tree nut",
  coconut: "coconut",
  coconut_derived: "coconut-derived",
  wool: "from sheep's wool",
  bee: "bee product",
  fragrance: "fragrance (components not listed)",
  fragrance_component: "fragrance component",
  essential_oil: "essential oil",
  shea: "shea",
  oat: "oat",
  vitamin_e: "vitamin E",
  vitamin_c: "vitamin C",
  salicylate: "salicylate",
  kernel_oil: "fruit kernel oil",
  menthol_camphor: "menthol/camphor",
};
