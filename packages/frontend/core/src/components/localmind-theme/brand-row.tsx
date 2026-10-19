import type { ReactNode } from 'react';

import * as styles from './brand-row.css';

/** LOCALMIND brand row at the top of the workspace sidebar. */
export const LocalmindBrandRow = ({ children }: { children?: ReactNode }) => (
  <div className={styles.brandRow}>
    <span className={styles.brand}>LOCALMIND</span>
    {children}
  </div>
);
