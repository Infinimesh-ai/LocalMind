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

import { BadRequest, Throttle } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { Models } from '../../models';
import { CompatHistoryProjector } from './compat/history-projector';
import {
  type ChatMessageType,
  CopilotHistoriesType,
  CopilotType,
} from './resolver';
import { ChatSessionService } from './session';

@InputType()
class WorkOrderRequirementInput {
  @Field(() => String) itemKey!: string;
  @Field(() => String) kind!: 'file' | 'text';
  @Field(() => String) title!: string;
  @Field(() => String) instructions!: string;
  @Field(() => Boolean, { defaultValue: true }) required!: boolean;
  @Field(() => [String], { defaultValue: [] }) acceptedMimeTypes!: string[];
  @Field(() => Int, { defaultValue: 1 }) minCount!: number;
  @Field(() => Int, { defaultValue: 1 }) maxCount!: number;
  @Field(() => String) validationMode!:
    | 'mime_and_container'
    | 'non_empty_text'
    | 'bounded_model';
}

@InputType()
class WorkOrderRecipientDraftInput {
  @Field(() => ID) recipientId!: string;
  @Field(() => String) title!: string;
  @Field(() => String) purpose!: string;
  @Field(() => [WorkOrderRequirementInput])
  requirements!: WorkOrderRequirementInput[];
  @Field(() => String, { defaultValue: 'original' }) relationKind!:
    | 'original'
    | 'supplement'
    | 'replacement';
  @Field(() => ID, { nullable: true }) relatedWorkOrderId?: string;
  @Field(() => String, { nullable: true }) backgroundLabel?: string;
  @Field(() => [ID], { defaultValue: [] }) sharedMaterialIds!: string[];
}

@InputType()
class WorkOrderDeliveryItemInput {
  @Field(() => ID) requirementId!: string;
  @Field(() => [ID], { defaultValue: [] }) blobIds!: string[];
  @Field(() => String, { nullable: true }) text?: string;
}

@InputType()
class WorkOrderAdoptionRevisionInput {
  @Field(() => ID) workOrderId!: string;
  @Field(() => ID) deliveryRevisionId!: string;
}

@ObjectType()
class WorkOrderRecipientType {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
  @Field(() => String) email!: string;
}

@ObjectType()
class WorkOrderRequirementType {
  @Field(() => ID) id!: string;
  @Field(() => String) itemKey!: string;
  @Field(() => String) kind!: string;
  @Field(() => String) title!: string;
  @Field(() => String) instructions!: string;
  @Field(() => Boolean) required!: boolean;
  @Field(() => [String]) acceptedMimeTypes!: string[];
  @Field(() => Int) minCount!: number;
  @Field(() => Int) maxCount!: number;
  @Field(() => String) validationMode!: string;
}

@ObjectType()
class WorkOrderExchangeType {
  @Field(() => ID) id!: string;
  @Field(() => String) kind!: string;
  @Field(() => String) body!: string;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
}

@ObjectType()
class WorkOrderDeliveryItemType {
  @Field(() => ID) requirementId!: string;
  @Field(() => ID, { nullable: true }) blobId!: string | null;
  @Field(() => String, { nullable: true }) textValue!: string | null;
  @Field(() => String, { nullable: true }) fileName!: string | null;
  @Field(() => String, { nullable: true }) mimeType!: string | null;
  @Field(() => Int, { nullable: true }) byteSize!: number | null;
}

@ObjectType()
class WorkOrderDeliveryRevisionType {
  @Field(() => ID) id!: string;
  @Field(() => Int) revision!: number;
  @Field(() => String) receiptFingerprint!: string;
  @Field(() => [WorkOrderDeliveryItemType]) items!: WorkOrderDeliveryItemType[];
  @Field(() => GraphQLISODateTime) submittedAt!: Date;
}

@ObjectType()
class WorkOrderStagedBlobType {
  @Field(() => ID) id!: string;
  @Field(() => ID) requirementId!: string;
  @Field(() => String) fileName!: string;
  @Field(() => String) mimeType!: string;
  @Field(() => Int) byteSize!: number;
  @Field(() => String) fingerprint!: string;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
}

@ObjectType()
class WorkOrderType {
  @Field(() => ID) id!: string;
  @Field(() => ID, { nullable: true }) sourceSessionId!: string | null;
  @Field(() => ID, { nullable: true }) ownSessionId!: string | null;
  @Field(() => Int, { nullable: true }) sourceContextVersion!: number | null;
  @Field(() => String) viewerRole!: string;
  @Field(() => String) title!: string;
  @Field(() => String) purpose!: string;
  @Field(() => String) relationKind!: string;
  @Field(() => String) status!: string;
  @Field(() => Int) version!: number;
  @Field(() => [WorkOrderRequirementType])
  requirements!: WorkOrderRequirementType[];
  @Field(() => [WorkOrderExchangeType]) exchanges!: WorkOrderExchangeType[];
  @Field(() => [WorkOrderDeliveryRevisionType])
  deliveries!: WorkOrderDeliveryRevisionType[];
  @Field(() => [WorkOrderStagedBlobType])
  stagedBlobs!: WorkOrderStagedBlobType[];
  @Field(() => Boolean) deliveriesReleased!: boolean;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => GraphQLISODateTime) updatedAt!: Date;
}

@ObjectType()
class WorkOrderDispatchPreparedType {
  @Field(() => ID) dispatchId!: string;
  @Field(() => Int) draftVersion!: number;
  @Field(() => String) draftFingerprint!: string;
  @Field(() => String, { nullable: true }) confirmationToken!: string | null;
  @Field(() => Boolean) confirmationRequired!: boolean;
  @Field(() => GraphQLISODateTime) expiresAt!: Date;
}

@ObjectType()
class WorkOrderDispatchConfirmedType {
  @Field(() => ID) dispatchId!: string;
  @Field(() => [ID]) workOrderIds!: string[];
  @Field(() => [ID]) recipientSessionIds!: string[];
}

@ObjectType()
class ConversationCardProjectType {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
}

@ObjectType()
class ConversationCardType {
  @Field(() => ID) sessionId!: string;
  @Field(() => String) scopeType!: string;
  @Field(() => String, { nullable: true }) title!: string | null;
  @Field(() => Int) titleRevision!: number;
  @Field(() => String) column!: string;
  @Field(() => [String]) attentionReasons!: string[];
  @Field(() => Int) activeRunCount!: number;
  @Field(() => ConversationCardProjectType, { nullable: true })
  project!: ConversationCardProjectType | null;
  @Field(() => ID, { nullable: true }) workOrderId!: string | null;
  @Field(() => String, { nullable: true }) workOrderStatus!: string | null;
  @Field(() => GraphQLISODateTime) lastBusinessAt!: Date;
  @Field(() => Int) version!: number;
}

@ObjectType()
class ConversationCardCountsType {
  @Field(() => Int) todo!: number;
  @Field(() => Int) progress!: number;
  @Field(() => Int) done!: number;
}

@ObjectType()
class ConversationCardsPageInfoType {
  @Field(() => Boolean) hasNextPage!: boolean;
  @Field(() => String, { nullable: true }) endCursor!: string | null;
}

@ObjectType()
class ConversationCardsType {
  @Field(() => [ConversationCardType]) items!: ConversationCardType[];
  @Field(() => ConversationCardCountsType) counts!: ConversationCardCountsType;
  @Field(() => ConversationCardsPageInfoType)
  pageInfo!: ConversationCardsPageInfoType;
}

@ObjectType()
class ConversationWorkStateType {
  @Field(() => ID) sessionId!: string;
  @Field(() => Int) version!: number;
  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt!: Date | null;
  @Field(() => String, { nullable: true }) completionReason!: string | null;
  @Field(() => GraphQLISODateTime) lastBusinessAt!: Date;
}

@ObjectType()
class WorkOrderMutationResultType {
  @Field(() => ID) workOrderId!: string;
  @Field(() => String) status!: string;
  @Field(() => Int) version!: number;
}

@ObjectType()
class WorkOrderDeliveryResultType extends WorkOrderMutationResultType {
  @Field(() => ID) deliveryRevisionId!: string;
  @Field(() => Int) revision!: number;
  @Field(() => String) receiptFingerprint!: string;
}

@ObjectType()
class WorkOrderAdoptionType {
  @Field(() => ID) id!: string;
  @Field(() => Int) contextVersion!: number;
  @Field(() => String) revisionSetFingerprint!: string;
}

@ObjectType()
class CollaborationNodeType {
  @Field(() => ID) id!: string;
  @Field(() => String) label!: string;
  @Field(() => Boolean) self!: boolean;
}

@ObjectType()
class CollaborationEdgeType {
  @Field(() => ID) id!: string;
  @Field(() => ID) from!: string;
  @Field(() => ID) to!: string;
  @Field(() => String) status!: string;
  @Field(() => String) label!: string;
  @Field(() => ID, { nullable: true }) ownSessionId!: string | null;
  @Field(() => ID, { nullable: true }) ownWorkOrderId!: string | null;
}

@ObjectType()
class CollaborationGraphType {
  @Field(() => [CollaborationNodeType]) nodes!: CollaborationNodeType[];
  @Field(() => [CollaborationEdgeType]) edges!: CollaborationEdgeType[];
  @Field(() => Boolean) truncated!: boolean;
}

@ObjectType()
class WorkOrderAiModelType {
  @Field(() => Boolean) configured!: boolean;
  @Field(() => String, { nullable: true }) modelId!: string | null;
  @Field(() => String, { nullable: true }) provider!: string | null;
}

@Resolver(() => CopilotType)
@Throttle()
export class WorkOrderResolver {
  constructor(
    private readonly models: Models,
    private readonly sessions: ChatSessionService,
    private readonly historyProjector: CompatHistoryProjector
  ) {}

  @ResolveField(() => ConversationCardsType, { complexity: 3 })
  async myConversationCards(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('column', { type: () => String, nullable: true })
    column?: 'todo' | 'progress' | 'done',
    @Args('first', { type: () => Int, nullable: true, defaultValue: 30 })
    first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string
  ) {
    this.assertUserScope(copilot);
    const page = await this.models.copilotWorkOrder.listCards({
      actorId: user.id,
      column,
      first,
      after,
    });
    return {
      ...page,
      items: page.items.map(item => ({
        ...item,
        workOrderId: item.workOrder?.id ?? null,
        workOrderStatus: item.workOrder?.status ?? null,
      })),
    };
  }

  @ResolveField(() => WorkOrderRecipientType)
  async resolveWorkOrderRecipient(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('exact', { type: () => String }) exact: string
  ) {
    this.assertUserScope(copilot);
    return this.models.copilotWorkOrder.resolveRecipient({
      actorId: user.id,
      exact,
    });
  }

  @ResolveField(() => WorkOrderType)
  async myWorkOrder(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string
  ) {
    this.assertUserScope(copilot);
    const order = await this.models.copilotWorkOrder.getOwned(
      workOrderId,
      user.id
    );
    return this.presentWorkOrder(order);
  }

  @ResolveField(() => CopilotHistoriesType)
  async myWorkOrderChat(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string
  ): Promise<CopilotHistoriesType> {
    this.assertUserScope(copilot);
    const order = await this.models.copilotWorkOrder.getOwned(
      workOrderId,
      user.id
    );
    if (
      order.viewerRole !== 'recipient' ||
      order.sessionBinding?.ownerUserId !== user.id
    ) {
      throw new BadRequest('Work-order conversation is unavailable');
    }
    const state = await this.sessions.getState(order.sessionBinding.sessionId);
    const history =
      state &&
      this.historyProjector.projectHistory(state, {
        requestUserId: user.id,
        withMessages: true,
        withPrompt: false,
      });
    if (!history)
      throw new BadRequest('Work-order conversation is unavailable');
    return {
      ...history,
      messages: history.messages as ChatMessageType[],
    };
  }

  @ResolveField(() => WorkOrderAiModelType)
  async myWorkOrderAiModel(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string
  ) {
    this.assertUserScope(copilot);
    const order = await this.models.copilotWorkOrder.getOwned(
      workOrderId,
      user.id
    );
    if (order.viewerRole !== 'recipient') {
      throw new BadRequest('Work-order AI model is unavailable');
    }
    const model = await this.models.copilotProjectByok.get();
    const configured = !!model?.enabled && !!model.workOrderEnabled;
    return {
      configured,
      modelId: configured ? model.modelId : null,
      provider: configured ? model.provider : null,
    };
  }

  @ResolveField(() => CollaborationGraphType, { complexity: 3 })
  async myCollaborationGraph(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType
  ) {
    this.assertUserScope(copilot);
    const graph = await this.models.copilotWorkOrder.collaborationGraph(
      user.id
    );
    return {
      ...graph,
      edges: graph.edges.map(edge => ({
        ...edge,
        ownSessionId:
          edge.ownNavigation?.kind === 'source'
            ? edge.ownNavigation.sessionId
            : null,
        ownWorkOrderId:
          edge.ownNavigation?.kind === 'work_order'
            ? edge.ownNavigation.workOrderId
            : null,
      })),
    };
  }

  @Mutation(() => WorkOrderDispatchPreparedType)
  async prepareWorkOrderDispatch(
    @CurrentUser() user: CurrentUserType,
    @Args('sourceSessionId', { type: () => ID }) sourceSessionId: string,
    @Args('requestKey', { type: () => String }) requestKey: string,
    @Args('recipients', { type: () => [WorkOrderRecipientDraftInput] })
    recipients: WorkOrderRecipientDraftInput[]
  ) {
    const result = await this.models.copilotWorkOrder.prepareDispatch({
      actorId: user.id,
      sourceSessionId,
      requestKey,
      recipients: recipients.map(recipient => ({
        ...recipient,
        background: {
          label: recipient.backgroundLabel,
          sharedMaterialIds: recipient.sharedMaterialIds,
        },
      })),
    });
    return {
      dispatchId: result.dispatch.id,
      draftVersion: result.dispatch.draftVersion,
      draftFingerprint: result.dispatch.draftFingerprint,
      confirmationToken: result.confirmationToken,
      confirmationRequired: result.confirmationRequired,
      expiresAt: result.dispatch.expiresAt,
    };
  }

  @Mutation(() => WorkOrderDispatchConfirmedType)
  async confirmWorkOrderDispatch(
    @CurrentUser() user: CurrentUserType,
    @Args('dispatchId', { type: () => ID }) dispatchId: string,
    @Args('confirmationToken', { type: () => String })
    confirmationToken: string,
    @Args('expectedDraftVersion', { type: () => Int })
    expectedDraftVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string
  ) {
    const dispatch = await this.models.copilotWorkOrder.confirmDispatch({
      actorId: user.id,
      dispatchId,
      confirmationToken,
      expectedDraftVersion,
      requestKey,
    });
    return {
      dispatchId: dispatch.id,
      workOrderIds: dispatch.orders.map(order => order.id),
      recipientSessionIds: dispatch.orders.flatMap(order =>
        order.sessionBinding?.sessionId ? [order.sessionBinding.sessionId] : []
      ),
    };
  }

  @Mutation(() => WorkOrderMutationResultType)
  async askWorkOrderQuestion(
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string,
    @Args('body', { type: () => String }) body: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string
  ) {
    const result = await this.models.copilotWorkOrder.ask({
      workOrderId,
      actorId: user.id,
      body,
      expectedVersion,
      requestKey,
    });
    return this.mutationResult(result.order);
  }

  @Mutation(() => WorkOrderMutationResultType)
  async answerWorkOrderQuestion(
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string,
    @Args('body', { type: () => String }) body: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string
  ) {
    const result = await this.models.copilotWorkOrder.answer({
      workOrderId,
      actorId: user.id,
      body,
      expectedVersion,
      requestKey,
    });
    return this.mutationResult(result.order);
  }

  @Mutation(() => WorkOrderMutationResultType)
  async refuseWorkOrder(
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string,
    @Args('reason', { type: () => String }) reason: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string
  ) {
    const result = await this.models.copilotWorkOrder.refuse({
      workOrderId,
      actorId: user.id,
      reason,
      expectedVersion,
      requestKey,
    });
    return this.mutationResult(result.order);
  }

  @Mutation(() => WorkOrderMutationResultType)
  async cancelWorkOrder(
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string,
    @Args('reason', { type: () => String, nullable: true })
    reason: string | null,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string
  ) {
    const result = await this.models.copilotWorkOrder.cancel({
      workOrderId,
      actorId: user.id,
      reason: reason ?? undefined,
      expectedVersion,
      requestKey,
    });
    return this.mutationResult(result.order);
  }

  @Mutation(() => WorkOrderDeliveryResultType)
  async submitWorkOrderDelivery(
    @CurrentUser() user: CurrentUserType,
    @Args('workOrderId', { type: () => ID }) workOrderId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string,
    @Args('items', { type: () => [WorkOrderDeliveryItemInput] })
    items: WorkOrderDeliveryItemInput[]
  ) {
    const result = await this.models.copilotWorkOrder.submitDelivery({
      workOrderId,
      actorId: user.id,
      expectedVersion,
      requestKey,
      items,
    });
    return {
      ...this.mutationResult(result.order),
      deliveryRevisionId: result.delivery.id,
      revision: result.delivery.revision,
      receiptFingerprint: result.delivery.receiptFingerprint,
    };
  }

  @Mutation(() => WorkOrderAdoptionType)
  async adoptWorkOrderDeliveries(
    @CurrentUser() user: CurrentUserType,
    @Args('sourceSessionId', { type: () => ID }) sourceSessionId: string,
    @Args('expectedContextVersion', { type: () => Int })
    expectedContextVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string,
    @Args('revisions', { type: () => [WorkOrderAdoptionRevisionInput] })
    revisions: WorkOrderAdoptionRevisionInput[]
  ) {
    return this.models.copilotWorkOrder.adoptDeliveries({
      actorId: user.id,
      sourceSessionId,
      expectedContextVersion,
      requestKey,
      revisions,
    });
  }

  @Mutation(() => ConversationWorkStateType)
  async completeConversation(
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('requestKey', { type: () => String }) requestKey: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string
  ) {
    return this.models.copilotWorkOrder.completeConversation({
      actorId: user.id,
      sessionId,
      expectedVersion,
      requestKey,
      reason,
    });
  }

  @Mutation(() => ConversationCardType)
  async renameConversation(
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('title', { type: () => String }) title: string,
    @Args('expectedRevision', { type: () => Int }) expectedRevision: number
  ) {
    const session = await this.models.copilotWorkOrder.renameConversation({
      actorId: user.id,
      sessionId,
      title,
      expectedRevision,
    });
    return {
      sessionId: session.id,
      scopeType: session.scopeType,
      title: session.title,
      titleRevision: session.titleRevision,
      column: 'progress',
      attentionReasons: [],
      activeRunCount: 0,
      project: null,
      workOrderId: null,
      workOrderStatus: null,
      lastBusinessAt: session.updatedAt,
      version: 1,
    };
  }

  private assertUserScope(copilot: CopilotType) {
    if (copilot.workspaceId)
      throw new BadRequest(
        'Project workbench is available only from user-level Copilot'
      );
  }

  private mutationResult(order: {
    id: string;
    status: string;
    version: number;
  }) {
    return {
      workOrderId: order.id,
      status: order.status,
      version: order.version,
    };
  }

  private presentWorkOrder(
    order: Awaited<ReturnType<Models['copilotWorkOrder']['getOwned']>>
  ) {
    return {
      ...order,
      ownSessionId: order.sessionBinding?.sessionId ?? null,
      sourceContextVersion:
        order.viewerRole === 'sender'
          ? (order.sourceSession?.contextEpoch ?? null)
          : null,
      deliveriesReleased: order.deliveryProgress.released,
      deliveries: order.deliveries.map(delivery => ({
        ...delivery,
        items: delivery.items.map(item => ({
          requirementId: item.requirementId,
          blobId: item.blobId,
          textValue: item.textValue,
          fileName: item.blob?.fileName ?? null,
          mimeType: item.blob?.mimeType ?? null,
          byteSize: item.blob?.byteSize ?? null,
        })),
      })),
    };
  }
}
