import {
  Button,
  Checkbox,
  ErrorMessage,
  Input,
  notify,
  Skeleton,
  useConfirmModal,
} from '@affine/component';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { ExternalMcpService } from '@affine/core/modules/cloud';
import type { ExternalMcpConnection } from '@affine/core/modules/cloud/services/external-mcp';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UserFriendlyError } from '@affine/error';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import MCPIcon from '../mcp-server/MCP.inline.svg';
import { IntegrationSettingHeader } from '../setting';
import * as styles from './setting-panel.css';

const CONVERSATION_TOOL = 'sparkclaw.conversation.send';

type ExternalMcpTool = ExternalMcpConnection['tools'][number];
type ExternalMcpToolRisk = 'read' | 'write' | 'high';

const normalizeToolRisk = (risk: string): ExternalMcpToolRisk =>
  risk === 'read' || risk === 'write' ? risk : 'high';

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '-';

const formatResult = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ExternalMcpSettingPanel = () => {
  const t = useI18n();
  const workspace = useService(WorkspaceService).workspace;
  const service = useService(ExternalMcpService);
  const settings = useLiveData(service.settings$);
  const loading = useLiveData(service.loading$);
  const error = useLiveData(service.error$);
  const { openConfirmModal } = useConfirmModal();
  const workspaceId = workspace.id;
  const connection = settings?.connection ?? null;

  const [showConnect, setShowConnect] = useState(false);
  const [name, setName] = useState('SparkClaw MCP');
  const [ticket, setTicket] = useState('');
  const [query, setQuery] = useState('你好，请介绍一下自己');
  const [testResult, setTestResult] = useState<unknown>(null);
  const [mutating, setMutating] = useState<string | null>(null);

  const revalidate = useCallback(() => {
    // oxlint-disable-next-line @typescript-eslint/no-floating-promises
    service.revalidate(workspaceId);
  }, [service, workspaceId]);

  useEffect(() => revalidate(), [revalidate]);

  useEffect(() => {
    if (connection?.status === 'REAUTH_REQUIRED') setShowConnect(true);
  }, [connection?.status]);

  const enabledTools = useMemo(
    () => new Set(connection?.enabledToolNames ?? []),
    [connection?.enabledToolNames]
  );

  const statusLabel = useCallback(
    (status: ExternalMcpConnection['status']) => {
      switch (status) {
        case 'ACTIVE':
          return t['com.affine.integration.external-mcp.status.active']();
        case 'CONNECTING':
          return t['com.affine.integration.external-mcp.status.connecting']();
        case 'DEGRADED':
          return t['com.affine.integration.external-mcp.status.degraded']();
        case 'REAUTH_REQUIRED':
          return t[
            'com.affine.integration.external-mcp.status.reauth-required'
          ]();
        case 'DISABLED':
          return t['com.affine.integration.external-mcp.status.disabled']();
        default:
          return status;
      }
    },
    [t]
  );

  const connect = useAsyncCallback(async () => {
    setMutating('connect');
    try {
      await service.connect({
        workspaceId,
        name: name.trim(),
        accessTicket: ticket.trim(),
      });
      setTicket('');
      setShowConnect(false);
      setTestResult(null);
      notify.success({
        title: t['com.affine.integration.external-mcp.connected'](),
      });
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [name, service, t, ticket, workspaceId]);

  const refreshTools = useAsyncCallback(async () => {
    setMutating('refresh');
    try {
      await service.refreshTools(workspaceId);
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [service, workspaceId]);

  const applyToolToggle = useAsyncCallback(
    async (toolName: string, checked: boolean) => {
      setMutating(`tool:${toolName}`);
      const next = new Set(enabledTools);
      if (checked) next.add(toolName);
      else next.delete(toolName);
      try {
        await service.updateToolAllowlist(workspaceId, [...next]);
      } catch (error) {
        notify.error({ error: UserFriendlyError.fromAny(error) });
      } finally {
        setMutating(null);
      }
    },
    [enabledTools, service, workspaceId]
  );

  const toolRiskLabel = useCallback(
    (risk: string) => {
      const normalized = normalizeToolRisk(risk);
      return t[
        `com.affine.integration.external-mcp.tool.risk.${normalized}` as
          | 'com.affine.integration.external-mcp.tool.risk.read'
          | 'com.affine.integration.external-mcp.tool.risk.write'
          | 'com.affine.integration.external-mcp.tool.risk.high'
      ]();
    },
    [t]
  );

  const toggleTool = useCallback(
    (tool: ExternalMcpTool, checked: boolean) => {
      const risk = normalizeToolRisk(tool.risk);
      if (checked && risk !== 'read') {
        openConfirmModal({
          title: t[
            'com.affine.integration.external-mcp.tool.enable-risk.title'
          ]({ name: tool.title || tool.name }),
          description: t[
            'com.affine.integration.external-mcp.tool.enable-risk.description'
          ]({ risk: toolRiskLabel(risk) }),
          confirmText: t['Confirm'](),
          cancelText: t['Cancel'](),
          confirmButtonOptions: { variant: 'primary' },
          onConfirm: () => applyToolToggle(tool.name, true),
        });
        return;
      }
      void applyToolToggle(tool.name, checked);
    },
    [applyToolToggle, openConfirmModal, t, toolRiskLabel]
  );

  const testConversation = useAsyncCallback(async () => {
    setMutating('test');
    setTestResult(null);
    try {
      const result = await service.testConversation(workspaceId, query.trim());
      setTestResult(result.result);
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [query, service, workspaceId]);

  const disable = useAsyncCallback(async () => {
    setMutating('disable');
    try {
      await service.disable(workspaceId);
    } catch (error) {
      notify.error({ error: UserFriendlyError.fromAny(error) });
    } finally {
      setMutating(null);
    }
  }, [service, workspaceId]);

  const confirmDelete = useCallback(() => {
    openConfirmModal({
      title: t['com.affine.integration.external-mcp.delete.title'](),
      description:
        t['com.affine.integration.external-mcp.delete.description'](),
      confirmText: t['Delete'](),
      cancelText: t['Cancel'](),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        setMutating('delete');
        try {
          await service.delete(workspaceId);
          setTicket('');
          setShowConnect(false);
          setTestResult(null);
        } catch (error) {
          notify.error({ error: UserFriendlyError.fromAny(error) });
        } finally {
          setMutating(null);
        }
      },
    });
  }, [openConfirmModal, service, t, workspaceId]);

  return (
    <div className={styles.stack}>
      <IntegrationSettingHeader
        icon={<img src={MCPIcon} />}
        name={t['com.affine.integration.external-mcp.name']()}
        desc={t['com.affine.integration.external-mcp.desc']()}
      />

      {loading && !settings ? (
        <div className={styles.panel}>
          <div className={styles.body}>
            <Skeleton />
            <Skeleton />
          </div>
        </div>
      ) : error && !settings ? (
        <div className={styles.panel}>
          <div className={styles.empty}>
            <ErrorMessage>
              {t['com.affine.integration.external-mcp.load-error']()}
            </ErrorMessage>
            <Button onClick={revalidate}>{t['Retry']()}</Button>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.title}>
                  {t['com.affine.integration.external-mcp.connection.title']()}
                </div>
                <div className={styles.description}>
                  {t[
                    'com.affine.integration.external-mcp.connection.description'
                  ]()}
                </div>
              </div>
              {connection ? (
                <span className={styles.status}>
                  {statusLabel(connection.status)}
                </span>
              ) : null}
            </div>

            {!connection || showConnect ? (
              <div className={styles.body}>
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span>
                      {t['com.affine.integration.external-mcp.field.name']()}
                    </span>
                    <Input value={name} maxLength={128} onChange={setName} />
                  </label>
                  <div className={styles.field}>
                    <span>
                      {t[
                        'com.affine.integration.external-mcp.field.protocol'
                      ]()}
                    </span>
                    <div className={styles.fixedValue}>
                      {settings?.protocolVersion ?? '2025-06-18'}
                    </div>
                  </div>
                  <div className={`${styles.field} ${styles.fullWidth}`}>
                    <span>
                      {t[
                        'com.affine.integration.external-mcp.field.endpoint'
                      ]()}
                    </span>
                    <div className={styles.fixedValue}>
                      {settings?.endpoint ?? ''}
                    </div>
                  </div>
                  <label className={`${styles.field} ${styles.fullWidth}`}>
                    <span>
                      {t['com.affine.integration.external-mcp.field.ticket']()}
                    </span>
                    <Input
                      type="password"
                      value={ticket}
                      maxLength={4096}
                      autoComplete="new-password"
                      onChange={setTicket}
                    />
                  </label>
                </div>
                <div className={styles.actions}>
                  {connection && connection.status !== 'REAUTH_REQUIRED' ? (
                    <Button
                      onClick={() => {
                        setTicket('');
                        setShowConnect(false);
                      }}
                    >
                      {t['Cancel']()}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    loading={mutating === 'connect'}
                    disabled={!name.trim() || !ticket.trim() || !!mutating}
                    onClick={connect}
                  >
                    {connection
                      ? t[
                          'com.affine.integration.external-mcp.action.reauthenticate'
                        ]()
                      : t[
                          'com.affine.integration.external-mcp.action.connect'
                        ]()}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.body}>
                <div className={styles.metaGrid}>
                  <Meta
                    label={t[
                      'com.affine.integration.external-mcp.field.endpoint'
                    ]()}
                    value={connection.endpoint}
                  />
                  <Meta
                    label={t[
                      'com.affine.integration.external-mcp.meta.server'
                    ]()}
                    value={
                      [connection.serverName, connection.serverVersion]
                        .filter(Boolean)
                        .join(' ') || '-'
                    }
                  />
                  <Meta
                    label={t[
                      'com.affine.integration.external-mcp.meta.session'
                    ]()}
                    value={`•••• ${connection.sessionFingerprint ?? '-'}`}
                  />
                  <Meta
                    label={t[
                      'com.affine.integration.external-mcp.meta.last-checked'
                    ]()}
                    value={formatDate(connection.lastCheckedAt)}
                  />
                </div>
                {connection.lastErrorMessage ? (
                  <div className={styles.error}>
                    {connection.lastErrorMessage} ({connection.lastErrorCode})
                  </div>
                ) : null}
                <div className={styles.actions}>
                  <Button
                    disabled={!!mutating}
                    onClick={() => {
                      setTicket('');
                      setShowConnect(true);
                    }}
                  >
                    {t[
                      'com.affine.integration.external-mcp.action.reauthenticate'
                    ]()}
                  </Button>
                  <Button
                    loading={mutating === 'disable'}
                    disabled={!!mutating || connection.status === 'DISABLED'}
                    onClick={disable}
                  >
                    {t['com.affine.integration.external-mcp.action.disable']()}
                  </Button>
                  <Button
                    variant="error"
                    disabled={!!mutating}
                    onClick={confirmDelete}
                  >
                    {t['Delete']()}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {connection && !showConnect ? (
            <>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <div className={styles.title}>
                      {t['com.affine.integration.external-mcp.tools.title']()}
                    </div>
                    <div className={styles.description}>
                      {t[
                        'com.affine.integration.external-mcp.tools.description'
                      ]()}
                    </div>
                  </div>
                  <Button
                    loading={mutating === 'refresh'}
                    disabled={!!mutating || connection.status === 'DISABLED'}
                    onClick={refreshTools}
                  >
                    {t['com.affine.integration.external-mcp.action.refresh']()}
                  </Button>
                </div>
                {connection.tools.length ? (
                  <div className={styles.tools}>
                    {connection.tools.map(tool => (
                      <div className={styles.tool} key={tool.name}>
                        <div>
                          <div className={styles.title}>
                            {tool.title || tool.name}
                          </div>
                          <div className={styles.description}>{tool.name}</div>
                          <div className={styles.toolMeta}>
                            {toolRiskLabel(tool.risk)}
                            {tool.requiresExplicitUserRequest
                              ? ` · ${t[
                                  'com.affine.integration.external-mcp.tool.explicit-request'
                                ]()}`
                              : null}
                          </div>
                          {tool.description ? (
                            <div className={styles.description}>
                              {tool.description}
                            </div>
                          ) : null}
                        </div>
                        <Checkbox
                          checked={enabledTools.has(tool.name)}
                          disabled={
                            !!mutating || connection.status === 'DISABLED'
                          }
                          label={t[
                            'com.affine.integration.external-mcp.tool.enabled'
                          ]()}
                          onChange={(_, checked) => toggleTool(tool, checked)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>
                    {t['com.affine.integration.external-mcp.tools.empty']()}
                  </div>
                )}
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <div className={styles.title}>
                      {t['com.affine.integration.external-mcp.test.title']()}
                    </div>
                    <div className={styles.description}>
                      {CONVERSATION_TOOL}
                    </div>
                  </div>
                </div>
                <div className={styles.body}>
                  <label className={styles.field}>
                    <span>
                      {t['com.affine.integration.external-mcp.test.query']()}
                    </span>
                    <Input value={query} maxLength={2000} onChange={setQuery} />
                  </label>
                  <div className={styles.actions}>
                    <Button
                      variant="primary"
                      loading={mutating === 'test'}
                      disabled={
                        !!mutating ||
                        !query.trim() ||
                        connection.status === 'DISABLED' ||
                        !enabledTools.has(CONVERSATION_TOOL)
                      }
                      onClick={testConversation}
                    >
                      {t['com.affine.integration.external-mcp.action.test']()}
                    </Button>
                  </div>
                  {testResult !== null ? (
                    <pre className={styles.testResult}>
                      {formatResult(testResult)}
                    </pre>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.meta}>
    <span className={styles.metaLabel}>{label}</span>
    <span className={styles.metaValue}>{value}</span>
  </div>
);
