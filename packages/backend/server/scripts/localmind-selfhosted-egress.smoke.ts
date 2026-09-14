import { Env } from '../src/env';

globalThis.env ??= new Env();
const { Ga4Client } = await import('../src/core/telemetry/ga4-client');
const { TelemetryService } = await import('../src/core/telemetry/service');

const originalDeployment = globalThis.env.DEPLOYMENT_TYPE;
const originalFetch = globalThis.fetch;
let calls = 0;
Object.assign(globalThis.env, { DEPLOYMENT_TYPE: 'selfhosted' });
globalThis.fetch = (async () => {
  calls++;
  throw new Error('unexpected external telemetry request');
}) as typeof fetch;

try {
  await new Ga4Client('G-EXAMPLE', 'secret', 25).send([
    {
      clientId: 'client',
      eventId: 'event',
      eventName: 'page_view',
      params: {},
      userProperties: {},
    },
  ] as any);
  const service = new TelemetryService(
    {
      telemetry: {
        allowedOrigin: [],
        ga4: { measurementId: 'G-EXAMPLE', apiSecret: 'secret' },
        dedupe: { ttlHours: 24, maxEntries: 100 },
        batch: { maxEvents: 25 },
      },
    } as any,
    { allowedOrigins: [] } as any
  );
  const ack = await service.collectBatch({
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
  if (calls !== 0 || !ack.ok || ack.accepted !== 0) {
    throw new Error(
      `self-hosted egress assertion failed: ${JSON.stringify({ calls, ack })}`
    );
  }
  console.log('self-hosted external telemetry blocked');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis.env, { DEPLOYMENT_TYPE: originalDeployment });
}
