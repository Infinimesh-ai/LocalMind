import test from 'ava';

import { TelemetryService } from '../service';

test('self-hosted telemetry endpoint drops legacy external batches', async t => {
  const previous = globalThis.env.DEPLOYMENT_TYPE;
  Object.assign(globalThis.env, { DEPLOYMENT_TYPE: 'selfhosted' });
  try {
    const service = new TelemetryService(
      {
        telemetry: {
          allowedOrigin: [],
          ga4: { measurementId: '', apiSecret: '' },
          dedupe: { ttlHours: 24, maxEntries: 100 },
          batch: { maxEvents: 25 },
        },
      } as any,
      { allowedOrigins: [] } as any
    );
    const result = await service.collectBatch({
      schemaVersion: 1,
      transport: 'http',
      sentAt: Date.now(),
      events: [
        {
          schemaVersion: 1,
          eventName: 'page_view',
          clientId: 'client',
          eventId: 'event',
          params: {},
        },
      ],
    });
    t.deepEqual(result, { ok: true, accepted: 0, dropped: 1 });
  } finally {
    Object.assign(globalThis.env, { DEPLOYMENT_TYPE: previous });
  }
});
