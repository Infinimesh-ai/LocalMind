import {
  Avatar,
  Divider,
  IconButton,
  Menu,
  type MenuProps,
} from '@affine/component';
import {
  type AuthAccountInfo,
  AuthService,
  ServerService,
} from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import { useCallback } from 'react';

import { Account } from './account';
import { AccountMenu } from './account-menu';
import { AIUsage } from './ai-usage';
import { CloudUsage } from './cloud-usage';
import * as styles from './index.css';
import { TeamList } from './team-list';
import { UnknownUserIcon } from './unknow-user';

type UserInfoProps = {
  className?: string;
  inRail?: boolean;
};

export default function UserInfo(props: UserInfoProps) {
  const session = useServiceOptional(AuthService)?.session;
  const account = useLiveData(session?.account$);
  if (!session) return null;
  return account ? (
    <AuthorizedUserInfo account={account} {...props} />
  ) : (
    <UnauthorizedUserInfo {...props} />
  );
}

const menuContentOptions: MenuProps['contentOptions'] = {
  className: styles.operationMenu,
};
const railMenuContentOptions: MenuProps['contentOptions'] = {
  ...menuContentOptions,
  side: 'right',
  align: 'end',
  sideOffset: 8,
};
const AuthorizedUserInfo = ({
  account,
  className,
  inRail,
}: UserInfoProps & { account: AuthAccountInfo }) => {
  return (
    <Menu
      items={<OperationMenu />}
      contentOptions={inRail ? railMenuContentOptions : menuContentOptions}
    >
      <IconButton
        data-testid="sidebar-user-avatar"
        aria-label={account.label}
        className={className}
        variant={inRail ? 'custom' : 'plain'}
        size="20"
        style={{ padding: 0 }}
        withoutHover={!inRail}
      >
        <Avatar size={20} name={account.label} url={account.avatar} />
      </IconButton>
    </Menu>
  );
};

const UnauthorizedUserInfo = ({ className, inRail }: UserInfoProps) => {
  const t = useI18n();
  const globalDialogService = useService(GlobalDialogService);

  const openSignInModal = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <IconButton
      onClick={openSignInModal}
      data-testid="sidebar-user-avatar"
      aria-label={t['Sign in']()}
      className={className}
      variant={inRail ? 'custom' : 'plain'}
      size="20"
    >
      <UnknownUserIcon />
    </IconButton>
  );
};

const OperationMenu = () => {
  const workspace = useServiceOptional(WorkspaceService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);

  return (
    <>
      <Account />
      {workspace ? <Divider /> : null}
      {workspace ? <CloudUsage /> : null}
      {workspace && serverFeatures?.copilot ? <AIUsage /> : null}
      <Divider />
      <TeamList />
      <AccountMenu />
    </>
  );
};
