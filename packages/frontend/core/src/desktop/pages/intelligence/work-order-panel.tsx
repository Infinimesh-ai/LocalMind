import { Button, IconButton, Loading, notify } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  adoptWorkOrderDeliveriesMutation,
  answerWorkOrderQuestionMutation,
  askWorkOrderQuestionMutation,
  cancelWorkOrderMutation,
  type CopilotWorkOrderGetQuery,
  copilotWorkOrderGetQuery,
  refuseWorkOrderMutation,
  setWorkOrderDeliveryDraftItemMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { SidebarIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'react';

import * as styles from './work-order-panel.css';

export type WorkOrder = NonNullable<
  CopilotWorkOrderGetQuery['currentUser']
>['copilot']['myWorkOrder'];

type WorkOrderPanelProps = {
  workOrderId: string;
  onLoaded?: (order: WorkOrder) => void;
  onChanged?: () => Promise<unknown> | unknown;
  onDraftStateChange?: (workOrderId: string, blocked: boolean) => void;
  onCollapse?: () => void;
};

type StagedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export const updateWorkOrderTextValues = (
  current: Record<string, string>,
  requirementId: string,
  value: string
) => ({ ...current, [requirementId]: value });

const workOrderTextDraftKey = (workOrderId: string) =>
  `localmind:work-order-delivery-draft:${workOrderId}`;

export const readWorkOrderTextDraft = (workOrderId: string) => {
  try {
    const stored = window.localStorage.getItem(
      workOrderTextDraftKey(workOrderId)
    );
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
};

export const persistWorkOrderTextDraft = (
  workOrderId: string,
  values: Record<string, string>
) => {
  try {
    if (Object.values(values).some(value => value.length > 0)) {
      window.localStorage.setItem(
        workOrderTextDraftKey(workOrderId),
        JSON.stringify(values)
      );
    } else {
      window.localStorage.removeItem(workOrderTextDraftKey(workOrderId));
    }
  } catch {
    // A blocked or full localStorage must not make the delivery form unusable.
  }
};

const newRequestKey = (prefix: string) => `${prefix}:${nanoid()}`;

export function WorkOrderPanel({
  workOrderId,
  onLoaded,
  onChanged,
  onDraftStateChange,
  onCollapse,
}: WorkOrderPanelProps) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const query = useQuery(
    { query: copilotWorkOrderGetQuery, variables: { workOrderId } },
    { suspense: false, shouldRetryOnError: false }
  );
  const order = query.data?.currentUser?.copilot.myWorkOrder;
  const [textValues, setTextValues] = useState<Record<string, string>>(() =>
    readWorkOrderTextDraft(workOrderId)
  );
  const lastServerTextValues = useRef<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, StagedFile[]>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  useProjectRefresh(null, 'task', query.mutate);
  useEffect(() => {
    if (order) onLoaded?.(order);
  }, [onLoaded, order]);
  useEffect(() => {
    if (!order) return;
    const serverValues = Object.fromEntries(
      (order.deliveryDraft?.items ?? [])
        .filter(item => item.text)
        .map(item => [item.requirementId, item.text ?? ''])
    );
    setTextValues(current => {
      const next = { ...current };
      for (const requirement of order.requirements) {
        if (requirement.kind !== 'text') continue;
        if (
          (current[requirement.id] ?? '') ===
          (lastServerTextValues.current[requirement.id] ?? '')
        ) {
          next[requirement.id] = serverValues[requirement.id] ?? '';
        }
      }
      return next;
    });
    lastServerTextValues.current = serverValues;
    const selectedBlobIds = new Set(
      order.deliveryDraft?.items.flatMap(item => item.blobIds) ?? []
    );
    setFiles(
      order.stagedBlobs
        .filter(blob => selectedBlobIds.has(blob.id))
        .reduce<Record<string, StagedFile[]>>((grouped, blob) => {
          (grouped[blob.requirementId] ??= []).push({
            id: blob.id,
            fileName: blob.fileName,
            mimeType: blob.mimeType,
            byteSize: blob.byteSize,
          });
          return grouped;
        }, {})
    );
  }, [order]);
  useEffect(() => {
    persistWorkOrderTextDraft(workOrderId, textValues);
  }, [textValues, workOrderId]);

  const changedTextRequirements =
    order?.requirements.filter(requirement => {
      if (requirement.kind !== 'text') return false;
      const saved =
        order.deliveryDraft?.items.find(
          item => item.requirementId === requirement.id
        )?.text ?? '';
      return (textValues[requirement.id] ?? '') !== saved;
    }) ?? [];
  const draftBlocked =
    !order ||
    changedTextRequirements.length > 0 ||
    uploading !== null ||
    pending === 'save-draft';
  useEffect(() => {
    onDraftStateChange?.(workOrderId, draftBlocked);
  }, [onDraftStateChange, workOrderId, draftBlocked]);

  const refresh = async () => {
    await Promise.all([query.mutate(), onChanged?.()]);
  };
  const act = async (
    key: string,
    execute: () => Promise<unknown>,
    clearMessage = false
  ) => {
    if (pending) return;
    setPending(key);
    try {
      await execute();
      if (clearMessage) setMessage('');
      await refresh();
    } catch (error) {
      notify.error({
        title: t['com.affine.localmind.workbench.v9.actionFailed'](),
        message: projectErrorMessage(error),
      });
    } finally {
      setPending(null);
    }
  };
  const upload = async (requirementId: string, selected: FileList | null) => {
    if (!selected?.length || !order) return;
    onDraftStateChange?.(workOrderId, true);
    setUploading(requirementId);
    try {
      const staged: StagedFile[] = [];
      for (const file of Array.from(selected)) {
        const response = await fetch(
          `/api/copilot/work-orders/${encodeURIComponent(order.id)}/files?fileName=${encodeURIComponent(file.name)}&requirementId=${encodeURIComponent(requirementId)}&requestKey=${encodeURIComponent(newRequestKey('upload'))}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': file.type || 'application/octet-stream',
            },
            body: file,
          }
        );
        if (!response.ok) throw new Error(await response.text());
        const result = (await response.json()) as StagedFile;
        staged.push(result);
      }
      setFiles(current => ({
        ...current,
        [requirementId]: [...(current[requirementId] ?? []), ...staged],
      }));
      await refresh();
    } catch (error) {
      notify.error({
        title: t['com.affine.localmind.workbench.v9.uploadFailed'](),
        message: projectErrorMessage(error),
      });
    } finally {
      setUploading(null);
    }
  };

  if (query.isLoading)
    return (
      <div className={styles.state}>
        <Loading size={28} />
      </div>
    );
  if (query.error || !order)
    return (
      <div className={styles.state} role="alert">
        <span>
          {query.error
            ? projectErrorMessage(query.error)
            : t['com.affine.localmind.workbench.v9.unavailable']()}
        </span>
        <Button onClick={() => void query.mutate()}>{t['Retry']()}</Button>
      </div>
    );

  const active = !['cancelled', 'refused'].includes(order.status);
  const recipient = order.viewerRole === 'recipient';
  const latestDelivery = order.deliveries[0];
  const checkReasonText = (reason: string) => {
    switch (reason) {
      case 'Required text is missing':
        return t['com.affine.localmind.workbench.v9.checkMissingText']();
      case 'File count does not match the requirement':
        return t['com.affine.localmind.workbench.v9.checkFileCount']();
      case 'A selected file is unavailable or does not match':
      case 'A selected file cannot be read or verified':
        return t['com.affine.localmind.workbench.v9.checkFileUnavailable']();
      case 'Semantic validation evidence is unavailable':
        return t['com.affine.localmind.workbench.v9.checkSemanticEvidence']();
      default:
        return t['com.affine.localmind.workbench.v9.checkInvalidItem']();
    }
  };
  return (
    <aside className={styles.root} aria-labelledby="work-order-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            {t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
            {order.sourceProjectNameSnapshot
              ? ` · ${t['com.affine.localmind.workbench.v9.sourceProject']()}：${order.sourceProjectNameSnapshot}`
              : null}
          </span>
          <h2 id="work-order-title">{order.title}</h2>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.status}>{order.status}</span>
          {onCollapse ? (
            <IconButton
              size="20"
              icon={<SidebarIcon />}
              aria-label={t[
                'com.affine.localmind.workbench.v9.collapseWorkOrderPanel'
              ]()}
              aria-controls="work-order-details"
              aria-expanded={true}
              onClick={onCollapse}
            />
          ) : null}
        </div>
      </header>
      <div className={styles.scroll}>
        <section className={styles.section}>
          <h3>{t['com.affine.localmind.workbench.v9.purpose']()}</h3>
          <p>{order.purpose}</p>
          <dl className={styles.meta}>
            <div>
              <dt>{t['com.affine.localmind.workbench.v9.relationKind']()}</dt>
              <dd>{order.relationKind}</dd>
            </div>
            <div>
              <dt>{t['com.affine.localmind.workbench.v9.version']()}</dt>
              <dd>v{order.version}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.section}>
          <h3>{t['com.affine.localmind.workbench.v9.requirements']()}</h3>
          <div className={styles.requirements}>
            {order.requirements.map(requirement => {
              const check = order.deliveryDraft?.checks.find(
                candidate => candidate.requirementId === requirement.id
              );
              return (
                <fieldset key={requirement.id} className={styles.requirement}>
                  <legend>
                    {requirement.title}
                    {requirement.required ? ' *' : ''}
                  </legend>
                  <p>{requirement.instructions}</p>
                  {recipient && check && !check.ready && check.reason ? (
                    <p role="status">{checkReasonText(check.reason)}</p>
                  ) : null}
                  {recipient && active ? (
                    requirement.kind === 'text' ? (
                      <textarea
                        rows={4}
                        value={textValues[requirement.id] ?? ''}
                        onChange={event => {
                          const value = event.currentTarget.value;
                          onDraftStateChange?.(workOrderId, true);
                          setTextValues(current =>
                            updateWorkOrderTextValues(
                              current,
                              requirement.id,
                              value
                            )
                          );
                        }}
                      />
                    ) : (
                      <div className={styles.fileInput}>
                        <input
                          type="file"
                          multiple={requirement.maxCount > 1}
                          accept={requirement.acceptedMimeTypes.join(',')}
                          disabled={uploading === requirement.id}
                          onChange={event =>
                            void upload(
                              requirement.id,
                              event.currentTarget.files
                            )
                          }
                        />
                        {uploading === requirement.id ? (
                          <span>
                            {t['com.affine.localmind.workbench.v9.uploading']()}
                          </span>
                        ) : null}
                        {(files[requirement.id] ?? []).map(file => (
                          <span key={file.id}>
                            {file.fileName} · {file.byteSize.toLocaleString()} B
                          </span>
                        ))}
                      </div>
                    )
                  ) : null}
                </fieldset>
              );
            })}
          </div>
          {recipient && active && changedTextRequirements.length ? (
            <Button
              variant="primary"
              loading={pending === 'save-draft'}
              disabled={!!uploading}
              onClick={() =>
                void act('save-draft', async () => {
                  let expectedDraftVersion = order.deliveryDraft?.version ?? 0;
                  for (const requirement of changedTextRequirements) {
                    const result = await graphql.gql({
                      query: setWorkOrderDeliveryDraftItemMutation,
                      variables: {
                        workOrderId: order.id,
                        requirementId: requirement.id,
                        expectedDraftVersion,
                        text: textValues[requirement.id] ?? '',
                      },
                    });
                    expectedDraftVersion =
                      result.setWorkOrderDeliveryDraftItem.version;
                  }
                })
              }
            >
              {t['com.affine.localmind.workbench.v9.saveDeliveryDraft']()}
            </Button>
          ) : null}
          {recipient && active ? (
            <Button onClick={() => void query.mutate()} disabled={!!pending}>
              {t['com.affine.localmind.workbench.v9.recheckDeliveryDraft']()}
            </Button>
          ) : null}
        </section>

        {order.exchanges.length ? (
          <section className={styles.section}>
            <h3>{t['com.affine.localmind.workbench.v9.exchanges']()}</h3>
            <ol className={styles.timeline}>
              {order.exchanges.map(exchange => (
                <li key={exchange.id}>
                  <strong>{exchange.kind}</strong>
                  <span>{exchange.body}</span>
                  <time>{new Date(exchange.createdAt).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {order.deliveries.length ? (
          <section className={styles.section}>
            <h3>{t['com.affine.localmind.workbench.v9.deliveryHistory']()}</h3>
            {order.deliveries.map(delivery => (
              <article key={delivery.id} className={styles.delivery}>
                <header>
                  <strong>v{delivery.revision}</strong>
                  <time>{new Date(delivery.submittedAt).toLocaleString()}</time>
                </header>
                <code>{delivery.receiptFingerprint}</code>
                <ul>
                  {delivery.items.map((item, index) => (
                    <li key={`${item.requirementId}:${item.blobId ?? index}`}>
                      {item.blobId ? (
                        <a
                          href={`/api/copilot/work-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(item.blobId)}`}
                          download={item.fileName ?? 'download'}
                        >
                          {item.fileName ?? t['Download']()}
                        </a>
                      ) : (
                        item.textValue
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {!recipient &&
            order.deliveriesReleased &&
            order.sourceSessionId &&
            order.sourceContextVersion !== null &&
            latestDelivery ? (
              <Button
                variant="primary"
                loading={pending === 'adopt'}
                onClick={() =>
                  void act('adopt', () =>
                    graphql.gql({
                      query: adoptWorkOrderDeliveriesMutation,
                      variables: {
                        sourceSessionId: order.sourceSessionId as string,
                        expectedContextVersion:
                          order.sourceContextVersion as number,
                        requestKey: newRequestKey('adopt'),
                        revisions: [
                          {
                            workOrderId: order.id,
                            deliveryRevisionId: latestDelivery.id,
                          },
                        ],
                      },
                    })
                  )
                }
              >
                {t['com.affine.localmind.workbench.v9.adoptDelivery']()}
              </Button>
            ) : null}
          </section>
        ) : !recipient && !order.deliveriesReleased ? (
          <div className={styles.locked}>
            {t['com.affine.localmind.workbench.v9.waitForCompleteDispatch']()}
          </div>
        ) : null}

        {active ? (
          <section className={styles.section}>
            <h3>
              {recipient
                ? t['com.affine.localmind.workbench.v9.askOrRefuse']()
                : t['com.affine.localmind.workbench.v9.answerOrCancel']()}
            </h3>
            <textarea
              rows={4}
              maxLength={1200}
              value={message}
              onChange={event => setMessage(event.currentTarget.value)}
            />
            <div className={styles.actions}>
              {recipient ? (
                <>
                  <Button
                    disabled={!message.trim() || order.status !== 'open'}
                    loading={pending === 'question'}
                    onClick={() =>
                      void act(
                        'question',
                        () =>
                          graphql.gql({
                            query: askWorkOrderQuestionMutation,
                            variables: {
                              workOrderId: order.id,
                              body: message,
                              expectedVersion: order.version,
                              requestKey: newRequestKey('question'),
                            },
                          }),
                        true
                      )
                    }
                  >
                    {t['com.affine.localmind.workbench.v9.askQuestion']()}
                  </Button>
                  <Button
                    variant="error"
                    disabled={!message.trim()}
                    loading={pending === 'refuse'}
                    onClick={() =>
                      void act(
                        'refuse',
                        () =>
                          graphql.gql({
                            query: refuseWorkOrderMutation,
                            variables: {
                              workOrderId: order.id,
                              reason: message,
                              expectedVersion: order.version,
                              requestKey: newRequestKey('refuse'),
                            },
                          }),
                        true
                      )
                    }
                  >
                    {t['com.affine.localmind.workbench.v9.refuse']()}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    disabled={
                      !message.trim() || order.status !== 'waiting_sender'
                    }
                    loading={pending === 'answer'}
                    onClick={() =>
                      void act(
                        'answer',
                        () =>
                          graphql.gql({
                            query: answerWorkOrderQuestionMutation,
                            variables: {
                              workOrderId: order.id,
                              body: message,
                              expectedVersion: order.version,
                              requestKey: newRequestKey('answer'),
                            },
                          }),
                        true
                      )
                    }
                  >
                    {t['com.affine.localmind.workbench.v9.answerQuestion']()}
                  </Button>
                  <Button
                    variant="error"
                    loading={pending === 'cancel'}
                    onClick={() =>
                      void act(
                        'cancel',
                        () =>
                          graphql.gql({
                            query: cancelWorkOrderMutation,
                            variables: {
                              workOrderId: order.id,
                              reason: message.trim() || null,
                              expectedVersion: order.version,
                              requestKey: newRequestKey('cancel'),
                            },
                          }),
                        true
                      )
                    }
                  >
                    {t['com.affine.localmind.workbench.v9.cancelWorkOrder']()}
                  </Button>
                </>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
