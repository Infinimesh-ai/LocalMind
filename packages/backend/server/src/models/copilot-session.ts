import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AiPromptRole, Prisma } from '@prisma/client';
import { omit } from 'lodash-es';

import {
  CopilotPromptInvalid,
  CopilotSessionDeleted,
  CopilotSessionInvalidInput,
  CopilotSessionNotFound,
} from '../base';
import { getTokenEncoder } from '../native';
import type { PromptAttachment } from '../plugins/copilot/providers/types';
import {
  type ChatMessage as CopilotChatMessage,
  ChatMessageSchema,
} from '../plugins/copilot/types';
import { BaseModel } from './base';

export enum SessionType {
  Workspace = 'workspace', // docId is null and pinned is false
  Pinned = 'pinned', // pinned is true
  Doc = 'doc', // docId points to specific document
}

type ChatPrompt = {
  name: string;
  action?: string | null;
  model: string;
};

type ChatAttachment = PromptAttachment;

type ChatStreamObject = {
  type: 'text-delta' | 'reasoning' | 'tool-call' | 'tool-result';
  textDelta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, any>;
  result?: any;
  rawArgumentsText?: string;
  argumentParseError?: string;
  thought?: string;
};

type ChatMessage = {
  id?: string | undefined;
  compatSubmissionId?: string | null;
  role: 'system' | 'assistant' | 'user';
  content: string;
  attachments?: ChatAttachment[] | null;
  params?: Record<string, any> | null;
  streamObjects?: ChatStreamObject[] | null;
  createdAt: Date;
};

type StoredChatMessage = Prisma.AiSessionMessageGetPayload<{
  select: {
    id: true;
    compatSubmissionId: true;
    role: true;
    content: true;
    attachments: true;
    streamObjects: true;
    params: true;
    createdAt: true;
  };
}>;

type PureChatSession = {
  sessionId: string;
  workspaceId: string | null;
  docId?: string | null;
  selectedContextProjectId?: string | null;
  pinned?: boolean;
  title: string | null;
  messages?: ChatMessage[];
  // connect ids
  userId: string;
  parentSessionId?: string | null;
};

type ChatSession = PureChatSession & {
  // connect ids
  promptName: string;
  promptAction: string | null;
};

type ChatSessionWithPrompt = PureChatSession & {
  prompt: ChatPrompt;
};

type ChatSessionBaseState = Pick<ChatSession, 'userId' | 'sessionId'>;

export type ForkSessionOptions = Omit<
  ChatSession,
  'messages' | 'promptName' | 'promptAction'
> & {
  prompt: { name: string; action: string | null | undefined; model: string };
  messages: ChatMessage[];
};

type UpdateChatSessionMessage = ChatSessionBaseState & {
  prompt: { model: string };
  messages: ChatMessage[];
};

export type UpdateChatSessionOptions = ChatSessionBaseState &
  Pick<
    Partial<ChatSession>,
    | 'docId'
    | 'selectedContextProjectId'
    | 'pinned'
    | 'promptName'
    | 'promptAction'
    | 'title'
  > & { promptModel?: string };

export type UpdateChatSession = ChatSessionBaseState & UpdateChatSessionOptions;

export type ListSessionOptions = Pick<
  Partial<ChatSession>,
  'sessionId' | 'workspaceId' | 'docId' | 'pinned' | 'selectedContextProjectId'
> & {
  userId: string | undefined;
  action?: boolean;
  fork?: boolean;
  limit?: number;
  skip?: number;
  sessionOrder?: 'asc' | 'desc';
  messageOrder?: 'asc' | 'desc';

  // extra condition
  withPrompt?: boolean;
  withMessages?: boolean;
};

export type CleanupSessionOptions = Pick<
  ChatSession,
  'userId' | 'workspaceId' | 'docId' | 'selectedContextProjectId'
> & {
  sessionIds: string[];
};

@Injectable()
export class CopilotSessionModel extends BaseModel {
  private noActionPromptCondition(): Prisma.AiSessionWhereInput {
    return {
      OR: [{ promptAction: null }, { promptAction: '' }],
    };
  }

  private async ensurePromptCompatRecord(prompt: ChatPrompt) {
    await this.db.aiPrompt.upsert({
      where: { name: prompt.name },
      update: {},
      create: {
        name: prompt.name,
        action: prompt.action,
        model: prompt.model,
        optionalModels: [],
        config: {},
      },
    });
  }

  private sanitizeString<T extends string | null | undefined>(value: T): T {
    if (typeof value !== 'string') {
      return value;
    }
    return value.replaceAll('\0', '') as T;
  }

  private sanitizeJsonValue<T>(value: T): T {
    if (typeof value === 'string') {
      return this.sanitizeString(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map(v => this.sanitizeJsonValue(v)) as T;
    }
    if (
      value &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.sanitizeJsonValue(v)])
      ) as T;
    }
    return value;
  }

  private sanitizeStreamObject(stream: ChatStreamObject): ChatStreamObject {
    switch (stream.type) {
      case 'text-delta':
      case 'reasoning':
        return {
          ...stream,
          textDelta: this.sanitizeString(stream.textDelta),
        };
      case 'tool-call':
        return {
          ...stream,
          toolCallId: this.sanitizeString(stream.toolCallId) ?? '',
          toolName: this.sanitizeString(stream.toolName) ?? '',
          args: this.sanitizeJsonValue(stream.args),
          rawArgumentsText: this.sanitizeString(stream.rawArgumentsText),
          argumentParseError: this.sanitizeString(stream.argumentParseError),
          thought: this.sanitizeString(stream.thought),
        };
      case 'tool-result':
        return {
          ...stream,
          toolCallId: this.sanitizeString(stream.toolCallId) ?? '',
          toolName: this.sanitizeString(stream.toolName) ?? '',
          args: this.sanitizeJsonValue(stream.args),
          result: this.sanitizeJsonValue(stream.result),
          rawArgumentsText: this.sanitizeString(stream.rawArgumentsText),
          argumentParseError: this.sanitizeString(stream.argumentParseError),
        };
    }
  }

  private sanitizeAttachments(
    attachments?: ChatAttachment[] | null
  ): ChatAttachment[] | undefined {
    if (!attachments?.length) {
      return undefined;
    }

    return attachments
      .map(attachment => {
        if (typeof attachment === 'string') {
          return this.sanitizeString(attachment) ?? '';
        }

        if ('attachment' in attachment) {
          return {
            attachment:
              this.sanitizeString(attachment.attachment) ??
              attachment.attachment,
            mimeType:
              this.sanitizeString(attachment.mimeType) ?? attachment.mimeType,
          };
        }

        switch (attachment.kind) {
          case 'url':
            return {
              ...attachment,
              url: this.sanitizeString(attachment.url) ?? attachment.url,
              mimeType:
                this.sanitizeString(attachment.mimeType) ?? attachment.mimeType,
              fileName:
                this.sanitizeString(attachment.fileName) ?? attachment.fileName,
              providerHint: attachment.providerHint
                ? {
                    provider:
                      this.sanitizeString(attachment.providerHint.provider) ??
                      attachment.providerHint.provider,
                    kind:
                      this.sanitizeString(attachment.providerHint.kind) ??
                      attachment.providerHint.kind,
                  }
                : undefined,
            };
          case 'data':
          case 'bytes':
            return {
              ...attachment,
              data: this.sanitizeString(attachment.data) ?? attachment.data,
              mimeType:
                this.sanitizeString(attachment.mimeType) ?? attachment.mimeType,
              fileName:
                this.sanitizeString(attachment.fileName) ?? attachment.fileName,
              providerHint: attachment.providerHint
                ? {
                    provider:
                      this.sanitizeString(attachment.providerHint.provider) ??
                      attachment.providerHint.provider,
                    kind:
                      this.sanitizeString(attachment.providerHint.kind) ??
                      attachment.providerHint.kind,
                  }
                : undefined,
            };
          case 'file_handle':
            return {
              ...attachment,
              fileHandle:
                this.sanitizeString(attachment.fileHandle) ??
                attachment.fileHandle,
              mimeType:
                this.sanitizeString(attachment.mimeType) ?? attachment.mimeType,
              fileName:
                this.sanitizeString(attachment.fileName) ?? attachment.fileName,
              providerHint: attachment.providerHint
                ? {
                    provider:
                      this.sanitizeString(attachment.providerHint.provider) ??
                      attachment.providerHint.provider,
                    kind:
                      this.sanitizeString(attachment.providerHint.kind) ??
                      attachment.providerHint.kind,
                  }
                : undefined,
            };
        }

        return attachment;
      })
      .filter(attachment => {
        if (typeof attachment === 'string') {
          return !!attachment;
        }
        if ('attachment' in attachment) {
          return !!attachment.attachment && !!attachment.mimeType;
        }

        switch (attachment.kind) {
          case 'url':
            return !!attachment.url;
          case 'data':
          case 'bytes':
            return !!attachment.data && !!attachment.mimeType;
          case 'file_handle':
            return !!attachment.fileHandle;
        }

        return false;
      });
  }

  private sanitizeMessage(message: ChatMessage): ChatMessage {
    return {
      ...message,
      compatSubmissionId: this.sanitizeString(message.compatSubmissionId),
      content: this.sanitizeString(message.content) ?? '',
      attachments: this.sanitizeAttachments(message.attachments),
      params: this.sanitizeJsonValue(
        omit(message.params, ['docs']) || undefined
      ),
      streamObjects: message.streamObjects?.map(o =>
        this.sanitizeStreamObject(o)
      ),
    };
  }

  private toPublicMessage(message: StoredChatMessage): CopilotChatMessage {
    const { compatSubmissionId: _compatSubmissionId, ...publicMessage } =
      message;
    return ChatMessageSchema.parse({
      ...publicMessage,
      attachments: publicMessage.attachments ?? undefined,
      streamObjects: publicMessage.streamObjects ?? undefined,
      params: publicMessage.params ?? undefined,
    });
  }

  private isCountedUserMessage(
    message: Pick<StoredChatMessage, 'role'>
  ): boolean {
    return message.role === AiPromptRole.user;
  }

  getSessionType(session: Pick<ChatSession, 'docId' | 'pinned'>): SessionType {
    if (session.pinned) return SessionType.Pinned;
    if (!session.docId) return SessionType.Workspace;
    return SessionType.Doc;
  }

  checkSessionPrompt(
    session: Pick<ChatSession, 'docId' | 'pinned'>,
    prompt: Partial<ChatPrompt>
  ): boolean {
    const sessionType = this.getSessionType(session);
    const { name: promptName, action: promptAction } = prompt;

    // workspace and pinned sessions cannot use action prompts
    if (
      [SessionType.Workspace, SessionType.Pinned].includes(sessionType) &&
      !!promptAction?.trim()
    ) {
      throw new CopilotPromptInvalid(
        `${promptName} are not allowed for ${sessionType} sessions`
      );
    }

    return true;
  }

  @Transactional()
  async create(state: ChatSession, reuseChat = false): Promise<string> {
    await this.assertForkParent(state);
    if (
      !state.workspaceId &&
      (!state.selectedContextProjectId || state.docId)
    ) {
      throw new CopilotSessionInvalidInput(
        'A native conversation requires its Project owner.'
      );
    }
    if (state.selectedContextProjectId) {
      await this.models.projectResource.assertMember({
        projectId: state.selectedContextProjectId,
        actorId: state.userId,
      });
      const membership = await this.db.aiContextProjectMember.findFirst({
        where: {
          projectId: state.selectedContextProjectId,
          userId: state.userId,
          project: { status: 'active' },
        },
        select: { projectId: true },
      });
      if (!membership || state.docId) {
        throw new CopilotSessionInvalidInput(
          'Select an active project you belong to in a project conversation.'
        );
      }
    }
    // find and return existing session if session is chat session
    if (reuseChat && !state.promptAction) {
      const sessionId = await this.find(state);
      if (sessionId) return sessionId;
    }

    if (state.pinned) {
      await this.unpin(
        state.workspaceId,
        state.userId,
        state.selectedContextProjectId
      );
    }

    const session = await this.db.aiSession.create({
      data: {
        id: state.sessionId,
        workspaceId: state.workspaceId,
        docId: state.docId,
        selectedContextProjectId: state.selectedContextProjectId,
        scopeType:
          !state.workspaceId && state.selectedContextProjectId
            ? 'project'
            : 'workspace',
        pinned: state.pinned ?? false,
        // connect
        userId: state.userId,
        promptName: state.promptName,
        promptAction: state.promptAction,
        parentSessionId: state.parentSessionId,
      },
      select: { id: true },
    });
    await this.db.aiSessionWorkState.create({
      data: { sessionId: session.id, ownerUserId: state.userId },
    });
    return session.id;
  }

  @Transactional()
  async createWithPrompt(
    state: ChatSessionWithPrompt,
    reuseChat = false
  ): Promise<string> {
    const { prompt, ...rest } = state;
    await this.ensurePromptCompatRecord(prompt);
    return await this.models.copilotSession.create(
      { ...rest, promptName: prompt.name, promptAction: prompt.action ?? null },
      reuseChat
    );
  }

  @Transactional()
  async fork(options: ForkSessionOptions): Promise<string> {
    if (!options.parentSessionId)
      throw new CopilotSessionInvalidInput(
        'A fork requires its source conversation.'
      );
    if (options.pinned) {
      await this.unpin(
        options.workspaceId,
        options.userId,
        options.selectedContextProjectId
      );
    }
    const { messages, ...forkedState } = options;

    // create session
    const sessionId = await this.createWithPrompt({
      ...forkedState,
      messages: [],
    });
    if (options.messages.length) {
      // save message
      await this.models.copilotSession.updateMessages({
        ...forkedState,
        sessionId,
        messages,
      });
    }

    return sessionId;
  }

  async assertForkParent(
    state: Pick<
      PureChatSession,
      | 'parentSessionId'
      | 'userId'
      | 'workspaceId'
      | 'docId'
      | 'selectedContextProjectId'
    >
  ) {
    if (!state.parentSessionId) return;
    const parent = await this.getMeta(state.parentSessionId);
    if (
      !parent ||
      parent.workspaceId !== state.workspaceId ||
      parent.selectedContextProjectId !==
        (state.selectedContextProjectId ?? null) ||
      (parent.selectedContextProjectId && state.docId) ||
      (parent.userId !== state.userId &&
        (parent.selectedContextProjectId ||
          !parent.parentSessionId ||
          !parent.docId ||
          parent.docId !== state.docId))
    ) {
      throw new CopilotSessionInvalidInput(
        'The source conversation is unavailable in this user, document, or project scope.'
      );
    }
    if (parent.selectedContextProjectId) {
      const member = await this.db.aiContextProjectMember.findFirst({
        where: {
          projectId: parent.selectedContextProjectId,
          userId: state.userId,
          project: { status: 'active' },
        },
        select: { projectId: true },
      });
      if (!member)
        throw new CopilotSessionInvalidInput(
          'The source project conversation is unavailable.'
        );
    }
  }

  @Transactional()
  async has(
    sessionId: string,
    userId: string,
    params?: Prisma.AiSessionCountArgs['where']
  ) {
    return await this.db.aiSession
      .count({ where: { id: sessionId, userId, ...params } })
      .then(c => c > 0);
  }

  @Transactional()
  async find(state: PureChatSession) {
    const extraCondition: Record<string, any> = {};
    if (state.parentSessionId) {
      // also check session id if provided session is forked session
      extraCondition.id = state.sessionId;
      extraCondition.parentSessionId = state.parentSessionId;
    }

    const session = await this.db.aiSession.findFirst({
      where: {
        userId: state.userId,
        workspaceId: state.workspaceId,
        docId: state.docId,
        parentSessionId: null,
        selectedContextProjectId: state.selectedContextProjectId ?? null,
        ...this.noActionPromptCondition(),
        ...extraCondition,
      },
      select: { id: true, deletedAt: true },
    });
    if (session?.deletedAt) throw new CopilotSessionDeleted();
    return session?.id;
  }

  @Transactional()
  async getExists<Select extends Prisma.AiSessionSelect>(
    sessionId: string,
    select?: Select,
    where?: Omit<Prisma.AiSessionWhereInput, 'id' | 'deletedAt'>
  ) {
    return (await this.db.aiSession.findUnique({
      where: { ...where, id: sessionId, deletedAt: null },
      select,
    })) as Prisma.AiSessionGetPayload<{ select: Select }> | null;
  }

  @Transactional()
  async get(sessionId: string) {
    return await this.getExists(sessionId, {
      id: true,
      userId: true,
      workspaceId: true,
      docId: true,
      selectedContextProjectId: true,
      scopeType: true,
      workOrderBinding: { select: { workOrderId: true } },
      parentSessionId: true,
      pinned: true,
      title: true,
      promptName: true,
      tokenCost: true,
      contextEpoch: true,
      allowMemoryCapture: true,
      memoryCaptureRevision: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        select: {
          id: true,
          role: true,
          content: true,
          attachments: true,
          streamObjects: true,
          params: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    });
  }

  @Transactional()
  async getMeta(sessionId: string) {
    return await this.getExists(sessionId, {
      id: true,
      userId: true,
      workspaceId: true,
      docId: true,
      selectedContextProjectId: true,
      scopeType: true,
      workOrderBinding: { select: { workOrderId: true } },
      parentSessionId: true,
      pinned: true,
      title: true,
      promptName: true,
      tokenCost: true,
      contextEpoch: true,
      allowMemoryCapture: true,
      memoryCaptureRevision: true,
      createdAt: true,
      updatedAt: true,
    });
  }

  async getProjectMemoryCapture(userId: string, sessionId: string) {
    return await this.db.aiSession.findFirst({
      where: {
        id: sessionId,
        userId,
        deletedAt: null,
        scopeType: 'project',
        selectedContextProjectId: { not: null },
        selectedContextProject: {
          status: 'active',
          members: { some: { userId } },
        },
      },
      select: {
        id: true,
        selectedContextProjectId: true,
        allowMemoryCapture: true,
        memoryCaptureRevision: true,
      },
    });
  }

  @Transactional()
  async updateProjectMemoryCapture(input: {
    userId: string;
    sessionId: string;
    allowMemoryCapture: boolean;
    expectedRevision: number;
  }) {
    if (!input.allowMemoryCapture) {
      throw new CopilotSessionInvalidInput(
        'Project conversations always allow automatic memory contribution.'
      );
    }
    const current = await this.getProjectMemoryCapture(
      input.userId,
      input.sessionId
    );
    if (!current) throw new CopilotSessionNotFound();
    const updated = await this.db.aiSession.updateMany({
      where: {
        id: input.sessionId,
        userId: input.userId,
        deletedAt: null,
        selectedContextProjectId: current.selectedContextProjectId,
        memoryCaptureRevision: input.expectedRevision,
      },
      data: {
        allowMemoryCapture: input.allowMemoryCapture,
        memoryCaptureRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new CopilotSessionInvalidInput(
        'Session memory contribution setting changed; reload first'
      );
    }
    return await this.getProjectMemoryCapture(input.userId, input.sessionId);
  }

  private getListConditions(
    options: ListSessionOptions
  ): Prisma.AiSessionWhereInput {
    const { userId, sessionId, workspaceId, docId, action, fork } = options;

    function getEqCond<T>(maybeValue: T | undefined): T | undefined {
      return maybeValue !== undefined ? maybeValue : undefined;
    }

    const conditions: Prisma.AiSessionWhereInput['OR'] = [
      {
        userId,
        workspaceId,
        selectedContextProjectId: options.selectedContextProjectId,
        docId: getEqCond(docId),
        id: getEqCond(sessionId),
        deletedAt: null,
        pinned: getEqCond(options.pinned),
        AND: [
          {
            OR: [
              { selectedContextProjectId: null },
              {
                selectedContextProject: {
                  status: 'active',
                  members: { some: { userId } },
                },
              },
            ],
          },
        ],
        ...(action === false ? this.noActionPromptCondition() : {}),
        ...(action === true ? { NOT: this.noActionPromptCondition() } : {}),
        ...(fork === true
          ? { parentSessionId: { not: null } }
          : fork === false
            ? { parentSessionId: null }
            : {}),
      },
    ];

    if (!action && fork && docId) {
      // query forked sessions from other users
      // only query forked session if fork == true and action == false
      conditions.push({
        userId: { not: userId },
        workspaceId: workspaceId,
        docId: docId ?? null,
        id: getEqCond(sessionId),
        ...this.noActionPromptCondition(),
        // should only find forked session
        parentSessionId: { not: null },
        selectedContextProjectId: null,
        deletedAt: null,
      });
    }

    return { OR: conditions };
  }

  async count(options: ListSessionOptions) {
    return await this.db.aiSession.count({
      where: this.getListConditions(options),
    });
  }

  async list(options: ListSessionOptions) {
    return await this.db.aiSession.findMany({
      where: this.getListConditions(options),
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        docId: true,
        selectedContextProjectId: true,
        scopeType: true,
        workOrderBinding: { select: { workOrderId: true } },
        parentSessionId: true,
        pinned: true,
        title: true,
        promptName: true,
        tokenCost: true,
        createdAt: true,
        updatedAt: true,
        messages: options.withMessages
          ? {
              select: {
                id: true,
                role: true,
                content: true,
                attachments: true,
                streamObjects: true,
                params: true,
                createdAt: true,
              },
              orderBy: [
                {
                  // message order is asc by default
                  createdAt: options?.messageOrder === 'desc' ? 'desc' : 'asc',
                },
                { id: options?.messageOrder === 'desc' ? 'desc' : 'asc' },
              ],
            }
          : false,
      },
      take: options?.limit,
      skip: options?.skip,
      orderBy: {
        updatedAt: options?.sessionOrder === 'asc' ? 'asc' : 'desc',
      },
    });
  }

  @Transactional()
  async unpin(
    workspaceId: string | null,
    userId: string,
    selectedContextProjectId?: string | null
  ): Promise<boolean> {
    if (!workspaceId && !selectedContextProjectId)
      throw new CopilotSessionInvalidInput('Project scope is required.');
    const { count } = await this.db.aiSession.updateMany({
      where: {
        userId,
        workspaceId,
        ...(!workspaceId ? { selectedContextProjectId } : {}),
        pinned: true,
        deletedAt: null,
      },
      data: { pinned: false },
    });

    return count > 0;
  }

  @Transactional()
  async update(
    options: UpdateChatSessionOptions,
    internalCall = false
  ): Promise<string> {
    const {
      userId,
      sessionId,
      docId,
      selectedContextProjectId,
      promptName,
      pinned,
      title,
    } = options;
    const sanitizedTitle = this.sanitizeString(title);
    const session = await this.getExists(
      sessionId,
      {
        id: true,
        workspaceId: true,
        docId: true,
        parentSessionId: true,
        pinned: true,
        promptAction: true,
        selectedContextProjectId: true,
        messages: { select: { id: true }, take: 1 },
      },
      { userId }
    );
    if (!session) {
      throw new CopilotSessionNotFound();
    }

    if (session.selectedContextProjectId) {
      await this.models.projectResource.assertMember({
        projectId: session.selectedContextProjectId,
        actorId: userId,
      });
    }

    if (
      docId &&
      (session.selectedContextProjectId || selectedContextProjectId)
    ) {
      throw new CopilotSessionInvalidInput(
        'A project conversation cannot become a document-side conversation.'
      );
    }

    if (
      selectedContextProjectId !== undefined &&
      selectedContextProjectId !== session.selectedContextProjectId
    ) {
      if (session.selectedContextProjectId || session.messages.length) {
        throw new CopilotSessionInvalidInput(
          'This conversation cannot change projects. Start a new conversation in the selected project.'
        );
      }
      if (selectedContextProjectId) {
        const membership = await this.db.aiContextProjectMember.findFirst({
          where: {
            projectId: selectedContextProjectId,
            userId,
            project: { status: 'active' },
          },
          select: { projectId: true },
        });
        if (!membership || session.docId || docId) {
          throw new CopilotSessionInvalidInput(
            'Select an active project you belong to in a project conversation.'
          );
        }
      }
    }

    // not allow to update action session
    if (!internalCall) {
      if (session.promptAction) {
        throw new CopilotSessionInvalidInput(
          `Cannot update action: ${session.id}`
        );
      } else if (docId && session.parentSessionId) {
        throw new CopilotSessionInvalidInput(
          `Cannot update docId for forked session: ${session.id}`
        );
      }
    }

    let nextPromptAction: string | null | undefined;
    if (promptName) {
      if (options.promptModel) {
        await this.ensurePromptCompatRecord({
          name: promptName,
          action: options.promptAction,
          model: options.promptModel,
        });
      }
      nextPromptAction = options.promptAction;
      if (nextPromptAction === undefined) {
        const prompt = await this.db.aiPrompt.findFirst({
          where: { name: promptName },
          select: { action: true },
        });
        if (!prompt) {
          throw new CopilotSessionInvalidInput(
            `Prompt ${promptName} not found or not available for session ${sessionId}`
          );
        }
        nextPromptAction = prompt.action ?? null;
      }
      if (nextPromptAction) {
        throw new CopilotSessionInvalidInput(
          `Prompt ${promptName} not found or not available for session ${sessionId}`
        );
      }
    }
    if (pinned && pinned !== session.pinned) {
      // if pin the session, unpin exists session in the workspace
      await this.unpin(
        session.workspaceId,
        userId,
        session.selectedContextProjectId
      );
    }

    const updated = await this.db.aiSession.updateMany({
      where: {
        id: sessionId,
        ...(selectedContextProjectId !== undefined &&
        selectedContextProjectId !== session.selectedContextProjectId
          ? {
              selectedContextProjectId: session.selectedContextProjectId,
              messages: { none: {} },
            }
          : {}),
      },
      data: {
        docId,
        selectedContextProjectId,
        promptName,
        promptAction: nextPromptAction,
        pinned,
        title: sanitizedTitle,
        ...(sanitizedTitle !== undefined
          ? sanitizedTitle
            ? {
                titleSource: 'manual',
                titleGenerationStatus: 'complete',
                titleRevision: { increment: 1 },
              }
            : {
                titleSource: 'pending',
                titleGenerationStatus: 'pending',
                titleRevision: { increment: 1 },
              }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new CopilotSessionInvalidInput(
        'Conversation changed while selecting its project. Start a new conversation.'
      );
    }

    return sessionId;
  }

  @Transactional()
  async cleanup(options: CleanupSessionOptions): Promise<string[]> {
    const retentionPolicy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    const deletionHeld =
      retentionPolicy?.legalHold === true ||
      retentionPolicy?.retentionFrozen === true;
    const sessions = await this.db.aiSession.findMany({
      where: {
        id: { in: options.sessionIds },
        userId: options.userId,
        workspaceId: options.workspaceId,
        selectedContextProjectId: options.selectedContextProjectId,
        docId: options.docId,
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        selectedContextProjectId: true,
        contextEpoch: true,
      },
    });

    const accepted: string[] = [];
    for (const session of sessions) {
      const contextEpoch = session.contextEpoch + 1;
      const deleted = await this.db.aiSession.updateMany({
        where: {
          id: session.id,
          userId: options.userId,
          deletedAt: null,
          contextEpoch: session.contextEpoch,
        },
        data: {
          pinned: false,
          title: null,
          deletedAt: new Date(),
          contextEpoch,
          allowMemoryCapture: false,
          memoryCaptureRevision: { increment: 1 },
        },
      });
      if (deleted.count !== 1) continue;
      await this.db.aiSessionDeletion.create({
        data: {
          sessionId: session.id,
          ownerUserIdSnapshot: session.userId,
          workspaceIdSnapshot: session.workspaceId,
          projectIdSnapshot: session.selectedContextProjectId,
          contextEpoch,
          status: deletionHeld ? 'held' : 'requested',
          holdReason: deletionHeld ? 'instance_retention_hold' : null,
          heldAt: deletionHeld ? new Date() : null,
          requestFingerprint: createHash('sha256')
            .update(
              JSON.stringify({
                operation: 'delete-session/v1',
                sessionId: session.id,
                actorId: options.userId,
                contextEpoch,
              })
            )
            .digest('hex'),
          progress: {
            onlineContent: 'pending',
            ...(deletionHeld ? { hold: 'active' } : {}),
            sharedProjectMemory: 'preserved',
          },
        },
      });
      accepted.push(session.id);
    }
    return accepted;
  }

  async listDueSessionDeletions(limit = 100) {
    const retentionPolicy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    if (
      retentionPolicy &&
      !retentionPolicy.legalHold &&
      !retentionPolicy.retentionFrozen
    ) {
      await this.db.aiSessionDeletion.updateMany({
        where: { status: 'held', holdReason: 'instance_retention_hold' },
        data: {
          status: 'retry_wait',
          holdReason: null,
          releasedAt: new Date(),
          nextAttemptAt: new Date(),
        },
      });
    }
    const now = new Date();
    return await this.db.aiSessionDeletion.findMany({
      where: {
        OR: [
          {
            status: { in: ['requested', 'retry_wait'] },
            nextAttemptAt: { lte: now },
          },
          { status: 'purging', workerLeaseExpiresAt: { lte: now } },
        ],
      },
      select: { id: true, sessionId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { requestedAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async getSessionDeletion(sessionId: string, actorUserId: string) {
    return await this.db.aiSessionDeletion.findFirst({
      where: { sessionId, ownerUserIdSnapshot: actorUserId },
    });
  }

  @Transactional()
  async retrySessionDeletion(sessionId: string, actorUserId: string) {
    const deletion = await this.db.aiSessionDeletion.findFirst({
      where: {
        sessionId,
        ownerUserIdSnapshot: actorUserId,
        status: 'failed',
      },
    });
    if (!deletion) return this.getSessionDeletion(sessionId, actorUserId);
    const retentionPolicy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    const held =
      retentionPolicy?.legalHold === true ||
      retentionPolicy?.retentionFrozen === true;
    return await this.db.aiSessionDeletion.update({
      where: { id: deletion.id },
      data: {
        status: held ? 'held' : 'retry_wait',
        holdReason: held ? 'instance_retention_hold' : null,
        heldAt: held ? new Date() : deletion.heldAt,
        releasedAt: held ? deletion.releasedAt : new Date(),
        nextAttemptAt: new Date(),
        maxAttempts: Math.max(deletion.maxAttempts, deletion.attempt + 3),
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  @Transactional()
  async claimSessionDeletion(input: {
    sessionId: string;
    leaseId: string;
    leaseExpiresAt: Date;
  }) {
    const retentionPolicy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    if (
      retentionPolicy?.legalHold === true ||
      retentionPolicy?.retentionFrozen === true
    ) {
      await this.db.aiSessionDeletion.updateMany({
        where: {
          sessionId: input.sessionId,
          status: { in: ['requested', 'retry_wait'] },
        },
        data: {
          status: 'held',
          holdReason: 'instance_retention_hold',
          heldAt: new Date(),
        },
      });
      return null;
    }
    const now = new Date();
    const claimed = await this.db.aiSessionDeletion.updateMany({
      where: {
        sessionId: input.sessionId,
        OR: [
          {
            status: { in: ['requested', 'retry_wait'] },
            nextAttemptAt: { lte: now },
          },
          { status: 'purging', workerLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: 'purging',
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: input.leaseExpiresAt,
        attempt: { increment: 1 },
        failureCode: null,
        failureMessage: null,
      },
    });
    if (claimed.count !== 1) return null;
    return await this.db.aiSessionDeletion.findUnique({
      where: { sessionId: input.sessionId },
    });
  }

  @Transactional()
  async purgeSessionDeletion(input: {
    sessionId: string;
    leaseId: string;
    contextEpoch: number;
  }) {
    const deletion = await this.db.aiSessionDeletion.findFirst({
      where: {
        sessionId: input.sessionId,
        status: 'purging',
        workerLeaseId: input.leaseId,
        contextEpoch: input.contextEpoch,
      },
    });
    if (!deletion) return null;
    const retentionPolicy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    if (
      retentionPolicy?.legalHold === true ||
      retentionPolicy?.retentionFrozen === true
    ) {
      await this.db.aiSessionDeletion.update({
        where: { id: deletion.id },
        data: {
          status: 'held',
          holdReason: 'instance_retention_hold',
          heldAt: new Date(),
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
        },
      });
      return null;
    }
    const session = await this.db.aiSession.findFirst({
      where: {
        id: input.sessionId,
        deletedAt: { not: null },
        contextEpoch: input.contextEpoch,
      },
      select: { id: true },
    });
    if (!session) throw new Error('SESSION_DELETE_EPOCH_STALE');

    await this.db.$executeRaw`
      SELECT
        set_config('localmind.ai_session_purge_id', ${input.sessionId}, true),
        set_config('localmind.ai_session_purge_lease', ${input.leaseId}, true)
    `;

    const existingProgress =
      deletion.progress &&
      typeof deletion.progress === 'object' &&
      !Array.isArray(deletion.progress)
        ? (deletion.progress as Prisma.JsonObject)
        : {};
    if (existingProgress.onlineContent === 'completed') {
      const resultCounts =
        deletion.resultCounts &&
        typeof deletion.resultCounts === 'object' &&
        !Array.isArray(deletion.resultCounts)
          ? (deletion.resultCounts as Prisma.JsonObject)
          : {};
      const pendingProjectBlobs = await this.db.projectBlob.count({
        where: { pendingDeletionId: deletion.id },
      });
      if (!pendingProjectBlobs) {
        await this.completeSessionDeletionRecord({
          deletionId: deletion.id,
          sessionId: input.sessionId,
          leaseId: input.leaseId,
          contextEpoch: input.contextEpoch,
          resultCounts,
        });
      }
      return resultCounts;
    }

    const runIds = (
      await this.db.aiAgentRun.findMany({
        where: { sessionId: input.sessionId },
        select: { id: true },
      })
    ).map(run => run.id);
    const projectBlobReferences =
      await this.db.aiSessionProjectBlobReference.findMany({
        where: { sessionId: input.sessionId },
        select: { projectId: true, blobKey: true },
      });

    // Compaction tasks contain private summary payloads and may reference the
    // immutable checkpoints deleted below. Remove every terminal/in-flight
    // task before the checkpoint batch so no private candidate survives purge.
    const compactions = await this.db.aiContextCompactionTask.deleteMany({
      where: { sessionId: input.sessionId },
    });

    const [messages, contexts, projectContexts, checkpoints, traces, sources] =
      await Promise.all([
        this.db.aiSessionMessage.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiContext.deleteMany({ where: { sessionId: input.sessionId } }),
        this.db.projectChatContext.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiContextCheckpoint.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiContextPlanTrace.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiSessionContextSource.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiSessionProjectBlobReference.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiContextRuleHit.deleteMany({
          where: { sessionId: input.sessionId },
        }),
        this.db.aiContextPolicyHit.deleteMany({
          where: { sessionId: input.sessionId },
        }),
      ]);

    await Promise.all([
      this.db.aiContextMemory.updateMany({
        where: { sourceSessionId: input.sessionId },
        data: { sourceSessionId: null },
      }),
      this.db.aiContextMemoryEvent.updateMany({
        where: { sourceSessionId: input.sessionId },
        data: { sourceSessionId: null },
      }),
      this.db.aiContextMemoryContribution.updateMany({
        where: { sourceSessionId: input.sessionId },
        data: { sourceSessionId: null },
      }),
      this.db.aiProjectMemoryConflict.updateMany({
        where: { sourceSessionId: input.sessionId },
        data: { sourceSessionId: null },
      }),
      this.db.aiSharedWriteSourceCheck.updateMany({
        where: { sessionId: input.sessionId },
        data: { sources: [], audienceEvidence: {} },
      }),
      this.db.aiActionRun.updateMany({
        where: { sessionId: input.sessionId },
        data: {
          sessionId: null,
          userMessageId: null,
          assistantMessageId: null,
          compatSubmissionId: null,
          inputSnapshot: Prisma.DbNull,
          result: Prisma.DbNull,
          artifacts: Prisma.DbNull,
          resultSummary: null,
          trace: Prisma.DbNull,
        },
      }),
      ...(runIds.length
        ? [
            this.db.aiAgentStep.updateMany({
              where: { runId: { in: runIds } },
              data: { input: Prisma.DbNull, outputSummary: {}, title: null },
            }),
            this.db.aiAgentTimelineEvent.updateMany({
              where: { runId: { in: runIds } },
              data: { summary: '', payload: {} },
            }),
            this.db.aiAgentRuntimeExecutionResult.updateMany({
              where: { runId: { in: runIds } },
              data: { summary: '', resultPayload: {}, failureMessage: null },
            }),
            this.db.aiAgentRun.updateMany({
              where: { id: { in: runIds } },
              data: { sessionId: null, title: null, failureMessage: null },
            }),
          ]
        : []),
    ]);

    let projectBlobsMarked = 0;
    for (const reference of projectBlobReferences) {
      projectBlobsMarked += await this.db.$executeRaw`
        UPDATE "project_blobs" blob
        SET "pending_deletion_id" = ${deletion.id},
            "deletion_pending_at" = CURRENT_TIMESTAMP
        WHERE blob."project_id" = ${reference.projectId}
          AND blob."key" = ${reference.blobKey}
          AND blob."pending_deletion_id" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "ai_session_project_blob_references" context_ref
            WHERE context_ref."project_id" = blob."project_id"
              AND context_ref."blob_key" = blob."key"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "project_resource_revisions" revision
            WHERE revision."project_id" = blob."project_id"
              AND revision."blob_key" = blob."key"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "project_resource_attachments" attachment
            WHERE attachment."project_id" = blob."project_id"
              AND attachment."key" = blob."key"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "office_artifacts" artifact
            WHERE artifact."project_id" = blob."project_id"
              AND artifact."source_blob_key" = blob."key"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "office_revisions" revision
            WHERE revision."project_id" = blob."project_id"
              AND (
                revision."package_blob_key" = blob."key"
                OR revision."state_blob_key" = blob."key"
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM "office_command_requests" request
            WHERE request."project_id" = blob."project_id"
              AND request."command_blob_key" = blob."key"
          )
      `;
    }

    const baseResultCounts = {
      messages: messages.count,
      contexts: contexts.count,
      projectContexts: projectContexts.count,
      compactions: compactions.count,
      checkpoints: checkpoints.count,
      traces: traces.count,
      sources: sources.count,
      redactedAgentRuns: runIds.length,
    };
    const resultCounts = projectBlobsMarked
      ? { ...baseResultCounts, projectBlobsMarked }
      : baseResultCounts;
    const pendingProjectBlobs = await this.db.projectBlob.count({
      where: { pendingDeletionId: deletion.id },
    });
    if (pendingProjectBlobs) {
      const updated = await this.db.aiSessionDeletion.updateMany({
        where: {
          id: deletion.id,
          status: 'purging',
          workerLeaseId: input.leaseId,
          contextEpoch: input.contextEpoch,
        },
        data: {
          progress: {
            onlineContent: 'completed',
            projectBlobCleanup: 'pending',
            pendingProjectBlobs,
            sharedProjectMemory: 'preserved',
          },
          resultCounts,
        },
      });
      if (updated.count !== 1) throw new Error('SESSION_DELETE_LEASE_LOST');
      return resultCounts;
    }
    await this.completeSessionDeletionRecord({
      deletionId: deletion.id,
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      contextEpoch: input.contextEpoch,
      resultCounts,
    });
    return resultCounts;
  }

  private async completeSessionDeletionRecord(input: {
    deletionId: string;
    sessionId: string;
    leaseId: string;
    contextEpoch: number;
    resultCounts: Prisma.JsonObject;
  }) {
    const receiptFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          deletionId: input.deletionId,
          sessionId: input.sessionId,
          contextEpoch: input.contextEpoch,
          resultCounts: input.resultCounts,
        })
      )
      .digest('hex');
    const completed = await this.db.aiSessionDeletion.updateMany({
      where: {
        id: input.deletionId,
        status: 'purging',
        workerLeaseId: input.leaseId,
        contextEpoch: input.contextEpoch,
      },
      data: {
        status: 'completed',
        progress: {
          onlineContent: 'completed',
          projectBlobCleanup: 'completed',
          sharedProjectMemory: 'preserved',
        },
        resultCounts: input.resultCounts,
        receiptFingerprint,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) throw new Error('SESSION_DELETE_LEASE_LOST');
  }

  @Transactional()
  async completeSessionDeletion(input: {
    sessionId: string;
    leaseId: string;
    contextEpoch: number;
  }) {
    const deletion = await this.db.aiSessionDeletion.findFirst({
      where: {
        sessionId: input.sessionId,
        status: 'purging',
        workerLeaseId: input.leaseId,
        contextEpoch: input.contextEpoch,
      },
    });
    if (!deletion) return null;
    if (
      await this.db.projectBlob.count({
        where: { pendingDeletionId: deletion.id },
      })
    ) {
      throw new Error('SESSION_DELETE_PROJECT_BLOB_PENDING');
    }
    const resultCounts =
      deletion.resultCounts &&
      typeof deletion.resultCounts === 'object' &&
      !Array.isArray(deletion.resultCounts)
        ? (deletion.resultCounts as Prisma.JsonObject)
        : {};
    await this.completeSessionDeletionRecord({
      deletionId: deletion.id,
      ...input,
      resultCounts,
    });
    return await this.db.aiSessionDeletion.findUnique({
      where: { id: deletion.id },
    });
  }

  @Transactional()
  async failSessionDeletion(input: {
    sessionId: string;
    leaseId: string;
    failureCode: string;
  }) {
    const current = await this.db.aiSessionDeletion.findFirst({
      where: {
        sessionId: input.sessionId,
        status: 'purging',
        workerLeaseId: input.leaseId,
      },
      select: { id: true, attempt: true, maxAttempts: true },
    });
    if (!current) return null;
    const exhausted = current.attempt >= current.maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.max(current.attempt - 1, 0));
    return await this.db.aiSessionDeletion.update({
      where: { id: current.id },
      data: {
        status: exhausted ? 'failed' : 'retry_wait',
        failureCode: input.failureCode,
        failureMessage: 'Session content purge did not complete',
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    });
  }

  @Transactional()
  async getMessages(
    sessionId: string,
    select?: Prisma.AiSessionMessageSelect,
    orderBy?: Prisma.AiSessionMessageOrderByWithRelationInput
  ) {
    return this.db.aiSessionMessage.findMany({
      where: { sessionId },
      select,
      orderBy: orderBy ?? { createdAt: 'asc' },
    });
  }

  @Transactional()
  async getMessage(sessionId: string, messageId: string) {
    const message = await this.db.aiSessionMessage.findFirst({
      where: { id: messageId, sessionId },
      select: {
        id: true,
        compatSubmissionId: true,
        role: true,
        content: true,
        attachments: true,
        streamObjects: true,
        params: true,
        createdAt: true,
      },
    });

    return message ? this.toPublicMessage(message) : null;
  }

  @Transactional()
  async findMessageByCompatSubmissionId(
    sessionId: string,
    compatSubmissionId: string
  ) {
    const message = await this.db.aiSessionMessage.findFirst({
      where: { sessionId, compatSubmissionId },
      select: {
        id: true,
        compatSubmissionId: true,
        role: true,
        content: true,
        attachments: true,
        streamObjects: true,
        params: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return message ? this.toPublicMessage(message) : null;
  }

  private calculateTokenSize(messages: any[], model: string): number {
    const encoder = getTokenEncoder(model);
    const content = messages.map(m => m.content).join('');
    return encoder?.count(content) || 0;
  }

  @Transactional()
  async updateMessages(state: UpdateChatSessionMessage) {
    const { sessionId, userId, messages } = state;
    await this.assertMessageWriter(sessionId, userId);

    if (messages.length) {
      const sanitizedMessages = messages.map(m => this.sanitizeMessage(m));
      const tokenCost = this.calculateTokenSize(
        sanitizedMessages,
        state.prompt.model
      );
      await this.db.aiSessionMessage.createMany({
        data: sanitizedMessages.map(m => ({
          compatSubmissionId: m.compatSubmissionId || undefined,
          role: m.role,
          content: m.content,
          attachments: m.attachments || undefined,
          params: m.params || undefined,
          streamObjects: m.streamObjects || undefined,
          createdAt: m.createdAt,
          sessionId,
        })),
      });

      // only count message generated by user
      const userMessages = sanitizedMessages.filter(m => m.role === 'user');
      await this.db.aiSession.update({
        where: { id: sessionId },
        data: {
          messageCost: { increment: userMessages.length },
          tokenCost: { increment: tokenCost },
        },
      });
      if (userMessages.length) {
        await this.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
          sessionId,
          userId
        );
      }
    }
  }

  @Transactional()
  async appendMessage(state: {
    sessionId: string;
    userId: string;
    prompt: { model: string };
    message: ChatMessage;
  }) {
    await this.assertMessageWriter(state.sessionId, state.userId);

    const message = this.sanitizeMessage(state.message);
    const tokenCost = this.calculateTokenSize([message], state.prompt.model);

    const created = await this.db.aiSessionMessage.create({
      data: {
        sessionId: state.sessionId,
        compatSubmissionId: message.compatSubmissionId || undefined,
        role: message.role,
        content: message.content,
        attachments: message.attachments || undefined,
        params: message.params || undefined,
        streamObjects: message.streamObjects || undefined,
        createdAt: message.createdAt,
      },
      select: {
        id: true,
        compatSubmissionId: true,
        role: true,
        content: true,
        attachments: true,
        streamObjects: true,
        params: true,
        createdAt: true,
      },
    });

    await this.db.aiSession.update({
      where: { id: state.sessionId },
      data: {
        messageCost:
          message.role === AiPromptRole.user ? { increment: 1 } : undefined,
        tokenCost: { increment: tokenCost },
      },
    });
    if (message.role === AiPromptRole.user) {
      await this.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
        state.sessionId,
        state.userId
      );
    }

    return this.toPublicMessage(created);
  }

  private async assertMessageWriter(sessionId: string, userId: string) {
    const session = await this.getMeta(sessionId);
    if (!session || session.userId !== userId)
      throw new CopilotSessionNotFound();
    if (session.selectedContextProjectId) {
      await this.models.projectResource.assertMember({
        projectId: session.selectedContextProjectId,
        actorId: userId,
      });
    }
  }

  @Transactional()
  async trimAfterMessage(
    sessionId: string,
    messageId: string,
    removeTargetMessage = false
  ) {
    const session = await this.getExists(sessionId, {
      id: true,
    });
    if (!session) {
      throw new CopilotSessionNotFound();
    }

    const messages = await this.getMessages(
      sessionId,
      { id: true, role: true, content: true, params: true },
      { createdAt: 'asc' }
    );
    const messageIndex = messages.findIndex(({ id }) => id === messageId);
    if (messageIndex < 0) {
      throw new CopilotSessionNotFound();
    }

    const ids = messages
      .slice(messageIndex + (removeTargetMessage ? 0 : 1))
      .map(({ id }) => id);

    if (!ids.length) {
      return;
    }

    await this.db.aiSessionMessage.deleteMany({ where: { id: { in: ids } } });

    const remainingMessages = await this.getMessages(sessionId, {
      role: true,
    });
    const userMessageCount = remainingMessages.filter(message =>
      this.isCountedUserMessage(message)
    ).length;

    if (userMessageCount <= 1) {
      await this.db.aiSession.update({
        where: { id: sessionId },
        data: {
          title: null,
          titleSource: 'pending',
          titleGenerationStatus: 'pending',
          titleRevision: { increment: 1 },
        },
      });
    }
  }

  @Transactional()
  async revertLatestMessage(
    sessionId: string,
    removeLatestUserMessage: boolean
  ) {
    const session = await this.getExists(sessionId, {
      id: true,
    });
    if (!session) {
      throw new CopilotSessionNotFound();
    }
    const messages = await this.getMessages(session.id, {
      id: true,
      role: true,
      content: true,
    });
    const ids = messages
      .slice(
        messages.findLastIndex(({ role }) => role === AiPromptRole.user) +
          (removeLatestUserMessage ? 0 : 1)
      )
      .map(({ id }) => id);

    if (ids.length) {
      await this.db.aiSessionMessage.deleteMany({ where: { id: { in: ids } } });

      // clear the title if there only one round of conversation left
      const remainingMessages = await this.getMessages(session.id, {
        role: true,
      });
      const userMessageCount = remainingMessages.filter(message =>
        this.isCountedUserMessage(message)
      ).length;

      if (userMessageCount <= 1) {
        await this.db.aiSession.update({
          where: { id: session.id },
          data: {
            title: null,
            titleSource: 'pending',
            titleGenerationStatus: 'pending',
            titleRevision: { increment: 1 },
          },
        });
      }
    }
  }

  @Transactional()
  async countUserMessages(userId: string): Promise<number> {
    const sessions = await this.db.aiSession.findMany({
      where: { userId },
      select: { messageCost: true, promptAction: true },
    });
    const regularMessageCost = sessions
      .filter(({ promptAction }) => !promptAction)
      .map(({ messageCost }) => messageCost)
      .reduce((prev, cost) => prev + cost, 0);
    const [
      actionRunCost,
      legacyActionSessionCost,
      transcriptSettlementCost,
      byokQuotaExemptCost,
    ] = await Promise.all([
      this.models.copilotActionRun.countSucceededByUser(userId),
      this.models.copilotActionRun.countLegacyPromptActionSessionsWithoutRun(
        userId
      ),
      this.models.copilotTranscriptTask.countSettledByUser(userId),
      this.models.copilotUsage.countQuotaExemptByokUsage(userId),
    ]);
    const quotaBackedCost =
      regularMessageCost +
      actionRunCost +
      legacyActionSessionCost +
      transcriptSettlementCost -
      byokQuotaExemptCost;
    return Math.max(0, quotaBackedCost);
  }

  async cleanupEmptySessions(earlyThen: Date) {
    // delete never used sessions
    const { count: removed } = await this.db.aiSession.deleteMany({
      where: {
        messageCost: 0,
        deletedAt: null,
        // filter session updated more than 24 hours ago
        updatedAt: { lt: earlyThen },
      },
    });

    // mark empty sessions as deleted
    const { count: cleaned } = await this.db.aiSession.updateMany({
      where: {
        deletedAt: null,
        messages: { none: {} },
        // filter session updated more than 24 hours ago
        updatedAt: { lt: earlyThen },
      },
      data: {
        deletedAt: new Date(),
        pinned: false,
      },
    });

    return { removed, cleaned };
  }

  @Transactional()
  async toBeGenerateTitle() {
    const sessions = await this.db.aiSession
      .findMany({
        where: {
          title: null,
          titleSource: 'pending',
          titleGenerationStatus: { in: ['pending', 'failed'] },
          deletedAt: null,
          messages: { some: {} },
          // only generate titles for non-actions sessions
          ...this.noActionPromptCondition(),
        },
        select: {
          id: true,
          // count assistant messages
          _count: { select: { messages: { where: { role: 'assistant' } } } },
        },
        orderBy: { updatedAt: 'desc' },
      })
      .then(s => s.filter(s => s._count.messages > 0));

    return sessions;
  }

  @Transactional()
  async beginTitleGeneration(sessionId: string) {
    const claimed = await this.db.aiSession.updateMany({
      where: {
        id: sessionId,
        deletedAt: null,
        title: null,
        titleSource: 'pending',
        titleGenerationStatus: { in: ['pending', 'failed'] },
      },
      data: { titleGenerationStatus: 'generating' },
    });
    if (claimed.count !== 1) return null;
    return await this.db.aiSession.findUnique({
      where: { id: sessionId },
      select: { titleRevision: true },
    });
  }

  @Transactional()
  async applyGeneratedTitle(input: {
    sessionId: string;
    expectedRevision: number;
    title: string;
  }) {
    const title = this.sanitizeString(input.title).trim();
    if (!title) return false;
    const applied = await this.db.aiSession.updateMany({
      where: {
        id: input.sessionId,
        deletedAt: null,
        title: null,
        titleSource: 'pending',
        titleGenerationStatus: 'generating',
        titleRevision: input.expectedRevision,
      },
      data: {
        title,
        titleSource: 'generated',
        titleGenerationStatus: 'complete',
        titleRevision: { increment: 1 },
      },
    });
    return applied.count === 1;
  }

  @Transactional()
  async failTitleGeneration(sessionId: string, expectedRevision: number) {
    const failed = await this.db.aiSession.updateMany({
      where: {
        id: sessionId,
        deletedAt: null,
        title: null,
        titleSource: 'pending',
        titleGenerationStatus: 'generating',
        titleRevision: expectedRevision,
      },
      data: { titleGenerationStatus: 'failed' },
    });
    return failed.count === 1;
  }
}
