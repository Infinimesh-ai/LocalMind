import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  PROJECT_REPORT_FINALIZE_WORKFLOW,
  ProjectReportScheduleService,
} from '../../core/project-report/schedule';
import { CopilotAgentRuntimeWorkflowRegistry } from './agent-runtime-workflow-registry';
@Injectable()
export class ProjectReportScheduleAdapter {
  constructor(ref: ModuleRef, registry: CopilotAgentRuntimeWorkflowRegistry) {
    const service = () =>
      ref.get(ProjectReportScheduleService, { strict: false });
    registry.registerProject({
      workflow: PROJECT_REPORT_FINALIZE_WORKFLOW,
      capabilities: {
        version: 'agent-runtime-workflow-adapter-capabilities/v1',
        supportedStepTypes: ['tool'],
        sideEffectMode: 'project_write',
        summary:
          'Apply scheduled report candidates and finalize only fully verified evidence under a persisted worker lease.',
      },
      prepare: run => service().prepareExecution(run),
      execute: async run => (await service().prepareExecution(run))(run),
    });
  }
}
