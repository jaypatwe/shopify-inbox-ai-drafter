# Sample replies

Three shopper questions from `data/questions.csv`, each matched to its product page by `product_id` and drafted by the app's pipeline (`npm run eval Q-013 Q-032 Q-064`).

Model: `baidu/ernie-5.5-flash-preview:free` (free on OpenRouter) · generated 2026-11-22

| Question | product_id | Product | answerable_from_page (CSV) | Draft status |
|---|---|---|---|---|
| Q-013 | `DSP-036` | Tinted Mineral Sunscreen SPF 30 | false | Shop to check |
| Q-032 | `DSP-027` | Baby Massage Oil | true | Shop to check |
| Q-064 | `DSP-004` | Calendula Healing Balm Light | true | Answered from page |

## Q-013 · `DSP-036` Tinted Mineral Sunscreen SPF 30

- **Category:** other · **answerable_from_page (CSV):** false · **Draft status:** Shop to check
- **Relevant page fields:** allergen_statement: "Made in a facility that also handles tree nuts."

**Yara asked:**

> Do you ship to Canada? And if so how long does shipping usually take? Trying to get a gift there by early December

**Drafted reply:**

> Hi Yara, thanks for reaching out!
>
> I'll check with the shop and get back to you.
>
> Thanks!

**What the pipeline did:**

- *Do you ship to Canada, and how long does shipping usually take?* → shop to check
  - Held back: Second-pass review: The answer says the page “doesn’t include any shipping or delivery information,” which is supported. But it also says “All it lists is the Tinted Mineral Sunscreen SPF 30 in one size, 50 ml, at 32.00 USD.” The page lists more than that, including description, ingredients, allergen statement, and usage instructions. That extra claim is not supported.
- ✓ Every quote was found on the product page (0 of 0 quotes verified)
- ✓ Ingredient names include a plain-English name (OK)
- ⚠ Second-pass review found every answer supported by the page

## Q-032 · `DSP-027` Baby Massage Oil

- **Category:** allergen · **answerable_from_page (CSV):** true · **Draft status:** Shop to check
- **Relevant page fields:** allergen_statement: "Fragrance-free. Made in a facility that also handles tree nuts."

**Bea asked:**

> is this actually nut free or was it made near nuts? my daughter has a severe nut allergy so I'm being extra careful with every single product

**Drafted reply:**

> Hi Bea, thanks for reaching out!
>
> Please also note that the product page says: "Made in a facility that also handles tree nuts."
>
> I'll check with the shop and get back to you.
>
> Thanks!

**What the pipeline did:**

- *Is this product nut-free, and was it made near nuts?* → shop to check
  - ✓ quoted `allergen_statement`: "Made in a facility that also handles tree nuts."
  - Held back: Second-pass review: not_supported
- ✓ Every quote was found on the product page (1 of 1 quotes verified)
- ✓ Ingredient answers match the ingredient dictionary (nut: not on the list)
- ✓ Ingredient names include a plain-English name (OK)
- ⚠ Second-pass review found every answer supported by the page
- ✓ Facility allergen warning included (Added to the reply)

## Q-064 · `DSP-004` Calendula Healing Balm Light

- **Category:** ingredient · **answerable_from_page (CSV):** true · **Draft status:** Answered from page
- **Relevant page fields:** allergen_statement: "Made in a facility that also handles tree nuts."

**Dana asked:**

> hey does this balm have beeswax in it? i always check the label for beeswax because my skin reacts to some wax based stuff, so just wondering if its in there

**Drafted reply:**

> Hi Dana, thanks for reaching out!
>
> Yes, beeswax is in this balm. It appears in the ingredient list as "Cera Alba (Beeswax)". Since you mentioned your skin reacts to some waxes, I also want to flag the page's facility note: "Made in a facility that also handles tree nuts."
>
> Thanks!

**What the pipeline did:**

- *Does this balm contain beeswax? (shopper's skin reacts to some wax-based products)* → answered from page
  - ✓ quoted `ingredient_list`: "Cera Alba (Beeswax)"
  - ✓ quoted `allergen_statement`: "Made in a facility that also handles tree nuts."
- ✓ Every quote was found on the product page (2 of 2 quotes verified)
- ✓ Ingredient names include a plain-English name (OK)
- ✓ Second-pass review found every answer supported by the page (1 answer(s) reviewed)
- ✓ Facility allergen warning included (Included in the answer)
