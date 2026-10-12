import {
  PaneResizeHandle as SharedPaneResizeHandle,
  type PaneResizeHandleProps,
} from '@affine/core/components/pane-resize-handle';

import * as styles from './index.css';

export const PaneResizeHandle = (
  props: Omit<PaneResizeHandleProps, 'className'>
) => <SharedPaneResizeHandle {...props} className={styles.paneResizeHandle} />;
