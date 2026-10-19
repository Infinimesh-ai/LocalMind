import {
  CloseIcon,
  DeleteIcon,
  DeletePermanentlyIcon,
  ResetIcon,
} from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

import { FloatingToolbar } from './floating-toolbar';
import * as styles from './list-floating-toolbar.css';

export const ListFloatingToolbar = ({
  content,
  onClose,
  open,
  onDelete,
  onRestore,
  actions,
}: {
  open: boolean;
  content: ReactNode;
  onClose: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  /** Extra toolbar buttons shown before restore / delete. */
  actions?: ReactNode;
}) => {
  return (
    <FloatingToolbar className={styles.floatingToolbar} open={open}>
      <FloatingToolbar.Item>{content}</FloatingToolbar.Item>
      <FloatingToolbar.Button onClick={onClose} icon={<CloseIcon />} />
      {!!actions && (
        <>
          <FloatingToolbar.Separator />
          {actions}
        </>
      )}
      {(!!onRestore || !!onDelete) && <FloatingToolbar.Separator />}
      {!!onRestore && (
        <FloatingToolbar.Button
          onClick={onRestore}
          icon={<ResetIcon />}
          data-testid="list-toolbar-restore"
        />
      )}
      {!!onDelete && (
        <FloatingToolbar.Button
          onClick={onDelete}
          icon={onRestore ? <DeletePermanentlyIcon /> : <DeleteIcon />}
          type="danger"
          data-testid="list-toolbar-delete"
        />
      )}
    </FloatingToolbar>
  );
};
