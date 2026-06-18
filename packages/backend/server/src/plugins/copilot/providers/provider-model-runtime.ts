import { z } from 'zod';

import { CopilotPromptInvalid } from '../../../base';
import {
  type LlmBackendConfig,
  llmInferPromptModelConditions,
  llmMatchModelCapabilities,
  llmMatchModelRegistry,
  type LlmProtocol,
  llmResolveModelRegistryVariant,
} from '../../../native';
import type {
  CopilotModelDefinition,
  CopilotModelRouteOverride,
} from '../config';
import { applyPromptAttachmentMimeTypeHintForNative } from './attachments';
import {
  type CopilotChatOptions,
  type CopilotImageOptions,
  type CopilotModelBackendKind,
  type CopilotProviderModel,
  type CopilotProviderType,
  type CopilotStructuredOptions,
  EmbeddingMessage,
  type ModelAttachmentCapability,
  type ModelCapability,
  type ModelFullConditions,
  ModelInputType,
  ModelOutputType,
  type PromptAttachmentKind,
  type PromptAttachmentSourceKind,
  type PromptMessage,
  PromptMessageSchema,
} from './types';

// Owner: backend host model-selection glue.
// Capability matching and catalog lookup are delegated to native/adapter; this
// file keeps provider prefix/default/prefer behavior and Node prompt checks.
export type ProviderModelRuntimeContext = {
  type: CopilotProviderType;
  backendKind: CopilotModelBackendKind;
  modelDefinitions?: CopilotModelDefinition[];
};

export type ResolvedProviderModel = CopilotProviderModel & {
  backendKind: CopilotModelBackendKind;
  canonicalKey: string;
  protocol?: LlmProtocol;
  requestLayer?: LlmBackendConfig['request_layer'];
  routeOverrides?: Partial<
    Record<
      ModelOutputType,
      {
        protocol?: LlmProtocol;
        requestLayer?: LlmBackendConfig['request_layer'];
      }
    >
  >;
  behaviorFlags?: string[];
  limits?: {
    contextWindow?: number;
    maxOutputTokens?: number;
    embeddingDimensions?: number;
  };
  cost?: {
    inputPer1M?: number;
    outputPer1M?: number;
  };
};

type OptionsWithMaxTokens = NonNullable<CopilotChatOptions> & {
  maxTokens?: number | null;
};

export function resolveModelMaxOutputTokens(
  model: CopilotProviderModel
): number | undefined {
  return (model as ResolvedProviderModel).limits?.maxOutputTokens;
}

export function resolveModelContextWindow(
  model: CopilotProviderModel
): number | undefined {
  return (model as ResolvedProviderModel).limits?.contextWindow;
}

export function resolveModelLimits(
  model: CopilotProviderModel
): ResolvedProviderModel['limits'] {
  return (model as ResolvedProviderModel).limits;
}

export function applyModelMaxOutputTokens<
  TOptions extends OptionsWithMaxTokens,
>(model: CopilotProviderModel, options: TOptions): TOptions {
  const maxOutputTokens = resolveModelMaxOutputTokens(model);
  if (options.maxTokens != null || maxOutputTokens === undefined) {
    return options;
  }

  return {
    ...options,
    maxTokens: maxOutputTokens,
  } as TOptions;
}

function unique<T>(values: Iterable<T>) {
  return Array.from(new Set(values));
}

function resolveAttachmentCapability(
  cap: ModelCapability,
  outputType?: ModelOutputType
): ModelAttachmentCapability | undefined {
  if (outputType === ModelOutputType.Structured) {
    return cap.structuredAttachments ?? cap.attachments;
  }
  return cap.attachments;
}

function toProviderModel(
  variant: NonNullable<
    ReturnType<typeof llmResolveModelRegistryVariant>['variant']
  >
): ResolvedProviderModel {
  return {
    id: variant.rawModelId,
    name: variant.displayName,
    backendKind: variant.backendKind,
    canonicalKey: variant.canonicalKey,
    protocol: variant.protocol,
    requestLayer: variant.requestLayer,
    routeOverrides: variant.routeOverrides,
    behaviorFlags: variant.behaviorFlags,
    capabilities: variant.capabilities.map(capability => ({
      input: capability.input as ModelInputType[],
      output: capability.output as ModelOutputType[],
      attachments: capability.attachments
        ? {
            kinds: capability.attachments.kinds as PromptAttachmentKind[],
            sourceKinds: capability.attachments.sourceKinds as
              | ModelAttachmentCapability['sourceKinds']
              | undefined,
            allowRemoteUrls: capability.attachments.allowRemoteUrls,
          }
        : undefined,
      structuredAttachments: capability.structuredAttachments
        ? {
            kinds: capability.structuredAttachments
              .kinds as PromptAttachmentKind[],
            sourceKinds: capability.structuredAttachments.sourceKinds as
              | ModelAttachmentCapability['sourceKinds']
              | undefined,
            allowRemoteUrls: capability.structuredAttachments.allowRemoteUrls,
          }
        : undefined,
      defaultForOutputType: capability.defaultForOutputType,
    })),
  };
}

const DEFAULT_MODEL_ROUTE_BY_BACKEND_KIND: Record<
  CopilotModelBackendKind,
  {
    protocol: LlmProtocol;
    requestLayer: LlmBackendConfig['request_layer'];
  }
> = {
  openai_chat: {
    protocol: 'openai_chat',
    requestLayer: 'chat_completions',
  },
  openai_responses: {
    protocol: 'openai_responses',
    requestLayer: 'responses',
  },
  anthropic: {
    protocol: 'anthropic',
    requestLayer: 'anthropic',
  },
  anthropic_vertex: {
    protocol: 'anthropic',
    requestLayer: 'vertex_anthropic',
  },
  cloudflare_workers_ai: {
    protocol: 'openai_chat',
    requestLayer: 'cloudflare_workers_ai',
  },
  gemini_api: {
    protocol: 'gemini',
    requestLayer: 'gemini_api',
  },
  gemini_vertex: {
    protocol: 'gemini',
    requestLayer: 'gemini_vertex',
  },
  fal: {
    protocol: 'fal_image',
    requestLayer: 'fal',
  },
};

const DEFAULT_IMAGE_ROUTE_BY_BACKEND_KIND: Partial<
  Record<
    CopilotModelBackendKind,
    {
      protocol: LlmProtocol;
      requestLayer: LlmBackendConfig['request_layer'];
    }
  >
> = {
  openai_responses: {
    protocol: 'openai_images',
    requestLayer: 'openai_images',
  },
  fal: {
    protocol: 'fal_image',
    requestLayer: 'fal',
  },
};

function normalizeRouteOverrides(
  backendKind: CopilotModelBackendKind,
  routeOverrides?: Partial<Record<ModelOutputType, CopilotModelRouteOverride>>
): ResolvedProviderModel['routeOverrides'] | undefined {
  const outputOverrides = routeOverrides
    ? Object.fromEntries(
        Object.entries(routeOverrides).map(([outputType, override]) => [
          outputType,
          {
            protocol: override?.protocol,
            requestLayer: override?.requestLayer,
          },
        ])
      )
    : {};
  const imageRoute = DEFAULT_IMAGE_ROUTE_BY_BACKEND_KIND[backendKind];

  return {
    ...(imageRoute ? { [ModelOutputType.Image]: imageRoute } : {}),
    ...outputOverrides,
  };
}

function toConfiguredProviderModel(
  context: ProviderModelRuntimeContext,
  definition: CopilotModelDefinition
): ResolvedProviderModel {
  const backendKind = definition.backendKind ?? context.backendKind;
  const defaultRoute = DEFAULT_MODEL_ROUTE_BY_BACKEND_KIND[backendKind];

  return {
    id: definition.rawModelId ?? definition.id,
    name: definition.displayName,
    backendKind,
    canonicalKey: definition.id,
    protocol: definition.protocol ?? defaultRoute.protocol,
    requestLayer: definition.requestLayer ?? defaultRoute.requestLayer,
    routeOverrides: normalizeRouteOverrides(
      backendKind,
      definition.routeOverrides
    ),
    behaviorFlags: definition.behaviorFlags,
    limits: definition.limits,
    cost: definition.cost,
    capabilities: definition.capabilities.map(capability => ({
      input: [...capability.input],
      output: [...capability.output],
      attachments: capability.attachments
        ? {
            kinds: [...capability.attachments.kinds],
            sourceKinds: capability.attachments.sourceKinds
              ? [...capability.attachments.sourceKinds]
              : undefined,
            allowRemoteUrls: capability.attachments.allowRemoteUrls,
          }
        : undefined,
      structuredAttachments: capability.structuredAttachments
        ? {
            kinds: [...capability.structuredAttachments.kinds],
            sourceKinds: capability.structuredAttachments.sourceKinds
              ? [...capability.structuredAttachments.sourceKinds]
              : undefined,
            allowRemoteUrls: capability.structuredAttachments.allowRemoteUrls,
          }
        : undefined,
      defaultForOutputType: capability.defaultForOutputType,
    })),
  };
}

function getConfiguredModelEntries(
  context: ProviderModelRuntimeContext
): Array<{
  definition: CopilotModelDefinition;
  model: ResolvedProviderModel;
}> {
  return (context.modelDefinitions ?? [])
    .filter(definition => definition.enabled !== false)
    .map(definition => ({
      definition,
      model: toConfiguredProviderModel(context, definition),
    }));
}

function matchConfiguredProviderModel(
  context: ProviderModelRuntimeContext,
  cond: ModelFullConditions
): ResolvedProviderModel | undefined {
  const entries = getConfiguredModelEntries(context);
  if (!entries.length) {
    return;
  }

  if (cond.modelId) {
    const requested = entries.find(({ definition, model }) => {
      return (
        model.id === cond.modelId ||
        model.canonicalKey === cond.modelId ||
        definition?.aliases?.includes(cond.modelId)
      );
    });
    if (!requested) {
      return;
    }

    const matchedModelId = llmMatchModelCapabilities([requested.model], {
      ...cond,
      modelId: requested.model.id,
    });
    return matchedModelId ? requested.model : undefined;
  }

  const models = entries.map(entry => entry.model);
  const matchedModelId = llmMatchModelCapabilities(models, cond);
  return matchedModelId
    ? models.find(model => model.id === matchedModelId)
    : undefined;
}

export type ProviderModelSelection = {
  kind: 'configured';
  model: ResolvedProviderModel;
};

export function resolveProviderModelSelection(
  context: ProviderModelRuntimeContext,
  cond: ModelFullConditions
): ProviderModelSelection | undefined {
  const configuredModel = matchConfiguredProviderModel(context, cond);
  if (configuredModel) {
    return {
      kind: 'configured',
      model: configuredModel,
    };
  }

  if (cond.modelId) {
    const resolved = llmResolveModelRegistryVariant({
      backendKind: context.backendKind,
      modelId: cond.modelId,
    }).variant;
    if (!resolved) {
      return;
    }

    const model = toProviderModel(resolved);
    const matchedModelId = llmMatchModelCapabilities([model], {
      ...cond,
      modelId: model.id,
    });
    if (!matchedModelId) {
      return;
    }

    return {
      kind: 'configured',
      model,
    };
  }

  const resolved = llmMatchModelRegistry({
    backendKind: context.backendKind,
    cond,
  }).variant;
  if (!resolved) {
    return;
  }

  return {
    kind: 'configured',
    model: toProviderModel(resolved),
  };
}

function isMultimodal(model: CopilotProviderModel) {
  return model.capabilities.some(c =>
    [ModelInputType.Image, ModelInputType.Audio, ModelInputType.File].some(t =>
      c.input.includes(t)
    )
  );
}

function handleZodError(ret: z.SafeParseReturnType<any, any>) {
  if (ret.success) return;
  const issues = ret.error.issues.map(i => {
    const path =
      'root' +
      (i.path.length
        ? `.${i.path.map(seg => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('')}`
        : '');
    return `${i.message}${path}`;
  });
  throw new CopilotPromptInvalid(issues.join('; '));
}

export async function inferModelConditionsFromMessages(
  messages?: PromptMessage[],
  withAttachment = true
): Promise<Partial<ModelFullConditions>> {
  if (!messages?.length || !withAttachment) return {};
  const projectedMessages = messages.map(message => ({
    role: message.role,
    content: message.content,
    ...(Array.isArray(message.attachments) && message.attachments.length
      ? {
          attachments: message.attachments.map(attachment =>
            applyPromptAttachmentMimeTypeHintForNative(attachment, message)
          ),
        }
      : {}),
  }));
  const inferredCond = llmInferPromptModelConditions(projectedMessages);

  return {
    ...(inferredCond.attachmentKinds?.length
      ? { attachmentKinds: unique(inferredCond.attachmentKinds) }
      : {}),
    ...(inferredCond.attachmentSourceKinds?.length
      ? {
          attachmentSourceKinds: unique(
            inferredCond.attachmentSourceKinds
          ) as PromptAttachmentSourceKind[],
        }
      : {}),
    ...(inferredCond.inputTypes?.length
      ? { inputTypes: unique(inferredCond.inputTypes) as ModelInputType[] }
      : {}),
    ...(inferredCond.hasRemoteAttachments
      ? { hasRemoteAttachments: true }
      : {}),
  };
}

export function mergeModelConditions(
  cond: ModelFullConditions,
  inferredCond: Partial<ModelFullConditions>
): ModelFullConditions {
  return {
    ...inferredCond,
    ...cond,
    inputTypes: unique([
      ...(inferredCond.inputTypes ?? []),
      ...(cond.inputTypes ?? []),
    ]),
    attachmentKinds: unique([
      ...(inferredCond.attachmentKinds ?? []),
      ...(cond.attachmentKinds ?? []),
    ]),
    attachmentSourceKinds: unique([
      ...(inferredCond.attachmentSourceKinds ?? []),
      ...(cond.attachmentSourceKinds ?? []),
    ]),
    hasRemoteAttachments:
      cond.hasRemoteAttachments ?? inferredCond.hasRemoteAttachments,
  };
}

export function getAttachCapability(
  model: CopilotProviderModel,
  outputType: ModelOutputType
): ModelAttachmentCapability | undefined {
  const capability =
    model.capabilities.find(cap => cap.output.includes(outputType)) ??
    model.capabilities[0];
  if (!capability) {
    return;
  }
  return resolveAttachmentCapability(capability, outputType);
}

export function matchProviderModel(
  context: ProviderModelRuntimeContext,
  cond: ModelFullConditions
): boolean {
  return !!resolveProviderModelSelection(context, cond);
}

export function resolveProviderModel(
  context: ProviderModelRuntimeContext,
  modelId: string
): ResolvedProviderModel | undefined {
  return resolveProviderModelSelection(context, {
    modelId,
  })?.model;
}

export function hasProviderModelBehaviorFlag(
  model: CopilotProviderModel,
  flag: string
) {
  const behaviorFlags = (model as ResolvedProviderModel).behaviorFlags;
  return Array.isArray(behaviorFlags) && behaviorFlags.includes(flag);
}

export function resolveProviderModelRoute(
  model: CopilotProviderModel,
  outputType: ModelOutputType
) {
  const resolved = model as ResolvedProviderModel;
  const override = resolved.routeOverrides?.[outputType];

  return {
    protocol: override?.protocol ?? resolved.protocol,
    requestLayer: override?.requestLayer ?? resolved.requestLayer,
  };
}

export function requireProviderModelSelection(
  context: ProviderModelRuntimeContext,
  cond: ModelFullConditions
): ResolvedProviderModel {
  const selection = resolveProviderModelSelection(context, cond);
  if (selection) return selection.model;

  const { modelId, outputType, inputTypes } = cond;
  throw new CopilotPromptInvalid(
    modelId
      ? `Model ${modelId} does not support ${outputType ?? '<any>'} output with ${inputTypes ?? '<any>'} input`
      : outputType
        ? `No model supports ${outputType} output with ${inputTypes ?? '<any>'} input for provider ${context.type}`
        : 'Output type is required when modelId is not provided'
  );
}

export async function checkProviderParams(
  context: ProviderModelRuntimeContext,
  {
    cond,
    messages,
    embeddings,
    options = {},
    withAttachment = true,
  }: {
    cond: ModelFullConditions;
    messages?: PromptMessage[];
    embeddings?: string[];
    options?:
      | CopilotChatOptions
      | CopilotStructuredOptions
      | CopilotImageOptions;
    withAttachment?: boolean;
    execution?: unknown;
  }
): Promise<ModelFullConditions> {
  if (messages) {
    const { requireContent = true, requireAttachment = false } = options;

    const MessageSchema = z
      .array(
        PromptMessageSchema.extend({
          content: requireContent
            ? z.string().trim().min(1)
            : z.string().optional().nullable(),
        })
          .passthrough()
          .catchall(z.union([z.string(), z.number(), z.date(), z.null()]))
      )
      .optional();

    handleZodError(MessageSchema.safeParse(messages));

    const inferredCond = await inferModelConditionsFromMessages(
      messages,
      withAttachment
    );
    const mergedCond = mergeModelConditions(cond, inferredCond);
    const model = requireProviderModelSelection(context, mergedCond);
    const multimodal = isMultimodal(model);

    if (
      multimodal &&
      requireAttachment &&
      !messages.some(
        message =>
          message.role === 'user' &&
          Array.isArray(message.attachments) &&
          message.attachments.length > 0
      )
    ) {
      throw new CopilotPromptInvalid('attachments required in multimodal mode');
    }

    if (embeddings) {
      handleZodError(EmbeddingMessage.safeParse(embeddings));
    }

    return mergedCond;
  }

  const inferredCond = await inferModelConditionsFromMessages(
    messages,
    withAttachment
  );
  const mergedCond = mergeModelConditions(cond, inferredCond);

  if (embeddings) {
    handleZodError(EmbeddingMessage.safeParse(embeddings));
  }

  return mergedCond;
}
