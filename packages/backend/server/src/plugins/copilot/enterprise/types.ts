import type {
  AiEnterpriseConnection,
  EnterpriseProvider,
} from '@prisma/client';

import type { EnterpriseToolCatalogRecord } from '../../../models';

export type EnterpriseConnection = AiEnterpriseConnection;
export type EnterpriseToolDefinition = EnterpriseToolCatalogRecord;
export type EnterpriseToolRisk = EnterpriseToolDefinition['risk'];

export type EnterpriseAuthStatus = {
  authorized: boolean;
  status: 'active' | 'reauth_required' | 'unavailable';
  externalTenantId?: string;
  externalUserId?: string;
  identityType?: string;
  expiresAt?: Date;
};

export type EnterpriseToolCall = {
  tool: EnterpriseToolDefinition;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  confirmed: boolean;
  signal?: AbortSignal;
};

export type EnterpriseToolResult = {
  provider: EnterpriseProvider;
  toolName: string;
  data: unknown;
  resources: EnterpriseResourceRef[];
  meta: {
    durationMs: number;
    idempotencyKey: string;
  };
};

export type EnterpriseResourceRef = {
  provider: 'wecom' | 'lark' | 'dingtalk';
  resourceType: string;
  externalId?: string;
  url?: string;
};

export type EnterpriseAuthorizationChallenge = {
  authorizationUrl?: string;
  userCode?: string;
  qrCodePath?: string;
  expiresAt?: Date;
  clearPrevious?: boolean;
};

export type EnterpriseAuthorizationRequest = {
  signal: AbortSignal;
  qrCodePath?: string;
  onChallenge: (challenge: EnterpriseAuthorizationChallenge) => Promise<void>;
};

export interface EnterpriseCliDriver {
  readonly provider: EnterpriseProvider;

  authorize(
    profileKey: string,
    request: EnterpriseAuthorizationRequest
  ): Promise<EnterpriseAuthStatus>;
  authStatus(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseAuthStatus>;
  discoverTools(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseToolDefinition[]>;
  execute(
    profileKey: string,
    call: EnterpriseToolCall
  ): Promise<EnterpriseToolResult>;
}
