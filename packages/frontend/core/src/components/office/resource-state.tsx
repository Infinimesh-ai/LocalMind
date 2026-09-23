import type { ReactNode } from 'react';

import * as styles from './document.css';
export function CenterState({
  children,
  alert = false,
}: {
  children: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={styles.centerState} role={alert ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
