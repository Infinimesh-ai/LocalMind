import type {
  ConnectExternalMcpMutationVariables,
  ExternalMcpSettingsQuery,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';

import type { ExternalMcpStore } from '../stores/external-mcp';

export type ExternalMcpSettings =
  ExternalMcpSettingsQuery['externalMcpSettings'];
export type ExternalMcpConnection = NonNullable<
  ExternalMcpSettings['connection']
>;

export class ExternalMcpService extends Service {
  private revalidationId = 0;
  private workspaceId: string | null = null;

  constructor(private readonly store: ExternalMcpStore) {
    super();
  }

  settings$ = new LiveData<ExternalMcpSettings | null>(null);
  loading$ = new LiveData(false);
  error$ = new LiveData<unknown>(null);

  async revalidate(workspaceId: string) {
    if (workspaceId !== this.workspaceId) {
      this.workspaceId = workspaceId;
      this.settings$.value = null;
      this.error$.value = null;
    }
    const revalidationId = ++this.revalidationId;
    this.loading$.value = true;
    try {
      const result = await this.store.get(workspaceId);
      if (revalidationId !== this.revalidationId) return;
      this.settings$.value = result.externalMcpSettings;
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

  async connect(input: ConnectExternalMcpMutationVariables['input']) {
    const connected = await this.store.connect(input);
    await this.revalidateIfCurrent(input.workspaceId);
    return connected;
  }

  async refreshTools(workspaceId: string) {
    const result = await this.store.refreshTools(workspaceId);
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async updateToolAllowlist(workspaceId: string, enabledToolNames: string[]) {
    const result = await this.store.updateToolAllowlist(
      workspaceId,
      enabledToolNames
    );
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async testConversation(workspaceId: string, query: string) {
    const result = await this.store.testConversation(workspaceId, query);
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async disable(workspaceId: string) {
    const result = await this.store.disable(workspaceId);
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  async delete(workspaceId: string) {
    const result = await this.store.delete(workspaceId);
    await this.revalidateIfCurrent(workspaceId);
    return result;
  }

  private async revalidateIfCurrent(workspaceId: string) {
    if (workspaceId === this.workspaceId) {
      await this.revalidate(workspaceId);
    }
  }
}
