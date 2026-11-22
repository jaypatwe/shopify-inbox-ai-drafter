import { getFreeQuota } from "@/lib/quota";

/** Remaining free-model requests today. Reading it does not use up a request. */
export async function GET() {
  return Response.json({ quota: await getFreeQuota() });
}
