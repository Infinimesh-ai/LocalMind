import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@affine/admin/components/ui/card';
import { Input } from '@affine/admin/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affine/admin/components/ui/table';
import { useI18n } from '@affine/i18n';
import { useEffect, useState } from 'react';

import { translateAdminText as text } from '../../localized-text';
import { Header } from '../header';

type LogRow = {
  eventId: string;
  occurredAt: string;
  severity: string;
  eventName: string;
  messageTemplate?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  auditEventId?: string | null;
  status?: string | null;
  errorCode?: string | null;
  metadata?: unknown;
};

type ArchiveBatch = {
  id: string;
  status: string;
  keyVersion?: string | null;
  manifestFingerprint?: string | null;
  itemCount: number;
  attempt: number;
  maxAttempts: number;
  failureCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

type SessionDeletionTask = {
  id: string;
  sessionId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  status: string;
  backupStatus: string;
  attempt: number;
  maxAttempts: number;
  holdReason?: string | null;
  failureCode?: string | null;
  requestedAt: string;
  completedAt?: string | null;
};

export function ObservabilityLogsPage() {
  useI18n();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [requestId, setRequestId] = useState('');
  const [severity, setSeverity] = useState('');
  const [eventName, setEventName] = useState('');
  const [traceId, setTraceId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<LogRow>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setLoading(true);
    setError(undefined);
    void fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query Logs($requestId: String, $severity: String, $eventName: String, $traceId: String, $keyword: String) { localmindLogEvents(requestId: $requestId, severity: $severity, eventName: $eventName, traceId: $traceId, keyword: $keyword, limit: 100) { eventId occurredAt severity eventName messageTemplate requestId traceId status errorCode auditEventId metadata } }`,
        variables: {
          requestId: requestId || null,
          severity: severity || null,
          eventName: eventName || null,
          traceId: traceId || null,
          keyword: keyword || null,
        },
      }),
    })
      .then(response => response.json())
      .then(result => {
        if (result.errors)
          throw new Error(result.errors[0]?.message ?? 'Unable to load logs');
        setRows(result.data?.localmindLogEvents ?? []);
      })
      .catch(reason =>
        setError(reason instanceof Error ? reason.message : String(reason))
      )
      .finally(() => setLoading(false));
  }, [requestId, severity, eventName, traceId, keyword]);
  return (
    <div className="flex h-dvh flex-1 flex-col bg-background">
      <Header title={text('Observability / Logs')} />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>{text('Log Center')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={requestId}
                onChange={event => setRequestId(event.target.value)}
                placeholder={text('Filter by request ID')}
              />
              <Input
                value={traceId}
                onChange={event => setTraceId(event.target.value)}
                placeholder={text('Filter by trace ID')}
              />
              <Input
                value={severity}
                onChange={event => setSeverity(event.target.value)}
                placeholder={text('Severity (info/error)')}
              />
              <Input
                value={eventName}
                onChange={event => setEventName(event.target.value)}
                placeholder={text('Event name')}
              />
              <Input
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                placeholder={text('Keyword')}
              />
            </div>
            <a
              className="mt-3 inline-block text-sm underline"
              href={`/api/logs/export?${new URLSearchParams({
                format: 'ndjson',
                ...(requestId ? { requestId } : {}),
                ...(traceId ? { traceId } : {}),
                ...(severity ? { severity } : {}),
                ...(eventName ? { eventName } : {}),
                ...(keyword ? { keyword } : {}),
              }).toString()}`}
            >
              {text('Export redacted NDJSON')}
            </a>
          </CardContent>
        </Card>
        {loading ? (
          <p>{text('Loading logs…')}</p>
        ) : error ? (
          <p role="alert">{text('Unable to load logs')}</p>
        ) : rows.length === 0 ? (
          <p>{text('No logs found.')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text('Time')}</TableHead>
                <TableHead>{text('Severity')}</TableHead>
                <TableHead>{text('Event')}</TableHead>
                <TableHead>{text('Request')}</TableHead>
                <TableHead>{text('Trace / Audit')}</TableHead>
                <TableHead>{text('Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow
                  key={row.eventId}
                  className="cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    {new Date(row.occurredAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{row.severity}</TableCell>
                  <TableCell>{row.eventName}</TableCell>
                  <TableCell>{row.requestId ?? '—'}</TableCell>
                  <TableCell>
                    {row.traceId ?? row.auditEventId ?? '—'}
                  </TableCell>
                  <TableCell>{row.status ?? row.errorCode ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {selected ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {text('Event detail')} · {selected.eventId}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(selected, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export function ObservabilitySettingsPage() {
  const i18n = useI18n();
  const [policy, setPolicy] = useState<{
    runtimeRetentionDays?: number;
    failureRetentionDays?: number;
    traceRetentionDays?: number;
    auditRetentionDays?: number;
    legalHold?: boolean;
    retentionFrozen?: boolean;
  }>();
  const [saving, setSaving] = useState(false);
  const [ingestion, setIngestion] = useState<{
    bytes?: number;
    files?: number;
  }>();
  const [cleanupResult, setCleanupResult] = useState<number>();
  const [archiveResult, setArchiveResult] = useState<number>();
  const [archiveBatches, setArchiveBatches] = useState<ArchiveBatch[]>([]);
  const [deletionTasks, setDeletionTasks] = useState<SessionDeletionTask[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  useEffect(() => {
    const request = (query: string) =>
      fetch('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      }).then(response => response.json());
    request('{ localmindLogPolicy }')
      .then(result => setPolicy(result.data?.localmindLogPolicy))
      .catch(() => undefined);
    request('{ localmindLogIngestionStatus }')
      .then(result => setIngestion(result.data?.localmindLogIngestionStatus))
      .catch(() => undefined);
    request('{ localmindLogArchiveBatches(limit: 20) }')
      .then(result =>
        setArchiveBatches(result.data?.localmindLogArchiveBatches ?? [])
      )
      .catch(() => undefined);
    request('{ localmindSessionDeletionTasks(limit: 20) }')
      .then(result =>
        setDeletionTasks(result.data?.localmindSessionDeletionTasks ?? [])
      )
      .catch(() => undefined);
  }, []);
  const runArchive = (dryRun: boolean) => {
    setArchiveBusy(true);
    setPreviewError(false);
    setArchiveResult(undefined);
    void fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation Archive($dryRun: Boolean) { archiveLocalmindLogRetention(dryRun: $dryRun) }`,
        variables: { dryRun },
      }),
    })
      .then(response => response.json())
      .then(result => {
        if (result.errors?.length)
          throw new Error(result.errors[0]?.message ?? 'archive failed');
        setArchiveResult(
          result.data?.archiveLocalmindLogRetention?.archived ?? 0
        );
        if (!dryRun) {
          return fetch('/graphql', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              query: '{ localmindLogArchiveBatches(limit: 20) }',
            }),
          })
            .then(response => response.json())
            .then(next =>
              setArchiveBatches(
                next.data?.localmindLogArchiveBatches ?? archiveBatches
              )
            );
        }
        return undefined;
      })
      .catch(() => setPreviewError(true))
      .finally(() => setArchiveBusy(false));
  };
  const save = () => {
    if (!policy) return;
    setSaving(true);
    setSaveError(undefined);
    void fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'mutation Update($input: LocalMindLogPolicyInput!) { updateLocalmindLogPolicy(input: $input) }',
        variables: { input: policy },
      }),
    })
      .then(async response => {
        const result = await response.json();
        if (result.errors?.length)
          throw new Error(result.errors[0]?.message ?? 'Unable to save policy');
      })
      .catch(reason =>
        setSaveError(reason instanceof Error ? reason.message : String(reason))
      )
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex h-dvh flex-1 flex-col bg-background">
      <Header title={text('Observability / Settings')} />
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>{text('Retention and ingestion')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              {text('Self-hosted telemetry export is disabled by default.')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {i18n['com.affine.admin.ui.spool']({
                files: String(ingestion?.files ?? 0),
                bytes: String(ingestion?.bytes ?? 0),
              })}
            </p>
            <div className="mt-4 grid max-w-md gap-3">
              <label>
                {text('Runtime retention (days)')}
                <Input
                  type="number"
                  value={policy?.runtimeRetentionDays ?? 30}
                  onChange={event =>
                    setPolicy(prev => ({
                      ...prev,
                      runtimeRetentionDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                {text('Failure retention (days)')}
                <Input
                  type="number"
                  value={policy?.failureRetentionDays ?? 90}
                  onChange={event =>
                    setPolicy(prev => ({
                      ...prev,
                      failureRetentionDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={policy?.legalHold ?? false}
                  onChange={event =>
                    setPolicy(prev => ({
                      ...prev,
                      legalHold: event.target.checked,
                    }))
                  }
                />{' '}
                {text('Legal hold')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={policy?.retentionFrozen ?? false}
                  onChange={event =>
                    setPolicy(prev => ({
                      ...prev,
                      retentionFrozen: event.target.checked,
                    }))
                  }
                />{' '}
                {text('Freeze retention and archive cleanup')}
              </label>
              <button
                className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
                disabled={!policy || saving}
                onClick={save}
              >
                {text(saving ? 'Saving…' : 'Save policy')}
              </button>
              <button
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  setPreviewError(false);
                  setCleanupResult(undefined);
                  void fetch('/graphql', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      query:
                        'mutation { cleanupLocalmindLogRetention(dryRun: true) }',
                    }),
                  })
                    .then(response => response.json())
                    .then(result => {
                      if (result.errors?.length)
                        throw new Error('preview failed');
                      setCleanupResult(
                        result.data?.cleanupLocalmindLogRetention?.deleted ?? 0
                      );
                    })
                    .catch(() => setPreviewError(true));
                }}
              >
                {text('Preview retention cleanup')}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={saving || archiveBusy}
                  onClick={() => runArchive(true)}
                >
                  {text('Preview signed archive')}
                </button>
                <button
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={
                    saving ||
                    archiveBusy ||
                    policy?.legalHold ||
                    policy?.retentionFrozen
                  }
                  onClick={() => runArchive(false)}
                >
                  {text(archiveBusy ? 'Archiving…' : 'Create signed archive')}
                </button>
              </div>
              {cleanupResult !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {i18n['com.affine.admin.ui.cleanup-preview']({
                    count: String(cleanupResult),
                  })}
                </p>
              ) : null}
              {archiveResult !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {text('Archive candidates or completed records')}:{' '}
                  {archiveResult}
                </p>
              ) : null}
              {previewError ? (
                <p role="alert">
                  {i18n['com.affine.admin.ui.preview-failed']()}
                </p>
              ) : null}
              {saveError ? (
                <p role="alert">{text('Unable to save policy')}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{text('Signed archive batches')}</CardTitle>
          </CardHeader>
          <CardContent>
            {archiveBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {text('No archive batches yet.')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{text('Created')}</TableHead>
                    <TableHead>{text('Status')}</TableHead>
                    <TableHead>{text('Records')}</TableHead>
                    <TableHead>{text('Key version')}</TableHead>
                    <TableHead>{text('Integrity')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archiveBatches.map(batch => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        {new Date(batch.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {batch.status}
                        {batch.failureCode ? ` · ${batch.failureCode}` : ''}
                      </TableCell>
                      <TableCell>{batch.itemCount}</TableCell>
                      <TableCell>{batch.keyVersion ?? '—'}</TableCell>
                      <TableCell>
                        {batch.manifestFingerprint
                          ? batch.manifestFingerprint.slice(0, 12)
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{text('Session deletion tasks')}</CardTitle>
          </CardHeader>
          <CardContent>
            {deletionTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {text('No session deletion tasks yet.')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{text('Requested')}</TableHead>
                    <TableHead>{text('Session')}</TableHead>
                    <TableHead>{text('Scope')}</TableHead>
                    <TableHead>{text('Status')}</TableHead>
                    <TableHead>{text('Backup status')}</TableHead>
                    <TableHead>{text('Attempts')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletionTasks.map(task => (
                    <TableRow key={task.id}>
                      <TableCell>
                        {new Date(task.requestedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{task.sessionId.slice(0, 12)}</TableCell>
                      <TableCell>
                        {task.projectId ?? task.workspaceId ?? '—'}
                      </TableCell>
                      <TableCell>
                        {task.status}
                        {task.holdReason ? ` · ${task.holdReason}` : ''}
                        {task.failureCode ? ` · ${task.failureCode}` : ''}
                      </TableCell>
                      <TableCell>{task.backupStatus}</TableCell>
                      <TableCell>
                        {task.attempt}/{task.maxAttempts}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ObservabilityLogsPage;
