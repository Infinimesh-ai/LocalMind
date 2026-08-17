import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type { PromptMessage } from '../providers/types';
import { toolError } from './error';
import { defineTool } from './tool';

type RunPromptText = (
  promptName: string,
  params: Record<string, unknown>,
  options?: {
    appendMessages?: PromptMessage[];
  }
) => Promise<string>;

const logger = new Logger('DocComposeTool');

export const createDocComposeTool = (prompt: RunPromptText) => {
  return defineTool({
    description:
      'Generate a structured Markdown document preview without saving it to the workspace. Use doc_create to create a saved workspace document, and use doc_update to edit one.',
    inputSchema: z.object({
      title: z.string().describe('The title of the document'),
      userPrompt: z
        .string()
        .describe(
          'The user description of the document, will be used to generate the document'
        ),
    }),
    execute: async ({ title, userPrompt }) => {
      try {
        const content = await prompt(
          'Write an article about this',
          {},
          { appendMessages: [{ role: 'user', content: userPrompt }] }
        );

        return {
          title,
          markdown: content,
          wordCount: content.split(/\s+/).length,
        };
      } catch (err: any) {
        logger.error(`Failed to write document: ${title}`, err);
        return toolError('Doc Write Failed', err.message);
      }
    },
  });
};
