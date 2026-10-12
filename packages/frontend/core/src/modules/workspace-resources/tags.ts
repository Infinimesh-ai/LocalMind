import { UserFriendlyError } from '@affine/error';
import {
  type SetWorkspaceNativeResourceTagsInput,
  setWorkspaceNativeResourceTagsMutation,
  workspaceNativeResourceQuery,
} from '@affine/graphql';
import { Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../cloud';
import type { DocsService } from '../doc';
import type { GuardService } from '../permissions';
import type { TagService } from '../tag';
import type { WorkspaceService } from '../workspace';
import type { WorkspaceResourcesService } from './service';

export type ResourceTagTarget = { kind: 'doc' | 'file' | 'office'; id: string };
export type ResourceTagPatch = { add: string[]; remove: string[] };

export function patchResourceTags(
  current: readonly string[],
  patch: ResourceTagPatch
) {
  const removed = new Set(patch.remove);
  return [...new Set([...current, ...patch.add])].filter(
    id => !removed.has(id)
  );
}

/** Tag patches share the existing resource ACL, CAS and idempotent mutations. */
export class WorkspaceResourceTagsService extends Service {
  private generation = 0;
  private inactive = false;
  private readonly requests = new Map<
    string,
    SetWorkspaceNativeResourceTagsInput
  >();
  private readonly pending = new Set<string>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly docsService: DocsService,
    private readonly guard: GuardService,
    private readonly tagsService: TagService,
    private readonly resources: WorkspaceResourcesService
  ) {
    super();
    const subscription = serverService.server$
      .pipe(switchMap(server => server?.account$ ?? of(null)))
      .subscribe(() => {
        this.generation++;
        this.requests.clear();
      });
    this.disposables.push(() => {
      this.inactive = true;
      this.generation++;
      this.requests.clear();
      subscription.unsubscribe();
    });
  }

  private assertScope(generation: number) {
    if (generation !== this.generation || this.inactive)
      throw new Error('Resource scope changed');
  }

  begin() {
    const generation = this.generation;
    return {
      read: (target: ResourceTagTarget) => this.read(target, generation),
      change: (target: ResourceTagTarget, patch: ResourceTagPatch) =>
        this.change(target, patch, generation),
    };
  }

  async read(target: ResourceTagTarget, generation = this.generation) {
    this.assertScope(generation);
    if (target.kind === 'doc') {
      if (!(await this.guard.can('Doc_Update', target.id)))
        throw new Error('Tag editing is unavailable');
      this.assertScope(generation);
      const doc = this.docsService.list.doc$(target.id).value;
      if (!doc || doc.meta$.value.trash)
        throw new Error('Resource unavailable');
      return doc.meta$.value.tags ?? [];
    }
    const server = this.serverService.server;
    if (!server?.account$.value) throw new Error('Sign in before editing tags');
    const resource = (
      await server.gql({
        query: workspaceNativeResourceQuery,
        variables: {
          input: {
            workspaceId: this.workspaceService.workspace.id,
            resourceId: target.id,
            kind: target.kind,
          },
        },
      })
    ).workspaceNativeResource;
    this.assertScope(generation);
    if (!resource.canEditTags || resource.trashedAt)
      throw new Error('Tag editing is unavailable');
    return (resource.tags ?? []).map(tag => tag.id);
  }

  async change(
    target: ResourceTagTarget,
    patch: ResourceTagPatch,
    generation = this.generation
  ) {
    this.assertScope(generation);
    const identity = `${target.kind}:${target.id}`;
    if (this.pending.has(identity))
      throw new Error('Tag update already in progress');
    const defined = new Set(
      this.tagsService.tagList.tagMetas$.value.map(tag => tag.id)
    );
    if ([...patch.add, ...patch.remove].some(id => !defined.has(id)))
      throw new Error('Tag definition changed');
    const key = JSON.stringify([
      identity,
      [...new Set(patch.add)].sort(),
      [...new Set(patch.remove)].sort(),
    ]);
    this.pending.add(identity);
    try {
      const workspace = this.workspaceService.workspace;
      await workspace.engine.doc.waitForSynced(workspace.id);
      this.assertScope(generation);
      if (target.kind === 'doc') {
        await this.read(target, generation);
        this.assertScope(generation);
        const doc = this.docsService.list.doc$(target.id).value;
        if (!doc || doc.meta$.value.trash)
          throw new Error('Resource unavailable');
        const current = doc.meta$.value.tags ?? [];
        const next = patchResourceTags(current, patch);
        if (
          current.length !== next.length ||
          current.some((id, i) => next[i] !== id)
        )
          doc.setMeta({ tags: next });
        return;
      }
      const server = this.serverService.server;
      if (!server?.account$.value)
        throw new Error('Sign in before editing tags');
      // Even an uncertain-response retry rechecks live authorization.
      const resource = (
        await server.gql({
          query: workspaceNativeResourceQuery,
          variables: {
            input: {
              workspaceId: workspace.id,
              resourceId: target.id,
              kind: target.kind,
            },
          },
        })
      ).workspaceNativeResource;
      this.assertScope(generation);
      if (!resource.canEditTags || resource.trashedAt) {
        this.requests.delete(key);
        throw new Error('Tag editing is unavailable');
      }
      let input = this.requests.get(key);
      if (!input) {
        const current = (resource.tags ?? []).map(tag => tag.id);
        const next = patchResourceTags(current, patch);
        if (
          current.length === next.length &&
          current.every((id, i) => next[i] === id)
        )
          return;
        if (this.requests.size >= 100)
          throw new Error('Retry outstanding tag operations first');
        input = {
          workspaceId: workspace.id,
          resourceId: target.id,
          kind: target.kind,
          tagIds: next,
          requestKey: nanoid(),
          expectedVersion: resource.metadataVersion,
        };
        this.requests.set(key, input);
      }
      await server.gql({
        query: setWorkspaceNativeResourceTagsMutation,
        variables: { input },
      });
      this.assertScope(generation);
      this.requests.delete(key);
      this.resources.invalidate();
    } catch (error) {
      if (
        [400, 403, 404, 409].includes(UserFriendlyError.fromAny(error).status)
      ) {
        this.requests.delete(key);
        this.resources.invalidate();
      }
      throw error;
    } finally {
      this.pending.delete(identity);
    }
  }
}
