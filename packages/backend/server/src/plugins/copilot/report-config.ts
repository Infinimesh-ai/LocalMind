import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    projectReport: {
      maxResources: ConfigItem<number>;
      maxSourceCharacters: ConfigItem<number>;
      maxTotalCharacters: ConfigItem<number>;
      modelChunkCharacters: ConfigItem<number>;
      maxModelCalls: ConfigItem<number>;
    };
  }
}

defineModuleConfig('projectReport', {
  maxResources: {
    desc: 'Maximum documents enumerated by one report run; reaching the limit produces a visible coverage issue.',
    default: 1000,
    shape: z.number().int().min(1).max(10000),
  },
  maxSourceCharacters: {
    desc: 'Maximum extracted characters per report source.',
    default: 250000,
    shape: z.number().int().min(1000).max(1000000),
  },
  maxTotalCharacters: {
    desc: 'Maximum extracted source characters per report run.',
    default: 2000000,
    shape: z.number().int().min(1000).max(20000000),
  },
  modelChunkCharacters: {
    desc: 'Bounded characters supplied to each report extraction model call.',
    default: 12000,
    shape: z.number().int().min(1000).max(24000),
  },
  maxModelCalls: {
    desc: 'Maximum persisted model invocation reservations per report run, including failed calls.',
    default: 200,
    shape: z.number().int().min(1).max(1000),
  },
});
