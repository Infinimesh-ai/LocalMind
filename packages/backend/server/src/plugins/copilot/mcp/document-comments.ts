import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { readBufferWithLimit } from '../../../base';
import { CommentService } from '../../../core/comment';
import { DocWriter, WorkspaceResourceService } from '../../../core/doc';
import {
  archiveBinary,
  archiveBytes,
  type DocumentArchive,
  type DocumentCommentSnapshot,
} from '../../../core/doc/document-archive';
import {
  type CommentAnchorChange,
  editCommentAnchors,
} from '../../../core/doc/document-comment-anchors';
import { DocumentEditError } from '../../../core/doc/document-editor';
import { nativeCommentIds } from '../../../core/doc/document-restore';
import { WorkspaceNativeResourceAccess } from '../../../core/doc/native-resource-access';
import {
  ResourceError,
  type WorkspaceResourceActor,
} from '../../../core/doc/resource-types';
import { OfficeCommentService } from '../../../core/office/comment-service';
import { QuotaService } from '../../../core/quota';
import { CommentAttachmentStorage } from '../../../core/storage';
import { Models } from '../../../models';
import type { DocumentCommentScope } from '../../../models/document-comments';
import {
  type documentCommentCommands,
  documentCommentContent,
} from './document-comments-schema';

type Resource = { kind: 'blocksuite' | 'office' | 'file'; id: string };
type RichContent = z.infer<typeof documentCommentContent>;
function invalid(reason: string): never {
  throw new DocumentEditError('invalid_input', { reason });
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function snapshot(content: RichContent, id: string) {
  const block = (
    flavour: string,
    blockId: string,
    props: object,
    children: object[] = []
  ) => ({
    type: 'block',
    id: blockId,
    flavour,
    version: flavour === 'affine:page' ? 2 : 1,
    props,
    children,
  });
  const text = (delta: RichContent['paragraphs'][number]) => ({
    '$blocksuite:internal:text$': true,
    delta,
  });
  return {
    snapshot: {
      type: 'page',
      meta: { id, title: '', createDate: 0, tags: [] },
      blocks: block('affine:page', `${id}-page`, { title: text([]) }, [
        block(
          'affine:note',
          `${id}-note`,
          { displayMode: 'both' },
          content.paragraphs.map((paragraph, index) =>
            block('affine:paragraph', `${id}-${index}`, {
              type: 'text',
              text: text(paragraph),
            })
          )
        ),
      ]),
    },
  };
}

@Injectable()
export class McpDocumentCommentsService {
  constructor(
    private readonly models: Models,
    private readonly comments: CommentService,
    private readonly office: OfficeCommentService,
    private readonly resources: WorkspaceResourceService,
    private readonly writer: DocWriter,
    private readonly access: WorkspaceNativeResourceAccess,
    private readonly attachments: CommentAttachmentStorage,
    private readonly quota: QuotaService
  ) {}

  private scope(
    actor: WorkspaceResourceActor,
    resource: Resource
  ): DocumentCommentScope {
    if (resource.kind === 'file')
      throw new ResourceError('unsupported_document_kind');
    return {
      workspaceId: actor.workspaceId,
      kind: resource.kind,
      resourceId: resource.id,
    };
  }
  async assertRead(actor: WorkspaceResourceActor, resource: Resource) {
    if (resource.kind === 'office')
      await this.office.assertRead(
        actor.workspaceId,
        actor.actorId,
        resource.id
      );
    else
      await this.comments.assertPermission(
        actor.actorId,
        { workspaceId: actor.workspaceId, docId: resource.id },
        'Doc.Comments.Read'
      );
  }

  async copySnapshot(
    actor: WorkspaceResourceActor,
    resource: Resource,
    expectedVersion: string | undefined
  ) {
    await this.assertRead(actor, resource);
    const snapshot = await this.models.documentComments.copySnapshot(
      this.scope(actor, resource)
    );
    if (snapshot.version !== expectedVersion)
      throw new ResourceError('version_conflict', snapshot.version);
    return snapshot;
  }

  async copyAttachments(
    actor: WorkspaceResourceActor,
    sourceId: string,
    targetId: string,
    attachments: Awaited<
      ReturnType<Models['documentComments']['copySnapshot']>
    >['attachments']
  ) {
    if (!attachments.length) return new Map<string, string>();
    const total = attachments.reduce((total, row) => total + row.size, 0);
    if (total > 32 * 1024 * 1024) throw new ResourceError('content_too_large');
    const quota = await this.quota.getWorkspaceQuotaCalculator(
      actor.workspaceId
    );
    if (quota(total)) throw new ResourceError('quota_exceeded');
    const urls = new Map<string, string>();
    for (const attachment of attachments)
      urls.set(
        attachment.key,
        await this.attachments.copy(
          actor.workspaceId,
          sourceId,
          targetId,
          attachment
        )
      );
    return urls;
  }

  async exportAttachments(
    actor: WorkspaceResourceActor,
    sourceId: string,
    snapshot: DocumentCommentSnapshot
  ) {
    const assets: DocumentArchive['commentAssets'] = [];
    let total = 0;
    for (const attachment of snapshot.attachments) {
      const stored = await this.attachments.get(
        actor.workspaceId,
        sourceId,
        attachment.key
      );
      if (!stored.body) throw new ResourceError('resource_not_found');
      const bytes = await readBufferWithLimit(stored.body, 10 * 1024 * 1024);
      total += bytes.length;
      if (total > 32 * 1024 * 1024)
        throw new ResourceError('content_too_large');
      if (bytes.length !== attachment.size)
        throw new ResourceError('invalid_input');
      assets.push({
        key: attachment.key,
        mimeType: attachment.mime,
        ...archiveBinary(bytes),
      });
    }
    return assets.sort((a, b) => a.key.localeCompare(b.key));
  }

  async restoreAttachments(
    actor: WorkspaceResourceActor,
    targetId: string,
    assets: DocumentArchive['commentAssets']
  ) {
    const urls = new Map<string, string>();
    if (!assets.length) return urls;
    const total = assets.reduce((sum, asset) => sum + asset.byteSize, 0);
    const quota = await this.quota.getWorkspaceQuotaCalculator(
      actor.workspaceId
    );
    if (quota(total)) throw new ResourceError('quota_exceeded');
    for (const asset of assets)
      urls.set(
        asset.key,
        await this.attachments.restoreContent(
          actor.workspaceId,
          targetId,
          asset.key,
          archiveBytes(asset),
          asset.mimeType
        )
      );
    return urls;
  }

  async read(
    actor: WorkspaceResourceActor,
    request: {
      resource: Resource;
      expectedCommentsVersion?: string;
      offset: number;
      limit: number;
      commentId?: string;
    }
  ) {
    const scope = this.scope(actor, request.resource);
    await this.assertRead(actor, request.resource);
    const version = await this.models.documentComments.version(scope);
    if (
      (request.offset > 0 && !request.expectedCommentsVersion) ||
      (request.expectedCommentsVersion !== undefined &&
        request.expectedCommentsVersion !== version)
    )
      throw new ResourceError('cursor_stale', version);
    if (request.commentId)
      await this.requireComment(actor, request.resource, request.commentId);
    const rows = await this.models.documentComments.list(
      scope,
      request.offset,
      request.limit + 1,
      request.commentId
    );
    if (version !== (await this.models.documentComments.version(scope)))
      throw new ResourceError('cursor_stale');
    const anchors =
      request.resource.kind === 'blocksuite' && !request.commentId
        ? new Set(
            nativeCommentIds(
              (await this.resources.nativeSnapshot(actor, request.resource.id))
                .bin
            )
          )
        : undefined;
    return {
      commentsVersion: version,
      items: rows.slice(0, request.limit).map(row =>
        anchors
          ? {
              ...row,
              anchorState: anchors.has(row.id) ? 'attached' : 'orphaned',
            }
          : row
      ),
      offset: request.offset,
      nextOffset:
        rows.length > request.limit ? request.offset + request.limit : null,
      kind: request.commentId ? 'replies' : 'threads',
    };
  }

  private async requireComment(
    actor: WorkspaceResourceActor,
    resource: Resource,
    id: string
  ) {
    const comment =
      resource.kind === 'office'
        ? await this.models.officeComment.get(id)
        : await this.models.comment.get(id);
    if (
      !comment ||
      comment.workspaceId !== actor.workspaceId ||
      comment.docId !== resource.id ||
      ('projectId' in comment && comment.projectId)
    )
      throw new ResourceError('resource_not_found');
    return comment;
  }
  private async requireReply(
    actor: WorkspaceResourceActor,
    resource: Resource,
    id: string
  ) {
    const reply =
      resource.kind === 'office'
        ? await this.models.officeComment.getReply(id)
        : await this.models.comment.getReply(id);
    if (
      !reply ||
      reply.workspaceId !== actor.workspaceId ||
      reply.docId !== resource.id ||
      ('projectId' in reply && reply.projectId)
    )
      throw new ResourceError('resource_not_found');
    await this.requireComment(actor, resource, reply.commentId);
    return reply;
  }

  private async content(
    actor: WorkspaceResourceActor,
    resource: Resource,
    content: unknown,
    id: string
  ) {
    if (resource.kind === 'office') return content;
    const parsed = documentCommentContent.safeParse(content);
    if (!parsed.success) invalid('expected_blocksuite_comment_content');
    for (const run of parsed.data.paragraphs.flat()) {
      const marks = run.attributes,
        reference = marks?.reference;
      if (reference)
        await this.resources.assertDocument(actor, reference.pageId);
      const footnote = marks?.footnote?.reference;
      if (footnote?.type === 'doc')
        await this.resources.assertDocument(actor, footnote.docId);
      if (footnote?.type === 'attachment')
        await this.access.assertBlobRead({ ...actor, key: footnote.blobId });
    }
    return snapshot(parsed.data, id);
  }

  async apply(
    actor: WorkspaceResourceActor,
    request: {
      resource: Resource;
      expectedVersion: string;
      expectedCommentsVersion: string;
      commands: z.infer<typeof documentCommentCommands>;
    },
    operationId: string,
    authorize: () => Promise<void>,
    options: {
      preview?: boolean;
      nativeContent?: Uint8Array;
      initialReferences?: Record<string, string>;
    } = {}
  ) {
    const preview = options.preview === true;
    await authorize();
    const scope = this.scope(actor, request.resource),
      native = request.resource.kind === 'office';
    await this.assertRead(actor, request.resource);
    const beforeCommentsVersion = await this.models.documentComments.version(
      scope,
      !preview
    );
    if (request.expectedCommentsVersion !== beforeCommentsVersion)
      throw new ResourceError('version_conflict', beforeCommentsVersion);
    const refs = new Map<string, string>(),
      anchors: CommentAnchorChange[] = [],
      changedIds = new Set<string>();
    const resolve = (id: string) =>
      id.startsWith('$')
        ? (refs.get(id.slice(1)) ?? invalid('unresolved_client_reference'))
        : id;
    const remember = (ref: string, id: string) => {
      if (refs.has(ref) || ref.startsWith('$'))
        invalid('duplicate_client_reference');
      refs.set(ref, id);
      changedIds.add(id);
    };
    type Thread = {
      id: string;
      userId: string;
      resolved: boolean;
      content: unknown;
    };
    type Reply = {
      id: string;
      userId: string;
      commentId: string;
      content: unknown;
    };
    const threads = new Map<string, Thread>(),
      replies = new Map<string, Reply>(),
      deleted = new Set<string>();
    const requireThread = async (id: string): Promise<Thread> => {
      if (deleted.has(id)) throw new ResourceError('resource_not_found');
      const row =
        threads.get(id) ??
        (await this.requireComment(actor, request.resource, id));
      threads.set(id, row);
      return row;
    };
    const requireReply = async (id: string): Promise<Reply> => {
      if (deleted.has(id)) throw new ResourceError('resource_not_found');
      const row =
        replies.get(id) ??
        (await this.requireReply(actor, request.resource, id));
      await requireThread(row.commentId);
      replies.set(id, row);
      return row;
    };
    const anchorId = (id: string) =>
      id.startsWith('$')
        ? (options.initialReferences?.[id.slice(1)] ??
          invalid('unresolved_anchor_reference'))
        : id;
    const mapAnchor = (
      anchor: NonNullable<CommentAnchorChange['anchor']>
    ): NonNullable<CommentAnchorChange['anchor']> => {
      if (anchor.kind === 'block')
        return { ...anchor, blockId: anchorId(anchor.blockId) };
      if (anchor.kind === 'element')
        return {
          ...anchor,
          surfaceId: anchorId(anchor.surfaceId),
          elementId: anchorId(anchor.elementId),
        };
      if (anchor.kind === 'text')
        return {
          ...anchor,
          target: Object.fromEntries(
            Object.entries(anchor.target).map(([key, value]) => [
              key,
              key.endsWith('Id') && typeof value === 'string'
                ? anchorId(value)
                : value,
            ])
          ) as typeof anchor.target,
        };
      return anchor;
    };
    const identity = (opId: string) =>
      digest(['mcp-comment', operationId, opId]).slice(0, 32);
    const seen = new Set<string>();
    const assert = async (
      item: { userId?: string },
      action:
        | 'Doc.Comments.Create'
        | 'Doc.Comments.Update'
        | 'Doc.Comments.Delete'
        | 'Doc.Comments.Resolve'
    ) => {
      await authorize();
      if (native)
        await this.office.assertWrite(
          actor.workspaceId,
          actor.actorId,
          request.resource.id
        );
      else
        await this.comments.assertPermission(
          actor.actorId,
          {
            workspaceId: actor.workspaceId,
            docId: request.resource.id,
            userId: item.userId,
          },
          action
        );
    };
    for (const command of request.commands) {
      if (seen.has(command.opId)) invalid('duplicate_op_id');
      seen.add(command.opId);
      try {
        if (command.type === 'comment.create') {
          await assert({}, 'Doc.Comments.Create');
          const content = await this.content(
            actor,
            request.resource,
            command.content,
            digest([operationId, command.opId])
          );
          const id = identity(command.opId);
          if (native)
            await this.office.validateContent(
              actor.workspaceId,
              actor.actorId,
              request.resource.id,
              content
            );
          const comment = preview
            ? { id, userId: actor.actorId, content, resolved: false }
            : native
              ? await this.office.create(
                  {
                    workspaceId: actor.workspaceId,
                    artifactId: request.resource.id,
                    actorId: actor.actorId,
                    content,
                  },
                  id
                )
              : await this.comments.createComment(
                  {
                    workspaceId: actor.workspaceId,
                    docId: request.resource.id,
                    userId: actor.actorId,
                    content: content as Record<string, unknown>,
                  },
                  id
                );
          threads.set(comment.id, comment);
          remember(command.clientRef, comment.id);
          if (native && command.anchor)
            invalid('office_anchor_is_part_of_content');
          if (!native)
            anchors.push({
              id: comment.id,
              state: true,
              anchor: mapAnchor(command.anchor ?? { kind: 'document' }),
            });
          if (!preview)
            await this.notify(
              actor,
              request.resource,
              operationId,
              command.opId,
              comment.id,
              undefined,
              command.mentions
            );
        } else if (command.type === 'reply.create') {
          const comment = await requireThread(resolve(command.commentId));
          await assert({}, 'Doc.Comments.Create');
          const content = await this.content(
            actor,
            request.resource,
            command.content,
            digest([operationId, command.opId])
          );
          const id = identity(command.opId);
          if (native)
            await this.office.validateContent(
              actor.workspaceId,
              actor.actorId,
              request.resource.id,
              content,
              true
            );
          const reply = preview
            ? { id, commentId: comment.id, userId: actor.actorId, content }
            : native
              ? await this.office.createReply(
                  {
                    actorId: actor.actorId,
                    commentId: comment.id,
                    content,
                  },
                  id
                )
              : await this.comments.createReply(
                  {
                    commentId: comment.id,
                    userId: actor.actorId,
                    content: content as Record<string, unknown>,
                  },
                  id
                );
          replies.set(reply.id, reply);
          remember(command.clientRef, reply.id);
          if (!preview)
            await this.notify(
              actor,
              request.resource,
              operationId,
              command.opId,
              comment.id,
              reply.id,
              command.mentions
            );
        } else if (
          command.type === 'reply.update' ||
          command.type === 'reply.delete'
        ) {
          const reply = await requireReply(resolve(command.replyId));
          await assert(
            reply,
            command.type === 'reply.update'
              ? 'Doc.Comments.Update'
              : 'Doc.Comments.Delete'
          );
          if (command.type === 'reply.delete') {
            deleted.add(reply.id);
            if (!preview) {
              if (native)
                await this.office.deleteReply({
                  actorId: actor.actorId,
                  id: reply.id,
                });
              else await this.comments.deleteReply(reply.id);
            }
          } else {
            // Preserve existing snapshot IDs and all unrelated attachment fields.
            const old = reply.content as {
              snapshot?: { meta?: { id?: string } };
            };
            const content = await this.content(
              actor,
              request.resource,
              command.content,
              old.snapshot?.meta?.id ?? digest([operationId, command.opId])
            );
            const merged = native
              ? content
              : { ...(reply.content as object), ...(content as object) };
            if (native)
              await this.office.validateContent(
                actor.workspaceId,
                actor.actorId,
                request.resource.id,
                merged,
                true
              );
            if (isDeepStrictEqual(reply.content, merged)) continue;
            replies.set(reply.id, { ...reply, content: merged });
            if (!preview) {
              if (native)
                await this.office.updateReply({
                  actorId: actor.actorId,
                  id: reply.id,
                  content: merged,
                });
              else
                await this.comments.updateReply({
                  id: reply.id,
                  content: merged as Record<string, unknown>,
                });
            }
          }
          changedIds.add(reply.id);
        } else {
          const comment = await requireThread(resolve(command.commentId));
          await assert(
            comment,
            command.type === 'comment.delete'
              ? 'Doc.Comments.Delete'
              : command.type === 'comment.resolve'
                ? 'Doc.Comments.Resolve'
                : 'Doc.Comments.Update'
          );
          if (command.type === 'comment.delete') {
            deleted.add(comment.id);
            if (!preview && native)
              await this.office.delete({
                actorId: actor.actorId,
                id: comment.id,
              });
            else if (!native) {
              if (!preview) await this.comments.deleteComment(comment.id);
              anchors.push({ id: comment.id, state: null });
            }
          } else if (command.type === 'comment.resolve') {
            if (comment.resolved === command.resolved) continue;
            threads.set(comment.id, { ...comment, resolved: command.resolved });
            if (!preview && native)
              await this.office.resolve({
                actorId: actor.actorId,
                id: comment.id,
                resolved: command.resolved,
              });
            else if (!native) {
              if (!preview)
                await this.comments.resolveComment({
                  id: comment.id,
                  resolved: command.resolved,
                });
              anchors.push({ id: comment.id, state: !command.resolved });
            }
          } else if (command.type === 'comment.anchor.set') {
            if (native) invalid('office_anchor_is_part_of_content');
            anchors.push({
              id: comment.id,
              state: !comment.resolved,
              anchor: mapAnchor(command.anchor),
            });
          } else {
            const old = comment.content as {
              snapshot?: { meta?: { id?: string } };
            };
            const content = await this.content(
              actor,
              request.resource,
              command.content,
              old.snapshot?.meta?.id ?? digest([operationId, command.opId])
            );
            const merged = native
              ? content
              : { ...(comment.content as object), ...(content as object) };
            if (native)
              await this.office.validateContent(
                actor.workspaceId,
                actor.actorId,
                request.resource.id,
                merged
              );
            if (isDeepStrictEqual(comment.content, merged)) continue;
            threads.set(comment.id, { ...comment, content: merged });
            if (!preview) {
              if (native)
                await this.office.update({
                  actorId: actor.actorId,
                  id: comment.id,
                  content: merged,
                });
              else
                await this.comments.updateComment({
                  id: comment.id,
                  content: merged as Record<string, unknown>,
                });
            }
          }
          if (command.type !== 'comment.anchor.set') changedIds.add(comment.id);
        }
      } catch (error) {
        if (error instanceof DocumentEditError)
          error.detail.opId = command.opId;
        throw error;
      }
    }
    if (anchors.length) {
      const current = await this.resources.nativeSnapshot(
        actor,
        request.resource.id
      );
      if (current.metadata.version !== request.expectedVersion)
        throw new ResourceError('version_conflict', current.metadata.version);
      const plan = editCommentAnchors(
        options.nativeContent ?? current.bin,
        anchors
      );
      if (plan.changed) {
        if (!preview)
          await this.writer.pushDocUpdate(
            actor.workspaceId,
            request.resource.id,
            plan.update,
            actor.actorId,
            authorize
          );
        plan.changedIds.forEach(id => changedIds.add(id));
      }
    }
    await authorize();
    if (changedIds.size && !preview)
      await this.models.documentComments.event(
        `${operationId}:comments`,
        actor.workspaceId,
        {
          type: 'comments.changed',
          kind: request.resource.kind,
          resourceId: request.resource.id,
        }
      );
    return {
      changed: !!changedIds.size,
      changedIds: [...changedIds],
      identities: Object.fromEntries(refs),
      commentsVersion: await this.models.documentComments.version(scope),
    };
  }

  private async notify(
    actor: WorkspaceResourceActor,
    resource: Resource,
    operationId: string,
    opId: string,
    commentId: string,
    replyId: string | undefined,
    mentions: string[]
  ) {
    // Office's current UI publishes invalidations only; preserve its contract.
    if (resource.kind !== 'blocksuite') return;
    const metadata = await this.resources.describe(actor, resource.id);
    await this.models.documentComments.event(
      `${operationId}:${opId}:notification`,
      actor.workspaceId,
      {
        type: 'comment.notification',
        resourceId: resource.id,
        actorId: actor.actorId,
        commentId,
        replyId: replyId ?? null,
        mentions,
        title: metadata.title,
        mode: metadata.documentType === 'edgeless' ? 'edgeless' : 'page',
      }
    );
  }
}
