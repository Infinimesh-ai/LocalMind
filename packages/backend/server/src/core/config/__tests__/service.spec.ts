import { faker } from '@faker-js/faker';
import test from 'ava';
import Sinon from 'sinon';

import { createModule } from '../../../__tests__/create-module';
import { Mockers } from '../../../__tests__/mocks';
import { InvalidAppConfigInput } from '../../../base';
import { Models } from '../../../models';
import { AppConfigResolver } from '../resolver';
import { APP_CONFIG_SECRET_REDACTED, ServerService } from '../service';

const module = await createModule({
  providers: [ServerService],
});
const service = module.get(ServerService);
const user = await module.create(Mockers.User);
const models = module.get(Models);

function getProfileApiKey(profile: unknown) {
  if (!profile || typeof profile !== 'object' || !('config' in profile)) {
    return undefined;
  }
  const config = profile.config;
  return config && typeof config === 'object' && 'apiKey' in config
    ? config.apiKey
    : undefined;
}

test.afterEach(async () => {
  Sinon.reset();
});

test.after.always(async () => {
  await module.close();
});

test('should update config', async t => {
  const oldValue = service.getConfig().server.externalUrl;
  const newValue = faker.internet.url();
  await service.updateConfig(user.id, [
    {
      module: 'server',
      key: 'externalUrl',
      value: newValue,
    },
  ]);

  t.not(service.getConfig().server.externalUrl, oldValue);
  t.is(service.getConfig().server.externalUrl, newValue);
});

test('should validate config before update', async t => {
  await t.throwsAsync(
    service.updateConfig(user.id, [
      {
        module: 'server',
        key: 'externalUrl',
        value: 'invalid-url@some-domain.com',
      },
    ]),
    {
      instanceOf: InvalidAppConfigInput,
    }
  );

  t.not(service.getConfig().server.externalUrl, 'invalid-url');

  await t.throwsAsync(
    service.updateConfig(user.id, [
      {
        module: 'auth',
        key: 'unknown-key',
        value: 'invalid-value',
      },
    ]),
    {
      instanceOf: InvalidAppConfigInput,
    }
  );

  t.is(
    // @ts-expect-error testing
    service.getConfig().auth['unknown-key'],
    undefined
  );

  await t.throwsAsync(
    service.updateConfig(user.id, [
      {
        module: 'auth',
        key: 'token.signingKeys',
        value: [{ secret: 'must-not-enter-app-config' }],
      },
    ]),
    { instanceOf: InvalidAppConfigInput }
  );
});

test('should emit config.init event', async t => {
  await service.onApplicationBootstrap();
  const event = module.event.last('config.init');
  t.is(event.name, 'config.init');
  t.deepEqual(event.payload, {
    config: service.getConfig(),
  });
});

test('should revalidate config', async t => {
  const outdatedValue = service.getConfig().server.externalUrl;
  const newValue = faker.internet.url();

  await models.appConfig.save(user.id, [
    {
      key: 'server.externalUrl',
      value: newValue,
    },
  ]);

  await service.revalidateConfig();

  t.not(service.getConfig().server.externalUrl, outdatedValue);
  t.is(service.getConfig().server.externalUrl, newValue);
});

test('should emit config changed event', async t => {
  const newUrl = faker.internet.url();

  await service.updateConfig(user.id, [
    {
      module: 'server',
      key: 'externalUrl',
      value: newUrl,
    },
    {
      module: 'auth',
      key: 'allowSignup',
      value: false,
    },
  ]);

  const updates = {
    server: {
      externalUrl: newUrl,
    },
    auth: {
      allowSignup: false,
    },
  };

  t.true(
    module.event.emit.calledOnceWith('config.changed', {
      updates,
    })
  );
  t.true(
    module.event.broadcast.calledOnceWith('config.changed.broadcast', {
      updates,
    })
  );
});

test('redacts and preserves Provider Profile API keys', async t => {
  const profileId = `provider-profile-${faker.string.uuid()}`;
  await service.updateConfig(user.id, [
    {
      module: 'copilot',
      key: 'providers.profiles',
      value: [
        {
          id: profileId,
          type: 'openai',
          displayName: 'Primary',
          config: { apiKey: 'provider-secret' },
        },
      ],
    },
  ]);

  const adminProfiles = service.getAdminConfig().copilot.providers.profiles;
  t.is(getProfileApiKey(adminProfiles[0]), APP_CONFIG_SECRET_REDACTED);
  t.false(JSON.stringify(adminProfiles).includes('provider-secret'));

  await service.updateConfig(user.id, [
    {
      module: 'copilot',
      key: 'providers.profiles',
      value: [
        {
          id: profileId,
          type: 'openai',
          displayName: 'Renamed',
          config: { apiKey: APP_CONFIG_SECRET_REDACTED },
        },
      ],
    },
  ]);
  t.is(
    getProfileApiKey(service.getConfig().copilot.providers.profiles[0]),
    'provider-secret'
  );
  t.is(
    service.getConfig().copilot.providers.profiles[0]?.displayName,
    'Renamed'
  );

  await service.updateConfig(user.id, [
    {
      module: 'copilot',
      key: 'providers.profiles',
      value: [
        {
          id: profileId,
          type: 'openai',
          displayName: 'Renamed',
          config: { apiKey: 'replacement-secret' },
        },
      ],
    },
  ]);
  t.is(
    getProfileApiKey(service.getConfig().copilot.providers.profiles[0]),
    'replacement-secret'
  );

  await t.throwsAsync(
    service.updateConfig(user.id, [
      {
        module: 'copilot',
        key: 'providers.profiles',
        value: [
          {
            id: `new-${profileId}`,
            type: 'openai',
            config: { apiKey: APP_CONFIG_SECRET_REDACTED },
          },
        ],
      },
    ]),
    { instanceOf: InvalidAppConfigInput }
  );
});

test('redacts Provider Profile API keys in mutation responses', async t => {
  const resolver = new AppConfigResolver(service);
  const response = await resolver.updateAppConfig({ id: user.id } as any, [
    {
      module: 'copilot',
      key: 'providers.profiles',
      value: [
        {
          id: `provider-profile-response-${faker.string.uuid()}`,
          type: 'openai',
          config: { apiKey: 'mutation-response-secret' },
        },
      ],
    },
  ]);
  const profiles = response.copilot?.providers?.profiles ?? [];

  t.is(getProfileApiKey(profiles[0]), APP_CONFIG_SECRET_REDACTED);
  t.false(JSON.stringify(response).includes('mutation-response-secret'));
});

test('validates Enterprise CLI provider and tool policies', t => {
  t.is(
    service.validateConfig([
      {
        module: 'copilot',
        key: 'enterpriseCli.allowedToolsByProvider',
        value: {
          wecom: ['wecom_docs_search'],
          lark: ['*'],
          dingtalk: [],
        },
      },
    ]),
    null
  );

  const errors = service.validateConfig([
    {
      module: 'copilot',
      key: 'enterpriseCli.allowedToolsByProvider',
      value: {
        wecom: ['unsafe tool name'],
        lark: [],
        dingtalk: [],
      },
    },
  ]);
  t.true(Boolean(errors?.length));
});
