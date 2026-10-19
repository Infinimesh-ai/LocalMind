import { ExpressAdapter } from '@nestjs/platform-express';
import test from 'ava';
import express from 'express';
import supertest from 'supertest';

import { CORS_EXPOSED_HEADERS, corsOriginCallback } from '../../base/cors';

function metadataEndpoint() {
  const application = express();
  const adapter = new ExpressAdapter(application);
  const allowedOrigins = new Set(['assets://.']);
  adapter.enableCors({
    origin: (origin, callback) =>
      corsOriginCallback(origin, allowedOrigins, () => undefined, callback),
    credentials: true,
    exposedHeaders: CORS_EXPOSED_HEADERS,
  });
  application.get('/resource-metadata', (_request, response) => {
    response.setHeader('x-project-content-version', '2');
    response.send('Project file');
  });
  return application;
}

test('allowed desktop origins can read the Project revision used for editing', async t => {
  const response = await supertest(metadataEndpoint())
    .get('/resource-metadata')
    .set('Origin', 'assets://.')
    .expect(200);
  t.is(response.headers['access-control-allow-origin'], 'assets://.');
  t.is(response.headers['access-control-allow-credentials'], 'true');
  t.is(response.headers['x-project-content-version'], '2');
  t.true(
    response.headers['access-control-expose-headers']
      .split(',')
      .map((value: string) => value.trim().toLowerCase())
      .includes('x-project-content-version')
  );
});

test('exposing Project revisions does not grant an unapproved origin access', async t => {
  const response = await supertest(metadataEndpoint())
    .get('/resource-metadata')
    .set('Origin', 'https://unapproved.example')
    .expect(200);
  t.false(Object.hasOwn(response.headers, 'access-control-allow-origin'));
  t.false(Object.hasOwn(response.headers, 'access-control-expose-headers'));
});
