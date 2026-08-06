import test from 'ava';

import {
  createTestingApp,
  getUserSettings,
  TestingApp,
  updateUserSettings,
} from '../../../__tests__/utils';

let app: TestingApp;

test.before(async () => {
  app = await createTestingApp();
});

test.after.always(async () => {
  await app.close();
});

test('should get user settings', async t => {
  await app.signup();
  const settings = await getUserSettings(app);
  t.deepEqual(settings, {
    receiveInvitationEmail: true,
    receiveMentionEmail: true,
    receiveCommentEmail: true,
    receiveSparkClawNotifications: true,
  });
});

test('should update user settings', async t => {
  await app.signup();
  await updateUserSettings(app, {
    receiveInvitationEmail: false,
    receiveMentionEmail: false,
    receiveCommentEmail: false,
    receiveSparkClawNotifications: true,
  });
  const settings = await getUserSettings(app);
  t.deepEqual(settings, {
    receiveInvitationEmail: false,
    receiveMentionEmail: false,
    receiveCommentEmail: false,
    receiveSparkClawNotifications: true,
  });

  await updateUserSettings(app, {
    receiveMentionEmail: true,
  });
  const settings2 = await getUserSettings(app);
  t.deepEqual(settings2, {
    receiveInvitationEmail: false,
    receiveMentionEmail: true,
    receiveCommentEmail: false,
    receiveSparkClawNotifications: true,
  });

  await updateUserSettings(app, {
    // ignore undefined value
    receiveInvitationEmail: undefined,
  });
  const settings3 = await getUserSettings(app);
  t.deepEqual(settings3, {
    receiveInvitationEmail: false,
    receiveMentionEmail: true,
    receiveSparkClawNotifications: true,
    receiveCommentEmail: false,
  });
});

test('should update user settings with comment email', async t => {
  await app.signup();

  await updateUserSettings(app, {
    receiveCommentEmail: true,
  });

  const settings = await getUserSettings(app);
  t.deepEqual(settings, {
    receiveCommentEmail: true,
    receiveInvitationEmail: true,
    receiveMentionEmail: true,
    receiveSparkClawNotifications: true,
  });

  await updateUserSettings(app, {
    receiveCommentEmail: false,
  });

  const settings2 = await getUserSettings(app);
  t.deepEqual(settings2, {
    receiveCommentEmail: false,
    receiveInvitationEmail: true,
    receiveMentionEmail: true,
    receiveSparkClawNotifications: true,
  });
});

test('should throw error when update user settings with invalid input', async t => {
  await app.signup();
  await t.throwsAsync(
    updateUserSettings(app, {
      receiveInvitationEmail: false,
      // @ts-expect-error invalid value
      receiveMentionEmail: null,
    }),
    {
      message: /Expected boolean, received null/,
    }
  );
});

test('should not update user settings when not logged in', async t => {
  await app.logout();
  await t.throwsAsync(
    updateUserSettings(app, {
      receiveInvitationEmail: false,
      receiveMentionEmail: false,
    }),
    {
      message: 'You must sign in first to access this resource.',
    }
  );
});
