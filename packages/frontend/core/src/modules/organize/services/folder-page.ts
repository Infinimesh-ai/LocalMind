import { createWorkspaceFolderPageMutation } from '@affine/graphql';
import {
  generateFractionalIndexingKeyBetween,
  Service,
} from '@toeverything/infra';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import type { WorkspaceServerService } from '../../cloud';
import type { DocsService } from '../../doc';
import type { GlobalState } from '../../storage';
import type { WorkspaceService } from '../../workspace';
import type { DirectoryAccessStore } from '../stores/directory-access';
import type { FolderStore } from '../stores/folder';

const intentSchema = z.object({
  requestKey: z.string().min(1),
  title: z.string().min(1),
  primaryMode: z.enum(['page', 'edgeless']),
  documentId: z.string().optional(),
});

/** Keeps the same creation intent across network failures, remounts and reloads. */
export class WorkspaceFolderPageService extends Service {
  private readonly flights = new Map<string, Promise<string>>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly state: GlobalState,
    private readonly docs: DocsService,
    private readonly directory: DirectoryAccessStore,
    private readonly folders: FolderStore
  ) {
    super();
  }

  get accountIdentity() {
    const server = this.serverService.server;
    return JSON.stringify([
      server?.baseUrl,
      server?.account$.value?.id,
      this.directory.accountGeneration,
    ]);
  }

  prepare(folderId: string, primaryMode: 'page' | 'edgeless', title: string) {
    const workspace = this.workspaceService.workspace;
    const server = this.serverService.server;
    const accountId = server?.account$.value?.id;
    if (workspace.flavour !== 'local' && (!server || !accountId))
      throw new Error('Sign in before creating a page');
    const key = `folder-page-creation:${JSON.stringify([server?.baseUrl ?? 'local', accountId ?? 'local', workspace.id, folderId, primaryMode])}`;
    const saved = this.state.get<unknown>(key);
    const intent =
      saved === undefined
        ? {
            requestKey: crypto.randomUUID(),
            title,
            primaryMode,
            ...(workspace.flavour === 'local'
              ? { documentId: crypto.randomUUID() }
              : {}),
          }
        : intentSchema.parse(saved);
    this.state.set(key, intent);
    return { key, intent, identity: this.accountIdentity, folderId };
  }

  create(
    folderId: string,
    primaryMode: 'page' | 'edgeless',
    title: string,
    recovery?: ReturnType<WorkspaceFolderPageService['prepare']>
  ) {
    const workspace = this.workspaceService.workspace;
    const server = this.serverService.server;
    const accountId = server?.account$.value?.id;
    if (workspace.flavour !== 'local' && (!server || !accountId))
      return Promise.reject(new Error('Sign in before creating a page'));
    const key = `folder-page-creation:${JSON.stringify([server?.baseUrl ?? 'local', accountId ?? 'local', workspace.id, folderId, primaryMode])}`;
    let prepared: ReturnType<WorkspaceFolderPageService['prepare']>;
    try {
      prepared = recovery ?? this.prepare(folderId, primaryMode, title);
      if (
        prepared.identity !== this.accountIdentity ||
        prepared.key !== key ||
        prepared.folderId !== folderId
      )
        throw new Error('Creation context changed');
    } catch (error) {
      return Promise.reject(error);
    }
    const flightKey = `${key}:${prepared.intent.requestKey}`;
    const existing = this.flights.get(flightKey);
    if (existing) return existing;
    const generation = this.directory.accountGeneration;
    const sameAccount = () =>
      generation === this.directory.accountGeneration &&
      (workspace.flavour === 'local' ||
        (this.serverService.server === server &&
          server?.account$.value?.id === accountId));
    const operation = Promise.resolve()
      .then(async () => {
        const intent = prepared.intent;
        if (!sameAccount()) throw new Error('Account changed during creation');
        let documentId: string;
        if (workspace.flavour === 'local') {
          await firstValueFrom(
            this.docs.list.isReady$.pipe(filter(Boolean), timeout(15_000))
          );
          if (!sameAccount() || !intent.documentId)
            throw new Error('Creation context changed');
          const existing = this.docs.list.doc$(intent.documentId).value;
          if (existing?.trash$.value)
            throw new Error('Created page was deleted');
          const page =
            existing ??
            this.docs.createDoc({
              id: intent.documentId,
              title: intent.title,
              primaryMode: intent.primaryMode,
            });
          documentId = page.id;
          const children = await firstValueFrom(
            this.folders.watchNodeChildren(folderId)
          );
          const last = children
            .map(child => child.index)
            .sort()
            .at(-1);
          await this.folders.createLinkAuthorized(
            folderId,
            'doc',
            documentId,
            generateFractionalIndexingKeyBetween(last ?? null, null)
          );
        } else {
          if (!server) throw new Error('Server unavailable');
          const result = await server.gql({
            query: createWorkspaceFolderPageMutation,
            variables: {
              input: {
                workspaceId: workspace.id,
                folderId,
                requestKey: intent.requestKey,
                title: intent.title,
                primaryMode: intent.primaryMode,
              },
            },
          });
          if (!sameAccount())
            throw new Error('Account changed during creation');
          documentId = result.createWorkspaceFolderPage.documentId;
          await Promise.all([
            this.directory.refresh(),
            workspace.engine.doc.requestPull(workspace.id),
            workspace.engine.doc.requestPull('db$folders'),
          ]);
          await firstValueFrom(
            this.docs.list
              .doc$(documentId)
              .pipe(filter(Boolean), timeout(15_000))
          );
        }
        if (!sameAccount()) throw new Error('Account changed during creation');
        if (
          this.state.get<z.infer<typeof intentSchema>>(key)?.requestKey ===
          intent.requestKey
        )
          this.state.del(key);
        return documentId;
      })
      .finally(() => {
        this.flights.delete(flightKey);
      });
    this.flights.set(flightKey, operation);
    return operation;
  }
}
