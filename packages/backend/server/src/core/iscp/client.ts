import { Injectable } from '@nestjs/common';

import { Config } from '../../base';

interface ControllerError {
  error?: string;
  retryable?: boolean;
}

@Injectable()
export class IscpControllerClient {
  constructor(private readonly config: Config) {}

  async enroll(input: { endpoint_id: string; request: unknown }) {
    return await this.request<Record<string, unknown>>('/v1/enrollments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deliver(input: {
    delivery_id: string;
    device_id: string;
    session_id?: string;
    content: string;
  }) {
    return await this.request<{
      accepted: boolean;
      session_id: string;
      operation_id?: string;
    }>('/v1/deliveries', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async revoke(deviceId: string) {
    await this.request<void>(`/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.config.iscp.enabled || !this.config.iscp.controllerToken) {
      throw new Error('SparkClaw ISCP integration is not configured');
    }
    const response = await fetch(
      `${this.config.iscp.controllerUrl.replace(/\/$/, '')}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(25_000),
        headers: {
          Authorization: `Bearer ${this.config.iscp.controllerToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      }
    );
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as T &
      ControllerError;
    if (!response.ok) {
      const error = new Error(
        body.error || `ISCP controller returned HTTP ${response.status}`
      );
      Object.assign(error, {
        retryable: body.retryable ?? response.status >= 500,
        status: response.status,
      });
      throw error;
    }
    return body;
  }
}
