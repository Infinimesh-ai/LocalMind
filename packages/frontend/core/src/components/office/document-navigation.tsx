import { useI18n } from '@affine/i18n';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { PaneResizeHandle } from '../pane-resize-handle';
import * as styles from './document.css';

const WIDTH_KEY = 'localmind.office.document-navigation-width';
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 160;
const MAX_WIDTH = 360;

function readWidth() {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0)
      return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored));
  } catch {
    // Navigation remains usable when storage is unavailable.
  }
  return DEFAULT_WIDTH;
}

export function DocumentNavigation({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const i18n = useI18n();
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(readWidth);
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // A blocked or full store must not interrupt resizing.
    }
  }, [width]);

  return (
    <div
      ref={panelRef}
      className={styles.navigationPanel}
      hidden={!open}
      style={{ width }}
    >
      <aside
        id={id}
        className={styles.navigation}
        aria-label={i18n['com.affine.office.document-navigation']()}
        hidden={!open}
      >
        {children}
      </aside>
      {open ? (
        <PaneResizeHandle
          className={styles.navigationResizeHandle}
          label={i18n['com.affine.office.document-navigation']()}
          controls={id}
          testId="document-navigation-resize"
          getWidth={() =>
            panelRef.current?.getBoundingClientRect().width || width
          }
          getBounds={() => {
            const workspaceWidth =
              panelRef.current?.parentElement?.getBoundingClientRect().width;
            const max = workspaceWidth
              ? Math.min(MAX_WIDTH, Math.floor(workspaceWidth * 0.45))
              : MAX_WIDTH;
            return { min: Math.min(MIN_WIDTH, max), max };
          }}
          onChange={setWidth}
          onReset={() => setWidth(DEFAULT_WIDTH)}
        />
      ) : null}
    </div>
  );
}
