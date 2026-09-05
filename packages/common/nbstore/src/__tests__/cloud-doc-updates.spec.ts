import { describe, expect, test, vi } from 'vitest';

import { CloudDocStorage } from '../impls/cloud/doc';

const base64UpdateA = 'AQID';
const base64UpdateB = 'BAUG';

describe('CloudDocStorage broadcast updates', () => {
  test('emits updates from batch payload', () => {
    const storage = new CloudDocStorage({
      id: 'space-1',
      serverBaseUrl: 'http://localhost',
      isSelfHosted: true,
      type: 'workspace',
      readonlyMode: true,
    });

    (storage as any).connection.idConverter = {
      oldIdToNewId: (id: string) => id,
      newIdToOldId: (id: string) => id,
    };

    const received: Uint8Array[] = [];
    storage.subscribeDocUpdate(update => {
      received.push(update.bin);
    });

    storage.onServerUpdates({
      spaceType: 'workspace',
      spaceId: 'space-1',
      docId: 'doc-1',
      updates: [base64UpdateA, base64UpdateB],
      timestamp: Date.now(),
    });

    expect(received).toEqual([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ]);
  });

  test('document-scoped storage ignores workspace broadcasts', () => {
    const storage = new CloudDocStorage({
      id: 'space-1',
      serverBaseUrl: 'http://localhost',
      isSelfHosted: true,
      type: 'workspace',
      readonlyMode: true,
      docScopeId: 'doc-1',
    });

    (storage as any).connection.idConverter = {
      oldIdToNewId: (id: string) => id,
      newIdToOldId: (id: string) => id,
    };
    const received: Uint8Array[] = [];
    storage.subscribeDocUpdate(update => received.push(update.bin));

    storage.onServerUpdate({
      spaceType: 'workspace',
      spaceId: 'space-1',
      docId: 'doc-1',
      update: base64UpdateA,
      timestamp: Date.now(),
      editor: 'editor-1',
    });
    storage.onServerUpdates({
      spaceType: 'workspace',
      spaceId: 'space-1',
      docId: 'doc-1',
      updates: [base64UpdateB],
      timestamp: Date.now(),
    });

    expect(received).toEqual([]);
  });

  test('document scope is carried on every transport request', async () => {
    const requests: Array<{ event: string; payload: Record<string, unknown> }> =
      [];
    const socket = {
      connected: true,
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      emitWithAck: vi.fn(
        async (event: string, payload: Record<string, unknown>) => {
          requests.push({ event, payload });
          if (event === 'space:join') {
            return { data: { clientId: 'client-1', success: true } };
          }
          if (event === 'space:load-doc-timestamps') {
            return { data: { 'doc-1': Date.now() } };
          }
          if (event === 'space:push-doc-update') {
            return { data: { timestamp: Date.now() } };
          }
          return {
            data: {
              missing: 'AAA=',
              state: 'AAA=',
              timestamp: Date.now(),
            },
          };
        }
      ),
    };
    const disconnect = vi.fn();
    const storage = new CloudDocStorage({
      id: 'space-1',
      serverBaseUrl: 'http://localhost',
      isSelfHosted: true,
      type: 'workspace',
      readonlyMode: false,
      docScopeId: 'doc-1',
    });
    (storage.connection as any).manager = {
      connect: () => ({ socket, disconnect }),
    };

    const connection = await storage.connection.doConnect();
    (storage.connection as any)._inner = connection;
    await storage.getDocSnapshot('doc-1');
    await storage.getDocDiff('doc-1');
    await storage.getDocTimestamp('doc-1');
    await storage.getDocTimestamps();
    await storage.pushDocUpdate({
      docId: 'doc-1',
      bin: new Uint8Array([1, 2, 3]),
    });
    await expect(storage.deleteDoc('doc-1')).rejects.toThrow(
      'Document-scoped cloud storage cannot delete documents'
    );
    storage.connection.doDisconnect(connection);

    expect(requests.map(request => request.event)).toEqual([
      'space:join',
      'space:load-doc',
      'space:load-doc',
      'space:load-doc',
      'space:load-doc',
      'space:load-doc-timestamps',
      'space:push-doc-update',
    ]);
    for (const request of requests) {
      expect(request.payload.docScopeId).toBe('doc-1');
    }
    expect(socket.emit).toHaveBeenCalledWith('space:leave', {
      spaceType: 'workspace',
      spaceId: 'space-1',
      docScopeId: 'doc-1',
    });
  });

  test('document-scoped storage never shares a socket manager', () => {
    const create = (docScopeId?: string) =>
      new CloudDocStorage({
        id: 'space-1',
        serverBaseUrl: 'http://localhost',
        isSelfHosted: true,
        type: 'workspace',
        readonlyMode: true,
        docScopeId,
      });
    const regularA = create();
    const regularB = create();
    const scopedA = create('doc-1');
    const scopedB = create('doc-1');

    expect(regularA.connection.manager).toBe(regularB.connection.manager);
    expect(scopedA.connection.manager).not.toBe(regularA.connection.manager);
    expect(scopedA.connection.manager).not.toBe(scopedB.connection.manager);
  });
});
