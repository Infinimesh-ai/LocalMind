import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  ObjectType,
  Resolver,
} from '@nestjs/graphql';

import { Throttle } from '../../base';
import { type CurrentUser as Actor, CurrentUser } from '../auth/session';
import { WorkspaceFolderPageService } from './workspace-folder-page';

@InputType()
class CreateWorkspaceFolderPageInput {
  @Field(() => ID) workspaceId!: string;
  @Field(() => ID) folderId!: string;
  @Field() requestKey!: string;
  @Field() title!: string;
  @Field() primaryMode!: string;
}

@ObjectType()
class WorkspaceFolderPageResult {
  @Field(() => ID) documentId!: string;
  @Field(() => ID) folderId!: string;
  @Field() replayed!: boolean;
}

@Throttle()
@Resolver()
export class WorkspaceFolderPageResolver {
  constructor(private readonly pages: WorkspaceFolderPageService) {}

  @Mutation(() => WorkspaceFolderPageResult)
  async createWorkspaceFolderPage(
    @CurrentUser() actor: Actor,
    @Args('input') input: CreateWorkspaceFolderPageInput
  ) {
    return this.pages.create({
      ...input,
      actorId: actor.id,
      primaryMode: input.primaryMode as 'page' | 'edgeless',
    });
  }
}
