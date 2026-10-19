import { z } from 'zod';

import { reportHash } from '../../../models/report-deck-design';
import {
  type DeckChunk,
  DeckExtractionSchema,
  groundDeckFacts,
} from '../report-deck-prompts';

const quantity = z
  .object({
    value: z.string().min(1).max(100),
    unit: z.string().max(80).nullable(),
    baseline: z.string().max(300).nullable(),
  })
  .strict();
export const DesignExtractionSchema = z
  .object({
    facts: z
      .array(
        DeckExtractionSchema.shape.facts.element
          .extend({
            status: z.enum([
              'completed',
              'ongoing',
              'planned',
              'target',
              'unknown',
            ]),
            timeScope: z.string().max(200).nullable(),
            quantities: z.array(quantity).max(20),
          })
          .strict()
      )
      .max(40),
  })
  .strict();

export const DesignFactSchema = z
  .object({
    id: z.string().max(64),
    text: z.string().max(600),
    quote: z.string().max(1200),
    kind: z.enum(['fact', 'number', 'date', 'risk', 'decision']),
    sourceIndex: z.number().int().nonnegative(),
    sourceTitle: z.string().max(512),
    sourceHash: z.string().length(64),
    quoteOffset: z.number().int().nonnegative(),
    role: z.enum(['document', 'background', 'work_order']),
    status: z.enum(['completed', 'ongoing', 'planned', 'target', 'unknown']),
    timeScope: z.string().max(200).nullable(),
    quantities: z.array(quantity).max(20),
  })
  .strict();
export type DesignFact = z.infer<typeof DesignFactSchema>;

export function groundDesignFacts(
  value: z.infer<typeof DesignExtractionSchema>,
  chunk: DeckChunk
) {
  const facts: DesignFact[] = [];
  let rejected = 0;
  for (const candidate of value.facts) {
    const { status, timeScope, quantities, ...base } = candidate;
    const grounded = groundDeckFacts({ facts: [base] }, chunk).facts[0];
    const source = chunk.parts[candidate.doc];
    if (
      !grounded ||
      !source ||
      !candidate.quote.trim() ||
      quantities.some(q => !candidate.quote.includes(q.value)) ||
      (status === 'completed' &&
        /计划|目标|拟|预计|planned|target|expected/i.test(candidate.quote) &&
        !/已完成|已实现|completed|achieved/i.test(candidate.quote))
    ) {
      rejected++;
      continue;
    }
    facts.push({
      ...grounded,
      status,
      // The grounded sentence/quote is authoritative. Optional metadata that is
      // not a literal quote is unknown; do not discard a valid quantitative fact.
      timeScope:
        timeScope && candidate.quote.includes(timeScope) ? timeScope : null,
      quantities: quantities.map(q => ({
        value: q.value,
        unit: q.unit && candidate.quote.includes(q.unit) ? q.unit : null,
        baseline:
          q.baseline && candidate.quote.includes(q.baseline)
            ? q.baseline
            : null,
      })),
      sourceHash: reportHash(source.text),
      quoteOffset: source.text.indexOf(candidate.quote.trim()),
    });
  }
  return { facts, rejected };
}
