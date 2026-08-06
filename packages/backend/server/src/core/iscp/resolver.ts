import {
  Args,
  Field,
  ID,
  Mutation,
  ObjectType,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import { CurrentUser } from '../auth';
import { UserType } from '../user';
import { IscpService } from './service';

@ObjectType()
export class SparkClawEndpointType {
  @Field(() => ID)
  id!: string;

  @Field()
  deviceId!: string;

  @Field()
  status!: string;

  @Field(() => Date, { nullable: true })
  lastSeenAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType()
export class SparkClawPairingType {
  @Field()
  command!: string;

  @Field(() => Date)
  expiresAt!: Date;
}

@Resolver(() => UserType)
export class IscpResolver {
  constructor(private readonly service: IscpService) {}

  @ResolveField(() => [SparkClawEndpointType], {
    name: 'sparkClawEndpoints',
  })
  async endpoints(@CurrentUser() user: UserType) {
    return await this.service.listEndpoints(user.id);
  }

  @Mutation(() => SparkClawPairingType)
  async createSparkClawPairing(@CurrentUser() user: UserType) {
    return await this.service.createPairing(user.id);
  }

  @Mutation(() => Boolean)
  async disconnectSparkClawEndpoint(
    @CurrentUser() user: UserType,
    @Args('endpointId', { type: () => ID }) endpointId: string
  ) {
    await this.service.disconnect(user.id, endpointId);
    return true;
  }
}
