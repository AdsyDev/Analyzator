import {
  failed,
  INSIGHT_STATUSES,
  notConnected,
  ready,
  type Insight,
  type InsightsProvider,
  type Mention,
  type MentionPage,
  type MentionsProvider,
  type Page,
  type PvFlag,
  type PvLogEntry,
  type PvSnapshot,
  type SentimentDistribution,
} from '../../contracts'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'
import { todayBucharest } from '../../lib/period'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const NO_LISTENING = 'Sursa de Listening nu este conectată pentru acest brand.'
const short = (id: string) => `utilizator ${id.slice(0, 8)}`
const rpcError = (e: { code?: string } | null) => (e?.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
const PV_STATUS: Record<string, PvFlag['status']> = { open: 'pending', notified: 'notified', transmitted: 'acknowledged', closed: 'acknowledged' }

async function currentUser(client: DataClient): Promise<string | null> {
  const { data } = await client.auth.getSession()
  return data.session?.user.id ?? null
}

/** Listening (mențiuni și farmacovigilență) prin sesiunea utilizatorului: RPC INVOKER și tabele cu RLS (D-13). */
export function createSupabaseMentions(client: DataClient): MentionsProvider {
  return {
    async list(ctx, q) {
      const { data, error } = await client.rpc('brand_mentions', {
        p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to,
        p_sentiment: q.sentiment, p_source: q.source, p_page: q.page, p_page_size: q.page_size, p_author: q.author ?? 'all',
      })
      if (error) return failed(rpcError(error))
      const d = data as (Page<Mention> & { without_content?: unknown }) | null
      if (!d || !Array.isArray(d.items) || typeof d.total !== 'number') return failed(CONTRACT)
      // Un server mai vechi nu trimite câmpul: atunci nu există mențiuni fără conținut de raportat.
      const page: MentionPage = { items: d.items, total: d.total, page: d.page, page_size: d.page_size, without_content: typeof d.without_content === 'number' ? d.without_content : 0 }
      if (d.total === 0 && q.page === 1 && !q.sentiment && !q.source && !q.author) {
        const s = await this.sentiment(ctx)
        if (s.kind === 'not_connected') return s
      }
      return ready(page)
    },

    async sentiment(ctx) {
      const { data, error } = await client.rpc('brand_mention_sentiment', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as (SentimentDistribution & { connected?: boolean }) | null
      if (!d || typeof d.total !== 'number' || typeof d.owned_excluded !== 'number') return failed(CONTRACT)
      if (d.connected === false) return notConnected(NO_LISTENING)
      const { connected: _c, ...dist } = d
      return ready({ ...dist, without_content: typeof dist.without_content === 'number' ? dist.without_content : 0 } as SentimentDistribution)
    },

    async sources(brandId) {
      const { data, error } = await client.from('mentions').select('source_name').eq('brand_id', brandId).order('source_name').limit(5000)
      if (error) return failed(QUERY_FAILED)
      return ready([...new Set(((data ?? []) as Array<{ source_name: string | null }>).map((r) => r.source_name).filter((s): s is string => !!s))])
    },

    async pvLog(ctx) {
      const { data, error } = await client
        .from('pv_flags')
        .select('id, entity_type, entity_ref, flagged_at, flagged_by, text_snapshot, link, status')
        .eq('brand_id', ctx.brandId)
        .order('flagged_at', { ascending: false })
        .limit(500)
      if (error) return failed(error.code === '42501' ? 'Jurnalul de farmacovigilență e disponibil doar administratorilor agenției.' : QUERY_FAILED)
      const rows = (data ?? []) as Array<{ id: string; entity_type: string; entity_ref: string; flagged_at: string; flagged_by: string; text_snapshot: string; link: string | null; status: string }>
      return ready(
        rows
          .filter((r) => {
            const day = todayBucharest(new Date(r.flagged_at))
            return day >= ctx.period.from && day <= ctx.period.to
          })
          .map<PvLogEntry>((r) => ({
            id: r.id,
            item: { kind: r.entity_type === 'ai_answer' ? 'ai_answer' : 'mention', id: r.entity_ref },
            flagged_at: r.flagged_at,
            user: short(r.flagged_by),
            excerpt: r.text_snapshot.slice(0, 280),
            link: r.link,
            notified: r.status !== 'open',
            // Destinatarii se rezolvă la trimitere (B7-11); jurnalul de notificări e în pv_notifications.
            notified_to: [],
            status: PV_STATUS[r.status] ?? 'pending',
          })),
      )
    },

    async pvPreview(brandId, item) {
      const me = await currentUser(client)
      if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      let text: string | null = null
      let link: string | null = null
      if (item.kind === 'mention') {
        const { data, error } = await client.from('mentions').select('text, url').eq('brand_id', brandId).eq('native_id', item.id).maybeSingle()
        if (error) return failed(QUERY_FAILED)
        const m = data as { text: string | null; url: string | null } | null
        if (!m) return failed('Mențiunea nu există în acest brand.')
        text = m.text || '(mențiune fără text în sursă)'
        link = m.url
      } else {
        const { data, error } = await client.from('ai_answers').select('content').eq('brand_id', brandId).eq('id', item.id).maybeSingle()
        if (error) return failed(QUERY_FAILED)
        const a = data as { content: string | null } | null
        if (!a) return failed('Răspunsul AI nu există în acest brand.')
        text = a.content || '(răspuns fără conținut text)'
      }
      // Contactele PV sunt vizibile doar agency_admin; ceilalți văd că notificarea pleacă spre contactele configurate.
      const contacts = await client.from('pv_contacts').select('email').eq('active', true)
      const notify = contacts.error ? [] : ((contacts.data ?? []) as Array<{ email: string }>).map((c) => c.email)
      const snapshot: PvSnapshot = { item, at: new Date().toISOString(), user: short(me), link, text, notify: notify.length ? notify : ['contactele de farmacovigilență ale clientului'] }
      return ready(snapshot)
    },

    async pvFlag(brandId, item) {
      // Textul și linkul le completează serverul din înregistrare (trigger pv_flags_before_insert); nu se trimit din UI.
      const { data, error } = await client
        .from('pv_flags')
        .insert({ brand_id: brandId, entity_type: item.kind, entity_ref: item.id, text_snapshot: '-' })
        .select('id, entity_type, entity_ref, flagged_at, flagged_by, status')
        .single()
      if (error) return failed(error.code === '42501' ? 'Doar echipa agenției poate marca pentru farmacovigilență.' : 'Marcarea nu a reușit. Reîncearcă.')
      const r = data as { id: string; entity_ref: string; flagged_at: string; flagged_by: string; status: string }
      if (typeof r?.flagged_by !== 'string' || typeof r.flagged_at !== 'string') return failed(CONTRACT)
      return ready<PvFlag>({ id: r.id, item: { kind: item.kind, id: r.entity_ref }, flagged_at: r.flagged_at, flagged_by: short(r.flagged_by), notified: false, status: PV_STATUS[r.status] ?? 'pending' })
    },
  }
}

/**
 * Mesajul unei scrieri refuzate. Triggerele analizelor ridică erori cu text în română scris de noi (de ex. ce
 * lipsește la trimiterea în review): acela se arată. Orice altceva (constrângeri, nume de tabele) rămâne generic.
 */
function writeError(e: { code?: string; message?: string } | null, fallback: string): string {
  if (e?.code === '42501' && !e.message) return 'Nu ai dreptul să faci această modificare.'
  const m = e?.message ?? ''
  const ours = ['22023', '23514', '42501', '23505', '40001'].includes(e?.code ?? '') && m !== '' && !/violates|constraint|relation|column|permission denied|row-level|syntax|duplicate key/i.test(m)
  if (ours) return m.endsWith('.') ? m : `${m}.`
  return e?.code === '42501' ? 'Nu ai dreptul să faci această modificare.' : fallback
}

/** Metricile SEOmonitor cer un device la îngheț (B7-5); ca pe carduri, implicit desktop. */
const evidenceOptions = (key: string) => (key.startsWith('seomonitor_') ? { device: 'desktop' } : {})

/**
 * Analizele brandului. Citirea: `brand_insights` (INVOKER), deci clientul primește doar ce permite RLS (publicate).
 * Scrierea: direct în tabele, prin sesiunea utilizatorului. RLS și triggerele din `insights_pv` verifică rolul și
 * regulile; statusul se schimbă doar prin jurnalele de tranziții (B7-1).
 */
export function createSupabaseInsights(client: DataClient): InsightsProvider {
  return {
    async list(ctx) {
      const { data, error } = await client.rpc('brand_insights', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      if (!Array.isArray(data)) return failed(CONTRACT)
      const list = data as Insight[]
      if (list.some((i) => !(INSIGHT_STATUSES as readonly string[]).includes(i.status) || !Array.isArray(i.evidence) || !Array.isArray(i.actions))) return failed(CONTRACT)
      return ready(list)
    },

    async saveDraft(brand, id, draft) {
      const fields = { title: draft.title.trim(), period_start: draft.period.from, period_end: draft.period.to, period_kind: 'custom', summary: draft.summary.trim(), interpretation: draft.interpretation.trim(), limits: draft.limits.trim() }
      let insightId = id
      if (insightId === null) {
        const me = await currentUser(client)
        if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
        const { data, error } = await client.from('insights').insert({ tenant_id: brand.tenant_id, brand_id: brand.id, author_id: me, ...fields }).select('id').single()
        if (error) return failed(writeError(error, 'Ciorna nu a putut fi creată. Reîncearcă.'))
        insightId = (data as { id?: string } | null)?.id ?? null
        if (!insightId) return failed(CONTRACT)
      } else {
        const { error } = await client.from('insights').update(fields).eq('id', insightId).eq('brand_id', brand.id)
        if (error) return failed(writeError(error, 'Ciorna nu a putut fi salvată. Reîncearcă.'))
      }

      // Dovezile: se adaugă ce lipsește și se scoate ce nu mai e bifat; restul rămâne neatins.
      const existing = await client.from('evidence_links').select('id, metric_key').eq('insight_id', insightId).eq('kind', 'metric')
      if (existing.error) return failed(writeError(existing.error, 'Dovezile nu au putut fi citite.'))
      const links = (existing.data ?? []) as unknown as Array<{ id: string; metric_key: string }>
      const wanted = [...new Set(draft.evidence_keys)]
      const drop = links.filter((l) => !wanted.includes(l.metric_key)).map((l) => l.id)
      const add = wanted.filter((k) => !links.some((l) => l.metric_key === k))
      if (drop.length > 0) {
        const { error } = await client.from('evidence_links').delete().in('id', drop)
        if (error) return failed(writeError(error, 'Dovezile nu au putut fi actualizate.'))
      }
      if (add.length > 0) {
        const { error } = await client.from('evidence_links').insert(add.map((k) => ({ tenant_id: brand.tenant_id, brand_id: brand.id, insight_id: insightId, kind: 'metric', metric_key: k, options: evidenceOptions(k) })))
        if (error) return failed(writeError(error, 'Dovezile nu au putut fi actualizate.'))
      }
      return ready({ id: insightId })
    },

    async deleteDraft(id) {
      const { error } = await client.from('insights').delete().eq('id', id)
      return error ? failed(writeError(error, 'Ciorna nu a putut fi ștearsă.')) : ready(null)
    },

    async transition(id, to, reason) {
      const { error } = await client.from('insight_transitions').insert({ insight_id: id, to_status: to, reason: reason?.trim() || null })
      return error ? failed(writeError(error, 'Statusul analizei nu a putut fi schimbat. Reîncearcă.')) : ready(null)
    },

    async supersede(brand, insight) {
      const me = await currentUser(client)
      if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      // Versiunea, dovezile și recomandările le pune serverul (triggerele din `insights_pv`); de aici pleacă doar textele.
      const { data, error } = await client
        .from('insights')
        .insert({
          tenant_id: brand.tenant_id, brand_id: brand.id, author_id: me, supersedes_id: insight.id, title: insight.title,
          period_start: insight.period.from, period_end: insight.period.to, period_kind: 'custom',
          summary: insight.summary, interpretation: insight.interpretation ?? '', limits: insight.limits ?? '',
        })
        .select('id')
        .single()
      if (error) return failed(writeError(error, 'Versiunea nouă nu a putut fi creată. Reîncearcă.'))
      const id = (data as { id?: string } | null)?.id
      return id ? ready({ id }) : failed(CONTRACT)
    },

    async addRecommendation(brand, insightId, rec) {
      const { error } = await client.from('recommendations').insert({
        tenant_id: brand.tenant_id, brand_id: brand.id, insight_id: insightId,
        problem: rec.problem.trim(), action: rec.action.trim(), expected_benefit: rec.expected_benefit.trim(), priority: rec.priority,
      })
      return error ? failed(writeError(error, 'Recomandarea nu a putut fi adăugată. Reîncearcă.')) : ready(null)
    },

    async deleteRecommendation(id) {
      const { error } = await client.from('recommendations').delete().eq('id', id)
      return error ? failed(writeError(error, 'Recomandarea nu a putut fi ștearsă.')) : ready(null)
    },

    async addAction(brand, insightId, action) {
      const me = await currentUser(client)
      if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const { error } = await client.from('actions').insert({
        tenant_id: brand.tenant_id,
        brand_id: brand.id,
        insight_id: insightId,
        title: action.title.trim(),
        responsible_user_id: action.owner_id || me,
        due_date: action.due,
        effort: action.effort?.trim() || null,
        tracked_metric_key: action.tracked_metric_key,
      })
      return error ? failed(writeError(error, 'Acțiunea nu a putut fi adăugată. Reîncearcă.')) : ready(null)
    },

    async transitionAction(actionId, t) {
      const { error } = await client.from('action_transitions').insert({ action_id: actionId, to_status: t.to, reason: t.reason?.trim() || null, result_note: t.result_note?.trim() || null })
      return error ? failed(writeError(error, 'Statusul acțiunii nu a putut fi schimbat. Reîncearcă.')) : ready(null)
    },
  }
}
