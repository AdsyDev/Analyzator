import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import insightsFile from '../../../../../tests/fixtures/ui/insights.json'
import mentionsFile from '../../../../../tests/fixtures/ui/mentions.json'
import sourcesFile from '../../../../../tests/fixtures/ui/sources.json'
import {
  failed,
  isAgencyRole,
  notConnected,
  ready,
  type Brand,
  type BrandsProvider,
  type DataProviders,
  ACTION_NEXT,
  type ActionStage,
  type Insight,
  type InsightAction,
  type InsightsProvider,
  type ProviderResult,
  type Mention,
  type MentionsProvider,
  type MetricsProvider,
  type PvFlag,
  type PvItemRef,
  type QueryContext,
  type Role,
  type SessionUser,
  type SourceConnection,
  type TenantConnection,
  type SourceProviderId,
  type SourceState,
  type SourceFreshness,
  type SourceStatusInfo,
  type SourcesProvider,
  type SyncRun,
  type SyncRunStatus,
  type CredentialStatus,
  type Sentiment,
  type ClientResponse,
  type InsightComment,
} from '../../contracts'
import { runErrorCodes, runReason } from '../../lib/runReason'
import { addDays, comparisonRange, todayBucharest } from '../../lib/period'
import { createClientsFixtures } from './clients'
import { createAdminFixtures } from './admin'
import { createAiFixtures } from './ai'
import { createCompetitionFixtures } from './competition'
import { createPaidFixtures } from './paid'
import { createAssistantFixtures } from './assistant'
import { createSearchFixtures } from './search'
import { createSocialFixtures } from './social'
import { createTrafficFixtures } from './traffic'
import { FIXTURE_DEFINITIONS, fixtureEvidence, fixtureMetrics, fixtureTrends } from './metrics'

export interface FixtureOptions {
  /** Rolul curent al utilizatorului din previzualizare; decide ce vede clientul (ca RLS pe server). */
  getRole?: () => Role
  getUser?: () => SessionUser
  now?: () => Date
}

const DEFAULT_USER: SessionUser = { id: 'preview-user', name: 'Ioana Popescu', email: 'ioana.popescu@adsymphony.example', role: 'strategist', organization: 'AdSymphony' }

/**
 * Provideri cu date FICTIVE, doar pentru previzualizarea de design (VITE_DESIGN_PREVIEW=true).
 * Nu se importă din nicio cale fără flag: build-ul de producție și cel de staging eșuează dacă flag-ul e setat.
 */
export function createFixtureProviders(options: FixtureOptions = {}): DataProviders {
  const now = options.now ?? (() => new Date())
  const getRole = options.getRole ?? (() => 'strategist' as Role)
  const getUser = options.getUser ?? (() => DEFAULT_USER)
  const today = () => todayBucharest(now())
  const daysAgo = (n: number) => addDays(today(), -n)
  const instantDaysAgo = (n: number, hour = 9) => {
    const d = new Date(now().getTime() - n * 86_400_000)
    d.setUTCHours(hour, (n * 7) % 60, 0, 0)
    return d.toISOString()
  }

  const allowed = new Set(brandsFile.brands.map((b) => b.id))
  const guard = <T>(brandId: string): ProviderGuard<T> | null => (allowed.has(brandId) ? null : { kind: 'error', message: 'Acces refuzat la acest spațiu de brand.' })

  const metrics: MetricsProvider = {
    definitions: async (keys) => ready(FIXTURE_DEFINITIONS.filter((d) => keys.includes(d.metric_key))),
    metrics: async (ctx, keys) => fixtureMetrics(ctx, keys, now()),
    trends: async (ctx, keys) => fixtureTrends(ctx, keys),
    evidence: async (brandId, q) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const ctx: QueryContext = {
        brandId,
        period: { preset: 'custom', from: q.period.start, to: q.period.end },
        comparison: 'previous',
        filters: {},
      }
      const ev = fixtureEvidence(ctx, q.metric_key)
      return ev ? ready({ ...ev, evidence_query: q }) : notConnected('Sursa nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.')
    },
  }

  const people = insightsFile.people as Record<string, { id: string; name: string; role: string }>
  const person = (k: string) => people[k] ?? { id: k, name: k, role: '' }
  const insightsFor = (brandId: string): Insight[] =>
    insightsFile.insights
      .filter((i) => i.brand_id === brandId)
      .map((i) => {
        const period = { from: daysAgo(i.period.from_days_ago), to: daysAgo(i.period.to_days_ago) }
        const cmp = comparisonRange({ preset: 'custom', ...period }, 'previous')
        return {
          id: i.id,
          brand_id: i.brand_id,
          title: i.title,
          summary: i.summary,
          // Fixtures nu au text separat de interpretare; o analiză trimisă la review are mereu una, deci nu rămâne goală.
          interpretation: i.summary,
          author: person(i.author),
          period,
          status: i.status as Insight['status'],
          evidence: i.evidence.map((e) => ({
            label: e.label,
            evidence_query: { metric_key: e.metric_key, version: 1, brand_id: i.brand_id, period: { start: period.from, end: period.to }, comparison_period: { start: cmp.from, end: cmp.to } },
          })),
          limits: i.limits,
          actions: i.actions.map((a) => ({ id: a.id, title: a.title, owner: person(a.owner), due: daysAgo(-a.due_days), status: a.status as Insight['actions'][number]['status'] })),
          updated_at: instantDaysAgo(i.updated_days_ago, 10),
          published_at: i.status === 'published' ? instantDaysAgo(i.updated_days_ago, 10) : null,
        }
      })

  // Scrierile din previzualizare rămân în memorie cât ține sesiunea; regulile oglindesc triggerele din `insights_pv`.
  const STAGE_STATUS: Record<ActionStage, InsightAction['status']> = { proposed: 'open', agreed: 'open', in_progress: 'in_progress', done: 'done', measured: 'done', cancelled: 'cancelled' }
  const STATUS_STAGE: Record<InsightAction['status'], ActionStage> = { open: 'agreed', in_progress: 'in_progress', done: 'done', cancelled: 'cancelled' }
  const edited = new Map<string, Insight>()
  const removed = new Set<string>()
  const addedActions = new Map<string, InsightAction[]>()
  const actionState = new Map<string, Pick<InsightAction, 'status' | 'stage' | 'result_note'>>()
  // Răspunsurile clientului și comentariile din previzualizare; regulile oglindesc triggerele din `client_feedback`.
  const responses = new Map<string, ClientResponse & { userId: string }>()
  const comments = new Map<string, Array<InsightComment & { userId: string }>>()
  let feedbackSeq = 0
  let insightSeq = 0
  const me = (): Insight['author'] => {
    const role = getRole()
    return role === 'account' ? person('av') : person('ip')
  }
  const allInsights = (brandId: string): Insight[] => {
    const base = insightsFor(brandId).map((i) => edited.get(i.id) ?? i)
    const created = [...edited.values()].filter((i) => i.brand_id === brandId && !base.some((x) => x.id === i.id))
    return [...created, ...base]
      .filter((i) => !removed.has(i.id))
      .map((i) => ({
        ...i,
        recommendations: (i.recommendations ?? []).map((r) => {
          const x = responses.get(r.id)
          if (!x) return { ...r, client_response: null }
          const { userId, ...response } = x
          return { ...r, client_response: { ...response, own: userId === getUser().id } }
        }),
        comments: (comments.get(i.id) ?? []).map(({ userId, ...c }) => ({ ...c, own: userId === getUser().id })),
        actions: [...i.actions, ...(addedActions.get(i.id) ?? [])].map((a) => ({ ...a, stage: a.stage ?? STATUS_STAGE[a.status], ...(actionState.get(a.id) ?? {}) })),
      }))
  }
  const findInsight = (id: string): Insight | null => brandsFile.brands.flatMap((b) => allInsights(b.id)).find((i) => i.id === id) ?? null
  /** Analiza așa cum e stocată (fără acțiunile adăugate și stările lor, pe care `allInsights` le alipește la citire). */
  const rawInsight = (id: string): Insight | null => edited.get(id) ?? brandsFile.brands.flatMap((b) => insightsFor(b.id)).find((i) => i.id === id) ?? null
  const agencyOnly = <T,>(): ProviderResult<T> | null => (isAgencyRole(getRole()) ? null : failed<T>('Doar echipa agenției poate scrie analize și acțiuni.'))

  const insights: InsightsProvider = {
    list: async (ctx) => {
      const denied = guard<Insight[]>(ctx.brandId)
      if (denied) return denied
      // Ca `brand_insights`: analizele generate apar doar cu afișarea pornită (politica brandului și preferința personală).
      const ai = await assistant.settings(ctx.brandId)
      const display = ai.kind === 'ready' && ai.data.effective.display
      const all = allInsights(ctx.brandId).filter((i) => i.origin !== 'adsy_ai' || display)
      // Ca RLS pe server: clientul primește doar analizele publicate și acțiunile agreate sau mai departe.
      if (isAgencyRole(getRole())) return ready(all)
      return ready(all.filter((i) => i.status === 'published').map((i) => ({ ...i, actions: i.actions.filter((a) => a.stage !== 'proposed' && a.stage !== 'cancelled') })))
    },
    saveDraft: async (brand, id, draft) => {
      const denied = guard<{ id: string }>(brand.id) ?? agencyOnly<{ id: string }>()
      if (denied) return denied
      const current = id === null ? null : rawInsight(id)
      if (id !== null && (!current || current.status !== 'draft' || removed.has(current.id))) return failed('Doar o ciornă se poate edita.')
      const cmp = comparisonRange({ preset: 'custom', ...draft.period }, 'previous')
      const next: Insight = {
        id: current?.id ?? `insight-preview-${++insightSeq}`,
        brand_id: brand.id,
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        interpretation: draft.interpretation.trim(),
        author: current?.author ?? me(),
        period: draft.period,
        status: 'draft',
        // Proveniența nu se pierde la editare, ca pe server.
        ...(current?.origin ? { origin: current.origin } : {}),
        version: current?.version ?? 1,
        supersedes_id: current?.supersedes_id ?? null,
        recommendations: current?.recommendations ?? [],
        evidence: [...new Set(draft.evidence_keys)].map((k) => ({
          label: FIXTURE_DEFINITIONS.find((d) => d.metric_key === k)?.label ?? k,
          evidence_query: { metric_key: k, version: 1, brand_id: brand.id, period: { start: draft.period.from, end: draft.period.to }, comparison_period: { start: cmp.from, end: cmp.to } },
        })),
        limits: draft.limits.trim() || null,
        actions: current?.actions ?? [],
        updated_at: now().toISOString(),
        published_at: null,
      }
      edited.set(next.id, next)
      return ready({ id: next.id })
    },
    deleteDraft: async (id) => {
      const denied = agencyOnly<null>()
      if (denied) return denied
      const i = findInsight(id)
      if (!i) return failed('Analiză inexistentă sau fără acces.')
      if (i.status !== 'draft') return failed(`O analiză ${i.status} nu se șterge; istoricul se păstrează.`)
      removed.add(id)
      return ready(null)
    },
    transition: async (id, to, reason) => {
      const denied = agencyOnly<null>()
      if (denied) return denied
      const i = removed.has(id) ? null : rawInsight(id)
      if (!i) return failed('Analiză inexistentă sau fără acces.')
      const reviewer = getRole() === 'strategist' || getRole() === 'agency_admin'
      if (i.status === 'draft' && to === 'in_review') {
        const missing = [!i.title.trim() && 'titlu', !i.summary.trim() && 'constatare', !(i.interpretation ?? '').trim() && 'interpretare', !(i.limits ?? '').trim() && 'limite', i.evidence.length === 0 && 'dovezi'].filter(Boolean)
        if (missing.length > 0) return failed(`Analiza nu poate fi trimisă la review; lipsesc: ${missing.join(', ')}.`)
        edited.set(id, { ...i, status: 'in_review', updated_at: now().toISOString() })
      } else if (i.status === 'in_review' && to === 'draft') {
        if (!reviewer) return failed('Doar strategist sau agency_admin poate returna o analiză la draft.')
        if (!reason?.trim()) return failed('Returnarea la draft cere un motiv.')
        edited.set(id, { ...i, status: 'draft', updated_at: now().toISOString() })
      } else if (i.status === 'in_review' && to === 'published') {
        if (!reviewer) return failed('Doar strategist sau agency_admin poate publica.')
        const old = i.supersedes_id ? rawInsight(i.supersedes_id) : null
        if (i.supersedes_id && old?.status !== 'published') return failed('Versiunea înlocuită nu mai e publicată.')
        edited.set(id, { ...i, status: 'published', updated_at: now().toISOString(), published_at: now().toISOString() })
        if (old) edited.set(old.id, { ...old, status: 'superseded' })
      } else return failed(`Tranziție nepermisă: ${i.status} → ${to}.`)
      return ready(null)
    },
    supersede: async (brand, insight) => {
      const denied = guard<{ id: string }>(brand.id) ?? agencyOnly<{ id: string }>()
      if (denied) return denied
      const old = removed.has(insight.id) ? null : rawInsight(insight.id)
      if (!old || old.status !== 'published' || old.brand_id !== brand.id) return failed('Se poate înlocui doar o analiză publicată din același brand.')
      if ([...edited.values()].some((i) => i.supersedes_id === old.id && !removed.has(i.id))) return failed('Analiza are deja o versiune de înlocuire în lucru.')
      const id = `insight-preview-${++insightSeq}`
      edited.set(id, { ...old, id, status: 'draft', author: me(), version: (old.version ?? 1) + 1, supersedes_id: old.id, actions: [], recommendations: [...(old.recommendations ?? [])], updated_at: now().toISOString(), published_at: null })
      return ready({ id })
    },
    addRecommendation: async (brand, insightId, rec) => {
      const denied = guard<null>(brand.id) ?? agencyOnly<null>()
      if (denied) return denied
      const i = removed.has(insightId) ? null : rawInsight(insightId)
      if (!i) return failed('Analiză inexistentă sau fără acces.')
      if (i.status !== 'draft') return failed('Recomandările se modifică doar cât analiza e în draft.')
      const recs = [...(i.recommendations ?? []), { id: `rec-preview-${++insightSeq}`, problem: rec.problem.trim(), action: rec.action.trim(), expected_benefit: rec.expected_benefit.trim(), priority: rec.priority }]
      edited.set(i.id, { ...i, recommendations: recs.sort((a, b) => a.priority - b.priority) })
      return ready(null)
    },
    deleteRecommendation: async (id) => {
      const denied = agencyOnly<null>()
      if (denied) return denied
      const i = brandsFile.brands.flatMap((b) => allInsights(b.id)).find((x) => (x.recommendations ?? []).some((r) => r.id === id))
      const raw = i ? rawInsight(i.id) : null
      if (!raw) return failed('Recomandare inexistentă sau fără acces.')
      if (raw.status !== 'draft') return failed('Recomandările se modifică doar cât analiza e în draft.')
      edited.set(raw.id, { ...raw, recommendations: (raw.recommendations ?? []).filter((r) => r.id !== id) })
      return ready(null)
    },
    addAction: async (brand, insightId, action) => {
      const denied = guard<null>(brand.id) ?? agencyOnly<null>()
      if (denied) return denied
      const i = findInsight(insightId)
      if (!i) return failed('Analiză inexistentă sau fără acces.')
      if (i.status === 'superseded') return failed('Nu se adaugă acțiuni la o analiză înlocuită.')
      const def = action.tracked_metric_key ? FIXTURE_DEFINITIONS.find((d) => d.metric_key === action.tracked_metric_key) : null
      if (action.tracked_metric_key && !def) return failed(`Indicatorul urmărit nu există în registrul de metrici: ${action.tracked_metric_key}.`)
      const list = addedActions.get(insightId) ?? []
      let owner = me()
      if (action.owner_id) {
        // Ca triggerul `actions_before_write`: responsabilul e un membru activ al agenției, nu un client.
        const all = await admin.users.people()
        const p = all.kind === 'ready' ? all.data.find((x) => x.user_id === action.owner_id && x.membership_active && x.role !== 'client_viewer') : undefined
        if (!p) return failed('Responsabilul trebuie să fie un membru activ al agenției.')
        owner = { id: p.user_id, name: p.name ?? p.email ?? p.user_id, role: 'Echipa agenției' }
      }
      list.push({ id: `action-preview-${++insightSeq}`, title: action.title.trim(), owner, due: action.due, status: 'open', stage: 'proposed', effort: action.effort?.trim() || null, tracked_metric: def ? { metric_key: def.metric_key, label: def.label } : null, result_note: null })
      addedActions.set(insightId, list)
      return ready(null)
    },
    transitionAction: async (actionId, t) => {
      const denied = agencyOnly<null>()
      if (denied) return denied
      const a = brandsFile.brands.flatMap((b) => allInsights(b.id)).flatMap((i) => i.actions).find((x) => x.id === actionId)
      if (!a) return failed('Acțiune inexistentă sau fără acces.')
      const from = a.stage ?? STATUS_STAGE[a.status]
      if (!ACTION_NEXT[from].includes(t.to)) return failed(`Tranziție nepermisă: ${from} → ${t.to}.`)
      if (t.to === 'cancelled' && !t.reason?.trim()) return failed('Anularea cere un motiv.')
      if (t.to === 'measured' && !t.result_note?.trim()) return failed('Starea measured cere rezultatul urmărit (result_note).')
      actionState.set(actionId, { stage: t.to, status: STAGE_STATUS[t.to], result_note: t.to === 'measured' ? (t.result_note?.trim() ?? null) : (a.result_note ?? null) })
      return ready(null)
    },
    respondToRecommendation: async (recommendationId, response, comment) => {
      const insight = brandsFile.brands.filter((b) => allowed.has(b.id)).flatMap((b) => allInsights(b.id)).find((i) => (i.recommendations ?? []).some((r) => r.id === recommendationId))
      // Același mesaj pentru „nu există”, „nu e publicată” și „fără acces”, ca pe server.
      if (!insight || insight.status !== 'published') return failed('Recomandare inexistentă sau fără acces.')
      if (getRole() !== 'client_viewer') return failed('Doar clientul răspunde la o recomandare.')
      const text = comment?.trim() || null
      if (response === 'adjustment_requested' && !text) return failed('Scrie ce ajustare ceri.')
      const me = getUser().id
      responses.set(recommendationId, { response, comment: text, at: now().toISOString(), by: `Utilizator ${me.slice(0, 8)}`, own: true, userId: me })
      return ready(null)
    },
    addComment: async (insightId, body) => {
      const insight = brandsFile.brands.filter((b) => allowed.has(b.id)).flatMap((b) => allInsights(b.id)).find((i) => i.id === insightId)
      if (!insight || insight.status !== 'published') return failed('Analiză inexistentă sau fără acces.')
      const text = body.trim()
      if (!text || text.length > 2000) return failed('Comentariul are între 1 și 2.000 de caractere.')
      const me = getUser().id
      comments.set(insightId, [...(comments.get(insightId) ?? []), { id: `comment-preview-${++feedbackSeq}`, body: text, created_at: now().toISOString(), author_role: isAgencyRole(getRole()) ? 'agency' : 'client', author: `Utilizator ${me.slice(0, 8)}`, own: true, userId: me }])
      return ready(null)
    },
  }

  // Marcajele PV rămân în memorie cât ține sesiunea de previzualizare; mențiunile și răspunsurile AI le împart.
  // `flagMeta` păstrează ce are nevoie jurnalul: brandul, utilizatorul, începutul textului, linkul și destinatarii.
  const flags = new Map<string, PvFlag>()
  interface FlagMeta {
    brandId: string
    user: string
    excerpt: string
    link: string | null
    notifiedTo: string[]
  }
  const flagMeta = new Map<string, FlagMeta>()
  const aiFx = createAiFixtures({ allowed, flags, now })
  const search = createSearchFixtures(allowed)
  const traffic = createTrafficFixtures({ allowed, now })
  const paid = createPaidFixtures({ allowed, now })
  const social = createSocialFixtures({ allowed, now })
  const flagKey = (item: PvItemRef) => `${item.kind}:${item.id}`
  const excerptOf = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}...` : text)

  const mentionsFor = (brandId: string): Mention[] =>
    mentionsFile.mentions
      .filter((m) => m.brand_id === brandId)
      .map((m) => ({
        id: m.id,
        brand_id: m.brand_id,
        source_name: m.source_name,
        author: m.author,
        published_at: instantDaysAgo(m.days_ago, 8 + (m.days_ago % 9)),
        text: m.text,
        url: m.url,
        // Sentimentul rămâne null până la revizuirea umană; nu se deduce.
        sentiment: m.sentiment as Sentiment | null,
        reviewed_by: m.reviewed_by,
        pv_flag: flags.get(flagKey({ kind: 'mention', id: m.id })) ?? null,
        owned_account: (m as { owned_account?: boolean | null }).owned_account ?? false,
      }))
  const inPeriod = (ctx: QueryContext, brandId: string) =>
    mentionsFor(brandId).filter((m) => m.published_at.slice(0, 10) >= ctx.period.from && m.published_at.slice(0, 10) <= addDays(ctx.period.to, 1))

  // Un marcaj preexistent (cineva din echipă a marcat o relatare acum o zi), ca jurnalul și starea „marcat" să fie vizibile.
  {
    const seeded: PvItemRef = { kind: 'mention', id: 'm-u-5' }
    const m = mentionsFile.mentions.find((x) => x.id === seeded.id)
    if (m) {
      flags.set(flagKey(seeded), { id: 'pv-0', item: seeded, flagged_at: instantDaysAgo(1, 9), flagged_by: 'preview-admin', notified: true, status: 'notified' })
      flagMeta.set(flagKey(seeded), { brandId: m.brand_id, user: 'Ioana Popescu, AdSymphony', excerpt: excerptOf(m.text), link: m.url, notifiedTo: mentionsFile.pv_contacts })
    }
  }

  const mentions: MentionsProvider = {
    list: async (ctx, q) => {
      const denied = guard<never>(ctx.brandId)
      if (denied) return denied
      const filtered = inPeriod(ctx, ctx.brandId)
        .filter((m) => (q.sentiment === 'unreviewed' ? m.sentiment === null : q.sentiment ? m.sentiment === q.sentiment : true))
        .filter((m) => (q.source ? m.source_name === q.source : true))
        .filter((m) => (q.author === 'owned' ? m.owned_account === true : q.author === 'external' ? m.owned_account !== true : true))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
      const start = (q.page - 1) * q.page_size
      // Mențiunile fictive au toate text și link: niciuna „fără conținut”.
      return ready({ items: filtered.slice(start, start + q.page_size), total: filtered.length, page: q.page, page_size: q.page_size, without_content: 0 })
    },
    sources: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      return ready([...new Set(mentionsFor(brandId).map((m) => m.source_name))].sort((a, b) => a.localeCompare(b, 'ro')))
    },
    sentiment: async (ctx) => {
      const denied = guard<never>(ctx.brandId)
      if (denied) return denied
      const inRange = inPeriod(ctx, ctx.brandId)
      const all = inRange.filter((m) => m.owned_account !== true)
      const reviewed = all.filter((m) => m.sentiment !== null)
      const count = (s: Sentiment) => reviewed.filter((m) => m.sentiment === s).length
      // Procentele sunt stand-in pentru calculul serverului (doar fixtures).
      const share = (n: number) => (reviewed.length ? Math.round((1000 * n) / reviewed.length) / 10 : null)
      return ready({
        total: reviewed.length,
        positive: count('positive'),
        neutral: count('neutral'),
        negative: count('negative'),
        unreviewed: all.length - reviewed.length,
        without_content: 0,
        owned_excluded: inRange.length - all.length,
        shares: { positive: share(count('positive')), neutral: share(count('neutral')), negative: share(count('negative')) },
      })
    },
    pvLog: async (ctx) => {
      const denied = guard<never>(ctx.brandId)
      if (denied) return denied
      // Brief cap. 6 și spec cap. 28: jurnalul e vizibil pentru agency admin.
      if (getRole() !== 'agency_admin') return failed('Jurnalul de farmacovigilență e vizibil doar administratorilor agenției.')
      return ready(
        [...flags.entries()]
          .flatMap(([k, f]) => {
            const meta = flagMeta.get(k)
            return meta && meta.brandId === ctx.brandId ? [{ id: f.id, item: f.item, flagged_at: f.flagged_at, user: meta.user, excerpt: meta.excerpt, link: meta.link, notified: f.notified, notified_to: meta.notifiedTo, status: f.status }] : []
          })
          .sort((a, b) => b.flagged_at.localeCompare(a.flagged_at)),
      )
    },
    pvPreview: async (brandId, item) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const m = item.kind === 'mention' ? mentionsFor(brandId).find((x) => x.id === item.id) : null
      if (item.kind === 'mention' && !m) return failed('Mențiunea nu a fost găsită.')
      const answerText = item.kind === 'ai_answer' ? aiFx.plainText(brandId, item.id) : null
      if (item.kind === 'ai_answer' && !answerText) return failed('Răspunsul nu a fost găsit sau nu are text de marcat.')
      return ready({
        item,
        at: now().toISOString(),
        user: `${getUser().name}, ${getUser().organization}`,
        link: m?.url ?? null,
        text: m?.text ?? answerText ?? '',
        notify: mentionsFile.pv_contacts,
      })
    },
    pvFlag: async (brandId, item) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const existing = flags.get(flagKey(item))
      if (existing) return ready(existing)
      const m = item.kind === 'mention' ? mentionsFor(brandId).find((x) => x.id === item.id) : null
      const text = m?.text ?? (item.kind === 'ai_answer' ? aiFx.plainText(brandId, item.id) : null)
      if (!text) return failed('Elementul nu a fost găsit sau nu are text de marcat.')
      const flag: PvFlag = { id: `pv-${flags.size + 1}`, item, flagged_at: now().toISOString(), flagged_by: getUser().id, notified: true, status: 'notified' }
      flags.set(flagKey(item), flag)
      flagMeta.set(flagKey(item), { brandId, user: `${getUser().name}, ${getUser().organization}`, excerpt: excerptOf(text), link: m?.url ?? null, notifiedTo: mentionsFile.pv_contacts })
      return ready(flag)
    },
  }

  const statusesFile = sourcesFile.statuses as Record<string, Array<{ provider: string; state: string; description: string; data_days_ago: number | null; imported_days_ago: number | null; note: string | null }>>
  const connectionsFile = sourcesFile.connections as Record<string, Array<{ id: string; provider: string; external_account_id: string; display_name: string | null; credential_status: string; last_validated_days_ago: number | null; last_validation_error: string | null; credential_updated_by: string | null; credential_updated_days_ago: number | null; calls_today: number }>>
  const runsFile = sourcesFile.sync_runs as Record<string, Array<{ id: string; provider: string; days_ago: number; duration_s: number; rows: number; status: string; error: string | null }>>

  const createdConnections: SourceConnection[] = []
  const connectionPatch = new Map<string, Partial<SourceConnection>>()

  // Conturile la nivel de client (previzualizare): SEOmonitor configurat, cheia Google încă lipsă.
  const tenantConnectionsMem: TenantConnection[] = [
    { id: '00000000-0000-4000-9000-000000000001', tenant_id: brandsFile.tenant_id, provider: 'seomonitor', external_account_id: '4821', display_name: 'SEOmonitor STADA', credential_status: 'valid', credential_updated_at: instantDaysAgo(20) },
  ]
  const sources: SourcesProvider = {
    statuses: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      return ready(
        (statusesFile[brandId] ?? []).map<SourceStatusInfo>((s) => ({
          provider: s.provider as SourceProviderId,
          state: s.state as SourceState,
          description: s.description,
          data_as_of: s.data_days_ago === null ? null : daysAgo(s.data_days_ago),
          imported_at: s.imported_days_ago === null ? null : instantDaysAgo(s.imported_days_ago, 6),
          note: s.note,
        })),
      )
    },
    freshness: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      return ready(
        (statusesFile[brandId] ?? [])
          .filter((s) => s.provider !== 'csv_import' && s.provider !== 'airbyte')
          .map<SourceFreshness>((s) => ({
            provider: s.provider as SourceProviderId,
            data_as_of: s.data_days_ago === null ? null : daysAgo(s.data_days_ago),
            freshness: s.data_days_ago === null ? 'no_data' : s.state === 'stale' ? 'delayed' : 'current',
          })),
      )
    },
    connections: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      if (!isAgencyRole(getRole())) return failed('Conexiunile și credențialele sunt vizibile doar echipei AdSymphony.')
      const fromFile = (connectionsFile[brandId] ?? []).map<SourceConnection>((c) => ({
        id: c.id,
        brand_id: brandId,
        provider: c.provider as SourceProviderId,
        external_account_id: c.external_account_id,
        display_name: c.display_name,
        credential_status: c.credential_status as CredentialStatus,
        last_validated_at: c.last_validated_days_ago === null ? null : instantDaysAgo(c.last_validated_days_ago, 7),
        last_validation_error: c.last_validation_error,
        credential_updated_by: c.credential_updated_by,
        credential_updated_at: c.credential_updated_days_ago === null ? null : instantDaysAgo(c.credential_updated_days_ago, 11),
        calls_today: c.calls_today,
        daily_call_budget: 10,
      }))
      const added = createdConnections.filter((c) => c.brand_id === brandId)
      return ready([...fromFile, ...added].map((c) => ({ ...c, ...(connectionPatch.get(c.id) ?? {}) })))
    },
    syncRuns: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      return ready(
        (runsFile[brandId] ?? []).map<SyncRun>((r) => {
          const started = instantDaysAgo(r.days_ago, 6)
          return {
            id: r.id,
            brand_id: brandId,
            provider: r.provider as SourceProviderId,
            connection_id: null,
            range_from: daysAgo(r.days_ago + 6),
            range_to: daysAgo(r.days_ago),
            started_at: started,
            finished_at: new Date(new Date(started).getTime() + r.duration_s * 1000).toISOString(),
            rows: r.rows,
            status: r.status as SyncRunStatus,
            error: r.error,
            // Ca la sursa reală: motivul vine din codul de eroare al rulării fictive.
            reason: runReason(r.status as SyncRunStatus, r.error ? [{ code: r.error }] : [], null, r.provider),
            error_codes: runErrorCodes(r.error ? [{ code: r.error }] : [], r.provider),
          }
        }),
      )
    },
    // Simulare în memorie, doar pentru previzualizare: nimic nu pleacă spre un server.
    createConnection: async (brandId, input) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      if (getRole() !== 'agency_admin') return failed('Doar administratorii agenției pot adăuga conexiuni.')
      const conn: SourceConnection = {
        id: `00000000-0000-4000-8000-${String(100000000000 + createdConnections.length).slice(-12)}`,
        brand_id: brandId,
        provider: input.provider,
        external_account_id: input.external_account_id,
        display_name: input.display_name,
        credential_status: 'missing',
        last_validated_at: null,
        last_validation_error: null,
        credential_updated_by: null,
        credential_updated_at: null,
        calls_today: 0,
        daily_call_budget: 10,
      }
      createdConnections.push(conn)
      return ready(conn)
    },
    setToken: async (connectionId, token) => {
      if (getRole() !== 'agency_admin') return failed('Doar administratorii agenției pot seta tokenuri.')
      if (token.trim() === '') return failed('Token gol sau prea lung.')
      connectionPatch.set(connectionId, { ...(connectionPatch.get(connectionId) ?? {}), credential_status: 'unverified', last_validation_error: null })
      return ready({ connection_id: connectionId, credential_status: 'unverified' as CredentialStatus })
    },
    validate: async (connectionId) => {
      if (getRole() !== 'agency_admin') return failed('Doar administratorii agenției pot testa conexiuni.')
      const all = [
        ...Object.values(connectionsFile).flat().map((c) => ({ id: c.id, calls: c.calls_today, status: c.credential_status })),
        ...createdConnections.map((c) => ({ id: c.id, calls: c.calls_today, status: c.credential_status })),
        ...tenantConnectionsMem.map((c) => ({ id: c.id, calls: 0, status: c.credential_status })),
      ]
      const base = all.find((c) => c.id === connectionId)
      if (!base) return failed('Conexiune inexistentă sau inactivă.')
      const patch = connectionPatch.get(connectionId) ?? {}
      const status = (patch.credential_status ?? base.status) as CredentialStatus
      const used = patch.calls_today ?? base.calls
      if (status === 'missing') return failed('Conexiunea nu are token.')
      if (used >= 10) {
        return ready({ connection_id: connectionId, credential_status: status, calls_today: used, daily_limit: 10, outcome: 'budget_exhausted' as const, message: 'Bugetul zilnic de 10 apeluri e consumat. Testarea nu a fost rulată.' })
      }
      connectionPatch.set(connectionId, { ...patch, credential_status: 'valid', calls_today: used + 1, last_validated_at: now().toISOString(), last_validation_error: null })
      return ready({ connection_id: connectionId, credential_status: 'valid' as CredentialStatus, calls_today: used + 1, daily_limit: 10, outcome: 'valid' as const, message: 'Conexiunea funcționează.' })
    },
    listAccounts: async (connectionId, kind, campaignId) => {
      if (getRole() !== 'agency_admin') return failed('Doar administratorii agenției pot lista conturile.')
      const conn = tenantConnectionsMem.find((c) => c.id === connectionId)
      if (!conn) return failed('Conexiune inexistentă sau inactivă.')
      if ((connectionPatch.get(conn.id)?.credential_status ?? conn.credential_status) === 'missing') return failed('Cheia clientului nu e salvată.')
      connectionPatch.set(conn.id, { ...(connectionPatch.get(conn.id) ?? {}), credential_status: 'valid' })
      // Previzualizare: conturi construite din spațiile clientului, ca selectorul să aibă ce arăta.
      if (kind === 'seomonitor_groups') {
        const brand = (brandsFile.brands as Array<{ id: string; name: string }>)[Number(campaignId) - 500]
        const accounts = brand
          ? [
              { id: '-1', name: 'Brand', detail: 'folder' },
              { id: `${campaignId}1`, name: `${brand.name} brand`, detail: 'group în Brand' },
              { id: `${campaignId}2`, name: `${brand.name} generic`, detail: 'group' },
            ]
          : []
        return ready({ outcome: 'ok' as const, credential_status: 'valid' as CredentialStatus, accounts, truncated: false, message: null })
      }
      const spaces = (brandsFile.brands as Array<{ id: string; name: string; domain: string | null }>)
      const accounts = spaces.map((b, i) => {
        const domain = b.domain ?? `${b.id}.example`
        if (kind === 'ga4') return { id: String(410000000 + i), name: b.name, detail: 'STADA România' }
        if (kind === 'gsc') return { id: `sc-domain:${domain}`, name: `sc-domain:${domain}`, detail: 'Domain property' }
        if (kind === 'planable') return { id: `ws-${b.id}`, name: b.name, detail: 'Europe/Bucharest' }
        if (kind === 'meta_ads') return { id: `act_${1000 + i}`, name: `${b.name} RO`, detail: 'RON' }
        if (kind === 'airbyte') return { id: `meta_ads:${1000000000 + i}`, name: `${b.name} RO`, detail: 'Meta Ads · ID ' + String(1000000000 + i) }
        return { id: String(500 + i), name: b.name, detail: domain }
      })
      return ready({ outcome: 'ok' as const, credential_status: 'valid' as CredentialStatus, accounts, truncated: false, message: null })
    },
    // Previzualizare: o destinație Airbyte fictivă, construită din spațiile clientului; nimic nu pleacă spre un server.
    inspectAirbyte: async (connectionId) => {
      if (getRole() !== 'agency_admin') return failed('Doar agency_admin al clientului poate gestiona sursele.')
      const conn = tenantConnectionsMem.find((c) => c.id === connectionId)
      if (!conn) return failed('Conexiune inexistentă sau inactivă.')
      if ((connectionPatch.get(conn.id)?.credential_status ?? conn.credential_status) === 'missing') return failed('Connection string-ul nu e salvat.')
      connectionPatch.set(conn.id, { ...(connectionPatch.get(conn.id) ?? {}), credential_status: 'valid' })
      const spaces = brandsFile.brands as Array<{ id: string; name: string }>
      const synced = instantDaysAgo(0, 3)
      const accounts = spaces.map((b, i) => ({
        id: `meta_ads:${1000000000 + i}`, name: `${b.name} RO`, detail: `Meta Ads · ID ${1000000000 + i}`, platform: 'meta_ads' as const, account_id: String(1000000000 + i),
        rows: 55, first_date: daysAgo(56), last_date: daysAgo(1), last_synced_at: synced, tables: 1,
      }))
      const table = { schema: 'meta', table: 'ads_insights', role: 'report' as const, level: 'ad', rows: 55 * spaces.length, accounts: spaces.length, first_date: daysAgo(56), last_date: daysAgo(1), last_synced_at: synced, metrics: ['actions', 'clicks', 'impressions', 'reach', 'spend'], dimensions: [], error: null }
      return ready({
        outcome: 'ok' as const, credential_status: 'valid' as CredentialStatus, message: `Previzualizare: ${accounts.length} conturi în 1 tabel (Meta Ads).`,
        calls_today: 1, daily_limit: 30, inspected_at: now().toISOString(),
        platforms: [{ platform: 'meta_ads' as const, label: 'Meta Ads', tables: [table] }], accounts, truncated: false,
      })
    },
    tenantConnections: async (tenantId) => {
      if (!isAgencyRole(getRole())) return failed('Conexiunile și credențialele sunt vizibile doar echipei AdSymphony.')
      return ready(
        tenantConnectionsMem
          .filter((c) => c.tenant_id === tenantId)
          .map((c) => {
            const patch = connectionPatch.get(c.id)
            return patch?.credential_status ? { ...c, credential_status: patch.credential_status as CredentialStatus, credential_updated_at: now().toISOString() } : { ...c }
          }),
      )
    },
    // Previzualizare: nu se deschide furnizorul; contul apare conectat, iar adresa e goală (UI-ul afișează simularea).
    startOAuth: async (tenantId, provider, accountLabel) => {
      if (getRole() !== 'agency_admin') return failed('Doar agency_admin al clientului poate conecta conturi.')
      const accountProvider = provider === 'google_ads' ? 'google_ads_account' : 'tiktok_account'
      const label = provider === 'google_ads' ? (accountLabel ?? '').replace(/-/g, '') : 'TikTok Business (2 conturi)'
      if (provider === 'google_ads' && !/^\d{10}$/.test(label)) return failed('ID-ul contului de manager Google Ads (MCC) are 10 cifre, de ex. 123-456-7890.')
      const existing = tenantConnectionsMem.find((c) => c.tenant_id === tenantId && c.provider === accountProvider)
      if (existing) Object.assign(existing, { external_account_id: label, credential_status: 'valid', credential_updated_at: now().toISOString() })
      else tenantConnectionsMem.push({ id: `00000000-0000-4000-9000-${String(100000000000 + tenantConnectionsMem.length).slice(-12)}`, tenant_id: tenantId, provider: accountProvider, external_account_id: label, display_name: null, credential_status: 'valid', credential_updated_at: now().toISOString() })
      return ready({ authorize_url: '' })
    },
    createTenantConnection: async (tenantId, input) => {
      if (getRole() !== 'agency_admin') return failed('Doar administratorii agenției pot adăuga conexiuni.')
      if (tenantConnectionsMem.some((c) => c.tenant_id === tenantId && c.provider === input.provider && c.external_account_id === input.external_account_id)) return failed('Există deja o conexiune pentru acest cont.')
      const conn: TenantConnection = { id: `00000000-0000-4000-9000-${String(100000000000 + tenantConnectionsMem.length).slice(-12)}`, tenant_id: tenantId, provider: input.provider, external_account_id: input.external_account_id, display_name: input.display_name, credential_status: 'missing', credential_updated_at: null }
      tenantConnectionsMem.push(conn)
      return ready({ ...conn })
    },
  }

  const brands: BrandsProvider = {
    list: async () => ready(brandsFile.brands.map<Brand>((b) => ({ ...b, tenant_id: brandsFile.tenant_id, tenant_name: 'STADA România' }))),
    competitorSet: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const set = (brandsFile.competitor_sets as Record<string, { version: number; effective_from: string; competitors: Array<{ id: string; name: string; label: string }> }>)[brandId]
      return set ? ready({ brand_id: brandId, ...set }) : notConnected('Setul de competitori nu e configurat pentru acest brand.')
    },
  }

  const competition = createCompetitionFixtures({ allowed, ai: aiFx, search, social, mentions })

  const admin = createAdminFixtures({ now, getRole, getUserId: () => getUser().id, allowed })
  const clients = createClientsFixtures({ now, getRole, connections: (brandId) => (connectionsFile[brandId] ?? []).length })

  const assistant = createAssistantFixtures({
    allowed,
    getRole,
    metrics,
    createDraft: async (ctx, draft) => {
      const found = brandsFile.brands.find((b) => b.id === ctx.brandId)
      if (!found) return null
      const brand: Brand = { ...found, tenant_id: brandsFile.tenant_id, tenant_name: 'STADA România' }
      const saved = await insights.saveDraft(brand, null, draft)
      if (saved.kind !== 'ready') return null
      const created = edited.get(saved.data.id)
      if (created) edited.set(created.id, { ...created, origin: 'adsy_ai' })
      return saved.data.id
    },
  })
  return { kind: 'fixtures', metrics, insights, mentions, sources, brands, ai: aiFx.provider, search, traffic, paid, social, competition, assistant, users: admin.users, config: admin.config, clients }
}

type ProviderGuard<T> = Extract<import('../../contracts').ProviderResult<T>, { kind: 'error' }>
