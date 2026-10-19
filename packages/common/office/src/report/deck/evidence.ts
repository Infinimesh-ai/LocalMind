import { z } from 'zod';

/**
 * Evidence model for generated web reports (v4). Facts stay the grounded unit;
 * datasets group literal values from those facts so charts and derived values
 * can be produced by the application instead of being typed by a model.
 */

export const EvidenceSalienceSchema = z.enum([
  'headline',
  'key',
  'support',
  'context',
]);
export type EvidenceSalience = z.infer<typeof EvidenceSalienceSchema>;

export const DatasetKindSchema = z.enum([
  'series',
  'category',
  'part_whole',
  'status_count',
]);
export const RelationTypeSchema = z.enum([
  'sequence',
  'cause',
  'part_of',
  'compares',
  'depends_on',
  'contradicts',
]);

const datasetId = z.string().regex(/^ds-[a-z0-9-]{1,40}$/);
const factId = z.string().min(1).max(64);

export const ReportDatasetSchema = z
  .object({
    id: datasetId,
    title: z.string().trim().min(1).max(120),
    unit: z.string().max(40).nullable(),
    kind: DatasetKindSchema,
    rows: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(60),
            value: z.string().trim().min(1).max(40),
            numeric: z.number().finite(),
            factId,
          })
          .strict()
      )
      .min(2)
      .max(24),
  })
  .strict();
export type ReportDataset = z.infer<typeof ReportDatasetSchema>;

export const ReportRelationSchema = z
  .object({
    id: z.string().regex(/^rel-[a-z0-9-]{1,40}$/),
    type: RelationTypeSchema,
    from: factId,
    to: factId,
    factId,
  })
  .strict();
export type ReportRelation = z.infer<typeof ReportRelationSchema>;

export const DerivationOpSchema = z.enum([
  'difference',
  'change_pct',
  'ratio',
  'share',
  'sum',
  'average',
  'max',
  'min',
]);
export type DerivationOp = z.infer<typeof DerivationOpSchema>;

export const DerivationRequestSchema = z
  .object({
    id: z.string().regex(/^d-[a-z0-9-]{1,40}$/),
    op: DerivationOpSchema,
    dataset: datasetId,
    inputs: z.array(z.string().trim().min(1).max(60)).min(1).max(24),
  })
  .strict();
export type DerivationRequest = z.infer<typeof DerivationRequestSchema>;

export const DerivedValueSchema = z
  .object({
    id: z.string(),
    op: DerivationOpSchema,
    dataset: z.string(),
    inputs: z.array(z.string()),
    display: z.string(),
    numeric: z.number(),
    unit: z.string().nullable(),
    formula: z.string(),
    factIds: z.array(z.string()),
  })
  .strict();
export type DerivedValue = z.infer<typeof DerivedValueSchema>;

/** First number in a literal value, ignoring thousands separators. */
export function parseEvidenceNumber(value: string): number | null {
  const match = /-?\d[\d,，]*(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const n = Number(match[0].replace(/[,，]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normalized numeric token used by fact gates: `1,234` and `1234` match. */
export const normalizeNumberToken = (token: string) =>
  token.replace(/[,，]/g, '').replace(/％/g, '%');

export function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,，]\d+)*(?:%|％)?/g) ?? []).map(
    normalizeNumberToken
  );
}

const trim = (n: number, digits: number) => {
  const fixed = Number(n.toFixed(digits));
  return Object.is(fixed, -0) ? 0 : fixed;
};

export function formatDerived(n: number, digits = 1) {
  const abs = Math.abs(n);
  return String(trim(n, abs >= 100 ? 0 : abs >= 10 ? 1 : digits + 1));
}

const signed = (text: string, n: number) => (n > 0 ? `+${text}` : text);

/**
 * Deterministically computes requested derived values. Inputs refer to dataset
 * row labels; every input must exist and the operation must suit the data.
 */
export function computeDerivations(
  datasets: readonly ReportDataset[],
  requests: readonly DerivationRequest[]
) {
  const values: DerivedValue[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const request of requests) {
    const dataset = datasets.find(d => d.id === request.dataset);
    const reject = (reason: string) =>
      rejected.push({ id: request.id, reason });
    if (!dataset) {
      reject(`dataset ${request.dataset} does not exist`);
      continue;
    }
    const rows = request.inputs.map(label =>
      dataset.rows.find(row => row.label === label)
    );
    if (rows.some(row => !row)) {
      reject(
        `inputs must be exact row labels of ${dataset.id}: ${dataset.rows
          .map(r => r.label)
          .join(' / ')}`
      );
      continue;
    }
    const picked = rows as ReportDataset['rows'];
    const nums = picked.map(row => row.numeric);
    const percentUnit = /%|％|百分/.test(
      `${dataset.unit ?? ''}${picked.map(r => r.value).join('')}`
    );
    const unit = dataset.unit;
    const list = picked.map(r => `${r.label} ${r.value}`).join('、');
    let numeric: number;
    let display: string;
    let outUnit: string | null = unit;
    let formula: string;
    switch (request.op) {
      case 'difference': {
        if (picked.length !== 2) {
          reject('difference needs exactly two inputs: [from, to]');
          continue;
        }
        numeric = nums[1] - nums[0];
        display = signed(formatDerived(numeric), numeric);
        formula = `${picked[1].label} ${picked[1].value} − ${picked[0].label} ${picked[0].value}`;
        break;
      }
      case 'change_pct': {
        if (picked.length !== 2 || nums[0] === 0) {
          reject('change_pct needs two inputs [from, to] and a non-zero start');
          continue;
        }
        if (percentUnit) {
          reject(
            'change_pct on percentage values is ambiguous; use difference'
          );
          continue;
        }
        numeric = ((nums[1] - nums[0]) / Math.abs(nums[0])) * 100;
        display = `${signed(formatDerived(numeric), numeric)}%`;
        outUnit = '%';
        formula = `(${picked[1].value} − ${picked[0].value}) ÷ ${picked[0].value} × 100%`;
        break;
      }
      case 'ratio': {
        if (picked.length !== 2 || nums[1] === 0) {
          reject('ratio needs two inputs [numerator, denominator≠0]');
          continue;
        }
        numeric = nums[0] / nums[1];
        display = formatDerived(numeric);
        outUnit = null;
        formula = `${picked[0].value} ÷ ${picked[1].value}`;
        break;
      }
      case 'share': {
        if (
          !['part_whole', 'status_count', 'category'].includes(dataset.kind) ||
          percentUnit
        ) {
          reject('share needs a part_whole/status_count/category dataset');
          continue;
        }
        const total = dataset.rows.reduce((sum, row) => sum + row.numeric, 0);
        if (total <= 0 || dataset.rows.some(row => row.numeric < 0)) {
          reject('share needs a positive total of non-negative parts');
          continue;
        }
        numeric = (nums.reduce((a, b) => a + b, 0) / total) * 100;
        display = `${formatDerived(numeric)}%`;
        outUnit = '%';
        formula = `(${list}) ÷ 全部 ${trim(total, 2)} × 100%`;
        break;
      }
      case 'sum':
      case 'average': {
        if (picked.length < 2 || percentUnit) {
          reject(`${request.op} needs ≥2 non-percentage inputs`);
          continue;
        }
        const sum = nums.reduce((a, b) => a + b, 0);
        numeric = request.op === 'sum' ? sum : sum / nums.length;
        display = formatDerived(numeric);
        formula = `${request.op === 'sum' ? '合计' : '平均'}(${list})`;
        break;
      }
      case 'max':
      case 'min': {
        if (picked.length < 2) {
          reject(`${request.op} needs ≥2 inputs`);
          continue;
        }
        numeric = request.op === 'max' ? Math.max(...nums) : Math.min(...nums);
        display = picked[nums.indexOf(numeric)].value;
        formula = `${request.op}(${list})`;
        break;
      }
    }
    values.push({
      id: request.id,
      op: request.op,
      dataset: dataset.id,
      inputs: request.inputs,
      display,
      numeric,
      unit: outUnit,
      formula,
      factIds: [...new Set(picked.map(row => row.factId))],
    });
  }
  return { values, rejected };
}
