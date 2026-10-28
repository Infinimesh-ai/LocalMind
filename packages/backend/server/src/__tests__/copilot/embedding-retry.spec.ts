import test from 'ava';

import type { Embedding } from '../../models';
import { EmbeddingClient } from '../../plugins/copilot/embedding/types';

test('embedding succeeds after a transient provider error', async t => {
  let calls = 0;
  class Client extends EmbeddingClient {
    override async getEmbeddings(): Promise<Embedding[]> {
      calls++;
      if (calls === 1) throw new Error('temporary failure');
      return [{ index: 0, content: 'hello', embedding: [1] }];
    }
  }

  const result = await new Client().generateEmbeddings([
    { index: 7, content: 'hello' },
  ]);
  t.is(calls, 2);
  t.deepEqual(result, [{ index: 7, content: 'hello', embedding: [1] }]);
});

test('embedding reports the final error when every attempt fails', async t => {
  let calls = 0;
  class Client extends EmbeddingClient {
    override async getEmbeddings(): Promise<Embedding[]> {
      calls++;
      throw new Error(`failure ${calls}`);
    }
  }

  await t.throwsAsync(
    () => new Client().generateEmbeddings([{ index: 0, content: 'hello' }]),
    { message: 'failure 3' }
  );
  t.is(calls, 3);
});
