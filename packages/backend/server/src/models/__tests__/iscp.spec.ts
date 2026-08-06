import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { createModule } from '../../__tests__/create-module';
import { Mockers } from '../../__tests__/mocks';
import { Models } from '../../models';

const module = await createModule();
const models = module.get(Models);
const db = module.get(PrismaClient);

test.after.always(async () => {
  await module.close();
});

test('pairing enrollment is single-use and identity-bound', async t => {
  const user = await module.create(Mockers.User);
  const deviceId = `sparkclaw-${randomUUID()}`;
  const enrollment = await models.iscp.createEnrollment({
    userId: user.id,
    pairingTokenHash: randomUUID(),
    deviceId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const input = {
    enrollmentId: enrollment.id,
    userId: user.id,
    deviceId,
    domainId: 'localmind',
    identity: { device_id: deviceId },
    thumbprint: `thumbprint-${deviceId}`,
    request: { type: 'sparkclaw.bridge.enrollment_request.v1' },
  };

  const endpoint = await models.iscp.completeEnrollment(input);
  t.is(endpoint.userId, user.id);
  t.is(endpoint.deviceId, deviceId);
  await t.throwsAsync(models.iscp.completeEnrollment(input), {
    message: /invalid, expired, or already used/,
  });
  t.is(await db.iscpAgentEndpoint.count({ where: { deviceId } }), 1);
});

test('creating a new pairing revokes an older pending pairing', async t => {
  const user = await module.create(Mockers.User);
  const first = await models.iscp.createEnrollment({
    userId: user.id,
    pairingTokenHash: randomUUID(),
    deviceId: `sparkclaw-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await models.iscp.createEnrollment({
    userId: user.id,
    pairingTokenHash: randomUUID(),
    deviceId: `sparkclaw-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const old = await db.iscpEnrollment.findUniqueOrThrow({
    where: { id: first.id },
  });
  t.is(old.status, 'revoked');
});

test('delivery status updates never reactivate a revoked endpoint', async t => {
  const user = await module.create(Mockers.User);
  const deviceId = `sparkclaw-${randomUUID()}`;
  const endpoint = await db.iscpAgentEndpoint.create({
    data: {
      userId: user.id,
      deviceId,
      domainId: 'localmind',
      identity: { device_id: deviceId },
      thumbprint: `thumbprint-${deviceId}`,
      status: 'revoked',
      revokedAt: new Date(),
    },
  });

  const result = await models.iscp.updateEndpointDelivery(endpoint.id, {
    status: 'active',
    lastSeenAt: new Date(),
  });
  t.is(result.count, 0);
  const unchanged = await db.iscpAgentEndpoint.findUniqueOrThrow({
    where: { id: endpoint.id },
  });
  t.is(unchanged.status, 'revoked');
});

test('revoking an endpoint skips its unfinished deliveries', async t => {
  const user = await module.create(Mockers.User);
  const endpoint = await db.iscpAgentEndpoint.create({
    data: {
      userId: user.id,
      deviceId: `sparkclaw-${randomUUID()}`,
      domainId: 'localmind',
      identity: {},
      thumbprint: randomUUID(),
    },
  });
  const notification = await db.notification.create({
    data: {
      userId: user.id,
      level: 'Default',
      type: 'Mention',
      body: {},
    },
  });
  const delivery = await db.notificationDelivery.create({
    data: { notificationId: notification.id, endpointId: endpoint.id },
  });

  await models.iscp.revokeEndpoint(user.id, endpoint.id);

  const skipped = await db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  t.is(skipped.status, 'skipped');
  t.is(skipped.lastError, 'endpoint_revoked');
});
