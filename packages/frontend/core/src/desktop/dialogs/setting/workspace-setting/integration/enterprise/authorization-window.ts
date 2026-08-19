export const enterpriseAuthorizationWindowName = (sessionId: string) =>
  `localmind-enterprise-authorization-${sessionId}`;

export type LarkAuthorizationStage = 'configure' | 'authorize';
export type DingTalkAuthorizationStage = 'device' | 'authorize';

export const larkAuthorizationStage = (
  authorizationUrl: string
): LarkAuthorizationStage => {
  try {
    const url = new URL(authorizationUrl);
    if (
      (url.hostname === 'open.feishu.cn' ||
        url.hostname === 'open.larksuite.com') &&
      url.pathname === '/page/cli'
    ) {
      return 'configure';
    }
  } catch {
    // The backend validates official URLs before they reach the frontend.
  }
  return 'authorize';
};

export const dingtalkAuthorizationStage = (
  authorizationUrl: string
): DingTalkAuthorizationStage => {
  try {
    const url = new URL(authorizationUrl);
    if (
      url.hostname === 'open-dev.dingtalk.com' &&
      url.pathname === '/fe/old'
    ) {
      for (const rawRoute of [url.hash, url.searchParams.get('hash') ?? '']) {
        let route = rawRoute;
        try {
          route = decodeURIComponent(route);
        } catch {
          // The route can already be decoded.
        }
        if (route.includes('personalAuthorization')) return 'authorize';
      }
    }
  } catch {
    // The backend validates official URLs before they reach the frontend.
  }
  return 'device';
};
