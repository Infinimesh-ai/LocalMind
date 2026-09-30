import { Button, IconButton, Loading } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  copilotCollaborationGraphGetQuery,
  copilotCollaborationOrderDetailsQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  ArrowDownSmallIcon,
  ArrowRightSmallIcon,
  ExpandFullIcon,
  MinusIcon,
  PlusIcon,
  SidebarIcon,
} from '@blocksuite/icons/rc';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as styles from './collaboration-graph.css';
import { type GraphCamera, MAX_GRAPH_ZOOM } from './collaboration-graph-camera';
import { layoutRelations } from './collaboration-graph-layout';
import {
  GRAPH_HEIGHT,
  matchesOrderFilter,
  type OrderFilter,
  type OrderSummary,
  projectRelations,
  type Relation,
  type RelationGroup,
  relationTone,
} from './collaboration-graph-model';
import type { WorkbenchCollaborationGraph } from './types';
import { useCollaborationGraphCamera } from './use-collaboration-graph-camera';

type GraphEdge = WorkbenchCollaborationGraph['edges'][number];
type Selection = {
  relationId: string;
  requirementId: string | null;
  origin: 'graph' | 'list';
};
const initial = (value: string) => Array.from(value.trim())[0] ?? '?';

function statusLabel(
  status: string,
  side: Relation['side'],
  t: ReturnType<typeof useI18n>
) {
  switch (status) {
    case 'draft':
      return t['com.affine.localmind.workbench.v9.graphStatusDraft']();
    case 'open':
      return t[
        side === 'left'
          ? 'com.affine.localmind.workbench.v9.graphStatusWaiting'
          : 'com.affine.localmind.workbench.v9.graphStatusMyDelivery'
      ]();
    case 'waiting_sender':
      return t['com.affine.localmind.workbench.v9.graphStatusWaitingSender']();
    case 'validating':
      return t['com.affine.localmind.workbench.v9.graphStatusValidating']();
    case 'delivered':
      return t['com.affine.localmind.workbench.v9.workOrderStatusDelivered']();
    case 'adopted':
      return t['com.affine.localmind.workbench.v9.graphStatusAdopted']();
    case 'refused':
      return t['com.affine.localmind.workbench.v9.workOrderStatusRefused']();
    case 'cancelled':
      return t['com.affine.localmind.workbench.v9.workOrderStatusCancelled']();
    default:
      return status;
  }
}

function GraphCanvas({
  model,
  selection,
  onSelect,
  onPeer,
}: {
  model: ReturnType<typeof projectRelations>;
  selection: Selection | null;
  onSelect: (item: OrderSummary) => void;
  onPeer: (peer: RelationGroup) => void;
}) {
  const t = useI18n();
  const lastReveal = useRef<Selection | null>(null);
  const pendingLocate = useRef(false);
  const markerId = useId().replaceAll(':', '');
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(GRAPH_HEIGHT);
  const [measured, setMeasured] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const groups = model.groups.filter(group =>
    group.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  const layout = layoutRelations(groups, expandedKeys);
  const viewport = useCollaborationGraphCamera(
    width,
    height,
    layout.width,
    layout.height
  );
  const { host, reveal, setView } = viewport;
  const previous = useRef<{
    layout: ReturnType<typeof layoutRelations>;
    camera: GraphCamera;
  } | null>(null);
  const pendingAnchor = useRef<string | null>(null);
  const initialCameraSet = useRef(false);
  useLayoutEffect(() => {
    const before = previous.current;
    if (before && before.layout.signature !== layout.signature) {
      const key = pendingAnchor.current;
      const oldAnchor =
        before.layout.nodes.find(node => node.group.key === key) ??
        before.layout.self;
      const newAnchor =
        layout.nodes.find(node => node.group.key === key) ?? layout.self;
      setView(
        key && model.personCount === 1
          ? { ...before.camera, x: layout.width / 2, y: layout.self.y }
          : {
              ...before.camera,
              x: before.camera.x + newAnchor.x - oldAnchor.x,
              y: before.camera.y + newAnchor.y - oldAnchor.y,
            }
      );
      pendingAnchor.current = null;
    }
    previous.current = { layout, camera: viewport.camera };
  }, [layout, model.personCount, setView, viewport.camera]);
  const toggleGroup = (group: RelationGroup) => {
    pendingAnchor.current = group.key;
    setExpandedKeys(current => {
      const next = new Set(current);
      if (next.has(group.key)) next.delete(group.key);
      else next.add(group.key);
      return next;
    });
  };
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) setWidth(rect.width);
      if (rect?.height) setHeight(rect.height);
      if (rect?.width && rect.height) setMeasured(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [host]);
  useLayoutEffect(() => {
    if (!measured || initialCameraSet.current) return;
    // The parent may have just switched from its initial drawer to two columns.
    // Wait for the observer to measure that committed layout before fitting.
    const actualWidth = host.current?.getBoundingClientRect().width;
    if (actualWidth && Math.abs(actualWidth - width) > 1) return;
    initialCameraSet.current = true;
    setView({
      x: layout.width / 2,
      y: layout.height / 2,
      zoom: Math.min(1, width / layout.width),
    });
  }, [host, measured, width, layout.width, layout.height, setView]);
  const lines = layout.lines.map(line => {
    const selected =
      !!selection &&
      (line.node.expanded
        ? selection.relationId === line.item.relation.id
        : line.node.group.relations.some(
            relation => relation.id === selection.relationId
          ));
    return {
      ...line,
      selected,
      tone: selected
        ? 'selected'
        : line.node.expanded || line.node.group.items.length === 1
          ? relationTone(line.item.relation.status, line.item.relation.side)
          : 'neutral',
    };
  });
  useLayoutEffect(() => {
    if (
      !selection ||
      (!pendingLocate.current &&
        (selection.origin !== 'list' || lastReveal.current === selection))
    )
      return;
    const group = model.groups.find(value =>
      value.relations.some(relation => relation.id === selection.relationId)
    );
    if (!group) return;
    if (search || !expandedKeys.has(group.key)) {
      setSearch('');
      setExpandedKeys(current => new Set(current).add(group.key));
      return;
    }
    const line = layout.lines.find(
      value => value.item.relation.id === selection.relationId
    );
    if (!line) return;
    reveal(line.rect);
    lastReveal.current = selection;
    pendingLocate.current = false;
  }, [selection, model.groups, search, expandedKeys, layout.lines, reveal]);
  const revealLine = (line: (typeof lines)[number]) => reveal(line.rect);
  const directionLabel = (side: Relation['side']) =>
    t[
      side === 'left'
        ? 'com.affine.localmind.workbench.v9.graphIncomingLane'
        : 'com.affine.localmind.workbench.v9.graphOutgoingLane'
    ]();
  return (
    <div className={styles.canvas}>
      <div className={styles.graphToolbar}>
        <input
          className={styles.search}
          type="search"
          value={search}
          aria-label={t[
            'com.affine.localmind.workbench.v9.graphSearchPeople'
          ]()}
          placeholder={t[
            'com.affine.localmind.workbench.v9.graphSearchPeople'
          ]()}
          onChange={event => setSearch(event.target.value)}
        />
        <span className={styles.notice}>
          {t['com.affine.localmind.workbench.v9.graphPeopleCount']({
            count: String(new Set(groups.map(group => group.userId)).size),
          })}
          {' · '}
          {t['com.affine.localmind.workbench.v9.graphOrderCount']({
            count: String(
              groups.reduce((sum, group) => sum + group.items.length, 0)
            ),
          })}
        </span>
        {expandedKeys.size > 0 && (
          <Button onClick={() => setExpandedKeys(new Set())}>
            {t['com.affine.localmind.workbench.v9.graphCollapseAll']()}
          </Button>
        )}
      </div>
      <div className={styles.directionToolbar}>
        {(['left', 'right'] as const).map(side => {
          const sideNodes = layout.nodes.filter(
            node => node.group.side === side
          );
          return (
            <Button
              key={side}
              disabled={!sideNodes.length}
              onClick={() =>
                setView({
                  ...viewport.camera,
                  x: (sideNodes[0].x + layout.self.x) / 2,
                  y: layout.self.y,
                })
              }
            >
              {directionLabel(side)} · {sideNodes.length}
            </Button>
          );
        })}
      </div>
      <div
        className={styles.cameraToolbar}
        role="group"
        aria-label={t['com.affine.localmind.workbench.v9.graphViewControls']()}
      >
        <IconButton
          icon={<MinusIcon />}
          size={28}
          aria-label={t['com.affine.localmind.workbench.v9.graphZoomOut']()}
          disabled={
            groups.length === 0 ||
            viewport.camera.zoom <= viewport.minZoom + 0.001
          }
          onClick={() => viewport.zoomBy(1 / 1.2)}
        />
        <button
          type="button"
          className={styles.zoomValue}
          aria-label={t['com.affine.localmind.workbench.v9.graphResetZoom']()}
          title={t['com.affine.localmind.workbench.v9.graphResetZoom']()}
          disabled={groups.length === 0}
          onClick={() => viewport.zoomTo(1)}
        >
          {Math.round(viewport.camera.zoom * 100)}%
        </button>
        <IconButton
          icon={<PlusIcon />}
          size={28}
          aria-label={t['com.affine.localmind.workbench.v9.graphZoomIn']()}
          disabled={
            groups.length === 0 ||
            viewport.camera.zoom >= MAX_GRAPH_ZOOM - 0.001
          }
          onClick={() => viewport.zoomBy(1.2)}
        />
        <Button disabled={groups.length === 0} onClick={viewport.fit}>
          {t['com.affine.localmind.workbench.v9.graphFitView']()}
        </Button>
        <Button
          disabled={!selection}
          onClick={() => {
            pendingLocate.current = true;
            setExpandedKeys(current => new Set(current));
          }}
        >
          {t['com.affine.localmind.workbench.v9.graphLocateSelection']()}
        </Button>
      </div>
      <div
        ref={host}
        tabIndex={0}
        data-zoom={viewport.camera.zoom}
        data-camera-x={viewport.camera.x}
        data-camera-y={viewport.camera.y}
        {...viewport.handlers}
        className={styles.diagram}
        role="region"
        aria-label={t['com.affine.localmind.workbench.v9.graphKeyboardHint']()}
      >
        {groups.length === 0 ? (
          <p className={styles.noPeople}>
            {t['com.affine.localmind.workbench.v9.graphFilterEmpty']()}
          </p>
        ) : (
          <div
            className={styles.diagramWorld}
            data-graph-world="true"
            style={{
              width: layout.width,
              height: layout.height,
              transform: viewport.transform,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
              className={styles.lines}
            >
              <defs>
                {[
                  'incoming',
                  'outgoing',
                  'complete',
                  'muted',
                  'neutral',
                  'selected',
                ].map(tone => (
                  <marker
                    key={tone}
                    id={`${markerId}-${tone}`}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 1 1 L 9 5 L 1 9"
                      fill="none"
                      stroke={`var(--relation-${tone})`}
                      strokeWidth="1.5"
                    />
                  </marker>
                ))}
              </defs>
              {lines.map(line => (
                <g
                  key={line.item.id}
                  data-item-id={line.item.id}
                  data-active={line.selected}
                  stroke={`var(--relation-${line.tone})`}
                  strokeWidth={line.selected ? 2.4 : 1.2}
                  strokeDasharray={line.node.expanded ? '5 5' : undefined}
                  fill="none"
                >
                  <path d={line.connector.left} />
                  <path
                    d={line.connector.right}
                    markerEnd={`url(#${markerId}-${line.tone})`}
                  />
                </g>
              ))}
            </svg>
            <div
              className={styles.diagramContent}
              style={{ height: layout.height }}
            >
              {lines.map(line => (
                <div
                  key={line.item.id}
                  className={styles.labelGroup}
                  style={{
                    left: line.connector.x,
                    top: line.y,
                    width: layout.labelWidth,
                  }}
                >
                  <button
                    type="button"
                    className={styles.summary}
                    data-active={line.selected}
                    aria-pressed={line.selected}
                    data-relation-id={line.item.relation.id}
                    data-group-key={line.node.group.key}
                    title={line.item.title}
                    onFocus={event => {
                      if (event.currentTarget.matches(':focus-visible'))
                        revealLine(line);
                    }}
                    onClick={() => onSelect(line.item)}
                    aria-label={`${line.item.relation.recipientName} → ${line.item.relation.senderName} · ${line.item.title}`}
                  >
                    <span>{line.item.title}</span>
                  </button>
                  {!line.node.expanded && line.node.group.items.length > 1 && (
                    <button
                      type="button"
                      className={styles.expand}
                      aria-expanded={false}
                      aria-label={t[
                        'com.affine.localmind.workbench.v9.graphExpandPerson'
                      ]({
                        name: `${line.node.group.name} · ${directionLabel(line.node.group.side)}`,
                        count: String(line.node.group.items.length),
                      })}
                      onClick={() => toggleGroup(line.node.group)}
                    >
                      {t['com.affine.localmind.workbench.v9.graphItemCount']({
                        count: String(line.node.group.items.length),
                      })}
                      <ArrowDownSmallIcon />
                    </button>
                  )}
                </div>
              ))}
              <span
                className={styles.graphEnd}
                style={{ top: layout.height - 28 }}
              >
                {t['com.affine.localmind.workbench.v9.graphFiniteBoundary']()}
              </span>
            </div>
            <div
              className={styles.person}
              data-self="true"
              data-person-id={model.selfId}
              style={{ left: layout.self.x, top: layout.self.y }}
              title={model.selfName}
            >
              <span className={styles.nodeAvatar}>
                {initial(model.selfName)}
              </span>
              <strong>
                {t['com.affine.localmind.workbench.v9.graphSelf']()}
              </strong>
            </div>
            {layout.nodes.map(node => (
              <div key={node.group.key}>
                <button
                  key={node.group.key}
                  className={styles.person}
                  data-person-id={node.group.userId}
                  data-direction={node.group.side}
                  type="button"
                  style={{ left: node.x, top: node.y }}
                  title={node.group.name}
                  onFocus={event => {
                    if (event.currentTarget.matches(':focus-visible'))
                      reveal({
                        x: node.x - 48,
                        y: node.y - 24,
                        width: 96,
                        height: 84,
                      });
                  }}
                  onClick={() => onPeer(node.group)}
                  aria-label={t[
                    'com.affine.localmind.workbench.v9.graphPersonOrders'
                  ]({
                    name: `${node.group.name} · ${directionLabel(node.group.side)}`,
                  })}
                >
                  <span className={styles.nodeAvatar}>
                    {initial(node.group.name)}
                  </span>
                  <strong>{node.group.name}</strong>
                </button>
                {node.expanded && (
                  <button
                    type="button"
                    className={styles.collapseGroup}
                    style={{ left: node.x, top: node.y + 64 }}
                    aria-label={`${t['com.affine.localmind.workbench.v9.graphCollapseGroup']()} · ${node.group.name} · ${directionLabel(node.group.side)}`}
                    onClick={() => toggleGroup(node.group)}
                  >
                    {t[
                      'com.affine.localmind.workbench.v9.graphCollapseGroup'
                    ]()}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className={styles.graphFooter}>
        <span>
          {t['com.affine.localmind.workbench.v9.graphDeliveryHint']()}
          <br />
          <span className={styles.desktopPanHint}>
            {t['com.affine.localmind.workbench.v9.graphPanHint']()}
          </span>
          <span className={styles.touchPanHint}>
            {t['com.affine.localmind.workbench.v9.graphTouchHint']()}
          </span>
        </span>
      </footer>
    </div>
  );
}

function OrderDetails({ relation }: { relation: Relation }) {
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
    return <p className={styles.notice}>{relation.label}</p>;
  if (query.isLoading) return <p role="status">{t['Loading']()}</p>;
  if (query.error)
    return (
      <div role="alert" className={styles.openError}>
        {projectErrorMessage(query.error)}{' '}
        <Button onClick={() => void query.mutate()}>{t['Retry']()}</Button>
      </div>
    );
  if (!details)
    return (
      <p className={styles.notice}>
        {t['com.affine.localmind.workbench.v9.graphDetailsUnavailable']()}
      </p>
    );
  return (
    <div className={styles.orderDetails}>
      {details.purpose && <p>{details.purpose}</p>}
      <dl>
        {details.requirements
          .filter(item => item.required)
          .map(item => (
            <div key={item.id}>
              <dt>{item.title}</dt>
              <dd>{item.instructions}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

export function CollaborationGraph({
  projectFilter,
  onOpenRelation,
  onProjectsChange,
  workspaceExpanded = false,
  onExpandWorkspace,
}: {
  workspaceExpanded?: boolean;
  onExpandWorkspace?: () => void;
  projectFilter: string;
  onOpenRelation: (relation: GraphEdge) => void | Promise<void>;
  onProjectsChange?: (projects: Array<{ id: string; name: string }>) => void;
}) {
  const t = useI18n();
  const [listOpen, setListOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [detailIds, setDetailIds] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [peerFilter, setPeerFilter] = useState<{
    userId: string;
    side: Relation['side'];
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const listHeading = useRef<HTMLHeadingElement>(null);
  const listToggle = useRef<HTMLButtonElement>(null);
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
      Math.max(0, nextExpiry - Date.now() + 1)
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry, query]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(entries =>
      setCompact(
        (entries[0]?.contentRect.width ?? 0) < (workspaceExpanded ? 640 : 1040)
      )
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [graph, workspaceExpanded]);
  useEffect(() => {
    setSelection(null);
    setPeerFilter(null);
    setOrderFilter('all');
    setDetailIds(new Set());
  }, [projectFilter]);
  const model = useMemo(
    () =>
      graph
        ? projectRelations(
            {
              ...graph,
              edges: graph.edges.filter(
                edge =>
                  edge.kind !== 'draft' ||
                  (!!edge.expiresAt && new Date(edge.expiresAt).getTime() > now)
              ),
            },
            projectFilter
          )
        : null,
    [graph, now, projectFilter]
  );
  const visibleSelection = model?.relations.some(
    relation => relation.id === selection?.relationId
  )
    ? selection
    : null;
  const selectedPeer = model?.groups.find(
    group => group.userId === peerFilter?.userId
  );
  const peerRelations = (model?.relations ?? []).filter(
    relation => !peerFilter || relation.otherId === peerFilter.userId
  );
  const relationsForFilter = (filter: OrderFilter) =>
    peerRelations.filter(relation => {
      const side =
        filter === 'mine'
          ? 'right'
          : filter === 'theirs'
            ? 'left'
            : peerFilter?.side;
      return (
        (!side || relation.side === side) &&
        matchesOrderFilter(relation, filter)
      );
    });
  const listedRelations = relationsForFilter(orderFilter);
  const revealItem = useCallback((item: OrderSummary) => {
    setPeerFilter({ userId: item.relation.otherId, side: item.relation.side });
    setSelection({
      relationId: item.relation.id,
      requirementId: null,
      origin: 'graph',
    });
    setOrderFilter('all');
    setListOpen(true);
  }, []);
  useEffect(() => {
    if (visibleSelection?.origin !== 'graph' || (compact && !listOpen)) return;
    const card = cards.current.get(visibleSelection.relationId);
    card?.scrollIntoView?.({ block: 'nearest' });
    card?.focus({ preventScroll: true });
  }, [visibleSelection, compact, listOpen]);
  const selectOrder = (
    relation: Relation,
    requirementId: string | null = null
  ) => {
    setSelection({ relationId: relation.id, requirementId, origin: 'list' });
    if (compact) {
      setListOpen(false);
      listToggle.current?.focus();
    }
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
  if (query.isLoading && !graph)
    return (
      <div className={styles.state}>
        <Loading size={28} />
        <span>{t['Loading']()}</span>
      </div>
    );
  if (query.error && !graph)
    return (
      <div className={styles.state} role="alert">
        <span>{projectErrorMessage(query.error)}</span>
        <Button onClick={() => void refresh()}>{t['Retry']()}</Button>
      </div>
    );
  if (!graph || !model?.relations.length)
    return (
      <div className={styles.state}>
        <span>
          {t[
            graph?.edges.length
              ? 'com.affine.localmind.workbench.v9.graphFilterEmpty'
              : 'com.affine.localmind.workbench.v9.graphEmpty'
          ]()}
        </span>
        {graph?.truncated && (
          <span>{t['com.affine.localmind.workbench.v9.graphTruncated']()}</span>
        )}
      </div>
    );
  return (
    <div
      ref={root}
      className={styles.root}
      data-compact={compact}
      data-enlarged={enlarged}
    >
      <div className={styles.graphArea}>
        <div className={styles.topBar}>
          <strong>{t['com.affine.localmind.workbench.v9.graphTitle']()}</strong>
          <div className={styles.graphActions}>
            <Button
              aria-pressed={enlarged}
              onClick={() => {
                setEnlarged(value => !value);
                if (!enlarged) {
                  onExpandWorkspace?.();
                  window.requestAnimationFrame(() =>
                    root.current?.scrollIntoView?.({ block: 'start' })
                  );
                }
              }}
            >
              <ExpandFullIcon />
              {t[
                enlarged
                  ? 'com.affine.localmind.workbench.v9.graphReduceView'
                  : 'com.affine.localmind.workbench.v9.graphEnlargeView'
              ]()}
            </Button>
            {compact && (
              <Button
                ref={listToggle}
                onClick={() => setListOpen(true)}
                aria-expanded={listOpen}
                aria-controls="relation-list-panel"
              >
                <SidebarIcon />
                {t['com.affine.localmind.workbench.v9.relationList']()} ·{' '}
                {model.relations.length}
              </Button>
            )}
          </div>
        </div>
        <GraphCanvas
          key={projectFilter}
          model={model}
          selection={visibleSelection}
          onSelect={revealItem}
          onPeer={peer => {
            setPeerFilter({ userId: peer.userId, side: peer.side });
            setOrderFilter('all');
            setSelection(null);
            setListOpen(true);
            window.requestAnimationFrame(() => listHeading.current?.focus());
          }}
        />
      </div>
      <section
        id="relation-list-panel"
        className={styles.list}
        data-open={!compact || listOpen}
        aria-labelledby="relation-list-title"
        hidden={compact && !listOpen}
        onKeyDown={event => {
          if (event.key === 'Escape' && compact) {
            setListOpen(false);
            listToggle.current?.focus();
          }
        }}
      >
        <div className={styles.listHeader}>
          <h2 ref={listHeading} tabIndex={-1} id="relation-list-title">
            {t['com.affine.localmind.workbench.v9.relationList']()} ·{' '}
            {t['com.affine.localmind.workbench.v9.graphOrderCount']({
              count: String(listedRelations.length),
            })}
          </h2>
          {compact && (
            <IconButton
              size="24"
              icon={<SidebarIcon />}
              aria-label={t[
                'com.affine.localmind.workbench.v9.collapseRelationList'
              ]()}
              onClick={() => {
                setListOpen(false);
                listToggle.current?.focus();
              }}
            />
          )}
        </div>
        {selectedPeer && (
          <div className={styles.filterBar}>
            <span>
              {peerFilter?.side === 'left'
                ? `${selectedPeer.name} → ${t['com.affine.localmind.workbench.v9.graphSelf']()}`
                : `${t['com.affine.localmind.workbench.v9.graphSelf']()} → ${selectedPeer.name}`}
            </span>
            <Button
              onClick={() => {
                setPeerFilter(null);
                setSelection(null);
              }}
            >
              {t['com.affine.localmind.workbench.v9.graphClearFilter']()}
            </Button>
          </div>
        )}
        <div
          className={styles.orderFilters}
          role="group"
          aria-label={t[
            'com.affine.localmind.workbench.v9.graphFilterOrders'
          ]()}
        >
          {(['all', 'mine', 'theirs', 'ended'] as const).map(filter => (
            <button
              key={filter}
              type="button"
              aria-pressed={orderFilter === filter}
              onClick={() => {
                setOrderFilter(filter);
                if (peerFilter && (filter === 'mine' || filter === 'theirs'))
                  setPeerFilter({
                    ...peerFilter,
                    side: filter === 'mine' ? 'right' : 'left',
                  });
                setSelection(null);
              }}
            >
              {t[
                {
                  all: 'com.affine.localmind.workbench.v9.graphFilterAll',
                  mine: 'com.affine.localmind.workbench.v9.graphFilterMine',
                  theirs: 'com.affine.localmind.workbench.v9.graphFilterTheirs',
                  ended: 'com.affine.localmind.workbench.v9.graphFilterEnded',
                }[filter] as 'com.affine.localmind.workbench.v9.graphFilterAll'
              ]()}
              <span>{relationsForFilter(filter).length}</span>
            </button>
          ))}
        </div>
        {listedRelations.length === 0 && (
          <p className={styles.notice}>
            {t['com.affine.localmind.workbench.v9.graphNoOrders']()}
          </p>
        )}
        {query.error && (
          <div role="alert" className={styles.notice}>
            {projectErrorMessage(query.error)}
            <Button onClick={() => void refresh()}>{t['Retry']()}</Button>
          </div>
        )}
        <ul id="relation-list-items">
          {listedRelations.map(relation => {
            const active = visibleSelection?.relationId === relation.id;
            const status = statusLabel(relation.status, relation.side, t);
            const opening = pendingIds.has(relation.id);
            const detailsOpen = detailIds.has(relation.id);
            return (
              <li
                key={relation.id}
                className={styles.order}
                data-active={active}
                tabIndex={-1}
                ref={element => {
                  if (element) cards.current.set(relation.id, element);
                  else cards.current.delete(relation.id);
                }}
              >
                <div className={styles.orderHeader}>
                  <span
                    className={styles.orderStatus}
                    data-tone={relationTone(relation.status, relation.side)}
                  >
                    {status}
                  </span>
                  <Button
                    className={styles.openConversation}
                    disabled={opening}
                    aria-busy={opening}
                    aria-label={`${t[relation.ownConversationExists ? 'com.affine.localmind.workbench.v9.graphOpenConversation' : 'com.affine.localmind.workbench.v9.graphCreateConversation']()} · ${relation.label}`}
                    onClick={() => void openConversation(relation)}
                  >
                    {t[
                      opening
                        ? 'com.affine.localmind.workbench.v9.graphOpeningConversation'
                        : relation.ownConversationExists
                          ? 'com.affine.localmind.workbench.v9.graphOpenConversation'
                          : 'com.affine.localmind.workbench.v9.graphCreateConversation'
                    ]()}
                    <ArrowRightSmallIcon />
                  </Button>
                </div>
                <button
                  type="button"
                  className={styles.orderSummary}
                  aria-pressed={active}
                  onClick={() => selectOrder(relation)}
                  title={relation.label}
                >
                  <strong>{relation.label}</strong>
                  <span className={styles.orderMeta}>
                    {relation.deliveryFrom === model.selfId
                      ? t['com.affine.localmind.workbench.v9.graphSelf']()
                      : relation.recipientName}
                    {' → '}
                    {relation.deliveryTo === model.selfId
                      ? t['com.affine.localmind.workbench.v9.graphSelf']()
                      : relation.senderName}
                    {' · '}
                    {relation.project?.name ??
                      t[
                        'com.affine.localmind.workbench.v9.graphWorkspaceSource'
                      ]()}
                  </span>
                </button>
                {relation.requirementItems.length > 0 && (
                  <ul className={styles.requirements}>
                    {relation.requirementItems.map(item => (
                      <li
                        key={item.id}
                        data-active={
                          active &&
                          (visibleSelection?.requirementId === null ||
                            visibleSelection?.requirementId === item.id)
                        }
                      >
                        <button
                          type="button"
                          data-list-requirement-id={item.id}
                          aria-pressed={
                            active &&
                            (visibleSelection?.requirementId === null ||
                              visibleSelection?.requirementId === item.id)
                          }
                          onClick={() => selectOrder(relation, item.id)}
                        >
                          <span className={styles.requirementKind}>
                            {t[
                              item.kind === 'file'
                                ? 'com.affine.localmind.workbench.v9.graphFileItem'
                                : 'com.affine.localmind.workbench.v9.graphTextItem'
                            ]()}
                          </span>
                          <span>{item.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={styles.detailsToggle}
                  aria-expanded={detailsOpen}
                  aria-controls={`order-details-${relation.id}`}
                  onClick={() =>
                    setDetailIds(previous => {
                      const next = new Set(previous);
                      if (next.has(relation.id)) next.delete(relation.id);
                      else next.add(relation.id);
                      return next;
                    })
                  }
                >
                  {t[
                    detailsOpen
                      ? 'com.affine.localmind.workbench.v9.graphHideDetails'
                      : 'com.affine.localmind.workbench.v9.graphShowDetails'
                  ]()}
                  <ArrowDownSmallIcon />
                </button>
                {detailsOpen && (
                  <div id={`order-details-${relation.id}`}>
                    <OrderDetails relation={relation} />
                  </div>
                )}
                {openErrors[relation.id] && (
                  <p role="alert" className={styles.openError}>
                    {openErrors[relation.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {graph.truncated && (
        <p role="status" className={styles.truncation}>
          {t['com.affine.localmind.workbench.v9.graphTruncated']()}
        </p>
      )}
    </div>
  );
}
