import { toast } from '@affine/component';
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import type { DragEvent, ReactNode } from 'react';
import { z } from 'zod';

const mime = 'application/x-localmind-native-resource';
const identity = z.object({
  workspaceId: z.string(),
  resourceId: z.string(),
  kind: z.enum(['file', 'office']),
});
export function dragNativeResource(
  event: DragEvent,
  resource: z.infer<typeof identity>
) {
  event.dataTransfer.setData(mime, JSON.stringify(resource));
  event.dataTransfer.effectAllowed = 'move';
}
export function NativeResourceDropTarget({
  folderId,
  children,
  disabled = false,
}: {
  folderId: string | null;
  children: ReactNode;
  disabled?: boolean;
}) {
  const resources = useService(WorkspaceResourcesService);
  const t = useI18n();
  return (
    <div
      style={{ display: 'contents' }}
      onDragOver={event => {
        if (!disabled && event.dataTransfer.types.includes(mime)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={event => {
        if (disabled || !event.dataTransfer.types.includes(mime)) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          const source = identity.parse(
            JSON.parse(event.dataTransfer.getData(mime))
          );
          resources
            .move(source, folderId)
            .catch(() =>
              toast(t['com.affine.localmind.project-files.operationFailed']())
            );
        } catch {
          toast(t['com.affine.localmind.project-files.operationFailed']());
        }
      }}
    >
      {children}
    </div>
  );
}
