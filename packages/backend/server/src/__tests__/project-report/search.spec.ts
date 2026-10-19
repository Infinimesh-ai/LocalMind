import type { ModuleRef } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import type { Config } from '../../base';
import type { ProjectReportContentService } from '../../core/project-report/content';
import type { ProjectReportExportService } from '../../core/project-report/export';
import { ProjectReportService } from '../../core/project-report/service';
import type { ProjectReportShareService } from '../../core/project-report/share';
import type { Models } from '../../models';

function fixture() {
  const reports = { items: [], nextCursor: null };
  const models = {
    projectResource: { assertMember: Sinon.stub().resolves() },
    projectReport: {
      list: Sinon.stub().resolves(reports),
      templates: Sinon.stub().resolves([{ id: 'template' }]),
    },
  };
  const db = {
    aiContextProject: {
      findUniqueOrThrow: Sinon.stub().resolves({ status: 'active' }),
    },
    aiContextProjectMember: { findMany: Sinon.stub().resolves([]) },
    $queryRaw: Sinon.stub().resolves([]),
  };
  const service = new ProjectReportService(
    models as unknown as Models,
    db as unknown as PrismaClient,
    {} as ModuleRef,
    {} as ProjectReportContentService,
    {} as ProjectReportExportService,
    {} as ProjectReportShareService,
    {
      projectReports: { enabled: true, schedulesEnabled: true },
      mailer: { SMTP: {} },
    } as Config
  );
  return { service, models, db, reports };
}

test('search loads only the authorized report page and preserves all query bounds', async t => {
  const f = fixture();
  const query = {
    projectId: 'project',
    view: 'list_results' as const,
    search: 'Weekly',
    lifecycle: 'archived' as const,
    cursor: 'cursor',
    limit: 30,
  };
  const result = await f.service.state('actor', query);
  t.deepEqual(f.models.projectResource.assertMember.firstCall.args, [
    { projectId: 'project', actorId: 'actor' },
    false,
    true,
  ]);
  t.deepEqual(f.models.projectReport.list.firstCall.args, [
    { ...query, actorId: 'actor' },
  ]);
  t.deepEqual('reports' in result ? result.reports : undefined, f.reports);
  t.false(f.models.projectReport.templates.called);
  t.false(f.db.aiContextProjectMember.findMany.called);
  t.false(f.db.$queryRaw.called);
  t.false('templates' in result);
});

test('both split queries recheck membership before reading protected data', async t => {
  const f = fixture();
  const denied = new Error('Membership revoked');
  f.models.projectResource.assertMember.rejects(denied);
  for (const view of ['list_results', 'list_options'] as const) {
    await t.throwsAsync(
      f.service.state('actor', { projectId: 'project', view }),
      {
        is: denied,
      }
    );
  }
  t.false(f.models.projectReport.list.called);
  t.false(f.models.projectReport.templates.called);
  t.false(f.db.aiContextProject.findUniqueOrThrow.called);
  t.false(f.db.$queryRaw.called);
});

test('creation options skip report queries while the existing list contract stays complete', async t => {
  const f = fixture();
  const options = await f.service.state('actor', {
    projectId: 'project',
    view: 'list_options',
  });
  t.deepEqual(options.templates, [{ id: 'template' }]);
  t.false('reports' in options);
  t.false(f.models.projectReport.list.called);
  const legacy = await f.service.state('actor', {
    projectId: 'project',
    view: 'list',
  });
  t.deepEqual(legacy.templates, options.templates);
  t.deepEqual('reports' in legacy ? legacy.reports : undefined, f.reports);
});
