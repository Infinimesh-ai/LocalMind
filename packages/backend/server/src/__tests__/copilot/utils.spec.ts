import { EventEmitter } from 'node:events';

import test from 'ava';
import type { Request } from 'express';

import { CitationFootnoteFormatter } from '../../plugins/copilot/providers/utils';
import { getSignal } from '../../plugins/copilot/utils';

function streamRequest() {
  const socket = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
  });
  const request = Object.assign(new EventEmitter(), {
    socket,
    res: response,
    aborted: false,
  });
  return { request: request as unknown as Request, response, socket };
}

test('closing an unfinished SSE response aborts generation on a reusable socket', t => {
  const { request, response, socket } = streamRequest();
  const { signal, onConnectionClosed } = getSignal(request);
  const closed: boolean[] = [];
  onConnectionClosed(aborted => closed.push(aborted));

  request.emit('close');
  t.false(signal.aborted);
  socket.emit('end');
  response.emit('close');

  t.true(signal.aborted);
  t.deepEqual(closed, [true]);
  t.is(response.listenerCount('close'), 0);
  t.is(socket.listenerCount('close'), 0);
  socket.emit('close', false);
  t.deepEqual(closed, [true]);
});

test('completed SSE responses release listeners without aborting generation', t => {
  const { request, response, socket } = streamRequest();
  const { signal, onConnectionClosed } = getSignal(request);
  const closed: boolean[] = [];
  onConnectionClosed(aborted => closed.push(aborted));
  response.writableFinished = true;
  response.emit('finish');
  response.emit('close');
  socket.emit('close', false);
  t.false(signal.aborted);
  t.deepEqual(closed, [false]);
  t.is(request.listenerCount('aborted'), 0);
  t.is(response.listenerCount('finish'), 0);
  t.is(socket.listenerCount('close'), 0);
});

test('an already aborted request is reported to a later close callback', t => {
  const { request } = streamRequest();
  request.aborted = true;
  const { signal, onConnectionClosed } = getSignal(request);
  const closed: boolean[] = [];
  onConnectionClosed(aborted => closed.push(aborted));
  t.true(signal.aborted);
  t.deepEqual(closed, [true]);
});

test('CitationFootnoteFormatter should format sorted footnotes from citation events', t => {
  const formatter = new CitationFootnoteFormatter();

  formatter.consume({
    type: 'citation',
    index: 2,
    url: 'https://example.com/b',
  });
  formatter.consume({
    type: 'citation',
    index: 1,
    url: 'https://example.com/a',
  });

  t.is(
    formatter.end(),
    [
      '[^1]: {"type":"url","url":"https%3A%2F%2Fexample.com%2Fa"}',
      '[^2]: {"type":"url","url":"https%3A%2F%2Fexample.com%2Fb"}',
    ].join('\n')
  );
});

test('CitationFootnoteFormatter should overwrite duplicated index with latest url', t => {
  const formatter = new CitationFootnoteFormatter();

  formatter.consume({
    type: 'citation',
    index: 1,
    url: 'https://example.com/old',
  });
  formatter.consume({
    type: 'citation',
    index: 1,
    url: 'https://example.com/new',
  });

  t.is(
    formatter.end(),
    '[^1]: {"type":"url","url":"https%3A%2F%2Fexample.com%2Fnew"}'
  );
});
