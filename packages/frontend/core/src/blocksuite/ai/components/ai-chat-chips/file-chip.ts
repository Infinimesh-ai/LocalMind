import { getOrCreateI18n } from '@affine/i18n';
import { getAttachmentFileIcon } from '@blocksuite/affine/components/icons';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { ShadowlessElement } from '@blocksuite/affine/std';
import { html } from 'lit';
import { property } from 'lit/decorators.js';

import type { FileChip } from './type';
import { getChipIcon, getChipTooltip } from './utils';

export class ChatPanelFileChip extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  @property({ attribute: false })
  accessor chip!: FileChip;

  @property({ attribute: false })
  accessor removeChip!: (chip: FileChip) => void;

  override render() {
    const { state: indexState, file, fileId } = this.chip;
    const directSourceAvailable =
      !!fileId &&
      this.chip.directSource === true &&
      (indexState === 'failed' || indexState === 'processing');
    const state = directSourceAvailable ? 'finished' : indexState;
    const isLoading = state === 'processing';
    const tooltip = directSourceAvailable
      ? getOrCreateI18n().t(
          indexState === 'failed'
            ? 'com.affine.localmind.chatAttachment.indexFailed'
            : 'com.affine.localmind.chatAttachment.indexing'
        )
      : getChipTooltip(state, file.name, this.chip.tooltip);
    const fileType = file.name.split('.').pop() ?? '';
    const fileIcon = getAttachmentFileIcon(fileType);
    const icon = getChipIcon(state, fileIcon);

    return html`<chat-panel-chip
      .state=${state}
      .name=${file.name}
      .tooltip=${tooltip}
      .icon=${icon}
      .closeable=${!isLoading}
      .onChipDelete=${this.onChipDelete}
    ></chat-panel-chip>`;
  }

  private readonly onChipDelete = () => {
    this.removeChip(this.chip);
  };
}
