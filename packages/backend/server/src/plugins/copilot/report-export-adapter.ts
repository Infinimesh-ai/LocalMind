import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { ProjectReportExportService } from '../../core/project-report/export';
import { PROJECT_REPORT_EXPORT_WORKFLOW } from '../../models/project-report-export';
import { CopilotAgentRuntimeWorkflowRegistry } from './agent-runtime-workflow-registry';
@Injectable()
export class ProjectReportExportAdapter {
  constructor(ref: ModuleRef, registry: CopilotAgentRuntimeWorkflowRegistry) {
    const service = () =>
      ref.get(ProjectReportExportService, { strict: false });
    registry.registerProject({
      workflow: PROJECT_REPORT_EXPORT_WORKFLOW,
      capabilities: {
        version: 'agent-runtime-workflow-adapter-capabilities/v1',
        supportedStepTypes: ['tool'],
        sideEffectMode: 'project_write',
        summary:
          'Render immutable authorized Project report projections into native export packages.',
      },
      prepare: run => service().prepareExecution(run),
      execute: async run => (await service().prepareExecution(run))(run),
    });
  }
}
