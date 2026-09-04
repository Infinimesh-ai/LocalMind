import {
  Field,
  ID,
  InputType,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { OfficeArtifactKind, OfficeRevisionOrigin } from '@prisma/client';
import {
  GraphQLJSON,
  GraphQLJSONObject,
  SafeIntResolver,
} from 'graphql-scalars';

registerEnumType(OfficeArtifactKind, {
  name: 'OfficeArtifactKind',
  description: 'Native LocalMind Office resource kind',
});

registerEnumType(OfficeRevisionOrigin, {
  name: 'OfficeRevisionOrigin',
  description: 'Origin of an immutable Office revision',
});

@ObjectType()
export class OfficeRevisionType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  workspaceId!: string;

  @Field(() => ID)
  artifactId!: string;

  @Field(() => SafeIntResolver)
  sequence!: number;

  @Field(() => OfficeRevisionOrigin)
  origin!: OfficeRevisionOrigin;

  @Field(() => ID, { nullable: true })
  parentRevisionId!: string | null;

  @Field()
  packageMimeType!: string;

  @Field(() => SafeIntResolver)
  packageByteSize!: number;

  @Field()
  packageFingerprint!: string;

  @Field(() => SafeIntResolver, { nullable: true })
  stateByteSize!: number | null;

  @Field(() => String, { nullable: true })
  stateFingerprint!: string | null;

  @Field()
  modelVersion!: string;

  @Field(() => GraphQLJSONObject)
  operationSummary!: Record<string, unknown>;

  @Field(() => ID)
  createdBy!: string;

  @Field(() => Date)
  createdAt!: Date;

  @Field()
  packageUrl!: string;

  @Field(() => String, { nullable: true })
  stateUrl!: string | null;
}

@ObjectType()
export class OfficeRevisionCompareType {
  @Field(() => ID)
  artifactId!: string;

  @Field(() => OfficeArtifactKind)
  kind!: OfficeArtifactKind;

  @Field(() => OfficeRevisionType)
  beforeRevision!: OfficeRevisionType;

  @Field(() => OfficeRevisionType)
  afterRevision!: OfficeRevisionType;

  @Field()
  changed!: boolean;

  @Field()
  truncated!: boolean;

  @Field(() => GraphQLJSONObject)
  summary!: Record<string, number>;

  @Field(() => GraphQLJSON)
  changes!: unknown[];
}

@ObjectType()
export class OfficeArtifactType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  workspaceId!: string;

  @Field(() => OfficeArtifactKind)
  kind!: OfficeArtifactKind;

  @Field()
  title!: string;

  @Field()
  sourceFileName!: string;

  @Field()
  sourceMimeType!: string;

  @Field(() => SafeIntResolver)
  sourceByteSize!: number;

  @Field()
  sourceFingerprint!: string;

  @Field(() => SafeIntResolver)
  revisionCounter!: number;

  @Field(() => GraphQLJSONObject)
  compatibility!: Record<string, unknown>;

  @Field(() => ID)
  createdBy!: string;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  @Field(() => OfficeRevisionType)
  currentRevision!: OfficeRevisionType;
}

@InputType()
export class ImportOfficeDocxRequestInput {
  @Field(() => ID)
  workspaceId!: string;

  @Field()
  sourceBlobKey!: string;

  @Field()
  title!: string;

  @Field()
  sourceFileName!: string;

  @Field()
  idempotencyKey!: string;
}

@InputType()
export class ImportOfficeArtifactRequestInput {
  @Field(() => ID)
  workspaceId!: string;

  @Field()
  sourceBlobKey!: string;

  @Field()
  title!: string;

  @Field()
  sourceFileName!: string;

  @Field()
  idempotencyKey!: string;
}

@InputType()
export class OfficeDocxCommandInput {
  @Field(() => ID)
  workspaceId!: string;

  @Field(() => GraphQLJSON)
  command!: unknown;
}

@InputType()
export class OfficeCommandInput {
  @Field(() => ID)
  workspaceId!: string;

  @Field(() => GraphQLJSON)
  command!: unknown;
}

@ObjectType()
export class ImportOfficeDocxResultType {
  @Field()
  created!: boolean;

  @Field(() => OfficeArtifactType)
  artifact!: OfficeArtifactType;

  @Field(() => OfficeRevisionType)
  revision!: OfficeRevisionType;
}

@ObjectType()
export class ImportOfficeArtifactResultType {
  @Field()
  created!: boolean;

  @Field(() => OfficeArtifactType)
  artifact!: OfficeArtifactType;

  @Field(() => OfficeRevisionType)
  revision!: OfficeRevisionType;
}

@ObjectType()
export class OfficeDocxCommandPreviewType {
  @Field(() => ID)
  artifactId!: string;

  @Field(() => ID)
  expectedRevisionId!: string;

  @Field()
  packageFingerprint!: string;

  @Field()
  stateFingerprint!: string;

  @Field(() => GraphQLJSONObject)
  stats!: Record<string, number>;

  @Field(() => GraphQLJSONObject)
  summary!: Record<string, unknown>;
}

@ObjectType()
export class OfficeCommandPreviewType {
  @Field(() => ID)
  artifactId!: string;

  @Field(() => ID)
  expectedRevisionId!: string;

  @Field()
  packageFingerprint!: string;

  @Field()
  stateFingerprint!: string;

  @Field(() => GraphQLJSONObject)
  stats!: Record<string, number>;

  @Field(() => GraphQLJSONObject)
  summary!: Record<string, unknown>;
}

@ObjectType()
export class ExecuteOfficeDocxCommandResultType {
  @Field()
  created!: boolean;

  @Field(() => OfficeArtifactType)
  artifact!: OfficeArtifactType;

  @Field(() => OfficeRevisionType)
  revision!: OfficeRevisionType;

  @Field(() => GraphQLJSONObject)
  summary!: Record<string, unknown>;
}

@ObjectType()
export class ExecuteOfficeCommandResultType {
  @Field()
  created!: boolean;

  @Field(() => OfficeArtifactType)
  artifact!: OfficeArtifactType;

  @Field(() => OfficeRevisionType)
  revision!: OfficeRevisionType;

  @Field(() => GraphQLJSONObject)
  summary!: Record<string, unknown>;
}
