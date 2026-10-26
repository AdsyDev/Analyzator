// Tipuri minime pentru postgres.js importat ca `npm:` în Deno, doar pentru typecheck-ul din Node (tsc).
// Deno folosește tipurile pachetului; acest fișier nu e importat de funcție.
declare module 'npm:postgres@3.4.5' {
  type Sql = {
    unsafe(query: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>
    end(options?: { timeout?: number }): Promise<void>
  }
  export default function postgres(options: Record<string, unknown>): Sql
}
