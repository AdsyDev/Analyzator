import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { notConnected, type AutoSentiment, type CompetitionCell, ListeningCompetition, ListeningOverview, type ListeningTopic, type ProviderResult, type TopVoice } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import { EmptyState } from '../../components/EmptyState'
import { useMissingOnPage } from '../../components/MissingData'
import { StatCard } from '../../components/StatCard'
import { TrendChart } from '../../components/TrendChart'
import { StatusChip } from '../../components/ui/Chip'
import { InfoTip } from '../../components/ui/InfoTip'
import { Tabs } from '../../components/ui/Tabs'
import type { AsyncState } from '../../data/useAsync'
import { changeDirection, formatAbsoluteChange, formatDayMonth, formatInteger, formatMetricValue, formatRelativeChange } from '../../lib/format'
import { POST_PLATFORM_LABELS, platformOf } from '../../lib/platform'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { SENTIMENT_LABELS } from './labels'

/**
 * Starea unei secțiuni derivată din răspunsul comun: când partea ei lipsește la sursă (fără set de competitori, fără topicuri
 * urmărite), secțiunea primește „fără sursă”, deci nu se desenează și pagina o numește (decizia AG).
 */
function derive<T>(state: AsyncState<ProviderResult<ListeningOverview>>, pick: (o: ListeningOverview) => T | null, reason: string): AsyncState<ProviderResult<T>> {
  if (state.status !== 'done' || state.value.kind !== 'ready') return state as AsyncState<ProviderResult<T>>
  const v = pick(state.value.data)
  return { status: 'done', value: v === null ? notConnected<T>(reason) : { kind: 'ready', data: v } }
}

/** Culorile entităților și ale rețelelor: brandul are accentul, competitorii și celelalte rețele urmează paleta graficelor. */
const PALETTE = ['var(--accent)', 'var(--lav)', 'var(--s3)', 'var(--s4)', 'var(--c3)', 'var(--c1)']
const colorAt = (i: number) => PALETTE[i % PALETTE.length] ?? 'var(--accent)'

/** Numele afișat al unei rețele, cum vine din sursă („instagram” → „Instagram”); ce nu se recunoaște rămâne textul sursei. */
export function platformLabel(name: string): string {
  const p = platformOf(null, name)
  return p === 'web' && name.trim().toLowerCase() !== 'web' ? name : POST_PLATFORM_LABELS[p]
}

const pct = (v: number | null) => formatMetricValue(v, 'percent')
/** Net-ul sentimentului, ca diferență în puncte procentuale („+19,0 p.p.”). */
const signed = (v: number | null) => (v === null ? null : formatAbsoluteChange(v, 'percent'))

/** Bara de sentiment (pozitiv, neutru, negativ), cu numele accesibil complet; fără mențiuni cu sentiment, o bară goală. */
export function SentimentBar({ s, label, className = 'h-2.5' }: { s: Pick<AutoSentiment, 'shares' | 'total'>; label: string; className?: string }) {
  const order = ['positive', 'neutral', 'negative'] as const
  return (
    <div role="img" aria-label={s.total === 0 ? `${label}: fără mențiuni cu sentiment` : `${label}: ${order.map((k) => `${SENTIMENT_LABELS[k].label} ${pct(s.shares[k]) ?? 'fără date'}`).join(', ')}`} className={`flex overflow-hidden rounded-full bg-neutral-soft ${className}`}>
      {s.total > 0 && order.map((k) => (s.shares[k] ? <span key={k} className={SENTIMENT_LABELS[k].bar} style={{ width: `${s.shares[k]}%` }} /> : null))}
    </div>
  )
}

/** Eticheta care spune de unde vine sentimentul: automat, din Planable, neverificat (deciziile AH, B). */
export function AutoChip() {
  return (
    <span title="Sentiment dat automat de Planable, neverificat de un om din echipa AdSymphony">
      <StatusChip tone="lav">Automat · Planable</StatusChip>
    </span>
  )
}

const AUTO_DEFINITION =
  'Sentimentul dat automat de Planable fiecărei mențiuni externe, neverificat de un om. Procentul = mențiunile pozitive / mențiunile cu sentiment (pozitiv, neutru sau negativ). Net = pozitive minus negative, ca procent din aceleași mențiuni. Postările din conturile proprii și mențiunile în altă limbă decât româna nu intră. Distribuția verificată de echipă e în secțiunea „Sentiment”.'

/** Cardul „Interacțiuni”: suma interacțiunilor raportate de sursă, cu variația față de perioada anterioară. */
export function EngagementCard({ state }: { state: AsyncState<ProviderResult<ListeningOverview>> }) {
  const loading = state.status === 'loading'
  const o = state.status === 'done' && state.value.kind === 'ready' ? state.value.data : null
  const notConnected = state.status === 'done' && state.value.kind === 'not_connected'
  const e = o?.engagement ?? null
  const rel = e?.change.relative_change ?? null
  return (
    <StatCard
      label="Interacțiuni"
      definition="Suma interacțiunilor (reacții, comentarii, distribuiri) raportate de Planable pentru mențiunile din perioadă, cu aceeași regulă ca „Mențiuni” (fără cele clar în altă limbă). O mențiune fără interacțiuni raportate nu se numără ca zero. Variația: față de perioada anterioară de aceeași lungime."
      valueText={e && e.value !== null ? formatInteger(e.value) : null}
      deltaText={rel !== null ? formatRelativeChange(rel) : null}
      deltaDirection={rel !== null ? changeDirection(rel) : null}
      goodWhen="up"
      status={notConnected ? 'not_connected' : e && e.value !== null ? (e.mentions_with_value < e.mentions ? 'partial' : 'ok') : 'unavailable'}
      note={
        !e ? null
        : e.value === null ? 'Planable nu a raportat interacțiuni pentru mențiunile din perioadă. Interacțiunile se păstrează din 25 nov. 2026; mențiunile colectate înainte le primesc la următoarea colectare.'
        : e.mentions_with_value < e.mentions ? `Din ${formatInteger(e.mentions_with_value)} din ${formatInteger(e.mentions)} mențiuni; restul nu au interacțiuni raportate.`
        : null
      }
      compareLabel={e?.comparison.start ? `față de ${formatDayMonth(e.comparison.start)} – ${formatDayMonth(e.comparison.end)}` : undefined}
      loading={loading}
      sourceLabel="Planable"
      emptyTitle="Fără interacțiuni raportate"
    />
  )
}

/** Cardul „Sentiment automat”: procentul pozitiv, bara și net-ul, din sentimentul Planable (neverificat). */
export function AutoSentimentCard({ state }: { state: AsyncState<ProviderResult<ListeningOverview>> }) {
  const o = state.status === 'done' && state.value.kind === 'ready' ? state.value.data : null
  const missing = state.status === 'done' && state.value.kind === 'not_connected'
  useMissingOnPage('Sentiment automat', missing)
  if (missing) return null
  const s = o?.auto_sentiment
  return (
    <article aria-label="Sentiment automat" data-status={s && s.total > 0 ? 'ok' : 'unavailable'} className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface px-4 pb-3 pt-4 shadow-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold leading-snug text-text-2">Sentiment automat</span>
        <InfoTip>{AUTO_DEFINITION}</InfoTip>
        <span className="flex-1" />
        <AutoChip />
      </div>
      {state.status === 'loading' ? (
        <div role="status" aria-label="Se încarcă" className="flex flex-col gap-2.5">
          <div className="h-8 w-1/2 rounded-md bg-skeleton" />
          <div className="h-2.5 rounded-full bg-skeleton" />
        </div>
      ) : state.status === 'failed' || (state.status === 'done' && state.value.kind === 'error') ? (
        <p className="text-[13px] text-neg-text">Nu am putut încărca sentimentul.</p>
      ) : !s || s.total === 0 ? (
        <p className="text-[13px] leading-snug text-text-2">
          <span className="block font-display text-[15px] font-semibold text-text">Fără mențiuni cu sentiment</span>
          Planable nu a dat un sentiment mențiunilor externe din perioadă.
        </p>
      ) : (
        <div className="flex flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{pct(s.shares.positive)}</span>
            <span className="text-[13px] font-medium text-text-2">pozitiv</span>
          </div>
          <SentimentBar s={s} label="Sentiment automat" />
          <p className="text-[12px] leading-snug text-text-2">
            Net <span className="font-semibold tabular-nums text-text">{signed(s.net)}</span> · {formatInteger(s.total)} mențiuni externe
            {s.unknown > 0 ? ` · ${formatInteger(s.unknown)} fără sentiment` : ''}
          </p>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-2.5 text-[11.5px] text-text-2">
        <span className="font-semibold text-text">Planable</span>
        <span className="flex-1" />
        <span>Neverificat</span>
      </div>
    </article>
  )
}

type DayView = 'total' | 'platforms'
const MAX_PLATFORM_SERIES = 5

/** „Mențiuni pe zi”: totalul sau seria pe rețea, plus ponderea fiecărei rețele. Zilele necitite rămân goluri, nu zero. */
export function MentionsPerDay({ state, onRetry }: { state: AsyncState<ProviderResult<ListeningOverview>>; onRetry: () => void }) {
  const [view, setView] = useState<DayView>('total')
  return (
    <Section
      id="mentions-per-day"
      title="Mențiuni pe zi"
      description="Mențiunile publicate în fiecare zi, cu aceeași regulă ca indicatorul „Mențiuni”. Golurile sunt zile pe care colectarea nu le-a citit complet; nu înseamnă zero."
      action={<Tabs label="Afișare" items={[{ id: 'total', label: 'Total' }, { id: 'platforms', label: 'Pe rețea' }]} value={view} onChange={setView} />}
    >
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă mențiunile pe zi" skeletonClass="h-64">
        {(o) => {
          const labels = o.days.map(formatDayMonth)
          const top = o.platforms.slice(0, MAX_PLATFORM_SERIES)
          const series =
            view === 'total'
              ? [{ key: 'total', name: 'Mențiuni', color: 'var(--accent)', values: o.series }]
              : top.map((p, i) => ({ key: p.platform, name: platformLabel(p.platform), color: colorAt(i), values: p.values }))
          return (
            <div className="flex flex-col gap-4">
              <TrendChart
                title="Mențiuni pe zi"
                labels={labels}
                series={series}
                smooth
                area={view === 'total'}
                endMarkers={view === 'total'}
                note={view === 'platforms' && o.platforms.length > MAX_PLATFORM_SERIES ? `Graficul arată primele ${MAX_PLATFORM_SERIES} rețele; toate sunt în lista de mai jos.` : undefined}
              />
              {o.platforms.length > 0 && (
                <ul aria-label="Mențiuni pe rețea" className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {o.platforms.map((p, i) => (
                    <li key={p.platform} className="flex items-center gap-3 text-[13px]">
                      <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: colorAt(i) }} />
                      <span className="w-28 flex-none truncate font-medium">{platformLabel(p.platform)}</span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-soft">
                        <span className="block h-full rounded-full" style={{ width: `${p.share ?? 0}%`, background: colorAt(i) }} />
                      </span>
                      <span className="w-12 text-right tabular-nums text-text-2">{formatInteger(p.mentions)}</span>
                      <span className="w-14 text-right font-semibold tabular-nums">{pct(p.share) ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }}
      </Resolved>
    </Section>
  )
}

const initials = (s: string) => s.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

/** „Voci principale”: autorii externi cu cele mai multe mențiuni în perioadă (deciziile AH). */
export function TopVoices({ state, onRetry }: { state: AsyncState<ProviderResult<ListeningOverview>>; onRetry: () => void }) {
  return (
    <Section id="top-voices" title="Voci principale" description="Autorii externi cu cele mai multe mențiuni în perioadă, apoi cu cele mai multe interacțiuni. Conturile proprii ale brandului nu apar.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă vocile principale" skeletonClass="h-48">
        {(o) =>
          o.top_voices.length === 0 ? (
            <EmptyState
              compact
              title="Nicio voce de afișat"
              text={
                o.voices_basis.external > 0 && o.voices_basis.with_author === 0
                  ? 'Autorii mențiunilor se păstrează din 25 nov. 2026. Mențiunile din perioadă au fost colectate înainte; lista apare după următoarea colectare Planable.'
                  : 'Nu există mențiuni externe cu autor în perioada aleasă.'
              }
            />
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {o.top_voices.map((v: TopVoice, i) => {
                const display = v.name ?? (v.username ? `@${v.username}` : 'Autor fără nume')
                return (
                  <li key={`${v.platform}|${v.username ?? v.name ?? i}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-full bg-accent-soft text-[12.5px] font-semibold text-accent-text">{initials(display)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13.5px] font-semibold">{display}</span>
                      <span className="truncate text-[12px] text-text-2">
                        {[v.name && v.username ? `@${v.username}` : null, platformLabel(v.platform)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end text-[12px] text-text-2">
                      <span className="text-[13px] font-semibold tabular-nums text-text">{formatInteger(v.mentions)} {v.mentions === 1 ? 'mențiune' : 'mențiuni'}</span>
                      <span className="tabular-nums">{v.engagement === null ? 'Interacțiuni neraportate' : `${formatInteger(v.engagement)} interacțiuni`}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )
        }
      </Resolved>
    </Section>
  )
}

/** O celulă din matricea de Competiție: valoarea sau „N/A” cu motivul în tooltip; „Parțial” când acoperirea nu e completă. */
function MatrixCell({ c, unit }: { c: CompetitionCell | null; unit: 'count' | 'percent' }): ReactNode {
  if (!c || c.value === null) {
    return (
      <span className="text-text-3" title={c?.reason ?? 'Fără date pentru perioada selectată.'}>
        N/A
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={c.reason ?? undefined}>
      <span className="font-semibold tabular-nums">{formatMetricValue(c.value, unit)}</span>
      {c.status === 'partial' && <CoverageBadge state="partial" pct={c.coverage === null ? null : c.coverage * 100} />}
    </span>
  )
}

function CompetitionBody({ c, brandPath }: { c: ListeningCompetition; brandPath: string }) {
  const colorOf = (id: string) => colorAt(Math.max(0, c.entities.findIndex((e) => e.id === id)))
  const brand = c.entities.find((e) => e.kind === 'brand')
  const sovReady = c.entities.every((e) => e.share_of_voice?.value !== null && e.share_of_voice?.value !== undefined)
  return (
    <div className="flex flex-col gap-5">
      <ul aria-label="Entități" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
        {c.entities.map((e) => (
          <li key={e.id} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: colorOf(e.id) }} />
            <span className="font-medium">{e.name}</span>
            {e.kind === 'brand' ? <StatusChip tone="accent">Tu</StatusChip> : <span className="font-mono text-[11px] text-text-3">{e.label}</span>}
          </li>
        ))}
      </ul>

      {sovReady && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-text-2">Share of voice</span>
          <div role="img" aria-label={`Share of voice: ${c.entities.map((e) => `${e.name} ${pct(e.share_of_voice!.value)}`).join(', ')}`} className="flex h-3 overflow-hidden rounded-full bg-neutral-soft">
            {c.entities.map((e) => (e.share_of_voice!.value ? <span key={e.id} style={{ width: `${e.share_of_voice!.value}%`, background: colorOf(e.id) }} /> : null))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <caption className="sr-only">Mențiuni, share of voice și sentiment automat pe brand și competitori</caption>
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-text-2">
              <th scope="col" className="py-2 pr-3 font-medium">Brand</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Mențiuni</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Share of voice</th>
              <th scope="col" className="w-[34%] py-2 pr-3 font-medium">
                <span className="inline-flex items-center gap-1">Sentiment <AutoChip /></span>
              </th>
              <th scope="col" className="py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {c.entities.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 flex-none rounded-sm" style={{ background: colorOf(e.id) }} />
                    {e.name}
                  </span>
                  {!e.tracked && <span className="block text-[11.5px] font-normal text-text-2">Fără cuvânt urmărit în Planable</span>}
                </th>
                <td className="py-2.5 pr-3 text-right"><MatrixCell c={e.mentions} unit="count" /></td>
                <td className="py-2.5 pr-3 text-right"><MatrixCell c={e.share_of_voice} unit="percent" /></td>
                <td className="py-2.5 pr-3">{e.sentiment && e.sentiment.total > 0 ? <SentimentBar s={e.sentiment} label={`Sentiment automat ${e.name}`} /> : <span className="text-text-3">Fără mențiuni cu sentiment</span>}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums">{e.sentiment && e.sentiment.net !== null ? signed(e.sentiment.net) : <span className="font-normal text-text-3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.platforms.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            Pe rețea
            <InfoTip>Mențiunile fiecărei entități pe rețea. „Cota ta” = mențiunile brandului / mențiunile tuturor pe acea rețea; apare doar când share of voice-ul are valoare (toți competitorii colectați complet).</InfoTip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <caption className="sr-only">Mențiunile pe rețea, pe brand și competitori</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-text-2">
                  <th scope="col" className="py-2 pr-3 font-medium">Rețea</th>
                  <th scope="col" className="w-[45%] py-2 pr-3 font-medium">Împărțire</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Mențiuni</th>
                  <th scope="col" className="py-2 text-right font-medium">Cota ta</th>
                </tr>
              </thead>
              <tbody>
                {c.platforms.map((p) => (
                  <tr key={p.platform} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-medium">{platformLabel(p.platform)}</th>
                    <td className="py-2.5 pr-3">
                      <div role="img" aria-label={`${platformLabel(p.platform)}: ${c.entities.map((e) => `${e.name} ${formatInteger(p.counts[e.id] ?? 0)}`).join(', ')}`} className="flex h-2.5 overflow-hidden rounded-full bg-neutral-soft">
                        {p.total > 0 && c.entities.map((e) => ((p.counts[e.id] ?? 0) > 0 ? <span key={e.id} style={{ width: `${(100 * (p.counts[e.id] ?? 0)) / p.total}%`, background: colorOf(e.id) }} /> : null))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatInteger(p.total)}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">{pct(p.brand_share) ?? <span className="font-normal text-text-3" title="Share of voice-ul nu are valoare: nu toți competitorii sunt colectați complet.">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[12.5px] text-text-2">
        Setul de competitori v{c.set_version}{brand ? `, pentru ${brand.name}` : ''}. Mențiunile și share of voice-ul sunt aceleași ca în{' '}
        <Link to={brandPath} className="font-medium text-accent-text underline-offset-2 hover:underline">
          Competiție
        </Link>
        ; sentimentul e cel automat din Planable, neverificat.
      </p>
    </div>
  )
}

/** Competiția în Listening: mențiuni, share of voice, sentiment automat și rețele, pe brand și competitori. */
export function CompetitionListening({ state, onRetry, competitionPath }: { state: AsyncState<ProviderResult<ListeningOverview>>; onRetry: () => void; competitionPath: string }) {
  return (
    <Section id="listening-competition" title="Competiție în Listening" description="Brandul și competitorii din set, pe aceleași cuvinte urmărite în Planable și aceeași perioadă. N/A înseamnă că lipsesc datele pentru acel competitor, nu zero.">
      <Resolved state={derive(state, (o) => o.competition, 'Brandul nu are un set de competitori în vigoare la sfârșitul perioadei.')} onRetry={onRetry} loadingLabel="Se încarcă comparația" skeletonClass="h-64">
        {(c) => <CompetitionBody c={c} brandPath={competitionPath} />}
      </Resolved>
    </Section>
  )
}

function TopicRow({ t }: { t: ListeningTopic }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[14.5px] font-semibold">{t.label}</span>
        {t.status === 'partial' && <span title={t.reason ?? undefined}><CoverageBadge state="partial" pct={t.coverage * 100} /></span>}
        <span className="flex-1" />
        <span className="text-[13px] font-semibold tabular-nums">{formatInteger(t.mentions)} {t.mentions === 1 ? 'mențiune' : 'mențiuni'}</span>
      </div>
      {t.sentiment.total > 0 ? <SentimentBar s={t.sentiment} label={`Sentiment automat ${t.label}`} className="h-2" /> : <span className="text-[12px] text-text-3">Fără mențiuni cu sentiment</span>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-2">
        {t.sentiment.total > 0 && <span>Net <span className="font-semibold tabular-nums text-text">{signed(t.sentiment.net)}</span></span>}
        {t.engagement !== null && <span>{formatInteger(t.engagement)} interacțiuni</span>}
        {t.platforms.slice(0, 3).map((p) => (
          <span key={p.platform}>
            {platformLabel(p.platform)} <span className="tabular-nums">{formatInteger(p.mentions)}</span>
          </span>
        ))}
      </div>
      {t.reason && <p className="text-[12px] text-text-2">{t.reason}</p>}
    </li>
  )
}

/** Topicurile urmărite în Planable Listening (cuvinte de tip „topic”), cu volumul, sentimentul automat și rețelele (deciziile AH). */
export function TopicsSection({ state, onRetry }: { state: AsyncState<ProviderResult<ListeningOverview>>; onRetry: () => void }) {
  return (
    <Section id="topics" title="Topicuri" description="Conversațiile despre temele urmărite în Planable (de exemplu „dureri articulare”), fără să fie despre brand. Sentimentul e cel automat, despre temă, nu despre brand.">
      <Resolved state={derive(state, (o) => (o.topics_tracked ? o.topics : null), 'Niciun cuvânt de tip „topic” urmărit în Planable Listening pentru acest brand.')} onRetry={onRetry} loadingLabel="Se încarcă topicurile" skeletonClass="h-40">
        {(topics) =>
          topics.length === 0 ? (
            <EmptyState compact title="Niciun topic citit în perioadă" text="Topicurile urmărite nu au fost colectate în zilele alese." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {topics.map((t) => (
                <TopicRow key={t.id} t={t} />
              ))}
            </ul>
          )
        }
      </Resolved>
    </Section>
  )
}

/** Blocul cu sentimentul automat de lângă distribuția revizuită: aceeași formă, eticheta spune că nu e verificat. */
export function AutoSentimentPanel({ state }: { state: AsyncState<ProviderResult<ListeningOverview>> }) {
  if (state.status !== 'done' || state.value.kind !== 'ready') return null
  const s = state.value.data.auto_sentiment
  const order = ['positive', 'neutral', 'negative'] as const
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-3.5" aria-label="Sentiment automat Planable" role="group">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[14px] font-semibold">Automat, din Planable</span>
        <AutoChip />
        <InfoTip>{AUTO_DEFINITION}</InfoTip>
      </div>
      {s.total === 0 ? (
        <p className="text-[12.5px] text-text-2">Planable nu a dat un sentiment mențiunilor externe din perioadă.</p>
      ) : (
        <>
          <p className="text-[13px] text-text-2">
            <span className="font-display text-[22px] font-semibold text-text tabular-nums">{formatInteger(s.total)}</span> mențiuni externe cu sentiment automat
          </p>
          <SentimentBar s={s} label="Sentiment automat" className="h-3" />
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {order.map((k) => (
              <li key={k} className="flex items-center gap-2 text-[13px]">
                <span aria-hidden="true" className={`size-2.5 flex-none rounded-full ${SENTIMENT_LABELS[k].bar}`} />
                <span className="font-medium">{SENTIMENT_LABELS[k].label}</span>
                <span className="flex-1" />
                <span className="tabular-nums text-text-2">{formatInteger(s[k])}</span>
                <span className="w-14 text-right font-semibold tabular-nums">{pct(s.shares[k]) ?? 'Fără date'}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-text-2">
            Neverificat de un om. Conversațiile despre simptome pot fi marcate automat ca negative fără să fie despre brand; pentru raportare folosește distribuția revizuită.
            {s.unknown > 0 ? ` ${formatInteger(s.unknown)} ${s.unknown === 1 ? 'mențiune nu are' : 'mențiuni nu au'} sentiment de la Planable.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
