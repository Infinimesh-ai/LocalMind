import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import { BaseModel } from './base';

export type UpsertAiWorkspaceProfileInput = {
  id?: string | null;
  workspaceId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  isDefault: boolean;
  credentialIds: string[];
  userId: string;
};

const profileInclude = {
  workspace: {
    select: { name: true },
  },
  credentials: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      byokConfig: true,
    },
  },
};

@Injectable()
export class CopilotAiProfileModel extends BaseModel {
  async list(workspaceId?: string | null) {
    return await this.db.aiWorkspaceProfile.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      include: profileInclude,
      orderBy: [
        { workspace: { name: 'asc' } },
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
    });
  }

  async get(id: string) {
    return await this.db.aiWorkspaceProfile.findUnique({
      where: { id },
      include: profileInclude,
    });
  }

  async listCredentialConfigs(workspaceId: string, ids: string[]) {
    return await this.db.aiWorkspaceByokConfig.findMany({
      where: { id: { in: ids }, workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Transactional()
  async upsert(input: UpsertAiWorkspaceProfileInput) {
    if (input.isDefault) {
      await this.db.aiWorkspaceProfile.updateMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.id ? { id: { not: input.id } } : {}),
          isDefault: true,
        },
        data: { isDefault: false, updatedBy: input.userId },
      });
    }

    const data = {
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      isDefault: input.isDefault,
      updatedBy: input.userId,
    };
    const profile = input.id
      ? await this.db.aiWorkspaceProfile.update({
          where: { id: input.id, workspaceId: input.workspaceId },
          data,
        })
      : await this.db.aiWorkspaceProfile.create({
          data: {
            ...data,
            workspaceId: input.workspaceId,
            createdBy: input.userId,
          },
        });

    await this.db.aiWorkspaceProfileCredential.deleteMany({
      where: { profileId: profile.id },
    });
    if (input.credentialIds.length) {
      await this.db.aiWorkspaceProfileCredential.createMany({
        data: input.credentialIds.map((byokConfigId, sortOrder) => ({
          profileId: profile.id,
          workspaceId: input.workspaceId,
          byokConfigId,
          sortOrder,
        })),
      });
    }

    return await this.get(profile.id);
  }

  @Transactional()
  async delete(workspaceId: string, id: string) {
    return await this.db.aiWorkspaceProfile.delete({
      where: { id, workspaceId },
    });
  }

  async countWorkspaceProfiles(workspaceId: string) {
    return await this.db.aiWorkspaceProfile.count({ where: { workspaceId } });
  }

  async getWorkspaceDefault(workspaceId: string) {
    return await this.db.aiWorkspaceProfile.findFirst({
      where: { workspaceId, enabled: true, isDefault: true },
      include: profileInclude,
    });
  }

  async getUserAssignment(userId: string) {
    return await this.db.aiUserAiProfileAssignment.findUnique({
      where: { userId },
      include: {
        profile: {
          include: profileInclude,
        },
      },
    });
  }

  @Transactional()
  async setUserAssignment(input: {
    userId: string;
    workspaceId: string;
    profileId: string;
    actorId: string;
  }) {
    return await this.db.aiUserAiProfileAssignment.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        profileId: input.profileId,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
      update: {
        workspaceId: input.workspaceId,
        profileId: input.profileId,
        updatedBy: input.actorId,
      },
      include: {
        profile: {
          include: profileInclude,
        },
      },
    });
  }

  @Transactional()
  async clearUserAssignment(userId: string) {
    await this.db.aiUserAiProfileAssignment.deleteMany({ where: { userId } });
  }
}
