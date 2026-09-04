import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth';
import { publishCommentChanged } from '../comment/realtime';
import { RealtimePublisher } from '../realtime';
import { PublicUserType } from '../user';
import { OfficeCommentService } from './comment-service';
import {
  OfficeCommentCreateInput,
  OfficeCommentReplyCreateInput,
  OfficeCommentReplyType,
  OfficeCommentReplyUpdateInput,
  OfficeCommentResolveInput,
  OfficeCommentType,
  OfficeCommentUpdateInput,
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
    @Args('workspaceId') workspaceId: string,
    @Args('artifactId') artifactId: string
  ) {
    return await this.comments.list(workspaceId, user.id, artifactId);
  }

  @Query(() => [PublicUserType], {
    description:
      'List users represented in native Office revision and comment history',
  })
  async officeCollaborators(
    @CurrentUser() user: CurrentUserType,
    @Args('workspaceId') workspaceId: string,
    @Args('artifactId') artifactId: string
  ) {
    return await this.comments.collaborators(workspaceId, user.id, artifactId);
  }

  @Mutation(() => OfficeCommentType)
  async createOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentCreateInput
  ) {
    const comment = await this.comments.create({
      ...input,
      actorId: user.id,
    });
    publishCommentChanged(this.realtime, input.workspaceId, input.artifactId);
    return comment;
  }

  @Mutation(() => OfficeCommentType)
  async updateOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: OfficeCommentUpdateInput
  ) {
    const comment = await this.comments.update({ ...input, actorId: user.id });
    publishCommentChanged(this.realtime, comment.workspaceId, comment.docId);
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
    publishCommentChanged(this.realtime, comment.workspaceId, comment.docId);
    return comment;
  }

  @Mutation(() => Boolean)
  async deleteOfficeComment(
    @CurrentUser() user: CurrentUserType,
    @Args('id') id: string
  ) {
    const comment = await this.comments.delete({ actorId: user.id, id });
    publishCommentChanged(this.realtime, comment.workspaceId, comment.docId);
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
    publishCommentChanged(this.realtime, reply.workspaceId, reply.docId);
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
    publishCommentChanged(this.realtime, reply.workspaceId, reply.docId);
    return reply;
  }

  @Mutation(() => Boolean)
  async deleteOfficeCommentReply(
    @CurrentUser() user: CurrentUserType,
    @Args('id') id: string
  ) {
    const reply = await this.comments.deleteReply({ actorId: user.id, id });
    publishCommentChanged(this.realtime, reply.workspaceId, reply.docId);
    return true;
  }
}
