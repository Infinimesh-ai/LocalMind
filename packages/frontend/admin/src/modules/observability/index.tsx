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
import { useEffect, useState } from 'react';

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

export function ObservabilityLogsPage() {
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
      <Header title="Observability / Logs" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Log Center</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={requestId}
                onChange={event => setRequestId(event.target.value)}
                placeholder="Filter by request ID"
              />
              <Input
                value={traceId}
                onChange={event => setTraceId(event.target.value)}
                placeholder="Filter by trace ID"
              />
              <Input
                value={severity}
                onChange={event => setSeverity(event.target.value)}
                placeholder="Severity (info/error)"
              />
              <Input
                value={eventName}
                onChange={event => setEventName(event.target.value)}
                placeholder="Event name"
              />
              <Input
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                placeholder="Keyword"
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
              Export redacted NDJSON
            </a>
          </CardContent>
        </Card>
        {loading ? (
          <p>Loading logs…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : rows.length === 0 ? (
          <p>No logs found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Trace / Audit</TableHead>
                <TableHead>Status</TableHead>
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
              <CardTitle>Event detail · {selected.eventId}</CardTitle>
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
  const [cleanupResult, setCleanupResult] = useState<string>();
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
  }, []);
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
      <Header title="Observability / Settings" />
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Retention and ingestion</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Self-hosted telemetry export is disabled by default.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Spool: {ingestion?.files ?? 0} files / {ingestion?.bytes ?? 0}{' '}
              bytes
            </p>
            <div className="mt-4 grid max-w-md gap-3">
              <label>
                Runtime retention (days)
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
                Failure retention (days)
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
                Legal hold
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
                Freeze retention and archive cleanup
              </label>
              <button
                className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
                disabled={!policy || saving}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save policy'}
              </button>
              <button
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  void fetch('/graphql', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      query:
                        'mutation { cleanupLocalmindLogRetention(dryRun: true) }',
                    }),
                  })
                    .then(response => response.json())
                    .then(result =>
                      setCleanupResult(
                        `Dry run: ${result.data?.cleanupLocalmindLogRetention?.deleted ?? 0} rows`
                      )
                    )
                    .catch(reason =>
                      setCleanupResult(
                        reason instanceof Error
                          ? reason.message
                          : String(reason)
                      )
                    );
                }}
              >
                Preview retention cleanup
              </button>
              {cleanupResult ? (
                <p className="text-sm text-muted-foreground">{cleanupResult}</p>
              ) : null}
              {saveError ? <p role="alert">{saveError}</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ObservabilityLogsPage;
