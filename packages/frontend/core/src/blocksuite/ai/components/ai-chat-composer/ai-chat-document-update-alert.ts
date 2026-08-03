import { getOrCreateI18n, I18n } from '@affine/i18n';
import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import { CloseIcon, PlusIcon, WarningIcon } from '@blocksuite/icons/lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AIChatModifiedDocument } from '../../runtime/chat';
import type { DocDisplayConfig } from '../ai-chat-chips';

const DISMISSED_DOCUMENT_UPDATE_KEY =
  'localmind:ai-chat:document-update-dismissed';
const DISMISSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISSAL_STORAGE_LIMIT = 100;

type DocumentUpdateDismissal = {
  expiresAt: number;
  versions: Record<string, unknown>;
};

type DocumentUpdateStorage = Pick<Storage, 'getItem'> &
  Partial<Pick<Storage, 'key' | 'length' | 'removeItem' | 'setItem'>>;

function parseDocumentUpdateDismissal(
  value: string | null
): DocumentUpdateDismissal | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.expiresAt === 'number' &&
    record.versions &&
    typeof record.versions === 'object' &&
    !Array.isArray(record.versions)
  ) {
    return {
      expiresAt: record.expiresAt,
      versions: record.versions as Record<string, unknown>,
    };
  }

  // Read existing flat records once, then rewrite them in the bounded format.
  return {
    expiresAt: Date.now() + DISMISSAL_TTL_MS,
    versions: record,
  };
}

function cleanupDocumentUpdateDismissals(
  storage: DocumentUpdateStorage,
  now: number
) {
  if (
    typeof storage.length !== 'number' ||
    !storage.key ||
    !storage.removeItem
  ) {
    return;
  }
  const entries: Array<{ key: string; expiresAt: number }> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(`${DISMISSED_DOCUMENT_UPDATE_KEY}:`)) continue;
    try {
      const dismissal = parseDocumentUpdateDismissal(storage.getItem(key));
      if (!dismissal || dismissal.expiresAt <= now) {
        storage.removeItem(key);
        index--;
        continue;
      }
      entries.push({ key, expiresAt: dismissal.expiresAt });
    } catch {
      storage.removeItem(key);
      index--;
    }
  }
  for (const entry of entries
    .toSorted((left, right) => left.expiresAt - right.expiresAt)
    .slice(0, Math.max(0, entries.length - DISMISSAL_STORAGE_LIMIT))) {
    storage.removeItem(entry.key);
  }
}

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
  storage: DocumentUpdateStorage,
  storageKey: string,
  documents: AIChatModifiedDocument[]
) {
  try {
    const dismissal = parseDocumentUpdateDismissal(storage.getItem(storageKey));
    if (!dismissal) return false;
    if (dismissal.expiresAt <= Date.now()) {
      storage.removeItem?.(storageKey);
      return false;
    }
    return documents.every(
      document => dismissal.versions[document.docId] === document.updatedAt
    );
  } catch {
    return false;
  }
}

export function persistDocumentUpdateDismissal(
  storage: DocumentUpdateStorage & Pick<Storage, 'setItem'>,
  storageKey: string,
  documents: AIChatModifiedDocument[]
) {
  try {
    const now = Date.now();
    const versions = {
      ...parseDocumentUpdateDismissal(storage.getItem(storageKey))?.versions,
    };
    for (const document of documents) {
      versions[document.docId] = document.updatedAt;
    }
    storage.setItem(
      storageKey,
      JSON.stringify({ expiresAt: now + DISMISSAL_TTL_MS, versions })
    );
    cleanupDocumentUpdateDismissals(storage, now);
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
      border: 1px solid ${unsafeCSSVarV2('chip/tag/yellow')};
      border-radius: 6px;
      background: ${unsafeCSSVarV2('block/callout/background/yellow')};
      color: ${unsafeCSSVarV2('text/primary')};
    }

    .warning-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${unsafeCSSVarV2('block/callout/icon/yellow')};
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
      color: ${unsafeCSSVarV2('text/secondary')};
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
      background: ${unsafeCSSVarV2('button/primary')};
      color: ${unsafeCSSVarV2('button/pureWhiteText')};
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    .dismiss {
      width: 28px;
      padding: 0;
      background: transparent;
      color: ${unsafeCSSVarV2('icon/secondary')};
    }

    button:hover {
      filter: brightness(0.94);
    }

    button:focus-visible {
      outline: 2px solid ${unsafeCSSVarV2('text/link')};
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
      return title || I18n['com.affine.localmind.documentUpdate.untitled']();
    });
    const visible = titles.slice(0, 2).map(title => `“${title}”`);
    const remaining = titles.length - visible.length;
    if (remaining > 0) {
      return I18n['com.affine.localmind.documentUpdate.list.more']({
        documents: visible.join(', '),
        remaining: String(remaining),
      });
    }
    if (visible.length === 2) {
      return I18n['com.affine.localmind.documentUpdate.list.two']({
        first: visible[0],
        second: visible[1],
      });
    }
    return visible[0] ?? '';
  }

  private dismiss() {
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
  }

  private createNewChat() {
    Promise.resolve(this.onNewChat?.()).catch(console.error);
  }

  override render() {
    if (
      !this.sessionId ||
      !this.documents.length ||
      !this.signature ||
      this.isDismissed
    ) {
      return nothing;
    }

    const description =
      this.documents.length > 1
        ? I18n['com.affine.localmind.documentUpdate.description.many']({
            documents: this.documentLabel,
          })
        : I18n['com.affine.localmind.documentUpdate.description.one']({
            documents: this.documentLabel,
          });
    return html`
      <div
        class="alert"
        role="status"
        aria-live="polite"
        data-testid="ai-chat-document-update-alert"
      >
        <span class="warning-icon">${WarningIcon()}</span>
        <div class="copy">
          <div class="title">
            ${I18n['com.affine.localmind.documentUpdate.title']()}
          </div>
          <div class="description">${description}</div>
        </div>
        <button
          class="new-chat"
          type="button"
          data-testid="ai-chat-document-update-new-chat"
          @click=${() => this.createNewChat()}
        >
          ${PlusIcon()}
          <span>${I18n['com.affine.localmind.documentUpdate.newChat']()}</span>
        </button>
        <button
          class="dismiss"
          type="button"
          aria-label=${I18n['com.affine.localmind.documentUpdate.dismiss']()}
          data-testid="ai-chat-document-update-dismiss"
          @click=${() => this.dismiss()}
        >
          ${CloseIcon()}
          <affine-tooltip
            >${I18n[
              'com.affine.localmind.documentUpdate.dismissShort'
            ]()}</affine-tooltip
          >
        </button>
      </div>
    `;
  }
}
