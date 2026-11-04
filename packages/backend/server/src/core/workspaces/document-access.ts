import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { z } from 'zod';

import { ActionForbidden, BadRequest, Config } from '../../base';
import { DocRole, Models, PublicDocMode } from '../../models';
import { BackendRuntimeProvider } from '../backend-runtime';
import { ResourceError } from '../doc/resource-types';
import { PermissionAccess } from '../permission';
import { canUserExecuteLimitedActions } from './abuse';
import { documentAccessCommand } from './document-access-schema';

export const documentRoleValues = {
  none: DocRole.None,
  reader: DocRole.Reader,
  commenter: DocRole.Commenter,
  editor: DocRole.Editor,
  manager: DocRole.Manager,
} as const;

/** UI and MCP share permissions, anti-abuse policy, no-op and commit semantics. */
@Injectable()
export class DocumentAccessService {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly config: Config,
    private readonly runtime: BackendRuntimeProvider
  ) {}

  async read(
    actorId: string,
    workspaceId: string,
    docId: string,
    offset = 0,
    limit = 100
  ) {
    await this.ac
      .user(actorId)
      .workspace(workspaceId)
      .doc(docId)
      .projectScope(null)
      .assert('Doc.Users.Read');
    return this.models.documentAccess.state(workspaceId, docId, offset, limit);
  }

  private async assertCanShare(actorId: string, workspaceId: string) {
    const user = await this.models.user.get(actorId);
    if (
      (await this.runtime.isInviteAbuseUserQuarantinedOrBanned(actorId)) ||
      (await this.runtime.isInviteAbuseWorkspaceQuarantined(workspaceId)) ||
      !user ||
      !canUserExecuteLimitedActions(
        user,
        this.config.auth.newAccountShareActionDelay * 1000
      )
    )
      throw new ActionForbidden(
        'This feature is temporarily unavailable for you.'
      );
  }

  @Transactional()
  async change(
    actorId: string,
    workspaceId: string,
    docId: string,
    input: z.infer<typeof documentAccessCommand>,
    expectedVersion?: string
  ) {
    const command = documentAccessCommand.parse(input);
    if (
      workspaceId === docId ||
      docId.startsWith('db$') ||
      docId.startsWith('userdata$')
    )
      throw new BadRequest('Expected a document');
    await this.models.documentAccess.lock(workspaceId, docId);
    const access = this.ac
      .user(actorId)
      .workspace(workspaceId)
      .doc(docId)
      .projectScope(null);
    await access.assert('Doc.Read');
    await access.assert(
      command.type === 'publish' || command.type === 'unpublish'
        ? 'Doc.Publish'
        : command.type === 'owner.transfer'
          ? 'Doc.TransferOwner'
          : 'Doc.Users.Manage'
    );
    const before = await this.models.documentAccess.state(
      workspaceId,
      docId,
      0,
      1
    );
    if (expectedVersion !== undefined && before.version !== expectedVersion)
      throw new ResourceError('version_conflict', before.version);
    let event:
      | 'doc.public_state.changed'
      | 'doc.grants.changed'
      | 'doc.owner.changed'
      | 'doc.default_role.changed';
    if (command.type === 'publish') {
      await this.assertCanShare(actorId, workspaceId);
      const mode =
        command.mode === 'page' ? PublicDocMode.Page : PublicDocMode.Edgeless;
      if (before.policy?.visibility !== 'public' || before.mode !== mode)
        await this.models.doc.publish(workspaceId, docId, mode);
      event = 'doc.public_state.changed';
    } else if (command.type === 'unpublish') {
      if (before.policy?.visibility === 'public')
        await this.models.doc.unpublish(workspaceId, docId);
      event = 'doc.public_state.changed';
    } else if (command.type === 'default_role.set') {
      if (before.policy?.memberDefaultRole !== command.role)
        await this.models.doc.setDefaultRole(
          workspaceId,
          docId,
          documentRoleValues[command.role]
        );
      event = 'doc.default_role.changed';
    } else if (command.type === 'owner.transfer') {
      if (!(await this.models.user.get(command.userId)))
        throw new BadRequest('Target user does not exist');
      if (
        (await this.models.docUser.getOwner(workspaceId, docId))?.userId !==
        command.userId
      )
        await this.models.docUser.setOwner(workspaceId, docId, command.userId);
      event = 'doc.owner.changed';
    } else if (command.type === 'member.remove') {
      const member = await this.models.docUser.get(
        workspaceId,
        docId,
        command.userId
      );
      if (member?.type === DocRole.Owner)
        throw new BadRequest(
          'Transfer document ownership before removing the owner'
        );
      if (member)
        await this.models.docUser.delete(workspaceId, docId, command.userId);
      event = 'doc.grants.changed';
    } else {
      for (const userId of new Set(command.userIds)) {
        if (!(await this.models.user.get(userId)))
          throw new BadRequest('Target user does not exist');
        const member = await this.models.docUser.get(
          workspaceId,
          docId,
          userId
        );
        if (member?.type === DocRole.Owner)
          throw new BadRequest(
            'Transfer document ownership before changing the owner role'
          );
        if (member?.type !== documentRoleValues[command.role])
          await this.models.docUser.set(
            workspaceId,
            docId,
            userId,
            documentRoleValues[command.role]
          );
      }
      event = 'doc.grants.changed';
    }
    const after = await this.models.documentAccess.state(
        workspaceId,
        docId,
        0,
        1
      ),
      changed = before.version !== after.version;
    if (changed)
      await this.models.documentComments.event(randomUUID(), workspaceId, {
        type: 'access.changed',
        event,
        resourceId: docId,
        ...(command.type === 'owner.transfer'
          ? { userId: command.userId }
          : {}),
      });
    return {
      changed,
      accessVersion: after.version,
      metadata: await this.models.doc.getMeta(workspaceId, docId),
    };
  }
}
