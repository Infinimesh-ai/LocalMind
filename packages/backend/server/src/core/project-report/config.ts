import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    projectReports: {
      enabled: ConfigItem<boolean>;
      allowAnonymous: ConfigItem<boolean>;
      schedulesEnabled: ConfigItem<boolean>;
      maxShareDays: ConfigItem<number>;
    };
  }
}
defineModuleConfig('projectReports', {
  enabled: {
    desc: 'Enable legacy Project report creation, mutation and schedules. Disabled by default: report decks replace it. Historical authorized reads and revocation remain available.',
    default: false,
    env: ['LOCALMIND_PROJECT_REPORTS_ENABLED', 'boolean'],
    shape: z.boolean(),
  },
  allowAnonymous: {
    desc: 'Allow controlled anonymous report links.',
    default: false,
    env: ['LOCALMIND_PROJECT_REPORTS_ALLOW_ANONYMOUS', 'boolean'],
    shape: z.boolean(),
  },
  schedulesEnabled: {
    desc: 'Allow persistent report schedules and distribution.',
    default: true,
    env: ['LOCALMIND_PROJECT_REPORTS_SCHEDULES_ENABLED', 'boolean'],
    shape: z.boolean(),
  },
  maxShareDays: {
    desc: 'Maximum validity of a report share.',
    default: 90,
    env: ['LOCALMIND_PROJECT_REPORTS_MAX_SHARE_DAYS', 'integer'],
    shape: z.number().int().min(1).max(365),
  },
});
