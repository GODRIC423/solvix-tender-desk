/**
 * Ingest — any file -> pages of word boxes.
 *
 * Lifted verbatim from legacy/index.html L1512-1808 (the `Ingest` IIFE).
 *
 *   Layer 1  PDF text layer (pdf.js)        near-perfect, instant, tiny download
 *   Layer 2  Tesseract OCR (tesseract.js)   scans, images, faxes
 *
 * Tesseract is loaded lazily: a digital PDF never pays for the ~16MB OCR
 * engine, and most tenders are digital PDFs. The browser coupling (CDN script
 * tags, <canvas> preprocessing) is inherent to the design and is preserved,
 * as is the multi-pass OCR strategy — the thresholds, the PSM modes and the
 * bbox-overlap merge are what make faxed tenders readable. Diff against the
 * legacy file before changing anything.
 */

declare global {
  interface Window {
    SOLVIX_ASSETS?: string;
    pdfjsLib: any;
    Tesseract: any;
  }
}

/** One ingested page: word boxes plus the flat text and a preview image. */
export interface IngestPage {
  number: number;
  words: any[];
  text: string;
  width: number;
  height: number;
  source: 'textlayer' | 'ocr';
  meanConf: number;
  image: string | null;
}

export interface IngestResult {
  kind: string;
  pages: IngestPage[];
}

export type ProgressFn = (message: string, fraction: number) => void;

/* Set window.SOLVIX_ASSETS to a local folder to run with no internet at all
   (the offline bundle does exactly that). Otherwise everything comes from a
   CDN on first use and the browser caches it. */
const LOCAL = (typeof window !== 'undefined' && window.SOLVIX_ASSETS) || null;
export const CDN: Record<string, string | null> = LOCAL ? {
  pdf: LOCAL + '/pdf.min.js',
  pdfWorker: LOCAL + '/pdf.worker.min.js',
  tesseract: LOCAL + '/tesseract.min.js',
  tessWorker: LOCAL + '/worker.min.js',
  tessCore: LOCAL + '/core',
  tessLang: LOCAL + '/lang',
} : {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
  tessWorker: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/worker.min.js',
  tessCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  tessLang: null,
};
const MIN_TEXTLAYER_CHARS = 120;

let pdfReady: any = null, tessWorker: any = null;

function loadScript(src: any): Promise<void> {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const el = document.createElement('script');
    el.src = src; el.onload = () => res(); el.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(el);
  });
}

async function ensurePdf() {
  if (!pdfReady) pdfReady = loadScript(CDN.pdf).then(() => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  });
  return pdfReady;
}

async function ensureTesseract(onProgress?: ProgressFn) {
  if (tessWorker) return tessWorker;
  onProgress && onProgress('Downloading OCR engine (first run only)…', 0.05);
  await loadScript(CDN.tesseract);
  onProgress && onProgress('Starting OCR engine…', 0.15);
  const opts: any = {
    workerPath: CDN.tessWorker,
    corePath: CDN.tessCore,
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress)
        onProgress('Reading the document…', 0.3 + m.progress * 0.6);
    },
  };
  if (CDN.tessLang) { opts.langPath = CDN.tessLang; opts.gzip = true; }
  tessWorker = await window.Tesseract.createWorker('eng', 1, opts);
  return tessWorker;
}

/* pdf.js gives text runs, not words. Split each run and hand out the width
   proportionally — plenty accurate next to a column gap. */
function wordsFromTextContent(content: any, viewport: any): any[] {
  const out = [];
  for (const item of content.items) {
    const str = item.str;
    if (!str || !str.trim()) continue;
    const tr = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
    const h = Math.hypot(tr[2], tr[3]) || item.height || 10;
    const x = tr[4];
    const yTop = tr[5] - h;
    const total = item.width || (str.length * h * 0.5);
    const parts = [];
    let idx = 0;
    for (const tok of str.split(/(\s+)/)) {
      if (tok.trim()) parts.push({ tok, start: idx });
      idx += tok.length;
    }
    const perChar = total / Math.max(str.length, 1);
    for (const p of parts) {
      const x0 = x + p.start * perChar;
      out.push({ text: p.tok, x0, x1: x0 + p.tok.length * perChar,
                 top: yTop, bottom: yTop + h, conf: 0.99 });
    }
  }
  return out;
}

async function renderPage(page: any, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

/* Upscale + autocontrast + binarize. Low-res faxed tenders need this;
   without it accuracy on 8pt table text collapses. */
function preprocess(canvasOrImage: any, threshold = 170) {
  const srcW = canvasOrImage.width || canvasOrImage.naturalWidth;
  const srcH = canvasOrImage.height || canvasOrImage.naturalHeight;
  const scale = Math.max(srcW, srcH) < 2600 ? 3 : 1;
  const c = document.createElement('canvas');
  c.width = srcW * scale; c.height = srcH * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvasOrImage, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(hi - lo, 1);
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - lo) * 255) / span;
    const v = g > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, scaleBack: srcW / c.width };
}

function flattenWords(data: any): any[] {
  if (data.words && data.words.length) return data.words;
  const out: any[] = [];
  for (const b of data.blocks || [])
    for (const par of b.paragraphs || [])
      for (const ln of par.lines || [])
        out.push(...(ln.words || []));
  return out;
}

const overlaps = (a: any, b: any) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (ix <= 0 || iy <= 0) return false;
  return (ix * iy) / Math.max((a.x1 - a.x0) * (a.bottom - a.top), 1) > 0.45;
};

/* Multi-pass OCR, exactly as the server engine does it.

   Three binarization thresholds x two page-segmentation modes, all unioned.
   PSM 4  gets reading order right for the body tables.
   PSM 11 is sparse mode: it recovers isolated label/value pairs in letterhead
   blocks that PSM 4 drops when a logo confuses layout analysis.
   A load number swallowed by a logo at one threshold survives at another —
   that redundancy is most of the accuracy on faxed tenders. */
let OCR_EFFORT = 'thorough';           // 'thorough' | 'fast'
export const setOcrEffort = (v: any) => { OCR_EFFORT = v; };

const toBlob = (canvas: HTMLCanvasElement): Promise<any> =>
  new Promise(r => canvas.toBlob(r as any, 'image/png'));

function wordsFrom(data: any, scaleBack: number): any[] {
  const out = [];
  for (const w of flattenWords(data)) {
    const t = (w.text || '').trim();
    if (!t || (w.confidence ?? 0) < 0) continue;
    out.push({ text: t, x0: w.bbox.x0 * scaleBack, x1: w.bbox.x1 * scaleBack,
               top: w.bbox.y0 * scaleBack, bottom: w.bbox.y1 * scaleBack,
               conf: (w.confidence ?? 60) / 100 });
  }
  return out;
}

async function ocrCanvas(source: any, onProgress?: ProgressFn) {
  const worker = await ensureTesseract(onProgress);
  const thresholds = OCR_EFFORT === 'fast' ? [170] : [170, 190, 150];
  const total = thresholds.length * 2;
  let done = 0;
  const step = () => {
    done++;
    onProgress && onProgress(`Reading the document (pass ${done} of ${total})…`,
                             0.25 + (done / total) * 0.65);
  };

  const variants: any[] = [];
  for (const thr of thresholds) {
    const { canvas, scaleBack } = preprocess(source, thr);
    const blob = await toBlob(canvas);
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
    step();
    const words = wordsFrom(data, scaleBack);
    const mean = words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0;
    variants.push({ blob, scaleBack, words, text: data.text || '',
                    rank: mean * (1 + Math.min(words.length, 400) / 800) });
  }
  variants.sort((a, b) => b.rank - a.rank);

  const merged = [...variants[0].words];
  let text = variants[0].text;
  for (const v of variants) {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data } = await worker.recognize(v.blob, {}, { text: true, blocks: true });
    step();
    const candidates = [...wordsFrom(data, v.scaleBack),
                        ...(v === variants[0] ? [] : v.words)];
    for (const box of candidates)
      if (!merged.some(m => overlaps(box, m))) merged.push(box);
    if (data.text) {
      const flow = text.replace(/\s+/g, ' ').toLowerCase();
      const extra = data.text.split('\n').map((x: string) => x.trim())
        .filter((x: string) => x && !flow.includes(x.replace(/\s+/g, ' ').toLowerCase()));
      if (extra.length) text += '\n' + extra.join('\n');
    }
  }
  const meanConf = merged.length ? merged.reduce((a, w) => a + w.conf, 0) / merged.length : 0;
  return { words: merged, text, meanConf };
}

const canvasToUrl = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.75);

async function loadPdf(arrayBuffer: any, onProgress?: ProgressFn): Promise<IngestResult> {
  await ensurePdf();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: IngestPage[] = [];
  let kind = 'pdf-text';
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress && onProgress(`Reading page ${i} of ${pdf.numPages}…`, i / pdf.numPages * 0.5);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const rawText = content.items.map((it: any) => it.str).join(' ').trim();
    const viewCanvas = await renderPage(page, 1.6);
    if (rawText.length >= MIN_TEXTLAYER_CHARS) {
      pages.push({ number: i, words: wordsFromTextContent(content, viewport),
                   text: rawText, width: viewport.width, height: viewport.height,
                   source: 'textlayer', meanConf: 0.99, image: canvasToUrl(viewCanvas) });
    } else {
      kind = 'pdf-scan';
      const big = await renderPage(page, 2.2);
      const r = await ocrCanvas(big, onProgress);
      const k = viewport.width / big.width;
      pages.push({ number: i,
                   words: r.words.map((w: any) => ({ ...w, x0: w.x0 * k, x1: w.x1 * k,
                                              top: w.top * k, bottom: w.bottom * k })),
                   text: r.text, width: viewport.width, height: viewport.height,
                   source: 'ocr', meanConf: r.meanConf, image: canvasToUrl(viewCanvas) });
    }
  }
  return { kind, pages };
}

async function loadImage(dataUrl: any, onProgress?: ProgressFn): Promise<IngestResult> {
  const img: any = await new Promise((res, rej) => {
    const el = new Image();
    el.onload = () => res(el); el.onerror = rej; el.src = dataUrl;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  (c.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0);
  const r = await ocrCanvas(c, onProgress);
  return { kind: 'image',
           pages: [{ number: 1, words: r.words, text: r.text, width: img.naturalWidth,
                     height: img.naturalHeight, source: 'ocr', meanConf: r.meanConf,
                     image: canvasToUrl(c) }] };
}

const readAsArrayBuffer = (f: any): Promise<any> => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej;
  r.readAsArrayBuffer(f);
});
const readAsDataUrl = (f: any): Promise<any> => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej;
  r.readAsDataURL(f);
});

export async function load(file: any, onProgress?: ProgressFn): Promise<IngestResult> {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf')
    return loadPdf(await readAsArrayBuffer(file), onProgress);
  if (/\.(png|jpe?g|tiff?|bmp|webp|gif)$/.test(name) || (file.type || '').startsWith('image/'))
    return loadImage(await readAsDataUrl(file), onProgress);
  if (/\.(txt|eml)$/.test(name)) {
    const text = await file.text();
    return { kind: 'text', pages: [{ number: 1, words: [], text, width: 0, height: 0,
                                     source: 'textlayer', meanConf: 0.99, image: null }] };
  }
  throw new Error('Unsupported file type: ' + (name || file.type));
}

export async function loadFromBase64(b64: string, filename: string, onProgress?: ProgressFn): Promise<IngestResult> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob: any = new Blob([bytes]);
  blob.name = filename;
  return load(Object.assign(blob, { name: filename }), onProgress);
}
