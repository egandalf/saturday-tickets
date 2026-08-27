import { dealSaturday } from "@/lib/deal";

export async function GET() {
  const tickets = await dealSaturday();
  return Response.json({ tickets });
}
