import type {
  EnterpriseAuthorizationSessionQuery,
  EnterpriseConnectionsQuery,
  EnterpriseProvider,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';

import type { EnterpriseStore } from '../stores/enterprise';

const AUTHORIZATION_POLL_INTERVAL_MS = 1_500;
const ACTIVE_AUTHORIZATION_STATUSES = new Set([
  'PENDING',
  'STARTING',
  'WAITING',
]);

export type EnterpriseConnection =
  EnterpriseConnectionsQuery['enterpriseConnections'][number];
export type EnterpriseConnectionPolicy =
  EnterpriseConnectionsQuery['enterpriseConnectionPolicy'];
export type EnterpriseAuthorizationSession =
  EnterpriseAuthorizationSessionQuery['enterpriseAuthorizationSession'];

export class EnterpriseService extends Service {
  private revalidationId = 0;
  private authorizationPollId = 0;
  private workspaceId: string | null = null;

  constructor(private readonly store: EnterpriseStore) {
    super();
  }

  connections$ = new LiveData<EnterpriseConnection[] | null>(null);
  policy$ = new LiveData<EnterpriseConnectionPolicy | null>(null);
  authorization$ = new LiveData<EnterpriseAuthorizationSession | null>(null);
  loading$ = new LiveData(false);
  error$ = new LiveData<unknown>(null);

  async revalidate(workspaceId: string) {
    if (workspaceId !== this.workspaceId) {
      this.workspaceId = workspaceId;
      this.authorizationPollId++;
      this.connections$.value = null;
      this.policy$.value = null;
      this.authorization$.value = null;
      this.error$.value = null;
    }
    const revalidationId = ++this.revalidationId;
    this.loading$.value = true;
    try {
      const data = await this.store.getConnections(workspaceId);
      if (revalidationId !== this.revalidationId) return;
      this.connections$.value = data.enterpriseConnections;
      this.policy$.value = data.enterpriseConnectionPolicy;
      this.error$.value = null;
    } catch (error) {
      if (revalidationId !== this.revalidationId) return;
      this.error$.value = error;
    } finally {
      if (revalidationId === this.revalidationId) {
        this.loading$.value = false;
      }
    }
  }

  async createAndAuthorize(input: {
    workspaceId: string;
    provider: EnterpriseProvider;
    name?: string;
  }) {
    const connection = await this.store.createConnection(input);
    await this.revalidateIfCurrent(input.workspaceId);
    return await this.beginAuthorization(input.workspaceId, connection.id);
  }

  async beginAuthorization(workspaceId: string, connectionId: string) {
    const session = await this.store.beginAuthorization(
      workspaceId,
      connectionId
    );
    this.authorization$.value = session;
    this.startAuthorizationPolling(workspaceId, session.id);
    return session;
  }

  async resumeLatestAuthorization(workspaceId: string, connectionId: string) {
    const session = await this.store.getLatestAuthorization(
      workspaceId,
      connectionId
    );
    if (session && this.isAuthorizationActive(session.status)) {
      this.authorization$.value = session;
      this.startAuthorizationPolling(workspaceId, session.id);
    }
    return session;
  }

  async cancelAuthorization(workspaceId: string, sessionId: string) {
    this.authorizationPollId++;
    const cancelled = await this.store.cancelAuthorization(
      workspaceId,
      sessionId
    );
    this.authorization$.value = await this.store.getAuthorization(
      workspaceId,
      sessionId
    );
    return cancelled;
  }

  clearAuthorization() {
    this.authorizationPollId++;
    this.authorization$.value = null;
  }

  async refreshConnection(workspaceId: string, connectionId: string) {
    const result = await this.store.refreshConnection(
      workspaceId,
      connectionId
    );
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async disableConnection(workspaceId: string, connectionId: string) {
    const result = await this.store.disableConnection(
      workspaceId,
      connectionId
    );
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async deleteConnection(workspaceId: string, connectionId: string) {
    const result = await this.store.deleteConnection(workspaceId, connectionId);
    if (this.authorization$.value?.connectionId === connectionId) {
      this.clearAuthorization();
    }
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  private startAuthorizationPolling(workspaceId: string, sessionId: string) {
    const pollId = ++this.authorizationPollId;
    // oxlint-disable-next-line @typescript-eslint/no-floating-promises
    this.pollAuthorization(workspaceId, sessionId, pollId);
  }

  private async pollAuthorization(
    workspaceId: string,
    sessionId: string,
    pollId: number
  ) {
    try {
      while (pollId === this.authorizationPollId) {
        const session = await this.store.getAuthorization(
          workspaceId,
          sessionId
        );
        if (pollId !== this.authorizationPollId) return;
        this.authorization$.value = session;
        if (!this.isAuthorizationActive(session.status)) {
          if (session.status === 'AUTHORIZED') {
            await this.revalidateIfCurrent(workspaceId);
          }
          return;
        }
        await new Promise(resolve =>
          setTimeout(resolve, AUTHORIZATION_POLL_INTERVAL_MS)
        );
      }
    } catch (error) {
      if (pollId === this.authorizationPollId) {
        this.error$.value = error;
      }
    }
  }

  private isAuthorizationActive(status: string) {
    return ACTIVE_AUTHORIZATION_STATUSES.has(status);
  }

  private async revalidateIfCurrent(workspaceId: string) {
    if (workspaceId === this.workspaceId) {
      await this.revalidate(workspaceId);
    }
  }
}
