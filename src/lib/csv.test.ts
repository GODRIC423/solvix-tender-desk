import { describe, expect, it } from 'vitest'
import { csvToObjects, normalizeHeader, parseCsv, toCsv } from './csv'

describe('parseCsv', () => {
  it('splits plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quotes', () => {
    expect(parseCsv('name,city\n"Acme, Inc.",Atlanta')).toEqual([
      ['name', 'city'],
      ['Acme, Inc.', 'Atlanta'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"R ""Bud"" Jones"')).toEqual([['R "Bud" Jones']])
  })

  it('handles CRLF and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps newlines inside a quoted cell', () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([['note'], ['line one\nline two']])
  })

  it('strips a UTF-8 BOM from Excel', () => {
    expect(parseCsv('﻿name\nAcme')).toEqual([['name'], ['Acme']])
  })

  it('drops rows that are entirely blank', () => {
    expect(parseCsv('a,b\n,\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('toCsv', () => {
  it('quotes only what needs quoting', () => {
    expect(toCsv([['plain', 'has,comma', 'has "quote"', null, ['van', 'reefer']]])).toBe(
      'plain,"has,comma","has ""quote""",,van; reefer\r\n',
    )
  })

  it('round-trips through parseCsv', () => {
    const rows = [
      ['name', 'notes'],
      ['Acme, Inc.', 'said "no"\nthen yes'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('csvToObjects', () => {
  it('keys rows by normalised header', () => {
    const t = csvToObjects('Carrier Name,DOT #\nAcme,123')
    expect(t.headers).toEqual(['carrier_name', 'dot'])
    expect(t.rows).toEqual([{ carrier_name: 'Acme', dot: '123' }])
  })

  it('normalises the ways people write a header', () => {
    expect(normalizeHeader(' Dispatch Contact Phone ')).toBe('dispatch_contact_phone')
    expect(normalizeHeader('dispatch_contact_phone')).toBe('dispatch_contact_phone')
    expect(normalizeHeader('MC Number')).toBe('mc_number')
  })

  it('pads short rows with empty strings', () => {
    const t = csvToObjects('a,b,c\n1')
    expect(t.rows[0]).toEqual({ a: '1', b: '', c: '' })
  })
})
