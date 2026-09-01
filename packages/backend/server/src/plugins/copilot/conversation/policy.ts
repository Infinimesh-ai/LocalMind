import { Injectable } from '@nestjs/common';

import { Models } from '../../../models';
import type { Turn } from '../core';
import type { ResolvedPrompt } from '../prompt';

@Injectable()
export class ConversationPolicy {
  constructor(private readonly models: Models) {}

  async getQuota(userId: string) {
    const used = await this.models.copilotSession.countUserMessages(userId);
    return { limit: undefined, used };
  }

  checkQuota(_userId: string) {
    return Promise.resolve();
  }

  hasQuota(_userId: string) {
    return Promise.resolve(true);
  }

  shouldScheduleTitle(prompt: Pick<ResolvedPrompt, 'action'>) {
    return !prompt.action;
  }

  shouldGenerateTitle(input: { title: string | null; turns: Turn[] }) {
    if (input.title || !input.turns.length) {
      return false;
    }

    let hasUser = false;
    let hasAssistant = false;
    for (const turn of input.turns) {
      if (turn.role === 'user') {
        hasUser = true;
      } else if (turn.role === 'assistant') {
        hasAssistant = true;
      }
      if (hasUser && hasAssistant) {
        return true;
      }
    }

    return false;
  }

  buildTitlePromptContent(turns: Turn[]) {
    return turns.map(turn => `[${turn.role}]: ${turn.content}`).join('\n');
  }
}
