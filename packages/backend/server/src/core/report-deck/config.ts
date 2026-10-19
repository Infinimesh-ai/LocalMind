import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    reportDecks: {
      customDesignV3: ConfigItem<boolean>;
      webRefine: ConfigItem<boolean>;
      rendererExecutablePath: ConfigItem<string>;
      enabled: ConfigItem<boolean>;
      maxSources: ConfigItem<number>;
      maxSourceChars: ConfigItem<number>;
      maxModelCalls: ConfigItem<number>;
      maxHtmlBytes: ConfigItem<number>;
      maxConcurrentPerUser: ConfigItem<number>;
      allowAnonymousShare: ConfigItem<boolean>;
      maxShareDays: ConfigItem<number>;
    };
  }
}

defineModuleConfig('reportDecks', {
  customDesignV3: {
    desc: 'Use the versioned joint HTML/CSS and browser review pipeline for new custom reports.',
    default: true,
    env: ['LOCALMIND_REPORT_DESIGN_V3', 'boolean'],
    shape: z.boolean(),
  },
  webRefine: {
    desc: 'Add model visual review, structural repair and blind comparison to new custom reports (slower, about 10–20 minutes). Off: fast path of about 2 minutes with deterministic browser checks.',
    default: false,
    env: ['LOCALMIND_REPORT_WEB_REFINE', 'boolean'],
    shape: z.boolean(),
  },
  rendererExecutablePath: {
    desc: 'Trusted Chromium executable for isolated report rendering.',
    default: '/usr/bin/chromium',
    env: ['LOCALMIND_REPORT_CHROMIUM', 'string'],
    shape: z.string().max(1024),
  },
  enabled: {
    desc: 'Enable report deck creation and generation. Existing decks stay readable and shares stay revocable.',
    default: true,
    env: ['LOCALMIND_REPORT_DECKS_ENABLED', 'boolean'],
    shape: z.boolean(),
  },
  maxSources: {
    desc: 'Maximum sources selected for one report deck.',
    default: 200,
    shape: z.number().int().min(1).max(1000),
  },
  maxSourceChars: {
    desc: 'Maximum total extracted source characters per report deck; later sources are truncated.',
    default: 600000,
    shape: z.number().int().min(1000).max(5000000),
  },
  maxModelCalls: {
    desc: 'Maximum model calls per report deck generation.',
    default: 40,
    shape: z.number().int().min(2).max(500),
  },
  maxHtmlBytes: {
    desc: 'Maximum uncompressed HTML size of one generated report deck.',
    default: 5 * 1024 * 1024,
    shape: z
      .number()
      .int()
      .min(64 * 1024)
      .max(50 * 1024 * 1024),
  },
  maxConcurrentPerUser: {
    desc: 'Maximum queued or generating report decks per user.',
    default: 2,
    shape: z.number().int().min(1).max(20),
  },
  allowAnonymousShare: {
    desc: 'Allow report deck owners to create anonymous link shares.',
    default: true,
    env: ['LOCALMIND_REPORT_DECKS_ALLOW_ANONYMOUS_SHARE', 'boolean'],
    shape: z.boolean(),
  },
  maxShareDays: {
    desc: 'Maximum validity of a report deck share link in days.',
    default: 30,
    shape: z.number().int().min(1).max(365),
  },
});
