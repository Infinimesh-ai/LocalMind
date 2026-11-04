import { ResourceError } from './resource-types';

export class DocumentEditError extends ResourceError {
  constructor(
    code:
      | 'invalid_input'
      | 'unsupported_document_structure'
      | 'resource_not_found',
    readonly detail: {
      opId?: string;
      objectId?: string;
      field?: string;
      reason: string;
    }
  ) {
    super(code);
  }
}
