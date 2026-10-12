import { I18n } from '@affine/i18n';

// Never render upstream or persisted error text directly in the credentials UI.
export function formatByokError(
  message: string | null | undefined,
  fallback = I18n['com.affine.admin.byok-error-generic']()
) {
  switch (message) {
    case 'DeepSeek OpenAI endpoint requires the OpenAI provider.':
      return I18n['com.affine.admin.byok-error-deepseek-openai']();
    case 'DeepSeek Anthropic endpoint requires the Anthropic provider.':
      return I18n['com.affine.admin.byok-error-deepseek-anthropic']();
    case 'Provider model was not found or is not accessible.':
      return I18n['com.affine.admin.byok-error-model']();
    case 'Provider account has insufficient quota.':
      return I18n['com.affine.admin.byok-error-quota']();
    case 'Invalid BYOK API protocol for this provider.':
    case 'Provider rejected the request format.':
      return I18n['com.affine.admin.byok-error-request']();
    case 'Provider request timed out.':
      return I18n['com.affine.admin.byok-error-timeout']();
    case 'Provider connection failed.':
      return I18n['com.affine.admin.byok-error-network']();
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
      return fallback;
  }
}
