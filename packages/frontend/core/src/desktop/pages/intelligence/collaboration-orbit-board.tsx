import { Button, Loading } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  copilotCollaborationGraphGetQuery,
  copilotCollaborationOrderDetailsQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { SidebarIcon } from '@blocksuite/icons/rc';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Relation } from './collaboration-graph-model';
import { CollaborationOrbit } from './collaboration-orbit';
import * as styles from './collaboration-orbit.css';
import { orbitStatusLabel } from './collaboration-orbit-labels';
import { buildOrbitModel, orderDirection } from './collaboration-orbit-model';
import type { WorkbenchCollaborationGraph } from './types';

type Edge = WorkbenchCollaborationGraph['edges'][number];
type OpenState = { id: string; pinned: boolean } | null;

function DetailContent({ relation }: { relation: Relation }) {
  const t = useI18n();
  const query = useQuery(
    relation.kind === 'draft'
      ? undefined
      : {
          query: copilotCollaborationOrderDetailsQuery,
          variables: { workOrderId: relation.id },
        },
    { suspense: false, shouldRetryOnError: false }
  );
  const details = query.data?.currentUser?.copilot.myWorkOrder;
  if (relation.kind === 'draft')
    return <p>{t['com.affine.localmind.workbench.v9.graphStatusDraft']()}</p>;
  if (query.isLoading) return <p role="status">{t['Loading']()}</p>;
  if (query.error)
    return (
      <div role="alert" className={styles.error}>
        {projectErrorMessage(query.error)}{' '}
        <Button onClick={() => void query.mutate()}>{t['Retry']()}</Button>
      </div>
    );
  if (!details)
    return (
      <p>{t['com.affine.localmind.workbench.v9.graphDetailsUnavailable']()}</p>
    );
  return (
    <div>
      {details.purpose && (
        <section>
          <h4>{t['com.affine.localmind.workbench.orbit.purpose']()}</h4>
          <p>{details.purpose}</p>
        </section>
      )}
      <section>
        <h4>{t['com.affine.localmind.workbench.orbit.requirements']()}</h4>
        {details.requirements.filter(item => item.required).length ? (
          <ul>
            {details.requirements
              .filter(item => item.required)
              .map(item => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  {item.instructions && <p>{item.instructions}</p>}
                </li>
              ))}
          </ul>
        ) : (
          <p>{t['com.affine.localmind.workbench.v9.graphNoOrders']()}</p>
        )}
      </section>
    </div>
  );
}

export function CollaborationOrbitBoard({
  projectFilter,
  onOpenRelation,
  onProjectsChange,
  workspaceExpanded = false,
  onExpandWorkspace,
}: {
  projectFilter: string;
  onOpenRelation: (relation: Edge) => void | Promise<void>;
  onProjectsChange?: (projects: Array<{ id: string; name: string }>) => void;
  workspaceExpanded?: boolean;
  onExpandWorkspace?: () => void;
}) {
  const t = useI18n();
  const [search, setSearch] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [open, setOpen] = useState<OpenState>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const anchor = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const dismissTimer = useRef<number | undefined>(undefined);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const query = useQuery(
    { query: copilotCollaborationGraphGetQuery },
    { suspense: false, shouldRetryOnError: false }
  );
  const refresh = useCallback(() => {
    setNow(Date.now());
    return query.mutate();
  }, [query]);
  useProjectRefresh(null, 'task', refresh);
  useEffect(() => {
    const reconcile = () => void refresh().catch(() => {});
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    return () => {
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
    };
  }, [refresh]);
  const graph = query.data?.currentUser?.copilot.myCollaborationGraph;
  const relationProjects = useMemo(() => {
    const projects = new Map<string, { id: string; name: string }>();
    for (const edge of graph?.edges ?? [])
      if (edge.project) projects.set(edge.project.id, edge.project);
    return [...projects.values()];
  }, [graph?.edges]);
  useEffect(
    () => onProjectsChange?.(relationProjects),
    [onProjectsChange, relationProjects]
  );
  const nextExpiry =
    graph?.edges.reduce<number | null>((next, edge) => {
      if (edge.kind !== 'draft' || !edge.expiresAt) return next;
      const expires = new Date(edge.expiresAt).getTime();
      return expires > now && (next === null || expires < next)
        ? expires
        : next;
    }, null) ?? null;
  useEffect(() => {
    if (nextExpiry === null) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        void query.mutate().catch(() => {});
      },
      Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now() + 1))
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry, query]);
  const liveGraph = useMemo(
    () =>
      graph
        ? {
            ...graph,
            edges: graph.edges.filter(
              edge =>
                edge.kind !== 'draft' ||
                (!!edge.expiresAt && new Date(edge.expiresAt).getTime() > now)
            ),
          }
        : null,
    [graph, now]
  );
  const model = useMemo(
    () => liveGraph && buildOrbitModel(liveGraph, projectFilter, search),
    [liveGraph, projectFilter, search]
  );
  const visiblePeopleCount =
    model?.people.filter(person => includeHistory || person.active.length > 0)
      .length ?? 0;
  const activeOrder = model?.relations
    .concat(model.drafts)
    .find(item => item.id === open?.id);
  const clearTimers = useCallback(() => {
    window.clearTimeout(previewTimer.current);
    window.clearTimeout(dismissTimer.current);
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const close = useCallback(
    (restoreFocus: boolean) => {
      clearTimers();
      const previousAnchor = anchor.current;
      setOpen(null);
      setPosition(null);
      if (restoreFocus)
        window.requestAnimationFrame(() => {
          if (previousAnchor?.isConnected)
            previousAnchor.focus({ preventScroll: true });
        });
    },
    [clearTimers]
  );
  const dismiss = useCallback(() => close(false), [close]);
  useEffect(() => {
    if (open && !activeOrder) close(false);
  }, [activeOrder, close, open]);
  useEffect(() => {
    close(false);
    setDraftsOpen(false);
  }, [projectFilter, search, close]);
  const openOrder = (order: Relation, button: HTMLButtonElement) => {
    clearTimers();
    anchor.current = button;
    setOpen({ id: order.id, pinned: true });
    setPosition(null);
  };
  const previewOrder = (order: Relation, button: HTMLButtonElement) => {
    clearTimers();
    if (open?.pinned) return;
    previewTimer.current = window.setTimeout(() => {
      if (!button.isConnected) return;
      anchor.current = button;
      setOpen({ id: order.id, pinned: false });
    }, 220);
  };
  const previewLeave = () => {
    clearTimers();
    if (!open?.pinned)
      dismissTimer.current = window.setTimeout(() => close(false), 260);
  };
  const openConversation = async (relation: Relation) => {
    if (pending.current.has(relation.id)) return;
    pending.current.add(relation.id);
    setPendingIds(new Set(pending.current));
    setOpenErrors(errors => ({ ...errors, [relation.id]: '' }));
    try {
      await onOpenRelation(relation);
    } catch (error) {
      setOpenErrors(errors => ({
        ...errors,
        [relation.id]: projectErrorMessage(error),
      }));
    } finally {
      pending.current.delete(relation.id);
      setPendingIds(new Set(pending.current));
    }
  };
  useLayoutEffect(() => {
    if (!activeOrder || !open || !anchor.current || !panel.current) return;
    const update = () => {
      if (!anchor.current?.isConnected || !panel.current) {
        close(false);
        return;
      }
      if (window.innerWidth <= 680) {
        setPosition({ left: 0, top: 0 });
        return;
      }
      const rect = anchor.current.getBoundingClientRect();
      const panelRect = panel.current.getBoundingClientRect();
      const width = panelRect.width;
      const height = panelRect.height;
      const gap = 14;
      const left =
        window.innerWidth - rect.right >= width + gap + 16
          ? rect.right + gap
          : rect.left >= width + gap + 16
            ? rect.left - width - gap
            : Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const top = Math.max(
        16,
        Math.min(
          rect.top + rect.height / 2 - height / 2,
          window.innerHeight - height - 16
        )
      );
      setPosition(previous =>
        previous?.left === left && previous.top === top
          ? previous
          : { left, top }
      );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('relationship-view-change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('relationship-view-change', update);
    };
  }, [activeOrder, close, open]);
  useEffect(() => {
    if (open?.pinned) closeButton.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (panel.current?.contains(event.target)) return;
      if (event.target.closest('[data-order-trigger], [data-draft-trigger]'))
        return;
      close(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onOutside, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onOutside, true);
    };
  }, [close, open]);

  if (query.isLoading && !graph)
    return (
      <div className={styles.notice}>
        <Loading size={28} /> {t['Loading']()}
      </div>
    );
  if (query.error && !graph)
    return (
      <div className={styles.notice} role="alert">
        {projectErrorMessage(query.error)}{' '}
        <Button onClick={() => void refresh()}>{t['Retry']()}</Button>
      </div>
    );
  if (!model) return null;
  return (
    <section
      className={styles.board}
      aria-label={t['com.affine.localmind.workbench.orbit.title']()}
    >
      <header className={styles.heading}>
        <div>
          <h2 className={styles.headingTitle}>
            {t['com.affine.localmind.workbench.orbit.title']()}
          </h2>
          <span className={styles.headingMeta}>
            {t['com.affine.localmind.workbench.orbit.summary']({
              people: String(visiblePeopleCount),
              orders: String(model.activeCount),
            })}
          </span>
        </div>
        <div className={styles.headingActions}>
          <input
            className={styles.search}
            type="search"
            aria-label={t['com.affine.localmind.workbench.orbit.search']()}
            placeholder={t['com.affine.localmind.workbench.orbit.search']()}
            value={search}
            onChange={event => setSearch(event.currentTarget.value)}
          />
          {!!search && !visiblePeopleCount && !model.drafts.length && (
            <button
              type="button"
              className={styles.action}
              onClick={() => setSearch('')}
            >
              {t['com.affine.localmind.workbench.orbit.clearSearch']()}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            aria-pressed={includeHistory}
            onClick={() => setIncludeHistory(value => !value)}
          >
            {t['com.affine.localmind.workbench.orbit.history']()}
          </button>
          {model.drafts.length > 0 && (
            <button
              type="button"
              className={styles.action}
              aria-expanded={draftsOpen}
              onClick={() => setDraftsOpen(value => !value)}
            >
              {t['com.affine.localmind.workbench.orbit.drafts']({
                count: String(model.drafts.length),
              })}
            </button>
          )}
          {onExpandWorkspace && !workspaceExpanded && (
            <button
              type="button"
              className={styles.action}
              onClick={onExpandWorkspace}
            >
              <SidebarIcon />{' '}
              {t['com.affine.localmind.workbench.v9.graphExpandWorkspace']()}
            </button>
          )}
        </div>
      </header>
      {query.error && (
        <div className={styles.notice} role="alert">
          {projectErrorMessage(query.error)}{' '}
          <Button onClick={() => void refresh()}>{t['Retry']()}</Button>
        </div>
      )}
      {graph?.truncated && (
        <div className={styles.notice} role="status">
          {t['com.affine.localmind.workbench.v9.graphTruncated']()}
        </div>
      )}
      <CollaborationOrbit
        key={`${projectFilter}:${search.trim().toLocaleLowerCase()}`}
        model={model}
        includeHistory={includeHistory}
        openId={open?.id ?? null}
        detailPinned={open?.pinned ?? false}
        onOpen={openOrder}
        onPreview={previewOrder}
        onPreviewLeave={previewLeave}
        onDismiss={dismiss}
      />
      {draftsOpen && model.drafts.length > 0 && (
        <div
          className={styles.draftPanel}
          role="dialog"
          aria-label={t['com.affine.localmind.workbench.orbit.draftPanel']()}
        >
          <div className={styles.popoverTop}>
            <strong>
              {t['com.affine.localmind.workbench.orbit.drafts']({
                count: String(model.drafts.length),
              })}
            </strong>
            <button
              type="button"
              className={styles.action}
              onClick={() => setDraftsOpen(false)}
              aria-label={t[
                'com.affine.localmind.workbench.orbit.closeDrafts'
              ]()}
            >
              ×
            </button>
          </div>
          {model.drafts.map(draft => (
            <button
              key={draft.id}
              data-draft-trigger
              type="button"
              className={styles.draftItem}
              onClick={event => openOrder(draft, event.currentTarget)}
            >
              <strong>{draft.label}</strong>
              <small>
                {draft.project?.name ??
                  t['com.affine.localmind.workbench.v9.graphWorkspaceSource']()}
              </small>
            </button>
          ))}
        </div>
      )}
      {activeOrder && open && (
        <div
          ref={panel}
          className={styles.popover}
          role="dialog"
          aria-modal="false"
          aria-label={activeOrder.label}
          data-preview={!open.pinned}
          style={
            position && window.innerWidth > 680
              ? ({ left: position.left, top: position.top } as CSSProperties)
              : undefined
          }
          onPointerEnter={clearTimers}
          onPointerLeave={previewLeave}
        >
          <div className={styles.popoverTop}>
            <span data-direction={orderDirection(activeOrder)}>
              {orbitStatusLabel(activeOrder.status, activeOrder.side, t)}
            </span>
            <button
              ref={closeButton}
              type="button"
              className={styles.action}
              aria-label={t[
                'com.affine.localmind.workbench.orbit.closeDetails'
              ]()}
              onClick={() => close(true)}
            >
              ×
            </button>
          </div>
          <h3>{activeOrder.label}</h3>
          <p className={styles.popoverMeta}>
            {orderDirection(activeOrder) === 'incoming'
              ? `${activeOrder.otherName} → ${t['com.affine.localmind.workbench.v9.graphSelf']()}`
              : `${t['com.affine.localmind.workbench.v9.graphSelf']()} → ${activeOrder.otherName}`}
            {' · '}
            {activeOrder.project?.name ??
              t['com.affine.localmind.workbench.v9.graphWorkspaceSource']()}
          </p>
          <div className={styles.popoverBody}>
            {!open.pinned ? (
              <>
                {activeOrder.requirementTitles.length > 0 && (
                  <p>{activeOrder.requirementTitles.join(' · ')}</p>
                )}
                <Button
                  onClick={() => setOpen({ id: activeOrder.id, pinned: true })}
                >
                  {t['com.affine.localmind.workbench.v9.graphShowDetails']()}
                </Button>
              </>
            ) : (
              <DetailContent key={activeOrder.id} relation={activeOrder} />
            )}
          </div>
          {open.pinned && (
            <div className={styles.popoverFooter}>
              <Button
                disabled={pendingIds.has(activeOrder.id)}
                aria-busy={pendingIds.has(activeOrder.id)}
                onClick={() => void openConversation(activeOrder)}
              >
                {t[
                  pendingIds.has(activeOrder.id)
                    ? 'com.affine.localmind.workbench.v9.graphOpeningConversation'
                    : activeOrder.ownConversationExists
                      ? 'com.affine.localmind.workbench.v9.graphOpenConversation'
                      : 'com.affine.localmind.workbench.v9.graphCreateConversation'
                ]()}
              </Button>
              {openErrors[activeOrder.id] && (
                <p role="alert" className={styles.error}>
                  {openErrors[activeOrder.id]}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
