import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { officeOwnerToInput } from '../../models/office-owner';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth';
import { RealtimePublisher } from '../realtime';
import { PublicUserType } from '../user';
import { publishOfficeCommentChanged } from './comment-realtime';
import { OfficeCommentService } from './comment-service';
import {
  OfficeCommentCreateInput,
  OfficeCommentOwnerInput,
  OfficeCommentReplyCreateInput,
  OfficeCommentReplyType,
  OfficeCommentReplyUpdateInput,
  OfficeCommentResolveInput,
  OfficeCommentType,
  OfficeCommentUpdateInput,
  resolveOfficeCommentOwner,
} from './comment-types';

@Resolver()
export class OfficeCommentResolver {
  constructor(
    private readonly comments: OfficeCommentService,
    private readonly realtime: RealtimePublisher
  ) {}

  @Query(() => [OfficeCommentType], {
    description: 'List comments anchored to one native Office artifact',
  })
  async officeComments(
    @CurrentUser() user: CurrentUserType,
    @Args('artifactId') artifactId: string,
    @Args('workspaceId', { type: () => String, nullable: true })
    workspaceId?: string,
    @Args('owner', { type: () => OfficeCommentOwnerInput, nullable: true })
    owner?: OfficeCommentOwnerInput
  ) {
    return await this.comments.list(
      resolveOfficeCommentOwner(workspaceId, owner),
      user.id,
      artifactId
    );
  }

  @Query(() => [PublicUserType], {
    description:
      'List users represented in native Office revision and comment history',
  })
  async officeCollaborators(
    @CurrentUser() user: CurrentUserType,
    @Args('artifactId') artifactId: string,
    @Args('workspaceId', { type: () => String, nullable: true })
    workspaceId?: string,
    @Args('owner', { type: () => OfficeCommentOwnerInput, nullable: true })
    owner?: OfficeCommentOwnerInput
  ) {
    return await this.comments.collaborators(
      resolveOfficeCommentOwner(workspaceId, owner),
      user.id,
      artifactId
    );
  }

  @Mutation(() => OfficeCommentType)
  async createOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentCreateInput
  ) {
    const comment = await this.comments.create({
      ...officeOwnerToInput(
        resolveOfficeCommentOwner(input.workspaceId, input.owner)
      ),
      artifactId: input.artifactId,
      content: input.content,
      actorId: user.id,
    });
    publishOfficeCommentChanged(this.realtime, comment);
    return comment;
  }

  @Mutation(() => OfficeCommentType)
  async updateOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentUpdateInput
  ) {
    const comment = await this.comments.update({ ...input, actorId: user.id });
    publishOfficeCommentChanged(this.realtime, comment);
    return comment;
  }

  @Mutation(() => OfficeCommentType)
  async resolveOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentResolveInput
  ) {
    const comment = await this.comments.resolve({
      ...input,
      actorId: user.id,
    });
    publishOfficeCommentChanged(this.realtime, comment);
    return comment;
  }

  @Mutation(() => Boolean)
  async deleteOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('id') id: string
  ) {
    const comment = await this.comments.delete({ actorId: user.id, id });
    publishOfficeCommentChanged(this.realtime, comment);
    return true;
  }

  @Mutation(() => OfficeCommentReplyType)
  async createOfficeCommentReply(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentReplyCreateInput
  ) {
    const reply = await this.comments.createReply({
      ...input,
      actorId: user.id,
    });
    publishOfficeCommentChanged(this.realtime, reply);
    return reply;
  }

  @Mutation(() => OfficeCommentReplyType)
  async updateOfficeCommentReply(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentReplyUpdateInput
  ) {
    const reply = await this.comments.updateReply({
      ...input,
      actorId: user.id,
    });
    publishOfficeCommentChanged(this.realtime, reply);
    return reply;
  }

  @Mutation(() => Boolean)
  async deleteOfficeCommentReply(
    @CurrentUser() user: CurrentUserType,
    @Args('id') id: string
  ) {
    const reply = await this.comments.deleteReply({ actorId: user.id, id });
    publishOfficeCommentChanged(this.realtime, reply);
    return true;
  }
}
