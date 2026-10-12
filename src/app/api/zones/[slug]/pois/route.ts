import { chargerZone } from "@/lib/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/zones/[slug]/pois">) {
  const { slug } = await ctx.params;
  const donnees = await chargerZone(slug);
  if (!donnees) return Response.json({ erreur: "Zone inconnue" }, { status: 404 });
  return Response.json(donnees);
}
