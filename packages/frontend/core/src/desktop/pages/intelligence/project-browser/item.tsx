import { useDraggable, useDropTarget } from '@affine/component';
import { ProjectResourceKind } from '@affine/graphql';
import {
  createContext,
  type CSSProperties,
  type MouseEvent,
  type PropsWithChildren,
  useContext,
} from 'react';

import type { ProjectFile } from '../project-files-data';
import type { FileChange } from './file-actions';

type ProjectDrag = {
  draggable: { type: 'project-resource'; projectId: string; file: ProjectFile };
  dropTarget: { resourceId: string };
};

export type BrowserItemContextValue = {
  selectedIds: ReadonlySet<string>;
  focusId: string | null;
  trash: boolean;
  pendingKeys: ReadonlySet<string>;
  /** Multi-select checkbox mode; drag and drop is disabled meanwhile. */
  readOnly: boolean;
  register: (file: ProjectFile, siblings: readonly ProjectFile[]) => void;
  onSelect: (file: ProjectFile, event: MouseEvent) => void;
  onOpen: (file: ProjectFile) => void;
  onMove: (file: ProjectFile, change: FileChange) => void;
  onFiles: (files: File[], parentId: string | null) => void;
};

export const BrowserItemContext = createContext<BrowserItemContextValue | null>(
  null
);

export const useBrowserItems = () => {
  const value = useContext(BrowserItemContext);
  if (!value) throw new Error('BrowserItem must be used inside a browser');
  return value;
};

export const ITEM_ATTRIBUTE = 'data-browser-item-id';

/**
 * One selectable file in any browser view: selection, open, drag to move and
 * drop to move/upload into folders. Keyboard handling lives on the view root.
 */
export function BrowserItem({
  file,
  siblings,
  className,
  style,
  open,
  level,
  expanded,
  children,
}: PropsWithChildren<{
  file: ProjectFile;
  siblings: readonly ProjectFile[];
  className: string;
  style?: CSSProperties;
  /** The folder is open in a column to the right. */
  open?: boolean;
  level?: number;
  expanded?: boolean;
}>) {
  const ctx = useBrowserItems();
  const { onMove } = ctx;
  ctx.register(file, siblings);
  const folder = file.kind === ProjectResourceKind.folder;
  const pending = ctx.pendingKeys.has(file.id);
  const { dragRef, dragging } = useDraggable<ProjectDrag>(
    () => ({
      data: { type: 'project-resource', projectId: file.projectId, file },
      canDrag: !pending && !ctx.trash && !ctx.readOnly,
    }),
    [file, pending, ctx.trash, ctx.readOnly]
  );
  const { dropTargetRef, draggedOver } = useDropTarget<ProjectDrag>(
    () => ({
      data: { resourceId: file.id },
      canDrop: ({ source }) =>
        folder &&
        !pending &&
        !ctx.trash &&
        !ctx.readOnly &&
        source.data.type === 'project-resource' &&
        source.data.projectId === file.projectId &&
        source.data.file.id !== file.id,
      onDrop: ({ source }) =>
        onMove(source.data.file, { parentId: file.id, beforeId: null }),
    }),
    [file, folder, pending, ctx.trash, ctx.readOnly, onMove]
  );
  const selected = ctx.selectedIds.has(file.id);
  return (
    <div
      ref={element => {
        dragRef.current = element;
        dropTargetRef.current = element;
      }}
      role="option"
      aria-selected={selected}
      aria-busy={pending}
      aria-level={level}
      aria-expanded={folder && expanded !== undefined ? expanded : undefined}
      tabIndex={ctx.focusId === file.id ? 0 : -1}
      className={className}
      style={style}
      title={file.title}
      {...{ [ITEM_ATTRIBUTE]: file.id }}
      data-project-resource-id={file.id}
      data-kind={file.kind}
      data-open={open}
      data-dragging={dragging}
      data-drop={draggedOver ? 'true' : undefined}
      onClick={event => ctx.onSelect(file, event)}
      onDoubleClick={() => ctx.onOpen(file)}
      onDragOver={event => {
        if (
          folder &&
          !ctx.trash &&
          !ctx.readOnly &&
          event.dataTransfer.types.includes('Files')
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={event => {
        if (
          folder &&
          !ctx.trash &&
          !ctx.readOnly &&
          event.dataTransfer.files.length
        ) {
          event.preventDefault();
          event.stopPropagation();
          ctx.onFiles(Array.from(event.dataTransfer.files), file.id);
        }
      }}
    >
      {children}
    </div>
  );
}
