import { ConsoleLogger, Injectable, type LogLevel } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';

import { UserFriendlyError } from '../error';
import { LocalMindLogService } from './localmind-log-service';

// DO NOT use this Logger directly
// Use it via this way: `private readonly logger = new Logger(MyService.name)`
@Injectable()
export class AFFiNELogger extends ConsoleLogger {
  override stringifyMessage(message: unknown, logLevel: LogLevel) {
    const messageString = super.stringifyMessage(message, logLevel);
    const requestId = AFFiNELogger.getRequestId();
    if (!requestId) {
      return messageString;
    }
    return `<${requestId}> ${messageString}`;
  }

  static getRequestId(): string | undefined {
    return ClsServiceManager.getClsService()?.getId();
  }

  static formatStack(stackOrError?: Error | string | unknown) {
    if (stackOrError instanceof Error) {
      let err = stackOrError;

      // most of the internal error are caught and created by `GlobalExceptionFilter`,
      // and their error stack is helpless
      if (err instanceof UserFriendlyError) {
        return err.stacktrace;
      }

      let stack = err.stack ?? '';
      if (err.cause instanceof Error && err.cause.stack) {
        stack += `\n\nCaused by:\n\n${err.cause.stack}`;
      }
      return stack;
    }
    return stackOrError;
  }

  /**
   * Nestjs ConsoleLogger.error() will not print the stack trace if the error is an instance of Error
   * This method is a workaround to print the stack trace
   *
   * Usage:
   * ```
   * this.logger.error('some error happens', errInstance);
   * ```
   */
  override error(
    message: any,
    stackOrError?: Error | string | unknown,
    context?: string
  ) {
    LocalMindLogService.emit({
      eventName: 'logger.error',
      severity: 'error',
      message: String(message),
      metadata: stackOrError,
      component: context,
    });
    super.error(message, AFFiNELogger.formatStack(stackOrError), context);
  }

  override log(message: any, context?: string | object) {
    LocalMindLogService.emit({
      eventName: 'logger.log',
      severity: 'info',
      message: String(message),
      component: typeof context === 'string' ? context : undefined,
      metadata: typeof context === 'object' ? context : undefined,
    });
    super.log(message, typeof context === 'string' ? context : undefined);
  }

  override warn(message: any, context?: string | object) {
    LocalMindLogService.emit({
      eventName: 'logger.warn',
      severity: 'warn',
      message: String(message),
      component: typeof context === 'string' ? context : undefined,
      metadata: typeof context === 'object' ? context : undefined,
    });
    super.warn(message, typeof context === 'string' ? context : undefined);
  }

  override debug(message: any, context?: string | object) {
    LocalMindLogService.emit({
      eventName: 'logger.debug',
      severity: 'debug',
      message: String(message),
      component: typeof context === 'string' ? context : undefined,
      metadata: typeof context === 'object' ? context : undefined,
    });
    super.debug(message, typeof context === 'string' ? context : undefined);
  }
}
