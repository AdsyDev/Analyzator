import { useMemo, useState } from 'react'
import { ACTION_NEXT, type ActionTransition, type Brand, type EvidenceQuery, type Insight, type InsightAction, type InsightStatus, type InsightTransition, type MetricDefinition, type ProviderResult, type QueryContext, type Role } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { INSIGHT_STATUS_LABELS, InsightCard } from '../../components/InsightCard'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { Tabs, type TabItem } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { ACTION_LABEL } from '../overview/InsightSections'
import { ACTION_STEP, ActionForm, EVIDENCE_KEYS, InsightEditor, NoteDialog, RecommendationsDialog } from './InsightEditor'
import { useExportName } from '../shared/useExportName'

type StatusTab = 'all' | InsightStatus

interface ActionRow extends InsightAction {
  insight: Insight
}

/** Acțiunile analizelor primite, cu analiza lor. Nu se calculează nimic: ce vine de la provider, în ordinea termenului. */
export function actionRows(insights: readonly Insight[]): ActionRow[] {
  return insights
    .flatMap((i) => i.actions.map<ActionRow>((a) => ({ ...a, insight: i })))
    .sort((a, b) => (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31'))
}

const actionColumns: Column<ActionRow>[] = [
  { key: 'title', header: 'Acțiune', sortValue: (a) => a.title, render: (a) => <span className="font-medium">{a.title}</span> },
  { key: 'insight', header: 'Din analiza', sortValue: (a) => a.insight.title, render: (a) => <span className="text-text-2">{a.insight.title}</span> },
  {
    key: 'owner',
    header: 'Responsabil',
    sortValue: (a) => a.owner.name,
    render: (a) => (
      <span className="inline-flex items-center gap-2">
        <Avatar name={a.owner.name} size="sm" tone="accent" />
        <span className="leading-tight">
          <span className="block text-[12.5px] font-medium">{a.owner.name}</span>
          <span className="block text-[11.5px] text-text-2">{a.owner.role}</span>
        </span>
      </span>
    ),
  },
  { key: 'due', header: 'Termen', sortValue: (a) => a.due, render: (a) => (a.due ? <span className="font-mono text-[12px]">{formatDate(a.due)}</span> : <span className="text-text-3">Fără termen</span>) },
  { key: 'status', header: 'Status', sortValue: (a) => a.status, render: (a) => <StatusChip tone={ACTION_LABEL[a.status].tone}>{ACTION_LABEL[a.status].label}</StatusChip> },
]

/** Ce se poate face cu o analiză, în funcție de status și de rol. Serverul rămâne autoritatea; aici doar nu oferim pași imposibili. */
interface Workflow {
  canReview: boolean
  onEdit: (i: Insight) => void
  onDelete: (i: Insight) => void
  onTransition: (i: Insight, to: InsightTransition) => void
  onAddAction: (i: Insight) => void
  onRecommendations: (i: Insight) => void
  onSupersede: (i: Insight) => void
  onActionStep: (a: ActionRow, to: ActionTransition['to']) => void
  busy: string | null
}

/** Un pas care cere un text înainte de a fi trimis. */
interface PendingNote {
  title: string
  label: string
  hint: string
  confirm: string
  run: (text: string) => Promise<ProviderResult<null>>
  done: string
}

/**
 * Analize și acțiuni (spec cap. 21; editorul e din Etapa 2 a propunerii din 10 nov. 2026). Agenția vede toate
 * statusurile și lucrează aici: ciornă, review, publicare, acțiuni și pașii lor. Clientul vede doar analizele
 * publicate, iar filtrarea reală e a providerului (RLS), nu a interfeței.
 */
export function InsightsPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <InsightsContent brand={brand} ctx={ctx} role={user.role} />
}

function InsightsContent({ brand, ctx, role }: { brand: Brand; ctx: QueryContext; role: Role }) {
  const providers = useProviders()
  const toast = useToast()
  const agencyView = role !== 'client_viewer'
  const list = useAsync(() => providers.insights.list(ctx), [providers, ctxKey(ctx)])
  const defs = useDefinitions(agencyView ? EVIDENCE_KEYS : [])
  const definitions = useMemo<MetricDefinition[]>(() => EVIDENCE_KEYS.map((k) => defs.byKey.get(k)).filter((d): d is MetricDefinition => !!d), [defs.byKey])
  const [tab, setTab] = useState<StatusTab>('all')
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const [editing, setEditing] = useState<{ insight: Insight | null } | null>(null)
  const [actionFor, setActionFor] = useState<Insight | null>(null)
  const [note, setNote] = useState<PendingNote | null>(null)
  const [recsFor, setRecsFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Responsabilul se poate alege doar unde numele membrilor sunt vizibile (agency_admin, E10); altfel rămâne utilizatorul curent.
  const people = useAsync(() => (role === 'agency_admin' ? providers.users.people() : Promise.resolve(null)), [providers, role])
  const owners = useMemo(() => {
    const r = people.state.status === 'done' ? people.state.value : null
    if (!r || r.kind !== 'ready') return []
    return r.data
      .filter((p) => p.tenant_id === brand.tenant_id && p.membership_active && p.role !== 'client_viewer')
      .map((p) => ({ id: p.user_id, name: p.name ?? p.email ?? `Utilizator ${p.user_id.slice(0, 8)}` }))
  }, [people.state, brand.tenant_id])

  const open = (q: EvidenceQuery, label: string) => setTarget({ page: 'Analize și acțiuni', label, query: q })

  /** Rulează o scriere; la succes confirmă și reîncarcă lista, la eșec întoarce mesajul (formularul îl afișează). */
  async function run(key: string, call: () => Promise<ProviderResult<unknown>>, done: string): Promise<string | null> {
    setBusy(key)
    const r = await call().catch((): ProviderResult<unknown> => ({ kind: 'error', message: 'Modificarea nu a putut fi salvată. Reîncearcă.' }))
    setBusy(null)
    if (r.kind === 'ready') {
      toast(done)
      list.reload()
      return null
    }
    return r.kind === 'error' ? r.message : r.reason
  }
  /** Pașii fără formular arată eșecul ca toast. */
  async function step(key: string, call: () => Promise<ProviderResult<unknown>>, done: string) {
    const failed = await run(key, call, done)
    if (failed) toast(failed)
  }

  const workflow: Workflow = {
    canReview: role === 'strategist' || role === 'agency_admin',
    busy,
    onEdit: (i) => setEditing({ insight: i }),
    onDelete: (i) => void step(`del:${i.id}`, () => providers.insights.deleteDraft(i.id), 'Ciorna a fost ștearsă.'),
    onAddAction: (i) => setActionFor(i),
    onRecommendations: (i) => setRecsFor(i.id),
    onSupersede: (i) => void step(`sup:${i.id}`, () => providers.insights.supersede(brand, i), 'Versiunea nouă e în ciornă, cu dovezile și recomandările copiate. Cea publicată rămâne vizibilă până la publicarea ei.'),
    onTransition: (i, to) => {
      if (to === 'draft') {
        setNote({ title: 'Returnează la draft', label: 'Motiv', hint: 'Autorul vede motivul și poate corecta analiza.', confirm: 'Returnează', run: (text) => providers.insights.transition(i.id, 'draft', text), done: 'Analiza a fost returnată la draft.' })
        return
      }
      void step(`tr:${i.id}`, () => providers.insights.transition(i.id, to), to === 'in_review' ? 'Analiza a fost trimisă la review.' : 'Analiza a fost publicată; metricile citate au fost înghețate.')
    },
    onActionStep: (a, to) => {
      if (to === 'cancelled') {
        setNote({ title: 'Anulează acțiunea', label: 'Motiv', hint: 'Acțiunea anulată rămâne în istoric, cu motivul.', confirm: 'Anulează acțiunea', run: (text) => providers.insights.transitionAction(a.id, { to, reason: text }), done: ACTION_STEP[to].done })
        return
      }
      if (to === 'measured') {
        setNote({ title: 'Rezultatul observat', label: 'Rezultat', hint: 'Ce s-a schimbat la indicatorul urmărit și ce alți factori au existat. O schimbare după acțiune nu e automat efectul ei.', confirm: 'Salvează rezultatul', run: (text) => providers.insights.transitionAction(a.id, { to, result_note: text }), done: ACTION_STEP[to].done })
        return
      }
      void step(`act:${a.id}`, () => providers.insights.transitionAction(a.id, { to }), ACTION_STEP[to].done)
    },
  }

  return (
    <div className="flex flex-col gap-5">
      <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă analizele" skeletonClass="h-64">
        {(all) => <Body all={all} agencyView={agencyView} tab={tab} setTab={setTab} onOpenEvidence={open} workflow={workflow} onNew={() => setEditing({ insight: null })} />}
      </Resolved>
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={agencyView} />
      {editing && (
        <InsightEditor
          insight={editing.insight}
          defaultPeriod={{ from: ctx.period.from, to: ctx.period.to }}
          definitions={definitions}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            const failed = await run('save', () => providers.insights.saveDraft(brand, editing.insight?.id ?? null, draft), 'Ciorna a fost salvată.')
            if (!failed) setEditing(null)
            return failed
          }}
        />
      )}
      {actionFor && (
        <ActionForm
          insightTitle={actionFor.title}
          definitions={definitions}
          owners={owners}
          onClose={() => setActionFor(null)}
          onSave={async (action) => {
            const failed = await run('action', () => providers.insights.addAction(brand, actionFor.id, action), 'Acțiunea a fost adăugată.')
            if (!failed) setActionFor(null)
            return failed
          }}
        />
      )}
      {recsFor &&
        (() => {
          // Analiza se ia din lista curentă, ca dialogul să arate recomandările imediat după fiecare adăugare sau ștergere.
          const current = list.state.status === 'done' && list.state.value.kind === 'ready' ? list.state.value.data.find((i) => i.id === recsFor) : undefined
          return current ? (
            <RecommendationsDialog
              insight={current}
              onClose={() => setRecsFor(null)}
              onAdd={(rec) => run('rec', () => providers.insights.addRecommendation(brand, current.id, rec), 'Recomandarea a fost adăugată.')}
              onDelete={(id) => run('rec', () => providers.insights.deleteRecommendation(id), 'Recomandarea a fost ștearsă.')}
            />
          ) : null
        })()}
      {note && (
        <NoteDialog
          title={note.title}
          label={note.label}
          hint={note.hint}
          confirm={note.confirm}
          onClose={() => setNote(null)}
          onSave={async (text) => {
            const failed = await run('note', () => note.run(text), note.done)
            if (!failed) setNote(null)
            return failed
          }}
        />
      )}
    </div>
  )
}

function InsightSteps({ insight, w }: { insight: Insight; w: Workflow }) {
  const busy = w.busy !== null
  if (insight.status === 'superseded') return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Pași pentru ${insight.title}`}>
      {insight.status === 'draft' && (
        <>
          <Button onClick={() => w.onEdit(insight)} disabled={busy}>Editează</Button>
          <Button onClick={() => w.onRecommendations(insight)} disabled={busy}>Recomandări ({insight.recommendations?.length ?? 0})</Button>
          <Button variant="primary" onClick={() => w.onTransition(insight, 'in_review')} disabled={busy}>Trimite la review</Button>
          <Button variant="ghost" onClick={() => w.onDelete(insight)} disabled={busy}>Șterge ciorna</Button>
        </>
      )}
      {insight.status === 'in_review' &&
        (w.canReview ? (
          <>
            <Button variant="primary" onClick={() => w.onTransition(insight, 'published')} disabled={busy}>Publică</Button>
            <Button onClick={() => w.onTransition(insight, 'draft')} disabled={busy}>Returnează la draft</Button>
          </>
        ) : (
          <p className="text-[12.5px] text-text-2">Așteaptă review-ul unui strategist sau al unui administrator.</p>
        ))}
      {insight.status !== 'draft' && <Button onClick={() => w.onAddAction(insight)} disabled={busy}>Adaugă acțiune</Button>}
      {insight.status === 'published' && <Button variant="ghost" onClick={() => w.onSupersede(insight)} disabled={busy}>Versiune nouă</Button>}
    </div>
  )
}

function Body({ all, agencyView, tab, setTab, onOpenEvidence, workflow, onNew }: { all: Insight[]; agencyView: boolean; tab: StatusTab; setTab: (t: StatusTab) => void; onOpenEvidence: (q: EvidenceQuery, label: string) => void; workflow: Workflow; onNew: () => void }) {
  const exportName = useExportName('actiuni')
  // A doua barieră: chiar dacă providerul ar greși, clientul nu primește o analiză nepublicată.
  const visible = useMemo(() => (agencyView ? all : all.filter((i) => i.status === 'published')), [all, agencyView])
  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { all: visible.length, draft: 0, in_review: 0, published: 0, superseded: 0 }
    for (const i of visible) c[i.status]++
    return c
  }, [visible])
  const tabs: TabItem<StatusTab>[] = [
    { id: 'all', label: `Toate (${counts.all})` },
    ...(['draft', 'in_review', 'published', 'superseded'] as const).map((s) => ({ id: s, label: `${INSIGHT_STATUS_LABELS[s].label} (${counts[s]})` })),
  ]
  const shown = tab === 'all' || !agencyView ? visible : visible.filter((i) => i.status === tab)
  const columns = useMemo<Column<ActionRow>[]>(
    () =>
      agencyView
        ? [
            ...actionColumns,
            {
              key: 'plan',
              header: 'Plan',
              render: (a) => (
                <span className="text-[12.5px] text-text-2">
                  {[a.effort ? `Efort: ${a.effort}` : null, a.tracked_metric ? `KPI: ${a.tracked_metric.label}` : null, a.result_note ? `Rezultat: ${a.result_note}` : null].filter(Boolean).join(' · ') || <span className="text-text-3">Necompletat</span>}
                </span>
              ),
            },
            {
              key: 'step',
              header: 'Pas următor',
              render: (a) => {
                const next = a.stage ? ACTION_NEXT[a.stage] : []
                return next.length === 0 ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {next.map((to) => (
                      <Button key={to} variant={to === 'cancelled' ? 'ghost' : 'secondary'} onClick={() => workflow.onActionStep(a, to)} disabled={workflow.busy !== null} aria-label={`${ACTION_STEP[to].label}: ${a.title}`}>
                        {ACTION_STEP[to].label}
                      </Button>
                    ))}
                  </span>
                )
              },
            },
          ]
        : actionColumns,
    [agencyView, workflow],
  )
  const newButton = agencyView ? (
    <Button variant="primary" onClick={onNew}>
      Analiză nouă
    </Button>
  ) : null

  if (visible.length === 0) {
    return (
      <EmptyState
        title={agencyView ? 'Nicio analiză pentru acest brand' : 'Nicio analiză publicată'}
        text={agencyView ? 'Nu există încă nicio analiză, nici măcar ciornă, pentru acest brand.' : 'Echipa AdSymphony nu a publicat încă o analiză pentru acest brand.'}
        action={agencyView ? { label: 'Analiză nouă', onClick: onNew } : undefined}
      />
    )
  }

  return (
    <>
      <Section
        id="insights"
        title="Analize"
        description={agencyView ? 'Toate statusurile sunt vizibile echipei AdSymphony. Clientul vede doar analizele publicate.' : 'Interpretările publicate de echipa AdSymphony, cu dovezile și limitele lor.'}
        action={
          agencyView ? (
            <div className="flex flex-wrap items-center gap-3">
              <Tabs label="Status analiză" items={tabs} value={tab} onChange={setTab} />
              {newButton}
            </div>
          ) : undefined
        }
      >
        {shown.length === 0 ? (
          <EmptyState compact title="Nicio analiză cu acest status" text="Alege alt status sau vezi toate analizele." />
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((i) => (
              <li key={i.id} className={i.status === 'superseded' ? 'flex flex-col gap-2 opacity-80' : 'flex flex-col gap-2'}>
                <InsightCard insight={i} agencyView={agencyView} onOpenEvidence={(q) => onOpenEvidence(q, i.evidence.find((e) => e.evidence_query === q)?.label ?? q.metric_key)} />
                {agencyView && <InsightSteps insight={i} w={workflow} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="actions" title="Acțiuni" description={agencyView ? 'Registrul acțiunilor: responsabil, termen, plan și pasul următor. Clientul vede acțiunile agreate ale analizelor publicate.' : 'Ce urmează din analize, cu responsabil, termen și status.'}>
        <SortableTable caption="Acțiuni" exportFileName={exportName} columns={columns} rows={actionRows(shown)} rowKey={(a) => `${a.insight.id}:${a.id}`} pageSize={8} emptyText="Analizele afișate nu au acțiuni." />
      </Section>
    </>
  )
}
