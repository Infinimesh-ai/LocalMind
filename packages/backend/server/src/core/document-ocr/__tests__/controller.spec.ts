import test from 'ava';
import type { Request } from 'express';

import type { CurrentUser } from '../../auth';
import type { PermissionAccess } from '../../permission';
import { DocumentOcrController } from '../controller';
import type { DocumentOcrService } from '../service';

const user = { id: 'user-1' } as CurrentUser;

function request(content: Buffer, contentType = 'image/jpeg') {
  return {
    rawBody: content,
    header(name: string) {
      if (name.toLowerCase() === 'content-type') return contentType;
      if (name.toLowerCase() === 'content-length') {
        return String(content.length);
      }
      return undefined;
    },
  } as unknown as Request;
}

test('checks Workspace.CreateDoc before sending a page to OCR', async t => {
  const denied = new Error('permission denied');
  let parseCalled = false;
  const access = {
    user(userId: string) {
      t.is(userId, user.id);
      return {
        workspace(workspaceId: string) {
          t.is(workspaceId, 'workspace-1');
          return {
            async assert(action: string) {
              t.is(action, 'Workspace.CreateDoc');
              throw denied;
            },
          };
        },
      };
    },
  } as unknown as PermissionAccess;
  const service = {
    maxUploadBytes: 1024,
    async parsePage() {
      parseCalled = true;
      return { markdown: 'unexpected', model: 'sparkclaw-ocr' };
    },
  } as unknown as DocumentOcrService;
  const controller = new DocumentOcrController(access, service);

  const error = await t.throwsAsync(
    controller.parsePage(user, 'workspace-1', request(Buffer.from('jpeg')))
  );

  t.is(error, denied);
  t.false(parseCalled);
});

test('forwards a bounded supported image after authorization', async t => {
  let captured:
    | {
        content: Buffer;
        contentType: string;
      }
    | undefined;
  const access = {
    user() {
      return {
        workspace() {
          return {
            async assert() {},
          };
        },
      };
    },
  } as unknown as PermissionAccess;
  const service = {
    maxUploadBytes: 1024,
    async parsePage(input: { content: Buffer; contentType: string }) {
      captured = input;
      return { markdown: '# Recognized', model: 'sparkclaw-ocr' };
    },
  } as unknown as DocumentOcrService;
  const controller = new DocumentOcrController(access, service);

  const result = await controller.parsePage(
    user,
    'workspace-1',
    request(Buffer.from('jpeg'))
  );

  t.deepEqual(result, {
    markdown: '# Recognized',
    model: 'sparkclaw-ocr',
  });
  t.is(captured?.contentType, 'image/jpeg');
  t.deepEqual(captured?.content, Buffer.from('jpeg'));
});
