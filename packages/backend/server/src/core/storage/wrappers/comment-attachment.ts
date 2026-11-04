import { Injectable, Logger } from '@nestjs/common';

import {
  EventBus,
  metrics,
  OnEvent,
  readBufferWithLimit,
  URLHelper,
} from '../../../base';
import { Models } from '../../../models';
import {
  type StorageRuntimeGetObjectResult,
  StorageRuntimeProvider,
} from '../../storage-runtime';

declare global {
  interface Events {
    'comment.attachment.delete': {
      workspaceId: string;
      docId: string;
      key: string;
    };
  }
}

@Injectable()
export class CommentAttachmentStorage {
  private readonly logger = new Logger(CommentAttachmentStorage.name);

  constructor(
    private readonly event: EventBus,
    private readonly models: Models,
    private readonly url: URLHelper,
    private readonly rt: StorageRuntimeProvider
  ) {}

  private storageKey(workspaceId: string, docId: string, key: string) {
    return `comment-attachments/${workspaceId}/${docId}/${key}`;
  }

  async put(
    workspaceId: string,
    docId: string,
    key: string,
    name: string,
    blob: Buffer,
    userId: string
  ) {
    const metadata = await this.rt.putObject(
      'blob',
      this.storageKey(workspaceId, docId, key),
      blob
    );
    const mime = metadata.contentType;
    const size = metadata.contentLength;
    await this.models.commentAttachment.upsert({
      workspaceId,
      docId,
      key,
      name,
      mime,
      size,
      createdBy: userId,
    });

    metrics.storage.histogram('comment_attachment_size').record(size, { mime });
    metrics.storage.counter('comment_attachment_total').add(1, { mime });
    this.logger.log(
      `uploaded comment attachment ${workspaceId}/${docId}/${key} with size ${size}, mime: ${mime}, name: ${name}, user: ${userId}`
    );
  }

  async get(
    workspaceId: string,
    docId: string,
    key: string,
    signedUrl?: boolean
  ): Promise<StorageRuntimeGetObjectResult> {
    const storageKey = this.storageKey(workspaceId, docId, key);
    if (signedUrl) {
      const presigned = await this.rt.presignGet('blob', storageKey);
      if (presigned) {
        return { redirectUrl: presigned.url };
      }
    }
    return await this.rt.getObject('blob', storageKey);
  }

  /** Content copy participates in the caller's resource transaction for records. */
  async copy(
    workspaceId: string,
    sourceDocId: string,
    targetDocId: string,
    attachment: { key: string; size: number; mime: string }
  ) {
    const source = await this.get(workspaceId, sourceDocId, attachment.key);
    if (!source.body) throw new Error('Comment attachment body is unavailable');
    const bytes = await readBufferWithLimit(source.body, 10 * 1024 * 1024);
    if (bytes.length !== attachment.size)
      throw new Error('Comment attachment size mismatch');
    return this.restoreContent(
      workspaceId,
      targetDocId,
      attachment.key,
      bytes,
      attachment.mime
    );
  }

  /** Only a verified archive/copy may restore content under a new document. */
  async restoreContent(
    workspaceId: string,
    docId: string,
    key: string,
    bytes: Buffer,
    mime: string
  ) {
    await this.models.documentObjectStage.remember({
      storageKey: this.storageKey(workspaceId, docId, key),
      workspaceId,
      docId,
      blobId: key,
      byteSize: bytes.length,
    });
    await this.rt.putObject(
      'blob',
      this.storageKey(workspaceId, docId, key),
      bytes,
      { contentType: mime, contentLength: bytes.length }
    );
    return this.getUrl(workspaceId, docId, key);
  }

  async delete(workspaceId: string, docId: string, key: string) {
    await this.rt.deleteObject(
      'blob',
      this.storageKey(workspaceId, docId, key)
    );
    await this.models.commentAttachment.delete(workspaceId, docId, key);
    this.logger.log(
      `deleted comment attachment ${workspaceId}/${docId}/${key}`
    );
  }

  getUrl(workspaceId: string, docId: string, key: string) {
    return this.url.link(
      `/api/workspaces/${workspaceId}/docs/${docId}/comment-attachments/${key}`
    );
  }

  @OnEvent('workspace.deleted')
  async onWorkspaceDeleted({ id }: Events['workspace.deleted']) {
    const attachments = await this.models.commentAttachment.list(id);

    for (const attachment of attachments) {
      this.event.emit('comment.attachment.delete', {
        workspaceId: id,
        docId: attachment.docId,
        key: attachment.key,
      });
    }
  }

  @OnEvent('comment.attachment.delete')
  async onCommentAttachmentDelete({
    workspaceId,
    docId,
    key,
  }: Events['comment.attachment.delete']) {
    await this.delete(workspaceId, docId, key);
  }
}
