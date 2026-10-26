import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkResolved, isPublicIp, parseCredential, parseDsn } from './dsn.ts'

const CA = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ2FUZXN0\n-----END CERTIFICATE-----\n'

const reason = (raw: string) => {
  const r = parseDsn(raw, null)
  return r.ok ? 'ok' : r.reason
}

describe('parseDsn', () => {
  test('connection string complet: host, port, utilizator și parolă decodate', () => {
    const r = parseDsn('postgresql://analyzator_ro:p%40ss%3Aw0rd@Airbyte-DB.Exemplu.ro:6543/airbyte?sslmode=require', null)
    assert.deepEqual(r, { ok: true, dsn: { host: 'airbyte-db.exemplu.ro', port: 6543, user: 'analyzator_ro', password: 'p@ss:w0rd', database: 'airbyte', ca: null } })
  })
  test('portul implicit e 5432; fără sslmode se cere verificarea completă', () => {
    const r = parseDsn('postgres://u:p@db.exemplu.ro/airbyte', null)
    assert.equal(r.ok && r.dsn.port, 5432)
  })
  test('parametrii în afară de sslmode se ignoră (options nu poate schimba sesiunea read-only)', () => {
    const r = parseDsn('postgresql://u:p@db.exemplu.ro/airbyte?sslmode=verify-full&options=-c%20default_transaction_read_only%3Doff', null)
    assert.equal(r.ok, true)
    assert.equal(JSON.stringify(r).includes('default_transaction_read_only'), false)
  })
  test('lipsesc utilizatorul, parola sau baza: invalid_dsn', () => {
    assert.equal(reason('postgresql://db.exemplu.ro/airbyte'), 'invalid_dsn')
    assert.equal(reason('postgresql://u@db.exemplu.ro/airbyte'), 'invalid_dsn')
    assert.equal(reason('postgresql://u:p@db.exemplu.ro'), 'invalid_dsn')
    assert.equal(reason('postgresql://u:p@db.exemplu.ro/a/b'), 'invalid_dsn')
    assert.equal(reason('mysql://u:p@db.exemplu.ro/a'), 'invalid_dsn')
    assert.equal(reason('host=db.exemplu.ro user=u'), 'invalid_dsn')
  })
  test('porturile privilegiate și cele invalide: invalid_dsn', () => {
    assert.equal(reason('postgresql://u:p@db.exemplu.ro:22/a'), 'invalid_dsn')
    assert.equal(reason('postgresql://u:p@db.exemplu.ro:443/a'), 'invalid_dsn')
  })
  test('fără TLS (disable, allow, prefer): tls_required', () => {
    for (const m of ['disable', 'allow', 'prefer']) assert.equal(reason(`postgresql://u:p@db.exemplu.ro/a?sslmode=${m}`), 'tls_required')
    for (const m of ['require', 'verify-ca', 'verify-full']) assert.equal(reason(`postgresql://u:p@db.exemplu.ro/a?sslmode=${m}`), 'ok')
  })
  test('mesajele nu repetă parola', () => {
    const r = parseDsn('postgresql://u:SECRET-PAROLA@localhost/a', null)
    assert.equal(JSON.stringify(r).includes('SECRET-PAROLA'), false)
  })
})

describe('SSRF: adresa serverului', () => {
  test('localhost, nume interne și nume fără domeniu: refuzate', () => {
    assert.equal(reason('postgresql://u:p@localhost/a'), 'host_not_allowed')
    assert.equal(reason('postgresql://u:p@db.localhost/a'), 'host_not_allowed')
    assert.equal(reason('postgresql://u:p@kong.internal/a'), 'host_not_allowed')
    assert.equal(reason('postgresql://u:p@db.svc.cluster.local/a'), 'host_not_allowed')
    assert.equal(reason('postgresql://u:p@db/a'), 'invalid_dsn')
    assert.equal(reason('postgresql://u:p@supabase_db_Analyzator/a'), 'invalid_dsn')
  })
  test('IP-uri private, loopback, link-local (metadata cloud): host_not_allowed', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.18.0.10', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:10.0.0.1]']) {
      assert.equal(reason(`postgresql://u:p@${ip}:5432/a`), 'host_not_allowed', ip)
    }
  })
  test('IP public: refuzat cu cererea numelui de domeniu (certificatul se verifică pe nume)', () => {
    const r = parseDsn('postgresql://u:p@8.8.8.8/a', null)
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.message : '', /numele de domeniu/)
  })
  test('forme numerice care ar ajunge la 127.0.0.1 prin getaddrinfo: refuzate', () => {
    for (const h of ['127.1', '0x7f.1', '2130706433', '0177.0.0.1.', 'a.123']) assert.notEqual(reason(`postgresql://u:p@${h}/a`), 'ok', h)
  })
  test('caracterele codate în host: refuzate', () => {
    assert.equal(reason('postgresql://u:p@%31%32%37.0.0.1/a'), 'invalid_dsn')
  })
})

describe('isPublicIp și checkResolved', () => {
  test('IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '192.169.0.1']) assert.equal(isPublicIp(ip), true, ip)
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.53', '169.254.0.1', '100.64.0.1', '0.1.2.3', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1', '999.1.1.1']) {
      assert.equal(isPublicIp(ip), false, ip)
    }
  })
  test('IPv6, inclusiv IPv4 mapat și NAT64', () => {
    for (const ip of ['2a00:1450:4001:80b::200e', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) assert.equal(isPublicIp(ip), true, ip)
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '::10.0.0.1', 'zz::1', '1:2:3']) {
      assert.equal(isPublicIp(ip), false, ip)
    }
  })
  test('toate adresele rezolvate trebuie să fie publice', () => {
    assert.equal(checkResolved(['8.8.8.8', '2a00:1450:4001:80b::200e']), null)
    assert.equal(checkResolved(['8.8.8.8', '10.0.0.5'])?.reason, 'host_not_allowed')
    assert.equal(checkResolved([])?.reason, 'host_not_allowed')
  })
})

describe('parseCredential', () => {
  test('connection string simplu', () => {
    const r = parseCredential('  postgresql://u:p@db.exemplu.ro/a  ')
    assert.equal(r.ok && r.dsn.ca, null)
  })
  test('JSON cu certificatul autorității (CA)', () => {
    const r = parseCredential(JSON.stringify({ dsn: 'postgresql://u:p@db.exemplu.ro/a', ca_cert: CA }))
    assert.equal(r.ok && r.dsn.ca, CA.trim())
  })
  test('JSON fără ca_cert sau cu ca_cert gol: autoritățile publice', () => {
    const r = parseCredential(JSON.stringify({ dsn: 'postgresql://u:p@db.exemplu.ro/a', ca_cert: '' }))
    assert.equal(r.ok && r.dsn.ca, null)
  })
  test('certificat invalid, cheie privată sau JSON stricat: invalid_dsn', () => {
    const bad = (v: unknown) => {
      const r = parseCredential(typeof v === 'string' ? v : JSON.stringify(v))
      return r.ok ? 'ok' : r.reason
    }
    assert.equal(bad({ dsn: 'postgresql://u:p@db.exemplu.ro/a', ca_cert: 'nu e PEM' }), 'invalid_dsn')
    assert.equal(bad({ dsn: 'postgresql://u:p@db.exemplu.ro/a', ca_cert: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }), 'invalid_dsn')
    assert.equal(bad({ dsn: 'postgresql://u:p@db.exemplu.ro/a', ca_cert: CA + CA }), 'invalid_dsn')
    assert.equal(bad({ ca_cert: CA }), 'invalid_dsn')
    assert.equal(bad('{"dsn": '), 'invalid_dsn')
  })
})
