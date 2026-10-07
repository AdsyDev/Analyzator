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
  type Insight,
  type InsightsProvider,
  type Mention,
  type MentionsProvider,
  type MetricsProvider,
  type PvFlag,
  type PvItemRef,
  type QueryContext,
  type Role,
  type SessionUser,
  type SourceConnection,
  type SourceProviderId,
  type SourceState,
  type SourceStatusInfo,
  type SourcesProvider,
  type SyncRun,
  type SyncRunStatus,
  type CredentialStatus,
  type Sentiment,
} from '../../contracts'
import { addDays, comparisonRange, todayBucharest } from '../../lib/period'
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

  const insights: InsightsProvider = {
    list: async (ctx) => {
      const denied = guard<Insight[]>(ctx.brandId)
      if (denied) return denied
      const all = insightsFor(ctx.brandId)
      // Ca RLS pe server: clientul primește doar analizele publicate.
      return ready(isAgencyRole(getRole()) ? all : all.filter((i) => i.status === 'published'))
    },
  }

  // Marcajele PV rămân în memorie cât ține sesiunea de previzualizare.
  const flags = new Map<string, PvFlag>()
  const flagKey = (item: PvItemRef) => `${item.kind}:${item.id}`
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
        sentiment: m.sentiment as Sentiment,
        reviewed_by: m.reviewed_by,
        pv_flag: flags.get(flagKey({ kind: 'mention', id: m.id })) ?? null,
      }))

  const mentions: MentionsProvider = {
    list: async (ctx, q) => {
      const denied = guard<never>(ctx.brandId)
      if (denied) return denied
      const filtered = mentionsFor(ctx.brandId)
        .filter((m) => m.published_at.slice(0, 10) >= ctx.period.from && m.published_at.slice(0, 10) <= addDays(ctx.period.to, 1))
        .filter((m) => (q.sentiment ? m.sentiment === q.sentiment : true) && (q.source ? m.source_name === q.source : true))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
      const start = (q.page - 1) * q.page_size
      return ready({ items: filtered.slice(start, start + q.page_size), total: filtered.length, page: q.page, page_size: q.page_size })
    },
    sentiment: async (ctx) => {
      const denied = guard<never>(ctx.brandId)
      if (denied) return denied
      const all = mentionsFor(ctx.brandId)
      const count = (s: Sentiment) => all.filter((m) => m.sentiment === s).length
      return ready({ total: all.length, positive: count('positive'), neutral: count('neutral'), negative: count('negative') })
    },
    pvLog: async (ctx) => {
      if (!isAgencyRole(getRole())) return failed('Jurnalul de farmacovigilență e vizibil doar echipei AdSymphony și contactelor PV.')
      return ready([...flags.values()].filter((f) => mentionsFor(ctx.brandId).some((m) => m.id === f.item.id)))
    },
    pvPreview: async (brandId, item) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const m = item.kind === 'mention' ? mentionsFor(brandId).find((x) => x.id === item.id) : null
      if (item.kind === 'mention' && !m) return failed('Mențiunea nu a fost găsită.')
      return ready({
        item,
        at: now().toISOString(),
        user: `${getUser().name}, ${getUser().organization}`,
        link: m?.url ?? null,
        text: m?.text ?? 'Răspuns AI fictiv, pentru previzualizare.',
        notify: mentionsFile.pv_contacts,
      })
    },
    pvFlag: async (brandId, item) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const existing = flags.get(flagKey(item))
      if (existing) return ready(existing)
      const flag: PvFlag = { id: `pv-${flags.size + 1}`, item, flagged_at: now().toISOString(), flagged_by: getUser().id, notified: true, status: 'notified' }
      flags.set(flagKey(item), flag)
      return ready(flag)
    },
  }

  const statusesFile = sourcesFile.statuses as Record<string, Array<{ provider: string; state: string; description: string; data_days_ago: number | null; imported_days_ago: number | null; note: string | null }>>
  const connectionsFile = sourcesFile.connections as Record<string, Array<{ id: string; provider: string; external_account_id: string; display_name: string | null; credential_status: string; last_validated_days_ago: number | null; last_validation_error: string | null; credential_updated_by: string | null; credential_updated_days_ago: number | null; calls_today: number }>>
  const runsFile = sourcesFile.sync_runs as Record<string, Array<{ id: string; provider: string; days_ago: number; duration_s: number; rows: number; status: string; error: string | null }>>

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
    connections: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      if (!isAgencyRole(getRole())) return failed('Conexiunile și credențialele sunt vizibile doar echipei AdSymphony.')
      return ready(
        (connectionsFile[brandId] ?? []).map<SourceConnection>((c) => ({
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
        })),
      )
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
            range_from: daysAgo(r.days_ago + 6),
            range_to: daysAgo(r.days_ago),
            started_at: started,
            finished_at: new Date(new Date(started).getTime() + r.duration_s * 1000).toISOString(),
            rows: r.rows,
            status: r.status as SyncRunStatus,
            error: r.error,
          }
        }),
      )
    },
  }

  const brands: BrandsProvider = {
    list: async () => ready(brandsFile.brands.map<Brand>((b) => ({ ...b, tenant_id: brandsFile.tenant_id }))),
    competitorSet: async (brandId) => {
      const denied = guard<never>(brandId)
      if (denied) return denied
      const set = (brandsFile.competitor_sets as Record<string, { version: number; effective_from: string; competitors: Array<{ id: string; name: string; label: string }> }>)[brandId]
      return set ? ready({ brand_id: brandId, ...set }) : notConnected('Setul de competitori nu e configurat pentru acest brand.')
    },
  }

  return { kind: 'fixtures', metrics, insights, mentions, sources, brands }
}

type ProviderGuard<T> = Extract<import('../../contracts').ProviderResult<T>, { kind: 'error' }>
