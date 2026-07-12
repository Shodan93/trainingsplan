// KI-Kalorienschätzung mit Rückfragen: Freitext → bei unklaren Mengen GENAU EINE
// kurze Rückfrage (max. 2 Runden), dann strukturierte Items mit kcal & Makros.
// API-Key liegt serverseitig in app_secrets (kein Client-Zugriff).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SYSTEM = `Du bist ein Ernährungs-Assistent einer deutschen Fitness-App.
Der Nutzer beschreibt frei, was er gegessen hat (oft Restaurant-Gerichte ohne genaue Mengen).
Deine Aufgabe: realistische Kalorien und Makros schätzen (Portionsgrößen Deutschland/Österreich,
Restaurantessen eher großzügig mit Fett kalkulieren).

Vorgehen:
- Wenn eine Mengenangabe fehlt UND sie die Schätzung stark verändern würde (z. B. kleines vs.
  großes Bier, 1 vs. 3 Knödel, Beilagenteller vs. Hauptgericht), stelle über das Tool 'rueckfrage'
  GENAU EINE kurze, konkrete Rückfrage (gerne mit 2–3 Auswahloptionen im Text).
- Maximal 2 Rückfragen im gesamten Gespräch. Danach, oder wenn die Beschreibung klar genug ist,
  gib die Schätzung über das Tool 'kalorien_schaetzung' ab – mit typischen Portionsgrößen für alles Unklare.
- Zerlege in einzelne Positionen (z. B. Schweinebraten ~250 g, 2 Semmelknödel, Soße, 0,5 l Bier).`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405)
  try {
    const body = await req.json()
    // Konversation: [{role:'user'|'assistant', content:string}, ...] – Rückfragen-Runden
    const raw = Array.isArray(body.messages) ? body.messages
      : typeof body.question === 'string' ? [{ role: 'user', content: body.question }] : null
    if (!raw || raw.length === 0 || raw.length > 12) return json({ error: 'Ungültige Anfrage.' }, 400)
    const messages = raw.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').slice(0, 2000)
    })).filter((m: { content: string }) => m.content.trim())
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'Ungültige Anfrage.' }, 400)
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'anthropic_api_key').single()
    if (!secret?.value) return json({ error: 'Kein API-Key hinterlegt.' }, 500)

    // Nach 2 Rückfragen (= 2 assistant-Nachrichten) Schätzung erzwingen
    const askedTwice = messages.filter((m: { role: string }) => m.role === 'assistant').length >= 2

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': secret.value,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM,
        tools: [
          {
            name: 'rueckfrage',
            description: 'Kurze Rückfrage zu unklaren Mengen stellen (nur wenn es die Schätzung deutlich verbessert)',
            input_schema: {
              type: 'object',
              properties: { frage: { type: 'string', description: 'Eine kurze, konkrete Frage auf Deutsch' } },
              required: ['frage']
            }
          },
          {
            name: 'kalorien_schaetzung',
            description: 'Finale strukturierte Kalorienschätzung zurückgeben',
            input_schema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Position inkl. geschätzter Menge, z. B. "Schweinebraten (~250 g)"' },
                      kcal: { type: 'number' },
                      protein_g: { type: 'number' },
                      carbs_g: { type: 'number' },
                      fat_g: { type: 'number' }
                    },
                    required: ['name', 'kcal', 'protein_g', 'carbs_g', 'fat_g']
                  }
                },
                note: { type: 'string', description: 'Kurzer Hinweis zur Schätzunsicherheit (1 Satz, Deutsch)' }
              },
              required: ['items', 'note']
            }
          }
        ],
        tool_choice: askedTwice ? { type: 'tool', name: 'kalorien_schaetzung' } : { type: 'any' },
        messages
      })
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('anthropic error', res.status, err)
      return json({ error: 'KI-Anfrage fehlgeschlagen. Bitte später erneut versuchen.' }, 502)
    }
    const data = await res.json()
    const tool = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    if (tool?.name === 'rueckfrage' && tool.input?.frage) {
      return json({ type: 'question', question: String(tool.input.frage) })
    }
    if (tool?.name === 'kalorien_schaetzung' && tool.input?.items?.length) {
      return json({ type: 'estimate', ...tool.input })
    }
    return json({ error: 'Keine Schätzung erhalten.' }, 502)
  } catch (e) {
    console.error(e)
    return json({ error: 'Unerwarteter Fehler.' }, 500)
  }
})
