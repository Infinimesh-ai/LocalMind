import { z } from 'zod';

export const REPORT_WEB_VERSION = 'report-web-v3';
export const REPORT_WEB_ROOT = '[data-content-root="rd-custom-v3"]';
const text = z.string().trim().min(1).max(2000);
const factId = z.string().min(1).max(64);
const chapterId = z.string().regex(/^rd-c-[a-z0-9-]{1,32}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const ReportArtDirectionSchema = z
  .object({
    concept: text,
    signatureMove: text,
    palette: z
      .object({
        canvas: text,
        ink: text,
        accent: text,
        contrastSurface: text,
        contrastInk: text,
      })
      .strict(),
    typography: z
      .object({
        displayFamily: text,
        bodyFamily: text,
        numeralFamily: text,
        displaySize: text,
        sectionSize: text,
        bodySize: text,
        labelSize: text,
        weightAndLineHeight: text,
      })
      .strict(),
    chapterTreatments: z
      .array(
        z
          .object({
            chapterId,
            layout: text,
            surface: text,
            focalPoint: text,
            contrastToPrevious: text,
          })
          .strict()
      )
      .min(3)
      .max(14),
    charts: z
      .array(
        z
          .object({
            chapterId,
            factIds: z.array(factId).min(1).max(20),
            encoding: text,
            visualSpec: text,
            scaleRules: text,
            annotation: text,
          })
          .strict()
      )
      .max(14),
  })
  .strict();

export const ReportDesignPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    reportThesis: text,
    directions: z
      .array(
        z
          .object({
            id: z.string().max(40),
            rationale: text,
            composition: text,
            typography: text,
          })
          .strict()
      )
      .length(3),
    selectedDirection: z.string().min(1).max(40),
    selectionReason: text,
    designTokens: z
      .object({ palette: text, typography: text, spacing: text, motion: text })
      .strict(),
    chapters: z
      .array(
        z
          .object({
            id: chapterId,
            title: z.string().trim().min(1).max(160),
            task: text,
            conclusion: text,
            factIds: z.array(factId).min(1).max(80),
            composition: text,
            visualSubject: text,
            mobileLayout: text,
            density: z.enum(['low', 'medium', 'high']),
          })
          .strict()
      )
      .min(3)
      .max(14),
    requiredFactIds: z.array(factId).min(1).max(200),
    omittedFactIds: z.array(factId).max(500),
    variationPlan: text,
    // Optional only for checkpoints created before the v3.1 prompt contract.
    artDirection: ReportArtDirectionSchema.optional(),
  })
  .strict();
export type ReportDesignPlan = z.infer<typeof ReportDesignPlanSchema>;
export const ReportDirectedPlanSchema = ReportDesignPlanSchema.extend({
  artDirection: ReportArtDirectionSchema,
}).strict();

export const ReportChapterSchema = z
  .object({
    id: chapterId,
    html: z.string().min(1).max(160000),
    css: z.string().max(40000),
    factIds: z.array(factId).min(1).max(80),
    claims: z
      .array(
        z
          .object({
            elementId: z
              .string()
              .regex(/^rd-c-[a-z0-9-]+$/)
              .max(100),
            text: z.string().trim().min(1).max(3000),
            factIds: z.array(factId).min(1).max(20),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ReportChapter = z.infer<typeof ReportChapterSchema>;

export const ReportArtifactSchema = z
  .object({
    schemaVersion: z.literal(REPORT_WEB_VERSION),
    planHash: hash,
    title: z.string().min(1).max(120),
    sharedCss: z.string().max(80000),
    chapters: z.array(ReportChapterSchema).min(1).max(14),
  })
  .strict();
export const ReportBatchSchema = ReportArtifactSchema.extend({
  sharedChangeRequest: z
    .object({
      reason: text,
      proposedCss: z.string().max(80000),
      affectedChapterIds: z.array(chapterId).min(1).max(14),
    })
    .strict()
    .nullable(),
}).strict();
export type ReportArtifact = z.infer<typeof ReportArtifactSchema>;

export const ReportIssueSchema = z
  .object({
    id: z.string().min(1).max(120),
    category: z.enum([
      'structure',
      'security',
      'facts',
      'overflow',
      'visibility',
      'typography',
      'composition',
      'responsive',
    ]),
    severity: z.enum(['error', 'warning']),
    chapterId: z.string().max(64),
    viewport: z.string().max(40),
    elementId: z.string().max(100),
    evidence: z.string().min(1).max(1200),
    suggestedFix: z.string().min(1).max(1200),
  })
  .strict();
export type ReportIssue = z.infer<typeof ReportIssueSchema>;

export const ReportReviewSchema = z
  .object({
    artifactHash: hash,
    checkedCaptureIds: z.array(z.string().max(120)).max(100),
    issues: z.array(ReportIssueSchema).max(60),
  })
  .strict();
export type ReportReview = z.infer<typeof ReportReviewSchema>;

const designAssessment = z
  .object({
    result: z.enum(['met', 'needs_work', 'not_observed']),
    evidence: z.string().min(1).max(800),
  })
  .strict();
export const ReportDesignReviewSchema = ReportReviewSchema.extend({
  designAssessment: z
    .object({
      composition: designAssessment,
      typography: designAssessment,
      chartEncoding: designAssessment,
    })
    .strict(),
}).strict();
export type ReportDesignReview = z.infer<typeof ReportDesignReviewSchema>;

export const ReportRepairSchema = z
  .object({
    expectedArtifactHash: hash,
    addressedIssueIds: z.array(z.string().max(120)).max(60),
    unresolvedIssueIds: z.array(z.string().max(120)).max(60),
    sharedCssReplacement: z.string().max(80000).nullable(),
    chapterReplacements: z.array(ReportChapterSchema).max(14),
  })
  .strict();
export type ReportRepair = z.infer<typeof ReportRepairSchema>;

export const DeckSubphaseSchema = z.enum([
  'reading',
  'grounding',
  'planning',
  'building',
  'checking',
  'reviewing',
  'repairing',
]);
export type DeckSubphase = z.infer<typeof DeckSubphaseSchema>;
export const DeckQualitySchema = z
  .object({
    version: z.literal(REPORT_WEB_VERSION),
    artifactHash: hash,
    visual: z.enum(['complete', 'partial', 'unavailable']),
    warnings: z
      .array(
        z.enum([
          'source_coverage',
          'visual_unavailable',
          'visual_partial',
          'design_warnings',
        ])
      )
      .max(4),
    checkedCaptures: z.number().int().min(0).max(300),
    totalCaptures: z.number().int().min(0).max(300),
    repairs: z.number().int().min(0).max(2),
  })
  .strict();
export type DeckQuality = z.infer<typeof DeckQualitySchema>;
