import { getOrCreateI18n, I18n } from '@affine/i18n';
import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import {
  AiIcon,
  CloseIcon,
  DoneIcon,
  ResetIcon,
  WarningIcon,
} from '@blocksuite/icons/lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AIChatRuntime, AIChatSnapshot } from '../../runtime/chat';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'retry_wait']);

@customElement('ai-context-compaction-status')
export class AIContextCompactionStatus extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 0 var(--h-padding);
    }

    .manual-row {
      display: flex;
      justify-content: flex-end;
      min-height: 28px;
      padding: 2px 0 6px;
    }

    .status-panel {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: start;
      gap: 8px;
      box-sizing: border-box;
      margin: 4px 0 8px;
      padding: 9px 10px;
      border: 1px solid ${unsafeCSSVarV2('layer/insideBorder/border')};
      border-radius: 8px;
      background: ${unsafeCSSVarV2('layer/background/primary')};
      color: ${unsafeCSSVarV2('text/primary')};
    }

    .status-panel[data-tone='error'] {
      border-color: ${unsafeCSSVarV2('status/error')};
    }

    .status-panel[data-tone='success'] {
      border-color: ${unsafeCSSVarV2('status/success')};
    }

    .status-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 20px;
      color: ${unsafeCSSVarV2('icon/secondary')};
    }

    .status-panel[data-tone='error'] .status-icon {
      color: ${unsafeCSSVarV2('status/error')};
    }

    .status-panel[data-tone='success'] .status-icon {
      color: ${unsafeCSSVarV2('status/success')};
    }

    .status-icon svg,
    button svg {
      width: 16px;
      height: 16px;
    }

    .status-panel[data-active='true'] .status-icon svg {
      animation: compaction-spin 900ms linear infinite;
    }

    .copy {
      min-width: 0;
      line-height: 18px;
    }

    .title {
      font-size: 13px;
      font-weight: 600;
    }

    .description,
    .metadata {
      color: ${unsafeCSSVarV2('text/secondary')};
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .metadata {
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }

    details {
      margin-top: 6px;
      font-size: 12px;
    }

    summary {
      width: fit-content;
      color: ${unsafeCSSVarV2('text/link')};
      cursor: pointer;
      font-weight: 500;
      text-underline-offset: 2px;
    }

    summary:focus-visible,
    button:focus-visible {
      outline: 2px solid ${unsafeCSSVarV2('text/link')};
      outline-offset: 2px;
    }

    .summary-copy {
      max-height: 160px;
      margin-top: 6px;
      overflow: auto;
      color: ${unsafeCSSVarV2('text/secondary')};
      line-height: 18px;
      white-space: pre-wrap;
      scrollbar-color: ${unsafeCSSVarV2('icon/secondary')} transparent;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 4px;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      box-sizing: border-box;
      min-height: 28px;
      padding: 0 8px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: ${unsafeCSSVarV2('text/secondary')};
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 500;
    }

    button:hover:not(:disabled) {
      background: ${unsafeCSSVarV2('button/secondary')};
      color: ${unsafeCSSVarV2('text/primary')};
    }

    button.primary {
      background: ${unsafeCSSVarV2('button/primary')};
      color: ${unsafeCSSVarV2('button/pureWhiteText')};
    }

    button.primary:hover:not(:disabled) {
      background: ${unsafeCSSVarV2('button/primary')};
      color: ${unsafeCSSVarV2('button/pureWhiteText')};
      filter: brightness(0.94);
    }

    button:disabled {
      cursor: default;
      opacity: 0.5;
    }

    .dismiss {
      width: 28px;
      padding: 0;
    }

    @keyframes compaction-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 520px) {
      .status-panel {
        grid-template-columns: 20px minmax(0, 1fr);
      }

      .actions {
        grid-column: 2;
        justify-content: flex-start;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .status-panel[data-active='true'] .status-icon svg {
        animation: none;
      }
    }
  `;

  @property({ attribute: false })
  accessor runtime: AIChatRuntime | null | undefined;

  @property({ attribute: false })
  accessor snapshot: AIChatSnapshot | null | undefined;

  private readonly i18n = getOrCreateI18n();
  private readonly onLanguageChanged = () => this.requestUpdate();

  override connectedCallback() {
    super.connectedCallback();
    this.i18n.on('languageChanged', this.onLanguageChanged);
  }

  override disconnectedCallback() {
    this.i18n.off('languageChanged', this.onLanguageChanged);
    super.disconnectedCallback();
  }

  private async dispatch(
    type: Parameters<AIChatRuntime['dispatch']>[0]['type']
  ) {
    await this.runtime?.dispatch({ type } as never);
  }

  private renderManualAction() {
    const snapshot = this.snapshot;
    if (!snapshot?.activeSessionId) return nothing;
    const active = ACTIVE_STATUSES.has(
      snapshot.contextCompaction.task?.status ?? ''
    );
    return html`
      <div class="manual-row">
        <button
          type="button"
          ?disabled=${!snapshot.uiPolicy.canRequestContextCompaction ||
          snapshot.contextCompaction.loading ||
          active}
          data-testid="ai-context-compaction-request"
          @click=${() => this.dispatch('requestContextCompaction')}
        >
          ${AiIcon()}
          <span>${I18n['com.affine.localmind.compaction.request']()}</span>
        </button>
      </div>
    `;
  }

  override render() {
    const snapshot = this.snapshot;
    if (!snapshot?.activeSessionId) return nothing;
    const state = snapshot.contextCompaction;
    const task = state.task;
    if (!task || state.dismissedTaskId === task.id) {
      if (!state.error) return this.renderManualAction();
      return this.renderPanel({
        tone: 'error',
        icon: WarningIcon(),
        title: I18n['com.affine.localmind.compaction.statusUnavailable'](),
        description: state.error.message,
        actions: html`
          <button
            class="primary"
            type="button"
            @click=${() => this.dispatch('loadContextCompaction')}
          >
            ${ResetIcon()}
            <span
              >${I18n['com.affine.localmind.compaction.retryStatus']()}</span
            >
          </button>
        `,
      });
    }

    const active = ACTIVE_STATUSES.has(task.status);
    if (active) {
      const retrying = task.status === 'retry_wait';
      return this.renderPanel({
        active: true,
        icon: ResetIcon(),
        title: retrying
          ? I18n['com.affine.localmind.compaction.retryWaiting']()
          : I18n['com.affine.localmind.compaction.running'](),
        description: retrying
          ? I18n['com.affine.localmind.compaction.retryWaitingDescription']()
          : I18n['com.affine.localmind.compaction.runningDescription'](),
        metadata: I18n['com.affine.localmind.compaction.attempt']({
          attempt: String(task.attempt),
          maxAttempts: String(task.maxAttempts),
        }),
        actions: html`
          <button
            type="button"
            ?disabled=${state.loading}
            data-testid="ai-context-compaction-cancel"
            @click=${() => this.dispatch('cancelContextCompaction')}
          >
            ${CloseIcon()}
            <span>${I18n['com.affine.localmind.compaction.cancel']()}</span>
          </button>
        `,
      });
    }

    if (task.status === 'succeeded') {
      return this.renderPanel({
        tone: 'success',
        icon: DoneIcon(),
        title: I18n['com.affine.localmind.compaction.completed'](),
        description: I18n[
          'com.affine.localmind.compaction.completedDescription'
        ]({ count: String(task.summarizedMessageCount) }),
        metadata:
          task.inputTokensEstimated !== null &&
          task.outputTokensEstimated !== null
            ? I18n['com.affine.localmind.compaction.tokenEstimate']({
                input: String(task.inputTokensEstimated),
                output: String(task.outputTokensEstimated),
              })
            : undefined,
        details: task.summary,
        actions: this.renderDismissAction(),
      });
    }

    const cancelled = task.status === 'cancelled';
    const stale = task.status === 'stale';
    return this.renderPanel({
      tone: cancelled || stale ? 'neutral' : 'error',
      icon: cancelled || stale ? CloseIcon() : WarningIcon(),
      title: cancelled
        ? I18n['com.affine.localmind.compaction.cancelled']()
        : stale
          ? I18n['com.affine.localmind.compaction.stale']()
          : I18n['com.affine.localmind.compaction.failed'](),
      description: cancelled
        ? I18n['com.affine.localmind.compaction.cancelledDescription']()
        : stale
          ? I18n['com.affine.localmind.compaction.staleDescription']()
          : task.failureMessage ||
            I18n['com.affine.localmind.compaction.failedDescription'](),
      metadata:
        task.failureCode && !cancelled && !stale
          ? I18n['com.affine.localmind.compaction.failureCode']({
              code: task.failureCode,
            })
          : undefined,
      actions: html`
        ${!cancelled && !stale
          ? html`
              <button
                class="primary"
                type="button"
                ?disabled=${state.loading}
                data-testid="ai-context-compaction-retry"
                @click=${() => this.dispatch('retryContextCompaction')}
              >
                ${ResetIcon()}
                <span>${I18n['com.affine.localmind.compaction.retry']()}</span>
              </button>
            `
          : nothing}
        ${this.renderDismissAction()}
      `,
    });
  }

  private renderDismissAction() {
    return html`
      <button
        class="dismiss"
        type="button"
        aria-label=${I18n['com.affine.localmind.compaction.dismiss']()}
        data-testid="ai-context-compaction-dismiss"
        @click=${() => this.dispatch('dismissContextCompaction')}
      >
        ${CloseIcon()}
      </button>
    `;
  }

  private renderPanel(input: {
    active?: boolean;
    tone?: 'neutral' | 'success' | 'error';
    icon: unknown;
    title: string;
    description: string;
    metadata?: string;
    details?: string | null;
    actions: unknown;
  }) {
    return html`
      <div
        class="status-panel"
        role="status"
        aria-live="polite"
        data-active=${input.active ? 'true' : 'false'}
        data-tone=${input.tone ?? 'neutral'}
        data-testid="ai-context-compaction-status"
      >
        <span class="status-icon" aria-hidden="true">${input.icon}</span>
        <div class="copy">
          <div class="title">${input.title}</div>
          <div class="description">${input.description}</div>
          ${input.metadata
            ? html`<div class="metadata">${input.metadata}</div>`
            : nothing}
          ${input.details
            ? html`
                <details>
                  <summary>
                    ${I18n['com.affine.localmind.compaction.summary']()}
                  </summary>
                  <div class="summary-copy">${input.details}</div>
                </details>
              `
            : nothing}
        </div>
        <div class="actions">${input.actions}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-context-compaction-status': AIContextCompactionStatus;
  }
}
