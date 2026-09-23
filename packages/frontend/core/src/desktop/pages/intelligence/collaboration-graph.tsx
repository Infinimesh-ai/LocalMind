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
import { MinusIcon, PlusIcon } from '@blocksuite/icons/rc';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Doc as YDoc } from 'yjs';

import * as styles from './collaboration-graph.css';
import type { WorkbenchConversationCard } from './types';

type CollaborationGraphProps = {
  cards: WorkbenchConversationCard[];
  onOpenCard: (card: WorkbenchConversationCard) => void;
};

type Position = { x: number; y: number };

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
};

function layoutNodes(ids: string[], selfId: string | undefined) {
  const result = new Map<string, Position>();
  const center = { x: 450, y: 280 };
  if (selfId) result.set(selfId, center);
  const others = ids.filter(id => id !== selfId);
  const radius = Math.max(150, Math.min(245, 92 + others.length * 7));
  others.forEach((id, index) => {
    const angle =
      (Math.PI * 2 * index) / Math.max(others.length, 1) - Math.PI / 2;
    result.set(id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });
  return result;
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
  const positions = useMemo(
    () =>
      layoutNodes(
        nodes.map(node => node.id),
        nodes.find(node => node.self)?.id
      ),
    [nodes]
  );

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
    const elementIds = new Map<string, string>();
    for (const node of nodes) {
      const point = positions.get(node.id);
      if (!point) continue;
      const elementId = surface.addElement({
        type: 'shape',
        xywh: `[${point.x - 70},${point.y - 28},140,56]`,
        text: node.label.slice(0, 42),
        shapeType: node.self ? 'ellipse' : 'rect',
        radius: node.self ? 0 : 0.12,
        filled: node.self,
        // `shapeTextColor` is intentionally pure black in the editor palette.
        // This read-only projection follows the app theme instead.
        color: DefaultTheme.black,
      });
      elementIds.set(node.id, elementId);
    }
    for (const edge of edges) {
      const source = elementIds.get(edge.from);
      const target = elementIds.get(edge.to);
      if (!source || !target) continue;
      surface.addElement({
        type: 'connector',
        source: { id: source },
        target: { id: target },
        rearEndpointStyle: 'Arrow',
        text: edge.label.slice(0, 64),
      });
    }
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
    const subscription = controller.viewport.viewportUpdated.subscribe(value =>
      setZoom(value.zoom)
    );
    const frame = requestAnimationFrame(() => {
      controller.viewport.onResize();
      const bound = controller.elementsBound;
      if (bound)
        controller.viewport.setViewportByBound(bound, [48, 48, 48, 48]);
      setZoom(controller.viewport.zoom);
    });
    return () => {
      cancelAnimationFrame(frame);
      subscription.unsubscribe();
      if (gfx.current === controller) gfx.current = null;
      mountPoint.replaceChildren();
      collection.dispose();
      root.destroy();
    };
  }, [edges, nodes, positions]);

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
    const bound = controller.elementsBound;
    if (bound)
      controller.viewport.setViewportByBound(bound, [48, 48, 48, 48], true);
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
    </div>
  );
}

export function CollaborationGraph({
  cards,
  onOpenCard,
}: CollaborationGraphProps) {
  const t = useI18n();
  const query = useQuery(
    { query: copilotCollaborationGraphGetQuery },
    { suspense: false, shouldRetryOnError: false }
  );
  const graph = query.data?.currentUser?.copilot.myCollaborationGraph;
  const openEdge = (sessionId: string | null, workOrderId: string | null) => {
    const card = cards.find(
      candidate =>
        (!!sessionId && candidate.sessionId === sessionId) ||
        (!!workOrderId && candidate.workOrderId === workOrderId)
    );
    if (card) onOpenCard(card);
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
  if (!graph?.edges.length)
    return (
      <div className={styles.state}>
        {t['com.affine.localmind.workbench.v9.graphEmpty']()}
      </div>
    );

  return (
    <div className={styles.root}>
      <CollaborationGfxCanvas nodes={graph.nodes} edges={graph.edges} />
      <section className={styles.list} aria-labelledby="relation-list-title">
        <h2 id="relation-list-title">
          {t['com.affine.localmind.workbench.v9.relationList']()}
        </h2>
        {graph.truncated ? (
          <p className={styles.notice}>
            {t['com.affine.localmind.workbench.v9.graphTruncated']()}
          </p>
        ) : null}
        <ul>
          {graph.edges.map(edge => (
            <li key={edge.id}>
              <button
                type="button"
                onClick={() => openEdge(edge.ownSessionId, edge.ownWorkOrderId)}
              >
                <strong>{edge.label}</strong>
                <span>{edge.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
