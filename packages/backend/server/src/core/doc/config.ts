import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    doc: {
      mcpResourcesEnabled: boolean;
      history: {
        interval: number;
      };
      experimental: {
        yocto: boolean;
      };
    };
  }
}

defineModuleConfig('doc', {
  mcpResourcesEnabled: {
    desc: 'Enable explicitly authorized direct Workspace MCP resource tools. Operation reconciliation remains available when disabled.',
    default: false,
    env: ['LOCALMIND_MCP_RESOURCES_ENABLED', 'boolean'],
  },
  'experimental.yocto': {
    desc: 'Use `y-octo` to merge updates at the same time when merging using Yjs.',
    default: false,
  },
  'history.interval': {
    desc: 'The minimum time interval in milliseconds of creating a new history snapshot when doc get updated.',
    default: 1000 * 60 * 10 /* 10 mins */,
  },
});
