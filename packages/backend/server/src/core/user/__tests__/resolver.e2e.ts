import { PrismaClient } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import {
  createTestingApp,
  getUserSettings,
  TestingApp,
  updateUserSettings,
} from '../../../__tests__/utils';
import { Models } from '../../../models';
import {
  RealtimePublisher,
  realtimeUserPublicProfileRoom,
} from '../../realtime';

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

test('renaming notifies users sharing a workspace or project, not outsiders', async t => {
  const models = app.get(Models);
  const db = app.get(PrismaClient);
  const peer = await app.createUser();
  const projectPeer = await app.createUser();
  const outsider = await app.createUser();
  const me = await app.signup();
  const workspace = await models.workspace.create(me.id);
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: peer.id, role: 'member' },
  });
  await db.aiContextProject.create({
    data: {
      name: 'Rename audience',
      members: {
        create: [
          { userId: me.id, role: 'owner' },
          { userId: projectPeer.id, role: 'member' },
        ],
      },
    },
  });

  const publish = Sinon.stub(app.get(RealtimePublisher), 'publish').returns(
    true
  );
  try {
    await app.gql(
      `mutation($input: UpdateUserInput!) { updateProfile(input: $input) { id name } }`,
      { input: { name: 'Renamed person' } }
    );
    const call = await (async () => {
      for (let i = 0; i < 50; i++) {
        const found = publish
          .getCalls()
          .find(call => call.args[0] === 'user.public-profile.changed');
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return undefined;
    })();
    t.truthy(call);
    t.deepEqual(call!.args[2], {
      changed: true,
      reason: 'user-updated',
      userIds: [me.id],
    });
    const rooms = (call!.args[3] as { rooms: string[] }).rooms;
    for (const id of [me.id, peer.id, projectPeer.id])
      t.true(rooms.includes(realtimeUserPublicProfileRoom(id)));
    t.false(rooms.includes(realtimeUserPublicProfileRoom(outsider.id)));
    t.false(JSON.stringify(call!.args).includes('Renamed person'));
  } finally {
    publish.restore();
  }
});
