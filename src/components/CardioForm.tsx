import { useRef, useState } from 'react'
import { Modal } from './ui'
import { cls, parseNum, fmtDate, fmtDuration } from '../lib/utils'
import {
  CardioSession, CardioMetricKey, CARDIO_METRICS, CARDIO_MACHINES, cardioMachineInfo
} from '../lib/types'
import { addCardioSession, updateCardioSession, deleteCardioSession, cardioOcr, CardioOcrResult } from '../lib/db'

// Foto fürs OCR verkleinern (Kosten/Upload) und als base64 ohne Prefix liefern
async function fileToBase64Jpeg(file: File, maxDim = 1568): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.'))
      i.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
  } finally {
    URL.revokeObjectURL(url)
  }
}

// datetime-local braucht lokale Zeit ohne Zeitzone (toISOString wäre UTC)
function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Kompakte Zeile für einen Ausdauer-Eintrag (Ausdauer-Seite & Verlauf)
export function CardioEntryRow({ s, onClick }: { s: CardioSession; onClick: () => void }) {
  const preset = cardioMachineInfo(s.machine)
  const parts = (Object.keys(CARDIO_METRICS) as CardioMetricKey[])
    .filter(k => s[k] != null)
    .slice(0, 3)
    .map(k => `${Number(s[k]).toLocaleString('de-DE')} ${CARDIO_METRICS[k].unit || CARDIO_METRICS[k].label}`)
  return (
    <button onClick={onClick} className="card w-full text-left flex items-center gap-3 active:scale-[0.99]">
      <span className="text-2xl">{preset?.icon ?? '🏷️'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold truncate">{s.machine} {s.source === 'ocr' && <span title="per Foto erfasst">📷</span>}</p>
          <span className="text-xs text-white/40 shrink-0">{fmtDate(s.performed_at)}</span>
        </div>
        <p className="text-xs text-white/45 mt-0.5">
          {fmtDuration(s.duration_seconds)}{parts.length > 0 && <> · {parts.join(' · ')}</>}
          {s.rpe != null && <> · RPE {s.rpe}</>}
        </p>
        {s.notes && <p className="text-xs text-white/55 mt-0.5 line-clamp-1">📔 {s.notes}</p>}
      </div>
    </button>
  )
}

type Draft = {
  machine: string
  performedAt: string
  minutes: string
  seconds: string
  rpe: number | null
  notes: string
  source: 'manual' | 'ocr'
  metrics: Partial<Record<CardioMetricKey, string>>
}

const emptyDraft = (): Draft => ({
  machine: '', performedAt: toLocalInput(new Date()), minutes: '', seconds: '',
  rpe: null, notes: '', source: 'manual', metrics: {}
})

// Vorbefüllung z. B. aus dem Live-Puls-Monitor (Dauer, Ø/Max-Puls …)
function draftFromInitial(init: Partial<CardioSession>): Draft {
  const d = emptyDraft()
  if (init.machine) d.machine = init.machine
  if (init.performed_at) d.performedAt = toLocalInput(new Date(init.performed_at))
  if (init.duration_seconds && init.duration_seconds > 0) {
    d.minutes = String(Math.floor(init.duration_seconds / 60))
    d.seconds = String(init.duration_seconds % 60)
  }
  if (init.notes) d.notes = init.notes
  if (init.rpe != null) d.rpe = init.rpe
  ;(Object.keys(CARDIO_METRICS) as CardioMetricKey[]).forEach(k => {
    if (init[k] != null) d.metrics[k] = String(init[k])
  })
  return d
}

function draftFromSession(s: CardioSession): Draft {
  const metrics: Partial<Record<CardioMetricKey, string>> = {}
  ;(Object.keys(CARDIO_METRICS) as CardioMetricKey[]).forEach(k => {
    if (s[k] != null) metrics[k] = String(s[k])
  })
  return {
    machine: s.machine,
    performedAt: toLocalInput(new Date(s.performed_at)),
    minutes: String(Math.floor(s.duration_seconds / 60)),
    seconds: String(s.duration_seconds % 60),
    rpe: s.rpe, notes: s.notes ?? '', source: s.source, metrics
  }
}

function applyOcr(d: Draft, r: CardioOcrResult): Draft {
  const metrics = { ...d.metrics }
  ;(['calories', 'distance_km', 'floors', 'level', 'avg_watts', 'avg_hr', 'cadence', 'speed_kmh', 'incline_pct'] as CardioMetricKey[])
    .forEach(k => { const v = (r as Record<string, unknown>)[k]; if (typeof v === 'number') metrics[k] = String(v) })
  const dur = typeof r.duration_seconds === 'number' && r.duration_seconds > 0 ? Math.round(r.duration_seconds) : null
  return {
    ...d,
    machine: d.machine || r.machine_guess || '',
    minutes: dur != null ? String(Math.floor(dur / 60)) : d.minutes,
    seconds: dur != null ? String(dur % 60) : d.seconds,
    source: 'ocr',
    metrics
  }
}

// Erfassung/Bearbeitung eines Ausdauer-Eintrags: manuell oder per Display-Foto.
// Pflicht: Gerät + Dauer. Restliche Felder je nach Gerät, damit die
// Progression pro Gerät vergleichbar bleibt (Level/Watt/Etagen/Distanz …).
export default function CardioForm({ uid, existing, initial, knownMachines, onClose, onSaved }: {
  uid: string
  existing?: CardioSession | null
  initial?: Partial<CardioSession>
  knownMachines?: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    existing ? draftFromSession(existing) : initial ? draftFromInitial(initial) : emptyDraft())
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocrNote, setOcrNote] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const preset = cardioMachineInfo(draft.machine)
  const fields: CardioMetricKey[] = showAll || !preset
    ? (Object.keys(CARDIO_METRICS) as CardioMetricKey[])
    : preset.fields
  // Gefüllte Felder immer zeigen (z. B. nach OCR), sonst „verschwinden" Werte optisch
  const visibleFields = Array.from(new Set([
    ...fields,
    ...(Object.keys(draft.metrics) as CardioMetricKey[]).filter(k => draft.metrics[k])
  ]))

  const machineChips = Array.from(new Set([
    ...CARDIO_MACHINES.map(m => m.name),
    ...(knownMachines ?? [])
  ]))

  const durationSeconds = Math.round((parseNum(draft.minutes) ?? 0) * 60 + (parseNum(draft.seconds) ?? 0))
  const valid = draft.machine.trim().length > 0 && durationSeconds > 0

  async function scan(file: File) {
    setScanning(true); setError(null); setOcrNote(null)
    try {
      const b64 = await fileToBase64Jpeg(file)
      const result = await cardioOcr(b64, 'image/jpeg')
      setDraft(d => applyOcr(d, result))
      if (result.note) setOcrNote(result.note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan fehlgeschlagen.')
    } finally {
      setScanning(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (!valid) return
    setBusy(true); setError(null)
    try {
      const payload: Partial<CardioSession> = {
        machine: draft.machine.trim(),
        performed_at: new Date(draft.performedAt).toISOString(),
        duration_seconds: durationSeconds,
        rpe: draft.rpe,
        notes: draft.notes.trim() || null,
        source: draft.source
      }
      ;(Object.keys(CARDIO_METRICS) as CardioMetricKey[]).forEach(k => {
        payload[k] = (draft.metrics[k] ?? '') !== '' ? parseNum(draft.metrics[k]!) : null
      })
      if (existing) await updateCardioSession(existing.id, payload)
      else await addCardioSession({ ...payload, user_id: uid })
      onSaved()
    } catch {
      setError('Speichern fehlgeschlagen – bitte erneut versuchen.')
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={existing ? 'Ausdauer bearbeiten' : 'Ausdauer eintragen'}>
      <div className="space-y-4">
        {/* Foto-Scan: Werte direkt vom Gerätedisplay übernehmen */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) scan(f) }} />
        <button className="btn w-full bg-accent/15 text-accent border border-accent/30" disabled={scanning}
          onClick={() => fileRef.current?.click()}>
          {scanning ? 'Lese Display…' : '📷 Display fotografieren & Werte übernehmen'}
        </button>
        {ocrNote && <p className="text-xs text-amber-300/80">💡 {ocrNote} – bitte Werte prüfen.</p>}
        {draft.source === 'ocr' && !ocrNote && !scanning && (
          <p className="text-xs text-white/45">Werte vom Display übernommen – bitte kurz prüfen.</p>
        )}

        <div>
          <label className="label">Gerät *</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {machineChips.map(name => {
              const p = cardioMachineInfo(name)
              return (
                <button key={name} type="button"
                  onClick={() => setDraft(d => ({ ...d, machine: name }))}
                  className={cls('chip transition',
                    draft.machine.trim().toLowerCase() === name.toLowerCase()
                      ? 'bg-primary/25 text-primary ring-1 ring-primary'
                      : 'bg-white/10 text-white/60')}>
                  {p?.icon ?? '🏷️'} {name}
                </button>
              )
            })}
          </div>
          <input className="input" placeholder="oder eigenes Gerät, z. B. „Laufband Studio 2“"
            value={draft.machine} onChange={e => setDraft(d => ({ ...d, machine: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Datum & Uhrzeit *</label>
            <input className="input" type="datetime-local" value={draft.performedAt}
              onChange={e => setDraft(d => ({ ...d, performedAt: e.target.value }))} />
          </div>
          <div>
            <label className="label">Dauer *</label>
            <div className="flex items-center gap-1.5">
              <input className="input text-center" type="text" inputMode="numeric" placeholder="min"
                value={draft.minutes} onChange={e => setDraft(d => ({ ...d, minutes: e.target.value }))} />
              <span className="text-white/40">:</span>
              <input className="input text-center" type="text" inputMode="numeric" placeholder="sec"
                value={draft.seconds} onChange={e => setDraft(d => ({ ...d, seconds: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label !mb-0">Messwerte {preset ? `(${preset.name})` : ''}</label>
            {preset && (
              <button type="button" className="text-xs text-primary" onClick={() => setShowAll(s => !s)}>
                {showAll ? 'Weniger Felder' : 'Alle Felder'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {visibleFields.map(k => (
              <div key={k}>
                <label className="text-[11px] text-white/45">{CARDIO_METRICS[k].label}{CARDIO_METRICS[k].unit ? ` (${CARDIO_METRICS[k].unit})` : ''}</label>
                <input className="input !py-2" type="text" inputMode="decimal"
                  value={draft.metrics[k] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, metrics: { ...d.metrics, [k]: e.target.value } }))} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Anstrengung (RPE 1–10)</label>
          <div className="flex gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button"
                onClick={() => setDraft(d => ({ ...d, rpe: d.rpe === v ? null : v }))}
                className={cls('flex-1 py-1.5 rounded-lg text-xs font-semibold transition',
                  draft.rpe === v ? 'bg-primary text-white' : 'bg-white/5 text-white/50')}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Notiz</label>
          <input className="input" placeholder="z. B. Intervalle, neues Programm…"
            value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          {existing && (
            <button className="btn-danger" disabled={busy} onClick={async () => {
              if (confirm('Eintrag löschen?')) { await deleteCardioSession(existing.id); onSaved() }
            }}>Löschen</button>
          )}
          <button className="btn-primary flex-1" disabled={busy || !valid} onClick={save}>
            {busy ? 'Speichern…' : existing ? 'Speichern' : 'Eintragen'}
          </button>
        </div>
        {!valid && <p className="text-[11px] text-white/35 text-center">Pflicht: Gerät und Dauer – der Rest verbessert deine Progressions-Auswertung.</p>}
      </div>
    </Modal>
  )
}
