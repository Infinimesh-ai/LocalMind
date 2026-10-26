import { I18n } from '@affine/i18n';
import type { Container } from '@blocksuite/affine/global/di';
import {
  CitationProvider,
  CitationService,
  NotificationProvider,
} from '@blocksuite/affine/shared/services';
import { StdIdentifier } from '@blocksuite/affine/std';

/** Localizes the hint shown for read-only citations without a target. */
export class LocalizedCitationService extends CitationService {
  static override setup(di: Container) {
    di.override(CitationProvider, LocalizedCitationService, [StdIdentifier]);
  }

  override notifySourceUnavailable() {
    this.std
      .getOptional(NotificationProvider)
      ?.toast(I18n['com.affine.localmind.citation.sourceUnavailable']());
  }
}
