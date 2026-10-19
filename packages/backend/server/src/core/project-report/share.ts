import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  projectReportAudience,
  reportAudienceAssetBindings,
  ReportAudienceSchema,
  ReportProjectionSchema,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, Config, CryptoHelper } from '../../base';
import { Models } from '../../models';
import type { ReportActor } from '../../models/project-report';
import {
  reportPage,
  type ReportPageInput,
} from '../../models/project-report-pagination';
import { projectResourceHash } from '../../models/project-resource';
import { ProjectBlobStorage } from '../project';
import { ProjectReportContentService } from './content';
import type { ReportCommand } from './contracts';
import { normalizeProjectReportAsset } from './export-renderer';

const sessionSchema = z
  .object({
    authorizationId: z.string(),
    shareId: z.string(),
    actorId: z.string().nullable(),
    expiresAt: z.number(),
  })
  .strict();
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class ProjectReportShareService {
  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly content: ProjectReportContentService,
    private readonly blobs: ProjectBlobStorage,
    private readonly crypto: CryptoHelper,
    private readonly config: Config
  ) {}
  private url(shareId: string, tokenCiphertext: string) {
    try {
      return `/share/reports/${encodeURIComponent(shareId)}#token=${this.crypto.decrypt(tokenCiphertext)}`;
    } catch {
      return undefined;
    }
  }

  async list(input: ReportActor) {
    return (await this.page(input)).items;
  }
  async page(input: ReportPageInput) {
    await this.models.projectReport.get(input);
    const page = reportPage(input, 'shares');
    const rows = await this.db.projectReportShare.findMany({
      where: page.where,
      include: { current: true },
      orderBy: page.orderBy,
      take: page.limit + 1,
    });
    const result = page.finish(rows);
    return {
      ...result,
      items: result.items.map(row => ({
        id: row.id,
        revisionId: row.current?.reportRevisionId,
        status: row.status,
        version: row.version,
        mode: row.current?.accessMode,
        accountIds: row.current?.recipientIds ?? [],
        audience: row.current?.audience,
        allowDownload: row.current?.allowDownload ?? false,
        expiresAt: row.current?.expiresAt,
        url:
          row.status === 'active' && row.current
            ? this.url(row.id, row.current.tokenCiphertext)
            : undefined,
      })),
    };
  }

  async create(
    input: ReportActor & {
      requestKey: string;
      command: Extract<ReportCommand, { operation: 'share.create' }>;
    }
  ) {
    await this.models.projectReport.get(input);
    const command = input.command;
    if (command.mode === 'link' && !this.config.projectReports.allowAnonymous)
      throw new AccessDenied('Anonymous report sharing is disabled');
    const audience = ReportAudienceSchema.parse({
      ...command.audience,
      kind: 'external',
      includeNotes: false,
    });
    if (
      command.mode === 'accounts' &&
      !command.accountIds.length &&
      !command.accountEmails?.length
    )
      throw new BadRequest('Select at least one account');
    const emails = [
      ...new Set(
        (command.accountEmails ?? []).map(email => email.toLowerCase())
      ),
    ];
    const accounts = emails.length
      ? await this.db.user.findMany({
          where: { email: { in: emails } },
          select: { id: true },
        })
      : [];
    if (accounts.length !== emails.length)
      throw new BadRequest('A report recipient is unavailable');
    const recipients = [
      ...new Set([
        ...command.accountIds,
        ...accounts.map(account => account.id),
      ]),
    ];
    if (recipients.length > 100)
      throw new BadRequest('Select at most 100 report recipients');
    if (
      (await this.db.user.count({ where: { id: { in: recipients } } })) !==
      recipients.length
    )
      throw new BadRequest('A report recipient is unavailable');
    const now = Date.now();
    const expiresAt = command.expiresAt
      ? new Date(command.expiresAt)
      : new Date(now + 7 * 86400000);
    if (
      expiresAt.getTime() <= now ||
      expiresAt.getTime() >
        now + this.config.projectReports.maxShareDays * 86400000
    )
      throw new BadRequest('Share expiration exceeds the instance policy');
    const fingerprint = projectResourceHash(command);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      fingerprint,
      operation: 'share.create',
    });
    if (prior) {
      const result = prior.result as {
        shareId: string;
        shareRevisionId: string;
      };
      const share = await this.db.projectReportShare.findUnique({
        where: { id: result.shareId },
        include: { current: true },
      });
      return {
        ...result,
        url:
          share?.status === 'active' &&
          share.current &&
          share.currentRevisionId === result.shareRevisionId
            ? this.url(result.shareId, share.current.tokenCiphertext)
            : undefined,
      };
    }
    const { document, revision } = await this.content.read({
      ...input,
      revisionId: command.revisionId,
    });
    if (revision.kind !== 'final')
      throw new BadRequest('Select a finalized report revision');
    const projection = projectReportAudience(document, audience);
    const blob = await this.blobs.put({
      ...input,
      bytes: Buffer.from(JSON.stringify(projection)),
      mimeType: 'application/vnd.localmind.report-public+json',
    });
    await this.models.projectReport.retainBlobs({ ...input, keys: [blob.key] });
    const shareRevisionId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenCiphertext = this.crypto.encrypt(token);
    const result = await this.models.projectReportShare.save({
      ...input,
      fingerprint,
      shareId: command.shareId,
      expectedShareVersion: command.expectedShareVersion,
      shareRevisionId,
      reportRevisionId: revision.id,
      projectionBlobKey: blob.key,
      audience: JSON.parse(JSON.stringify(audience)),
      accessMode: command.mode,
      recipientIds: recipients,
      tokenHash: digest(token),
      tokenCiphertext,
      passwordHash: command.password
        ? await this.crypto.encryptPassword(command.password)
        : undefined,
      allowDownload: command.allowDownload,
      expiresAt,
    });
    return { ...result, url: this.url(result.shareId, tokenCiphertext) };
  }

  async open(input: {
    shareId: string;
    token: string;
    password?: string;
    actorId?: string;
  }) {
    z.string().min(1).max(2048).parse(input.token);
    if (input.password) z.string().max(256).parse(input.password);
    const { authorization } = await this.models.projectReportShare.authorize({
      ...input,
      tokenHash: digest(input.token),
    });
    if (
      authorization.passwordHash &&
      (!input.password ||
        !(await this.crypto.verifyPassword(
          input.password,
          authorization.passwordHash
        )))
    )
      throw new AccessDenied('Report share is unavailable');
    const expiresAt = Math.min(
      Date.now() + 30 * 60 * 1000,
      authorization.expiresAt.getTime()
    );
    return {
      cookie: this.crypto.encrypt(
        JSON.stringify({
          authorizationId: authorization.id,
          shareId: input.shareId,
          actorId: input.actorId ?? null,
          expiresAt,
        })
      ),
      expiresAt,
    };
  }

  async authorized(input: {
    shareId: string;
    cookie?: string;
    actorId?: string;
  }) {
    let session: z.infer<typeof sessionSchema>;
    try {
      session = sessionSchema.parse(
        JSON.parse(
          this.crypto.decrypt(z.string().max(4096).parse(input.cookie))
        )
      );
    } catch {
      throw new AccessDenied('Report share is unavailable');
    }
    if (
      session.shareId !== input.shareId ||
      session.expiresAt <= Date.now() ||
      session.actorId !== (input.actorId ?? null)
    )
      throw new AccessDenied('Report share is unavailable');
    const result = await this.models.projectReportShare.authorize({
      ...input,
      authorizationId: session.authorizationId,
    });
    if (
      result.authorization.accessMode === 'link' &&
      !this.config.projectReports.allowAnonymous
    )
      throw new AccessDenied('Report share is unavailable');
    return result;
  }

  async read(input: { shareId: string; cookie?: string; actorId?: string }) {
    const { share, authorization } = await this.authorized(input);
    const { bytes } = await this.blobs.read({
      projectId: share.projectId,
      actorId: authorization.actorId,
      key: authorization.projectionBlobKey,
      allowArchivedRead: true,
    });
    ReportProjectionSchema.parse(JSON.parse(bytes.toString('utf8')));
    const { document } = await this.content.read({
      projectId: share.projectId,
      actorId: authorization.actorId,
      reportId: share.reportId,
      revisionId: authorization.reportRevisionId,
    });
    const projection = projectReportAudience(
      document,
      ReportAudienceSchema.parse(authorization.audience)
    );
    const bindings = reportAudienceAssetBindings(
      document,
      ReportAudienceSchema.parse(authorization.audience)
    );
    await this.authorized(input);
    return {
      projection,
      assetUrls: Object.fromEntries(
        bindings.map(binding => [
          binding.publicId,
          `/api/report-shares/${encodeURIComponent(share.id)}/assets/${encodeURIComponent(binding.publicId)}`,
        ])
      ),
      downloads: authorization.allowDownload
        ? Object.fromEntries(
            ['pdf', 'pptx', 'offline'].map(format => [
              format,
              `/api/report-shares/${encodeURIComponent(share.id)}/downloads/${format}`,
            ])
          )
        : {},
    };
  }

  async asset(input: {
    shareId: string;
    cookie?: string;
    actorId?: string;
    assetId: string;
  }) {
    const { share, authorization } = await this.authorized(input);
    const actor = {
      projectId: share.projectId,
      actorId: authorization.actorId,
      reportId: share.reportId,
      revisionId: authorization.reportRevisionId,
    };
    const { document } = await this.content.read(actor);
    const binding = reportAudienceAssetBindings(
      document,
      ReportAudienceSchema.parse(authorization.audience)
    ).find(item => item.publicId === input.assetId);
    if (!binding) throw new AccessDenied('Report image is unavailable');
    const result = await this.blobs.read({
      ...actor,
      key: binding.asset.blobKey,
      allowArchivedRead: true,
    });
    const normalized = await normalizeProjectReportAsset({
      bytes: result.bytes,
      mimeType: result.blob.mimeType,
    });
    await this.authorized(input);
    return {
      bytes: normalized.bytes,
      blob: { ...result.blob, mimeType: normalized.mimeType },
    };
  }
}
