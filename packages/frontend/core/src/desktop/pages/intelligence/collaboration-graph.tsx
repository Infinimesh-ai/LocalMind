import { Button, IconButton, Loading } from '@affine/component';
import { getViewManager } from '@affine/core/blocksuite/manager/view';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { WorkspaceImpl } from '@affine/core/modules/workspace/impls/workspace';
import { copilotCollaborationGraphGetQuery } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type { SurfaceBlockModel } from '@blocksuite/affine/blocks/surface';
import { DefaultTheme } from '@blocksuite/affine/model';
import { BlockStdScope } from '@blocksuite/affine/std';
import {
  type GfxController,
  GfxControllerIdentifier,
} from '@blocksuite/affine/std/gfx';
import { Point } from '@blocksuite/global/gfx';
import { MinusIcon, PlusIcon, SidebarIcon } from '@blocksuite/icons/rc';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Doc as YDoc } from 'yjs';

import * as styles from './collaboration-graph.css';
import type { WorkbenchConversationCard } from './types';

type CollaborationGraphProps = {
  cards: WorkbenchConversationCard[];
  projectFilter: string;
  onOpenCard: (card: WorkbenchConversationCard) => void;
  onOpenRelation: (
    sessionId: string | null,
    workOrderId: string | null,
    projectId: string | null
  ) => void;
};

type GraphNode = {
  id: string;
  label: string;
  self: boolean;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  project: { id: string; name: string } | null;
  status: string;
};

function fitGraph(controller: GfxController, animated = false) {
  const bound = controller.elementsBound;
  if (!bound) return;
  controller.viewport.setViewportByBound(bound, [48, 48, 48, 48], animated);
  const boundedZoom = Math.max(0.25, Math.min(2, controller.viewport.zoom));
  if (boundedZoom !== controller.viewport.zoom)
    controller.viewport.setZoom(boundedZoom, undefined, animated);
}

function CollaborationGfxCanvas({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const t = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const gfx = useRef<GfxController | null>(null);
  const [zoom, setZoom] = useState(1);
  const personalWorkOrderLabel =
    t['com.affine.localmind.workbench.v9.personalWorkOrder']();

  useEffect(() => {
    const mountPoint = container.current;
    if (!mountPoint) return;
    const root = new YDoc({ guid: `work-order-graph:${nanoid()}` });
    const collection = new WorkspaceImpl({
      id: `work-order-graph:${nanoid()}`,
      rootDoc: root,
    });
    collection.meta.initialize();
    const store = collection.createDoc('doc:collaboration-graph').getStore();
    store.load();
    const rootId = store.addBlock('affine:page', {});
    const surfaceId = store.addBlock('affine:surface', {}, rootId);
    const surface = store.getModelById(surfaceId) as SurfaceBlockModel;
    const people = new Map(nodes.map(node => [node.id, node]));
    edges.forEach((edge, index) => {
      const sender = people.get(edge.from);
      const recipient = people.get(edge.to);
      if (!sender || !recipient) return;
      const y = 48 + index * 112;
      const addShape = (
        x: number,
        width: number,
        text: string,
        self: boolean
      ) =>
        surface.addElement({
          type: 'shape',
          xywh: `[${x},${y},${width},68]`,
          text,
          shapeType: self ? 'ellipse' : 'rect',
          radius: self ? 0 : 0.12,
          filled: false,
          color: DefaultTheme.black,
        });
      const source = addShape(24, 152, sender.label.slice(0, 32), sender.self);
      const task = addShape(
        260,
        288,
        `${edge.project?.name ?? personalWorkOrderLabel}\n${edge.label}`.slice(
          0,
          100
        ),
        false
      );
      const target = addShape(
        632,
        152,
        recipient.label.slice(0, 32),
        recipient.self
      );
      surface.addElement({
        type: 'connector',
        source: { id: source },
        target: { id: task },
      });
      surface.addElement({
        type: 'connector',
        source: { id: task },
        target: { id: target },
        rearEndpointStyle: 'Arrow',
      });
    });
    store.resetHistory();
    // The graph is an ephemeral projection. Readonly is enforced by BlockSuite's
    // store and selects the pan tool; hiding editing chrome is only secondary UI.
    store.readonly = true;
    const std = new BlockStdScope({
      store,
      extensions: getViewManager().config.init().value.get('edgeless'),
    });
    mountPoint.replaceChildren(std.render());
    const controller = std.get(GfxControllerIdentifier);
    gfx.current = controller;
    const zoomAtPointer = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = mountPoint.getBoundingClientRect();
      const [x, y] = controller.viewport.toModelCoord(
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      const nextZoom = Math.max(
        0.25,
        Math.min(2, controller.viewport.zoom * Math.exp(-event.deltaY * 0.001))
      );
      controller.viewport.setZoom(nextZoom, new Point(x, y), true);
    };
    mountPoint.addEventListener('wheel', zoomAtPointer, {
      capture: true,
      passive: false,
    });
    const subscription = controller.viewport.viewportUpdated.subscribe(value =>
      setZoom(value.zoom)
    );
    const frame = requestAnimationFrame(() => {
      controller.viewport.onResize();
      fitGraph(controller);
      setZoom(controller.viewport.zoom);
    });
    const resizeObserver = new ResizeObserver(() => {
      controller.viewport.onResize();
      fitGraph(controller);
    });
    resizeObserver.observe(mountPoint);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mountPoint.removeEventListener('wheel', zoomAtPointer, true);
      subscription.unsubscribe();
      if (gfx.current === controller) gfx.current = null;
      mountPoint.replaceChildren();
      collection.dispose();
      root.destroy();
    };
  }, [edges, nodes, personalWorkOrderLabel]);

  const changeZoom = useCallback((delta: number) => {
    const controller = gfx.current;
    if (!controller) return;
    controller.viewport.setZoom(
      Math.max(0.25, Math.min(2, controller.viewport.zoom + delta)),
      undefined,
      true
    );
  }, []);

  const fit = useCallback(() => {
    const controller = gfx.current;
    if (!controller) return;
    fitGraph(controller, true);
  }, []);

  return (
    <div className={styles.canvas} data-testid="collaboration-gfx-canvas">
      <div className={styles.zoomControls}>
        <IconButton
          size="20"
          icon={<MinusIcon />}
          aria-label={t['com.affine.localmind.workbench.v9.zoomOut']()}
          onClick={() => changeZoom(-0.1)}
        />
        <button type="button" className={styles.zoomValue} onClick={fit}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          size="20"
          icon={<PlusIcon />}
          aria-label={t['com.affine.localmind.workbench.v9.zoomIn']()}
          onClick={() => changeZoom(0.1)}
        />
      </div>
      <div
        ref={container}
        className={styles.gfxHost}
        role="img"
        aria-label={t['com.affine.localmind.workbench.v9.relations']()}
      />
      <span className={styles.panHint}>
        {t['com.affine.localmind.workbench.v9.graphPanHint']()}
      </span>
    </div>
  );
}

export function CollaborationGraph({
  cards,
  projectFilter,
  onOpenCard,
  onOpenRelation,
}: CollaborationGraphProps) {
  const t = useI18n();
  const [listCollapsed, setListCollapsed] = useState(false);
  const query = useQuery(
    { query: copilotCollaborationGraphGetQuery },
    { suspense: false, shouldRetryOnError: false }
  );
  const graph = query.data?.currentUser?.copilot.myCollaborationGraph;
  const statusLabels: Record<string, string> = {
    open: t['com.affine.localmind.workbench.v9.workOrderStatusOpen'](),
    delivered:
      t['com.affine.localmind.workbench.v9.workOrderStatusDelivered'](),
    refused: t['com.affine.localmind.workbench.v9.workOrderStatusRefused'](),
    cancelled:
      t['com.affine.localmind.workbench.v9.workOrderStatusCancelled'](),
  };
  const visibleEdges = useMemo(
    () =>
      graph?.edges.filter(edge =>
        projectFilter === 'work_order'
          ? graph.nodes.some(node => node.self && node.id === edge.to)
          : projectFilter
            ? edge.project?.id === projectFilter
            : true
      ) ?? [],
    [graph, projectFilter]
  );
  const openEdge = (
    sessionId: string | null,
    workOrderId: string | null,
    projectId: string | null
  ) => {
    const card = cards.find(
      candidate =>
        (!!sessionId && candidate.sessionId === sessionId) ||
        (!!workOrderId && candidate.workOrderId === workOrderId)
    );
    if (card) onOpenCard(card);
    else onOpenRelation(sessionId, workOrderId, projectId);
  };
  if (query.isLoading)
    return (
      <div className={styles.state}>
        <Loading size={28} />
      </div>
    );
  if (query.error)
    return (
      <div className={styles.state} role="alert">
        <span>{projectErrorMessage(query.error)}</span>
        <Button onClick={() => void query.mutate()}>{t['Retry']()}</Button>
      </div>
    );
  if (!graph || !visibleEdges.length)
    return (
      <div className={styles.state}>
        {t['com.affine.localmind.workbench.v9.graphEmpty']()}
        {graph?.truncated ? (
          <span>{t['com.affine.localmind.workbench.v9.graphTruncated']()}</span>
        ) : null}
      </div>
    );

  return (
    <div
      className={`${styles.root} ${listCollapsed ? styles.rootCollapsed : ''}`}
      data-list-collapsed={listCollapsed}
    >
      <CollaborationGfxCanvas nodes={graph.nodes} edges={visibleEdges} />
      <section
        className={`${styles.list} ${listCollapsed ? styles.listCollapsed : ''}`}
        aria-labelledby="relation-list-title"
      >
        <div
          className={`${styles.listHeader} ${listCollapsed ? styles.listHeaderCollapsed : ''}`}
        >
          <h2 id="relation-list-title">
            {t['com.affine.localmind.workbench.v9.relationList']()}
          </h2>
          <IconButton
            size="20"
            icon={<SidebarIcon />}
            className={styles.listToggle}
            aria-label={
              listCollapsed
                ? t['com.affine.localmind.workbench.v9.expandRelationList']()
                : t['com.affine.localmind.workbench.v9.collapseRelationList']()
            }
            aria-expanded={!listCollapsed}
            aria-controls="relation-list-items"
            onClick={() => setListCollapsed(value => !value)}
          />
        </div>
        {!listCollapsed && graph.truncated ? (
          <p className={styles.notice}>
            {t['com.affine.localmind.workbench.v9.graphTruncated']()}
          </p>
        ) : null}
        <ul id="relation-list-items" hidden={listCollapsed}>
          {visibleEdges.map(edge => (
            <li key={edge.id}>
              <button
                type="button"
                onClick={() =>
                  openEdge(
                    edge.ownSessionId,
                    edge.ownWorkOrderId,
                    edge.project?.id ?? null
                  )
                }
              >
                <span>
                  {edge.project?.name ??
                    t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
                </span>
                <strong>{edge.label}</strong>
                <span>
                  {graph.nodes.find(node => node.id === edge.from)?.label} →{' '}
                  {graph.nodes.find(node => node.id === edge.to)?.label}
                </span>
                <span>{statusLabels[edge.status] ?? edge.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
