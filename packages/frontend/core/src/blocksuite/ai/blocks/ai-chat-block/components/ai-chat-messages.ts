import type { TextRendererOptions } from '@affine/core/blocksuite/ai/components/text-renderer';
import { SignalWatcher } from '@blocksuite/affine/global/lit';
import type { EditorHost } from '@blocksuite/affine/std';
import {
  NotificationProvider,
  ThemeProvider,
  UserProvider,
} from '@blocksuite/affine-shared/services';
import { css, html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  type ChatMessage,
  type StreamObject,
} from '../../../components/ai-chat-messages';
import { UserInfoTemplate } from './user-info';

export class AIChatBlockMessage extends SignalWatcher(LitElement) {
  static override styles = css`
    .ai-chat-message {
      display: flex;
      width: 100%;
      flex-direction: column;
      gap: 4px;
      box-sizing: border-box;
    }

    .ai-chat-content {
      display: block;
      width: calc(100% - 34px);
      padding-left: 34px;
      font-weight: 400;
    }

    .with-attachments {
      margin-top: 8px;
    }
  `;

  override render() {
    const {
      content,
      attachments,
      userName,
      userId,
      avatarUrl,
      role,
      streamObjects,
    } = this.message;
    const withAttachments = !!attachments && attachments.length > 0;
    const author = this._currentAuthor(userId, userName, avatarUrl);

    const messageClasses = classMap({
      'with-attachments': withAttachments,
    });

    return html`
      <div class="ai-chat-message">
        ${UserInfoTemplate({ userId, ...author }, role)}
        <div class="ai-chat-content">
          <chat-images .attachments=${attachments}></chat-images>
          <div class=${messageClasses}>
            ${streamObjects?.length
              ? this.renderStreamObjects(streamObjects)
              : this.renderRichText(content)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * The block stores the author's name at send time; show the current public
   * profile of `userId` instead and keep the stored value as fallback.
   */
  private _currentAuthor(
    userId: string | undefined,
    userName: string | undefined,
    avatarUrl: string | undefined
  ) {
    const userService = userId
      ? this.host?.std.getOptional(UserProvider)
      : null;
    if (!userId || !userService) return { userName, avatarUrl };
    userService.revalidateUserInfo(userId);
    const info = userService.userInfo$(userId).value;
    if (!info || info.removed) return { userName, avatarUrl };
    return {
      userName: info.name ?? userName,
      avatarUrl: info.avatar ?? undefined,
    };
  }

  private renderStreamObjects(answer: StreamObject[]) {
    const notificationService = this.host.std.get(NotificationProvider);
    return html`<chat-content-stream-objects
      .answer=${answer}
      .host=${this.host}
      .state=${this.state}
      .extensions=${this.textRendererOptions.extensions}
      .affineFeatureFlagService=${this.textRendererOptions
        .affineFeatureFlagService}
      .notificationService=${notificationService}
      .independentMode=${false}
      .theme=${this.host.std.get(ThemeProvider).app$}
    ></chat-content-stream-objects>`;
  }

  private renderRichText(text: string) {
    return html`<chat-content-rich-text
      .text=${text}
      .state=${this.state}
      .extensions=${this.textRendererOptions.extensions}
      .affineFeatureFlagService=${this.textRendererOptions
        .affineFeatureFlagService}
      .theme=${this.host.std.get(ThemeProvider).app$}
    ></chat-content-rich-text>`;
  }

  @property({ attribute: false })
  accessor message!: ChatMessage;

  @property({ attribute: false })
  accessor host!: EditorHost;

  @property({ attribute: false })
  accessor state: 'finished' | 'generating' = 'finished';

  @property({ attribute: false })
  accessor textRendererOptions: TextRendererOptions = {};
}

export class AIChatBlockMessages extends LitElement {
  static override styles = css`
    :host {
      width: 100%;
      box-sizing: border-box;
    }

    .ai-chat-messages {
      display: flex;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      flex-direction: column;
      gap: 24px;
    }
  `;

  override render() {
    return html`<div class="ai-chat-messages">
      ${repeat(
        this.messages,
        message => message.id || message.createdAt,
        message => {
          return html`
            <ai-chat-block-message
              .host=${this.host}
              .textRendererOptions=${this.textRendererOptions}
              .message=${message}
            ></ai-chat-block-message>
          `;
        }
      )}
    </div>`;
  }

  @property({ attribute: false })
  accessor host!: EditorHost;

  @property({ attribute: false })
  accessor messages: ChatMessage[] = [];

  @property({ attribute: false })
  accessor textRendererOptions: TextRendererOptions = {};
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-chat-block-message': AIChatBlockMessage;
    'ai-chat-block-messages': AIChatBlockMessages;
  }
}
