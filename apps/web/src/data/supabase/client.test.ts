import { afterEach, describe, expect, it, vi } from 'vitest'
import { REMEMBER_KEY, createSupabaseBackend, readUrlLink, rememberableStorage } from './client'

function mem() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

describe('rememberableStorage', () => {
  it('implicit, sesiunea persistă; cu „nu ține-mă minte" stă doar în fila curentă', () => {
    const local = mem()
    const session = mem()
    const s = rememberableStorage(local, session)
    s.setItem('sb', 'a')
    expect(local.m.get('sb')).toBe('a')
    expect(session.m.has('sb')).toBe(false)
    s.setRemember(false)
    expect(local.m.get(REMEMBER_KEY)).toBe('0')
    s.setItem('sb', 'b')
    expect(session.m.get('sb')).toBe('b')
    expect(local.m.has('sb')).toBe(false)
    expect(s.getItem('sb')).toBe('b')
    s.removeItem('sb')
    expect(s.getItem('sb')).toBeNull()
  })

  it('schimbarea alegerii mută sesiunea la următoarea scriere, fără copii în ambele locuri', () => {
    const local = mem()
    const session = mem()
    const s = rememberableStorage(local, session)
    s.setRemember(false)
    s.setItem('sb', '1')
    s.setRemember(true)
    s.setItem('sb', '2')
    expect(local.m.get('sb')).toBe('2')
    expect(session.m.has('sb')).toBe(false)
  })
})

describe('readUrlLink', () => {
  it.each([
    ['#access_token=abc&type=invite&expires_in=3600', { kind: 'invite', notice: null }],
    ['#access_token=abc&type=recovery', { kind: 'recovery', notice: null }],
    ['#error=access_denied&error_code=otp_expired&error_description=x', { kind: null, notice: 'expired_link' }],
    ['#type=magiclink', { kind: null, notice: null }],
    ['', { kind: null, notice: null }],
  ])('%s', (hash, expected) => {
    expect(readUrlLink(hash)).toEqual(expected)
  })
})

describe('createSupabaseBackend (adaptor peste un client fals)', () => {
  afterEach(() => vi.useRealTimers())

  function fakeClient() {
    const calls: Array<[string, ...unknown[]]> = []
    let cb: ((e: string, s: unknown) => void) | null = null
    let unsub = false
    const select = vi.fn()
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.example', user_metadata: { full_name: 'A B' } } } }, error: null }),
        onAuthStateChange: (f: (e: string, s: unknown) => void) => {
          cb = f
          return { data: { subscription: { unsubscribe: () => void (unsub = true) } } }
        },
        signInWithPassword: async (c: unknown) => (calls.push(['signIn', c]), { data: {}, error: { status: 400, code: 'invalid_credentials', message: 'Invalid' } }),
        signOut: async () => (calls.push(['signOut']), { error: null }),
        resetPasswordForEmail: async (e: string, o: unknown) => (calls.push(['reset', e, o]), { data: {}, error: null }),
        updateUser: async (a: unknown) => (calls.push(['update', a]), { data: {}, error: null }),
      },
      from: (t: string) => ({ select: (cols: string) => ({ is: async (c: string, v: unknown) => select(t, cols, c, v) }) }),
    }
    return { client: client as never, calls, select, fire: (e: string, s: unknown) => cb?.(e, s), wasUnsub: () => unsub }
  }

  const store = { setRemember: vi.fn() }

  it('mapează sesiunea și numele din metadate', async () => {
    const { client } = fakeClient()
    expect(await createSupabaseBackend(client, store).getSession()).toEqual({ userId: 'u1', email: 'a@b.example', fullName: 'A B' })
  })

  it('mapează erorile fără textul serverului în codul de eroare și transmite parametrii', async () => {
    const { client, calls } = fakeClient()
    const b = createSupabaseBackend(client, store)
    expect(await b.signInWithPassword('a@b.example', 'p')).toEqual({ status: 400, code: 'invalid_credentials', message: 'Invalid' })
    expect(calls[0]).toEqual(['signIn', { email: 'a@b.example', password: 'p' }])
    expect(await b.resetPasswordForEmail('a@b.example', 'https://app/login')).toBeNull()
    expect(calls[1]).toEqual(['reset', 'a@b.example', { redirectTo: 'https://app/login' }])
  })

  it('updateUser trimite numele doar când există', async () => {
    const { client, calls } = fakeClient()
    const b = createSupabaseBackend(client, store)
    await b.updateUser({ password: 'p', fullName: 'Nume' })
    await b.updateUser({ password: 'p2' })
    expect(calls[0]).toEqual(['update', { password: 'p', data: { full_name: 'Nume' } }])
    expect(calls[1]).toEqual(['update', { password: 'p2' }])
  })

  it('evenimentele de autentificare se amână (Supabase interzice apeluri directe în callback)', () => {
    vi.useFakeTimers()
    const { client, fire } = fakeClient()
    const handler = vi.fn()
    createSupabaseBackend(client, store).onChange(handler)
    fire('SIGNED_IN', { user: { id: 'u1', email: 'a@b.example', user_metadata: {} } })
    expect(handler).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(handler).toHaveBeenCalledWith('SIGNED_IN', { userId: 'u1', email: 'a@b.example', fullName: null })
  })

  it('dezabonarea apelează unsubscribe', () => {
    const { client, wasUnsub } = fakeClient()
    createSupabaseBackend(client, store).onChange(() => {})()
    expect(wasUnsub()).toBe(true)
  })

  it('membership-urile: doar cele neretrase, cu numele organizației, indiferent dacă relația vine ca obiect sau listă', async () => {
    const { client, select } = fakeClient()
    select.mockResolvedValueOnce({ data: [{ role: 'client_viewer', tenants: { name: 'STADA' } }, { role: 'strategist', tenants: [{ name: 'AdSymphony' }] }, { role: 'account', tenants: null }], error: null })
    const rows = await createSupabaseBackend(client, store).memberships()
    expect(select).toHaveBeenCalledWith('memberships', 'role, tenants(name)', 'revoked_at', null)
    expect(rows).toEqual([
      { role: 'client_viewer', organization: 'STADA' },
      { role: 'strategist', organization: 'AdSymphony' },
      { role: 'account', organization: '' },
    ])
  })

  it('o eroare la citirea membership-urilor se propagă (nu devine „fără acces” tăcut)', async () => {
    const { client, select } = fakeClient()
    select.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(createSupabaseBackend(client, store).memberships()).rejects.toThrow('permission denied')
  })

  it('setRemember e delegat spre stocare', () => {
    const { client } = fakeClient()
    const s = { setRemember: vi.fn() }
    createSupabaseBackend(client, s).setRemember(false)
    expect(s.setRemember).toHaveBeenCalledWith(false)
  })
})
