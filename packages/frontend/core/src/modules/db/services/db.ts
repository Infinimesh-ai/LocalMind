import {
  createORMClient,
  LiveData,
  ObjectPool,
  Service,
  YjsDBAdapter,
} from '@toeverything/infra';
import { Doc as YDoc } from 'yjs';

import type { WorkspaceServerService } from '../../cloud';
import { AuthService } from '../../cloud/services/auth';
import type { WorkspaceService } from '../../workspace';
import { WorkspaceDB, type WorkspaceDBWithTables } from '../entities/db';
import {
  AFFiNE_WORKSPACE_DB_SCHEMA,
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
  type AFFiNEWorkspaceDbSchema,
  type AFFiNEWorkspaceUserdataDbSchema,
} from '../schema';

const WorkspaceDBClient = createORMClient(AFFiNE_WORKSPACE_DB_SCHEMA);
const WorkspaceUserdataDBClient = createORMClient(
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA
);

export class WorkspaceDBService extends Service {
  private readonly tableDocs = new Map<string, YDoc>();
  db: WorkspaceDBWithTables<AFFiNEWorkspaceDbSchema>;
  userdataDBPool = new ObjectPool<
    string,
    WorkspaceDB<AFFiNEWorkspaceUserdataDbSchema>
  >({
    onDangling() {
      return false; // never release
    },
  });

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
    this.db = this.framework.createEntity(
      WorkspaceDB<AFFiNEWorkspaceDbSchema>,
      {
        db: new WorkspaceDBClient(
          new YjsDBAdapter(AFFiNE_WORKSPACE_DB_SCHEMA, {
            getDoc: guid => {
              const ydoc = new YDoc({
                // guid format: db${guid}
                guid: `db$${guid}`,
              });
              this.tableDocs.set(guid, ydoc);
              this.workspaceService.workspace.engine.doc.connectDoc(ydoc);
              this.workspaceService.workspace.engine.doc.addPriority(
                ydoc.guid,
                50
              );
              return ydoc;
            },
          })
        ),
        schema: AFFiNE_WORKSPACE_DB_SCHEMA,
        storageDocId: tableName => `db$${tableName}`,
      }
    ) as WorkspaceDBWithTables<AFFiNEWorkspaceDbSchema>;
  }

  userdataDB(userId: (string & {}) | '__local__') {
    // __local__ for local workspace
    const userdataDb = this.userdataDBPool.get(userId);
    if (userdataDb) {
      return userdataDb.obj as WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
    }

    const newDB = this.framework.createEntity(
      WorkspaceDB<AFFiNEWorkspaceUserdataDbSchema>,
      {
        db: new WorkspaceUserdataDBClient(
          new YjsDBAdapter(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA, {
            getDoc: guid => {
              const ydoc = new YDoc({
                // guid format: userdata${userId}${guid}
                guid: `userdata$${userId}$${guid}`,
              });
              this.workspaceService.workspace.engine.doc.connectDoc(ydoc);
              this.workspaceService.workspace.engine.doc.addPriority(
                ydoc.guid,
                50
              );
              return ydoc;
            },
          })
        ),
        schema: AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
        storageDocId: tableName => `userdata$${userId}$${tableName}`,
      }
    );

    this.userdataDBPool.put(userId, newDB);
    return newDB as WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
  }

  transact(tableName: keyof AFFiNEWorkspaceDbSchema, operation: () => void) {
    const doc = this.tableDocs.get(tableName);
    if (!doc) throw new Error('Load the workspace table before editing');
    doc.transact(operation);
  }

  hasPageTreeChildren(resourceId: string) {
    this.db.folders.keys();
    if (this.db.folders.isLoading$.value)
      throw new Error('Page tree is still loading');
    const document = this.tableDocs.get('folders');
    if (!document) throw new Error('Page tree is unavailable');
    const rows = [...document.share.keys()].map(key => document.getMap(key));
    const containers = new Set(
      rows
        .filter(
          row =>
            row.get('type') === 'doc' &&
            row.get('data') === resourceId &&
            row.get('$pageTreeRetired') !== true
        )
        .map(row => String(row.get('id')))
    );
    // Recycled children still carry recovery dependencies and must be included.
    return rows.some(
      row =>
        row.get('$pageTreeRetired') !== true &&
        containers.has(String(row.get('parentId')))
    );
  }

  localTableDoc(tableName: keyof AFFiNEWorkspaceDbSchema) {
    if (this.workspaceService.workspace.flavour !== 'local')
      throw new Error(
        'Raw page tree access is only available in local Workspaces'
      );
    this.db[tableName].keys();
    const doc = this.tableDocs.get(tableName);
    if (!doc) throw new Error('Workspace table unavailable');
    return doc;
  }

  authService = this.workspaceServerService.server?.scope.get(AuthService);
  public get userdataDB$() {
    // if is local workspace or no account, use __local__ userdata
    // sometimes we may have cloud workspace but no account for a short time, we also use __local__ userdata
    if (
      this.workspaceService.workspace.meta.flavour === 'local' ||
      !this.authService
    ) {
      return new LiveData(this.userdataDB('__local__'));
    } else {
      return this.authService.session.account$.map(account => {
        if (!account) {
          return this.userdataDB('__local__');
        }
        return this.userdataDB(account.id);
      });
    }
  }

  static isDBDocId(docId: string) {
    return docId.startsWith('db$') || docId.startsWith('userdata$');
  }
}
