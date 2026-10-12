import { notify } from '@affine/component';
import { CreatedResourceService } from '@affine/core/modules/navigation-panel';
import type { CreatedResource } from '@affine/core/modules/navigation-panel/services/created-resource';
import { useI18n } from '@affine/i18n';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import { useEffect, useState } from 'react';

import type { DocExplorerContextType } from '../explorer/context';

export function useCreatedResourceSelection(
  context: DocExplorerContextType,
  parentNodeId: string | null | undefined,
  workspaceId: string
) {
  const service = useServiceOptional(CreatedResourceService);
  const reveal = useLiveData(service?.reveal$);
  useEffect(() => {
    if (!reveal?.batch || reveal.parentNodeId !== parentNodeId) return;
    context.selectedDocIds$.next(
      reveal.resources.map(resource =>
        resource.kind === 'doc'
          ? resource.resourceId
          : `native:${workspaceId}:${resource.kind}:${resource.resourceId}`
      )
    );
    context.selectMode$?.next(true);
  }, [context, parentNodeId, workspaceId, reveal]);
}

export function useCreatedResourceNavigation() {
  const service = useService(CreatedResourceService);
  const t = useI18n();
  return () => {
    const origin = service.begin();
    return async (
      resources: CreatedResource[],
      options: { focusEditor?: boolean; batch?: boolean } = {}
    ) => {
      if (!origin.sameAccount() || !resources.length) return;
      const show = async () => {
        const current = service.begin();
        if (origin.sameAccount())
          await service.reveal(
            resources,
            current.isCurrent,
            options.focusEditor,
            options.batch
          );
      };
      try {
        if (
          await service.reveal(
            resources,
            origin.isCurrent,
            options.focusEditor,
            options.batch
          )
        )
          return;
      } catch {
        // Creation succeeded. Failure to locate it must never turn into a create retry.
      }
      if (origin.sameAccount())
        notify.success({
          title: t['com.affine.localmind.documentCreation.created'](),
          actions: [
            {
              key: 'view-created-resource',
              label: t['com.affine.ai-scroll-tip.view'](),
              onClick: show,
            },
          ],
        });
    };
  };
}

/** Focus a freshly created resource after it mounts and the creation modal closes. */
export function useCreatedResourceFocus(
  kind: string,
  resourceId: string,
  selector = '[data-created-resource-focus-target]:not([disabled]):not([readonly]):not([contenteditable="false"])'
) {
  const service = useServiceOptional(CreatedResourceService);
  const request = useLiveData(service?.editorFocus$);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (
      !element ||
      !service ||
      request?.kind !== kind ||
      request.resourceId !== resourceId
    )
      return;
    return focusCreatedResourceWhenReady(
      element,
      () => {
        const target = element.querySelector<HTMLElement>(selector);
        if (!target) return false;
        if (service.consumeEditorFocus(kind, resourceId))
          target.focus({ preventScroll: true });
        return true;
      },
      () => service.consumeEditorFocus(kind, resourceId)
    );
  }, [element, service, request, kind, resourceId, selector]);
  return setElement;
}

export function focusCreatedResourceWhenReady(
  element: HTMLElement,
  attempt: () => boolean,
  onCancel: () => void
) {
  let frame = 0;
  const focus = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (
        element.isConnected &&
        !document.querySelector('[role="dialog"][data-state="open"]') &&
        attempt()
      )
        dispose();
    });
  };
  const cancel = () => {
    onCancel();
    dispose();
  };
  const observer = new MutationObserver(focus);
  observer.observe(element, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  // Modal focus restoration happens outside the editor subtree.
  const modalObserver = new MutationObserver(focus);
  modalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  const dispose = () => {
    observer.disconnect();
    modalObserver.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', cancel);
    document.removeEventListener('keydown', cancel);
  };
  document.addEventListener('pointerdown', cancel, { once: true });
  document.addEventListener('keydown', cancel, { once: true });
  focus();
  return dispose;
}
