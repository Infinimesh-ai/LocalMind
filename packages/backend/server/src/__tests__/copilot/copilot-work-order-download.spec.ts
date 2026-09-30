import test from 'ava';
import express from 'express';
import request from 'supertest';

import { WorkOrderController } from '../../plugins/copilot/work-order-controller';
import type { WorkOrderStorage } from '../../plugins/copilot/work-order-storage';

test('delivered Office files download with their original filename', async t => {
  const mimeType =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const fileName = 'GPT模型评估报告.pptx';
  const bytes = Buffer.from('package bytes');
  const storage = {
    read: async () => ({ blob: { fileName, mimeType }, bytes }),
  } as unknown as WorkOrderStorage;
  const controller = new WorkOrderController(storage);
  const actor = { id: 'sender' } as Parameters<
    WorkOrderController['download']
  >[0];
  const app = express();
  app.get('/file', (_request, response, next) => {
    void controller
      .download(actor, 'order-id', 'blob-id', response)
      .catch(next);
  });

  const result = await request(app).get('/file').expect(200);
  t.regex(result.headers['content-disposition'], /^attachment;/);
  t.true(
    result.headers['content-disposition'].includes(
      `filename*=UTF-8''${encodeURIComponent(fileName)}`
    )
  );
  t.is(result.headers['content-type'], mimeType);
  t.is(result.headers['content-length'], String(bytes.length));
  t.is(result.headers['cache-control'], 'private, no-store');
  t.is(
    result.headers['content-security-policy'],
    "default-src 'none'; sandbox"
  );
});
