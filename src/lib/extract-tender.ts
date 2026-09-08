/**
 * The full document -> LoadTender path, in one call.
 *
 * This mirrors exactly what the legacy app did in `App.ingestFile`
 * (legacy/index.html ~L1983-2002): ingest the file, build a geometric grid per
 * page, run the rule extractor over all lines, post-process, then score. Kept
 * in one place so the connector and anything else that ingests a document
 * cannot drift apart.
 */

import * as Ingest from './tender-engine/ingest'
import * as Layout from './tender-engine/layout'
import * as Pipeline from './tender-engine/pipeline'
import type { LoadTender } from '@/types/tender'

export interface ExtractionResult {
  tender: LoadTender
  score: number
  pages: Ingest.IngestPage[]
  kind: string
}

export async function extractFromFile(
  file: File,
  onProgress?: Ingest.ProgressFn,
): Promise<ExtractionResult> {
  const doc = await Ingest.load(file, onProgress)
  return finish(doc, file.name)
}

export async function extractFromBase64(
  base64: string,
  filename: string,
  onProgress?: Ingest.ProgressFn,
): Promise<ExtractionResult> {
  const doc = await Ingest.loadFromBase64(base64, filename, onProgress)
  return finish(doc, filename)
}

function finish(doc: Ingest.IngestResult, filename: string): ExtractionResult {
  const allLines: any[] = []
  for (const pg of doc.pages) allLines.push(...Layout.pageGrid(pg.words))

  const tender = Pipeline.extractRules(allLines, doc.pages.map((p) => p.text).join('\n'))
  tender.source_file = filename
  tender.source_kind = doc.kind
  Pipeline.postprocess(tender)

  return {
    tender,
    score: Pipeline.confidenceReport(tender).score,
    pages: doc.pages,
    kind: doc.kind,
  }
}
