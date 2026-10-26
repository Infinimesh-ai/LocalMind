export {
  DocsSearchService,
  type IndexedDocReference,
} from './services/docs-search';

import { type Framework } from '@toeverything/infra';

import { DocsService } from '../doc';
import { GuardService } from '../permissions';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { DocsSearchService } from './services/docs-search';

export function configureDocsSearchModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DocsSearchService, [WorkspaceService, DocsService, GuardService]);
}
