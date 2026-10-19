import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ProjectReportApi,
  ReportCommand,
  ReportCommandInput,
  ReportLease,
  ReportQuery,
  ReportState,
} from './contracts';

export function useReportState(
  api: ProjectReportApi,
  query: ReportQuery,
  { revalidate = true }: { revalidate?: boolean } = {}
) {
  const [state, setState] = useState<ReportState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const current = useRef(query);
  current.current = query;
  const key = JSON.stringify(query);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [stateKey, setStateKey] = useState(key);
  const generation = useRef(0);
  const inFlight = useRef<
    | {
        key: string;
        controller: AbortController;
        promise: Promise<ReportState>;
        next?: Promise<ReportState>;
      }
    | undefined
  >(undefined);
  const request = useCallback(
    function load(afterCurrent = false): Promise<ReportState> {
      const pending = inFlight.current;
      if (
        pending?.key === activeKey.current &&
        !pending.controller.signal.aborted
      ) {
        if (!afterCurrent) return pending.promise;
        // Notifications/commands may describe a change after this request began.
        // Coalesce them into one catch-up read without discarding its response.
        return (pending.next ??= pending.promise
          .catch(() => {})
          .then(() => {
            if (
              pending.controller.signal.aborted ||
              pending.key !== activeKey.current
            )
              throw new DOMException('Report query changed', 'AbortError');
            return load();
          }));
      }
      pending?.controller.abort();
      const controller = new AbortController();
      const epoch = ++generation.current;
      const requestKey = activeKey.current;
      const accepts = () =>
        !controller.signal.aborted &&
        epoch === generation.current &&
        requestKey === activeKey.current;
      const promise = api
        .query(current.current, controller.signal)
        .then(result => {
          if (accepts()) {
            setStateKey(requestKey);
            setState(result);
            setError(undefined);
            setLoading(false);
          }
          return result;
        })
        .catch(error => {
          if (accepts()) {
            setStateKey(requestKey);
            // Failed authorization must not leave protected data in the UI.
            setState({});
            setError(error);
            setLoading(false);
          }
          throw error;
        })
        .finally(() => {
          if (inFlight.current?.promise === promise)
            inFlight.current = undefined;
        });
      inFlight.current = { key: requestKey, controller, promise };
      return promise;
    },
    [api]
  );
  const refresh = useCallback(() => request(true), [request]);
  const cancelRequest = useCallback(() => {
    generation.current++;
    inFlight.current?.controller.abort();
    inFlight.current = undefined;
  }, []);
  useEffect(() => {
    setStateKey(key);
    setState({});
    setLoading(true);
    setError(undefined);
    request().catch(() => {});
    // Include background refreshes started after this effect.
    return cancelRequest;
  }, [key, request, cancelRequest]);
  useEffect(() => {
    if (!revalidate) return;
    const unsubscribe = api.subscribe?.(query.projectId, () => {
      request(true).catch(() => {});
    });
    // Polls join an in-flight request; a slow network cannot starve the result.
    const timer = setInterval(() => {
      if (!document.hidden) request().catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [api, query.projectId, request, revalidate]);
  return {
    state: stateKey === key ? state : {},
    loading: stateKey !== key || loading,
    error: stateKey === key ? error : undefined,
    refresh,
    setState,
  };
}

export function useReportCommand(
  api: ProjectReportApi,
  input: Omit<ReportCommandInput, 'command' | 'requestKey'>,
  refresh: () => Promise<ReportState>
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const busy = useRef(false);
  const current = useRef(input);
  current.current = input;
  const execute = useCallback(
    async (
      command: ReportCommand,
      target?: Pick<
        ReportCommandInput,
        'reportId' | 'expectedVersion' | 'editLease'
      >
    ) => {
      if (busy.current) throw new Error('A report operation is pending');
      busy.current = true;
      setPending(true);
      setError(undefined);
      try {
        const result = await api.command({
          ...current.current,
          ...target,
          requestKey: crypto.randomUUID(),
          command,
        });
        await refresh().catch(setError);
        return result;
      } catch (error) {
        setError(error);
        throw error;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [api, refresh]
  );
  return { execute, pending, error, clearError: () => setError(undefined) };
}

export function useReportLease(
  api: ProjectReportApi,
  projectId: string,
  reportId: string | undefined,
  enabled: boolean
) {
  const [proof, setProof] = useState<ReportLease>();
  const [holder, setHolder] = useState('');
  const [error, setError] = useState<unknown>();
  const tab = useRef(crypto.randomUUID());
  const proofRef = useRef<ReportLease | undefined>(undefined);
  const acquireRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setProof(undefined);
    setHolder('');
    setError(undefined);
    proofRef.current = undefined;
    if (!reportId || !enabled) return;
    let active = true;
    let tail = Promise.resolve();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const send = (
      operation: 'lease.acquire' | 'lease.renew' | 'lease.release',
      lease = proofRef.current
    ) => {
      const task = async () => {
        const result = await api.command({
          projectId,
          reportId,
          requestKey: crypto.randomUUID(),
          command:
            operation === 'lease.acquire'
              ? { operation, tabId: tab.current }
              : {
                  operation,
                  tabId: tab.current,
                  leaseId: lease?.leaseId ?? '',
                },
        });
        if (!active || operation === 'lease.release') return;
        clearTimeout(expiry);
        const next = result.lease;
        const nextProof =
          next?.owned && next.leaseId && Date.parse(next.expiresAt) > Date.now()
            ? {
                tabId: tab.current,
                leaseId: next.leaseId,
                kind: 'user' as const,
              }
            : undefined;
        proofRef.current = nextProof;
        setProof(nextProof);
        setHolder(next?.holderName ?? '');
        setError(undefined);
        if (nextProof && next)
          expiry = setTimeout(
            () => {
              proofRef.current = undefined;
              setProof(undefined);
            },
            Math.max(0, Date.parse(next.expiresAt) - Date.now())
          );
      };
      const result = tail.then(task);
      tail = result.catch(error => {
        if (active) {
          proofRef.current = undefined;
          setProof(undefined);
          setError(error);
        }
      });
      return tail;
    };
    acquireRef.current = () => send('lease.acquire');
    send('lease.acquire').catch(() => {});
    const timer = setInterval(() => {
      if (proofRef.current) send('lease.renew').catch(() => {});
    }, 20000);
    const hide = () => {
      const lease = proofRef.current;
      proofRef.current = undefined;
      setProof(undefined);
      if (lease) send('lease.release', lease).catch(() => {});
    };
    const show = () => {
      send('lease.acquire').catch(() => {});
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(expiry);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      if (proofRef.current)
        send('lease.release', proofRef.current).catch(() => {});
      proofRef.current = undefined;
    };
  }, [api, projectId, reportId, enabled]);
  return { proof, holder, error, acquire: () => acquireRef.current() };
}

export type ReportCollectionName =
  | 'comments'
  | 'reviews'
  | 'exports'
  | 'shares'
  | 'revisions'
  | 'templates'
  | 'schedules'
  | 'occurrences'
  | 'scheduleRevisions';
/** Keep loaded historical pages while realtime refreshes the newest page. */
export function useReportCollection<T extends { id: string }>(
  api: ProjectReportApi,
  projectId: string,
  reportId: string,
  name: ReportCollectionName,
  first: T[] | undefined,
  nextCursor: string | null | undefined,
  scheduleId?: string
) {
  const [pages, setPages] = useState<{
    key: string;
    items: T[];
    next: string | null;
    cursors: string[];
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const busy = useRef(false);
  const key = `${projectId}:${reportId}:${name}:${scheduleId ?? ''}`;
  const view =
    name === 'occurrences'
      ? 'schedule_occurrences'
      : name === 'scheduleRevisions'
        ? 'schedule_revisions'
        : name === 'revisions'
          ? 'history'
          : name;
  const activeKey = useRef(key);
  activeKey.current = key;
  const current = pages?.key === key ? pages : undefined;
  const cursor = current ? current.next : nextCursor;
  const loadedCursors = JSON.stringify(current?.cursors ?? []);
  useEffect(() => {
    const cursors = JSON.parse(loadedCursors) as string[];
    if (!cursors.length) return;
    const controller = new AbortController();
    Promise.all(
      cursors.map(cursor =>
        api.query(
          {
            projectId,
            reportId: reportId || undefined,
            view,
            scheduleId,
            cursor,
            limit: 100,
          },
          controller.signal
        )
      )
    )
      .then(results => {
        if (controller.signal.aborted || activeKey.current !== key) return;
        const incoming = results.flatMap(
          result => (result[name] ?? []) as unknown as T[]
        );
        setPages(previous =>
          previous?.key === key
            ? {
                ...previous,
                items: [
                  ...new Map(
                    [...previous.items, ...incoming].map(item => [
                      item.id,
                      item,
                    ])
                  ).values(),
                ],
              }
            : previous
        );
      })
      .catch(error => {
        if (!controller.signal.aborted && activeKey.current === key)
          setError(error);
      });
    return () => controller.abort();
  }, [
    api,
    projectId,
    reportId,
    name,
    key,
    loadedCursors,
    first,
    view,
    scheduleId,
  ]);
  const items = [
    ...new Map(
      [...(current?.items ?? []), ...(first ?? [])].map(item => [item.id, item])
    ).values(),
  ];
  // Latest entries stay at the top; old pages retain their server order.
  const ordered = [
    ...(first ?? []),
    ...items.filter(item => !first?.some(entry => entry.id === item.id)),
  ];
  const loadMore = async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await api.query({
        projectId,
        reportId: reportId || undefined,
        view,
        scheduleId,
        cursor,
        limit: 100,
      });
      if (activeKey.current !== key) return;
      const incoming = (result[name] ?? []) as unknown as T[];
      setPages({
        key,
        items: [
          ...new Map(
            [...(current?.items ?? []), ...incoming].map(item => [
              item.id,
              item,
            ])
          ).values(),
        ],
        next: result.nextCursors?.[name] ?? null,
        cursors: [...(current?.cursors ?? []), cursor],
      });
    } catch (error) {
      if (activeKey.current === key) setError(error);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { items: ordered, pending, error, hasMore: !!cursor, loadMore };
}
