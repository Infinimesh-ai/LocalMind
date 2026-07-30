import { NotFoundException } from '@nestjs/common';
import {
  Args,
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import { BadRequest } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import type {
  CopilotContextMemoryKind,
  CopilotContextMemoryScope,
  CopilotContextMemoryStatus,
  CopilotContextProjectStatus,
} from '../../models';
import { ContextMemoryService } from './context-memory-service';
import { CopilotType } from './resolver';

@ObjectType()
export class CopilotContextMemoryType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  ownerUserId!: string;

  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  @Field(() => String, { nullable: true })
  docId!: string | null;

  @Field(() => String, { nullable: true })
  projectId!: string | null;

  @Field(() => String, { nullable: true })
  sourceSessionId!: string | null;

  @Field(() => String)
  scope!: string;

  @Field(() => String)
  kind!: string;

  @Field(() => String)
  visibility!: string;

  @Field(() => String)
  status!: string;

  @Field(() => String)
  content!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class CopilotContextSettingsType {
  @Field(() => Boolean)
  autoMemoryEnabled!: boolean;
}

@ObjectType()
export class CopilotContextStrategyType {
  @Field(() => String)
  version!: string;

  @Field(() => String)
  fingerprint!: string;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  checkpointCount!: number;

  @Field(() => GraphQLISODateTime, { nullable: true })
  lastCheckpointAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextProjectType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  workspaceId!: string;

  @Field(() => String, { nullable: true })
  createdByUserId!: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  description!: string;

  @Field(() => String)
  status!: string;

  @Field(() => [String])
  documentIds!: string[];

  @Field(() => Int)
  documentCount!: number;

  @Field(() => Boolean)
  canManage!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@InputType()
export class CreateCopilotContextMemoryInput {
  @Field(() => String, { nullable: true })
  workspaceId?: string;

  @Field(() => String, { nullable: true })
  docId?: string;

  @Field(() => String, { nullable: true })
  projectId?: string;

  @Field(() => String)
  scope!: CopilotContextMemoryScope;

  @Field(() => String)
  kind!: Exclude<CopilotContextMemoryKind, 'auto_memory'>;

  @Field(() => String)
  content!: string;
}

@InputType()
export class UpdateCopilotContextMemoryInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  content?: string;

  @Field(() => String, { nullable: true })
  status?: CopilotContextMemoryStatus;
}

@InputType()
export class UpdateCopilotContextSettingsInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => Boolean)
  autoMemoryEnabled!: boolean;
}

@InputType()
export class CreateCopilotContextProjectInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => [String])
  documentIds!: string[];
}

@InputType()
export class UpdateCopilotContextProjectInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  status?: CopilotContextProjectStatus;

  @Field(() => [String], { nullable: true })
  documentIds?: string[];
}

type StoredMemory = NonNullable<
  Awaited<ReturnType<ContextMemoryService['get']>>
>;
type StoredProject = NonNullable<
  Awaited<ReturnType<ContextMemoryService['getProject']>>
>;

@Resolver(() => CopilotType)
export class CopilotContextMemoryResolver {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly contextMemory: ContextMemoryService
  ) {}

  private validateMemoryShape(input: CreateCopilotContextMemoryInput) {
    const content = input.content.trim();
    if (!content) throw new BadRequest('Memory content is required');
    if (content.length > 8_000) {
      throw new BadRequest(
        'Context memory content cannot exceed 8000 characters'
      );
    }
    if (
      !['user', 'workspace', 'project'].includes(input.scope) ||
      !['rule', 'project_summary'].includes(input.kind)
    ) {
      throw new BadRequest('Invalid context memory type');
    }
    if (
      input.scope === 'user' &&
      (input.workspaceId || input.docId || input.projectId)
    ) {
      throw new BadRequest(
        'User-scoped memory cannot target a workspace, document, or project'
      );
    }
    if (
      input.scope === 'workspace' &&
      (!input.workspaceId || input.docId || input.projectId)
    ) {
      throw new BadRequest('Workspace-scoped memory requires only workspaceId');
    }
    if (
      input.scope === 'project' &&
      (!input.workspaceId || input.docId || !input.projectId)
    ) {
      throw new BadRequest(
        'Project-scoped memory requires workspaceId and projectId'
      );
    }
    if (input.kind === 'project_summary' && input.scope !== 'project') {
      throw new BadRequest('Project summaries must use project scope');
    }
    return content;
  }

  private validateProjectShape(input: {
    name?: string;
    description?: string;
    status?: CopilotContextProjectStatus;
    documentIds?: string[];
  }) {
    const name = input.name?.trim();
    const description = input.description?.trim();
    if (input.name !== undefined && (!name || name.length > 120)) {
      throw new BadRequest('Project name must be between 1 and 120 characters');
    }
    if (description !== undefined && description.length > 2_000) {
      throw new BadRequest('Project description cannot exceed 2000 characters');
    }
    if (
      input.status !== undefined &&
      !['active', 'archived'].includes(input.status)
    ) {
      throw new BadRequest('Invalid project status');
    }
    const documentIds = input.documentIds
      ? [...new Set(input.documentIds.map(id => id.trim()).filter(Boolean))]
      : undefined;
    if (documentIds && (documentIds.length === 0 || documentIds.length > 100)) {
      throw new BadRequest(
        'A project must contain between 1 and 100 documents'
      );
    }
    return { name, description, documentIds };
  }

  private async assertRead(
    userId: string,
    input: {
      workspaceId?: string | null;
      docId?: string | null;
      projectId?: string | null;
    }
  ) {
    if (!input.workspaceId) return;
    if (input.projectId) {
      const project = await this.contextMemory.getProject(input.projectId);
      if (!project || project.workspaceId !== input.workspaceId) {
        throw new NotFoundException('Context project not found');
      }
      const accessible = await this.accessibleProjectDocuments(userId, project);
      if (!accessible.length) {
        throw new NotFoundException('Context project not found');
      }
      return;
    }
    if (input.docId) {
      await this.ac
        .user(userId)
        .doc({
          workspaceId: input.workspaceId,
          docId: input.docId,
        })
        .allowLocal()
        .assert('Doc.Read');
      return;
    }
    await this.ac
      .user(userId)
      .workspace(input.workspaceId)
      .allowLocal()
      .assert('Workspace.Copilot');
  }

  private async accessibleProjectDocuments(
    userId: string,
    project: StoredProject
  ) {
    if (!project.documents.length) return [];
    return await this.ac
      .user(userId)
      .workspace(project.workspaceId)
      .allowLocal()
      .docs(project.documents, 'Doc.Read');
  }

  private async assertProjectManager(userId: string, project: StoredProject) {
    await this.ac
      .user(userId)
      .workspace(project.workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
  }

  private async assertDocumentsReadable(
    userId: string,
    workspaceId: string,
    documentIds: string[]
  ) {
    const documents = documentIds.map(docId => ({ docId }));
    const accessible = await this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .docs(documents, 'Doc.Read');
    if (accessible.length !== documents.length) {
      throw new NotFoundException(
        'One or more project documents are not accessible'
      );
    }
  }

  private async presentProjects(
    userId: string,
    projects: StoredProject[]
  ): Promise<CopilotContextProjectType[]> {
    const workspaceId = projects[0]?.workspaceId;
    if (!workspaceId) return [];
    const documentRefs = projects.flatMap(project =>
      project.documents.map(document => ({
        projectId: project.id,
        docId: document.docId,
      }))
    );
    const [accessibleDocuments, canManageWorkspace] = await Promise.all([
      this.ac
        .user(userId)
        .workspace(workspaceId)
        .allowLocal()
        .docs(documentRefs, 'Doc.Read'),
      this.ac
        .user(userId)
        .workspace(workspaceId)
        .allowLocal()
        .can('Workspace.Settings.Update'),
    ]);
    const accessibleByProject = new Map<
      string,
      (typeof accessibleDocuments)[number][]
    >();
    for (const document of accessibleDocuments) {
      const current = accessibleByProject.get(document.projectId) ?? [];
      current.push(document);
      accessibleByProject.set(document.projectId, current);
    }

    return projects.flatMap(project => {
      const projectDocuments = accessibleByProject.get(project.id) ?? [];
      const canManage =
        canManageWorkspace &&
        projectDocuments.length === project.documents.length;
      if (!projectDocuments.length && !canManage) return [];
      return [
        {
          ...project,
          documentIds: projectDocuments.map(document => document.docId),
          documentCount: projectDocuments.length,
          canManage,
        },
      ];
    });
  }

  private async assertProjectDocumentsManageable(
    userId: string,
    project: StoredProject
  ) {
    await this.assertProjectManager(userId, project);
    const accessible = await this.accessibleProjectDocuments(userId, project);
    if (accessible.length !== project.documents.length) {
      throw new NotFoundException('Context project not found');
    }
  }

  private async assertWorkspaceProjectManager(
    userId: string,
    workspaceId: string
  ) {
    await this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
  }

  private async assertCanMutate(user: CurrentUserType, memory: StoredMemory) {
    if (memory.ownerUserId !== user.id) {
      throw new NotFoundException('Context memory not found');
    }
  }

  private requireWorkspace(copilot: CopilotType) {
    if (!copilot.workspaceId) {
      throw new BadRequest('Workspace context is required');
    }
    return copilot.workspaceId;
  }

  @ResolveField(() => CopilotContextSettingsType, {
    description: 'Get the current user context preferences for this workspace',
  })
  async contextSettings(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    return await this.contextMemory.getSettings(user.id, workspaceId);
  }

  @ResolveField(() => [CopilotContextStrategyType], {
    description:
      'List immutable context planner revisions and checkpoint activity',
  })
  async contextPlannerStrategies(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    return await this.contextMemory.listPlannerStrategies(user.id, workspaceId);
  }

  @ResolveField(() => [CopilotContextProjectType], {
    description:
      'List context projects whose documents the current user can access',
  })
  async contextProjects(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('includeArchived', { nullable: true, defaultValue: false })
    includeArchived?: boolean
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    const projects = await this.contextMemory.listProjects(
      workspaceId,
      includeArchived
    );
    return await this.presentProjects(user.id, projects);
  }

  @ResolveField(() => [CopilotContextMemoryType], {
    description:
      'List authorized rules, automatic memories, and project summaries',
  })
  async contextMemories(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('docId', { nullable: true }) docId?: string,
    @Args('includeDisabled', { nullable: true, defaultValue: false })
    includeDisabled?: boolean
  ) {
    const workspaceId = copilot.workspaceId;
    await this.assertRead(user.id, { workspaceId, docId });
    if (docId) {
      return await this.contextMemory.listVisible({
        userId: user.id,
        workspaceId,
        docId,
        includeDisabled,
      });
    }

    if (!workspaceId) {
      return await this.contextMemory.listManageable({
        userId: user.id,
        includeDisabled,
      });
    }
    const projects = await this.contextMemory.listProjects(workspaceId, true);
    const accessibleProjects = await this.presentProjects(user.id, projects);
    const memories = await this.contextMemory.listManageable({
      userId: user.id,
      workspaceId,
      projectIds: accessibleProjects.map(project => project.id),
      includeDisabled,
    });
    const documentMemories = memories.filter(
      (memory): memory is typeof memory & { docId: string } => !!memory.docId
    );
    const accessibleDocuments = new Set(
      (
        await this.ac
          .user(user.id)
          .workspace(workspaceId)
          .docs(documentMemories, 'Doc.Read')
      ).map(memory => memory.id)
    );
    return memories.filter(
      memory => !memory.docId || accessibleDocuments.has(memory.id)
    );
  }

  @Mutation(() => CopilotContextMemoryType)
  async createCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextMemoryInput
  ) {
    const content = this.validateMemoryShape(input);
    await this.assertRead(user.id, input);
    if (input.projectId) {
      const project = await this.contextMemory.getProject(input.projectId);
      if (!project || project.status !== 'active') {
        throw new BadRequest('Archived projects cannot accept memory');
      }
    }
    return await this.contextMemory.create(user.id, {
      workspaceId: input.workspaceId ?? null,
      docId: input.docId ?? null,
      projectId: input.projectId ?? null,
      scope: input.scope,
      kind: input.kind,
      content,
    });
  }

  @Mutation(() => CopilotContextProjectType)
  async createCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextProjectInput
  ) {
    const normalized = this.validateProjectShape(input);
    if (!normalized.name || !normalized.documentIds) {
      throw new BadRequest('Project name and documents are required');
    }
    await this.assertWorkspaceProjectManager(user.id, input.workspaceId);
    await this.assertDocumentsReadable(
      user.id,
      input.workspaceId,
      normalized.documentIds
    );
    const project = await this.contextMemory.createProject({
      workspaceId: input.workspaceId,
      createdByUserId: user.id,
      name: normalized.name,
      description: normalized.description,
      documentIds: normalized.documentIds,
    });
    const [presented] = await this.presentProjects(user.id, [project]);
    if (!presented) throw new NotFoundException('Context project not found');
    return presented;
  }

  @Mutation(() => CopilotContextProjectType)
  async updateCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextProjectInput
  ) {
    const normalized = this.validateProjectShape(input);
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.status === undefined &&
      input.documentIds === undefined
    ) {
      throw new BadRequest('No context project fields to update');
    }
    const project = await this.contextMemory.getProject(input.id);
    if (!project) throw new NotFoundException('Context project not found');
    await this.assertProjectDocumentsManageable(user.id, project);
    if (normalized.documentIds) {
      await this.assertDocumentsReadable(
        user.id,
        project.workspaceId,
        normalized.documentIds
      );
    }
    const updated = await this.contextMemory.updateProject(input.id, {
      name: normalized.name,
      description: normalized.description,
      status: input.status,
      documentIds: normalized.documentIds,
    });
    const [presented] = await this.presentProjects(user.id, [updated]);
    if (!presented) throw new NotFoundException('Context project not found');
    return presented;
  }

  @Mutation(() => CopilotContextMemoryType)
  async updateCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextMemoryInput
  ) {
    if (input.content !== undefined && !input.content.trim()) {
      throw new BadRequest('Memory content is required');
    }
    if (input.content !== undefined && input.content.trim().length > 8_000) {
      throw new BadRequest(
        'Context memory content cannot exceed 8000 characters'
      );
    }
    if (
      input.status !== undefined &&
      !['active', 'disabled'].includes(input.status)
    ) {
      throw new BadRequest('Invalid context memory status');
    }
    if (input.content === undefined && input.status === undefined) {
      throw new BadRequest('No context memory fields to update');
    }
    const memory = await this.contextMemory.get(input.id);
    if (!memory) throw new NotFoundException('Context memory not found');
    await this.assertCanMutate(user, memory);
    const updated = await this.contextMemory.update(input.id, {
      content: input.content?.trim(),
      status: input.status,
    });
    if (!updated) throw new NotFoundException('Context memory not found');
    return updated;
  }

  @Mutation(() => CopilotContextSettingsType)
  async updateCopilotContextSettings(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextSettingsInput
  ) {
    await this.assertRead(user.id, { workspaceId: input.workspaceId });
    return await this.contextMemory.updateSettings({
      userId: user.id,
      workspaceId: input.workspaceId,
      autoMemoryEnabled: input.autoMemoryEnabled,
    });
  }

  @Mutation(() => Boolean)
  async deleteCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string
  ) {
    const memory = await this.contextMemory.get(id);
    if (!memory) throw new NotFoundException('Context memory not found');
    await this.assertCanMutate(user, memory);
    return await this.contextMemory.delete(id);
  }

  @Mutation(() => Boolean)
  async deleteCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string
  ) {
    const project = await this.contextMemory.getProject(id);
    if (!project) throw new NotFoundException('Context project not found');
    await this.assertProjectDocumentsManageable(user.id, project);
    const deleted = await this.contextMemory.deleteProject(id);
    if (!deleted) {
      throw new BadRequest(
        'Projects with user memories must be archived instead of deleted'
      );
    }
    return true;
  }
}
