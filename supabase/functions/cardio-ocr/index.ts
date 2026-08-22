// Cardio-OCR: Foto vom Display eines Cardio-Geräts (Treppensteiger, Laufband, …)
// → Claude Vision liest die Werte aus und gibt sie strukturiert zurück.
// API-Key liegt serverseitig in app_secrets (kein Client-Zugriff).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SYSTEM = `Du liest das Display eines Cardio-Geräts im Fitnessstudio ab (Foto vom Nutzer).
Extrahiere NUR Werte, die wirklich ablesbar sind – nichts schätzen oder erfinden.
Achte auf die Einheiten neben den Zahlen (kcal, min:sec, floors, watts, spm, rpm, km, km/h, beats/min, LEVEL).
"MOVEs" o. ä. Marketing-Werte ignorieren. Ein leeres oder "–"-Feld bedeutet: Wert weglassen.
Dauer: min:sec in Sekunden umrechnen (24:27 → 1467). Wenn ein GOAL/Ziel und eine laufende
Dauer sichtbar sind, nimm die tatsächliche Dauer, nicht das Ziel.
Gerätetyp erkennen, wenn möglich (z. B. floors/Etagen → Treppensteiger; Steigung+km/h → Laufband;
Watt+rpm → Ergometer/Bike; 500m-Split → Rudergerät).`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405)
  try {
    const { image, media_type } = await req.json()
    if (typeof image !== 'string' || image.length < 100) return json({ error: 'Kein Bild erhalten.' }, 400)
    if (image.length > 7_000_000) return json({ error: 'Bild zu groß – bitte erneut versuchen.' }, 413)
    const mt = ['image/jpeg', 'image/png', 'image/webp'].includes(media_type) ? media_type : 'image/jpeg'

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'anthropic_api_key').single()
    if (!secret?.value) return json({ error: 'Kein API-Key hinterlegt.' }, 500)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': secret.value,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: SYSTEM,
        tools: [{
          name: 'cardio_werte',
          description: 'Vom Display abgelesene Werte strukturiert zurückgeben',
          input_schema: {
            type: 'object',
            properties: {
              machine_guess: {
                type: 'string',
                description: 'Erkannter Gerätetyp auf Deutsch, z. B. "Treppensteiger", "Laufband", "Ergometer", "Rudergerät", "Crosstrainer" – weglassen wenn unklar'
              },
              duration_seconds: { type: 'number', description: 'Trainingsdauer in Sekunden' },
              calories: { type: 'number', description: 'Kalorien (kcal)' },
              distance_km: { type: 'number', description: 'Distanz in km' },
              floors: { type: 'number', description: 'Etagen/Floors (Treppensteiger)' },
              level: { type: 'number', description: 'Widerstands-/Level-Stufe' },
              avg_watts: { type: 'number', description: 'Leistung in Watt' },
              avg_hr: { type: 'number', description: 'Herzfrequenz (beats/min), falls angezeigt' },
              cadence: { type: 'number', description: 'Kadenz (spm bzw. rpm)' },
              speed_kmh: { type: 'number', description: 'Geschwindigkeit in km/h' },
              incline_pct: { type: 'number', description: 'Steigung in %' },
              note: { type: 'string', description: 'Kurzer Hinweis, falls etwas unklar/nicht ablesbar war (1 Satz, Deutsch)' }
            }
          }
        }],
        tool_choice: { type: 'tool', name: 'cardio_werte' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
            { type: 'text', text: 'Lies die Trainingswerte von diesem Gerätedisplay ab.' }
          ]
        }]
      })
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('anthropic error', res.status, err)
      return json({ error: 'KI-Anfrage fehlgeschlagen. Bitte später erneut versuchen.' }, 502)
    }
    const data = await res.json()
    const tool = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    if (tool?.name === 'cardio_werte' && tool.input && typeof tool.input === 'object') {
      return json({ type: 'values', ...tool.input })
    }
    return json({ error: 'Keine Werte erkannt – bitte manuell eintragen.' }, 502)
  } catch (e) {
    console.error(e)
    return json({ error: 'Unerwarteter Fehler.' }, 500)
  }
})
