import { z } from 'zod';

import { ChartMarkSchema, ReportChartSpecSchema } from './charts';
import {
  computeDerivations,
  DerivationRequestSchema,
  type DerivedValue,
  type ReportDataset,
} from './evidence';
import { REPORT_REVEAL_EFFECTS, REPORT_WEB_V4_ROOT_VALUE } from './runtime';

/** Contracts for the v4 web-report engine: experience plan, bundle, review. */
export const REPORT_WEB_V4 = 'report-web-v4';
export const REPORT_WEB_V4_ROOT = `[data-content-root="${REPORT_WEB_V4_ROOT_VALUE}"]`;

const text = (max: number) => z.string().trim().min(1).max(max);
const factId = z.string().min(1).max(64);
const chapterId = z.string().regex(/^rd-c-[a-z0-9-]{1,32}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const range = (min: number, max: number) =>
  z
    .object({
      min: z.number().int().min(min).max(max),
      max: z.number().int().min(min).max(max),
    })
    .strict();

export const DirectionArchetypeSchema = z.enum([
  'data-poster',
  'editorial-spread',
  'control-room',
  'dossier',
  'route-map',
  'long-scroll',
  'lab-comparison',
  'whitepaper',
  'manifesto',
  'field-notes',
]);
export const LayoutArchetypeSchema = z.enum([
  'poster-statement',
  'figure-dominant',
  'split-evidence',
  'comparison',
  'sequence-rail',
  'timeline',
  'matrix',
  'annotated-figure',
  'ledger',
  'pull-quote',
  'scrolly-figure',
  'action-close',
]);
export type LayoutArchetype = z.infer<typeof LayoutArchetypeSchema>;
export const StoryBeatSchema = z.enum([
  'hook',
  'context',
  'evidence',
  'comparison',
  'process',
  'risk',
  'decision',
  'close',
]);
export const MotionEffectSchema = z.enum(REPORT_REVEAL_EFFECTS);
export const InteractionKindSchema = z.enum([
  'switch',
  'linked',
  'scrolly',
  'disclosure',
]);

export const ChapterMotionSchema = z
  .object({
    entrance: MotionEffectSchema,
    sequence: z
      .array(
        z
          .object({
            target: text(80),
            effect: MotionEffectSchema,
            order: z.number().int().min(0).max(20),
            duration: z.enum(['short', 'base', 'long']),
          })
          .strict()
      )
      .max(6),
    presentSteps: z.number().int().min(0).max(6),
  })
  .strict();
export const ChapterInteractionSchema = z
  .object({
    kind: InteractionKindSchema,
    purpose: text(160),
    defaultState: text(160),
    fallback: text(160),
  })
  .strict();

export const ReportChapterPlanSchema = z
  .object({
    id: chapterId,
    title: text(160),
    beat: StoryBeatSchema,
    takeaway: text(240),
    factIds: z.array(factId).min(1).max(80),
    datasets: z.array(z.string().max(48)).max(6),
    derivations: z.array(z.string().max(48)).max(10),
    layout: z
      .object({
        archetype: LayoutArchetypeSchema,
        dominant: text(160),
        dominantShare: z.number().int().min(20).max(90),
        surface: z.enum(['canvas', 'alt', 'accent']),
        density: z.enum(['low', 'medium', 'high']),
        readingPath: z.array(text(60)).min(2).max(6),
      })
      .strict(),
    mobile: z
      .object({
        order: z.array(text(60)).min(1).max(6),
        note: text(160),
      })
      .strict(),
    charts: z.array(ReportChartSpecSchema).max(3),
    motion: ChapterMotionSchema,
    interactions: z.array(ChapterInteractionSchema).max(2),
  })
  .strict();
export type ReportChapterPlan = z.infer<typeof ReportChapterPlanSchema>;

export const ReportExperiencePlanSchema = z
  .object({
    title: text(120),
    thesis: text(400),
    direction: z
      .object({
        archetype: DirectionArchetypeSchema,
        concept: text(300),
        signature: text(300),
        rejected: text(240),
      })
      .strict(),
    tokens: z
      .object({
        color: z
          .object({
            canvas: hex,
            ink: hex,
            muted: hex,
            accent: hex,
            accentInk: hex,
            surfaceAlt: hex,
            surfaceAltInk: hex,
          })
          .strict(),
        type: z
          .object({
            display: z.enum(['serif', 'sans']),
            body: z.enum(['sans', 'serif']),
            numeral: z.enum(['sans', 'serif', 'mono']),
            displayPx: range(24, 200),
            sectionPx: range(20, 120),
            bodyPx: range(14, 26),
            labelPx: z.number().int().min(11).max(20),
            displayWeight: z.number().int().min(300).max(900),
            measureChars: range(14, 80),
          })
          .strict(),
        motion: z
          .object({
            personality: z.enum(['calm', 'precise', 'energetic', 'cinematic']),
            intensity: z.enum(['subtle', 'standard', 'expressive']),
            shortMs: z.number().int().min(80).max(400),
            baseMs: z.number().int().min(160).max(900),
            longMs: z.number().int().min(400).max(1800),
            staggerMs: z.number().int().min(20).max(200),
            easing: z.enum(['standard', 'emphasized', 'decelerate', 'snappy']),
          })
          .strict(),
      })
      .strict(),
    derivations: z.array(DerivationRequestSchema).max(16),
    chapters: z.array(ReportChapterPlanSchema).min(2).max(14),
    coverage: z
      .object({
        omitted: z
          .array(z.object({ id: factId, reason: text(160) }).strict())
          .max(300),
      })
      .strict(),
    risks: z.array(text(200)).max(5),
  })
  .strict();
export type ReportExperiencePlan = z.infer<typeof ReportExperiencePlanSchema>;

export const ReportWebChapterSchema = z
  .object({
    id: chapterId,
    html: z.string().min(1).max(160000),
    css: z.string().max(40000),
  })
  .strict();
export const ReportWebArtifactSchema = z
  .object({
    schemaVersion: z.literal(REPORT_WEB_V4),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().min(1).max(120),
    sharedCss: z.string().max(80000),
    chapters: z.array(ReportWebChapterSchema).min(1).max(14),
  })
  .strict();
export type ReportWebArtifact = z.infer<typeof ReportWebArtifactSchema>;

const assessment = z
  .object({
    result: z.enum(['met', 'needs_work', 'not_observed']),
    evidence: text(600),
  })
  .strict();
export const DesignMoveSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    rank: z.number().int().min(1).max(9),
    chapterIds: z.array(z.string().max(64)).max(6),
    dimension: z.enum([
      'narrative',
      'composition',
      'typography',
      'chart',
      'motion',
      'interaction',
      'responsive',
    ]),
    severity: z.enum(['must', 'should']),
    problem: text(500),
    why: text(300),
    move: text(600),
    evidence: text(300),
  })
  .strict();
export type DesignMove = z.infer<typeof DesignMoveSchema>;

export const ReportCritiqueSchema = z
  .object({
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
    observed: z.array(z.string().max(120)).max(40),
    verdict: z.enum(['ship', 'improve', 'must_fix']),
    assessment: z
      .object({
        narrative: assessment,
        composition: assessment,
        typography: assessment,
        charts: assessment,
        responsive: assessment,
      })
      .strict(),
    moves: z.array(DesignMoveSchema).max(6),
    strengths: z.array(text(240)).max(3),
  })
  .strict();
export type ReportCritique = z.infer<typeof ReportCritiqueSchema>;

export const ReportMotionCritiqueSchema = z
  .object({
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
    observed: z.array(z.string().max(120)).max(40),
    verdict: z.enum(['ship', 'improve', 'must_fix']),
    assessment: z
      .object({ motion: assessment, interaction: assessment })
      .strict(),
    moves: z.array(DesignMoveSchema).max(5),
    brokenBehaviors: z.array(z.string().max(120)).max(20),
    strengths: z.array(text(240)).max(3),
  })
  .strict();
export type ReportMotionCritique = z.infer<typeof ReportMotionCritiqueSchema>;

export const ReportCompareSchema = z
  .object({
    preferred: z.enum(['A', 'B', 'tie']),
    confidence: z.enum(['low', 'medium', 'high']),
    reasons: z.array(text(300)).min(1).max(4),
    regressions: z.array(text(300)).max(3),
  })
  .strict();
export type ReportCompare = z.infer<typeof ReportCompareSchema>;

export const PlanOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('changeLayout'),
      chapterId,
      archetype: LayoutArchetypeSchema,
      dominant: text(160).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('mergeChapters'),
      into: chapterId,
      from: chapterId,
    })
    .strict(),
  z
    .object({
      op: z.literal('swapChartMark'),
      chartId: z.string().max(100),
      mark: ChartMarkSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('setMotion'),
      chapterId,
      motion: ChapterMotionSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('setInteractions'),
      chapterId,
      interactions: z.array(ChapterInteractionSchema).max(2),
    })
    .strict(),
  z
    .object({
      op: z.literal('addChart'),
      chapterId,
      chart: ReportChartSpecSchema,
      dataset: z.string().max(48),
    })
    .strict(),
  z
    .object({ op: z.literal('removeChart'), chartId: z.string().max(100) })
    .strict(),
  z
    .object({
      op: z.literal('retitle'),
      chapterId,
      title: text(160),
      takeaway: text(240),
    })
    .strict(),
]);
export type PlanOp = z.infer<typeof PlanOpSchema>;
export const ReportRepairHeaderSchema = z
  .object({
    ops: z.array(PlanOpSchema).max(16),
    addressed: z.array(z.string().max(80)).max(20),
    unresolved: z
      .array(z.object({ id: z.string().max(80), reason: text(300) }).strict())
      .max(20),
  })
  .strict();

export type EvidenceFactLike = {
  id: string;
  kind: string;
  quote: string;
  text: string;
  salience?: string;
};

/** Hard bounds: at least an opening and one evidence chapter. */
export function reportChapterBounds(max: number) {
  return { min: 2, max: Math.max(2, Math.min(14, max)) };
}

/**
 * Validates that the plan is executable before any HTML is written. Errors
 * are returned as precise sentences so a format retry can fix them.
 */
export function lintExperiencePlan(
  plan: ReportExperiencePlan,
  input: {
    facts: readonly EvidenceFactLike[];
    datasets: readonly ReportDataset[];
    maxChapters: number;
    /** Composition variety rules are hard for plans, advisory for repairs. */
    strictComposition?: boolean;
  }
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const style = (message: string) =>
    (input.strictComposition === false ? warnings : errors).push(message);
  const bounds = reportChapterBounds(input.maxChapters);
  const n = plan.chapters.length;
  if (n < bounds.min || n > bounds.max)
    errors.push(
      `Use between ${bounds.min} and ${bounds.max} chapters; got ${n}.`
    );
  const ids = plan.chapters.map(ch => ch.id);
  if (new Set(ids).size !== n) errors.push('Chapter ids must be unique.');
  const facts = new Map(input.facts.map(f => [f.id, f]));
  const datasets = new Map(input.datasets.map(d => [d.id, d]));
  const { values, rejected } = computeDerivations(
    input.datasets,
    plan.derivations
  );
  for (const r of rejected) errors.push(`Derivation ${r.id}: ${r.reason}.`);
  const derivationIds = new Set(plan.derivations.map(d => d.id));
  const used = new Set<string>();
  for (const ch of plan.chapters) {
    for (const id of ch.factIds) {
      if (!facts.has(id))
        errors.push(`${ch.id} references unknown fact ${id}.`);
      used.add(id);
    }
    for (const ds of ch.datasets) {
      const dataset = datasets.get(ds);
      if (!dataset) errors.push(`${ch.id} references unknown dataset ${ds}.`);
      else dataset.rows.forEach(row => used.add(row.factId));
    }
    for (const d of ch.derivations)
      if (!derivationIds.has(d))
        errors.push(`${ch.id} uses derivation ${d} that is not declared.`);
    const chartIds = new Set<string>();
    for (const chart of ch.charts) {
      if (!chart.id.startsWith(`${ch.id}-`))
        errors.push(`Chart ${chart.id} must start with "${ch.id}-".`);
      if (chartIds.has(chart.id))
        errors.push(`Duplicate chart id ${chart.id}.`);
      chartIds.add(chart.id);
      const dataset = datasets.get(chart.dataset);
      if (!dataset || !ch.datasets.includes(chart.dataset))
        errors.push(
          `Chart ${chart.id} must use a dataset listed in ${ch.id}.datasets.`
        );
      else
        for (const label of chart.highlight)
          if (!dataset.rows.some(row => row.label === label))
            errors.push(
              `Chart ${chart.id} highlight "${label}" is not a row label of ${dataset.id}.`
            );
    }
    const chapterFacts = ch.factIds.length + ch.datasets.length;
    if (
      n > 2 &&
      chapterFacts < 2 &&
      !['hook', 'close', 'decision'].includes(ch.beat) &&
      input.facts.length >= n
    )
      errors.push(
        `${ch.id} carries a single fact. Merge it into a related chapter or give it supporting evidence; do not pad with near-empty chapters.`
      );
    if (
      ch.interactions.some(i => i.kind === 'scrolly') &&
      ch.layout.archetype !== 'scrolly-figure'
    )
      warnings.push(`${ch.id} uses scrolly without the scrolly-figure layout.`);
  }
  for (const f of input.facts) {
    const omitted = plan.coverage.omitted.some(o => o.id === f.id);
    if (!used.has(f.id) && !omitted)
      errors.push(
        `Fact ${f.id} is neither placed in a chapter nor listed in coverage.omitted with a reason.`
      );
    if (
      !used.has(f.id) &&
      omitted &&
      ['number', 'date', 'risk', 'decision'].includes(f.kind) &&
      f.salience !== 'context'
    )
      errors.push(
        `Fact ${f.id} (${f.kind}) is decision-relevant; place it in a chapter instead of omitting it.`
      );
  }
  for (let i = 1; i < n; i++)
    if (
      plan.chapters[i].layout.archetype ===
      plan.chapters[i - 1].layout.archetype
    )
      style(
        `${plan.chapters[i].id} repeats the ${plan.chapters[i].layout.archetype} layout of the previous chapter; change the composition.`
      );
  if (n >= 3) {
    const effects = new Set(plan.chapters.map(ch => ch.motion.entrance));
    if (effects.size < 2)
      style(
        'Every chapter uses the same entrance effect; vary motion by content type.'
      );
    if (plan.chapters.every(ch => ch.motion.sequence.length === 0))
      style(
        'Plan at least one ordered motion sequence that leads the eye to a key element.'
      );
  }
  const archetypeCount = new Map<string, number>();
  plan.chapters.forEach(ch =>
    archetypeCount.set(
      ch.layout.archetype,
      (archetypeCount.get(ch.layout.archetype) ?? 0) + 1
    )
  );
  if (n >= 5)
    for (const [archetype, count] of archetypeCount)
      if (count / n > 0.4)
        style(
          `Layout ${archetype} is used in ${count} of ${n} chapters; diversify compositions.`
        );
  if (n >= 4 && new Set(plan.chapters.map(ch => ch.layout.surface)).size < 2)
    warnings.push(
      'All chapters share one surface; consider light/dark rhythm.'
    );
  const interactions = plan.chapters.reduce(
    (sum, ch) => sum + ch.interactions.length,
    0
  );
  if (interactions > 6)
    errors.push('Use at most six interactions in the whole report.');
  return { errors, warnings, derived: values };
}

/**
 * Mechanical fixes that never change meaning: chart ids are namespaced by
 * their chapter so the model does not spend a retry on naming.
 */
export function normalizeExperiencePlan(plan: ReportExperiencePlan) {
  const declared = new Set(plan.derivations.map(d => d.id));
  for (const ch of plan.chapters)
    ch.derivations = ch.derivations.filter(id => declared.has(id));
  for (const ch of plan.chapters)
    for (const chart of ch.charts)
      if (!chart.id.startsWith(`${ch.id}-`)) {
        const suffix =
          chart.id
            .replace(/^rd-c-/, '')
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 40) || 'chart';
        chart.id = `${ch.id}-${suffix}`;
      }
  return plan;
}

/** Applies validated repair operations to a plan; returns the new plan. */
export function applyPlanOps(
  plan: ReportExperiencePlan,
  ops: readonly PlanOp[]
) {
  const next: ReportExperiencePlan = structuredClone(plan);
  const errors: string[] = [];
  for (const op of ops) {
    const chapter = (id: string) => next.chapters.find(ch => ch.id === id);
    switch (op.op) {
      case 'changeLayout': {
        const ch = chapter(op.chapterId);
        if (!ch) errors.push(`Unknown chapter ${op.chapterId}`);
        else {
          ch.layout.archetype = op.archetype;
          if (op.dominant) ch.layout.dominant = op.dominant;
        }
        break;
      }
      case 'mergeChapters': {
        const into = chapter(op.into);
        const from = chapter(op.from);
        if (!into || !from || into === from) {
          errors.push(`Cannot merge ${op.from} into ${op.into}`);
          break;
        }
        into.factIds = [...new Set([...into.factIds, ...from.factIds])];
        into.datasets = [...new Set([...into.datasets, ...from.datasets])];
        into.derivations = [
          ...new Set([...into.derivations, ...from.derivations]),
        ];
        into.charts = [
          ...into.charts,
          ...from.charts.map(chart => ({
            ...chart,
            id: `${into.id}-${chart.id.slice(from.id.length + 1)}`.slice(0, 96),
          })),
        ].slice(0, 3);
        into.interactions = [...into.interactions, ...from.interactions].slice(
          0,
          2
        );
        next.chapters = next.chapters.filter(ch => ch !== from);
        break;
      }
      case 'swapChartMark': {
        const chart = next.chapters
          .flatMap(ch => ch.charts)
          .find(c => c.id === op.chartId);
        if (!chart) errors.push(`Unknown chart ${op.chartId}`);
        else chart.mark = op.mark;
        break;
      }
      case 'setMotion': {
        const ch = chapter(op.chapterId);
        if (!ch) errors.push(`Unknown chapter ${op.chapterId}`);
        else ch.motion = op.motion;
        break;
      }
      case 'setInteractions': {
        const ch = chapter(op.chapterId);
        if (!ch) errors.push(`Unknown chapter ${op.chapterId}`);
        else ch.interactions = op.interactions;
        break;
      }
      case 'addChart': {
        const ch = chapter(op.chapterId);
        if (!ch) errors.push(`Unknown chapter ${op.chapterId}`);
        else if (ch.charts.length >= 3)
          errors.push(`${op.chapterId} already has three charts`);
        else {
          if (!ch.datasets.includes(op.dataset)) ch.datasets.push(op.dataset);
          ch.charts.push({ ...op.chart, dataset: op.dataset });
        }
        break;
      }
      case 'removeChart': {
        const owner = next.chapters.find(ch =>
          ch.charts.some(c => c.id === op.chartId)
        );
        if (!owner) errors.push(`Unknown chart ${op.chartId}`);
        else owner.charts = owner.charts.filter(c => c.id !== op.chartId);
        break;
      }
      case 'retitle': {
        const ch = chapter(op.chapterId);
        if (!ch) errors.push(`Unknown chapter ${op.chapterId}`);
        else {
          ch.title = op.title;
          ch.takeaway = op.takeaway;
        }
        break;
      }
    }
  }
  return { plan: next, errors };
}

export type ReportBundle = {
  sharedCss: string | null;
  sharedAdd: string | null;
  chapters: Array<{ id: string; html: string; css: string }>;
  repair: unknown;
  errors: string[];
};

/**
 * Parses the text bundle produced by build/repair stages:
 * `<rd-shared>css</rd-shared>`, `<rd-shared-add>css</rd-shared-add>`,
 * `<rd-chapter id="…"> section + <style>css</style> </rd-chapter>`,
 * and for repairs `<rd-repair>{json}</rd-repair>`.
 */
export function parseReportBundle(input: string): ReportBundle {
  const errors: string[] = [];
  const source = input
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '');
  const block = (tag: string) => {
    const matches = [
      ...source.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')),
    ];
    if (matches.length > 1) errors.push(`Use one <${tag}> block.`);
    return matches[0]?.[1].trim() ?? null;
  };
  const chapters: ReportBundle['chapters'] = [];
  for (const match of source.matchAll(
    /<rd-chapter\s+id="([^"]+)"\s*>([\s\S]*?)<\/rd-chapter>/g
  )) {
    const body = match[2];
    const css = [...body.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(m => m[1].trim())
      .join('\n');
    const html = body.replace(/<style>[\s\S]*?<\/style>/g, '').trim();
    chapters.push({ id: match[1], html, css });
  }
  if (!chapters.length)
    errors.push('No <rd-chapter id="…"> blocks were found.');
  let repair: unknown = null;
  const repairText = block('rd-repair');
  if (repairText !== null)
    try {
      repair = JSON.parse(repairText);
    } catch {
      errors.push('The <rd-repair> block must contain valid JSON.');
    }
  return {
    sharedCss: block('rd-shared'),
    sharedAdd: block('rd-shared-add'),
    chapters,
    repair,
    errors,
  };
}

const EASING: Record<
  ReportExperiencePlan['tokens']['motion']['easing'],
  string
> = {
  standard: 'cubic-bezier(.2,.7,.1,1)',
  emphasized: 'cubic-bezier(.2,0,0,1)',
  decelerate: 'cubic-bezier(0,0,.2,1)',
  snappy: 'cubic-bezier(.3,1.25,.5,1)',
};

const fluid = (r: { min: number; max: number }) => {
  const min = Math.min(r.min, r.max);
  const max = Math.max(r.min, r.max);
  const slope = (max - min) / (1440 - 390);
  const base = min - slope * 390;
  return `clamp(${min}px,${base.toFixed(2)}px + ${(slope * 100).toFixed(3)}vw,${max}px)`;
};

const family = (role: 'serif' | 'sans' | 'mono') =>
  role === 'serif'
    ? 'var(--rd-font-serif)'
    : role === 'mono'
      ? 'var(--rd-font-mono)'
      : 'var(--rd-font-sans)';

/** Trusted token stylesheet compiled from the plan (not written by a model). */
export function reportTokenCss(plan: ReportExperiencePlan) {
  const { color, type, motion } = plan.tokens;
  const R = REPORT_WEB_V4_ROOT;
  return `:root{--bg:${color.canvas};--fg:${color.ink}}
@layer rd-base{${R}{--rd-canvas:${color.canvas};--rd-ink:${color.ink};--rd-muted:${color.muted};--rd-accent:${color.accent};--rd-accent-ink:${color.accentInk};--rd-alt:${color.surfaceAlt};--rd-alt-ink:${color.surfaceAltInk};--rd-font-display:${family(type.display)};--rd-font-body:${family(type.body)};--rd-font-numeral:${family(type.numeral)};--rd-size-display:${fluid(type.displayPx)};--rd-size-section:${fluid(type.sectionPx)};--rd-size-body:${fluid(type.bodyPx)};--rd-size-label:${type.labelPx}px;--rd-weight-display:${type.displayWeight};--rd-measure:${Math.round((type.measureChars.min + type.measureChars.max) / 2)}em;--rd-dur-short:${motion.shortMs}ms;--rd-dur-base:${motion.baseMs}ms;--rd-dur-long:${motion.longMs}ms;--rd-stagger:${motion.staggerMs}ms;--rd-ease:${EASING[motion.easing]};background:var(--rd-canvas);color:var(--rd-ink);font-family:var(--rd-font-body);font-size:var(--rd-size-body)}}`;
}

export type ReportWebEvidence = {
  facts: readonly EvidenceFactLike[];
  datasets: readonly ReportDataset[];
  derived: readonly DerivedValue[];
};
