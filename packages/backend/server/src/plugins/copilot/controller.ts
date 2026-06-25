import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  BeforeApplicationShutdown,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BehaviorSubject,
  catchError,
  filter,
  finalize,
  from,
  interval,
  lastValueFrom,
  map,
  merge,
  Observable,
  Subject,
  take,
  takeUntil,
} from 'rxjs';
import { z } from 'zod';

import {
  applyAttachHeaders,
  BadRequest,
  BlobNotFound,
  CallMetric,
  Config,
  mapSseError,
  metrics,
  NotFound,
  UnsplashIsNotConfigured,
} from '../../base';
import { CurrentUser, Internal, Public } from '../../core/auth';
import { Models } from '../../models';
import type {
  CopilotSupportBundleDirectDownloadTransferEvent,
  CopilotSupportBundleDownloadAuthorization,
  CopilotSupportBundleTransferNotificationAuthEvidence,
  CopilotSupportBundleTransferProviderSignatureEvidence,
} from '../../models/copilot-support-bundle';
import {
  ActionStreamHost,
  projectActionEventToChatEvent,
} from './runtime/hosts/action-stream-host';
import { TurnOrchestrator } from './runtime/turn-orchestrator';
import { CopilotStorage } from './storage';
import { getSignal } from './utils';

export interface ChatEvent {
  type: 'event' | 'attachment' | 'message' | 'error' | 'ping';
  id?: string;
  data: string | object;
}

const PING_INTERVAL = 5000;
const SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH = 512;
const SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_STRING_LENGTH = 512;
const SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_SHORT_STRING_LENGTH = 128;
const SUPPORT_BUNDLE_PROVIDER_SIGNATURE_EVIDENCE_HEADER =
  'x-support-bundle-provider-signature-evidence';
const SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_SIGNATURE_HEADER =
  'x-localmind-webhook-signature';
const SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_KEY_ID_HEADER =
  'x-localmind-webhook-key-id';
const SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_SIGNATURE_ALGORITHM = 'hmac-sha256';

const SupportBundleTransferProviderSignatureEvidenceSchema = z
  .object({
    provider: z.enum(['aws_s3', 'cloudflare_r2', 's3_compatible']),
    status: z.literal('verified_by_upstream'),
    verifier: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_SHORT_STRING_LENGTH),
    keyId: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_STRING_LENGTH)
      .optional(),
    algorithm: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_SHORT_STRING_LENGTH)
      .optional(),
    signatureFingerprint: z.string().regex(/^[a-f0-9]{16,64}$/),
    policy: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_SIGNATURE_EVIDENCE_MAX_SHORT_STRING_LENGTH),
  })
  .strict();

const SupportBundleUpstreamVerifiedProviderSignatureEvidenceSchema =
  SupportBundleTransferProviderSignatureEvidenceSchema;

const SupportBundleDownloadTransferEventBodySchema = z
  .object({
    authorizationId: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH),
    eventId: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH)
      .optional(),
    eventSource: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH)
      .optional(),
    storageKey: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH)
      .optional(),
    artifactByteSize: z.number().int().nonnegative().optional(),
    artifactFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    transferredAt: z.string().min(1).optional(),
  })
  .strict();

const SupportBundleS3ObjectCreatedTransferEventBodySchema = z
  .object({
    provider: z.literal('s3_object_created'),
    authorizationId: z
      .string()
      .min(1)
      .max(SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH),
    artifactFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    event: z.unknown(),
  })
  .strict();

const SUPPORT_BUNDLE_TRANSFER_EVENT_BAD_REQUEST_MESSAGES = new Set([
  'Support bundle download authorization is not active',
  'Support bundle download authorization is not direct-delivery',
  'Support bundle direct download URL is not available',
  'Support bundle transfer event is from the future',
  'Support bundle transfer event predates the authorization',
  'Support bundle download authorization has expired',
  'Support bundle is not downloadable',
  'Support bundle artifact storage evidence is incomplete',
  'Support bundle transfer event storage key mismatch',
  'Support bundle transfer event byte size mismatch',
  'Support bundle transfer event fingerprint mismatch',
  'Support bundle artifact storage object is missing',
  'Support bundle stored artifact byte size mismatch',
  'Support bundle stored artifact fingerprint mismatch',
  'Support bundle transfer event auth evidence is invalid',
]);

type SupportBundleObjectStorageWebhookConfig =
  AppConfig['copilot']['supportBundles']['objectStorageWebhooks'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseCanonicalSupportBundleDownloadTransferEventBody(
  body: unknown,
  providerSignatureEvidence?: CopilotSupportBundleTransferProviderSignatureEvidence
): CopilotSupportBundleDirectDownloadTransferEvent {
  const parsed = SupportBundleDownloadTransferEventBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  const transferredAt = parsed.data.transferredAt
    ? new Date(parsed.data.transferredAt)
    : undefined;
  if (
    parsed.data.transferredAt &&
    (!transferredAt || Number.isNaN(transferredAt.getTime()))
  ) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  return {
    authorizationId: parsed.data.authorizationId,
    eventId: parsed.data.eventId,
    eventSource: parsed.data.eventSource,
    storageKey: parsed.data.storageKey,
    notificationAuthEvidence:
      buildSupportBundleTransferNotificationAuthEvidence(
        providerSignatureEvidence
      ),
    artifactByteSize: parsed.data.artifactByteSize,
    artifactFingerprint: parsed.data.artifactFingerprint,
    transferredAt,
  };
}

function parseSupportBundleProviderSignatureEvidenceHeader(req: Request) {
  const header = req.get(SUPPORT_BUNDLE_PROVIDER_SIGNATURE_EVIDENCE_HEADER);
  if (!header) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  const evidence =
    SupportBundleUpstreamVerifiedProviderSignatureEvidenceSchema.safeParse(
      parsed
    );
  if (!evidence.success) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  return evidence.data;
}

function decodeS3ObjectKey(key: string) {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
}

function s3String(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed &&
    trimmed.length <= SUPPORT_BUNDLE_TRANSFER_EVENT_MAX_STRING_LENGTH
    ? trimmed
    : undefined;
}

function s3ByteSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function s3TransferredAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return value;
}

function s3ObjectCreatedEventName(value: unknown): string | undefined {
  const eventName = s3String(value);
  if (!eventName || !eventName.startsWith('ObjectCreated:')) {
    return undefined;
  }
  return eventName;
}

function s3ObjectCreatedDetailType(value: unknown): string | undefined {
  const detailType = s3String(value);
  if (detailType !== 'Object Created') {
    return undefined;
  }
  return detailType;
}

function buildSupportBundleTransferNotificationAuthEvidence(
  providerSignatureEvidence?: CopilotSupportBundleTransferProviderSignatureEvidence
): CopilotSupportBundleTransferNotificationAuthEvidence {
  return {
    policy: 'internal_access_token',
    status: 'verified',
    method: 'x-access-token',
    ...(providerSignatureEvidence ? { providerSignatureEvidence } : {}),
  };
}

function normalizeWebhookString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeWebhookSignatureHeader(value: string | undefined) {
  const signature = normalizeWebhookString(value);
  if (!signature) {
    throw new BadRequest(
      'Invalid support bundle object storage webhook signature'
    );
  }
  const normalized = signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : signature;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new BadRequest(
      'Invalid support bundle object storage webhook signature'
    );
  }
  return normalized.toLowerCase();
}

function supportBundleObjectStorageWebhookRawBody(req: Request) {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody?.length) {
    throw new BadRequest(
      'Invalid support bundle object storage webhook payload'
    );
  }
  return rawBody;
}

function verifySupportBundleObjectStorageWebhookSignature(input: {
  req: Request;
  webhook: SupportBundleObjectStorageWebhookConfig;
}) {
  const signature = normalizeWebhookSignatureHeader(
    input.req.get(SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_SIGNATURE_HEADER)
  );
  const expected = createHmac('sha256', input.webhook.secret)
    .update(supportBundleObjectStorageWebhookRawBody(input.req))
    .digest('hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new BadRequest(
      'Invalid support bundle object storage webhook signature'
    );
  }

  return {
    signature,
    fingerprint: createHash('sha256')
      .update(
        [
          'support-bundle-object-storage-webhook-signature/v1',
          input.webhook.id,
          signature,
        ].join(':')
      )
      .digest('hex'),
  };
}

function supportBundleObjectStorageWebhookPolicy(
  webhook: SupportBundleObjectStorageWebhookConfig
) {
  if (webhook.policy) {
    return webhook.policy;
  }
  switch (webhook.provider) {
    case 'aws_s3':
      return 'aws-s3-event-notification';
    case 'cloudflare_r2':
      return 'cloudflare-r2-event-notification';
    default:
      return 's3-compatible-event-notification';
  }
}

function supportBundleObjectStorageWebhookProviderEvidence(input: {
  req: Request;
  signature: ReturnType<
    typeof verifySupportBundleObjectStorageWebhookSignature
  >;
  webhook: SupportBundleObjectStorageWebhookConfig;
}): CopilotSupportBundleTransferProviderSignatureEvidence {
  const keyId =
    normalizeWebhookString(
      input.req.get(SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_KEY_ID_HEADER)
    ) ?? input.webhook.id;

  return {
    provider: input.webhook.provider,
    status: 'verified_by_upstream',
    verifier: input.webhook.verifier ?? 'support-bundle-object-storage-webhook',
    ...(keyId ? { keyId } : {}),
    algorithm:
      input.webhook.signatureAlgorithm ??
      SUPPORT_BUNDLE_OBJECT_STORAGE_WEBHOOK_SIGNATURE_ALGORITHM,
    signatureFingerprint: input.signature.fingerprint,
    policy: supportBundleObjectStorageWebhookPolicy(input.webhook),
  };
}

function supportBundleObjectStorageWebhookConfig(
  config: Config,
  webhookId: string
) {
  const normalizedWebhookId = normalizeWebhookString(webhookId);
  if (!normalizedWebhookId) {
    throw new NotFound();
  }
  const matches = config.copilot.supportBundles.objectStorageWebhooks.filter(
    webhook => webhook.id === normalizedWebhookId
  );
  if (matches.length !== 1) {
    throw new NotFound();
  }
  return matches[0];
}

function translateS3RecordTransferEvent(
  authorizationId: string,
  event: Record<string, unknown>,
  artifactFingerprint?: string
) {
  const records = event.Records;
  if (!Array.isArray(records) || records.length !== 1) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const record = records[0];
  if (!isRecord(record)) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const eventName = s3ObjectCreatedEventName(record.eventName);
  if (!eventName) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const s3 = record.s3;
  const responseElements = record.responseElements;
  if (!isRecord(s3)) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const object = s3.object;
  if (!isRecord(object)) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const key = s3String(object.key);
  const artifactByteSize = s3ByteSize(object.size);
  if (!key || artifactByteSize === undefined) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const requestId = isRecord(responseElements)
    ? s3String(responseElements['x-amz-request-id'])
    : undefined;

  return {
    authorizationId,
    eventId: requestId ?? s3String(object.sequencer),
    eventSource: s3String(record.eventSource) ?? 'aws:s3',
    storageKey: decodeS3ObjectKey(key),
    artifactByteSize,
    artifactFingerprint,
    transferredAt: s3TransferredAt(record.eventTime),
  };
}

function translateS3EventBridgeTransferEvent(
  authorizationId: string,
  event: Record<string, unknown>,
  artifactFingerprint?: string
) {
  const detailType = s3ObjectCreatedDetailType(event['detail-type']);
  if (!detailType) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const detail = event.detail;
  if (!isRecord(detail)) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const object = detail.object;
  if (!isRecord(object)) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }
  const key = s3String(object.key);
  const artifactByteSize = s3ByteSize(object.size);
  if (!key || artifactByteSize === undefined) {
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  return {
    authorizationId,
    eventId: s3String(event.id),
    eventSource: s3String(event.source) ?? 'aws.s3',
    storageKey: decodeS3ObjectKey(key),
    artifactByteSize,
    artifactFingerprint,
    transferredAt: s3TransferredAt(event.time),
  };
}

function parseS3ObjectCreatedSupportBundleTransferEventBody(
  body: unknown,
  providerSignatureEvidence?: CopilotSupportBundleTransferProviderSignatureEvidence
): CopilotSupportBundleDirectDownloadTransferEvent {
  const parsed =
    SupportBundleS3ObjectCreatedTransferEventBodySchema.safeParse(body);
  if (!parsed.success || !isRecord(parsed.data.event)) {
    if (isRecord(body) && 'providerSignatureEvidence' in body) {
      throw new BadRequest(
        'Support bundle transfer event provider signature evidence must be supplied by verified forwarding headers'
      );
    }
    throw new BadRequest('Invalid support bundle transfer event payload');
  }

  const translated = Array.isArray(parsed.data.event.Records)
    ? translateS3RecordTransferEvent(
        parsed.data.authorizationId,
        parsed.data.event,
        parsed.data.artifactFingerprint
      )
    : translateS3EventBridgeTransferEvent(
        parsed.data.authorizationId,
        parsed.data.event,
        parsed.data.artifactFingerprint
      );

  return parseCanonicalSupportBundleDownloadTransferEventBody(
    translated,
    providerSignatureEvidence
  );
}

function parseSupportBundleDownloadTransferEventBody(
  req: Request,
  body: unknown
): CopilotSupportBundleDirectDownloadTransferEvent {
  const providerSignatureEvidence =
    parseSupportBundleProviderSignatureEvidenceHeader(req);

  const canonical =
    SupportBundleDownloadTransferEventBodySchema.safeParse(body);
  if (canonical.success) {
    return parseCanonicalSupportBundleDownloadTransferEventBody(
      body,
      providerSignatureEvidence
    );
  }

  return parseS3ObjectCreatedSupportBundleTransferEventBody(
    body,
    providerSignatureEvidence
  );
}

function toSupportBundleDownloadTransferEventResponse(
  authorization: CopilotSupportBundleDownloadAuthorization
) {
  return {
    id: authorization.id,
    bundleId: authorization.bundleId,
    workspaceId: authorization.workspaceId,
    actorId: authorization.actorId,
    status: authorization.status,
    artifactKind: authorization.artifactKind,
    artifactFilename: authorization.artifactFilename,
    artifactMime: authorization.artifactMime,
    manifestFingerprint: authorization.manifestFingerprint,
    artifactFingerprint: authorization.artifactFingerprint,
    authorizationFingerprint: authorization.authorizationFingerprint,
    deliveryMethod: authorization.deliveryMethod,
    directDownloadExpiresAt: authorization.directDownloadExpiresAt,
    expiresAt: authorization.expiresAt,
    downloadedAt: authorization.downloadedAt,
    createdAt: authorization.createdAt,
    updatedAt: authorization.updatedAt,
  };
}

@Controller('/api/copilot')
export class CopilotController implements BeforeApplicationShutdown {
  private readonly logger = new Logger(CopilotController.name);
  private readonly ongoingStreamCount$ = new BehaviorSubject(0);

  constructor(
    private readonly config: Config,
    private readonly orchestrator: TurnOrchestrator,
    private readonly actionStreams: ActionStreamHost,
    private readonly storage: CopilotStorage,
    private readonly models: Models
  ) {}

  async beforeApplicationShutdown() {
    await lastValueFrom(
      this.ongoingStreamCount$.asObservable().pipe(
        filter(count => count === 0),
        take(1)
      )
    );
    this.ongoingStreamCount$.complete();
  }

  private mergePingStream(
    messageId: string,
    source$: Observable<ChatEvent>
  ): Observable<ChatEvent> {
    const subject$ = new Subject();
    const ping$ = interval(PING_INTERVAL).pipe(
      map(() => ({ type: 'ping' as const, id: messageId, data: '' })),
      takeUntil(subject$)
    );

    return merge(source$.pipe(finalize(() => subject$.next(null))), ping$);
  }

  private toMessageEvent(messageId: string | undefined, data: string | object) {
    return { type: 'message' as const, id: messageId, data };
  }

  private toAttachmentEvent(messageId: string | undefined, data: string) {
    return { type: 'attachment' as const, id: messageId, data };
  }

  @Sse('/chat/:sessionId/stream')
  @CallMetric('ai', 'chat_stream', { timer: true })
  async chatStream(
    @CurrentUser() user: CurrentUser,
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Query() query: Record<string, string>
  ): Promise<Observable<ChatEvent>> {
    const info: any = { sessionId, params: query, throwInStream: false };

    try {
      const { signal, onConnectionClosed } = getSignal(req);
      let endBeforePromiseResolve = false;
      onConnectionClosed(isAborted => {
        if (isAborted) {
          endBeforePromiseResolve = true;
        }
      });

      const prepared = await this.orchestrator.streamText(
        user.id,
        sessionId,
        query,
        signal,
        () => endBeforePromiseResolve
      );

      info.model = prepared.model;
      info.finalMessage = prepared.finalMessage.filter(
        m => m.role !== 'system'
      );
      metrics.ai.counter('chat_stream_calls').add(1, { model: prepared.model });
      this.ongoingStreamCount$.next(this.ongoingStreamCount$.value + 1);

      const source$ = from(prepared.stream).pipe(
        map(data => this.toMessageEvent(prepared.messageId, data)),
        catchError(e => {
          metrics.ai.counter('chat_stream_errors').add(1);
          info.throwInStream = true;
          return mapSseError(e, info);
        }),
        finalize(() => {
          this.ongoingStreamCount$.next(this.ongoingStreamCount$.value - 1);
        })
      );

      return this.mergePingStream(prepared.messageId || '', source$);
    } catch (err) {
      metrics.ai.counter('chat_stream_errors').add(1, info);
      return mapSseError(err, info);
    }
  }

  @Sse('/chat/:sessionId/stream-object')
  @CallMetric('ai', 'chat_object_stream', { timer: true })
  async chatStreamObject(
    @CurrentUser() user: CurrentUser,
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Query() query: Record<string, string>
  ): Promise<Observable<ChatEvent>> {
    const info: any = { sessionId, params: query, throwInStream: false };

    try {
      const { signal, onConnectionClosed } = getSignal(req);
      let endBeforePromiseResolve = false;
      onConnectionClosed(isAborted => {
        if (isAborted) {
          endBeforePromiseResolve = true;
        }
      });

      const prepared = await this.orchestrator.streamObject(
        user.id,
        sessionId,
        query,
        signal,
        () => endBeforePromiseResolve
      );

      info.model = prepared.model;
      info.finalMessage = prepared.finalMessage.filter(
        m => m.role !== 'system'
      );
      metrics.ai.counter('chat_object_stream_calls').add(1, {
        model: prepared.model,
      });
      this.ongoingStreamCount$.next(this.ongoingStreamCount$.value + 1);

      const source$ = from(prepared.stream).pipe(
        map(data => this.toMessageEvent(prepared.messageId, data)),
        catchError(e => {
          metrics.ai.counter('chat_object_stream_errors').add(1);
          info.throwInStream = true;
          return mapSseError(e, info);
        }),
        finalize(() => {
          this.ongoingStreamCount$.next(this.ongoingStreamCount$.value - 1);
        })
      );

      return this.mergePingStream(prepared.messageId || '', source$);
    } catch (err) {
      metrics.ai.counter('chat_object_stream_errors').add(1, info);
      return mapSseError(err, info);
    }
  }

  @Sse('/actions/:sessionId/stream')
  @CallMetric('ai', 'action_stream', { timer: true })
  async actionStream(
    @CurrentUser() user: CurrentUser,
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Query() query: Record<string, string>
  ): Promise<Observable<ChatEvent>> {
    const info: any = { sessionId, params: query, throwInStream: false };
    try {
      const { signal } = getSignal(req);

      const prepared = await this.actionStreams.stream(
        user.id,
        sessionId,
        query,
        signal
      );
      info.actionId = prepared.actionId;
      info.actionVersion = prepared.actionVersion;
      metrics.ai.counter('action_stream_calls').add(1, {
        actionId: prepared.actionId,
        actionVersion: prepared.actionVersion,
      });
      this.ongoingStreamCount$.next(this.ongoingStreamCount$.value + 1);

      const source$ = from(prepared.stream).pipe(
        map(data => projectActionEventToChatEvent(prepared.messageId, data)),
        catchError(e => {
          metrics.ai.counter('action_stream_errors').add(1, info);
          info.throwInStream = true;
          return mapSseError(e, info);
        }),
        finalize(() =>
          this.ongoingStreamCount$.next(this.ongoingStreamCount$.value - 1)
        )
      );

      return this.mergePingStream(prepared.messageId || '', source$);
    } catch (err) {
      metrics.ai.counter('action_stream_errors').add(1, info);
      return mapSseError(err, info);
    }
  }

  @Sse('/chat/:sessionId/images')
  @CallMetric('ai', 'chat_images', { timer: true })
  async chatImagesStream(
    @CurrentUser() user: CurrentUser,
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Query() query: Record<string, string>
  ): Promise<Observable<ChatEvent>> {
    const info: any = { sessionId, params: query, throwInStream: false };
    try {
      const { signal, onConnectionClosed } = getSignal(req);
      let endBeforePromiseResolve = false;
      onConnectionClosed(isAborted => {
        if (isAborted) {
          endBeforePromiseResolve = true;
        }
      });

      const prepared = await this.orchestrator.streamImages(
        user.id,
        sessionId,
        query,
        signal,
        () => endBeforePromiseResolve
      );
      info.model = prepared.model;
      metrics.ai.counter('images_stream_calls').add(1, {
        model: prepared.model,
      });
      this.ongoingStreamCount$.next(this.ongoingStreamCount$.value + 1);

      const source$ = from(prepared.stream).pipe(
        map(attachment =>
          this.toAttachmentEvent(prepared.messageId, attachment)
        ),
        catchError(e => {
          metrics.ai.counter('images_stream_errors').add(1, info);
          info.throwInStream = true;
          return mapSseError(e, info);
        }),
        finalize(() =>
          this.ongoingStreamCount$.next(this.ongoingStreamCount$.value - 1)
        )
      );

      return this.mergePingStream(prepared.messageId || '', source$);
    } catch (err) {
      metrics.ai.counter('images_stream_errors').add(1, info);
      return mapSseError(err, info);
    }
  }

  @Get('/unsplash/photos')
  @CallMetric('ai', 'unsplash')
  async unsplashPhotos(
    @Req() req: Request,
    @Res() res: Response,
    @Query() params: Record<string, string>
  ) {
    const { key } = this.config.copilot.unsplash;
    if (!key) {
      throw new UnsplashIsNotConfigured();
    }

    const query = new URLSearchParams(params);
    const response = await fetch(
      `https://api.unsplash.com/search/photos?${query}`,
      {
        headers: { Authorization: `Client-ID ${key}` },
        signal: getSignal(req).signal,
      }
    );

    res.set({
      'Content-Type': response.headers.get('Content-Type'),
      'Content-Length': response.headers.get('Content-Length'),
      'X-Ratelimit-Limit': response.headers.get('X-Ratelimit-Limit'),
      'X-Ratelimit-Remaining': response.headers.get('X-Ratelimit-Remaining'),
    });

    res.status(response.status).send(await response.json());
  }

  @Public()
  @Get('/support-bundles/:authorizationId/manifest')
  async getSupportBundleManifest(
    @Res() res: Response,
    @Param('authorizationId') authorizationId: string,
    @Query('token') token?: string
  ) {
    return await this.getSupportBundleArtifact(res, authorizationId, token);
  }

  @Public()
  @Get('/support-bundles/:authorizationId/artifact')
  async getSupportBundleArtifact(
    @Res() res: Response,
    @Param('authorizationId') authorizationId: string,
    @Query('token') token?: string
  ) {
    if (!token) {
      throw new NotFound();
    }

    const artifact = await this.models.copilotSupportBundle.consumeDownload({
      authorizationId,
      token,
    });
    if (!artifact) {
      throw new NotFound();
    }

    const body = artifact.body;
    res.setHeader('content-type', `${artifact.artifactMime}; charset=utf-8`);
    res.setHeader('content-length', body.length);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${artifact.artifactFilename}"`
    );
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(body);
  }

  @Internal()
  @Post('/support-bundles/download-transfer-events')
  @HttpCode(HttpStatus.OK)
  async ingestSupportBundleDownloadTransferEvent(
    @Req() req: Request,
    @Body() body?: unknown
  ) {
    const input = parseSupportBundleDownloadTransferEventBody(req, body);
    try {
      const forwardingEvent =
        await this.models.copilotSupportBundle.enqueueDirectDownloadTransferForwardingEvent(
          {
            transferEvent: input,
          }
        );
      const result =
        await this.models.copilotSupportBundle.processDirectDownloadTransferForwardingEvent(
          {
            id: forwardingEvent.id,
          }
        );
      if (!result.authorization) {
        throw new Error(
          result.event.failureMessage ??
            'Support bundle transfer forwarding event was not processed'
        );
      }

      return toSupportBundleDownloadTransferEventResponse(result.authorization);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Support bundle download authorization not found'
      ) {
        throw new NotFound(error.message);
      }
      if (
        error instanceof Error &&
        SUPPORT_BUNDLE_TRANSFER_EVENT_BAD_REQUEST_MESSAGES.has(error.message)
      ) {
        throw new BadRequest(error.message);
      }

      throw error;
    }
  }

  @Public()
  @Post('/support-bundles/object-storage-webhooks/:webhookId')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestSupportBundleObjectStorageWebhook(
    @Req() req: Request,
    @Param('webhookId') webhookId: string,
    @Body() body?: unknown
  ) {
    const webhook = supportBundleObjectStorageWebhookConfig(
      this.config,
      webhookId
    );
    const signature = verifySupportBundleObjectStorageWebhookSignature({
      req,
      webhook,
    });
    const transferEvent = parseS3ObjectCreatedSupportBundleTransferEventBody(
      body,
      supportBundleObjectStorageWebhookProviderEvidence({
        req,
        signature,
        webhook,
      })
    );

    try {
      const forwardingEvent =
        await this.models.copilotSupportBundle.enqueueDirectDownloadTransferForwardingEvent(
          {
            transferEvent,
          }
        );

      return {
        id: forwardingEvent.id,
        authorizationId: forwardingEvent.authorizationId,
        status: forwardingEvent.status,
        eventId: forwardingEvent.eventId,
        eventSource: forwardingEvent.eventSource,
        forwardingEventFingerprint: forwardingEvent.forwardingEventFingerprint,
        forwardingPayloadFingerprint:
          forwardingEvent.forwardingPayloadFingerprint,
        providerSignatureEvidenceFingerprint:
          forwardingEvent.providerSignatureEvidenceFingerprint,
        nextAttemptAt: forwardingEvent.nextAttemptAt,
        createdAt: forwardingEvent.createdAt,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Support bundle download authorization not found'
      ) {
        throw new NotFound(error.message);
      }
      if (
        error instanceof Error &&
        SUPPORT_BUNDLE_TRANSFER_EVENT_BAD_REQUEST_MESSAGES.has(error.message)
      ) {
        throw new BadRequest(error.message);
      }

      throw error;
    }
  }

  @Public()
  @Get('/blob/:userId/:workspaceId/:key')
  async getBlob(
    @Res() res: Response,
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string
  ) {
    const { body, metadata, redirectUrl } = await this.storage.get(
      userId,
      workspaceId,
      key,
      true
    );

    if (redirectUrl) {
      // redirect to signed url
      return res.redirect(redirectUrl);
    }

    if (!body) {
      throw new BlobNotFound({
        spaceId: workspaceId,
        blobId: key,
      });
    }

    // metadata should always exists if body is not null
    if (metadata) {
      res.setHeader('content-type', metadata.contentType);
      res.setHeader('last-modified', metadata.lastModified.toUTCString());
      res.setHeader('content-length', metadata.contentLength);
    } else {
      this.logger.warn(`Blob ${workspaceId}/${key} has no metadata`);
    }
    applyAttachHeaders(res, {
      contentType: metadata?.contentType,
      filename: key,
    });

    res.setHeader('cache-control', 'public, max-age=2592000, immutable');
    body.pipe(res);
  }
}
