import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../lib/auth'
import {
  getProfiles, getActivePlan, getDays, getDayExercises,
  updatePlan, updateExercise, addExercise, deleteExercise, addDay, updateDay, deleteDay, reorderExercises
} from '../lib/db'
import { Plan, PlanDay, PlanExercise, Profile, MUSCLE_LABELS, MUSCLE_HEX } from '../lib/types'
import { Spinner, Modal, Chip, EmptyState } from '../components/ui'
import { fmtWeight, cls, parseNum } from '../lib/utils'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const COLORS = ['🟠', '🟢', '🔵', '🟣', '🩷', '🟡', '🔴', '⚪']
const GROUPS = Object.keys(MUSCLE_LABELS)

export default function PlanPage() {
  const { profile } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [viewId, setViewId] = useState<string>('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [days, setDays] = useState<PlanDay[]>([])
  const [exByDay, setExByDay] = useState<Record<string, PlanExercise[]>>({})
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)
  const [editEx, setEditEx] = useState<PlanExercise | null>(null)
  const [editPlanMeta, setEditPlanMeta] = useState(false)
  const [editDay, setEditDay] = useState<PlanDay | null>(null)

  const isOwn = viewId === profile?.id

  const load = useCallback(async (uid: string) => {
    setLoading(true)
    const pl = await getActivePlan(uid)
    setPlan(pl)
    if (pl) {
      const d = await getDays(pl.id)
      setDays(d)
      setOpenDay((cur) => cur && d.some(x => x.id === cur) ? cur : d[0]?.id ?? null)
      const ex = await getDayExercises(d.map(x => x.id))
      const grouped: Record<string, PlanExercise[]> = {}
      ex.forEach(e => { (grouped[e.plan_day_id] ??= []).push(e) })
      setExByDay(grouped)
    } else { setDays([]); setExByDay({}) }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!profile) return
    getProfiles().then(ps => {
      setPeople(ps)
      setViewId(profile.id)
    })
  }, [profile])

  useEffect(() => { if (viewId) load(viewId) }, [viewId, load])

  // Drag & Drop: lange auf eine Übung tippen und verschieben (mobil + Desktop)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )
  function handleDragEnd(dayId: string, e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const list = exByDay[dayId] ?? []
    const oldI = list.findIndex(x => x.id === active.id)
    const newI = list.findIndex(x => x.id === over.id)
    if (oldI < 0 || newI < 0) return
    const newList = arrayMove(list, oldI, newI)
    setExByDay(prev => ({ ...prev, [dayId]: newList }))
    reorderExercises(newList.map(x => x.id))
  }
  function handleMove(dayId: string, index: number, delta: number) {
    const list = exByDay[dayId] ?? []
    const j = index + delta
    if (j < 0 || j >= list.length) return
    const newList = arrayMove(list, index, j)
    setExByDay(prev => ({ ...prev, [dayId]: newList }))
    reorderExercises(newList.map(x => x.id))
  }

  if (loading && !plan) return <Spinner label="Lade Plan…" />

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-extrabold">📋 Plan</h1>
        {isOwn && plan && (
          <button className={cls('btn', edit ? 'btn-accent' : 'btn-ghost')} onClick={() => setEdit(e => !e)}>
            {edit ? '✓ Fertig' : '✏️ Bearbeiten'}
          </button>
        )}
      </div>

      {/* Person switcher */}
      {people.length > 1 && (
        <div className="flex gap-2">
          {people.map(p => (
            <button key={p.id} onClick={() => { setViewId(p.id); setEdit(false) }}
              className={cls('btn flex-1', viewId === p.id ? 'btn-primary' : 'btn-ghost')}>
              {p.avatar_emoji} {p.id === profile?.id ? 'Mein Plan' : p.display_name}
            </button>
          ))}
        </div>
      )}

      {!plan ? (
        <EmptyState icon="📋" title="Noch kein Plan" hint={isOwn ? 'Lege unten einen Tag an, um zu starten.' : ''} />
      ) : (
        <>
          {/* Plan-Info (Name dezent – Trainings werden über Tag + Hauptübung benannt) */}
          <div className="card">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-white/40">{plan.name}</p>
              {isOwn && edit && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditPlanMeta(true)}>✏️</button>}
            </div>
            {plan.progression_note && <p className="text-xs text-white/55 mt-2 leading-relaxed">{plan.progression_note}</p>}
            {plan.color_legend && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(plan.color_legend).map(([c, label]) => (
                  <span key={c} className="text-[11px] text-white/60 bg-white/5 px-2 py-0.5 rounded-full">{c} {label}</span>
                ))}
              </div>
            )}
            {plan.medical_note && (
              <div className="mt-3 text-xs bg-danger/10 border border-danger/20 rounded-xl p-2.5 text-red-200/90 leading-relaxed">
                ⚕️ {plan.medical_note}
              </div>
            )}
          </div>

          {/* Days */}
          {days.map(day => {
            const list = exByDay[day.id] ?? []
            const isOpen = openDay === day.id
            const mainEx = list[0]?.name
            return (
              <div key={day.id} className="card !p-0 overflow-hidden">
                <button className="w-full flex items-center justify-between p-4" onClick={() => setOpenDay(isOpen ? null : day.id)}>
                  <div className="text-left min-w-0">
                    <p className="font-bold truncate">{day.weekday} · {day.title}</p>
                    <p className="text-xs text-white/45">{day.effort} · {list.length} Übungen</p>
                    {mainEx && <p className="text-xs text-primary/80 mt-0.5 truncate">🏋️ {mainEx}</p>}
                  </div>
                  <span className={cls('transition-transform text-white/40 shrink-0', isOpen && 'rotate-180')}>▾</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2">
                    {edit && isOwn && list.length > 1 && (
                      <p className="text-[11px] text-white/40 px-1">Reihenfolge ändern: am Griff ⠿ ziehen oder ▲▼ tippen.</p>
                    )}
                    {edit && isOwn ? (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(day.id, e)}>
                        <SortableContext items={list.map(x => x.id)} strategy={verticalListSortingStrategy}>
                          {list.map((ex, i) => (
                            <SortableExercise key={ex.id} ex={ex} index={i} total={list.length}
                              onEdit={() => setEditEx(ex)} onMove={(delta) => handleMove(day.id, i, delta)} />
                          ))}
                        </SortableContext>
                      </DndContext>
                    ) : (
                      list.map(ex => (
                        <ExerciseRow key={ex.id} ex={ex} edit={false} onEdit={() => setEditEx(ex)} />
                      ))
                    )}
                    {edit && isOwn && (
                      <button className="btn-ghost w-full text-sm" onClick={() => setEditEx({
                        id: '', plan_day_id: day.id, exercise_id: null, name: '', muscle_group: 'other',
                        color: '⚪', sets: 3, rep_min: 8, rep_max: 12, per_side: false, is_home: false,
                        is_warning: false, target_weight: null, unit: 'kg', cue: '', technique: '', sort_order: list.length + 1
                      })}>+ Übung hinzufügen</button>
                    )}
                    {edit && isOwn && (
                      <div className="flex gap-2 pt-1">
                        <button className="btn-ghost flex-1 text-xs" onClick={() => setEditDay(day)}>Tag bearbeiten</button>
                        <button className="btn-danger flex-1 text-xs" onClick={async () => {
                          if (confirm('Diesen Tag löschen?')) { await deleteDay(day.id); load(viewId) }
                        }}>Tag löschen</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {edit && isOwn && (
            <button className="btn-ghost w-full" onClick={() => setEditDay({
              id: '', plan_id: plan.id, weekday: 'Mo', title: 'Neuer Tag', effort: '🟡 Mittel', sort_order: days.length + 1
            })}>+ Trainingstag hinzufügen</button>
          )}
        </>
      )}

      {/* Exercise editor */}
      {editEx && plan && (
        <ExerciseEditor ex={editEx} onClose={() => setEditEx(null)}
          onSaved={() => { setEditEx(null); load(viewId) }} />
      )}
      {/* Plan meta editor */}
      {editPlanMeta && plan && (
        <PlanMetaEditor plan={plan} onClose={() => setEditPlanMeta(false)}
          onSaved={() => { setEditPlanMeta(false); load(viewId) }} />
      )}
      {/* Day editor */}
      {editDay && (
        <DayEditor day={editDay} onClose={() => setEditDay(null)}
          onSaved={() => { setEditDay(null); load(viewId) }} />
      )}
    </div>
  )
}

function SortableExercise({ ex, onEdit, onMove, index, total }:
  { ex: PlanExercise; onEdit: () => void; onMove: (delta: number) => void; index: number; total: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ex.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined
  }
  const handle = (
    <button ref={setActivatorNodeRef} {...attributes} {...listeners}
      className="text-white/40 text-2xl leading-none px-1 cursor-grab active:cursor-grabbing self-stretch flex items-center"
      style={{ touchAction: 'none' }} aria-label="Zum Verschieben ziehen">⠿</button>
  )
  return (
    <div ref={setNodeRef} style={style}>
      <ExerciseRow ex={ex} edit onEdit={onEdit} handle={handle} onMove={onMove} index={index} total={total} />
    </div>
  )
}

function ExerciseRow({ ex, edit, onEdit, handle, onMove, index, total }:
  { ex: PlanExercise; edit: boolean; onEdit: () => void; handle?: React.ReactNode; onMove?: (delta: number) => void; index?: number; total?: number }) {
  return (
    <div className="bg-surface2 rounded-xl p-3 flex items-start gap-2" style={{ borderLeft: `3px solid ${MUSCLE_HEX[ex.muscle_group] ?? '#64748b'}` }}>
      {handle}
      <span className="text-lg leading-none mt-0.5">{ex.color}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold">{ex.name}</p>
          {ex.is_warning && <span title="Haltungshinweis">⚠️</span>}
          {ex.is_home && <Chip color="#3b82f6">Zuhause</Chip>}
        </div>
        <p className="text-sm text-white/60 mt-0.5">
          {ex.sets} × {ex.rep_min}-{ex.rep_max}{ex.per_side ? '/Seite' : ''}
          {ex.target_weight != null && <> · <span className="text-accent font-semibold">{fmtWeight(ex.target_weight, ex.unit)}</span></>}
        </p>
        {ex.cue && <p className="text-xs text-white/40 mt-1 leading-snug">{ex.cue}</p>}
      </div>
      {onMove && (
        <div className="flex flex-col shrink-0">
          <button className="text-white/40 disabled:opacity-20 px-1 leading-none text-sm" disabled={index === 0}
            onPointerDown={e => e.stopPropagation()} onClick={() => onMove(-1)} aria-label="nach oben">▲</button>
          <button className="text-white/40 disabled:opacity-20 px-1 leading-none text-sm" disabled={(index ?? 0) >= (total ?? 1) - 1}
            onPointerDown={e => e.stopPropagation()} onClick={() => onMove(1)} aria-label="nach unten">▼</button>
        </div>
      )}
      {edit && <button className="btn-ghost !px-2 !py-1 text-sm shrink-0" onPointerDown={e => e.stopPropagation()} onClick={onEdit}>✏️</button>}
    </div>
  )
}

function ExerciseEditor({ ex, onClose, onSaved }: { ex: PlanExercise; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<PlanExercise>(ex)
  const [busy, setBusy] = useState(false)
  const isNew = !ex.id
  const set = (patch: Partial<PlanExercise>) => setF(p => ({ ...p, ...patch }))

  async function save() {
    if (!f.name.trim()) return
    setBusy(true)
    const payload = {
      plan_day_id: f.plan_day_id, name: f.name.trim(), muscle_group: f.muscle_group, color: f.color,
      sets: f.sets, rep_min: f.rep_min, rep_max: f.rep_max, per_side: f.per_side, is_home: f.is_home,
      is_warning: f.is_warning, target_weight: f.target_weight, unit: f.unit, cue: f.cue,
      technique: f.technique, sort_order: f.sort_order
    }
    if (isNew) await addExercise(payload)
    else await updateExercise(f.id, payload)
    setBusy(false); onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Übung hinzufügen' : 'Übung bearbeiten'}>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={f.name} onChange={e => set({ name: e.target.value })} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Muskelgruppe</label>
            <select className="input" value={f.muscle_group} onChange={e => set({ muscle_group: e.target.value })}>
              {GROUPS.map(g => <option key={g} value={g}>{MUSCLE_LABELS[g]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Farbe</label>
            <div className="flex flex-wrap gap-1">
              {COLORS.map(c => (
                <button key={c} onClick={() => set({ color: c })}
                  className={cls('w-9 h-9 rounded-lg text-lg', f.color === c ? 'bg-primary/30 ring-2 ring-primary' : 'bg-surface2')}>{c}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Sätze</label><input className="input" type="number" value={f.sets} onChange={e => set({ sets: +e.target.value })} /></div>
          <div><label className="label">Reps min</label><input className="input" type="number" value={f.rep_min} onChange={e => set({ rep_min: +e.target.value })} /></div>
          <div><label className="label">Reps max</label><input className="input" type="number" value={f.rep_max} onChange={e => set({ rep_max: +e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Gewicht ({f.unit})</label>
            <input className="input" type="text" inputMode="decimal" value={f.target_weight ?? ''} placeholder="–"
              onChange={e => set({ target_weight: parseNum(e.target.value) })} /></div>
          <div><label className="label">Einheit</label>
            <select className="input" value={f.unit} onChange={e => set({ unit: e.target.value })}>
              <option value="kg">kg</option><option value="lbs">lbs</option>
            </select></div>
        </div>
        <div>
          <label className="label">Haltungshinweis / Kommentar</label>
          <textarea className="input min-h-[70px]" value={f.cue ?? ''} onChange={e => set({ cue: e.target.value })} />
        </div>
        <div>
          <label className="label">Ausführung im Detail</label>
          <textarea className="input min-h-[90px]" value={f.technique ?? ''} onChange={e => set({ technique: e.target.value })} placeholder="Schritt-für-Schritt-Anleitung…" />
        </div>
        <div className="flex flex-wrap gap-4 py-1">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.per_side} onChange={e => set({ per_side: e.target.checked })} /> Pro Seite</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_home} onChange={e => set({ is_home: e.target.checked })} /> Zuhause</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_warning} onChange={e => set({ is_warning: e.target.checked })} /> ⚠️ Hinweis</label>
        </div>
        <div className="flex gap-2 pt-1">
          {!isNew && <button className="btn-danger" onClick={async () => { if (confirm('Übung löschen?')) { await deleteExercise(f.id); onSaved() } }}>Löschen</button>}
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Speichern…' : 'Speichern'}</button>
        </div>
      </div>
    </Modal>
  )
}

function PlanMetaEditor({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(plan.name)
  const [prog, setProg] = useState(plan.progression_note ?? '')
  const [med, setMed] = useState(plan.medical_note ?? '')
  const [deload, setDeload] = useState(plan.deload_week)
  return (
    <Modal open onClose={onClose} title="Plan bearbeiten">
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label className="label">Progressions-Hinweis</label><textarea className="input min-h-[70px]" value={prog} onChange={e => setProg(e.target.value)} /></div>
        <div><label className="label">Medizinischer Hinweis</label><textarea className="input min-h-[90px]" value={med} onChange={e => setMed(e.target.value)} /></div>
        <div><label className="label">Deload-Woche</label><input className="input" type="number" value={deload} onChange={e => setDeload(+e.target.value)} /></div>
        <button className="btn-primary w-full" onClick={async () => {
          await updatePlan(plan.id, { name, progression_note: prog, medical_note: med, deload_week: deload }); onSaved()
        }}>Speichern</button>
      </div>
    </Modal>
  )
}

function DayEditor({ day, onClose, onSaved }: { day: PlanDay; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(day)
  const isNew = !day.id
  return (
    <Modal open onClose={onClose} title={isNew ? 'Tag hinzufügen' : 'Tag bearbeiten'}>
      <div className="space-y-3">
        <div><label className="label">Wochentag</label>
          <select className="input" value={f.weekday} onChange={e => setF({ ...f, weekday: e.target.value })}>
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => <option key={w}>{w}</option>)}
          </select></div>
        <div><label className="label">Titel</label><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label">Anstrengung</label><input className="input" value={f.effort ?? ''} onChange={e => setF({ ...f, effort: e.target.value })} placeholder="🟡 Mittel" /></div>
        <button className="btn-primary w-full" onClick={async () => {
          if (isNew) await addDay({ plan_id: f.plan_id, weekday: f.weekday, title: f.title, effort: f.effort, sort_order: f.sort_order })
          else await updateDay(f.id, { weekday: f.weekday, title: f.title, effort: f.effort })
          onSaved()
        }}>Speichern</button>
      </div>
    </Modal>
  )
}
