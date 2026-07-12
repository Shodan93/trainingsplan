// Lebensmittel-Textsuche serverseitig (Browser-CORS/Rate-Limits umgehen).
// Primär Search-a-licious, Fallback klassische cgi-Suche von Open Food Facts.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const UA = 'trainingsplan-mumelter/1.0 (kontakt: d@mumelter.de)'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Product = {
  code: string; name: string; brand: string | null
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null
  image: string | null
}

function mapProduct(p: Record<string, unknown>): Product {
  const n = (p.nutriments ?? {}) as Record<string, number | undefined>
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g']! / 4.184 : null)
  return {
    code: String(p.code ?? ''),
    name: (p.product_name as string) || (p.generic_name as string) || 'Unbekanntes Produkt',
    brand: (p.brands as string) || null,
    kcal100: kcal != null ? Math.round(kcal) : null,
    protein100: n.proteins_100g ?? null,
    carbs100: n.carbohydrates_100g ?? null,
    fat100: n.fat_100g ?? null,
    image: (p.image_front_small_url as string) || (p.image_small_url as string) || (p.image_front_url as string) || null
  }
}

async function searchSaL(q: string): Promise<Product[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=de,en&page_size=20`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`sal ${res.status}`)
  const j = await res.json()
  return ((j.hits ?? []) as Record<string, unknown>[]).map(mapProduct)
}

async function searchCgi(q: string): Promise<Product[]> {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + `?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20`
    + '&fields=code,product_name,generic_name,brands,image_front_small_url,image_small_url,nutriments'
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`cgi ${res.status}`)
  const j = await res.json()
  return ((j.products ?? []) as Record<string, unknown>[]).map(mapProduct)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405)
  try {
    const { query } = await req.json()
    if (typeof query !== 'string' || !query.trim() || query.length > 200) {
      return json({ error: 'Ungültige Suche.' }, 400)
    }
    let products: Product[] = []
    try { products = await searchSaL(query.trim()) } catch (e) { console.error('sal failed', e) }
    if (!products.length) {
      try { products = await searchCgi(query.trim()) } catch (e) { console.error('cgi failed', e) }
    }
    return json({ products: products.filter(p => p.kcal100 != null).slice(0, 20) })
  } catch (e) {
    console.error(e)
    return json({ error: 'Suche fehlgeschlagen.' }, 500)
  }
})
