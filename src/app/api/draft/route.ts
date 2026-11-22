import { z } from "zod";
import { getProduct } from "@/lib/catalog";
import { draftReply } from "@/lib/draft";
import { QuotaExhaustedError } from "@/lib/quota";

const body = z.object({
  productId: z.string(),
  message: z.string().trim().min(1).max(2000),
  shopperName: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send a productId and a message." }, { status: 400 });

  const product = getProduct(parsed.data.productId);
  if (!product) return Response.json({ error: `Unknown product ${parsed.data.productId}.` }, { status: 404 });

  try {
    const result = await draftReply({ product, message: parsed.data.message, shopperName: parsed.data.shopperName });
    return Response.json(result);
  } catch (e) {
    if (e instanceof QuotaExhaustedError) {
      return Response.json({ error: e.message, quota: e.quota }, { status: 429 });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("draft failed:", message);
    const rateLimited = /rate.?limit|429|too many/i.test(message);
    return Response.json(
      {
        error: rateLimited
          ? "The free models are busy right now. Wait a minute and try again. Nothing was sent to the shopper."
          : "The draft couldn't be generated. Nothing was sent to the shopper.",
      },
      { status: rateLimited ? 429 : 502 },
    );
  }
}
