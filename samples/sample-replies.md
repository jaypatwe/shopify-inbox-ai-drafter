# Sample replies

Three shopper questions from `data/questions.csv`, each matched to its product page by `product_id` and drafted by the app's pipeline with `npm run eval Q-013 Q-032 Q-064`.

Model: `baidu/ernie-5.5-flash-preview:free`, a free OpenRouter model. Generated 2026-11-22.

| Question | product_id | Product | answerable_from_page (CSV) | Draft status | Free requests used |
|---|---|---|---|---|---|
| Q-013 | `DSP-036` | Tinted Mineral Sunscreen SPF 30 | false | Shop to check | 1 (draft only) |
| Q-032 | `DSP-027` | Baby Massage Oil | true | Shop to check | 2 (draft + review) |
| Q-064 | `DSP-004` | Calendula Healing Balm Light | true | Answered from page | 2 (draft + review) |

## Q-013 · `DSP-036` Tinted Mineral Sunscreen SPF 30

- **Category:** other · **answerable_from_page (CSV):** false · **Draft status:** Shop to check
- **Allergen statement on the page:** "Made in a facility that also handles tree nuts."

**Yara asked:**

> Do you ship to Canada? And if so how long does shipping usually take? Trying to get a gift there by early December

**Drafted reply:**

> Hi Yara, thanks for reaching out!
>
> I'll check with the shop and get back to you.
>
> Thanks!

**What the pipeline did:**

- *Do you ship to Canada, and how long does shipping usually take (gift needed by early December)?* → shop to check
- ✓ Every quote was found on the product page (0 of 0 quotes verified)
- ✓ Ingredient names include a plain-English name (OK)

## Q-032 · `DSP-027` Baby Massage Oil

- **Category:** allergen · **answerable_from_page (CSV):** true · **Draft status:** Shop to check
- **Allergen statement on the page:** "Fragrance-free. Made in a facility that also handles tree nuts."

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

- *Is this nut free, and was it made near nuts? (daughter has a severe nut allergy)* → shop to check
  - ✓ quoted `allergen_statement`: "Made in a facility that also handles tree nuts."
  - ✓ quoted `ingredient_list`: "Caprylic/Capric Triglyceride"
  - Held back: Second-pass review: The answer states: "None of the listed ingredients is a nut oil or nut extract." This is not stated on the page; it is an inference/general ingredient knowledge. The rest—page doesn't say "nut-free," Caprylic/Capric Triglyceride may be coconut-derived, and the facility handles tree nuts—is supported.
- ✓ Every quote was found on the product page (2 of 2 quotes verified)
- ✓ Ingredient answers match the ingredient dictionary (nuts: not on the list (found by code))
- ✓ Ingredient names include a plain-English name (OK)
- ⚠ Second-pass review found every answer supported by the page
- ✓ Facility allergen warning included (Added to the reply)

## Q-064 · `DSP-004` Calendula Healing Balm Light

- **Category:** ingredient · **answerable_from_page (CSV):** true · **Draft status:** Answered from page
- **Allergen statement on the page:** "Made in a facility that also handles tree nuts."

**Dana asked:**

> hey does this balm have beeswax in it? i always check the label for beeswax because my skin reacts to some wax based stuff, so just wondering if its in there

**Drafted reply:**

> Hi Dana, thanks for reaching out!
>
> Yes, this balm contains Cera Alba (Beeswax). The ingredient list says: "Cera Alba (Beeswax)". It is also made in a facility that also handles tree nuts: "Made in a facility that also handles tree nuts."
>
> Thanks!

**What the pipeline did:**

- *Does this balm have beeswax in it?* → answered from page
  - ✓ quoted `ingredient_list`: "Cera Alba (Beeswax)"
  - ✓ quoted `allergen_statement`: "Made in a facility that also handles tree nuts."
- ✓ Every quote was found on the product page (2 of 2 quotes verified)
- ✓ Ingredient answers match the ingredient dictionary (beeswax: on the list)
- ✓ Ingredient names include a plain-English name (OK)
- ✓ Second-pass review found every answer supported by the page (1 answer(s) reviewed)
- ✓ Facility allergen warning included (Included in the answer)
