import { I18nController } from '@affine/core/modules/i18n/lit-controller';
import type { CopilotChatHistoryFragment } from '@affine/graphql';
import { I18n } from '@affine/i18n';
import { WithDisposable } from '@blocksuite/affine/global/lit';
import { scrollbarStyle } from '@blocksuite/affine/shared/styles';
import { unsafeCSSVar, unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import { ShadowlessElement } from '@blocksuite/affine/std';
import { DeleteIcon } from '@blocksuite/icons/lit';
import { css, html, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';

import type { DocDisplayConfig } from '../ai-chat-chips';

interface GroupedSessions {
  today: BlockSuitePresets.AIRecentSession[];
  last7Days: BlockSuitePresets.AIRecentSession[];
  last30Days: BlockSuitePresets.AIRecentSession[];
  older: BlockSuitePresets.AIRecentSession[];
}

type HistorySessionWithMessages = BlockSuitePresets.AIRecentSession &
  Partial<Pick<CopilotChatHistoryFragment, 'messages'>>;

const DEFAULT_SESSION_TITLE = 'New chat';
const TITLE_MAX_LENGTH = 28;

function truncateSessionTitle(text: string) {
  if (text.length <= TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

function deriveSessionTitle(session: HistorySessionWithMessages) {
  const explicit = session.title?.trim();
  if (explicit) return truncateSessionTitle(explicit);
  const firstUserMessage = session.messages?.find(
    message => message.role === 'user'
  );
  const raw = firstUserMessage?.content?.trim();
  if (!raw) return DEFAULT_SESSION_TITLE;
  const newlineIdx = raw.indexOf('\n');
  return truncateSessionTitle(
    newlineIdx === -1 ? raw : raw.slice(0, newlineIdx)
  );
}

export class AISessionHistory extends WithDisposable(ShadowlessElement) {
  readonly languageController = new I18nController(this);

  static override styles = css`
    .ai-session-history {
      width: 316px;
      max-height: 344px;
      padding: 12px 8px;
      overflow-y: auto;
      border: 0.5px solid ${unsafeCSSVarV2('layer/insideBorder/border')};
      background: ${unsafeCSSVarV2('layer/background/primary')};
      border-radius: 4px;
      background: ${unsafeCSSVarV2('layer/background/overlayPanel')};
      box-shadow: ${unsafeCSSVar('overlayPanelShadow')};

      .loading-container,
      .empty-container {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 344px;
      }

      .error-container {
        padding: 16px 8px;
      }

      button {
        border: 0;
        background: transparent;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      button:focus-visible {
        outline: 2px solid ${unsafeCSSVarV2('text/emphasis')};
        outline-offset: -2px;
      }

      .loading-title,
      .empty-title {
        font-weight: 600;
        font-size: var(--affine-font-sm);
        color: var(--affine-text-secondary-color);
      }

      .ai-session-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .ai-session-group-title {
        font-size: 12px;
        font-weight: 400;
        line-height: 20px;
        height: 20px;
        color: ${unsafeCSSVarV2('text/secondary')};
      }

      .ai-session-item {
        position: relative;
        display: flex;
        height: 24px;
        justify-content: space-between;
        align-items: center;
        border-radius: 4px;
        cursor: pointer;
      }

      .ai-session-item:hover:not(:has(.ai-session-doc:hover)) {
        background: ${unsafeCSSVarV2('layer/background/hoverOverlay')};
      }

      .ai-session-item[data-selected='true'] .ai-session-title {
        color: ${unsafeCSSVarV2('text/emphasis')};
      }

      .ai-session-doc:hover {
        background: ${unsafeCSSVarV2('layer/background/hoverOverlay')};
      }

      .ai-session-title {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        font-weight: 400;
        line-height: 20px;
        padding: 2px 4px;
        color: ${unsafeCSSVarV2('text/primary')};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ai-session-doc {
        display: flex;
        width: 120px;
        padding: 2px;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        border-radius: 2px;
        cursor: pointer;

        svg {
          width: 16px;
          height: 16px;
          color: ${unsafeCSSVarV2('icon/primary')};
        }

        .doc-title {
          font-size: 12px;
          font-weight: 400;
          line-height: 20px;
          color: ${unsafeCSSVarV2('text/secondary')};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .ai-session-item-delete {
        position: absolute;
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${unsafeCSSVarV2('layer/background/primary')};
        border-radius: 2px;
        padding: 2px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;

        svg {
          width: 16px;
          height: 16px;
          color: ${unsafeCSSVarV2('icon/primary')};
        }
      }

      .ai-session-item:hover .ai-session-item-delete,
      .ai-session-item:focus-within .ai-session-item-delete {
        opacity: 1;
      }
    }

    ${scrollbarStyle('.ai-session-history')}
  `;

  @property({ attribute: false })
  accessor session!: CopilotChatHistoryFragment | null | undefined;

  @property({ attribute: false })
  accessor docId: string | undefined;

  @property({ attribute: false })
  accessor recentSessions: BlockSuitePresets.AIRecentSession[] = [];

  @property({ attribute: false })
  accessor currentDocSessions: BlockSuitePresets.AIRecentSession[] = [];

  @property({ attribute: false })
  accessor loading = false;

  @property({ attribute: false })
  accessor error: Error | null = null;

  @property({ attribute: false })
  accessor onRetry: () => void = () => {};

  @property({ attribute: false })
  accessor onClose: () => void = () => {};

  @property({ attribute: false })
  accessor docDisplayConfig!: DocDisplayConfig;

  @property({ attribute: false })
  accessor onSessionClick!: (sessionId: string) => void;

  @property({ attribute: false })
  accessor onSessionDelete!: (
    session: BlockSuitePresets.AIRecentSession
  ) => void;

  @property({ attribute: false })
  accessor onDocClick!: (docId: string, sessionId: string) => void;

  @state()
  private accessor selectedSessionId: string | undefined;

  private groupSessionsByTime(
    sessions: BlockSuitePresets.AIRecentSession[]
  ): GroupedSessions {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const last7DaysStart = new Date(
      todayStart.getTime() - 6 * 24 * 60 * 60 * 1000
    );
    const last30DaysStart = new Date(
      todayStart.getTime() - 29 * 24 * 60 * 60 * 1000
    );

    const grouped: GroupedSessions = {
      today: [],
      last7Days: [],
      last30Days: [],
      older: [],
    };

    sessions.forEach(session => {
      const updatedAt = new Date(session.updatedAt);

      if (updatedAt >= todayStart) {
        grouped.today.push(session);
      } else if (updatedAt >= last7DaysStart) {
        grouped.last7Days.push(session);
      } else if (updatedAt >= last30DaysStart) {
        grouped.last30Days.push(session);
      } else {
        grouped.older.push(session);
      }
    });

    // Sort each group by updatedAt in descending order (newest first)
    (Object.keys(grouped) as Array<keyof GroupedSessions>).forEach(key => {
      grouped[key].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });

    return grouped;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.selectedSessionId = this.session?.sessionId ?? undefined;
  }

  protected override firstUpdated() {
    // Floating portals are hidden until their first position calculation.
    // Focusing during the initial Lit update is ignored by the browser.
    requestAnimationFrame(() => {
      if (this.isConnected) {
        this.querySelector<HTMLElement>('.ai-session-history')?.focus();
      }
    });
  }

  protected override willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('session')) {
      this.selectedSessionId = this.session?.sessionId ?? undefined;
    }
  }

  private renderSessionGroup(
    title: string,
    sessions: BlockSuitePresets.AIRecentSession[]
  ) {
    if (sessions.length === 0) {
      return nothing;
    }
    return html`
      <div class="ai-session-group">
        <div class="ai-session-group-title">${title}</div>
        ${sessions.map(session => {
          const sessionTitle = deriveSessionTitle(session);
          return html`
            <div
              class="ai-session-item"
              data-selected=${this.selectedSessionId === session.sessionId}
              data-session-id=${session.sessionId}
            >
              <button
                type="button"
                class="ai-session-title"
                aria-pressed=${this.selectedSessionId === session.sessionId}
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  this.selectedSessionId = session.sessionId;
                  if (session.docId) {
                    this.onDocClick(session.docId, session.sessionId);
                  } else {
                    this.onSessionClick(session.sessionId);
                  }
                }}
              >
                ${sessionTitle}
              </button>
              ${session.docId
                ? this.renderSessionDoc(session.docId, session.sessionId)
                : nothing}
              <button
                type="button"
                class="ai-session-item-delete"
                aria-label=${`${I18n['Delete']()}: ${sessionTitle}`}
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  this.onSessionDelete(session);
                }}
              >
                ${DeleteIcon()}
                <affine-tooltip>${I18n['Delete']()}</affine-tooltip>
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderSessionDoc(docId: string, sessionId: string) {
    const getIcon = this.docDisplayConfig.getIcon(docId);
    const docIcon = typeof getIcon === 'function' ? getIcon() : getIcon;
    return html`<button
      type="button"
      class="ai-session-doc"
      aria-label=${`${I18n['com.affine.ai.action-label.open-this-doc']()}: ${this.docDisplayConfig.getTitle(docId)}`}
      @click=${(e: MouseEvent) => {
        e.stopPropagation();
        this.selectedSessionId = sessionId;
        this.onDocClick(docId, sessionId);
      }}
    >
      ${docIcon}
      <span class="doc-title"> ${this.docDisplayConfig.getTitle(docId)} </span>
      <affine-tooltip
        >${I18n['com.affine.ai.action-label.open-this-doc']()}</affine-tooltip
      >
    </button>`;
  }

  private renderLoading() {
    return html`
      <div class="loading-container" role="status">
        <div class="loading-title">
          ${I18n['com.affine.office.loading-chat-history']()}
        </div>
      </div>
    `;
  }

  private renderEmpty() {
    return html`
      <div class="empty-container">
        <div class="empty-title">
          ${I18n['com.affine.ai.action-label.empty-history']()}
        </div>
      </div>
    `;
  }

  private renderHistory() {
    if (this.loading) {
      return this.renderLoading();
    }

    if (this.error) {
      return html`<div class="error-container" role="alert">
        <p>${I18n['com.affine.localmind.chat.historyFailed']()}</p>
        <button type="button" @click=${this.onRetry}>
          ${I18n['com.affine.localmind.aiContext.retry']()}
        </button>
      </div>`;
    }

    const currentDocSessions = this.currentDocSessions;
    const currentDocSessionIds = new Set(
      currentDocSessions.map(session => session.sessionId)
    );
    const otherSessions = this.recentSessions.filter(
      session =>
        !currentDocSessionIds.has(session.sessionId) &&
        (!this.docId || session.docId !== this.docId)
    );

    if (currentDocSessions.length === 0 && otherSessions.length === 0) {
      return this.renderEmpty();
    }

    const groupedSessions = this.groupSessionsByTime(otherSessions);
    return html`
      ${this.renderSessionGroup(
        I18n['com.affine.localmind.chat.currentDocument'](),
        currentDocSessions
      )}
      ${this.renderSessionGroup(
        I18n['com.affine.today'](),
        groupedSessions.today
      )}
      ${this.renderSessionGroup(
        I18n['com.affine.last7Days'](),
        groupedSessions.last7Days
      )}
      ${this.renderSessionGroup(
        I18n['com.affine.last30Days'](),
        groupedSessions.last30Days
      )}
      ${this.renderSessionGroup(
        I18n['com.affine.moreThan30Days'](),
        groupedSessions.older
      )}
    `;
  }

  override render() {
    return html`
      <div
        class="ai-session-history"
        role="region"
        tabindex="-1"
        aria-label=${I18n['com.affine.ai.action-label.chat-history']()}
        aria-busy=${this.loading}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.onClose();
          }
        }}
      >
        ${this.renderHistory()}
      </div>
    `;
  }
}
