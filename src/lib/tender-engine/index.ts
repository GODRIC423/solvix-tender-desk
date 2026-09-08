/**
 * Tender engine — public surface.
 *
 * The whole engine is a near-verbatim lift of the parsing core from
 * legacy/index.html (L184-1946). The namespaces below keep the legacy call
 * sites intact: `Layout.pageGrid(...)`, `P.F(...)`, `Pipeline.extractRules(...)`,
 * `EDI.build204(...)`, `Ingest.load(...)`.
 */

export * as Layout from './layout';
export * as P from './parsers';
export * as Pipeline from './pipeline';
export * as EDI from './edi';
export * as Ingest from './ingest';

/* Field / slot / label / group maps used to lay out the review screen. */
export * from './field-map';

export type { Cell, Line, WordBox } from './layout';
export type { ConfidenceField, EngineConfidenceReport } from './pipeline';
export type {
  EdiIssue,
  EdiIssueSummary,
  EnvelopeResult,
  IssueLevel,
  PartnerConfig,
  PartnerDelimiters,
  PartnerEnvelope,
  PartnerOptions,
  Segment,
} from './edi';
export type { IngestPage, IngestResult, ProgressFn } from './ingest';
