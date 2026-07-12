// MCP-Server für die Fitness-App: Claude kann per Chat den Trainingsplan,
// Kalorien, Mahlzeiten und Gewicht für David & Svenja steuern.
// Transport: Streamable HTTP (JSON-Antworten). Auth: ?key=<mcp_key aus app_secrets>.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

type Json = Record<string, unknown>
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

// ---------- Helpers ----------
const berlinDate = (d = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)

function resolveDay(day?: string): string {
  if (!day || /^heute$|^today$/i.test(day)) return berlinDate()
  if (/^gestern$/i.test(day)) return berlinDate(new Date(Date.now() - 86400000))
  if (/^morgen$/i.test(day)) return berlinDate(new Date(Date.now() + 86400000))
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
  throw new Error(`Ungültiges Datum "${day}" – nutze YYYY-MM-DD, "heute", "gestern" oder "morgen".`)
}

async function resolveUser(name: unknown): Promise<{ id: string; display_name: string }> {
  const { data } = await admin.from('profiles').select('id, display_name')
  const all = data ?? []
  const q = String(name ?? '').trim().toLowerCase()
  const hit = all.find(p => p.display_name.toLowerCase().startsWith(q))
  if (!q || !hit) throw new Error(`Nutzer unklar – verfügbar: ${all.map(p => p.display_name).join(', ')}. Bitte "user" angeben.`)
  return hit
}

async function getActivePlan(uid: string) {
  const { data } = await admin.from('plans').select('id, name').eq('owner_id', uid).eq('is_active', true).limit(1)
  if (!data?.length) throw new Error('Kein aktiver Plan gefunden.')
  return data[0]
}

type Ex = {
  id: string; plan_day_id: string; name: string; muscle_group: string | null
  sets: number; rep_min: number | null; rep_max: number | null
  target_weight: number | null; technique: string | null; sort_order: number
}
type Day = { id: string; weekday: string; title: string; sort_order: number }

async function loadPlan(uid: string) {
  const plan = await getActivePlan(uid)
  const { data: days } = await admin.from('plan_days')
    .select('id, weekday, title, sort_order').eq('plan_id', plan.id).order('sort_order')
  const dayIds = (days ?? []).map(d => d.id)
  const { data: exs } = await admin.from('plan_exercises')
    .select('id, plan_day_id, name, muscle_group, sets, rep_min, rep_max, target_weight, technique, sort_order')
    .in('plan_day_id', dayIds).order('sort_order')
  return { plan, days: (days ?? []) as Day[], exs: (exs ?? []) as Ex[] }
}

function matchDay(days: Day[], q: string): Day {
  const s = q.trim().toLowerCase()
  const hits = days.filter(d => d.weekday.toLowerCase() === s || d.title.toLowerCase().includes(s) || `${d.weekday} ${d.title}`.toLowerCase().includes(s))
  if (hits.length === 1) return hits[0]
  throw new Error(`Tag "${q}" nicht eindeutig – verfügbar: ${days.map(d => `${d.weekday} (${d.title})`).join(', ')}`)
}

// Übungen fuzzy nach Name (+ optional Tag) finden. Mehrere Treffer mit
// identischem Namen (gleiche Übung an mehreren Tagen) sind OK → alle.
function matchExercises(exs: Ex[], days: Day[], exercise: string, day?: string): Ex[] {
  let pool = exs
  if (day) { const d = matchDay(days, day); pool = exs.filter(e => e.plan_day_id === d.id) }
  const q = exercise.trim().toLowerCase()
  let hits = pool.filter(e => e.name.toLowerCase() === q)
  if (!hits.length) hits = pool.filter(e => e.name.toLowerCase().includes(q))
  if (!hits.length) throw new Error(`Übung "${exercise}" nicht gefunden. Vorhanden: ${[...new Set(pool.map(e => e.name))].join(', ')}`)
  const names = new Set(hits.map(h => h.name))
  if (names.size > 1) throw new Error(`"${exercise}" ist mehrdeutig: ${[...names].join(' | ')} – bitte genauer benennen.`)
  return hits
}

const dayLabel = (days: Day[], id: string) => {
  const d = days.find(x => x.id === id)
  return d ? `${d.weekday} · ${d.title}` : '?'
}
const repRange = (e: Ex) => e.rep_min != null && e.rep_max != null ? `${e.rep_min}–${e.rep_max}` : '–'
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const sum = (xs: (number | null | undefined)[]) => xs.reduce((a: number, b) => a + (Number(b) || 0), 0)

// Kalorienziel wie in der App (Mifflin-St-Jeor + NEAT + echte Trainingslast + Ziel-Rate)
async function calorieTargetFor(uid: string): Promise<number | null> {
  const { data: st } = await admin.from('settings').select('*').eq('user_id', uid).single()
  if (!st) return null
  if (st.calorie_override != null) return st.calorie_override
  const { data: w } = await admin.from('weight_logs').select('weight').eq('user_id', uid).order('measured_at', { ascending: false }).limit(1)
  const weight = w?.[0] ? Number(w[0].weight) : null
  if (!st.birth_year || !st.height_cm || !weight) return null
  const age = new Date().getFullYear() - st.birth_year
  const bmr = Math.round(10 * weight + 6.25 * Number(st.height_cm) - 5 * age + (st.sex === 'f' ? -161 : 5))
  const since = new Date(Date.now() - 28 * 86400000).toISOString()
  const { data: ss } = await admin.from('workout_sessions').select('duration_seconds,total_volume')
    .eq('user_id', uid).not('completed_at', 'is', null).gte('completed_at', since)
  const durs = (ss ?? []).map(s => (s.duration_seconds ?? 0) / 60).filter(v => v >= 15 && v <= 240)
  const tons = (ss ?? []).map(s => Number(s.total_volume) || 0).filter(v => v > 0)
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  let wpw = st.planned_workouts
  if (wpw == null) {
    const plan = await admin.from('plans').select('id').eq('owner_id', uid).eq('is_active', true).limit(1)
    if (plan.data?.length) {
      const { count } = await admin.from('plan_days').select('id', { count: 'exact', head: true }).eq('plan_id', plan.data[0].id)
      wpw = count ?? 0
    } else wpw = Math.round((ss?.length ?? 0) / 4)
  }
  const link = st.calorie_training_link ? Math.min(wpw ?? 0, 7) : 0
  const dur = avg(durs) ?? 60, ton = avg(tons) ?? 0
  const perSession = link > 0 ? Math.round((dur * 0.0613 * weight + ton * 0.008) * 1.07) : 0
  const tdee = bmr + Math.round(bmr * 0.35) + Math.round(perSession * link / 7)
  const rate: Record<string, number> = { cut: -0.5, lose: -0.75, maintain: 0, lean_bulk: 0.2 }
  const adjust = Math.round(weight * (rate[st.goal_type ?? 'maintain'] ?? 0) / 100 * 7700 / 7)
  return Math.max(bmr, tdee + adjust)
}

// ---------- Tools ----------
const USER = { type: 'string', description: 'Für wen? "david" oder "svenja". Im Zweifel nachfragen.' }
const DAY = { type: 'string', description: 'Datum YYYY-MM-DD oder "heute"/"gestern"/"morgen" (Standard: heute)' }

const TOOLS = [
  {
    name: 'get_overview',
    description: 'Überblick für einen Nutzer: Gewicht & Trend, Kalorien heute vs. Ziel, Trainings diese Woche, aktiver Plan.',
    inputSchema: { type: 'object', properties: { user: USER }, required: ['user'] }
  },
  {
    name: 'get_plan',
    description: 'Den aktiven Trainingsplan mit allen Tagen und Übungen anzeigen (Sätze, Wiederholungsbereich, Gewicht, Technik).',
    inputSchema: { type: 'object', properties: { user: USER }, required: ['user'] }
  },
  {
    name: 'update_exercise',
    description: 'Übung im aktiven Plan ändern oder austauschen. Zum Austauschen new_name setzen (z. B. Hip Thrust → Glute Drive); ohne Tag-Angabe wird die Übung an ALLEN Tagen mit gleichem Namen geändert.',
    inputSchema: {
      type: 'object',
      properties: {
        user: USER,
        exercise: { type: 'string', description: 'Aktueller Übungsname (Teilstring reicht)' },
        day: { type: 'string', description: 'Optional: Wochentag (Mo/Mi/Fr/So) oder Titel-Teil, um nur einen Tag zu ändern' },
        new_name: { type: 'string', description: 'Neuer Name (Übung austauschen)' },
        sets: { type: 'integer' },
        rep_min: { type: 'integer' },
        rep_max: { type: 'integer' },
        target_weight: { type: 'number', description: 'Arbeitsgewicht in kg' },
        technique: { type: 'string', description: 'Technik-/Ausführungshinweis' },
        muscle_group: { type: 'string', description: 'z. B. push, pull, legs, glutes, core, arms, shoulders, calves, cardio' }
      },
      required: ['user', 'exercise']
    }
  },
  {
    name: 'add_exercise',
    description: 'Neue Übung zu einem Plan-Tag hinzufügen.',
    inputSchema: {
      type: 'object',
      properties: {
        user: USER,
        day: { type: 'string', description: 'Wochentag (Mo/Mi/Fr/So) oder Titel-Teil' },
        name: { type: 'string' },
        sets: { type: 'integer' },
        rep_min: { type: 'integer' },
        rep_max: { type: 'integer' },
        target_weight: { type: 'number' },
        muscle_group: { type: 'string' },
        technique: { type: 'string' }
      },
      required: ['user', 'day', 'name', 'sets', 'rep_min', 'rep_max']
    }
  },
  {
    name: 'remove_exercise',
    description: 'Übung aus dem aktiven Plan entfernen (ohne Tag-Angabe: an allen Tagen mit diesem Namen).',
    inputSchema: {
      type: 'object',
      properties: { user: USER, exercise: { type: 'string' }, day: { type: 'string' } },
      required: ['user', 'exercise']
    }
  },
  {
    name: 'log_calories',
    description: 'Kalorien direkt eintragen (eine Position, Makros optional).',
    inputSchema: {
      type: 'object',
      properties: {
        user: USER, kcal: { type: 'number' },
        label: { type: 'string', description: 'Bezeichnung, z. B. "Mittagessen"' },
        protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
        day: DAY
      },
      required: ['user', 'kcal']
    }
  },
  {
    name: 'log_ingredients',
    description: 'Mehrere Zutaten/Positionen als EINEN Kalorien-Eintrag loggen (z. B. beim Kochen: 500 ml Sahne + 400 g Hähnchen). Kalorien & Makros pro Zutat selbst recherchieren/schätzen und mitgeben. Optional als Mahlzeit speichern.',
    inputSchema: {
      type: 'object',
      properties: {
        user: USER,
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Zutat inkl. Menge, z. B. "Sahne (500 ml)"' },
              kcal: { type: 'number' },
              protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
              amount_g: { type: 'number' }
            },
            required: ['name', 'kcal']
          }
        },
        label: { type: 'string', description: 'Name des Gerichts, z. B. "Hähnchen-Sahne-Pfanne"' },
        portion: { type: 'number', description: 'Gegessener Anteil 0–1 (z. B. 0.5 wenn nur die Hälfte gegessen wurde). Standard 1.' },
        day: DAY,
        save_as_meal: { type: 'boolean', description: 'true = zusätzlich als wiederverwendbare Mahlzeit speichern' }
      },
      required: ['user', 'ingredients']
    }
  },
  {
    name: 'get_calories',
    description: 'Kalorien-Einträge eines Tages mit Summe, Makros und Ziel anzeigen.',
    inputSchema: { type: 'object', properties: { user: USER, day: DAY }, required: ['user'] }
  },
  {
    name: 'list_meals',
    description: 'Gespeicherte Mahlzeiten des Nutzers auflisten.',
    inputSchema: { type: 'object', properties: { user: USER }, required: ['user'] }
  },
  {
    name: 'log_saved_meal',
    description: 'Eine gespeicherte Mahlzeit als Kalorien-Eintrag loggen.',
    inputSchema: {
      type: 'object',
      properties: { user: USER, meal: { type: 'string', description: 'Name der Mahlzeit (Teilstring reicht)' }, day: DAY },
      required: ['user', 'meal']
    }
  },
  {
    name: 'log_weight',
    description: 'Körpergewicht eintragen.',
    inputSchema: {
      type: 'object',
      properties: { user: USER, kg: { type: 'number' }, day: DAY },
      required: ['user', 'kg']
    }
  },
  {
    name: 'get_weight',
    description: 'Aktuelles Gewicht, Trend und letzte Einträge anzeigen.',
    inputSchema: { type: 'object', properties: { user: USER }, required: ['user'] }
  },
  {
    name: 'list_workouts',
    description: 'Letzte abgeschlossene Trainings anzeigen (Titel, Datum, Dauer, Volumen).',
    inputSchema: { type: 'object', properties: { user: USER, limit: { type: 'integer', description: 'Standard 10' } }, required: ['user'] }
  }
]

// ---------- Tool-Implementierungen ----------
async function callTool(name: string, args: Json): Promise<string> {
  const u = await resolveUser(args.user)

  switch (name) {
    case 'get_overview': {
      const today = berlinDate()
      const [{ data: wl }, { data: cl }, target] = await Promise.all([
        admin.from('weight_logs').select('weight, measured_at').eq('user_id', u.id).order('measured_at', { ascending: false }).limit(10),
        admin.from('calorie_logs').select('kcal').eq('user_id', u.id).eq('day', today),
        calorieTargetFor(u.id)
      ])
      const monday = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return berlinDate(d) })()
      const { count: week } = await admin.from('workout_sessions').select('id', { count: 'exact', head: true })
        .eq('user_id', u.id).not('completed_at', 'is', null).gte('completed_at', monday + 'T00:00:00+02:00')
      const { plan, days } = await loadPlan(u.id)
      const eaten = Math.round(sum((cl ?? []).map(c => c.kcal)))
      return [
        `Überblick ${u.display_name}:`,
        wl?.length ? `• Gewicht: ${Number(wl[0].weight).toFixed(1)} kg (${new Date(wl[0].measured_at).toLocaleDateString('de-DE')})` : '• Gewicht: keine Einträge',
        `• Kalorien heute: ${eaten}${target ? ` / ${target} kcal (übrig ${target - eaten})` : ' kcal (kein Ziel berechenbar)'}`,
        `• Trainings diese Woche: ${week ?? 0}`,
        `• Aktiver Plan: ${plan.name} (${days.map(d => d.weekday).join(', ')})`
      ].join('\n')
    }

    case 'get_plan': {
      const { plan, days, exs } = await loadPlan(u.id)
      const lines = [`Plan "${plan.name}" von ${u.display_name}:`]
      for (const d of days) {
        lines.push(`\n${d.weekday} · ${d.title}`)
        exs.filter(e => e.plan_day_id === d.id).forEach(e => {
          lines.push(`  – ${e.name}: ${e.sets}×${repRange(e)}${e.target_weight != null ? ` @ ${e.target_weight} kg` : ''}${e.muscle_group ? ` [${e.muscle_group}]` : ''}${e.technique ? ` · ${e.technique}` : ''}`)
        })
      }
      return lines.join('\n')
    }

    case 'update_exercise': {
      const { days, exs } = await loadPlan(u.id)
      const hits = matchExercises(exs, days, String(args.exercise), args.day as string | undefined)
      const patch: Json = {}
      if (args.new_name) patch.name = String(args.new_name)
      if (args.sets != null) patch.sets = Math.round(Number(args.sets))
      if (args.rep_min != null) patch.rep_min = Math.round(Number(args.rep_min))
      if (args.rep_max != null) patch.rep_max = Math.round(Number(args.rep_max))
      if (args.target_weight != null) patch.target_weight = num(args.target_weight)
      if (args.technique != null) patch.technique = String(args.technique)
      if (args.muscle_group != null) patch.muscle_group = String(args.muscle_group)
      if (!Object.keys(patch).length) throw new Error('Nichts zu ändern angegeben.')
      const { error } = await admin.from('plan_exercises').update(patch).in('id', hits.map(h => h.id))
      if (error) throw new Error(error.message)
      const where = hits.map(h => dayLabel(days, h.plan_day_id)).join(', ')
      return `✓ "${hits[0].name}"${args.new_name ? ` → "${args.new_name}"` : ''} geändert (${Object.keys(patch).join(', ')}) an: ${where}`
    }

    case 'add_exercise': {
      const { days, exs } = await loadPlan(u.id)
      const d = matchDay(days, String(args.day))
      const maxSort = Math.max(0, ...exs.filter(e => e.plan_day_id === d.id).map(e => e.sort_order))
      const { error } = await admin.from('plan_exercises').insert({
        plan_day_id: d.id, name: String(args.name),
        sets: Math.round(Number(args.sets)), rep_min: Math.round(Number(args.rep_min)), rep_max: Math.round(Number(args.rep_max)),
        target_weight: num(args.target_weight), muscle_group: args.muscle_group ? String(args.muscle_group) : null,
        technique: args.technique ? String(args.technique) : null, sort_order: maxSort + 1
      })
      if (error) throw new Error(error.message)
      return `✓ "${args.name}" (${args.sets}×${args.rep_min}–${args.rep_max}) zu ${d.weekday} · ${d.title} hinzugefügt.`
    }

    case 'remove_exercise': {
      const { days, exs } = await loadPlan(u.id)
      const hits = matchExercises(exs, days, String(args.exercise), args.day as string | undefined)
      const { error } = await admin.from('plan_exercises').delete().in('id', hits.map(h => h.id))
      if (error) throw new Error(error.message)
      return `✓ "${hits[0].name}" entfernt von: ${hits.map(h => dayLabel(days, h.plan_day_id)).join(', ')}`
    }

    case 'log_calories': {
      const day = resolveDay(args.day as string | undefined)
      const kcal = Math.round(Number(args.kcal))
      if (!Number.isFinite(kcal) || kcal <= 0) throw new Error('kcal muss > 0 sein.')
      const { error } = await admin.from('calorie_logs').insert({
        user_id: u.id, day, kcal, label: args.label ? String(args.label) : null, source: 'ai',
        protein_g: num(args.protein_g), carbs_g: num(args.carbs_g), fat_g: num(args.fat_g)
      })
      if (error) throw new Error(error.message)
      const target = await calorieTargetFor(u.id)
      const { data: cl } = await admin.from('calorie_logs').select('kcal').eq('user_id', u.id).eq('day', day)
      const total = Math.round(sum((cl ?? []).map(c => c.kcal)))
      return `✓ ${kcal} kcal für ${u.display_name} am ${day} eingetragen. Tagesstand: ${total}${target ? ` / ${target} kcal` : ' kcal'}.`
    }

    case 'log_ingredients': {
      const day = resolveDay(args.day as string | undefined)
      const ing = (args.ingredients as Json[] | undefined) ?? []
      if (!ing.length) throw new Error('Keine Zutaten angegeben.')
      const portion = args.portion != null ? Number(args.portion) : 1
      if (!(portion > 0 && portion <= 1)) throw new Error('portion muss zwischen 0 und 1 liegen.')
      const items = ing.map(i => ({
        name: String(i.name), amount_g: num(i.amount_g),
        kcal: Math.round(Number(i.kcal)),
        protein_g: num(i.protein_g), carbs_g: num(i.carbs_g), fat_g: num(i.fat_g)
      }))
      const tot = {
        kcal: Math.round(sum(items.map(i => i.kcal)) * portion),
        p: Math.round(sum(items.map(i => i.protein_g)) * portion * 10) / 10,
        c: Math.round(sum(items.map(i => i.carbs_g)) * portion * 10) / 10,
        f: Math.round(sum(items.map(i => i.fat_g)) * portion * 10) / 10
      }
      const label = args.label ? String(args.label) : items.map(i => i.name).join(', ').slice(0, 120)
      const { error } = await admin.from('calorie_logs').insert({
        user_id: u.id, day, kcal: tot.kcal, label: portion < 1 ? `${label} (${Math.round(portion * 100)} %)` : label,
        source: 'ai', protein_g: tot.p || null, carbs_g: tot.c || null, fat_g: tot.f || null
      })
      if (error) throw new Error(error.message)
      let mealNote = ''
      if (args.save_as_meal) {
        const fullKcal = Math.round(sum(items.map(i => i.kcal)))
        const { error: me } = await admin.from('meals').insert({
          user_id: u.id, name: args.label ? String(args.label) : label.slice(0, 60), kcal: fullKcal,
          protein_g: Math.round(sum(items.map(i => i.protein_g)) * 10) / 10 || null,
          carbs_g: Math.round(sum(items.map(i => i.carbs_g)) * 10) / 10 || null,
          fat_g: Math.round(sum(items.map(i => i.fat_g)) * 10) / 10 || null,
          items
        })
        mealNote = me ? ` (Mahlzeit speichern fehlgeschlagen: ${me.message})` : ' Zusätzlich als Mahlzeit gespeichert.'
      }
      return `✓ "${label}" mit ${tot.kcal} kcal (P ${tot.p} · KH ${tot.c} · F ${tot.f} g) für ${u.display_name} am ${day} eingetragen.${mealNote}`
    }

    case 'get_calories': {
      const day = resolveDay(args.day as string | undefined)
      const [{ data: cl }, target] = await Promise.all([
        admin.from('calorie_logs').select('kcal, label, product_name, protein_g, carbs_g, fat_g, logged_at').eq('user_id', u.id).eq('day', day).order('logged_at'),
        calorieTargetFor(u.id)
      ])
      const logs = cl ?? []
      if (!logs.length) return `${u.display_name} hat am ${day} noch nichts eingetragen.${target ? ` Ziel: ${target} kcal.` : ''}`
      const total = Math.round(sum(logs.map(l => l.kcal)))
      const lines = logs.map(l => `  – ${l.product_name ?? l.label ?? 'Eintrag'}: ${Math.round(Number(l.kcal))} kcal`)
      return [
        `Kalorien ${u.display_name} am ${day}:`, ...lines,
        `Gesamt: ${total}${target ? ` / ${target} kcal (übrig ${target - total})` : ' kcal'}`,
        `Makros: P ${Math.round(sum(logs.map(l => l.protein_g)))} · KH ${Math.round(sum(logs.map(l => l.carbs_g)))} · F ${Math.round(sum(logs.map(l => l.fat_g)))} g`
      ].join('\n')
    }

    case 'list_meals': {
      const { data } = await admin.from('meals').select('name, kcal, items').eq('user_id', u.id).order('created_at', { ascending: false })
      if (!data?.length) return `${u.display_name} hat noch keine gespeicherten Mahlzeiten.`
      return `Mahlzeiten von ${u.display_name}:\n` + data.map(m => `  – ${m.name}: ${Math.round(Number(m.kcal))} kcal (${(m.items as Json[]).length} Zutaten)`).join('\n')
    }

    case 'log_saved_meal': {
      const day = resolveDay(args.day as string | undefined)
      const { data } = await admin.from('meals').select('*').eq('user_id', u.id)
      const q = String(args.meal ?? '').toLowerCase()
      const hits = (data ?? []).filter(m => m.name.toLowerCase().includes(q))
      if (!hits.length) throw new Error(`Mahlzeit "${args.meal}" nicht gefunden. Vorhanden: ${(data ?? []).map(m => m.name).join(', ') || 'keine'}`)
      if (hits.length > 1) throw new Error(`Mehrdeutig: ${hits.map(m => m.name).join(' | ')}`)
      const m = hits[0]
      const { error } = await admin.from('calorie_logs').insert({
        user_id: u.id, day, kcal: Math.round(Number(m.kcal)), label: m.name, source: 'meal',
        protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, image_url: m.image_url
      })
      if (error) throw new Error(error.message)
      return `✓ Mahlzeit "${m.name}" (${Math.round(Number(m.kcal))} kcal) für ${u.display_name} am ${day} eingetragen.`
    }

    case 'log_weight': {
      const kg = num(args.kg)
      if (kg == null || kg < 20 || kg > 400) throw new Error('kg muss zwischen 20 und 400 liegen.')
      const day = resolveDay(args.day as string | undefined)
      const measured_at = day === berlinDate() ? new Date().toISOString() : `${day}T08:00:00+02:00`
      const { error } = await admin.from('weight_logs').insert({ user_id: u.id, weight: kg, measured_at })
      if (error) throw new Error(error.message)
      return `✓ ${kg.toFixed(1)} kg für ${u.display_name} am ${day} eingetragen.`
    }

    case 'get_weight': {
      const { data } = await admin.from('weight_logs').select('weight, measured_at').eq('user_id', u.id).order('measured_at', { ascending: false }).limit(30)
      if (!data?.length) return `${u.display_name} hat noch keine Gewichtseinträge.`
      // einfacher EMA-Trend über die letzten Einträge (chronologisch)
      let ema: number | null = null
      const chrono = [...data].reverse()
      chrono.forEach(l => { ema = ema == null ? Number(l.weight) : 0.25 * Number(l.weight) + 0.75 * ema })
      const last = data.slice(0, 5).map(l => `  – ${new Date(l.measured_at).toLocaleDateString('de-DE')}: ${Number(l.weight).toFixed(1)} kg`)
      return `Gewicht ${u.display_name}: aktuell ${Number(data[0].weight).toFixed(1)} kg, Trend ${ema!.toFixed(1)} kg\nLetzte Einträge:\n${last.join('\n')}`
    }

    case 'list_workouts': {
      const limit = Math.min(Math.max(Math.round(Number(args.limit ?? 10)), 1), 50)
      const { data } = await admin.from('workout_sessions').select('day_title, completed_at, duration_seconds, total_volume')
        .eq('user_id', u.id).not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(limit)
      if (!data?.length) return `${u.display_name} hat noch keine abgeschlossenen Trainings.`
      return `Letzte Trainings von ${u.display_name}:\n` + data.map(s =>
        `  – ${new Date(s.completed_at!).toLocaleDateString('de-DE')}: ${s.day_title} · ${Math.round((s.duration_seconds ?? 0) / 60)} min · ${Math.round(Number(s.total_volume)).toLocaleString('de-DE')} kg`
      ).join('\n')
    }

    default:
      throw new Error(`Unbekanntes Tool: ${name}`)
  }
}

// ---------- MCP über Streamable HTTP ----------
Deno.serve(async (req) => {
  const url = new URL(req.url)
  // Auth: geheimer Key als Query-Parameter (liegt in app_secrets, nicht im Code)
  const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'mcp_key').single()
  if (!secret?.value || url.searchParams.get('key') !== secret.value) {
    return respond({ error: 'Unauthorized' }, 401)
  }
  if (req.method === 'GET') return new Response(null, { status: 405 })
  if (req.method === 'DELETE') return new Response(null, { status: 200 })
  if (req.method !== 'POST') return respond({ error: 'Nur POST' }, 405)

  let msg: Json
  try { msg = await req.json() } catch { return respond(rpcError(null, -32700, 'Parse error'), 400) }

  const id = (msg as Json).id
  const method = String((msg as Json).method ?? '')
  const params = ((msg as Json).params ?? {}) as Json

  // Notifications (ohne id) → 202 ohne Body
  if (id === undefined && method.startsWith('notifications/')) return new Response(null, { status: 202 })

  try {
    switch (method) {
      case 'initialize':
        return respond(rpcResult(id, {
          protocolVersion: (params.protocolVersion as string) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fitness-app', title: 'Fitness-App (David & Svenja)', version: '1.0.0' },
          instructions: 'Steuert die Fitness-App von David & Svenja: Trainingsplan anpassen (Übungen tauschen/ändern/hinzufügen), Kalorien & Zutaten loggen, Mahlzeiten, Gewicht. Jedes Tool braucht user="david" oder "svenja" – im Zweifel nachfragen. Bei Zutaten (log_ingredients) Kalorien/Makros selbst recherchieren und mitgeben.'
        }))
      case 'ping':
        return respond(rpcResult(id, {}))
      case 'tools/list':
        return respond(rpcResult(id, { tools: TOOLS }))
      case 'tools/call': {
        try {
          const text = await callTool(String(params.name), (params.arguments ?? {}) as Json)
          return respond(rpcResult(id, { content: [{ type: 'text', text }] }))
        } catch (e) {
          return respond(rpcResult(id, { content: [{ type: 'text', text: `Fehler: ${(e as Error).message}` }], isError: true }))
        }
      }
      default:
        return respond(rpcError(id, -32601, `Method not found: ${method}`))
    }
  } catch (e) {
    console.error(e)
    return respond(rpcError(id, -32603, 'Internal error'), 500)
  }
})
