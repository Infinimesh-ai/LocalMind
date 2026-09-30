/** Independent resources commit separately; failed identities remain available for retry. */
export async function changeResourceBatch(
  ids: readonly string[],
  execute: (id: string) => Promise<void>
) {
  if (ids.length > 100)
    throw new Error('Select no more than 100 resources per operation');
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of new Set(ids)) {
    try {
      await execute(id);
      succeeded.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { succeeded, failed };
}
