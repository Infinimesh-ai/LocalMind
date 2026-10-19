export const REPORT_GENERATION_FAILURES = {
  REPORT_PROVIDER_UNAVAILABLE:
    'The instance Project AI provider is unavailable. Ask an administrator to enable its global BYOK configuration.',
  REPORT_MODEL_BUDGET_EXCEEDED:
    'Report generation reached the configured model-call budget. Narrow the source scope or ask an administrator to increase the budget.',
  REPORT_MODEL_INPUT_BUDGET_EXCEEDED:
    'A report generation step exceeds the model context budget. Narrow the selected documents or shorten the instructions.',
  REPORT_LAYOUT_BUDGET_EXCEEDED:
    'The report exceeds the supported presentation size. Narrow its period or selected document scope.',
  REPORT_MODEL_OUTPUT_INVALID:
    'The Project AI provider returned an invalid structured result. Retry this task; completed source checkpoints will be retained.',
  REPORT_MODEL_REQUEST_FAILED:
    'The Project AI provider request failed or timed out. Check its global configuration and retry this task; completed checkpoints will be retained.',
} as const;
export class ReportGenerationError extends Error {
  constructor(readonly code: keyof typeof REPORT_GENERATION_FAILURES) {
    super(REPORT_GENERATION_FAILURES[code]);
    this.name = 'ReportGenerationError';
  }
}
