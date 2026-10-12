import { describe, expect, it } from 'vitest'
import { checkServiceAccount } from './serviceAccount'

const key = { type: 'service_account', project_id: 'analyzator-stada', client_email: 'analyzator@analyzator-stada.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' }

describe('checkServiceAccount', () => {
  it('acceptă o cheie de service account și întoarce doar adresa și textul compact', () => {
    const r = checkServiceAccount(JSON.stringify(key, null, 2))
    expect(r).toMatchObject({ ok: true, clientEmail: key.client_email, projectId: 'analyzator-stada' })
    if (r.ok) expect(JSON.parse(r.compact)).toEqual(key)
    expect(Object.keys(r)).not.toContain('privateKey')
  })
  it('respinge JSON invalid, alt tip de fișier și cheia lipsă, cu mesaje clare', () => {
    expect(checkServiceAccount('nu e json')).toMatchObject({ ok: false, message: expect.stringContaining('nu e JSON valid') })
    expect(checkServiceAccount(JSON.stringify({ web: { client_id: 'x' } }))).toMatchObject({ ok: false, message: expect.stringContaining('OAuth client') })
    expect(checkServiceAccount(JSON.stringify({ ...key, private_key: undefined }))).toMatchObject({ ok: false, message: expect.stringContaining('private_key') })
    expect(checkServiceAccount(JSON.stringify({ ...key, client_email: 'eu@gmail.com' }))).toMatchObject({ ok: false, message: expect.stringContaining('client_email') })
  })
})
