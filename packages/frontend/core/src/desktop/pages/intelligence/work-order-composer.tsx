import { Button, Input, Modal, notify } from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  confirmWorkOrderDispatchMutation,
  copilotWorkOrderRecipientResolveQuery,
  prepareWorkOrderDispatchMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './work-order-composer.css';

type ResolvedRecipient = { id: string; name: string; email: string };
type RequirementDraft = {
  id: string;
  kind: 'text' | 'file';
  title: string;
  instructions: string;
  required: boolean;
  acceptedMimeTypes: string;
  minCount: number;
  maxCount: number;
};
type RecipientDraft = {
  id: string;
  exact: string;
  recipient: ResolvedRecipient | null;
  title: string;
  purpose: string;
  relationKind: 'original' | 'supplement' | 'replacement';
  relatedWorkOrderId: string;
  requirements: RequirementDraft[];
};

export type WorkOrderAgentDraft = {
  draftId: string;
  sourceSessionId: string;
  recipients: Array<{
    recipient: ResolvedRecipient;
    title: string;
    purpose: string;
    relationKind: RecipientDraft['relationKind'];
    relatedWorkOrderId: string | null;
    requirements: Array<
      Omit<RequirementDraft, 'id' | 'acceptedMimeTypes'> & {
        acceptedMimeTypes: string[];
      }
    >;
  }>;
};

const id = () => nanoid();
const requirement = (): RequirementDraft => ({
  id: id(),
  kind: 'text',
  title: '',
  instructions: '',
  required: true,
  acceptedMimeTypes: '',
  minCount: 1,
  maxCount: 1,
});
const recipient = (): RecipientDraft => ({
  id: id(),
  exact: '',
  recipient: null,
  title: '',
  purpose: '',
  relationKind: 'original',
  relatedWorkOrderId: '',
  requirements: [requirement()],
});

type PreparedDispatch = {
  dispatchId: string;
  draftVersion: number;
  draftFingerprint: string;
  confirmationToken: string | null;
  expiresAt: string;
};

type WorkOrderComposerProps = {
  sourceSessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => Promise<unknown> | unknown;
  agentDraft?: WorkOrderAgentDraft | null;
};

function recipientsFromAgentDraft(
  draft: WorkOrderAgentDraft
): RecipientDraft[] {
  return draft.recipients.map(item => ({
    id: id(),
    exact: item.recipient.email,
    recipient: item.recipient,
    title: item.title,
    purpose: item.purpose,
    relationKind: item.relationKind,
    relatedWorkOrderId: item.relatedWorkOrderId ?? '',
    requirements: item.requirements.map(requirement => ({
      ...requirement,
      id: id(),
      acceptedMimeTypes: requirement.acceptedMimeTypes.join(', '),
    })),
  }));
}

export function WorkOrderComposer({
  sourceSessionId,
  open,
  onOpenChange,
  onSent,
  agentDraft,
}: WorkOrderComposerProps) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [drafts, setDrafts] = useState<RecipientDraft[]>(() => [recipient()]);
  const [prepared, setPrepared] = useState<PreparedDispatch | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !agentDraft || agentDraft.sourceSessionId !== sourceSessionId)
      return;
    setDrafts(recipientsFromAgentDraft(agentDraft));
    setPrepared(null);
  }, [agentDraft, open, sourceSessionId]);

  const valid = useMemo(
    () =>
      drafts.length > 0 &&
      drafts.every(
        draft =>
          draft.recipient &&
          draft.title.trim() &&
          draft.purpose.trim() &&
          draft.requirements.length > 0 &&
          draft.requirements.every(
            item =>
              item.title.trim() &&
              item.instructions.trim() &&
              (item.kind === 'text' || item.acceptedMimeTypes.trim())
          )
      ),
    [drafts]
  );
  const patchDraft = (draftId: string, patch: Partial<RecipientDraft>) => {
    setPrepared(null);
    setDrafts(current =>
      current.map(item => (item.id === draftId ? { ...item, ...patch } : item))
    );
  };
  const patchRequirement = (
    draftId: string,
    requirementId: string,
    patch: Partial<RequirementDraft>
  ) => {
    setPrepared(null);
    setDrafts(current =>
      current.map(draft =>
        draft.id === draftId
          ? {
              ...draft,
              requirements: draft.requirements.map(item =>
                item.id === requirementId ? { ...item, ...patch } : item
              ),
            }
          : draft
      )
    );
  };
  const resolve = async (draft: RecipientDraft) => {
    setPending(`resolve:${draft.id}`);
    try {
      const result = await graphql.gql({
        query: copilotWorkOrderRecipientResolveQuery,
        variables: { exact: draft.exact.trim() },
      });
      const resolved = result.currentUser?.copilot.resolveWorkOrderRecipient;
      patchDraft(draft.id, { recipient: resolved ?? null });
    } catch (error) {
      patchDraft(draft.id, { recipient: null });
      notify.error({
        title: t['com.affine.localmind.workbench.v9.recipientUnavailable'](),
        message: projectErrorMessage(error),
      });
    } finally {
      setPending(null);
    }
  };
  const prepare = async () => {
    if (!valid) return;
    setPending('prepare');
    try {
      const result = await graphql.gql({
        query: prepareWorkOrderDispatchMutation,
        variables: {
          sourceSessionId,
          requestKey: `prepare:${id()}`,
          recipients: drafts.map(draft => ({
            recipientId: draft.recipient?.id as string,
            title: draft.title.trim(),
            purpose: draft.purpose.trim(),
            relationKind: draft.relationKind,
            relatedWorkOrderId: draft.relatedWorkOrderId.trim() || undefined,
            backgroundLabel: undefined,
            sharedMaterialIds: [],
            requirements: draft.requirements.map(item => ({
              itemKey: item.id,
              kind: item.kind,
              title: item.title.trim(),
              instructions: item.instructions.trim(),
              required: item.required,
              acceptedMimeTypes:
                item.kind === 'file'
                  ? item.acceptedMimeTypes
                      .split(',')
                      .map(value => value.trim())
                      .filter(Boolean)
                  : [],
              minCount: item.required ? item.minCount : 0,
              maxCount: item.maxCount,
              validationMode:
                item.kind === 'file' ? 'mime_and_container' : 'non_empty_text',
            })),
          })),
        },
      });
      setPrepared(result.prepareWorkOrderDispatch);
    } catch (error) {
      notify.error({
        title: t['com.affine.localmind.workbench.v9.prepareFailed'](),
        message: projectErrorMessage(error),
      });
    } finally {
      setPending(null);
    }
  };
  const confirm = async () => {
    if (!prepared?.confirmationToken) return;
    setPending('confirm');
    try {
      await graphql.gql({
        query: confirmWorkOrderDispatchMutation,
        variables: {
          dispatchId: prepared.dispatchId,
          confirmationToken: prepared.confirmationToken,
          expectedDraftVersion: prepared.draftVersion,
          requestKey: `confirm:${id()}`,
        },
      });
      await onSent();
      setDrafts([recipient()]);
      setPrepared(null);
      onOpenChange(false);
      notify.success({
        title: t['com.affine.localmind.workbench.v9.workOrdersSent'](),
      });
    } catch (error) {
      notify.error({
        title: t['com.affine.localmind.workbench.v9.sendFailed'](),
        message: projectErrorMessage(error),
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      open={open}
      width={720}
      title={t['com.affine.localmind.workbench.v9.workOrderDraft']()}
      onOpenChange={next => {
        if (!pending) onOpenChange(next);
      }}
    >
      <div className={styles.root}>
        <p className={styles.help}>
          {t['com.affine.localmind.workbench.v9.workOrderDraftHelp']()}
        </p>
        {drafts.map((draft, draftIndex) => (
          <section key={draft.id} className={styles.recipient}>
            <header>
              <h3>
                {t['com.affine.localmind.workbench.v9.recipient']()}{' '}
                {draftIndex + 1}
              </h3>
              {drafts.length > 1 ? (
                <Button
                  onClick={() =>
                    setDrafts(current =>
                      current.filter(item => item.id !== draft.id)
                    )
                  }
                >
                  {t['Remove']()}
                </Button>
              ) : null}
            </header>
            <div className={styles.resolveRow}>
              <Input
                value={draft.exact}
                placeholder={t[
                  'com.affine.localmind.workbench.v9.recipientPlaceholder'
                ]()}
                onChange={value =>
                  patchDraft(draft.id, { exact: value, recipient: null })
                }
              />
              <Button
                disabled={!draft.exact.trim()}
                loading={pending === `resolve:${draft.id}`}
                onClick={() => void resolve(draft)}
              >
                {t['com.affine.localmind.workbench.v9.resolveRecipient']()}
              </Button>
            </div>
            {draft.recipient ? (
              <div className={styles.resolved}>
                <strong>{draft.recipient.name || draft.recipient.email}</strong>
                <span>{draft.recipient.email}</span>
                <code>{draft.recipient.id}</code>
              </div>
            ) : null}
            <label>
              <span>
                {t['com.affine.localmind.workbench.v9.workOrderTitle']()}
              </span>
              <Input
                value={draft.title}
                maxLength={256}
                onChange={title => patchDraft(draft.id, { title })}
              />
            </label>
            <label>
              <span>{t['com.affine.localmind.workbench.v9.purpose']()}</span>
              <textarea
                rows={3}
                value={draft.purpose}
                onChange={event =>
                  patchDraft(draft.id, { purpose: event.currentTarget.value })
                }
              />
            </label>
            <div className={styles.relationshipRow}>
              <label>
                <span>
                  {t['com.affine.localmind.workbench.v9.relationKind']()}
                </span>
                <select
                  value={draft.relationKind}
                  onChange={event =>
                    patchDraft(draft.id, {
                      relationKind: event.currentTarget
                        .value as RecipientDraft['relationKind'],
                    })
                  }
                >
                  <option value="original">original</option>
                  <option value="supplement">supplement</option>
                  <option value="replacement">replacement</option>
                </select>
              </label>
              {draft.relationKind !== 'original' ? (
                <label>
                  <span>
                    {t['com.affine.localmind.workbench.v9.relatedWorkOrder']()}
                  </span>
                  <Input
                    value={draft.relatedWorkOrderId}
                    onChange={relatedWorkOrderId =>
                      patchDraft(draft.id, { relatedWorkOrderId })
                    }
                  />
                </label>
              ) : null}
            </div>
            <h4>{t['com.affine.localmind.workbench.v9.requirements']()}</h4>
            {draft.requirements.map((item, itemIndex) => (
              <fieldset key={item.id} className={styles.requirement}>
                <legend>
                  {t['com.affine.localmind.workbench.v9.requirement']()}{' '}
                  {itemIndex + 1}
                </legend>
                <div className={styles.requirementGrid}>
                  <label>
                    <span>{t['com.affine.localmind.workbench.v9.kind']()}</span>
                    <select
                      value={item.kind}
                      onChange={event =>
                        patchRequirement(draft.id, item.id, {
                          kind: event.currentTarget.value as 'text' | 'file',
                        })
                      }
                    >
                      <option value="text">text</option>
                      <option value="file">file</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      {t[
                        'com.affine.localmind.workbench.v9.requirementTitle'
                      ]()}
                    </span>
                    <Input
                      value={item.title}
                      onChange={title =>
                        patchRequirement(draft.id, item.id, { title })
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>
                    {t['com.affine.localmind.workbench.v9.instructions']()}
                  </span>
                  <textarea
                    rows={2}
                    value={item.instructions}
                    onChange={event =>
                      patchRequirement(draft.id, item.id, {
                        instructions: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                {item.kind === 'file' ? (
                  <label>
                    <span>
                      {t[
                        'com.affine.localmind.workbench.v9.acceptedMimeTypes'
                      ]()}
                    </span>
                    <Input
                      value={item.acceptedMimeTypes}
                      placeholder="application/vnd.openxmlformats-officedocument.presentationml.presentation"
                      onChange={acceptedMimeTypes =>
                        patchRequirement(draft.id, item.id, {
                          acceptedMimeTypes,
                        })
                      }
                    />
                  </label>
                ) : null}
                <div className={styles.requirementActions}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={item.required}
                      onChange={event =>
                        patchRequirement(draft.id, item.id, {
                          required: event.currentTarget.checked,
                        })
                      }
                    />
                    {t['com.affine.localmind.workbench.v9.required']()}
                  </label>
                  {draft.requirements.length > 1 ? (
                    <Button
                      onClick={() =>
                        patchDraft(draft.id, {
                          requirements: draft.requirements.filter(
                            requirement => requirement.id !== item.id
                          ),
                        })
                      }
                    >
                      {t['Remove']()}
                    </Button>
                  ) : null}
                </div>
              </fieldset>
            ))}
            <Button
              onClick={() =>
                patchDraft(draft.id, {
                  requirements: [...draft.requirements, requirement()],
                })
              }
            >
              {t['com.affine.localmind.workbench.v9.addRequirement']()}
            </Button>
          </section>
        ))}
        <Button onClick={() => setDrafts(current => [...current, recipient()])}>
          {t['com.affine.localmind.workbench.v9.addRecipient']()}
        </Button>
        {prepared ? (
          <section className={styles.confirmation}>
            <strong>
              {t['com.affine.localmind.workbench.v9.confirmBeforeSending']()}
            </strong>
            <code>{prepared.draftFingerprint}</code>
            <span>
              {t['com.affine.localmind.workbench.v9.confirmExpires']()}:{' '}
              {new Date(prepared.expiresAt).toLocaleString()}
            </span>
          </section>
        ) : null}
        <div className={styles.actions}>
          <Button disabled={!!pending} onClick={() => onOpenChange(false)}>
            {t['Cancel']()}
          </Button>
          {prepared ? (
            <Button
              variant="primary"
              loading={pending === 'confirm'}
              disabled={!prepared.confirmationToken}
              onClick={() => void confirm()}
            >
              {t['com.affine.localmind.workbench.v9.confirmAndSend']()}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!valid}
              loading={pending === 'prepare'}
              onClick={() => void prepare()}
            >
              {t['com.affine.localmind.workbench.v9.prepareConfirmation']()}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
