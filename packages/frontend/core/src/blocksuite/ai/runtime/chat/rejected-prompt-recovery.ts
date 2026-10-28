const PREFIX = 'localmind:rejected-ai-prompt:v1:';
const MAX_CHARACTERS = 128_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RejectedPromptRecovery {
  actorId(): string | undefined;
  read(actorId: string, scope: string, sessionId: string): string | undefined;
  write(actorId: string, scope: string, sessionId: string, text: string): void;
  clear(actorId: string, scope: string, sessionId: string): void;
}

// This is a tab-local draft, never accepted conversation history or an auto retry.
export function createRejectedPromptRecovery(
  actorId: () => string | undefined,
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () =>
    sessionStorage
): RejectedPromptRecovery {
  const key = (actor: string, scope: string, session: string) =>
    PREFIX + JSON.stringify([actor, scope, session]);
  return {
    actorId,
    read(actor, scope, session) {
      if (actorId() !== actor) return;
      try {
        const value: unknown = JSON.parse(
          storage().getItem(key(actor, scope, session)) ?? 'null'
        );
        if (
          value &&
          typeof value === 'object' &&
          'text' in value &&
          typeof value.text === 'string' &&
          value.text.length <= MAX_CHARACTERS &&
          'at' in value &&
          typeof value.at === 'number' &&
          value.at <= Date.now() &&
          Date.now() - value.at < MAX_AGE_MS
        )
          return value.text;
        storage().removeItem(key(actor, scope, session));
      } catch {
        /* Storage may be unavailable; the live error remains visible. */
      }
      return;
    },
    write(actor, scope, session, text) {
      if (actorId() !== actor || text.length > MAX_CHARACTERS) return;
      try {
        storage().setItem(
          key(actor, scope, session),
          JSON.stringify({ text, at: Date.now() })
        );
      } catch {
        /* A storage failure must not hide the original rejection. */
      }
    },
    clear(actor, scope, session) {
      if (actorId() !== actor) return;
      try {
        storage().removeItem(key(actor, scope, session));
      } catch {
        /* optional draft */
      }
    },
  };
}
