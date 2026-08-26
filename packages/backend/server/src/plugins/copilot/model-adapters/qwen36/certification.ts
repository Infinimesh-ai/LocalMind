import type { CopilotChatTools } from '../../providers/types';
import {
  type ModelAdapterCapability,
  type ModelAdapterCapabilityId,
  modelAdapterReleaseGatePassed,
} from '../types';

export const QWEN36_MODEL_ADAPTER_VERSION = '9';
export const QWEN36_MINIMUM_CERTIFICATION_RUNS = 20;
export const QWEN36_PRODUCTION_ATTACHMENT_MIME_TYPES = ['text/plain'] as const;

type Qwen36AttachmentContext = {
  attachmentId: string;
  mimeType: string;
  extractedText?: string;
  extractedTextTruncated?: boolean;
  suppliedToModel?: boolean;
};

export type Qwen36ProductionAttachmentRejection = {
  attachmentId: string;
  mimeType: string;
  reason:
    | 'mime_not_certified'
    | 'provider_native_bytes_not_certified'
    | 'extracted_text_truncated';
};

export function qwen36ProductionAttachmentRejection(
  attachments: readonly Qwen36AttachmentContext[]
): Qwen36ProductionAttachmentRejection | undefined {
  for (const attachment of attachments) {
    const mimeType = attachment.mimeType.trim().toLowerCase();
    if (
      !QWEN36_PRODUCTION_ATTACHMENT_MIME_TYPES.includes(
        mimeType as (typeof QWEN36_PRODUCTION_ATTACHMENT_MIME_TYPES)[number]
      )
    ) {
      return {
        attachmentId: attachment.attachmentId,
        mimeType,
        reason: 'mime_not_certified',
      };
    }
    if (attachment.suppliedToModel || !attachment.extractedText?.trim()) {
      return {
        attachmentId: attachment.attachmentId,
        mimeType,
        reason: 'provider_native_bytes_not_certified',
      };
    }
    if (attachment.extractedTextTruncated) {
      return {
        attachmentId: attachment.attachmentId,
        mimeType,
        reason: 'extracted_text_truncated',
      };
    }
  }
  return undefined;
}

export function pendingQwen36ReleaseGate() {
  return {
    adapterVersion: QWEN36_MODEL_ADAPTER_VERSION,
    minimumRuns: QWEN36_MINIMUM_CERTIFICATION_RUNS,
    totalRuns: 0,
    successfulRuns: 0,
    falseSuccesses: 0,
    duplicateSideEffects: 0,
    crossModelFallbacks: 0,
  };
}

const CAPABILITY_TOOL_CATEGORIES: Partial<
  Record<ModelAdapterCapabilityId, readonly CopilotChatTools[]>
> = {
  'document.read': ['docRead'],
  'document.create': ['docCreate'],
  'document.update': ['docUpdate'],
  'document.update_meta': ['docUpdateMeta'],
  'document.search': ['docKeywordSearch', 'docSemanticSearch'],
  'workspace.folder': ['workspaceOrganization'],
};

export function qwen36ProductionToolCategories(
  capabilities: readonly ModelAdapterCapability[]
) {
  const categories = new Set<CopilotChatTools>();
  for (const capability of capabilities) {
    if (
      capability.status !== 'enabled' ||
      !capability.releaseGate ||
      !modelAdapterReleaseGatePassed(
        capability.releaseGate,
        QWEN36_MODEL_ADAPTER_VERSION
      )
    ) {
      continue;
    }
    for (const category of CAPABILITY_TOOL_CATEGORIES[capability.id] ?? []) {
      categories.add(category);
    }
  }
  return [...categories];
}

export function qwen36CertificationChecklist(
  capabilities: readonly ModelAdapterCapability[]
) {
  return capabilities.map(capability => ({
    capabilityId: capability.id,
    status: capability.status,
    releaseGate: capability.releaseGate ?? null,
    productionReleased:
      capability.status === 'enabled' &&
      !!capability.releaseGate &&
      modelAdapterReleaseGatePassed(
        capability.releaseGate,
        QWEN36_MODEL_ADAPTER_VERSION
      ),
  }));
}
