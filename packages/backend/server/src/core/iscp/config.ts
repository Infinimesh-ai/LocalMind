import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    iscp: {
      enabled: ConfigItem<boolean>;
      controllerUrl: ConfigItem<string>;
      controllerToken: ConfigItem<string>;
      domainId: ConfigItem<string>;
    };
  }
}

defineModuleConfig('iscp', {
  enabled: {
    desc: 'Enable the LocalMind SparkClaw ISCP integration',
    default: false,
    env: ['ISCP_ENABLED', 'boolean'],
  },
  controllerUrl: {
    desc: 'Internal URL of the LocalMind ISCP controller',
    default: 'http://iscp-controller:8091',
    env: 'ISCP_CONTROLLER_URL',
  },
  controllerToken: {
    desc: 'Bearer token used between LocalMind and the ISCP controller',
    default: '',
    env: 'ISCP_CONTROLLER_TOKEN',
  },
  domainId: {
    desc: 'ISCP domain assigned to LocalMind SparkClaw endpoints',
    default: 'localmind',
    env: 'ISCP_DOMAIN_ID',
  },
});
