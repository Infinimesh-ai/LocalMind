/** A command tied to an old Office revision cannot succeed by replaying it. */
export function isStaleOfficeCommandFailure(run: {
  workflow: string;
  status: string;
  failureMessage?: string | null;
}) {
  return (
    run.workflow === 'agent_runtime_office_command' &&
    run.status === 'failed' &&
    run.failureMessage === 'Office artifact revision conflict'
  );
}
