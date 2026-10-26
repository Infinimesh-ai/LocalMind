/**
 * @vitest-environment happy-dom
 */
import { NotificationProvider } from '@blocksuite/affine/shared/services';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  I18n: {
    'com.affine.localmind.citation.sourceUnavailable': () =>
      'Localized unavailable source',
  },
}));

import { LocalizedCitationService } from './citation-service';

describe('LocalizedCitationService', () => {
  test('explains read-only citations without a navigable target', () => {
    const toast = vi.fn();
    const std = {
      getOptional: (identifier: unknown) =>
        identifier === NotificationProvider ? { toast } : null,
    };
    const service = new LocalizedCitationService(std as never);

    service.notifySourceUnavailable();

    expect(toast).toHaveBeenCalledWith('Localized unavailable source');
  });
});
