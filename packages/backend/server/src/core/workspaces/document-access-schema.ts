import { z } from 'zod';

const id = z.string().min(1).max(256);
export const documentMemberRole = z.enum([
  'reader',
  'commenter',
  'editor',
  'manager',
]);
export const documentAccessCommand = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('publish'), mode: z.enum(['page', 'edgeless']) })
    .strict(),
  z.object({ type: z.literal('unpublish') }).strict(),
  z
    .object({
      type: z.literal('member.set'),
      userIds: z.array(id).min(1).max(100),
      role: documentMemberRole,
    })
    .strict(),
  z.object({ type: z.literal('member.remove'), userId: id }).strict(),
  z.object({ type: z.literal('owner.transfer'), userId: id }).strict(),
  z
    .object({
      type: z.literal('default_role.set'),
      role: z.enum(['none', 'reader', 'commenter', 'editor', 'manager']),
    })
    .strict(),
]);
