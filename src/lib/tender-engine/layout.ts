/**
 * Layout engine — word boxes -> lines -> cells -> columns.
 *
 * Lifted verbatim from legacy/index.html L184-292 (the `Layout` IIFE).
 * Behavior is deliberately unchanged: every tolerance, gap factor and
 * clustering rule is tuned against real OCR output. Diff against the legacy
 * file before touching anything here.
 *
 * Load tenders are tables. Reading them as flat text throws away the column
 * structure that says which date belongs to which stop, so we rebuild the grid
 * from geometry instead of matching a per-shipper template.
 */

/** One word box out of the PDF text layer or Tesseract. */
export interface WordBox {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  conf?: number;
}

/** A run of words separated from its neighbours by a column-width gap. */
export interface Cell {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  conf: number;
  col: number;
}

/** A horizontal band of words, split into cells. */
export interface Line {
  top: number;
  bottom: number;
  words: WordBox[];
  cells: Cell[];
  text: string;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildLines(words: WordBox[], yTolRatio = 0.6): Line[] {
  if (!words.length) return [];
  const tol = median(words.map(w => Math.max(w.bottom - w.top, 1))) * yTolRatio;
  const ordered = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines: any[] = [];
  for (const w of ordered) {
    const mid = (w.top + w.bottom) / 2;
    let placed = false;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
      const ln = lines[i];
      if (Math.abs(mid - (ln.top + ln.bottom) / 2) <= tol) {
        ln.words.push(w);
        ln.top = Math.min(ln.top, w.top);
        ln.bottom = Math.max(ln.bottom, w.bottom);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push({ top: w.top, bottom: w.bottom, words: [w], cells: [] });
  }
  for (const ln of lines) {
    ln.words.sort((a: WordBox, b: WordBox) => a.x0 - b.x0);
    ln.text = ln.words.map((w: WordBox) => w.text).join(' ');
  }
  lines.sort((a, b) => a.top - b.top);
  return lines as Line[];
}

function mkCell(ws: any[]): Cell {
  return {
    text: ws.map(w => w.text).join(' '),
    x0: Math.min(...ws.map(w => w.x0)),
    x1: Math.max(...ws.map(w => w.x1)),
    top: Math.min(...ws.map(w => w.top)),
    bottom: Math.max(...ws.map(w => w.bottom)),
    conf: ws.reduce((a, w) => a + (w.conf ?? 1), 0) / ws.length,
    col: -1,
  };
}

/* Split a line wherever the horizontal gap is much wider than a normal
   inter-word space. That gap is a column boundary. */
export function splitCells(line: any, gapFactor = 2.2): Cell[] {
  const ws = line.words;
  if (!ws.length) return [];
  const gaps: number[] = [];
  for (let i = 0; i < ws.length - 1; i++) {
    const g = ws[i + 1].x0 - ws[i].x1;
    if (g > 0) gaps.push(g);
  }
  const base = Math.max(gaps.length ? median(gaps) : 3, 2);
  const threshold = Math.max(base * gapFactor, base + 6);
  const cells: Cell[] = [];
  let cur = [ws[0]];
  for (let i = 1; i < ws.length; i++) {
    if (ws[i].x0 - ws[i - 1].x1 > threshold) { cells.push(mkCell(cur)); cur = []; }
    cur.push(ws[i]);
  }
  cells.push(mkCell(cur));
  return cells;
}

export function assignColumns(lines: any[], tol = 12): number[] {
  const all: any[] = lines.flatMap(l => l.cells);
  if (!all.length) return [];
  const edges = all.map(c => c.x0).sort((a: number, b: number) => a - b);
  const clusters = [[edges[0]]];
  for (const e of edges.slice(1)) {
    const last = clusters[clusters.length - 1];
    if (e - last[last.length - 1] <= tol) last.push(e);
    else clusters.push([e]);
  }
  const centers = clusters.map(c => c.reduce((a, b) => a + b, 0) / c.length);
  for (const c of all) {
    let best = 0, bestD = Infinity;
    centers.forEach((ct, i) => {
      const d = Math.abs(ct - c.x0);
      if (d < bestD) { bestD = d; best = i; }
    });
    c.col = best;
  }
  return centers;
}

export function pageGrid(words: WordBox[], gapFactor = 2.2): Line[] {
  const lines = buildLines(words);
  for (const ln of lines) ln.cells = splitCells(ln, gapFactor);
  assignColumns(lines);
  return lines;
}
