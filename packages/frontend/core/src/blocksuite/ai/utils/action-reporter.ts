import type { ActionEventType } from '../provider';
import { getAIRequestService } from '../runtime/request';

export function reportResponse(event: ActionEventType, host?: unknown) {
  return getAIRequestService().reportLastAction(event, host);
}
