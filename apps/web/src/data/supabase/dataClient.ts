import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Partea clientului Supabase de care au nevoie providerii de date. Sesiunea utilizatorului trece prin RLS:
 * providerii nu primesc niciodată cheia de service și nu filtrează „în locul" bazei de date.
 */
export type DataClient = Pick<SupabaseClient, 'from' | 'functions'>

/** Eroare de interogare → mesaj în română, fără detalii despre stack sau schemă. */
export const QUERY_FAILED = 'Nu am putut citi datele. Reîncearcă în câteva clipe.'
