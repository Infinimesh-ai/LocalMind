import { Scrollable } from '@affine/component';
import type { Notification } from '@affine/core/modules/notification';
import { Component, createRef, type ReactNode } from 'react';

import * as styles from './list.style.css';

type Props = {
  notifications: Notification[];
  mode: 'all' | 'unread';
  children: ReactNode;
};
type Snapshot = {
  anchor?: { id: string; offset: number };
  scrollTop: number;
  focusId?: string;
  restoreFocus: boolean;
} | null;

// Measure before React removes/reorders rows. A layout-effect cleanup is too late
// to reliably capture the focused button and the previous scroll anchor.
export class NotificationViewport extends Component<Props, object, Snapshot> {
  private readonly viewportRef = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(previous: Props): Snapshot {
    const viewport = this.viewportRef.current;
    if (!viewport || previous.notifications === this.props.notifications)
      return null;
    if (previous.mode !== this.props.mode) return null;
    const rows = [
      ...viewport.querySelectorAll<HTMLElement>('[data-notification-id]'),
    ];
    const nextIds = new Set(this.props.notifications.map(n => n.id));
    const top = viewport.getBoundingClientRect().top;
    const anchor = rows.find(
      row =>
        nextIds.has(row.dataset.notificationId ?? '') &&
        row.getBoundingClientRect().bottom > top
    );
    const active = viewport.ownerDocument.activeElement;
    const focusedIndex = rows.findIndex(row => row.contains(active));
    const focusedRow = rows[focusedIndex];
    const nextFocused = this.props.notifications.find(
      n => n.id === focusedRow?.dataset.notificationId
    );
    const restoreFocus =
      focusedIndex >= 0 &&
      (!nextFocused ||
        (nextFocused.read &&
          active instanceof HTMLElement &&
          active.dataset.notificationAction === 'read'));
    const focusRow = nextFocused
      ? focusedRow
      : (rows
          .slice(focusedIndex + 1)
          .find(row => nextIds.has(row.dataset.notificationId ?? '')) ??
        rows
          .slice(0, focusedIndex)
          .reverse()
          .find(row => nextIds.has(row.dataset.notificationId ?? '')));
    return {
      anchor:
        viewport.scrollTop > 0 && anchor?.dataset.notificationId
          ? {
              id: anchor.dataset.notificationId,
              offset: anchor.getBoundingClientRect().top - top,
            }
          : undefined,
      scrollTop: viewport.scrollTop,
      focusId: focusRow?.dataset.notificationId,
      restoreFocus,
    };
  }

  override componentDidUpdate(
    previous: Props,
    _state: object,
    snapshot: Snapshot
  ) {
    const viewport = this.viewportRef.current;
    if (!viewport) return;
    if (previous.mode !== this.props.mode) {
      viewport.scrollTop = 0;
      return;
    }
    if (!snapshot) return;
    const rows = [
      ...viewport.querySelectorAll<HTMLElement>('[data-notification-id]'),
    ];
    const anchor = rows.find(
      row => row.dataset.notificationId === snapshot.anchor?.id
    );
    viewport.scrollTop =
      anchor && snapshot.anchor
        ? viewport.scrollTop +
          anchor.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          snapshot.anchor.offset
        : snapshot.scrollTop;
    if (snapshot.restoreFocus) {
      const row = rows.find(
        row => row.dataset.notificationId === snapshot.focusId
      );
      const target =
        row?.querySelector<HTMLElement>('button:not(:disabled)') ??
        row ??
        viewport.parentElement?.parentElement?.querySelector<HTMLElement>(
          '[data-notification-heading]'
        );
      target?.focus({ preventScroll: true });
    }
  }

  override render() {
    return (
      <Scrollable.Viewport
        className={styles.scrollViewport}
        ref={this.viewportRef}
      >
        {this.props.children}
      </Scrollable.Viewport>
    );
  }
}
