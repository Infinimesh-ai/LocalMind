import { RadioGroup, type RadioItem } from '@affine/component';
import { useLocalmindShell } from '@affine/core/components/localmind-theme';
import track from '@affine/track';
import { useCallback } from 'react';

import {
  type DocListItemView,
  DocListViewIcon,
} from '../docs-view/doc-list-item';
import * as styles from './view-toggle.css';

const views = [
  {
    label: <DocListViewIcon view="masonry" />,
    value: 'masonry',
    className: styles.viewToggleItem,
  },
  {
    label: <DocListViewIcon view="grid" />,
    value: 'grid',
    className: styles.viewToggleItem,
  },
  {
    label: <DocListViewIcon view="list" />,
    value: 'list',
    className: styles.viewToggleItem,
  },
] satisfies RadioItem[];

export const ViewToggle = ({
  view,
  onViewChange,
}: {
  view: DocListItemView;
  onViewChange: (view: DocListItemView) => void;
}) => {
  // Project hub header: a 34px bordered segment like the header tools.
  const shell = useLocalmindShell();
  const handleViewChange = useCallback(
    (view: DocListItemView) => {
      track.allDocs.header.viewMode.editDisplayMenu({
        type: view,
      });
      onViewChange(view);
    },
    [onViewChange]
  );

  return (
    <RadioGroup
      itemHeight={shell ? 26 : 24}
      gap={shell ? 2 : 8}
      padding={shell ? 3 : 0}
      items={views}
      value={view}
      onChange={handleViewChange}
      className={styles.viewToggle}
      borderRadius={shell ? 11 : 4}
      indicatorClassName={styles.viewToggleIndicator}
    />
  );
};
