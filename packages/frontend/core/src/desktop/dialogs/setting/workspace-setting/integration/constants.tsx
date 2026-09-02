import { IntegrationTypeIcon } from '@affine/core/modules/integration';
import type { I18nString } from '@affine/i18n';
import { CollaborationIcon, TodayIcon } from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

import { CalendarSettingPanel } from './calendar/setting-panel';
import { EnterpriseSettingPanel } from './enterprise/setting-panel';
import { ExternalMcpSettingPanel } from './external-mcp/setting-panel';
import MCPIcon from './mcp-server/MCP.inline.svg';
import { McpServerSettingPanel } from './mcp-server/setting-panel';
import { ReadwiseSettingPanel } from './readwise/setting-panel';

type IntegrationCard = {
  id: string;
  name: I18nString;
  desc: I18nString;
  icon: ReactNode;
  cloud?: boolean;
  admin?: boolean;
} & ({ setting: ReactNode } | { link: string });

const INTEGRATION_LIST = [
  {
    id: 'readwise' as const,
    name: 'com.affine.integration.readwise.name',
    desc: 'com.affine.integration.readwise.desc',
    icon: <IntegrationTypeIcon type="readwise" />,
    setting: <ReadwiseSettingPanel />,
  },
  {
    id: 'calendar' as const,
    name: 'com.affine.integration.calendar.name',
    desc: 'com.affine.integration.calendar.desc',
    icon: <TodayIcon />,
    setting: <CalendarSettingPanel />,
    cloud: true,
  },
  {
    id: 'enterprise' as const,
    name: 'com.affine.integration.enterprise.name',
    desc: 'com.affine.integration.enterprise.desc',
    icon: <CollaborationIcon />,
    setting: <EnterpriseSettingPanel />,
    cloud: true,
  },
  {
    id: 'mcp-server' as const,
    name: 'com.affine.integration.mcp-server.name',
    desc: 'com.affine.integration.mcp-server.desc',
    icon: <img src={MCPIcon} />,
    setting: <McpServerSettingPanel />,
    cloud: true,
  },
  {
    id: 'external-mcp' as const,
    name: 'com.affine.integration.external-mcp.name',
    desc: 'com.affine.integration.external-mcp.desc',
    icon: <img src={MCPIcon} />,
    setting: <ExternalMcpSettingPanel />,
    cloud: true,
    admin: true,
  },
] satisfies (IntegrationCard | false)[];

type IntegrationId = Exclude<
  Extract<(typeof INTEGRATION_LIST)[number], {}>,
  false
>['id'];

export type IntegrationItem = Exclude<IntegrationCard, 'id'> & {
  id: IntegrationId;
};

export function getAllowedIntegrationList(
  isCloudWorkspace: boolean,
  showAdminIntegrations: boolean
) {
  return INTEGRATION_LIST.filter(item => {
    if (!item) return false;
    if ('admin' in item && item.admin && !showAdminIntegrations) return false;
    const requiredCloud = 'cloud' in item && item.cloud;
    if (requiredCloud && !isCloudWorkspace) return false;
    return true;
  }) as IntegrationItem[];
}
