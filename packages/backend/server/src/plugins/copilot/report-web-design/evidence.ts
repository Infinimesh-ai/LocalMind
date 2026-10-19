import {
  DatasetKindSchema,
  EvidenceSalienceSchema,
  parseEvidenceNumber,
  RelationTypeSchema,
  type ReportDataset,
  type ReportRelation,
} from '@localmind/office/report-deck';
import { z } from 'zod';

import type { DeckChunk } from '../report-deck-prompts';
import { type DesignFact, DesignFactSchema, groundDesignFacts } from './facts';

const factRef = z.string().regex(/^f[0-9]{1,3}$/);

/** What the v4 extraction stage returns before grounding. */
export const EvidenceExtractionSchema = z
  .object({
    facts: z
      .array(
        z
          .object({
            ref: factRef,
            doc: z.number().int().min(0),
            text: z.string().max(600),
            quote: z.string().max(1200),
            kind: z.enum(['fact', 'number', 'date', 'risk', 'decision']),
            status: z.enum([
              'completed',
              'ongoing',
              'planned',
              'target',
              'unknown',
            ]),
            timeScope: z.string().max(200).nullable(),
            quantities: z
              .array(
                z
                  .object({
                    value: z.string().min(1).max(100),
                    unit: z.string().max(80).nullable(),
                    baseline: z.string().max(300).nullable(),
                  })
                  .strict()
              )
              .max(20),
            salience: EvidenceSalienceSchema,
            section: z.string().max(80).nullable(),
          })
          .strict()
      )
      .max(40),
    datasets: z
      .array(
        z
          .object({
            ref: z.string().regex(/^[a-z0-9-]{1,30}$/),
            title: z.string().min(1).max(120),
            unit: z.string().max(40).nullable(),
            kind: DatasetKindSchema,
            rows: z
              .array(
                z
                  .object({
                    label: z.string().min(1).max(60),
                    value: z.string().min(1).max(40),
                    fact: factRef,
                  })
                  .strict()
              )
              .min(2)
              .max(24),
          })
          .strict()
      )
      .max(8),
    relations: z
      .array(
        z
          .object({
            type: RelationTypeSchema,
            from: factRef,
            to: factRef,
            evidence: factRef,
          })
          .strict()
      )
      .max(30),
  })
  .strict();
export type EvidenceExtraction = z.infer<typeof EvidenceExtractionSchema>;

export const EvidenceFactSchema = DesignFactSchema.extend({
  salience: EvidenceSalienceSchema,
  section: z.string().max(80).nullable(),
}).strict();
export type EvidenceFact = z.infer<typeof EvidenceFactSchema>;

export type GroundedEvidence = {
  facts: EvidenceFact[];
  datasets: ReportDataset[];
  relations: ReportRelation[];
  rejected: number;
};

/**
 * Grounds facts against the source text, then accepts dataset rows and
 * relations only when they point at grounded facts whose literal quote
 * contains the row label and value. Nothing is inferred or computed here.
 */
export function groundEvidence(
  value: EvidenceExtraction,
  chunk: DeckChunk,
  offsets: { dataset: number; relation: number }
): GroundedEvidence {
  const byRef = new Map<string, EvidenceFact>();
  const facts: EvidenceFact[] = [];
  let rejected = 0;
  for (const candidate of value.facts) {
    const { ref, salience, section, ...rest } = candidate;
    // An empty statement means "use the quote" (saves output on the fast path).
    const base = { ...rest, text: rest.text.trim() || rest.quote.trim() };
    const grounded = groundDesignFacts({ facts: [base] }, chunk);
    rejected += grounded.rejected;
    const fact: DesignFact | undefined = grounded.facts[0];
    if (!fact) continue;
    const doc = chunk.parts[candidate.doc]?.text ?? '';
    const evidence: EvidenceFact = {
      ...fact,
      salience,
      section: section && doc.includes(section) ? section : null,
    };
    byRef.set(ref, facts.find(f => f.id === evidence.id) ?? evidence);
    if (!facts.some(f => f.id === evidence.id)) facts.push(evidence);
  }
  const datasets: ReportDataset[] = [];
  for (const candidate of value.datasets) {
    const rows: ReportDataset['rows'] = [];
    let valid = true;
    for (const row of candidate.rows) {
      const fact = byRef.get(row.fact);
      const label = row.label.trim();
      const literal = row.value.trim();
      const numeric = parseEvidenceNumber(literal);
      if (
        !fact ||
        numeric === null ||
        !fact.quote.includes(literal) ||
        // Values are literal; a label is either quoted or a short category
        // name without digits (e.g. 改善前/改善后), so it cannot carry data.
        !(
          fact.quote.includes(label) ||
          (label.length <= 12 && !/\d/.test(label))
        ) ||
        rows.some(r => r.label === label)
      ) {
        valid = false;
        break;
      }
      rows.push({ label, value: literal, numeric, factId: fact.id });
    }
    if (!valid || rows.length < 2) {
      rejected++;
      continue;
    }
    const quotes = rows.map(
      row => facts.find(f => f.id === row.factId)?.quote ?? ''
    );
    const declared = candidate.unit;
    const unit =
      declared && quotes.some(quote => quote.includes(declared))
        ? declared
        : null;
    datasets.push({
      id: `ds-${offsets.dataset + datasets.length + 1}-${candidate.ref}`.slice(
        0,
        43
      ),
      title: candidate.title.trim(),
      unit,
      kind: candidate.kind,
      rows,
    });
  }
  const relations: ReportRelation[] = [];
  for (const candidate of value.relations) {
    const from = byRef.get(candidate.from);
    const to = byRef.get(candidate.to);
    const evidence = byRef.get(candidate.evidence);
    if (!from || !to || !evidence || from.id === to.id) {
      rejected++;
      continue;
    }
    relations.push({
      id: `rel-${offsets.relation + relations.length + 1}`,
      type: candidate.type,
      from: from.id,
      to: to.id,
      factId: evidence.id,
    });
  }
  return { facts, datasets, relations, rejected };
}
