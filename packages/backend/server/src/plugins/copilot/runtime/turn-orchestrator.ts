import type { OfficeAiContext } from '@localmind/office';
import { Injectable, Optional } from '@nestjs/common';

import { BadRequest } from '../../../base';
import { Models } from '../../../models';
import { CopilotContextService } from '../context/service';
import { type Turn } from '../core';
import { OfficeAgentCommandService } from '../office-agent-command';
import { ProjectContextService } from '../project-context-service';
import {
  ModelInputType,
  type PromptMessage,
  type PromptParams,
  type StreamObject,
} from '../providers/types';
import { ChatSession } from '../session';
import { PROJECT_COLLABORATION_POLICY } from '../tools/project-file-request';
import { WORK_ORDER_DRAFT_POLICY } from '../tools/work-order';
import { ChatQuerySchema } from '../types';
import { WorkOrderStorage } from '../work-order-storage';
import { CapabilityRuntime } from './capability-runtime';
import { CapabilityPolicyHost } from './hosts/capability-policy-host';
import { ConversationHost } from './hosts/conversation-host';
import { ImageResultHost } from './hosts/image-result-host';
import { TurnPersistence } from './hosts/turn-persistence';

export function appendChatSystemPolicy(
  messages: PromptMessage[],
  policy: PromptMessage
): PromptMessage[] {
  const [first, ...rest] = messages;
  // Native request construction retains only the first system message.
  return first?.role === 'system'
    ? [{ ...first, content: `${first.content}\n\n${policy.content}` }, ...rest]
    : [policy, ...messages];
}

@Injectable()
export class TurnOrchestrator {
  constructor(
    private readonly conversations: ConversationHost,
    private readonly context: CopilotContextService,
    private readonly office: OfficeAgentCommandService,
    private readonly capabilityPolicy: CapabilityPolicyHost,
    private readonly runtime: CapabilityRuntime,
    private readonly imageResults: ImageResultHost,
    private readonly turnPersistence: TurnPersistence,
    private readonly projectContext: ProjectContextService,
    @Optional() private readonly models?: Models,
    @Optional() private readonly workOrderStorage?: WorkOrderStorage
  ) {}

  private async resolveOfficeContext(
    latestTurn: Turn | undefined,
    session: ChatSession
  ) {
    if (!latestTurn || !Object.hasOwn(latestTurn.metadata, 'officeContext')) {
      return null;
    }
    if (session.config.scopeType === 'work_order') {
      throw new BadRequest('Work-order conversations cannot use Office tools.');
    }
    if (!session.config.workspaceId && !session.config.selectedContextProjectId)
      throw new BadRequest('Office context requires a resource owner.');
    return await this.office.validateAiContext({
      ...(session.config.workspaceId
        ? { workspaceId: session.config.workspaceId }
        : { projectId: session.config.selectedContextProjectId as string }),
      actorId: session.config.userId,
      context: latestTurn.metadata.officeContext,
    });
  }

  private async materializeWorkOrderContext(session: ChatSession) {
    if (session.config.scopeType !== 'work_order') return null;
    if (!session.config.workOrderId || !this.models) {
      throw new BadRequest('Work-order conversation binding is unavailable.');
    }
    const order = await this.models.copilotWorkOrder.getOwned(
      session.config.workOrderId,
      session.config.userId
    );
    if (order.viewerRole !== 'recipient') {
      throw new BadRequest('Work-order conversation owner is invalid.');
    }
    const context = JSON.stringify({
      version: 'project-workbench-v9/work-order-context/v1',
      workOrderId: order.id,
      title: order.title,
      purpose: order.purpose,
      status: order.status,
      requirementsFingerprint: order.requirementsFingerprint,
      requirements: order.requirements.map(item => ({
        id: item.id,
        itemKey: item.itemKey,
        kind: item.kind,
        title: item.title,
        instructions: item.instructions,
        required: item.required,
        acceptedMimeTypes: item.acceptedMimeTypes,
        minCount: item.minCount,
        maxCount: item.maxCount,
        validationMode: item.validationMode,
      })),
      exchanges: order.exchanges.map(exchange => ({
        kind: exchange.kind,
        body: exchange.body,
        actorRole:
          exchange.actorId === order.recipientId ? 'recipient' : 'sender',
        createdAt: exchange.createdAt.toISOString(),
      })),
    });
    if (context.length > 48_000) {
      throw new BadRequest('Work-order context exceeds its bounded budget.');
    }
    return {
      role: 'system' as const,
      content: [
        'This is the frozen, private work-order context for this conversation.',
        'Use only these requirements and explicit exchanges. Do not infer Workspace or Project data.',
        context,
      ].join('\n'),
    };
  }

  private appendOfficePlannerPolicy(
    messages: PromptMessage[],
    office: {
      context: OfficeAiContext;
      artifact: { title: string; sourceFileName: string };
      revision: { sequence: number };
    }
  ) {
    const policy: PromptMessage = {
      role: 'system',
      content: [
        'You are editing the current LocalMind native Office artifact through audited tools.',
        `Validated context: ${JSON.stringify(office.context)}.`,
        `File: ${office.artifact.title} (${office.artifact.sourceFileName}), immutable revision ${office.revision.sequence}.`,
        'Before every write request, call workspace_office_read in this tool loop and use only its returned revision and stable IDs. workspace_office_read is already bound to the validated current artifact and revision, so pass only an optional selector and never ask the user for an artifact ID.',
        'Start with workspace_office_read({"selector":null}) to discover stable IDs, then read a narrower selection if needed. Do not guess current/active/sheet1 as worksheet IDs. A failed read is not revision evidence; retry without a selector.',
        'Use workspace_office_command_request for one change and workspace_office_command_batch_request when all changes must succeed atomically.',
        'Never invent stable IDs, directly rewrite an OOXML/PDF package, or use another artifact.',
        'projectId' in office.context
          ? 'A Project command request creates a persisted preview awaiting approval. Report the actual task status and do not claim the edit completed.'
          : 'A Workspace command request queues the user-requested edit after preview. No extra approval is required; report queued status until the worker returns its revision receipt.',
        'Only a later completed Agent Runtime result with a new immutable revision is completion evidence.',
        office.context.artifactKind === 'pdf'
          ? 'PDF is fixed-layout. Only use supported annotation, form, page, signature appearance, and redaction commands; reject body-text rewrite or reflow requests.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
    if ('projectId' in office.context && typeof policy.content === 'string')
      policy.content = policy.content.replaceAll(
        'workspace_office_',
        'project_office_'
      );
    return appendChatSystemPolicy(messages, policy);
  }

  private async buildPromptParams(
    userId: string,
    sessionId: string,
    options: {
      latestTurn?: Turn;
      includeContextFiles?: boolean;
    } = {}
  ): Promise<Record<string, unknown>> {
    const current = await this.context.getOwnedBySessionId(userId, sessionId);
    const contextFiles =
      options.includeContextFiles &&
      current &&
      (current.files.length > 0 || current.blobs.length > 0)
        ? [...current.files, ...(await current.getBlobMetadata())]
        : [];
    const latestTurn = options.latestTurn;

    return {
      ...this.conversations.buildLatestTurnPromptParams(latestTurn),
      ...(contextFiles.length ? { contextFiles } : {}),
    };
  }

  private async prepareChatSelection(
    userId: string,
    sessionId: string,
    query: Record<string, string | string[]>,
    selection: {
      responseMode: 'text' | 'object' | 'image';
      includeContextFiles?: boolean;
      signal?: AbortSignal;
    }
  ) {
    const prepared = await this.conversations.prepareTurn(
      userId,
      sessionId,
      query
    );
    const {
      modelId,
      reasoning,
      webSearch,
      chatSurface,
      toolsConfig,
      byokLeaseId,
    } = ChatQuerySchema.parse(query);
    const office = await this.resolveOfficeContext(
      prepared.latestTurn,
      prepared.session
    );
    if (office && selection.responseMode === 'image') {
      throw new BadRequest(
        'Office AI context does not support image generation'
      );
    }
    const promptParams = await this.buildPromptParams(userId, sessionId, {
      latestTurn: prepared.latestTurn,
      includeContextFiles: selection.includeContextFiles,
    });
    const selected = await this.capabilityPolicy.selectChat(prepared.session, {
      responseMode: selection.responseMode,
      modelId,
      reasoning,
      webSearch,
      chatSurface,
      toolsConfig,
      byokLeaseId,
      billingUnitId: prepared.latestTurn?.id,
      quotaBackedRoutesAllowed: office
        ? false
        : prepared.quotaBackedRoutesAllowed,
      officeContext: office?.context,
      featureKind:
        selection.responseMode === 'image'
          ? 'image'
          : selection.responseMode === 'object'
            ? 'action'
            : 'chat',
    });
    const projectSource =
      prepared.session.config.scopeType === 'project' &&
      prepared.session.config.selectedContextProjectId &&
      prepared.latestTurn?.metadata.projectContext
        ? await this.projectContext.materialize({
            projectId: prepared.session.config.selectedContextProjectId,
            actorId: userId,
            sessionId,
            snapshot: prepared.latestTurn.metadata.projectContext,
            maxCharacters: Math.min(
              32000,
              Math.floor((selected.contextWindow ?? 128 * 1024) / 4)
            ),
          })
        : null;
    const workOrderSource = await this.materializeWorkOrderContext(
      prepared.session
    );
    const adoptedDeliverySource =
      prepared.session.config.scopeType === 'project' && this.workOrderStorage
        ? await this.workOrderStorage.materializeAdoptedContext({
            actorId: userId,
            sourceSessionId: sessionId,
          })
        : null;
    const renderedMessages = await prepared.session.finishAsync(
      {
        ...prepared.params,
        ...promptParams,
      },
      {
        contextWindow: selected.contextWindow,
        modelId: selected.model,
        signal: selection.signal,
        referenceMessages: [
          projectSource,
          adoptedDeliverySource,
          workOrderSource,
        ].filter((message): message is PromptMessage => Boolean(message)),
      }
    );
    const messagesWithOfficePolicy = office
      ? this.appendOfficePlannerPolicy(renderedMessages, office)
      : renderedMessages;
    const managementPolicy: PromptMessage = {
      role: 'system',
      content:
        prepared.session.config.scopeType === 'work_order'
          ? 'This is a private personal work-order conversation. It has no Workspace or Project resource scope, Memory, resource tree, or Office editing context. Use only the frozen requirements and explicit question/answer exchanges supplied above. The only executable capability is work_order_file_create, which may generate a real supported file for an exact file requirement and stage it privately in this work order. Use it only when the user asks for a file, pass the matching frozen requirement_id and report that the result is staged—not delivered. Chat text and staged files are not deliveries. A delivery exists only after the user explicitly submits a validated immutable delivery revision through the work-order interface. Never claim to have adopted or delivered a resource.'
          : 'When a user requests a .docx/.xlsx/.pptx/.txt/.md/.csv/.json file, use the available scope-specific file_create tool to save the real file. Do not substitute a BlockSuite document or merely rename an extension. File creation returns a persisted resource receipt; use Office read and command tools for later Office edits. Initial generation supports paragraphs/headings, typed sheet rows and slide text. Do not claim unsupported advanced layout or formulas. Workspace file creation saves at the root; Project parent_id refers to its internal file tree. LocalMind Projects are managed by people. You must not create a Project, manage its members, change its permissions or AI policy, or approve/reject access requests. If asked to create a Project, explain that the user must create it in Intelligence. Never create a folder as a substitute. Report only actual tool execution outcomes; an access request is not a grant and a write preview is not a completed edit. ' +
            (prepared.session.config.scopeType === 'project'
              ? `This conversation owns native Project resources in ${prepared.session.config.selectedContextProjectId}. Create folders and documents in this Project by default. Use project_resource_list to resolve exact internal parent IDs. project_doc_create saves the real internal document immediately; no Workspace location is needed. Workspace documents and Project resources are independent copies. Ordinary edits and retries must stay inside the Project. Only an explicit user request can start a separate external publication or source refresh. Cancellation or failure of publication must preserve the internal resource. Use project_doc_read before project_doc_update and handle version conflicts without overwriting.`
              : 'Workspace workspace_doc_create saves immediately to the current Workspace root by default. Set folder_id only when the user explicitly named a target folder. If automatic destination resolution fails, report the returned waiting-for-location state without claiming creation; if the creation outcome is unknown, use workspace_doc_creation_status and do not call workspace_doc_create again.') +
            (prepared.session.config.scopeType === 'project'
              ? `\n${PROJECT_COLLABORATION_POLICY}\n${WORK_ORDER_DRAFT_POLICY}`
              : ''),
    };
    const finalMessage = appendChatSystemPolicy(
      messagesWithOfficePolicy,
      managementPolicy
    );

    return {
      prepared,
      finalMessage,
      selection: selected,
    };
  }

  async streamText(
    userId: string,
    sessionId: string,
    query: Record<string, string | string[]>,
    signal?: AbortSignal,
    wasAborted: () => boolean = () => false
  ) {
    const { prepared, finalMessage, selection } =
      await this.prepareChatSelection(userId, sessionId, query, {
        responseMode: 'text',
        includeContextFiles: true,
        signal,
      });

    const stream = this.streamTextResult(
      prepared.session,
      selection.model,
      finalMessage,
      {
        ...selection.providerOptions,
        signal,
      },
      wasAborted
    );

    return {
      messageId: prepared.messageId,
      model: selection.model,
      finalMessage,
      stream,
    };
  }

  private async *streamTextResult(
    session: ChatSession,
    model: string,
    finalMessage: ReturnType<ChatSession['finish']>,
    options: Record<string, unknown>,
    wasAborted: () => boolean
  ) {
    let buffer = '';
    for await (const chunk of this.runtime.streamText(
      { modelId: model },
      finalMessage,
      options
    )) {
      buffer += chunk;
      yield chunk;
    }
    await this.turnPersistence.persistTextResult(session, buffer, wasAborted());
  }

  async streamObject(
    userId: string,
    sessionId: string,
    query: Record<string, string | string[]>,
    signal?: AbortSignal,
    wasAborted: () => boolean = () => false
  ) {
    const { prepared, finalMessage, selection } =
      await this.prepareChatSelection(userId, sessionId, query, {
        responseMode: 'object',
        includeContextFiles: true,
        signal,
      });

    return {
      messageId: prepared.messageId,
      model: selection.model,
      finalMessage,
      stream: this.streamObjectResult(
        prepared.session,
        selection.model,
        finalMessage,
        {
          ...selection.providerOptions,
          signal,
        },
        wasAborted
      ),
    };
  }

  private async *streamObjectResult(
    session: ChatSession,
    model: string,
    finalMessage: ReturnType<ChatSession['finish']>,
    options: Record<string, unknown>,
    wasAborted: () => boolean
  ): AsyncIterableIterator<StreamObject> {
    const chunks: StreamObject[] = [];
    for await (const chunk of this.runtime.streamObject(
      { modelId: model },
      finalMessage,
      options
    )) {
      chunks.push(chunk);
      yield chunk;
    }
    await this.turnPersistence.persistObjectResult(
      session,
      chunks,
      wasAborted()
    );
  }

  async streamImages(
    userId: string,
    sessionId: string,
    query: Record<string, string | string[]>,
    signal?: AbortSignal,
    wasAborted: () => boolean = () => false
  ) {
    const { prepared, finalMessage, selection } =
      await this.prepareChatSelection(userId, sessionId, query, {
        responseMode: 'image',
        signal,
      });
    const [systemMessage] = finalMessage;
    const finalParams: PromptParams = systemMessage?.params ?? {};
    const hasAttachment =
      !!prepared.session.latestUserTurn?.attachments?.length;

    return {
      messageId: prepared.messageId,
      model: selection.model,
      finalMessage,
      stream: this.streamImageResult(
        userId,
        sessionId,
        prepared.session,
        selection.model,
        hasAttachment,
        finalMessage,
        {
          ...selection.providerOptions,
          quality:
            typeof finalParams.quality === 'string'
              ? finalParams.quality
              : undefined,
          seed: this.parseNumber(finalParams.seed),
          signal,
        },
        wasAborted
      ),
    };
  }

  private async *streamImageResult(
    userId: string,
    sessionId: string,
    session: ChatSession,
    model: string | undefined,
    hasAttachment: boolean,
    finalMessage: ReturnType<ChatSession['finish']>,
    options: Record<string, unknown>,
    wasAborted: () => boolean
  ): AsyncIterableIterator<string> {
    const attachments: string[] = [];
    for await (const artifact of this.runtime.streamImageArtifacts(
      {
        modelId: model,
        inputTypes: hasAttachment
          ? [ModelInputType.Image]
          : [ModelInputType.Text],
      },
      finalMessage,
      options
    )) {
      const handled = await this.imageResults.persistNativeArtifact(
        userId,
        sessionId,
        artifact
      );
      if (handled) {
        attachments.push(handled);
        yield handled;
      }
    }
    await this.turnPersistence.persistImageResult(
      session,
      attachments,
      wasAborted()
    );
  }

  private parseNumber(value: unknown) {
    if (!value) {
      return undefined;
    }
    const num = Number.parseInt(String(value), 10);
    return Number.isNaN(num) ? undefined : num;
  }
}
