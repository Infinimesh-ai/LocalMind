abstract class BaseAIError extends Error {
  abstract readonly type: AIErrorType;
}

export enum AIErrorType {
  ByokNotConfigured = 'ByokNotConfigured',
  GeneralNetworkError = 'GeneralNetworkError',
  PaymentRequired = 'PaymentRequired',
  Unauthorized = 'Unauthorized',
  RequestTimeout = 'RequestTimeout',
}

export class ByokNotConfiguredError extends BaseAIError {
  readonly type = AIErrorType.ByokNotConfigured;

  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends BaseAIError {
  readonly type = AIErrorType.Unauthorized;

  constructor() {
    super('Unauthorized');
  }
}

// user has used up the quota
export class PaymentRequiredError extends BaseAIError {
  readonly type = AIErrorType.PaymentRequired;

  constructor() {
    super('Payment required');
  }
}

// general 500x error
export class GeneralNetworkError extends BaseAIError {
  readonly type = AIErrorType.GeneralNetworkError;

  constructor(message: string = 'Network error') {
    super(message);
  }
}

// request timeout
export class RequestTimeoutError extends BaseAIError {
  readonly type = AIErrorType.RequestTimeout;

  constructor(message: string = 'Request timeout') {
    super(message);
  }
}

export type AIError =
  | ByokNotConfiguredError
  | UnauthorizedError
  | PaymentRequiredError
  | GeneralNetworkError
  | RequestTimeoutError;
