import { z } from 'zod';

export const StreamObjectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text-delta'),
    textDelta: z.string(),
  }),
  z.object({
    type: z.literal('reasoning'),
    textDelta: z.string(),
  }),
  z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.any()),
    rawArgumentsText: z.string().optional(),
    argumentParseError: z.string().optional(),
    thought: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.any()),
    result: z.any(),
    isError: z.boolean().optional(),
    rawArgumentsText: z.string().optional(),
    argumentParseError: z.string().optional(),
  }),
]);

export type StreamObject = z.infer<typeof StreamObjectSchema>;

export type BlockerSuggestionType =
  | 'wait_reply'
  | 'wait_file'
  | 'wait_decision'
  | 'custom';

export type BlockerSuggestion = {
  aiSuggestionId: string;
  confirmationProof: string;
  projectId: string;
  title: string;
  type: BlockerSuggestionType;
  waitingOn: string;
  dueAt: string | null;
  origin: 'ai_suggested';
  confirmationRequired: true;
};

export type BlockerSuggestionConfirmation = {
  onConfirm: (suggestion: BlockerSuggestion) => Promise<void>;
  labels: {
    title: string;
    type: string;
    waitingOn: string;
    dueAt: string;
    create: string;
    creating: string;
    created: string;
    failed: string;
    typeNames: Record<BlockerSuggestionType, string>;
  };
};

const WorkOrderAgentDraftSchema = z.object({
  kind: z.literal('work_order_draft'),
  draftId: z.string().uuid(),
  sourceSessionId: z.string().uuid(),
  origin: z.literal('ai_generated'),
  confirmationRequired: z.literal(true),
  recipients: z
    .array(
      z
        .object({
          recipient: z.object({
            id: z.string().min(1).max(256),
            name: z.string().max(320),
            email: z.string().email().max(320),
          }),
          title: z.string().trim().min(1).max(256),
          purpose: z.string().trim().min(1).max(20_000),
          relationKind: z.enum(['original', 'supplement', 'replacement']),
          relatedWorkOrderId: z.string().min(1).max(256).nullable(),
          requirements: z
            .array(
              z
                .object({
                  kind: z.enum(['text', 'file']),
                  title: z.string().trim().min(1).max(256),
                  instructions: z.string().trim().min(1).max(20_000),
                  required: z.boolean(),
                  acceptedMimeTypes: z
                    .array(z.string().min(1).max(256))
                    .max(32),
                  minCount: z.number().int().min(0).max(32),
                  maxCount: z.number().int().min(1).max(32),
                })
                .refine(
                  item =>
                    item.maxCount >= item.minCount &&
                    (item.kind !== 'file' || item.acceptedMimeTypes.length > 0)
                )
            )
            .min(1)
            .max(32),
        })
        .refine(item =>
          item.relationKind === 'original'
            ? item.relatedWorkOrderId === null
            : !!item.relatedWorkOrderId
        )
    )
    .min(1)
    .max(20),
});

export type WorkOrderAgentDraft = z.infer<typeof WorkOrderAgentDraftSchema>;

export function workOrderDraftFromToolResult(
  toolName: string,
  result: unknown,
  isError = false
): WorkOrderAgentDraft | null {
  if (toolName !== 'work_order_draft' || isError) return null;
  const parsed = WorkOrderAgentDraftSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export type WorkOrderProposalActions = {
  sourceProjectName?: string;
  onSend: (draft: WorkOrderAgentDraft) => Promise<void>;
  onRequestRevision: (
    draft: WorkOrderAgentDraft,
    feedback: string
  ) => Promise<void>;
  errorMessage?: (error: unknown) => string;
  labels: {
    title: string;
    notice: string;
    sourceProject: string;
    sourceProjectDisclosure: string;
    recipient: string;
    requirements: string;
    required: string;
    optional: string;
    file: string;
    text: string;
    formats: string;
    count: string;
    relation: string;
    relationNames: Record<'original' | 'supplement' | 'replacement', string>;
    feedback: string;
    send: string;
    sending: string;
    sent: string;
    revise: string;
    revising: string;
    revisionRequested: string;
    cancel: string;
    cancelled: string;
    failed: string;
  };
};

const ChatMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.union([z.literal('user'), z.literal('assistant')]),
  createdAt: z.string(),
  streamObjects: z.array(StreamObjectSchema).optional(),
  attachments: z.array(z.string()).optional(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export const ChatMessagesSchema = z.array(ChatMessageSchema);

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export type ChatAction = {
  action: string;
  messages: ChatMessage[];
  sessionId: string;
  createdAt: string;
};

export type HistoryMessage = ChatMessage | ChatAction;

export type MessageRole = 'user' | 'assistant';

export type MessageUserInfo = {
  userId?: string;
  userName?: string;
  avatarUrl?: string;
};

export function isChatAction(item: HistoryMessage): item is ChatAction {
  return 'action' in item;
}

export function isChatMessage(item: HistoryMessage): item is ChatMessage {
  return 'role' in item;
}

export type ChatStatus =
  | 'loading'
  | 'success'
  | 'error'
  | 'idle'
  | 'transmitting';
