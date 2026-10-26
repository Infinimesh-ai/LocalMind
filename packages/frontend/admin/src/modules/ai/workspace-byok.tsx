import { Badge } from '@affine/admin/components/ui/badge';
import { Button } from '@affine/admin/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@affine/admin/components/ui/card';
import { Input } from '@affine/admin/components/ui/input';
import { Label } from '@affine/admin/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@affine/admin/components/ui/select';
import { Switch } from '@affine/admin/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affine/admin/components/ui/table';
import { Textarea } from '@affine/admin/components/ui/textarea';
import { useMutation } from '@affine/admin/use-mutation';
import { useQuery } from '@affine/admin/use-query';
import {
  adminWorkspaceByokScopesQuery,
  adminWorkspaceByokSettingsQuery,
  ByokKeyStorage,
  ByokKeyTestStatus,
  ByokProvider,
  deleteWorkspaceByokConfigMutation,
  type QueryResponse,
  reorderWorkspaceByokConfigsMutation,
  testWorkspaceByokConfigMutation,
  upsertWorkspaceByokConfigMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../components/shared/confirm-dialog';
import { translateAdminText as text } from '../../localized-text';
import { formatByokError } from './byok-feedback';
import { WorkspaceAiProfilesEditor } from './workspace-ai-profiles';

type WorkspaceScope = QueryResponse<
  typeof adminWorkspaceByokScopesQuery
>['adminWorkspaceByokScopes'][number];
type WorkspaceByokSettings = QueryResponse<
  typeof adminWorkspaceByokSettingsQuery
>['adminWorkspaceByokSettings'];
type WorkspaceByokKey = WorkspaceByokSettings['keys'][number];

type KeyDraft = {
  apiKey: string;
  description: string;
  enabled: boolean;
  endpoint: string;
  id?: string;
  modelId: string;
  apiStyle: string;
  expectedRevision?: number;
  name: string;
  provider: ByokProvider;
  sortOrder: number;
};

const PROVIDER_LABELS: Record<ByokProvider, string> = {
  [ByokProvider.openai]: 'OpenAI',
  [ByokProvider.anthropic]: 'Anthropic',
  [ByokProvider.gemini]: 'Gemini',
  [ByokProvider.fal]: 'FAL',
};

const TEST_STATUS_LABELS: Record<ByokKeyTestStatus, string> = {
  [ByokKeyTestStatus.passed]: 'Connection tested',
  [ByokKeyTestStatus.failed]: 'Failed',
  [ByokKeyTestStatus.untested]: 'Not tested',
};

function emptyDraft(
  sortOrder: number,
  provider = ByokProvider.openai
): KeyDraft {
  return {
    apiKey: '',
    description: '',
    enabled: true,
    endpoint: '',
    modelId: '',
    apiStyle: 'responses',
    name: 'Primary',
    provider,
    sortOrder,
  };
}

function keyDraft(key: WorkspaceByokKey): KeyDraft {
  return {
    apiKey: '',
    description: key.description ?? '',
    enabled: key.enabled,
    endpoint: key.endpoint ?? '',
    id: key.id,
    modelId: key.modelId ?? '',
    apiStyle: key.apiStyle ?? 'responses',
    expectedRevision: key.configRevision,
    name: key.name,
    provider: key.provider,
    sortOrder: key.sortOrder,
  };
}

function testFingerprint(draft: KeyDraft, customEndpointSupported: boolean) {
  return JSON.stringify({
    apiKey: draft.apiKey.trim(),
    endpoint: customEndpointSupported ? draft.endpoint.trim() : undefined,
    id: draft.id ?? null,
    apiStyle: draft.apiStyle,
    expectedRevision: draft.expectedRevision,
    provider: draft.provider,
  });
}

function formatTimestamp(value: string | null) {
  if (!value) return text('Never');
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function WorkspaceByokEditor({ scope }: { scope: WorkspaceScope }) {
  const i18n = useI18n();
  const { data, error, isValidating, mutate } = useQuery({
    query: adminWorkspaceByokSettingsQuery,
    variables: { workspaceId: scope.id },
  });
  const settings = data.adminWorkspaceByokSettings;
  const defaultProvider = settings.allowedProviders[0] ?? ByokProvider.openai;
  const [draft, setDraft] = useState<KeyDraft>(() =>
    emptyDraft(settings.keys.length, defaultProvider)
  );
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(
    null
  );
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<'test' | 'save' | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);
  const requestPending = useRef(false);
  const { trigger: testConfig, isMutating: isTesting } = useMutation({
    mutation: testWorkspaceByokConfigMutation,
  });
  const { trigger: upsertConfig, isMutating: isSaving } = useMutation({
    mutation: upsertWorkspaceByokConfigMutation,
  });
  const { trigger: deleteConfig, isMutating: isDeleting } = useMutation({
    mutation: deleteWorkspaceByokConfigMutation,
  });
  const { trigger: reorderConfigs, isMutating: isReordering } = useMutation({
    mutation: reorderWorkspaceByokConfigsMutation,
  });

  useEffect(() => {
    setDraft(emptyDraft(settings.keys.length, defaultProvider));
    setTestedFingerprint(null);
    setAvailableModels([]);
  }, [defaultProvider, scope.id, settings.keys.length]);

  const currentTestFingerprint = useMemo(
    () => testFingerprint(draft, settings.customEndpointSupported),
    [draft, settings.customEndpointSupported]
  );
  const isTested = testedFingerprint === currentTestFingerprint;
  const modelOptions = isTested
    ? availableModels
    : [draft.modelId].filter(Boolean);
  const busy = pendingAction !== null || isTesting || isSaving;
  const canTest = Boolean(draft.id || draft.apiKey.trim());
  const canSave =
    settings.serverEntitled &&
    Boolean(draft.name.trim()) &&
    availableModels.includes(draft.modelId) &&
    Boolean(draft.id || draft.apiKey.trim()) &&
    isTested &&
    !busy;

  const resetDraft = () => {
    setDraft(emptyDraft(settings.keys.length, defaultProvider));
    setTestedFingerprint(null);
    setAvailableModels([]);
    setFormError(null);
  };

  const testInput = (modelId: string | null) => ({
    apiKey: draft.apiKey.trim() || undefined,
    configId: draft.id,
    endpoint: settings.customEndpointSupported
      ? draft.endpoint.trim() || null
      : undefined,
    modelId,
    apiStyle: draft.provider === ByokProvider.openai ? draft.apiStyle : null,
    expectedRevision: draft.expectedRevision,
    provider: draft.provider,
    storage: ByokKeyStorage.server,
    workspaceId: scope.id,
  });

  const handleTest = async () => {
    if (!canTest || busy || requestPending.current) return;
    requestPending.current = true;
    setPendingAction('test');
    setFormError(null);
    setTestedFingerprint(null);
    setAvailableModels([]);
    try {
      const result = await testConfig({
        input: testInput(null),
      });
      if (!result.testWorkspaceByokConfig.ok) {
        setFormError(formatByokError(result.testWorkspaceByokConfig.message));
        return;
      }
      const models = [...new Set(result.testWorkspaceByokConfig.models ?? [])];
      if (!models.length) {
        setFormError(
          i18n['com.affine.admin.workspace-byok-model-list-empty']()
        );
        return;
      }
      setAvailableModels(models);
      setDraft(current => ({
        ...current,
        modelId: models.includes(current.modelId) ? current.modelId : '',
      }));
      setTestedFingerprint(currentTestFingerprint);
    } catch (testError) {
      console.error(testError);
      setFormError(i18n['com.affine.admin.provider-test-failed']());
    } finally {
      requestPending.current = false;
      setPendingAction(null);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || requestPending.current) return;
    requestPending.current = true;
    setPendingAction('save');
    setFormError(null);
    let saved = false;
    try {
      const result = await testConfig({ input: testInput(draft.modelId) });
      if (!result.testWorkspaceByokConfig.ok) {
        setFormError(formatByokError(result.testWorkspaceByokConfig.message));
        return;
      }
      const persisted = await upsertConfig({
        input: {
          apiKey: draft.apiKey.trim() || undefined,
          description: draft.description.trim() || null,
          enabled: draft.enabled,
          endpoint: settings.customEndpointSupported
            ? draft.endpoint.trim() || null
            : undefined,
          id: draft.id,
          modelId: draft.modelId.trim() || null,
          apiStyle:
            draft.provider === ByokProvider.openai ? draft.apiStyle : null,
          expectedRevision: draft.expectedRevision,
          name: draft.name.trim(),
          provider: draft.provider,
          sortOrder: draft.sortOrder,
          storage: ByokKeyStorage.server,
          workspaceId: scope.id,
        },
      });
      saved = true;
      // Draft probes cannot change persisted validation state. Verify the exact
      // saved revision without draft overrides before reporting it as ready.
      let verificationError: string | null = null;
      if (draft.enabled) {
        try {
          const verified = await testConfig({
            input: {
              configId: persisted.upsertWorkspaceByokConfig.id,
              expectedRevision:
                persisted.upsertWorkspaceByokConfig.configRevision,
              provider: draft.provider,
              storage: ByokKeyStorage.server,
              workspaceId: scope.id,
            },
          });
          if (!verified.testWorkspaceByokConfig.ok) {
            verificationError = formatByokError(
              verified.testWorkspaceByokConfig.message
            );
          }
        } catch {
          verificationError = i18n['com.affine.admin.provider-test-failed']();
        }
      }
      await mutate();
      resetDraft();
      const savedMessage =
        i18n['com.affine.admin.workspace-ai-credential-saved']();
      if (verificationError) {
        setFormError(`${savedMessage} ${verificationError}`);
      } else {
        toast.success(savedMessage);
      }
    } catch (saveError) {
      console.error(saveError);
      setFormError(
        saved
          ? i18n['com.affine.admin.byok-saved-refresh-failed']()
          : i18n['com.affine.admin.failed-to-save-workspace-ai-credential']()
      );
    } finally {
      requestPending.current = false;
      setPendingAction(null);
    }
  };

  const [pendingDelete, setPendingDelete] = useState<WorkspaceByokKey | null>(
    null
  );
  const handleDelete = async (key: WorkspaceByokKey) => {
    try {
      await deleteConfig({ workspaceId: scope.id, id: key.id });
      await mutate();
      if (draft.id === key.id) resetDraft();
      toast.success(i18n['com.affine.admin.workspace-ai-credential-deleted']());
    } catch (deleteError) {
      console.error(deleteError);
      toast.error(
        i18n['com.affine.admin.failed-to-delete-workspace-ai-credential']()
      );
    }
  };

  const moveKey = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= settings.keys.length || isReordering) return;
    const ids = settings.keys.map(key => key.id);
    const currentId = ids[index];
    const targetId = ids[target];
    if (!currentId || !targetId) return;
    ids[index] = targetId;
    ids[target] = currentId;
    try {
      await reorderConfigs({
        input: {
          ids,
          storage: ByokKeyStorage.server,
          workspaceId: scope.id,
        },
      });
      await mutate();
    } catch (reorderError) {
      console.error(reorderError);
      toast.error(
        i18n['com.affine.admin.failed-to-reorder-workspace-ai-credentials']()
      );
    }
  };

  if (error) {
    return (
      <div className="border-t border-border/70 px-6 py-5 text-sm text-destructive">
        {i18n[
          'com.affine.admin.failed-to-load-workspace-ai-credentials'
        ]()}{' '}
      </div>
    );
  }

  return (
    <div className="border-t border-border/70">
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title={i18n['com.affine.admin.delete-credential']()}
        description={i18n[
          'com.affine.admin.delete-workspace-ai-credential-confirm'
        ]({
          name: pendingDelete?.name ?? '',
        })}
        confirmText={i18n['com.affine.admin.delete-credential']()}
        confirmButtonVariant="destructive"
        onConfirm={() => {
          const key = pendingDelete;
          setPendingDelete(null);
          if (key) handleDelete(key).catch(console.error);
        }}
      />
      <div className="grid gap-2 px-6 py-4 text-sm xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="font-medium">
            {scope.name || i18n['com.affine.admin.untitled-workspace']()}
          </div>
          <div className="break-all text-xs text-muted-foreground">
            {scope.id} / {scope.memberCount}{' '}
            {i18n['com.affine.ui.members']()}{' '}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={scope.enableAi ? 'default' : 'outline'}>
            {scope.enableAi
              ? i18n['com.affine.admin.workspace-ai-enabled']()
              : i18n['com.affine.admin.workspace-ai-disabled']()}
          </Badge>
          <Badge variant={settings.serverEntitled ? 'default' : 'destructive'}>
            {settings.serverEntitled
              ? i18n['com.affine.admin.credential-routing-available']()
              : i18n['com.affine.admin.not-entitled']()}
          </Badge>
        </div>
      </div>

      {settings.warnings.length ? (
        <div className="border-t border-border/70 bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
          {settings.warnings
            .map(warning => {
              switch (warning.featureKind) {
                case 'transcript':
                  return i18n['com.affine.admin.byok-transcript-warning']();
                case 'workspace_indexing':
                  return i18n['com.affine.admin.byok-indexing-warning']();
                default:
                  return warning.reason;
              }
            })
            .join(' ')}
        </div>
      ) : null}

      <div className="overflow-x-auto border-t border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {i18n['com.affine.integration.mcp-server.reveal.token']()}
              </TableHead>
              <TableHead>
                {i18n['com.affine.admin.model-and-endpoint']()}
              </TableHead>
              <TableHead>{i18n['com.affine.admin.status']()}</TableHead>
              <TableHead>{i18n['com.affine.admin.activity']()}</TableHead>
              <TableHead className="w-[156px] text-right">
                {i18n['com.affine.admin.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.keys.length ? (
              settings.keys.map((key, index) => (
                <TableRow key={key.id}>
                  <TableCell>
                    <div className="font-medium">{key.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PROVIDER_LABELS[key.provider]}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[360px] break-all text-sm">
                      {key.modelId ||
                        i18n['com.affine.admin.provider-default-model']()}
                    </div>
                    <div className="max-w-[360px] break-all text-xs text-muted-foreground">
                      {key.endpoint ||
                        i18n['com.affine.admin.default-provider-endpoint']()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        key.enabled &&
                        key.testStatus === ByokKeyTestStatus.passed
                          ? 'default'
                          : 'outline'
                      }
                    >
                      {key.enabled
                        ? text(TEST_STATUS_LABELS[key.testStatus])
                        : i18n[
                            'com.affine.integration.external-mcp.status.disabled'
                          ]()}
                    </Badge>
                    {key.lastTestError ? (
                      <div className="mt-1 max-w-[260px] text-xs text-destructive">
                        {formatByokError(key.lastTestError)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {i18n['com.affine.admin.last-used']()}{' '}
                    {formatTimestamp(key.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${key.name} up`}
                        title={i18n['com.affine.keyboardShortcuts.moveUp']()}
                        disabled={index === 0 || isReordering || busy}
                        onClick={() => void moveKey(index, -1)}
                      >
                        <ArrowUpIcon size={16} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${key.name} down`}
                        title={i18n['com.affine.keyboardShortcuts.moveDown']()}
                        disabled={
                          index === settings.keys.length - 1 ||
                          isReordering ||
                          busy
                        }
                        onClick={() => void moveKey(index, 1)}
                      >
                        <ArrowDownIcon size={16} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${key.name}`}
                        title={i18n['com.affine.admin.edit-credential']()}
                        disabled={busy}
                        onClick={() => {
                          setDraft(keyDraft(key));
                          setTestedFingerprint(null);
                          setAvailableModels([]);
                          setFormError(null);
                        }}
                      >
                        <PencilIcon size={16} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${key.name}`}
                        title={i18n['com.affine.admin.delete-credential']()}
                        disabled={isDeleting || busy}
                        onClick={() => setPendingDelete(key)}
                      >
                        <Trash2Icon size={16} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  {i18n[
                    'com.affine.admin.no-workspace-ai-credentials-configured'
                  ]()}{' '}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <form
        className="space-y-4 border-t border-border/70 px-6 py-5"
        onSubmit={event => void handleSave(event)}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">
                {draft.id
                  ? i18n['com.affine.admin.edit-credential']()
                  : i18n['com.affine.admin.add-credential']()}
              </div>
              <div className="text-xs text-muted-foreground">
                {i18n[
                  'com.affine.admin.provider-secrets-stay-encrypted-on-the-server-and-are-never-copied-to-user-records'
                ]()}{' '}
              </div>
            </div>
            {draft.id ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={resetDraft}
              >
                <PlusIcon size={16} />
                {i18n['com.affine.admin.add-another']()}{' '}
              </Button>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`byok-provider-${scope.id}`}>
                {i18n[
                  'com.affine.integration.calendar.caldav.field.provider'
                ]()}
              </Label>
              <Select
                disabled={Boolean(draft.id)}
                value={draft.provider}
                onValueChange={value => {
                  setDraft(current => ({
                    ...current,
                    provider: value as ByokProvider,
                    modelId: '',
                  }));
                  setTestedFingerprint(null);
                  setAvailableModels([]);
                }}
              >
                <SelectTrigger id={`byok-provider-${scope.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.allowedProviders.map(provider => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.provider === ByokProvider.openai ? (
              <div className="space-y-2">
                <Label htmlFor={`byok-api-style-${scope.id}`}>
                  {i18n['com.affine.admin.byok-api-protocol']()}
                </Label>
                <Select
                  value={draft.apiStyle}
                  disabled={isTesting || isSaving}
                  onValueChange={apiStyle => {
                    setDraft(current => ({
                      ...current,
                      apiStyle,
                      modelId: '',
                    }));
                    setTestedFingerprint(null);
                    setAvailableModels([]);
                  }}
                >
                  <SelectTrigger id={`byok-api-style-${scope.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="responses">Responses</SelectItem>
                    <SelectItem value="chat_completions">
                      Chat Completions
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`byok-name-${scope.id}`}>
                {i18n['com.affine.admin.credential-name']()}
              </Label>
              <Input
                id={`byok-name-${scope.id}`}
                value={draft.name}
                placeholder={i18n['com.affine.admin.primary']()}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2 xl:col-span-1">
              <Label htmlFor={`byok-key-${scope.id}`}>
                {i18n['com.affine.admin.api-key']()}
              </Label>
              <Input
                id={`byok-key-${scope.id}`}
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                placeholder={
                  draft.id
                    ? i18n[
                        'com.affine.admin.leave-blank-to-keep-the-current-key'
                      ]()
                    : i18n['com.affine.page-properties.property.required']()
                }
                onChange={event => {
                  setDraft(current => ({
                    ...current,
                    apiKey: event.target.value,
                    modelId: '',
                  }));
                  setTestedFingerprint(null);
                  setAvailableModels([]);
                }}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`byok-endpoint-${scope.id}`}>
                {i18n['com.affine.integration.external-mcp.field.endpoint']()}
              </Label>
              <Input
                id={`byok-endpoint-${scope.id}`}
                disabled={!settings.customEndpointSupported}
                value={draft.endpoint}
                placeholder={
                  settings.customEndpointSupported
                    ? i18n['com.affine.admin.optional-compatible-endpoint']()
                    : i18n['com.affine.admin.custom-endpoints-are-disabled']()
                }
                onChange={event => {
                  setDraft(current => ({
                    ...current,
                    endpoint: event.target.value,
                    modelId: '',
                  }));
                  setTestedFingerprint(null);
                  setAvailableModels([]);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`byok-model-options-${scope.id}`}>
                {i18n['com.affine.admin.byok-available-models']()}
              </Label>
              <Select
                value={draft.modelId}
                disabled={!isTested || !modelOptions.length || busy}
                onValueChange={value => {
                  if (!value) return;
                  setDraft(current => ({ ...current, modelId: value }));
                  setFormError(null);
                }}
              >
                <SelectTrigger id={`byok-model-options-${scope.id}`}>
                  <SelectValue
                    placeholder={i18n['com.affine.admin.byok-select-model']()}
                  />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map(model => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2 xl:col-span-3">
              <Label htmlFor={`byok-description-${scope.id}`}>
                {i18n['com.affine.localmind.aiContext.description']()}
              </Label>
              <Textarea
                id={`byok-description-${scope.id}`}
                rows={3}
                value={draft.description}
                placeholder={i18n[
                  'com.affine.admin.department-usage-or-ownership-notes'
                ]()}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <div className="flex items-center gap-3">
              <Switch
                id={`byok-enabled-${scope.id}`}
                checked={draft.enabled}
                onCheckedChange={enabled =>
                  setDraft(current => ({ ...current, enabled }))
                }
              />
              <Label htmlFor={`byok-enabled-${scope.id}`}>
                {i18n['com.affine.admin.use-this-credential-in-routing']()}{' '}
              </Label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span role="status" className="text-xs text-muted-foreground">
                {isValidating
                  ? i18n['com.affine.admin.refreshing-2']()
                  : isTested
                    ? i18n['com.affine.admin.workspace-byok-catalog-loaded']()
                    : i18n[
                        'com.affine.admin.test-the-provider-configuration-before-saving'
                      ]()}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={!canTest || busy}
                onClick={() => void handleTest()}
              >
                {pendingAction === 'test'
                  ? i18n['com.affine.admin.testing']()
                  : i18n['com.affine.admin.test']()}
              </Button>
              <Button type="submit" disabled={!canSave}>
                {pendingAction === 'save'
                  ? i18n['com.affine.admin.saving']()
                  : i18n['com.affine.admin.save-credential']()}
              </Button>
            </div>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </fieldset>
      </form>
    </div>
  );
}

export function WorkspaceByokAdmin() {
  const i18n = useI18n();
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>();
  const { data, error, isValidating } = useQuery({
    query: adminWorkspaceByokScopesQuery,
    variables: { keyword, first: 100 },
  });
  const scopes = data.adminWorkspaceByokScopes;
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');

  useEffect(() => {
    if (!scopes.some(scope => scope.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(scopes[0]?.id ?? '');
    }
  }, [scopes, selectedWorkspaceId]);

  const selectedScope = scopes.find(scope => scope.id === selectedWorkspaceId);

  return (
    <Card className="min-w-0 border-border/60 bg-card shadow-1">
      <CardHeader>
        <CardTitle className="text-base">
          {i18n['com.affine.admin.workspace-ai-credentials']()}
        </CardTitle>
        <CardDescription>
          {i18n[
            'com.affine.admin.configure-the-server-side-provider-credentials-inherited-by-each-department-workspace-workspace-memb'
          ]()}{' '}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(220px,1fr)_auto_minmax(280px,1fr)]"
          onSubmit={event => {
            event.preventDefault();
            setKeyword(searchInput.trim() || undefined);
          }}
        >
          <div className="relative min-w-0">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              aria-label={i18n[
                'com.affine.admin.search-workspace-ai-credential-scopes'
              ]()}
              placeholder={i18n[
                'com.affine.admin.search-workspace-name-owner-or-id'
              ]()}
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={isValidating}>
            {isValidating
              ? i18n['com.affine.admin.searching']()
              : i18n['com.affine.localmind.aiContext.search']()}
          </Button>
          <Select
            value={selectedWorkspaceId}
            onValueChange={setSelectedWorkspaceId}
            disabled={!scopes.length}
          >
            <SelectTrigger
              aria-label={i18n[
                'com.affine.admin.workspace-ai-credential-scope'
              ]()}
              className="md:col-span-2 xl:col-span-1"
            >
              <SelectValue
                placeholder={i18n['com.affine.admin.select-a-workspace']()}
              />
            </SelectTrigger>
            <SelectContent>
              {scopes.map(scope => (
                <SelectItem key={scope.id} value={scope.id}>
                  {scope.name || i18n['com.affine.admin.untitled-workspace']()}{' '}
                  / {scope.memberCount} {i18n['com.affine.ui.members']()}{' '}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </form>

        {error ? (
          <div className="text-sm text-destructive">
            {i18n[
              'com.affine.admin.failed-to-load-workspace-ai-credential-scopes'
            ]()}{' '}
          </div>
        ) : !scopes.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {i18n['com.affine.admin.no-workspaces-match-this-search']()}{' '}
          </div>
        ) : null}
      </CardContent>
      {selectedScope ? (
        <div key={selectedScope.id}>
          <WorkspaceByokEditor scope={selectedScope} />
          <WorkspaceAiProfilesEditor scope={selectedScope} />
        </div>
      ) : null}
    </Card>
  );
}
