import { CloseIcon, PlusIcon, WarningIcon } from '@blocksuite/icons/lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AIChatModifiedDocument } from '../../runtime/chat';
import type { DocDisplayConfig } from '../ai-chat-chips';

const DISMISSED_DOCUMENT_UPDATE_KEY =
  'localmind:ai-chat:document-update-dismissed';

export function createDocumentUpdateSignature(
  documents: AIChatModifiedDocument[]
) {
  return documents
    .map(document => `${document.docId}:${document.updatedAt}`)
    .sort()
    .join('|');
}

export function createDocumentUpdateStorageKey(
  workspaceId: string,
  sessionId: string
) {
  return `${DISMISSED_DOCUMENT_UPDATE_KEY}:${workspaceId}:${sessionId}`;
}

export function isDocumentUpdateDismissed(
  storage: Pick<Storage, 'getItem'>,
  storageKey: string,
  documents: AIChatModifiedDocument[]
) {
  try {
    const stored = storage.getItem(storageKey);
    if (!stored) return false;
    const versions = JSON.parse(stored) as unknown;
    if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
      return false;
    }
    return documents.every(
      document =>
        (versions as Record<string, unknown>)[document.docId] ===
        document.updatedAt
    );
  } catch {
    return false;
  }
}

export function persistDocumentUpdateDismissal(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  storageKey: string,
  documents: AIChatModifiedDocument[]
) {
  try {
    const stored = storage.getItem(storageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : {};
    const versions =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    for (const document of documents) {
      versions[document.docId] = document.updatedAt;
    }
    storage.setItem(storageKey, JSON.stringify(versions));
    return true;
  } catch {
    return false;
  }
}

@customElement('ai-chat-document-update-alert')
export class AIChatDocumentUpdateAlert extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .alert {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      margin: 4px 0 8px;
      padding: 8px 10px;
      border: 1px solid var(--affine-warning-color, #d99a1b);
      border-radius: 6px;
      background: var(--affine-warning-background, #fff8df);
      color: var(--affine-text-primary-color, #121212);
    }

    .warning-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--affine-warning-color, #9a6700);
    }

    .warning-icon svg,
    button svg {
      width: 16px;
      height: 16px;
    }

    .copy {
      min-width: 0;
      line-height: 18px;
    }

    .title {
      font-size: 13px;
      font-weight: 600;
    }

    .description {
      color: var(--affine-text-secondary-color, #666);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      height: 28px;
      border: 0;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }

    .new-chat {
      gap: 4px;
      padding: 0 8px;
      background: var(--affine-button-background-primary, #1e1e1e);
      color: var(--affine-button-foreground-primary, #fff);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    .dismiss {
      width: 28px;
      padding: 0;
      background: transparent;
      color: var(--affine-icon-secondary, #666);
    }

    button:hover {
      filter: brightness(0.94);
    }

    button:focus-visible {
      outline: 2px solid var(--affine-link-color, #1e66d0);
      outline-offset: 1px;
    }

    @media (max-width: 520px) {
      .alert {
        grid-template-columns: 20px minmax(0, 1fr) 28px;
      }

      .new-chat {
        grid-column: 2;
        justify-self: start;
      }

      .dismiss {
        grid-column: 3;
        grid-row: 1;
      }
    }
  `;

  @property({ attribute: false })
  accessor workspaceId = '';

  @property({ attribute: false })
  accessor sessionId: string | null = null;

  @property({ attribute: false })
  accessor documents: AIChatModifiedDocument[] = [];

  @property({ attribute: false })
  accessor docDisplayConfig: DocDisplayConfig | undefined;

  @property({ attribute: false })
  accessor onNewChat: (() => void | Promise<void>) | undefined;

  private dismissedSignature: string | null = null;
  private dismissedStorageKey: string | null = null;

  private get signature() {
    return createDocumentUpdateSignature(this.documents);
  }

  private get storageKey() {
    return this.sessionId && this.workspaceId
      ? createDocumentUpdateStorageKey(this.workspaceId, this.sessionId)
      : null;
  }

  private get isDismissed() {
    const storageKey = this.storageKey;
    if (!storageKey || !this.signature) return false;
    if (
      this.dismissedStorageKey === storageKey &&
      this.dismissedSignature === this.signature
    ) {
      return true;
    }
    return isDocumentUpdateDismissed(
      window.localStorage,
      storageKey,
      this.documents
    );
  }

  private get documentLabel() {
    const titles = this.documents.map(document => {
      const title = this.docDisplayConfig?.getTitle(document.docId)?.trim();
      return title || 'Untitled document';
    });
    const visible = titles.slice(0, 2).map(title => `“${title}”`);
    const remaining = titles.length - visible.length;
    return remaining > 0
      ? `${visible.join(', ')} and ${remaining} more`
      : visible.join(' and ');
  }

  private readonly dismiss = () => {
    const storageKey = this.storageKey;
    if (!storageKey || !this.signature) return;
    this.dismissedStorageKey = storageKey;
    this.dismissedSignature = this.signature;
    persistDocumentUpdateDismissal(
      window.localStorage,
      storageKey,
      this.documents
    );
    this.requestUpdate();
  };

  private readonly createNewChat = () => {
    Promise.resolve(this.onNewChat?.()).catch(console.error);
  };

  override render() {
    if (
      !this.sessionId ||
      !this.documents.length ||
      !this.signature ||
      this.isDismissed
    ) {
      return nothing;
    }

    const plural = this.documents.length > 1;
    return html`
      <div
        class="alert"
        role="status"
        aria-live="polite"
        data-testid="ai-chat-document-update-alert"
      >
        <span class="warning-icon">${WarningIcon()}</span>
        <div class="copy">
          <div class="title">Document updated</div>
          <div class="description">
            ${this.documentLabel} ${plural ? 'have' : 'has'} changed since
            ${plural ? 'they were' : 'it was'} added. This chat still uses the
            earlier version.
          </div>
        </div>
        <button
          class="new-chat"
          type="button"
          data-testid="ai-chat-document-update-new-chat"
          @click=${this.createNewChat}
        >
          ${PlusIcon()} <span>New chat</span>
        </button>
        <button
          class="dismiss"
          type="button"
          aria-label="Dismiss document update warning"
          data-testid="ai-chat-document-update-dismiss"
          @click=${this.dismiss}
        >
          ${CloseIcon()}
          <affine-tooltip>Dismiss</affine-tooltip>
        </button>
      </div>
    `;
  }
}
