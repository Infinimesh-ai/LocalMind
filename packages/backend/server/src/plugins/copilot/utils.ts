import { Readable } from 'node:stream';

import type { Request } from 'express';

import { OneMB, readBufferWithLimit } from '../../base';
import type { PromptTools } from './providers/types';
import type { ToolsConfig } from './types';

export const MAX_EMBEDDABLE_SIZE = 50 * OneMB;

export function readStream(
  readable: Readable,
  maxSize = MAX_EMBEDDABLE_SIZE
): Promise<Buffer> {
  return readBufferWithLimit(readable, maxSize);
}

type RequestClosedCallback = (isAborted: boolean) => void;
type SignalReturnType = {
  signal: AbortSignal;
  onConnectionClosed: (cb: RequestClosedCallback) => void;
};

export function getSignal(req: Request): SignalReturnType {
  const controller = new AbortController();

  let closed: boolean | undefined;
  let callback: ((isAborted: boolean) => void) | undefined = undefined;
  const response = req.res;

  const finish = (aborted: boolean) => {
    if (closed !== undefined) return;
    closed = aborted;
    req.off('aborted', onRequestAborted);
    response?.off('finish', onResponseFinish);
    response?.off('close', onResponseClose);
    req.socket.off('close', onSocketClose);
    if (aborted) controller.abort();
    callback?.(aborted);
  };
  const onRequestAborted = () => finish(true);
  const onResponseFinish = () => finish(false);
  const onResponseClose = () => finish(!response?.writableFinished);
  const onSocketClose = () => finish(!response?.writableFinished);

  // An SSE response can close while a proxy keeps the upstream socket alive.
  // Request "close" is not used: it also fires after a normal request body.
  req.on('aborted', onRequestAborted);
  response?.on('finish', onResponseFinish);
  response?.on('close', onResponseClose);
  req.socket.on('close', onSocketClose);
  if (req.aborted || (response?.destroyed && !response.writableFinished)) {
    finish(true);
  } else if (response?.writableFinished) {
    finish(false);
  }

  return {
    signal: controller.signal,
    onConnectionClosed: cb => {
      callback = cb;
      if (closed !== undefined) cb(closed);
    },
  };
}

export function getTools(
  tools?: PromptTools | null,
  toolsConfig?: ToolsConfig
) {
  if (!tools || !toolsConfig) {
    return tools;
  }
  let result: PromptTools = tools;
  (Object.keys(toolsConfig) as Array<keyof ToolsConfig>).forEach(key => {
    const value = toolsConfig[key];
    switch (key) {
      case 'searchWorkspace':
        if (value === false) {
          result = result.filter(tool => {
            return tool !== 'docKeywordSearch' && tool !== 'docSemanticSearch';
          });
        }
        break;
      case 'readingDocs':
        if (value === false) {
          result = result.filter(tool => {
            return tool !== 'docRead';
          });
        }
        break;
    }
  });
  return result;
}
