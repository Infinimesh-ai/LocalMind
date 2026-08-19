import { describe, expect, test } from 'vitest';

import {
  dingtalkAuthorizationStage,
  enterpriseAuthorizationWindowName,
  larkAuthorizationStage,
} from './authorization-window';

describe('enterprise authorization window', () => {
  test('uses a stable per-session window name', () => {
    expect(enterpriseAuthorizationWindowName('session-1')).toBe(
      'localmind-enterprise-authorization-session-1'
    );
  });

  test.each([
    'https://open.feishu.cn/page/cli?user_code=FIRST',
    'https://open.larksuite.com/page/cli?user_code=FIRST',
  ])('recognizes the CLI app configuration challenge', authorizationUrl => {
    expect(larkAuthorizationStage(authorizationUrl)).toBe('configure');
  });

  test.each([
    'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=SECOND',
    'https://accounts.larksuite.com/oauth/v1/device/verify?user_code=SECOND',
    'not-a-url',
  ])(
    'treats non-configuration URLs as user authorization',
    authorizationUrl => {
      expect(larkAuthorizationStage(authorizationUrl)).toBe('authorize');
    }
  );

  test.each([
    'https://open-dev.dingtalk.com/fe/old?hash=%23%2FpersonalAuthorization%3FflowId%3Df1%26userCode%3DDT-1#/personalAuthorization?flowId=f1&userCode=DT-1',
    'https://open-dev.dingtalk.com/fe/old#%2FpersonalAuthorization%3FflowId%3Df1%26userCode%3DDT-1',
  ])('recognizes DingTalk CLI permission authorization', authorizationUrl => {
    expect(dingtalkAuthorizationStage(authorizationUrl)).toBe('authorize');
  });

  test.each([
    'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=DT-1',
    'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    'not-a-url',
  ])('treats other DingTalk URLs as device login', authorizationUrl => {
    expect(dingtalkAuthorizationStage(authorizationUrl)).toBe('device');
  });
});
