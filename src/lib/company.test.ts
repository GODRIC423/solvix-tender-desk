import { describe, expect, it } from 'vitest'
import { companyIdLine, companyLines, normalizeCompany, renderTemplate } from './company'

describe('the company profile', () => {
  it('gives an empty column the full shape with safe defaults', () => {
    const c = normalizeCompany({})
    expect(c.name).toBe('')
    expect(c.payment_terms_days).toBe(30)
    expect(c.logo_path).toBeNull()
  })

  it('keeps what is set and blanks what is empty', () => {
    const c = normalizeCompany({ name: 'Solvix', city: 'Marietta', state: '  ', payment_terms_days: '15' })
    expect(c.name).toBe('Solvix')
    expect(c.city).toBe('Marietta')
    expect(c.state).toBeNull()
    expect(c.payment_terms_days).toBe(15)
  })

  it('refuses nonsense payment terms', () => {
    expect(normalizeCompany({ payment_terms_days: -5 }).payment_terms_days).toBe(30)
    expect(normalizeCompany({ payment_terms_days: 'soon' }).payment_terms_days).toBe(30)
  })

  it('prints only the address lines that exist', () => {
    const c = normalizeCompany({ address1: '100 Terminal Rd', city: 'Marietta', state: 'GA', postal: '30062' })
    expect(companyLines(c)).toEqual(['100 Terminal Rd', 'Marietta, GA 30062'])
    expect(companyLines(normalizeCompany({ city: 'Atlanta' }))).toEqual(['Atlanta'])
  })

  it('joins the identifiers it has', () => {
    expect(companyIdLine(normalizeCompany({ mc_number: '123', scac: 'SLVX' }))).toBe('MC 123 · SLVX')
    expect(companyIdLine(normalizeCompany({}))).toBe('')
  })
})

describe('agreement templates', () => {
  it('fills placeholders and blanks the unknown ones', () => {
    const out = renderTemplate('Hi {{carrier_name}}, MC {{ carrier_mc }}. {{nope}}!', {
      carrier_name: 'Fast Freight',
      carrier_mc: '876543',
    })
    expect(out).toBe('Hi Fast Freight, MC 876543. !')
  })

  it('treats a null value as blank', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: null, b: 'x' })).toBe('-x')
  })
})
