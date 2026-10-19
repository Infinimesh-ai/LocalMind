import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-scalars';

import { Throttle } from '../../base';
import { CurrentUser, type CurrentUser as User } from '../auth';
import { ReportDeckService } from './service';

@Resolver()
export class ReportDeckResolver {
  constructor(private readonly service: ReportDeckService) {}

  @Query(() => GraphQLJSONObject)
  reportDecks(
    @CurrentUser() user: User,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    return this.service.list(user.id, { cursor, limit });
  }

  @Query(() => GraphQLJSONObject)
  reportDeck(
    @CurrentUser() user: User,
    @Args('deckId', { type: () => ID }) deckId: string
  ) {
    return this.service.detail(user.id, deckId);
  }

  @Query(() => GraphQLJSONObject)
  @Throttle('default', { bucket: 'report-deck-preflight' })
  reportDeckPreflight(
    @CurrentUser() user: User,
    @Args('input', { type: () => GraphQLJSONObject })
    input: Record<string, unknown>
  ) {
    return this.service.preflight(user.id, input);
  }

  @Query(() => GraphQLJSONObject)
  @Throttle('default', { bucket: 'report-deck-ai-options' })
  reportDeckAiOptions(
    @CurrentUser() user: User,
    @Args('input', { type: () => GraphQLJSONObject })
    input: Record<string, unknown>
  ) {
    return this.service.aiOptions(user.id, input);
  }

  @Mutation(() => GraphQLJSONObject)
  @Throttle('default', { bucket: 'report-deck-command' })
  reportDeckCommand(
    @CurrentUser() user: User,
    @Args('input', { type: () => GraphQLJSONObject })
    input: Record<string, unknown>
  ) {
    return this.service.command(user.id, input);
  }
}
