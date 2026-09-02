import { BadRequestException, Injectable } from '@nestjs/common';

import { Models } from '../../../models';
import { ByokEntitlementPolicy } from './policy';

const MAX_PROFILE_CREDENTIALS = 50;
const MAX_PROFILE_DESCRIPTION_LENGTH = 1000;

@Injectable()
export class AiProfileService {
  constructor(
    private readonly models: Models,
    private readonly entitlement: ByokEntitlementPolicy
  ) {}

  async listAdminProfiles(input: {
    userId: string;
    workspaceId?: string | null;
  }) {
    await this.entitlement.assertInstanceManagementAccess(input.userId);
    if (input.workspaceId) {
      await this.assertWorkspaceExists(input.workspaceId);
    }
    return (await this.models.copilotAiProfile.list(input.workspaceId)).map(
      profile => this.toAdminProfile(profile)
    );
  }

  async upsertAdminProfile(input: {
    id?: string | null;
    workspaceId: string;
    name: string;
    description?: string | null;
    enabled: boolean;
    isDefault: boolean;
    credentialIds: string[];
    userId: string;
  }) {
    await this.entitlement.assertInstanceManagementAccess(input.userId);
    await this.assertWorkspaceExists(input.workspaceId);

    const name = input.name.trim();
    if (!name || name.length > 120) {
      throw new BadRequestException(
        'AI Profile name must be between 1 and 120 characters.'
      );
    }
    const description = input.description?.trim() || null;
    if (description && description.length > MAX_PROFILE_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `AI Profile description must not exceed ${MAX_PROFILE_DESCRIPTION_LENGTH} characters.`
      );
    }
    if (input.isDefault && !input.enabled) {
      throw new BadRequestException('The default AI Profile must be enabled.');
    }

    const credentialIds = [...new Set(input.credentialIds)];
    if (credentialIds.length > MAX_PROFILE_CREDENTIALS) {
      throw new BadRequestException(
        `AI Profile cannot reference more than ${MAX_PROFILE_CREDENTIALS} credentials.`
      );
    }
    const credentials =
      await this.models.copilotAiProfile.listCredentialConfigs(
        input.workspaceId,
        credentialIds
      );
    if (credentials.length !== credentialIds.length) {
      throw new BadRequestException(
        'AI Profile credentials must belong to the selected workspace.'
      );
    }

    if (input.id) {
      const current = await this.models.copilotAiProfile.get(input.id);
      if (!current || current.workspaceId !== input.workspaceId) {
        throw new BadRequestException('AI Profile not found.');
      }
    }

    const profile = await this.models.copilotAiProfile.upsert({
      id: input.id,
      workspaceId: input.workspaceId,
      name,
      description,
      enabled: input.enabled,
      isDefault: input.isDefault,
      credentialIds,
      userId: input.userId,
    });
    if (!profile) {
      throw new BadRequestException('AI Profile could not be saved.');
    }
    return this.toAdminProfile(profile);
  }

  async deleteAdminProfile(input: {
    id: string;
    workspaceId: string;
    userId: string;
  }) {
    await this.entitlement.assertInstanceManagementAccess(input.userId);
    await this.assertWorkspaceExists(input.workspaceId);
    const current = await this.models.copilotAiProfile.get(input.id);
    if (!current || current.workspaceId !== input.workspaceId) {
      throw new BadRequestException('AI Profile not found.');
    }
    await this.models.copilotAiProfile.delete(input.workspaceId, input.id);
    return true;
  }

  async getAdminUserAssignment(userId: string, actorId: string) {
    await this.entitlement.assertInstanceManagementAccess(actorId);
    await this.assertUserExists(userId);
    const assignment =
      await this.models.copilotAiProfile.getUserAssignment(userId);
    return assignment ? this.toAdminAssignment(assignment) : null;
  }

  async setAdminUserAssignment(input: {
    userId: string;
    profileId?: string | null;
    actorId: string;
  }) {
    await this.entitlement.assertInstanceManagementAccess(input.actorId);
    await this.assertUserExists(input.userId);
    if (!input.profileId) {
      await this.models.copilotAiProfile.clearUserAssignment(input.userId);
      return null;
    }

    const profile = await this.models.copilotAiProfile.get(input.profileId);
    if (!profile) {
      throw new BadRequestException('AI Profile not found.');
    }
    if (!profile.enabled) {
      throw new BadRequestException('AI Profile is disabled.');
    }
    const assignment = await this.models.copilotAiProfile.setUserAssignment({
      userId: input.userId,
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      actorId: input.actorId,
    });
    return this.toAdminAssignment(assignment);
  }

  async resolveCredentialIds(
    workspaceId: string,
    userId?: string
  ): Promise<string[] | null> {
    if (userId) {
      const [assignment, activeMember] = await Promise.all([
        this.models.copilotAiProfile.getUserAssignment(userId),
        this.models.workspaceUser.getActive(workspaceId, userId),
      ]);
      if (
        activeMember &&
        assignment?.workspaceId === workspaceId &&
        assignment.profile.enabled
      ) {
        return assignment.profile.credentials.map(
          credential => credential.byokConfigId
        );
      }
    }

    const defaultProfile =
      await this.models.copilotAiProfile.getWorkspaceDefault(workspaceId);
    if (defaultProfile) {
      return defaultProfile.credentials.map(
        credential => credential.byokConfigId
      );
    }

    return (await this.models.copilotAiProfile.countWorkspaceProfiles(
      workspaceId
    )) === 0
      ? null
      : [];
  }

  private toAdminProfile(profile: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    enabled: boolean;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    workspace: { name: string | null };
    credentials: Array<{
      byokConfigId: string;
      byokConfig: {
        id: string;
        provider: string;
        name: string;
        modelId: string | null;
        enabled: boolean;
      };
    }>;
  }) {
    return {
      id: profile.id,
      workspaceId: profile.workspaceId,
      workspaceName: profile.workspace.name,
      name: profile.name,
      description: profile.description,
      enabled: profile.enabled,
      isDefault: profile.isDefault,
      credentialIds: profile.credentials.map(item => item.byokConfigId),
      credentials: profile.credentials.map(item => item.byokConfig),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private toAdminAssignment(assignment: {
    userId: string;
    workspaceId: string;
    createdAt: Date;
    updatedAt: Date;
    profile: Parameters<AiProfileService['toAdminProfile']>[0];
  }) {
    return {
      userId: assignment.userId,
      workspaceId: assignment.workspaceId,
      profile: this.toAdminProfile(assignment.profile),
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  }

  private async assertWorkspaceExists(workspaceId: string) {
    if (!(await this.models.workspace.get(workspaceId))) {
      throw new BadRequestException('Workspace not found.');
    }
  }

  private async assertUserExists(userId: string) {
    if (!(await this.models.user.get(userId, { withDisabled: true }))) {
      throw new BadRequestException('User not found.');
    }
  }
}
