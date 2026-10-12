/**
 * Antetele pe care browserul le poate trimite funcțiilor. `x-client-info` îl adaugă `supabase-js` la orice
 * `functions.invoke`: fără el, preflight-ul CORS eșuează și cererea nu pleacă (aplicația vede „nu a răspuns").
 */
export const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type'
