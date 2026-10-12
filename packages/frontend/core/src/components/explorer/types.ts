import type {
  GroupByParams,
  OrderByParams,
} from '@affine/core/modules/collection-rules/types';
import type { DocCustomPropertyInfo } from '@affine/core/modules/db';
import type { DocRecord } from '@affine/core/modules/doc';
import type { ResourceDisplayProperties } from '@affine/graphql';

import type { DocListItemView } from './docs-view/doc-list-item';

export interface ExplorerDisplayPreference {
  /** Explicit opt-in for the mixed Workspace explorer; editor registries stay intact. */
  resourceProperties?: ResourceDisplayProperties;
  /** Tracks the one-time compact resource list presentation migration. */
  resourceListLayoutVersion?: 1;
  view?: DocListItemView;
  groupBy?: GroupByParams;
  orderBy?: OrderByParams;
  displayProperties?: string[];
  showDocIcon?: boolean;
  showDocPreview?: boolean;
  showMoreOperation?: boolean;
  showDragHandle?: boolean;
  quickFavorite?: boolean;
  quickTrash?: boolean;
  quickSplit?: boolean;
  quickTab?: boolean;
  quickSelect?: boolean;
  quickDeletePermanently?: boolean;
  quickRestore?: boolean;
}

export interface DocListPropertyProps {
  value: any;
  doc: DocRecord;
  propertyInfo: DocCustomPropertyInfo;
}

export interface GroupHeaderProps {
  groupId: string;
  docCount: number;
  collapsed: boolean;
}
