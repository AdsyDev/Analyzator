import {
  failed,
  INSIGHT_STATUSES,
  notConnected,
  ready,
  type Insight,
  type InsightsProvider,
  type Mention,
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
      const d = data as Page<Mention> | null
      if (!d || !Array.isArray(d.items) || typeof d.total !== 'number') return failed(CONTRACT)
      if (d.total === 0 && q.page === 1 && !q.sentiment && !q.source && !q.author) {
        const s = await this.sentiment(ctx)
        if (s.kind === 'not_connected') return s
      }
      return ready(d)
    },

    async sentiment(ctx) {
      const { data, error } = await client.rpc('brand_mention_sentiment', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as (SentimentDistribution & { connected?: boolean }) | null
      if (!d || typeof d.total !== 'number' || typeof d.owned_excluded !== 'number') return failed(CONTRACT)
      if (d.connected === false) return notConnected(NO_LISTENING)
      const { connected: _c, ...dist } = d
      return ready(dist as SentimentDistribution)
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

/** Analizele brandului (`brand_insights`, INVOKER): clientul primește doar ce permite RLS (publicate). */
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
  }
}
