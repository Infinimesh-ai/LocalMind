import type { FeatureFlagService } from '@affine/core/modules/feature-flag';
import type { PeekViewService } from '@affine/core/modules/peek-view';
import { WithDisposable } from '@blocksuite/affine/global/lit';
import type { ColorScheme } from '@blocksuite/affine/model';
import {
  type BlockStdScope,
  type EditorHost,
  ShadowlessElement,
} from '@blocksuite/affine/std';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { NotificationService } from '@blocksuite/affine-shared/services';
import { PageIcon, ViewIcon } from '@blocksuite/icons/lit';
import type { Signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';

import type { AffineAIPanelState } from '../../widgets/ai-panel/type';
import type { DocDisplayConfig } from '../ai-chat-chips';
import type { StreamObject } from '../ai-chat-messages';
import { isToolError } from '../ai-tools/tool-result-utils';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function officePreviewSummary(result: Record<string, unknown>) {
  const preview = record(result.previewSummary);
  const operation =
    typeof preview?.operation === 'string'
      ? preview.operation.replace(/^office\./, '').replace(/[._]/g, ' ')
      : null;
  const commandCount =
    typeof result.commandCount === 'number'
      ? result.commandCount
      : typeof preview?.commandCount === 'number'
        ? preview.commandCount
        : null;
  return [
    operation ? `Operation: ${operation}` : null,
    commandCount === null ? null : `Commands: ${commandCount}`,
  ]
    .filter(Boolean)
    .join('. ');
}

export type OfficeToolResultView =
  | { status: 'error'; name: string }
  | {
      status: 'success';
      kind: 'read' | 'request';
      name: string;
      results: Array<{ title: string; content: string }>;
    };

export function officeToolResultView(
  toolName: string,
  result: unknown,
  isError = false
): OfficeToolResultView {
  if (isError || !result || isToolError(result)) {
    const value = record(result);
    return {
      status: 'error',
      name: isToolError(result)
        ? result.name
        : toolName === 'office_read'
          ? 'Office read failed'
          : typeof value?.message === 'string' && value.message.length <= 120
            ? value.message
            : 'Office change request failed',
    };
  }
  const value = record(result);
  if (!value) {
    return {
      status: 'error',
      name: 'Office tool returned invalid evidence',
    };
  }
  if (toolName === 'office_read') {
    const revision =
      typeof value.sequence === 'number'
        ? `Revision ${value.sequence}`
        : typeof value.revisionId === 'string'
          ? value.revisionId
          : 'Current revision';
    const content = value.truncated
      ? 'The Office state exceeded the bounded read limit. A stable-ID index was returned for a narrower follow-up read.'
      : 'Bounded native Office semantic state was read successfully.';
    return {
      status: 'success',
      kind: 'read',
      name: `Read ${revision}`,
      results: [{ title: revision, content }],
    };
  }
  const taskId = typeof value.taskId === 'string' ? value.taskId : null;
  const waiting = value.approvalRequired === true;
  const summary = officePreviewSummary(value);
  return {
    status: 'success',
    kind: 'request',
    name: waiting
      ? 'Office change awaiting approval'
      : 'Office change request saved',
    results: [
      {
        title: waiting ? 'Approval required' : 'Request persisted',
        content: [
          taskId ? `Task ${taskId}.` : null,
          waiting
            ? 'No Office revision has been created. Approve or reject the persisted task in the Office sidebar.'
            : 'Execution status is available from the persisted Office task.',
        ]
          .filter(Boolean)
          .join(' '),
      },
      ...(summary ? [{ title: 'Preview evidence', content: summary }] : []),
    ],
  };
}

export class ChatContentStreamObjects extends WithDisposable(
  ShadowlessElement
) {
  static override styles = css`
    .reasoning-wrapper {
      padding: 16px 20px;
      margin: 8px 0;
      border-radius: 8px;
      background-color: rgba(0, 0, 0, 0.05);
    }
  `;

  @property({ attribute: false })
  accessor answer!: StreamObject[];

  @property({ attribute: false })
  accessor host: EditorHost | null | undefined;

  @property({ attribute: false })
  accessor std: BlockStdScope | null | undefined;

  @property({ attribute: false })
  accessor state: AffineAIPanelState = 'finished';

  @property({ attribute: false })
  accessor width: Signal<number | undefined> | undefined;

  @property({ attribute: false })
  accessor extensions!: ExtensionType[];

  @property({ attribute: false })
  accessor affineFeatureFlagService!: FeatureFlagService;

  @property({ attribute: false })
  accessor theme!: Signal<ColorScheme>;

  @property({ attribute: false })
  accessor independentMode: boolean | undefined;

  @property({ attribute: false })
  accessor notificationService!: NotificationService;

  @property({ attribute: false })
  accessor docDisplayService!: DocDisplayConfig;

  @property({ attribute: false })
  accessor peekViewService!: PeekViewService;

  @property({ attribute: false })
  accessor onOpenDoc!: (docId: string, sessionId?: string) => void;

  private renderOfficeToolCall(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-call') return nothing;
    const name =
      streamObject.toolName === 'office_read'
        ? 'Reading current Office revision'
        : streamObject.toolName === 'office_command_batch_request'
          ? 'Preparing an atomic Office change set'
          : 'Preparing an Office change';
    return html`<tool-call-card
      .name=${name}
      .icon=${streamObject.toolName === 'office_read' ? ViewIcon() : PageIcon()}
      .width=${this.width}
    ></tool-call-card>`;
  }

  private renderOfficeToolResult(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-result') return nothing;
    const view = officeToolResultView(
      streamObject.toolName,
      streamObject.result,
      streamObject.isError === true
    );
    if (view.status === 'error') {
      return html`<tool-call-failed
        .name=${view.name}
        .icon=${PageIcon()}
      ></tool-call-failed>`;
    }
    return html`<tool-result-card
      .name=${view.name}
      .icon=${view.kind === 'read' ? ViewIcon() : PageIcon()}
      .width=${this.width}
      .results=${view.results.map((result, index) => ({
        ...result,
        icon: view.kind === 'read' || index === 0 ? PageIcon() : ViewIcon(),
      }))}
    ></tool-result-card>`;
  }

  private renderToolCall(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-call') {
      return nothing;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .doc=${this.host?.store}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-read-result>`;
      case 'office_read':
      case 'office_command_request':
      case 'office_command_batch_request':
        return this.renderOfficeToolCall(streamObject);
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      default: {
        const name = streamObject.toolName + ' tool calling';
        return html`
          <tool-call-card .name=${name} .width=${this.width}></tool-call-card>
        `;
      }
    }
  }

  private renderToolResult(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-result') {
      return nothing;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .host=${this.host}
            .renderRichText=${this.renderRichText.bind(this)}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .docDisplayService=${this.docDisplayService}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-read-result>`;
      case 'office_read':
      case 'office_command_request':
      case 'office_command_batch_request':
        return this.renderOfficeToolResult(streamObject);
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      default: {
        const name = streamObject.toolName + ' tool result';
        return html`
          <tool-result-card
            .name=${name}
            .width=${this.width}
          ></tool-result-card>
        `;
      }
    }
  }

  private renderRichText(text: string) {
    return html`<chat-content-rich-text
      .text=${text}
      .state=${this.state}
      .extensions=${this.extensions}
      .affineFeatureFlagService=${this.affineFeatureFlagService}
      .theme=${this.theme}
    ></chat-content-rich-text>`;
  }

  protected override render() {
    return html`<div>
      ${this.answer.map(data => {
        switch (data.type) {
          case 'text-delta':
            return this.renderRichText(data.textDelta);
          case 'reasoning':
            return html`
              <div class="reasoning-wrapper">
                ${this.renderRichText(data.textDelta)}
              </div>
            `;
          case 'tool-call':
            return this.renderToolCall(data);
          case 'tool-result':
            return this.renderToolResult(data);
          default:
            return nothing;
        }
      })}
    </div>`;
  }
}
