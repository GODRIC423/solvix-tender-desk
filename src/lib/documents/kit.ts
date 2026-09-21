import { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable'
import { companyIdLine, companyLines, type CompanyProfile } from '@/lib/company'

/**
 * A thin layer over jsPDF so every document we send out is built from the
 * same handful of parts — letterhead, headings, label/value grids, tables,
 * signature lines, footer — and looks like it came from the same desk.
 * Units are points on US Letter.
 */

export interface LogoImage {
  dataUrl: string
  format: 'PNG' | 'JPEG'
  width: number
  height: number
}

export const PAGE = { w: 612, h: 792, margin: 40 } as const

type Rgb = [number, number, number]
const INK: Rgb = [30, 41, 59]
const MUTED: Rgb = [100, 116, 139]
const LINE: Rgb = [203, 213, 225]
const FILL: Rgb = [241, 245, 249]

export class PdfDoc {
  readonly doc: jsPDF
  y: number = PAGE.margin
  private footerText = ''

  constructor() {
    this.doc = new jsPDF({ unit: 'pt', format: 'letter' })
    this.doc.setFont('helvetica', 'normal')
  }

  get contentWidth(): number {
    return PAGE.w - PAGE.margin * 2
  }

  /** Start a new page when `height` more points will not fit above the footer. */
  ensureRoom(height: number): void {
    if (this.y + height > PAGE.h - PAGE.margin - 20) {
      this.doc.addPage()
      this.y = PAGE.margin
    }
  }

  letterhead(o: {
    company: CompanyProfile
    logo: LogoImage | null
    title: string
    subtitle?: string | null
    meta?: Array<[string, string]>
  }): void {
    const { doc } = this
    const top = PAGE.margin
    let x: number = PAGE.margin

    if (o.logo) {
      const h = 40
      const w = Math.min(150, (o.logo.width / Math.max(1, o.logo.height)) * h)
      doc.addImage(o.logo.dataUrl, o.logo.format, x, top, w, h)
      x += w + 12
    }

    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK)
    doc.text(o.company.name || 'Your company', x, top + 11)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
    const lines = [
      ...companyLines(o.company),
      [o.company.phone, o.company.email].filter(Boolean).join(' · '),
      companyIdLine(o.company),
    ].filter((s) => s && s.trim() !== '')
    lines.forEach((l, i) => doc.text(l, x, top + 23 + i * 10))

    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK)
    doc.text(o.title, PAGE.w - PAGE.margin, top + 14, { align: 'right' })
    let my = top + 28
    if (o.subtitle) {
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED)
      doc.text(o.subtitle, PAGE.w - PAGE.margin, my, { align: 'right' })
      my += 14
    }
    for (const [k, v] of o.meta ?? []) {
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...INK)
      const valueWidth = doc.getTextWidth(v)
      doc.text(v, PAGE.w - PAGE.margin, my, { align: 'right' })
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED)
      doc.text(k, PAGE.w - PAGE.margin - valueWidth - 6, my, { align: 'right' })
      my += 11
    }

    this.y = Math.max(top + 23 + lines.length * 10, my, top + 44) + 8
    this.rule()
  }

  rule(): void {
    this.doc.setDrawColor(...LINE).setLineWidth(0.6)
    this.doc.line(PAGE.margin, this.y, PAGE.w - PAGE.margin, this.y)
    this.y += 12
  }

  h2(text: string): void {
    this.ensureRoom(24)
    const { doc } = this
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...MUTED)
    doc.text(text.toUpperCase(), PAGE.margin, this.y)
    this.y += 5
    doc.setDrawColor(...LINE).setLineWidth(0.4)
    doc.line(PAGE.margin, this.y, PAGE.w - PAGE.margin, this.y)
    this.y += 11
  }

  text(text: string, opts: { size?: number; muted?: boolean; bold?: boolean; gap?: number } = {}): void {
    const size = opts.size ?? 9
    const { doc } = this
    doc
      .setFont('helvetica', opts.bold ? 'bold' : 'normal')
      .setFontSize(size)
      .setTextColor(...(opts.muted ? MUTED : INK))
    const lines = doc.splitTextToSize(text, this.contentWidth) as string[]
    const lh = size * 1.4
    for (const l of lines) {
      this.ensureRoom(lh)
      doc.text(l, PAGE.margin, this.y)
      this.y += lh
    }
    this.y += opts.gap ?? 4
  }

  /** Label-over-value pairs in columns. Blank values are left out entirely. */
  kv(pairs: Array<[string, string | null | undefined]>, cols = 3): void {
    const items = pairs.filter((p): p is [string, string] => p[1] != null && String(p[1]).trim() !== '')
    if (items.length === 0) return
    const { doc } = this
    const colW = this.contentWidth / cols
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols)
      doc.setFont('helvetica', 'normal').setFontSize(9.5)
      const wrapped = row.map(([, v]) => doc.splitTextToSize(v, colW - 10) as string[])
      const rowH = 12 + Math.max(...wrapped.map((w) => w.length)) * 11 + 6
      this.ensureRoom(rowH)
      row.forEach(([k], c) => {
        const x = PAGE.margin + c * colW
        doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
        doc.text(k.toUpperCase(), x, this.y)
        doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
        wrapped[c].forEach((line, li) => doc.text(line, x, this.y + 11 + li * 11))
      })
      this.y += rowH
    }
    this.y += 2
  }

  /** Side-by-side blocks, e.g. "Ship from" and "Ship to". */
  columns(blocks: Array<{ title: string; lines: string[] }>): void {
    const { doc } = this
    const n = Math.max(1, blocks.length)
    const colW = this.contentWidth / n
    doc.setFont('helvetica', 'normal').setFontSize(9)
    const wrapped = blocks.map((b) =>
      b.lines
        .filter((l) => l && l.trim() !== '')
        .flatMap((l) => doc.splitTextToSize(l, colW - 12) as string[]),
    )
    const h = 14 + Math.max(0, ...wrapped.map((w) => w.length)) * 11 + 8
    this.ensureRoom(h)
    blocks.forEach((b, i) => {
      const x = PAGE.margin + i * colW
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED)
      doc.text(b.title.toUpperCase(), x, this.y)
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
      wrapped[i].forEach((line, li) => doc.text(line, x, this.y + 12 + li * 11))
    })
    this.y += h
  }

  table(
    head: string[],
    body: RowInput[],
    opts: { columnStyles?: Record<number, Partial<Styles>>; foot?: RowInput } = {},
  ): void {
    this.ensureRoom(48)
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body,
      foot: opts.foot ? [opts.foot] : undefined,
      margin: { left: PAGE.margin, right: PAGE.margin },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 4,
        textColor: INK,
        lineColor: LINE,
        lineWidth: 0.3,
        overflow: 'linebreak',
      },
      headStyles: { fillColor: FILL, textColor: INK, fontStyle: 'bold' },
      footStyles: { fillColor: FILL, textColor: INK, fontStyle: 'bold' },
      columnStyles: opts.columnStyles,
    })
    const finalY = (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    this.y = (finalY ?? this.y + 48) + 12
  }

  /** Lines to sign on, each with a small label underneath. */
  signatures(labels: string[]): void {
    const { doc } = this
    const n = Math.max(1, labels.length)
    const colW = this.contentWidth / n
    this.ensureRoom(52)
    this.y += 24
    labels.forEach((label, i) => {
      const x = PAGE.margin + i * colW
      doc.setDrawColor(...INK).setLineWidth(0.5)
      doc.line(x, this.y, x + colW - 16, this.y)
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      doc.text(label.toUpperCase(), x, this.y + 10)
    })
    this.y += 26
  }

  /** "☐ item" lines with a blank to write on. */
  checklist(items: string[]): void {
    const { doc } = this
    for (const item of items) {
      this.ensureRoom(14)
      doc.setDrawColor(...INK).setLineWidth(0.5)
      doc.rect(PAGE.margin, this.y - 7, 8, 8)
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
      doc.text(item, PAGE.margin + 14, this.y)
      this.y += 14
    }
    this.y += 4
  }

  setFooter(text: string): void {
    this.footerText = text
  }

  /** Stamp the footer and page numbers on every page and hand back the file. */
  finish(): Blob {
    const { doc } = this
    const pages = doc.getNumberOfPages()
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      if (this.footerText) {
        const lines = doc.splitTextToSize(this.footerText, this.contentWidth - 70) as string[]
        doc.text(lines[0] ?? '', PAGE.margin, PAGE.h - 22)
      }
      doc.text(`Page ${p} of ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 22, { align: 'right' })
    }
    return doc.output('blob')
  }
}

/**
 * Fetch the logo and learn its size, so it can be scaled onto the letterhead
 * without distortion. Anything that goes wrong means "no logo", never "no
 * document".
 */
export async function loadLogo(url: string | null | undefined): Promise<LogoImage | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const format: LogoImage['format'] | null = blob.type.includes('png')
      ? 'PNG'
      : blob.type.includes('jpeg') || blob.type.includes('jpg')
        ? 'JPEG'
        : null
    if (!format) return null
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => reject(new Error('logo is not a readable image'))
      img.src = dataUrl
    })
    return { dataUrl, format, width: size.w, height: size.h }
  } catch {
    return null
  }
}
