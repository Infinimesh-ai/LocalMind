import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { LocalMindLogService } from '../../base/logger';
import { Admin } from '../common';

@Controller('api/logs')
export class ObservabilityController {
  constructor(private readonly logs: LocalMindLogService) {}

  @Post('batch')
  async ingest(@Body() body: unknown) {
    const entries = Array.isArray(body)
      ? body
      : body &&
          typeof body === 'object' &&
          Array.isArray((body as { events?: unknown }).events)
        ? (body as { events: unknown[] }).events
        : [];
    const eventIds: string[] = [];
    for (const raw of entries.slice(0, 100)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      eventIds.push(
        await this.logs.write({
          eventId: typeof item.eventId === 'string' ? item.eventId : undefined,
          eventName:
            typeof item.eventName === 'string' ? item.eventName : 'client.log',
          severity:
            typeof item.severity === 'string' &&
            ['debug', 'info', 'warn', 'error', 'fatal'].includes(item.severity)
              ? (item.severity as 'debug' | 'info' | 'warn' | 'error' | 'fatal')
              : 'info',
          message: typeof item.message === 'string' ? item.message : undefined,
          metadata: item.metadata,
          component:
            typeof item.component === 'string' ? item.component : 'client',
          service: typeof item.service === 'string' ? item.service : 'client',
        })
      );
    }
    return { accepted: eventIds.length, eventIds };
  }

  @Get('export')
  @Admin()
  async exportLogs(
    @Query('format') format: 'ndjson' | 'csv' = 'ndjson',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('severity') severity?: string,
    @Query('eventName') eventName?: string,
    @Query('service') service?: string,
    @Query('component') component?: string,
    @Query('requestId') requestId?: string,
    @Query('traceId') traceId?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('projectId') projectId?: string,
    @Query('runId') runId?: string,
    @Query('jobId') jobId?: string,
    @Query('status') status?: string,
    @Query('errorCode') errorCode?: string,
    @Query('keyword') keyword?: string,
    @Res() response?: Response
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const rows = await this.logs.query({
      from:
        fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
      to: toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
      severity,
      eventName,
      service,
      component,
      requestId,
      traceId,
      workspaceId,
      projectId,
      runId,
      jobId,
      status,
      errorCode,
      keyword,
      limit: 1000,
    });
    const lines =
      format === 'csv'
        ? [
            'eventId,occurredAt,severity,eventName,status,errorCode,requestId',
            ...rows.map(row =>
              [
                row.eventId,
                row.occurredAt.toISOString(),
                row.severity,
                row.eventName,
                row.status ?? '',
                row.errorCode ?? '',
                row.requestId ?? '',
              ]
                .map(value => JSON.stringify(value))
                .join(',')
            ),
          ]
        : rows.map(row =>
            JSON.stringify({
              eventId: row.eventId,
              occurredAt: row.occurredAt,
              severity: row.severity,
              eventName: row.eventName,
              status: row.status,
              errorCode: row.errorCode,
              requestId: row.requestId,
              metadata: row.metadata,
            })
          );
    const maxBytes = 5 * 1024 * 1024;
    const selectedLines: string[] = [];
    let bytes = 0;
    for (const line of lines) {
      const next = Buffer.byteLength(line + '\n');
      if (selectedLines.length && bytes + next > maxBytes) break;
      selectedLines.push(line);
      bytes += next;
    }
    await this.logs.writeAudit({
      action: 'logs.export',
      outcome: 'success',
      metadata: {
        format,
        rowCount: selectedLines.length,
        truncated: selectedLines.length < lines.length,
      },
    });
    const body = selectedLines.join('\n');
    response?.setHeader(
      'content-type',
      format === 'csv' ? 'text/csv' : 'application/x-ndjson'
    );
    response?.setHeader(
      'content-disposition',
      `attachment; filename="localmind-logs.${format === 'csv' ? 'csv' : 'ndjson'}"`
    );
    return response?.send(body) ?? body;
  }
}
