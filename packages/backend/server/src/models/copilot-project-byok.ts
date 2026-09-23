import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import { ActionForbidden, BadRequest } from '../base';
import { BaseModel } from './base';
import { resolveByokApiStyle } from './copilot-byok-protocol';

@Injectable()
export class CopilotProjectByokModel extends BaseModel {
  get() {
    return this.db.aiProjectByokConfig.findUnique({ where: { id: 'global' } });
  }

  listAuditEvents() {
    return this.db.aiProjectByokAuditEvent.findMany({
      orderBy: { revision: 'desc' },
      take: 20,
    });
  }

  async assertProjectMember(projectId: string, userId?: string) {
    const member = userId
      ? await this.db.aiContextProjectMember.findFirst({
          where: { projectId, userId, project: { status: 'active' } },
          select: { projectId: true },
        })
      : null;
    if (!member) {
      throw new ActionForbidden(
        'Project AI requires active project membership.'
      );
    }
  }

  @Transactional()
  async save(input: {
    expectedRevision: number;
    apiStyle?: string | null;
    provider: string;
    encryptedApiKey: string;
    endpoint: string | null;
    modelId: string;
    enabled: boolean;
    lastValidatedAt: Date;
    actorId: string;
    credentialChanged: boolean;
  }) {
    await this.db
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('project-global-byok', 0))::text`;
    const current = await this.get();
    if ((current?.revision ?? 0) !== input.expectedRevision) {
      throw new BadRequest(
        'Project BYOK changed. Reload the settings and try again.'
      );
    }
    const apiStyle =
      input.apiStyle !== undefined
        ? input.apiStyle
        : (current?.apiStyle ?? null);
    resolveByokApiStyle(input.provider, apiStyle);
    const data = {
      apiStyle,
      revision: input.expectedRevision + 1,
      provider: input.provider,
      encryptedApiKey: input.encryptedApiKey,
      endpoint: input.endpoint,
      modelId: input.modelId,
      enabled: input.enabled,
      workOrderEnabled: current?.workOrderEnabled ?? false,
      lastValidatedAt: input.lastValidatedAt,
      lastError: null,
      lastErrorAt: null,
      updatedBy: input.actorId,
    };
    const saved = await this.db.aiProjectByokConfig.upsert({
      where: { id: 'global' },
      create: { id: 'global', ...data },
      update: data,
    });
    await this.db.aiProjectByokAuditEvent.create({
      data: {
        revision: saved.revision,
        actorId: input.actorId,
        provider: saved.provider,
        apiStyle: saved.apiStyle,
        endpoint: saved.endpoint,
        modelId: saved.modelId,
        enabled: saved.enabled,
        workOrderEnabled: saved.workOrderEnabled,
        credentialChanged: input.credentialChanged,
      },
    });
    return saved;
  }

  touchUsed(revision: number) {
    return this.db.aiProjectByokConfig.updateMany({
      where: { id: 'global', revision },
      data: { lastUsedAt: new Date() },
    });
  }

  recordFailure(revision: number, message: string) {
    return this.db.aiProjectByokConfig.updateMany({
      where: { id: 'global', revision },
      data: { lastError: message.slice(0, 300), lastErrorAt: new Date() },
    });
  }

  @Transactional()
  async setWorkOrderEnabled(input: {
    expectedRevision: number;
    enabled: boolean;
    actorId: string;
  }) {
    await this.db
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('project-global-byok', 0))::text`;
    const current = await this.get();
    if (!current || current.revision !== input.expectedRevision) {
      throw new BadRequest(
        'Project BYOK changed. Reload the settings and try again.'
      );
    }
    if (!current.enabled && input.enabled) {
      throw new BadRequest(
        'Enable and validate global Project BYOK before enabling personal work orders.'
      );
    }
    const saved = await this.db.aiProjectByokConfig.update({
      where: { id: current.id, revision: current.revision },
      data: {
        workOrderEnabled: input.enabled,
        revision: { increment: 1 },
        updatedBy: input.actorId,
      },
    });
    await this.db.aiProjectByokAuditEvent.create({
      data: {
        revision: saved.revision,
        actorId: input.actorId,
        provider: saved.provider,
        apiStyle: saved.apiStyle,
        endpoint: saved.endpoint,
        modelId: saved.modelId,
        enabled: saved.enabled,
        workOrderEnabled: saved.workOrderEnabled,
        credentialChanged: false,
      },
    });
    return saved;
  }
}
