/**
 * A .txt or .eml tender used to extract almost nothing: the text path handed
 * the extractor an empty word list, so the geometry-driven field matching had
 * nothing to work on. These pin the synthesised layout that fixes it.
 */
import { describe, expect, it } from 'vitest'
import { wordsFromPlainText, textFromEml } from './ingest'
import * as Layout from './layout'
import * as Pipeline from './pipeline'

const TENDER = [
  'APEX LOGISTICS CORP',
  'Shipment ID: LT-2026-89412',
  'Tender Date: 08/19/2026',
  "Equipment: 53' Dry Van",
  'Total Weight: 38,500 lbs',
  'Commodity: Canned Goods',
  'Total Charge: $3,450.00',
  '',
  'Stop 1 - PICKUP',
  'Apex Distribution Center',
  '100 Logistics Way',
  'Atlanta, GA 30303',
  'Earliest: 08/20/2026 07:00',
  'Latest: 08/20/2026 10:00',
  '',
  'Stop 2 - DELIVERY',
  'Westside Receiving',
  '8800 Alameda Ave',
  'Los Angeles, CA 90001',
  'Earliest: 08/23/2026 08:00',
  'Latest: 08/23/2026 12:00',
].join('\n')

function extract(text: string) {
  const lines = Layout.pageGrid(wordsFromPlainText(text))
  const t = Pipeline.extractRules(lines, text)
  Pipeline.postprocess(t)
  return t
}

describe('wordsFromPlainText', () => {
  it('gives every word a row and a column derived from its position', () => {
    const words = wordsFromPlainText('AB CD\nEF')
    expect(words.map((w) => w.text)).toEqual(['AB', 'CD', 'EF'])
    // Same row shares a band; the next line sits below it.
    expect(words[0].top).toBe(words[1].top)
    expect(words[2].top).toBeGreaterThan(words[0].top)
    // Column offset survives: 'CD' starts at character 3.
    expect(words[1].x0).toBeGreaterThan(words[0].x1)
  })

  it('preserves alignment so columns can be recovered', () => {
    // Two rows whose second column starts at the same character offset.
    const words = wordsFromPlainText('PICKUP    Atlanta\nDROP      Denver')
    const atlanta = words.find((w) => w.text === 'Atlanta')!
    const denver = words.find((w) => w.text === 'Denver')!
    expect(atlanta.x0).toBe(denver.x0)
  })

  it('handles empty input and blank lines without producing junk', () => {
    expect(wordsFromPlainText('')).toEqual([])
    expect(wordsFromPlainText('\n\n\n')).toEqual([])
  })

  it('normalises CRLF so a Windows-authored tender lines up the same', () => {
    const crlf = wordsFromPlainText('AB\r\nCD')
    const lf = wordsFromPlainText('AB\nCD')
    expect(crlf).toEqual(lf)
  })
})

describe('a plain-text tender now actually extracts', () => {
  const t = extract(TENDER)

  it('finds the order, not just references', () => {
    expect(t.shipment_id.v).toBe('LT-2026-89412')
    expect(t.commodity.v).toBe('Canned Goods')
    expect(t.total_weight.v).toBe(38500)
    expect(t.total_charge.v).toBe(3450)
  })

  it('finds both stops with their towns — the thing that was missing entirely', () => {
    expect(t.stops).toHaveLength(2)
    expect(t.stops[0].stop_type.v).toBe('pickup')
    expect(t.stops[0].party.city.v).toBe('Atlanta')
    expect(t.stops[0].party.state.v).toBe('GA')
    expect(t.stops[1].stop_type.v).toBe('delivery')
    expect(t.stops[1].party.city.v).toBe('Los Angeles')
  })

  it('finds the appointment windows the board colours by', () => {
    expect(String(t.stops[0].earliest.v)).toContain('2026-08-20')
    expect(String(t.stops[1].earliest.v)).toContain('2026-08-23')
  })

  it('raises no structural warnings on a complete tender', () => {
    expect(t.warnings).toEqual([])
  })
})

describe('textFromEml', () => {
  it('drops mail headers so they are not parsed as tender content', () => {
    const eml = [
      'From: dispatch@apex.com',
      'To: ops@solvix.com',
      'Subject: Load Tender LT-2026-89412',
      'Date: Wed, 19 Aug 2026 09:00:00 -0400',
      '',
      'Shipment ID: LT-2026-89412',
    ].join('\n')
    const body = textFromEml(eml)
    expect(body).toContain('Shipment ID: LT-2026-89412')
    expect(body).not.toContain('Subject:')
    expect(body).not.toContain('dispatch@apex.com')
  })

  it('decodes quoted-printable, which mail clients use constantly', () => {
    const eml = [
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Rate =3D $3,450.00 for a 53=27 van=20',
    ].join('\n')
    const body = textFromEml(eml)
    expect(body).toContain('$3,450.00')
    expect(body).toContain('=') // the =3D became a real '='
    expect(body).not.toContain('=3D')
  })

  it('takes the plain part of a multipart message, not the HTML', () => {
    const eml = [
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain',
      '',
      'Shipment ID: LT-1',
      '--XYZ',
      'Content-Type: text/html',
      '',
      '<html><body>Shipment ID: LT-1</body></html>',
      '--XYZ--',
    ].join('\n')
    const body = textFromEml(eml)
    expect(body).toContain('LT-1')
    expect(body).not.toContain('<html>')
  })

  it('passes a plain .txt through untouched', () => {
    const plain = 'Shipment ID: LT-9\nAtlanta, GA'
    expect(textFromEml(plain)).toBe(plain)
  })
})
