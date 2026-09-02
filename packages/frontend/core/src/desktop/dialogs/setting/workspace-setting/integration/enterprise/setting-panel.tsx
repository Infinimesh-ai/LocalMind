import {
  Button,
  ErrorMessage,
  IconButton,
  Input,
  notify,
  Skeleton,
  useConfirmModal,
} from '@affine/component';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import {
  type EnterpriseAuthorizationSession,
  type EnterpriseConnection,
  EnterpriseService,
} from '@affine/core/modules/cloud/services/enterprise';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UserFriendlyError } from '@affine/error';
import { EnterpriseProvider } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  CollaborationIcon,
  CopyIcon,
  OpenInNewIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { IntegrationSettingHeader } from '../setting';
import {
  dingtalkAuthorizationStage,
  enterpriseAuthorizationWindowName,
  larkAuthorizationStage,
} from './authorization-window';
import * as styles from './setting-panel.css';

const PROVIDERS = [
  EnterpriseProvider.WECOM,
  EnterpriseProvider.LARK,
  EnterpriseProvider.DINGTALK,
];
const TERMINAL_AUTHORIZATION_STATUSES = new Set([
  'AUTHORIZED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '-';

export const EnterpriseSettingPanel = () => {
  const t = useI18n();
  const workspaceId = useService(WorkspaceService).workspace.id;
  const service = useService(EnterpriseService);
  const connections = useLiveData(service.connections$);
  const policy = useLiveData(service.policy$);
  const authorization = useLiveData(service.authorization$);
  const loading = useLiveData(service.loading$);
  const error = useLiveData(service.error$);
  const { openConfirmModal } = useConfirmModal();
  const [provider, setProvider] = useState(EnterpriseProvider.WECOM);
  const [name, setName] = useState('');
  const [mutating, setMutating] = useState<string | null>(null);
  const completedSessionRef = useRef<string | null>(null);
  const resumedConnectionRef = useRef<string | null>(null);
  const allowedProviders = useMemo(
    () => new Set(policy?.allowedProviders ?? []),
    [policy?.allowedProviders]
  );
  const availableProviders = useMemo(
    () => PROVIDERS.filter(value => allowedProviders.has(value)),
    [allowedProviders]
  );

  const providerLabel = useCallback(
    (value: EnterpriseProvider) => {
      switch (value) {
        case EnterpriseProvider.WECOM:
          return t['com.affine.integration.enterprise.provider.wecom']();
        case EnterpriseProvider.LARK:
          return t['com.affine.integration.enterprise.provider.lark']();
        case EnterpriseProvider.DINGTALK:
          return t['com.affine.integration.enterprise.provider.dingtalk']();
      }
    },
    [t]
  );

  const revalidate = useCallback(() => {
    // oxlint-disable-next-line @typescript-eslint/no-floating-promises
    service.revalidate(workspaceId);
  }, [service, workspaceId]);

  useEffect(() => revalidate(), [revalidate]);

  useEffect(() => {
    if (availableProviders.length && !availableProviders.includes(provider)) {
      setProvider(availableProviders[0]);
    }
  }, [availableProviders, provider]);

  useEffect(() => {
    const candidate = connections?.find(
      connection =>
        connection.status === 'CONNECTING' &&
        allowedProviders.has(connection.provider) &&
        connection.id !== resumedConnectionRef.current
    );
    if (!candidate || authorization) return;
    resumedConnectionRef.current = candidate.id;
    // oxlint-disable-next-line @typescript-eslint/no-floating-promises
    service.resumeLatestAuthorization(workspaceId, candidate.id);
  }, [allowedProviders, authorization, connections, service, workspaceId]);

  useEffect(() => {
    if (
      !authorization ||
      !TERMINAL_AUTHORIZATION_STATUSES.has(authorization.status) ||
      completedSessionRef.current === authorization.id
    ) {
      return;
    }
    completedSessionRef.current = authorization.id;
    if (authorization.status === 'AUTHORIZED') {
      notify.success({
        title: t['com.affine.integration.enterprise.authorization.success'](),
      });
    }
  }, [authorization, t]);

  useEffect(
    () => () => {
      service.clearAuthorization();
    },
    [service]
  );

  const connect = useAsyncCallback(async () => {
    if (!allowedProviders.has(provider)) return;
    setMutating('connect');
    try {
      await service.createAndAuthorize({
        workspaceId,
        provider,
        name: name.trim() || undefined,
      });
      setName('');
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [allowedProviders, name, provider, service, workspaceId]);

  const reauthorize = useAsyncCallback(
    async (connection: EnterpriseConnection) => {
      setMutating(`authorize:${connection.id}`);
      try {
        await service.beginAuthorization(workspaceId, connection.id);
      } catch (error) {
        notify.error({ error: UserFriendlyError.fromAny(error) });
      } finally {
        setMutating(null);
      }
    },
    [service, workspaceId]
  );

  const cancelAuthorization = useAsyncCallback(async () => {
    if (!authorization) return;
    setMutating('cancel-authorization');
    try {
      await service.cancelAuthorization(workspaceId, authorization.id);
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [authorization, service, workspaceId]);

  const refresh = useAsyncCallback(
    async (connectionId: string) => {
      setMutating(`refresh:${connectionId}`);
      try {
        await service.refreshConnection(workspaceId, connectionId);
      } catch (error) {
        notify.error({ error: UserFriendlyError.fromAny(error) });
      } finally {
        setMutating(null);
      }
    },
    [service, workspaceId]
  );

  const disable = useAsyncCallback(
    async (connectionId: string) => {
      setMutating(`disable:${connectionId}`);
      try {
        await service.disableConnection(workspaceId, connectionId);
      } catch (error) {
        notify.error({ error: UserFriendlyError.fromAny(error) });
      } finally {
        setMutating(null);
      }
    },
    [service, workspaceId]
  );

  const confirmDelete = useCallback(
    (connection: EnterpriseConnection) => {
      openConfirmModal({
        title: t['com.affine.integration.enterprise.delete.title']({
          name: connection.name,
        }),
        description:
          t['com.affine.integration.enterprise.delete.description'](),
        confirmText: t['Delete'](),
        cancelText: t['Cancel'](),
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          setMutating(`delete:${connection.id}`);
          try {
            await service.deleteConnection(workspaceId, connection.id);
          } catch (error) {
            notify.error({ error: UserFriendlyError.fromAny(error) });
          } finally {
            setMutating(null);
          }
        },
      });
    },
    [openConfirmModal, service, t, workspaceId]
  );

  const copyUserCode = useAsyncCallback(async () => {
    if (!authorization?.userCode) return;
    try {
      await navigator.clipboard.writeText(authorization.userCode);
      notify.success({
        title:
          t['com.affine.integration.enterprise.authorization.code-copied'](),
      });
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    }
  }, [authorization?.userCode, t]);

  return (
    <div className={styles.stack}>
      <IntegrationSettingHeader
        icon={<CollaborationIcon />}
        name={t['com.affine.integration.enterprise.name']()}
        desc={t['com.affine.integration.enterprise.desc']()}
      />

      {policy ? (
        policy.enabled && availableProviders.length ? (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.title}>
                  {t['com.affine.integration.enterprise.connect.title']()}
                </div>
                <div className={styles.description}>
                  {t['com.affine.integration.enterprise.connect.description']()}
                </div>
              </div>
            </div>
            <div className={styles.body}>
              <div className={styles.providerSelector}>
                {availableProviders.map(value => (
                  <button
                    type="button"
                    className={styles.providerOption}
                    data-selected={provider === value}
                    disabled={!!mutating}
                    key={value}
                    onClick={() => setProvider(value)}
                  >
                    {providerLabel(value)}
                  </button>
                ))}
              </div>
              <label className={styles.field}>
                <span>
                  {t['com.affine.integration.enterprise.field.name']()}
                </span>
                <Input value={name} maxLength={128} onChange={setName} />
              </label>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  loading={mutating === 'connect'}
                  disabled={!!mutating}
                  onClick={connect}
                >
                  {t['com.affine.integration.enterprise.action.connect']()}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.empty}>
              {policy.enabled
                ? t['com.affine.integration.enterprise.policy.no-providers']()
                : t['com.affine.integration.enterprise.policy.disabled']()}
            </div>
          </section>
        )
      ) : null}

      {authorization ? (
        <AuthorizationPanel
          authorization={authorization}
          providerLabel={providerLabel}
          mutating={mutating}
          onCancel={cancelAuthorization}
          onCopyCode={copyUserCode}
        />
      ) : null}

      {loading && !connections ? (
        <section className={styles.panel}>
          <div className={styles.body}>
            <Skeleton />
            <Skeleton />
          </div>
        </section>
      ) : error && !connections ? (
        <section className={styles.panel}>
          <div className={styles.empty}>
            <ErrorMessage>
              {t['com.affine.integration.enterprise.load-error']()}
            </ErrorMessage>
            <Button onClick={revalidate}>{t['Retry']()}</Button>
          </div>
        </section>
      ) : connections?.length ? (
        <div className={styles.connectionList}>
          {connections.map(connection => (
            <ConnectionPanel
              connection={connection}
              key={connection.id}
              mutating={mutating}
              providerAllowed={allowedProviders.has(connection.provider)}
              providerLabel={providerLabel}
              onAuthorize={reauthorize}
              onDelete={confirmDelete}
              onDisable={disable}
              onRefresh={refresh}
            />
          ))}
        </div>
      ) : (
        <section className={styles.panel}>
          <div className={styles.empty}>
            {t['com.affine.integration.enterprise.empty']()}
          </div>
        </section>
      )}
    </div>
  );
};

const AuthorizationPanel = ({
  authorization,
  providerLabel,
  mutating,
  onCancel,
  onCopyCode,
}: {
  authorization: EnterpriseAuthorizationSession;
  providerLabel: (provider: EnterpriseProvider) => string;
  mutating: string | null;
  onCancel: () => void;
  onCopyCode: () => void;
}) => {
  const t = useI18n();
  const active = !TERMINAL_AUTHORIZATION_STATUSES.has(authorization.status);
  const waitingForDingTalkAdmin =
    authorization.provider === EnterpriseProvider.DINGTALK &&
    authorization.status === 'WAITING' &&
    !authorization.authorizationUrl &&
    !authorization.userCode &&
    !authorization.qrCodeUrl;
  const larkStage =
    authorization.provider === EnterpriseProvider.LARK &&
    authorization.authorizationUrl
      ? larkAuthorizationStage(authorization.authorizationUrl)
      : null;
  const dingtalkStage =
    authorization.provider === EnterpriseProvider.DINGTALK &&
    authorization.authorizationUrl
      ? dingtalkAuthorizationStage(authorization.authorizationUrl)
      : null;
  const waitingMessage = larkStage
    ? larkStage === 'configure'
      ? t[
          'com.affine.integration.enterprise.authorization.lark.configure-ready'
        ]()
      : t[
          'com.affine.integration.enterprise.authorization.lark.authorize-ready'
        ]()
    : waitingForDingTalkAdmin
      ? t[
          'com.affine.integration.enterprise.authorization.admin-approval-pending'
        ]()
      : t['com.affine.integration.enterprise.authorization.waiting']();
  const openButtonLabel = larkStage
    ? larkStage === 'configure'
      ? t[
          'com.affine.integration.enterprise.authorization.lark.configure-action'
        ]()
      : t[
          'com.affine.integration.enterprise.authorization.lark.authorize-action'
        ]()
    : dingtalkStage === 'authorize'
      ? t[
          'com.affine.integration.enterprise.authorization.dingtalk.authorize-action'
        ]()
      : t['com.affine.integration.enterprise.authorization.open']();

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.title}>
            {providerLabel(authorization.provider)}
          </div>
          <div className={styles.description}>
            {t['com.affine.integration.enterprise.authorization.description']()}
          </div>
        </div>
        <span className={styles.status}>
          {authorizationStatusLabel(t, authorization.status)}
        </span>
      </div>
      <div className={styles.body}>
        {authorization.userCode || authorization.qrCodeUrl || active ? (
          <div className={styles.challenge}>
            <div>
              {dingtalkStage === 'authorize' ? (
                <div className={styles.description}>
                  {t[
                    'com.affine.integration.enterprise.authorization.dingtalk.authorize-ready'
                  ]()}
                </div>
              ) : null}
              {authorization.userCode ? (
                <div className={styles.userCode}>
                  <span>{authorization.userCode}</span>
                  <IconButton
                    size="20"
                    title={t[
                      'com.affine.integration.enterprise.authorization.copy-code'
                    ]()}
                    icon={<CopyIcon />}
                    onClick={onCopyCode}
                  />
                </div>
              ) : active ? (
                <div className={styles.description}>{waitingMessage}</div>
              ) : null}
            </div>
            {authorization.qrCodeUrl ? (
              <img
                className={styles.qrCode}
                src={`${authorization.qrCodeUrl}?v=${encodeURIComponent(authorization.updatedAt)}`}
                alt={t[
                  'com.affine.integration.enterprise.authorization.qrcode'
                ]()}
              />
            ) : null}
          </div>
        ) : null}
        {authorization.lastErrorMessage ? (
          <div className={styles.error}>{authorization.lastErrorMessage}</div>
        ) : null}
        <div className={styles.actions}>
          {authorization.authorizationUrl &&
          authorization.provider !== EnterpriseProvider.WECOM &&
          active ? (
            <a
              className={styles.externalLink}
              href={authorization.authorizationUrl}
              target={enterpriseAuthorizationWindowName(authorization.id)}
              rel="noopener noreferrer"
            >
              <Button prefix={<OpenInNewIcon />}>{openButtonLabel}</Button>
            </a>
          ) : null}
          {active ? (
            <Button
              loading={mutating === 'cancel-authorization'}
              disabled={!!mutating}
              onClick={onCancel}
            >
              {t['Cancel']()}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
};

const ConnectionPanel = ({
  connection,
  providerLabel,
  mutating,
  onAuthorize,
  onRefresh,
  onDisable,
  onDelete,
  providerAllowed,
}: {
  connection: EnterpriseConnection;
  providerLabel: (provider: EnterpriseProvider) => string;
  mutating: string | null;
  onAuthorize: (connection: EnterpriseConnection) => void;
  onRefresh: (connectionId: string) => void;
  onDisable: (connectionId: string) => void;
  onDelete: (connection: EnterpriseConnection) => void;
  providerAllowed: boolean;
}) => {
  const t = useI18n();
  const disabled = connection.status === 'DISABLED';
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.title}>{connection.name}</div>
          <div className={styles.description}>
            {providerLabel(connection.provider)}
          </div>
        </div>
        <span className={styles.status}>
          {connectionStatusLabel(t, connection.status)}
        </span>
      </div>
      <div className={styles.body}>
        <div className={styles.metaGrid}>
          <Meta
            label={t['com.affine.integration.enterprise.meta.identity']()}
            value={connection.externalUserId ?? connection.identityType ?? '-'}
          />
          <Meta
            label={t['com.affine.integration.enterprise.meta.last-checked']()}
            value={formatDate(connection.lastCheckedAt)}
          />
        </div>
        {connection.lastErrorMessage ? (
          <div className={styles.error}>{connection.lastErrorMessage}</div>
        ) : null}
        {!providerAllowed ? (
          <div className={styles.error}>
            {t['com.affine.integration.enterprise.policy.provider-blocked']()}
          </div>
        ) : null}
        <div className={styles.actions}>
          <Button
            loading={mutating === `authorize:${connection.id}`}
            disabled={!!mutating || !providerAllowed}
            onClick={() => onAuthorize(connection)}
          >
            {t['com.affine.integration.enterprise.action.authorize']()}
          </Button>
          <Button
            loading={mutating === `refresh:${connection.id}`}
            disabled={!!mutating || disabled || !providerAllowed}
            onClick={() => onRefresh(connection.id)}
          >
            {t['com.affine.integration.enterprise.action.refresh']()}
          </Button>
          <Button
            loading={mutating === `disable:${connection.id}`}
            disabled={!!mutating || disabled}
            onClick={() => onDisable(connection.id)}
          >
            {t['com.affine.integration.enterprise.action.disable']()}
          </Button>
          <Button
            variant="error"
            disabled={!!mutating}
            onClick={() => onDelete(connection)}
          >
            {t['Delete']()}
          </Button>
        </div>
      </div>
      {connection.tools.length ? (
        <div className={styles.tools}>
          {connection.tools.map(tool => (
            <div className={styles.tool} key={tool.name}>
              <div>
                <div className={styles.title}>{tool.name}</div>
                <div className={styles.description}>
                  {t[
                    `com.affine.integration.enterprise.tool.risk.${tool.risk}` as
                      | 'com.affine.integration.enterprise.tool.risk.read'
                      | 'com.affine.integration.enterprise.tool.risk.write'
                      | 'com.affine.integration.enterprise.tool.risk.high'
                  ]()}
                  {' · '}
                  {tool.description}
                </div>
              </div>
              <span className={styles.toolPolicy}>
                {tool.enabled
                  ? t['com.affine.integration.enterprise.tool.admin-managed']()
                  : t[
                      'com.affine.integration.enterprise.tool.refresh-required'
                    ]()}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.meta}>
    <span className={styles.metaLabel}>{label}</span>
    <span className={styles.metaValue}>{value}</span>
  </div>
);

const connectionStatusLabel = (
  t: ReturnType<typeof useI18n>,
  status: EnterpriseConnection['status']
) =>
  t[
    `com.affine.integration.enterprise.status.${status.toLowerCase().replace('_', '-')}` as
      | 'com.affine.integration.enterprise.status.active'
      | 'com.affine.integration.enterprise.status.connecting'
      | 'com.affine.integration.enterprise.status.degraded'
      | 'com.affine.integration.enterprise.status.reauth-required'
      | 'com.affine.integration.enterprise.status.disabled'
  ]();

const authorizationStatusLabel = (
  t: ReturnType<typeof useI18n>,
  status: EnterpriseAuthorizationSession['status']
) =>
  t[
    `com.affine.integration.enterprise.authorization.status.${status.toLowerCase()}` as
      | 'com.affine.integration.enterprise.authorization.status.pending'
      | 'com.affine.integration.enterprise.authorization.status.starting'
      | 'com.affine.integration.enterprise.authorization.status.waiting'
      | 'com.affine.integration.enterprise.authorization.status.authorized'
      | 'com.affine.integration.enterprise.authorization.status.failed'
      | 'com.affine.integration.enterprise.authorization.status.expired'
      | 'com.affine.integration.enterprise.authorization.status.cancelled'
  ]();
