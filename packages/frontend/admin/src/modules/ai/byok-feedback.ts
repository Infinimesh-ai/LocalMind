import { I18n } from '@affine/i18n';

// Never render upstream or persisted error text directly in the credentials UI.
export function formatByokError(message: string | null | undefined) {
  switch (message) {
    case 'Provider rejected the BYOK key.':
      return I18n['com.affine.admin.byok-error-key']();
    case 'Provider rejected the BYOK key permissions.':
      return I18n['com.affine.admin.byok-error-permission']();
    case 'Provider probe endpoint was not found.':
      return I18n['com.affine.admin.byok-error-endpoint']();
    case 'Provider rate limit exceeded while testing the key.':
      return I18n['com.affine.admin.byok-error-rate-limit']();
    case 'Provider service is unavailable.':
      return I18n['com.affine.admin.byok-error-unavailable']();
    case 'Provider returned malformed JSON.':
    case 'Provider returned an invalid chat response.':
    case 'Provider returned an invalid model catalog.':
      return I18n['com.affine.admin.byok-error-response']();
    default:
      return I18n['com.affine.admin.byok-error-generic']();
  }
}
