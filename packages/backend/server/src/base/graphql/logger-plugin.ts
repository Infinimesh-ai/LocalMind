import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
  GraphQLServerListener,
} from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { Logger } from '@nestjs/common';
import { Response } from 'express';

import { LocalMindLogService, SLOW_REQUEST_THRESHOLD_MS } from '../logger';
import { metrics } from '../metrics/metrics';
import { mapAnyError } from '../nestjs';

export interface RequestContext {
  req: Express.Request & {
    res: Express.Response;
  };
}

export const GRAPHQL_SUMMARY_INTERVAL_MS = 60_000;
// Operation names come from clients; bound the keys and the latency samples.
const MAX_SUMMARY_OPERATIONS = 200;
const MAX_SAMPLES_PER_OPERATION = 512;
const OTHER_OPERATION = '__other__';

/**
 * Successful, fast GraphQL requests are persisted as one summary per operation
 * per window; failures and slow requests keep a per-request completion log.
 */
export class GraphQLCompletionSummary {
  private startedAt = Date.now();
  private readonly operations = new Map<
    string,
    { count: number; maxMs: number; samples: number[] }
  >();

  record(operation: string | undefined, durationMs: number) {
    let key = operation || 'anonymous';
    if (
      !this.operations.has(key) &&
      this.operations.size >= MAX_SUMMARY_OPERATIONS
    )
      key = OTHER_OPERATION;
    let entry = this.operations.get(key);
    if (!entry) {
      entry = { count: 0, maxMs: 0, samples: [] };
      this.operations.set(key, entry);
    }
    entry.count++;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
    if (entry.samples.length < MAX_SAMPLES_PER_OPERATION) {
      entry.samples.push(durationMs);
    } else {
      // Reservoir sampling keeps percentiles representative within the bound.
      const index = Math.floor(Math.random() * entry.count);
      if (index < MAX_SAMPLES_PER_OPERATION) entry.samples[index] = durationMs;
    }
  }

  flush(now = Date.now()) {
    const windowStartedAt = new Date(this.startedAt).toISOString();
    const windowMs = now - this.startedAt;
    this.startedAt = now;
    for (const [operation, entry] of this.operations) {
      const samples = entry.samples.sort((a, b) => a - b);
      const at = (ratio: number) =>
        samples[Math.floor(ratio * (samples.length - 1))];
      LocalMindLogService.emit({
        eventName: 'graphql.request.summary',
        severity: 'info',
        status: 'success',
        metadata: {
          operation,
          count: entry.count,
          p50Ms: at(0.5),
          p95Ms: at(0.95),
          maxMs: entry.maxMs,
          windowStartedAt,
          windowMs,
        },
      });
    }
    this.operations.clear();
  }
}

@Plugin()
export class GQLLoggerPlugin implements ApolloServerPlugin {
  private readonly logger = new Logger(GQLLoggerPlugin.name);
  readonly summary = new GraphQLCompletionSummary();

  serverWillStart(): Promise<GraphQLServerListener> {
    const timer = setInterval(
      () => this.summary.flush(),
      GRAPHQL_SUMMARY_INTERVAL_MS
    );
    timer.unref?.();
    return Promise.resolve({
      serverWillStop: () => {
        clearInterval(timer);
        this.summary.flush();
        return Promise.resolve();
      },
    });
  }

  requestDidStart(
    ctx: GraphQLRequestContext<RequestContext>
  ): Promise<GraphQLRequestListener<GraphQLRequestContext<RequestContext>>> {
    const res = ctx.contextValue.req.res as Response;
    const headers = ctx.request.http?.headers;

    const info = {
      operation: ctx.request.operationName ?? headers?.get('x-operation-name'),
      clientVersion: headers?.get('x-affine-version'),
    };

    if (!info.operation) {
      this.logger.warn(
        `GraphQL operation name is not provided (${JSON.stringify({
          userAgent: headers?.get('user-agent'),
          clientVersion: info.clientVersion,
          rayId: headers?.get('cf-ray'),
          country: headers?.get('cf-ipcountry'),
        })})`
      );
    }

    metrics.gql.counter('query_counter').add(1, info);
    const start = Date.now();
    let failed = false;
    function endTimer() {
      return Date.now() - start;
    }

    return Promise.resolve({
      willSendResponse: () => {
        const time = endTimer();
        if (failed || time >= SLOW_REQUEST_THRESHOLD_MS) {
          LocalMindLogService.emit({
            eventName: 'graphql.request.completed',
            severity: 'info',
            status: failed ? 'failed' : 'success',
            durationMs: time,
            metadata: {
              operation: info.operation,
              clientVersion: info.clientVersion,
            },
          });
        } else {
          this.summary.record(info.operation, time);
        }
        res.setHeader('Server-Timing', `gql;dur=${time};desc="GraphQL"`);
        metrics.gql.histogram('query_duration').record(time, info);
        return Promise.resolve();
      },
      didEncounterErrors: ctx => {
        failed = true;
        ctx.errors.forEach(gqlErr => {
          const error = mapAnyError(gqlErr);
          error.log('GraphQL');
          LocalMindLogService.emit({
            eventName: 'graphql.request.failed',
            severity: 'error',
            status: 'failed',
            errorCode: error.type,
            metadata: { operation: info.operation },
          });

          metrics.gql.counter('query_error_counter').add(1, {
            ...info,
            code: error.status,
            type: error.type,
            error: error.name,
          });
        });

        return Promise.resolve();
      },
    });
  }
}
