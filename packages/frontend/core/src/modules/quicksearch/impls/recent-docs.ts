import { Entity, LiveData } from '@toeverything/infra';
import { map, switchMap } from 'rxjs';

import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { GuardService } from '../../permissions';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { RecentDocsService } from '../services/recent-pages';
import type { QuickSearchGroup } from '../types/group';
import type { QuickSearchItem } from '../types/item';

const group = {
  id: 'recent-docs',
  label: {
    i18nKey: 'com.affine.cmdk.affine.category.affine.recent',
  },
  score: 15,
} as QuickSearchGroup;

export class RecentDocsQuickSearchSession
  extends Entity
  implements QuickSearchSession<'recent-doc', { docId: string }>
{
  constructor(
    private readonly recentDocsService: RecentDocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService,
    private readonly guardService: GuardService
  ) {
    super();
  }

  query$ = new LiveData('');

  private readonly recentDocs$ = LiveData.computed(get => {
    const query = get(this.query$);

    if (query) {
      return []; /* recent docs only for empty query */
    }

    const docRecords = this.recentDocsService.getRecentDocs();

    return docRecords.filter(doc => !get(doc.trash$));
  });

  items$: LiveData<QuickSearchItem<'recent-doc', { docId: string }>[]> =
    LiveData.from(
      this.recentDocs$.pipe(
        switchMap(docs =>
          this.guardService
            .readableDocIds$(docs.map(doc => doc.id))
            .pipe(map(readable => docs.filter(doc => readable.has(doc.id))))
        ),
        map(docs =>
          docs.map<QuickSearchItem<'recent-doc', { docId: string }>>(
            docRecord => {
              const { title, icon } =
                this.docDisplayMetaService.getDocDisplayMeta(docRecord);

              return {
                id: 'recent-doc:' + docRecord.id,
                source: 'recent-doc',
                group: group,
                label: {
                  title: title,
                },
                score: 0,
                icon,
                timestamp: docRecord.meta$.value.updatedDate,
                payload: { docId: docRecord.id },
              };
            }
          )
        )
      ),
      []
    );

  query(query: string) {
    this.query$.next(query);
  }
}
