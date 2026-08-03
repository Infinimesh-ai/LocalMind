type SourceChainLogger = {
  warn(message: string): unknown;
};

export function warnUnknownRegistrySourceChainStatuses(input: {
  allowedStatuses: ReadonlySet<string>;
  logger: SourceChainLogger;
  registryKind: string;
  value: unknown;
}) {
  if (!Array.isArray(input.value)) return;
  for (const entry of input.value) {
    if (!entry || typeof entry !== 'object') continue;
    const status = (entry as Record<string, unknown>).status;
    if (typeof status !== 'string' || input.allowedStatuses.has(status)) {
      continue;
    }
    input.logger.warn(
      `Dropped ${input.registryKind} source-chain entry with unknown status ${JSON.stringify(
        status.slice(0, 64)
      )}`
    );
  }
}
