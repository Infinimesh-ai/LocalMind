import { UserFriendlyError } from '@affine/error';
import {
  type CreateWorkspaceNativeResourceInput,
  createWorkspaceNativeResourceMutation,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { distinctUntilChanged, map, of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../cloud';
import type { CreatedResource } from '../navigation-panel/services/created-resource';
import type { WorkspacePageTreeService } from '../organize/services/page-tree';
import { ProjectUploadQueue } from '../project-resources/upload-queue';
import type { WorkspaceService } from '../workspace';
import type { WorkspaceResourcesService } from './service';
import {
  uploadWorkspaceNativeBlob,
  WorkspaceUploadSizeError,
} from './upload-blob';

export type WorkspaceUploadDestination = {
  name: string;
  folderId: string | null;
  tree?: Pick<
    CreateWorkspaceNativeResourceInput,
    'parentNodeId' | 'treeContractVersion'
  >;
};
export type WorkspaceUploadFailure =
  | 'size'
  | 'permission'
  | 'missing'
  | 'conflict'
  | 'network'
  | 'timeout'
  | 'encoding'
  | 'invalid'
  | 'rateLimited'
  | 'unknown';
export type WorkspaceUpload = {
  /** Stable queue identity; an optimistic conflict may renew only mutationKey. */
  requestKey: string;
  mutationKey: string;
  generation: number;
  file?: File;
  name: string;
  destination: WorkspaceUploadDestination;
  input?: CreateWorkspaceNativeResourceInput;
  blobKey?: string;
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  reason?: WorkspaceUploadFailure;
  resource?: CreatedResource;
};

export function workspaceUploadFailure(error: unknown): WorkspaceUploadFailure {
  if (error instanceof WorkspaceUploadSizeError) return 'size';
  const value = UserFriendlyError.fromAny(error);
  if (value.status === 429 || value.is('TOO_MANY_REQUEST'))
    return 'rateLimited';
  if (value.status === 401 || value.status === 403) return 'permission';
  if (value.status === 404) return 'missing';
  if (value.status === 409) return 'conflict';
  if (value.isNetworkError()) return 'network';
  if (/exceeds.*(size|limit)|must not exceed/i.test(value.message))
    return 'size';
  if (/not.*UTF-8|invalid.*encoding/i.test(value.message)) return 'encoding';
  if (/timed? ?out|timeout|transaction.*(expired|closed)/i.test(value.message))
    return 'timeout';
  if (value.status === 400) return 'invalid';
  return 'unknown';
}

/** Workspace lifetime, independent of a menu or route; account changes cancel it. */
export class WorkspaceUploadsService extends Service {
  readonly jobs$ = new LiveData<WorkspaceUpload[]>([]);
  readonly panelOpen$ = new LiveData(false);
  private inactive = false;
  private queue = this.makeQueue();
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly pageTree: WorkspacePageTreeService,
    private readonly resources: WorkspaceResourcesService
  ) {
    super();
    const account = serverService.server$
      .pipe(
        switchMap(server => server?.account$ ?? of(null)),
        map(account => account?.id ?? null),
        distinctUntilChanged()
      )
      .subscribe(() => {
        this.queue.dispose();
        clearTimeout(this.refreshTimer);
        this.queue = this.makeQueue();
        this.jobs$.next([]);
        this.panelOpen$.next(false);
      });
    this.disposables.push(() => {
      this.inactive = true;
      this.queue.dispose();
      clearTimeout(this.refreshTimer);
      account.unsubscribe();
      this.jobs$.next([]);
      this.panelOpen$.next(false);
    });
  }

  enqueue(files: readonly File[], destination: WorkspaceUploadDestination) {
    if (this.inactive || !files.length) return [];
    const jobs = files.map(file => {
      const requestKey = nanoid();
      return {
        requestKey,
        mutationKey: requestKey,
        generation: this.pageTree.accountGeneration,
        file,
        name: file.name,
        destination: structuredClone(destination),
        status: 'waiting' as const,
      };
    });
    this.jobs$.next([...this.jobs$.value, ...jobs]);
    this.queue.enqueue(jobs);
    return jobs.map(job => job.requestKey);
  }

  retryFailed() {
    const jobs = this.jobs$.value.filter(job => job.status === 'failed');
    for (const job of jobs) {
      if (job.reason === 'conflict') {
        job.input = undefined;
        job.mutationKey = nanoid();
      }
      job.status = 'waiting';
      job.reason = undefined;
    }
    this.emit();
    this.queue.enqueue(jobs);
  }

  setPanelOpen(open: boolean) {
    this.panelOpen$.next(open);
  }

  clearDone() {
    this.jobs$.next(this.jobs$.value.filter(job => job.status !== 'done'));
  }
  private emit() {
    this.jobs$.next([...this.jobs$.value]);
  }
  private makeQueue() {
    return new ProjectUploadQueue<WorkspaceUpload>(
      (job, signal) => this.execute(job, signal),
      (job, error) => {
        job.status = 'failed';
        job.reason = workspaceUploadFailure(error);
        this.emit();
      },
      1,
      job => {
        job.status = 'waiting';
        job.reason = 'rateLimited';
        this.emit();
      }
    );
  }

  private async execute(job: WorkspaceUpload, signal: AbortSignal) {
    const assertScope = () => {
      signal.throwIfAborted();
      if (this.inactive || job.generation !== this.pageTree.accountGeneration)
        throw new Error('Upload scope changed');
    };
    assertScope();
    const server = this.serverService.server;
    if (!server || !job.file) throw new Error('Upload source unavailable');
    job.status = 'uploading';
    job.reason = undefined;
    this.emit();
    job.blobKey ??= await uploadWorkspaceNativeBlob(
      this.workspaceService.workspace,
      job.file
    );
    assertScope();
    if (!job.input) {
      let target: Partial<CreateWorkspaceNativeResourceInput> = {
        folderId: job.destination.folderId,
      };
      if (job.destination.tree) {
        const parentId = job.destination.tree.parentNodeId ?? null;
        await this.pageTree.load(parentId);
        assertScope();
        const layer = this.pageTree.layers$.value.get(
          this.pageTree.key(parentId)
        )?.page;
        if (!layer) throw new Error('Upload destination unavailable');
        target = {
          ...job.destination.tree,
          expectedTreeRevision: layer.revision,
          expectedAuthorizationRevision: layer.authorizationRevision,
        };
      }
      job.input = {
        workspaceId: this.workspaceService.workspace.id,
        ...target,
        title: job.name,
        blobKey: job.blobKey,
        requestKey: job.mutationKey,
      };
    }
    assertScope();
    const result = await server.gql({
      query: createWorkspaceNativeResourceMutation,
      variables: { input: job.input },
      context: { signal },
    });
    assertScope();
    job.resource = {
      resourceId: result.createWorkspaceNativeResource.id,
      kind: result.createWorkspaceNativeResource.kind,
    };
    job.status = 'done';
    job.file = undefined;
    this.emit();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (!this.inactive) this.resources.invalidate();
    }, 250);
  }
}
