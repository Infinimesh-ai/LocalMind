import { EventEmitter } from 'node:events';

import test from 'ava';
import type { Request } from 'express';
import { lastValueFrom } from 'rxjs';
import Sinon from 'sinon';

import { type Config, InternalServerError } from '../../base';
import type { CurrentUser } from '../../core/auth';
import type { Models } from '../../models';
import { CopilotController } from '../../plugins/copilot/controller';
import type { ActionStreamHost } from '../../plugins/copilot/runtime/hosts/action-stream-host';
import type { TurnOrchestrator } from '../../plugins/copilot/runtime/turn-orchestrator';
import type { CopilotStorage } from '../../plugins/copilot/storage';

for (const route of [
  'chatStream',
  'chatStreamObject',
  'actionStream',
  'chatImagesStream',
] as const) {
  for (const duringStream of [false, true]) {
    test(`${route} omits private inputs from ${duringStream ? 'stream' : 'preparation'} error diagnostics`, async t => {
      const error = new InternalServerError();
      const log = Sinon.stub(error, 'log');
      const prepare = async () => {
        if (!duringStream) throw error;
        return {
          model: 'test-model',
          actionId: 'test-action',
          actionVersion: 'v1',
          finalMessage: [
            { role: 'user', content: 'PRIVATE_PROMPT_SENTINEL' },
            { role: 'assistant', content: 'PRIVATE_HISTORY_SENTINEL' },
          ],
          stream: (async function* () {
            yield 'partial answer';
            throw error;
          })(),
        };
      };
      const controller = new CopilotController(
        {} as Config,
        {
          streamText: prepare,
          streamObject: prepare,
          streamImages: prepare,
        } as unknown as TurnOrchestrator,
        { stream: prepare } as unknown as ActionStreamHost,
        {} as CopilotStorage,
        {} as Models
      );
      const req = Object.assign(new EventEmitter(), {
        socket: new EventEmitter(),
        res: Object.assign(new EventEmitter(), { writableFinished: false }),
      }) as unknown as Request;
      const result = await lastValueFrom(
        await controller[route](
          { id: 'user-test' } as CurrentUser,
          req,
          'session-test',
          {
            messageId: 'message-test',
            content: 'PRIVATE_QUERY_SENTINEL',
            token: 'PRIVATE_CREDENTIAL_SENTINEL',
          }
        )
      );
      t.is(result.type, 'error');
      t.true(log.calledOnce);
      const info = log.firstCall.args[1];
      t.deepEqual(info, {
        sessionId: 'session-test',
        throwInStream: duringStream,
        ...(duringStream
          ? route === 'actionStream'
            ? { actionId: 'test-action', actionVersion: 'v1' }
            : { model: 'test-model' }
          : {}),
      });
      t.false(JSON.stringify(info).includes('PRIVATE_'));
    });
  }
}
