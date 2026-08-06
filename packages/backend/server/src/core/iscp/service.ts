import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { Config, URLHelper } from '../../base';
import { Models } from '../../models';
import { IscpControllerClient } from './client';

const PAIRING_TTL_MS = 10 * 60 * 1000;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

@Injectable()
export class IscpService {
  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly url: URLHelper,
    private readonly controller: IscpControllerClient
  ) {}

  get enabled() {
    return (
      this.config.iscp.enabled && Boolean(this.config.iscp.controllerToken)
    );
  }

  get domainId() {
    return this.config.iscp.domainId;
  }

  async createPairing(userId: string) {
    if (!this.enabled) {
      throw new Error('SparkClaw integration is not enabled on this server');
    }
    const token = randomBytes(32).toString('base64url');
    const deviceId = `sparkclaw-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    await this.models.iscp.createEnrollment({
      userId,
      pairingTokenHash: this.hashToken(token),
      deviceId,
      expiresAt,
    });
    const server = this.url.requestOrigin.replace(/\/$/, '');
    const command = `curl -fsSL ${shellQuote(`${server}/api/iscp/install.sh`)} | sh -s -- --server ${shellQuote(server)} --pairing-token ${shellQuote(token)}`;
    return { command, expiresAt };
  }

  async getPairing(token: string) {
    const enrollment = await this.models.iscp.getEnrollmentByTokenHash(
      this.hashToken(token)
    );
    if (
      !enrollment ||
      enrollment.status !== 'pending' ||
      enrollment.expiresAt.getTime() <= Date.now()
    ) {
      throw new Error('Pairing token is invalid or expired');
    }
    return enrollment;
  }

  async enroll(token: string, request: unknown) {
    const enrollment = await this.getPairing(token);
    const parsed = this.parseEnrollmentRequest(request);
    if (
      parsed.identity.domain_id !== this.config.iscp.domainId ||
      parsed.identity.device_id !== enrollment.deviceId
    ) {
      throw new Error('Enrollment identity does not match this pairing');
    }
    const bundle = await this.controller.enroll({
      endpoint_id: enrollment.deviceId,
      request,
    });
    await this.models.iscp.completeEnrollment({
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      deviceId: enrollment.deviceId,
      domainId: parsed.identity.domain_id,
      identity: parsed.identity as Prisma.InputJsonValue,
      thumbprint: parsed.identity.public_key.kid,
      request: request as Prisma.InputJsonValue,
    });
    return bundle;
  }

  async listEndpoints(userId: string) {
    if (!this.enabled) return [];
    return await this.models.iscp.listEndpoints(userId);
  }

  async disconnect(userId: string, endpointId: string) {
    const endpoint = await this.models.iscp.getEndpoint(userId, endpointId);
    if (!endpoint) throw new Error('SparkClaw endpoint not found');
    await this.controller.revoke(endpoint.deviceId);
    await this.models.iscp.revokeEndpoint(userId, endpointId);
  }

  private parseEnrollmentRequest(value: unknown) {
    if (!value || typeof value !== 'object') {
      throw new Error('Enrollment request must be a JSON object');
    }
    const request = value as {
      type?: unknown;
      product_kind?: unknown;
      runtime_kind?: unknown;
      identity?: {
        type?: unknown;
        domain_id?: unknown;
        device_id?: unknown;
        public_key?: { kid?: unknown; public?: unknown };
      };
    };
    if (
      request.type !== 'sparkclaw.bridge.enrollment_request.v1' ||
      request.product_kind !== 'sparkclaw' ||
      request.runtime_kind !== 'sparkclaw' ||
      request.identity?.type !== 'iscp.device.identity.v2' ||
      typeof request.identity.domain_id !== 'string' ||
      typeof request.identity.device_id !== 'string' ||
      typeof request.identity.public_key?.kid !== 'string' ||
      typeof request.identity.public_key.public !== 'string'
    ) {
      throw new Error('Invalid SparkClaw enrollment request');
    }
    return request as {
      identity: {
        type: string;
        domain_id: string;
        device_id: string;
        public_key: { kid: string; public: string };
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
