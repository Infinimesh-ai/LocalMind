import assert from 'node:assert/strict';
import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { DeckConfigSchema } from '@localmind/office/report-deck';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import { z } from 'zod';

import { CryptoHelper } from '../../base';
import { ProjectResourceService } from '../../core/project';
import { ReportDeckService } from '../../core/report-deck/service';
import { Models } from '../../models';
import { reportJson } from '../../models/report-deck-design';
import { ReportDeckAiService } from '../../plugins/copilot/report-deck-ai';
import { ReportWebGenerationService } from '../../plugins/copilot/report-web-design/generation';
import {
  REPORT_DESIGN_PROMPTS,
  REPORT_DESIGN_SKILL,
} from '../../plugins/copilot/report-web-design/prompts';
import { ensurePromptResponseSchemaHash } from '../../plugins/copilot/runtime/contracts/structured-output-contract';
import { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';
import { createTestingApp } from '../utils';
import { LIVE_CASES } from './live-cases';

const file = process.env.LOCALMIND_REPORT_DESIGN_BYOK_FILE;
const liveCase =
  LIVE_CASES.find(c => c.key === process.env.LOCALMIND_REPORT_DESIGN_CASE) ??
  LIVE_CASES[0];
(file ? test.serial : test.skip)(
  'actual selected BYOK: one-submit Chinese custom design and screenshot repair',
  async t => {
    t.timeout(2700000);
    assert(file);
    assert.equal(process.env.LOCALMIND_REPORT_DESIGN_ISOLATED, 'yes');
    assert(process.env.DATABASE_URL?.includes('localmind_report_v3_postgres'));
    assert.equal((await stat(file)).mode & 0o077, 0);
    const source = z
      .object({
        provider: z.string(),
        encryptedApiKey: z.string(),
        privateKey: z.string(),
        endpoint: z.string().nullable(),
        modelId: z.string(),
        apiStyle: z.string().nullable(),
      })
      .strict()
      .parse(JSON.parse(await readFile(file, 'utf8')));
    const bytes = Buffer.from(source.encryptedApiKey, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(source.privateKey).digest(),
      bytes.subarray(0, 12),
      { authTagLength: 12 }
    );
    decipher.setAuthTag(bytes.subarray(12, 24));
    const credential =
      decipher.update(bytes.subarray(24), undefined, 'utf8') +
      decipher.final('utf8');
    const app = await createTestingApp();
    try {
      const db = app.get(PrismaClient);
      const owner = await app.createUser(
        `design-${randomUUID()}@example.invalid`,
        { name: '设计验证' }
      );
      const project = await db.aiContextProject.create({
        data: {
          name: '虚构 Atlas 验证',
          members: { create: { userId: owner.id, role: 'owner' } },
        },
      });
      await db.aiProjectByokConfig.create({
        data: {
          id: 'global',
          revision: 1,
          provider: source.provider,
          encryptedApiKey: app.get(CryptoHelper).encrypt(credential),
          endpoint: source.endpoint,
          modelId: source.modelId,
          apiStyle: source.apiStyle,
          enabled: true,
          workOrderEnabled: false,
          lastValidatedAt: new Date(),
          updatedBy: owner.id,
        },
      });
      await app
        .get<TransactionHost<TransactionalAdapterPrisma>>(TransactionHost)
        .withTransaction({ timeout: 30000 }, () =>
          app.get(ProjectResourceService).createDocument({
            projectId: project.id,
            actorId: owner.id,
            requestKey: 'source',
            title: liveCase.title,
            markdown: liveCase.markdown,
          })
        );
      const result = await app.get(ReportDeckService).command(owner.id, {
        operation: 'create',
        requestKey: randomUUID(),
        sources: [
          { scopeKind: 'project', scopeId: project.id, kind: 'project_all' },
        ],
        config: DeckConfigSchema.parse({
          mode: 'custom',
          length: process.env.LOCALMIND_REPORT_DESIGN_LONG
            ? 'long'
            : liveCase.length,
          language: 'zh-CN',
          purpose: liveCase.purpose,
          audience: liveCase.audience,
          customStyle: liveCase.customStyle,
          instructions: liveCase.instructions,
        }),
      });
      assert('deck' in result && result.deck);
      const runtime = app.get(PromptRuntime);
      if (process.env.LOCALMIND_REPORT_DESIGN_ENGINE === 'v3') {
        // Baseline: freeze the pre-v4 (v3.1) prompts into the run snapshot so
        // the same material, model and request run on the previous engine.
        const deck = result.deck;
        const models = app.get(Models);
        const row = await db.reportDeck.findUniqueOrThrow({
          where: { id: deck.id },
        });
        const choice = {
          scopeKind: row.aiScopeKind as 'project' | 'workspace',
          scopeId: row.aiScopeId,
        };
        const prompts: Record<string, unknown> = {};
        const promptHashes: Record<string, string> = {};
        for (const seed of REPORT_DESIGN_PROMPTS) {
          await models.projectReportGeneration.seedPrompt(seed);
          prompts[seed.name] = await runtime.snapshot(seed.name);
          promptHashes[seed.name] = ensurePromptResponseSchemaHash({
            value: reportJson(prompts[seed.name]),
          }) as string;
        }
        const capabilities = await app
          .get(ReportDeckAiService)
          .designCapabilities(owner.id, choice);
        const claimed = await models.reportDeckDesign.claim(
          deck.id,
          0,
          reportJson({
            version: 'report-web-v3',
            config: DeckConfigSchema.parse(row.config),
            choice,
            capabilities: {
              modelId: capabilities.modelId,
              vision: capabilities.vision,
              structured: capabilities.structured,
              contextWindow: capabilities.contextWindow,
            },
            skill: REPORT_DESIGN_SKILL,
            prompts,
            promptHashes,
            limits: { maxCalls: 40, maxHtmlBytes: 5 * 1024 * 1024 },
          }),
          15 * 60000
        );
        assert(claimed);
        await db.reportDeckRun.update({
          where: { id: claimed.id },
          data: { leaseExpiresAt: new Date(0) },
        });
      }
      const originalStructured = runtime.runStructured.bind(runtime);
      runtime.runStructured = async (...args) => {
        if (
          process.env.LOCALMIND_REPORT_DESIGN_PROBE_ONLY &&
          !args[0].includes('Vision')
        )
          throw new Error('Probe-only fixture finished');
        try {
          return await originalStructured(...args);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          t.log({
            stage: args[0],
            type: error instanceof Error ? error.name : 'unknown',
            message: message
              .replaceAll(credential, '[redacted]')
              .replace(/https?:\/\/\S+/g, '[endpoint]')
              .replace(/[A-Za-z0-9+/=_-]{64,}/g, '[data]')
              .slice(0, 400),
            categories: [
              'schema',
              'incomplete',
              'token',
              'image',
              '400',
              '401',
              '429',
              'timeout',
              'unsupported',
              'No text',
              'route',
              'provider',
            ].filter(word =>
              message.toLowerCase().includes(word.toLowerCase())
            ),
          });
          throw error;
        }
      };
      const started = Date.now();
      await app.get(ReportWebGenerationService).generate(result.deck.id, 0);
      const row = await db.reportDeck.findUniqueOrThrow({
        where: { id: result.deck.id },
      });
      const run = await db.reportDeckRun.findUniqueOrThrow({
        where: { deckId_attempt: { deckId: row.id, attempt: 0 } },
        include: { steps: true, artifacts: true },
      });
      const directory = `/workspace/.codex-artifacts/report-web-v4/${process.env.LOCALMIND_REPORT_DESIGN_ENGINE === 'v3' ? 'v3-' : ''}${liveCase.key}${process.env.LOCALMIND_REPORT_DESIGN_RUN ? `-${process.env.LOCALMIND_REPORT_DESIGN_RUN}` : ''}`;
      await mkdir(directory, { recursive: true });
      await writeFile(
        `${directory}/result.json`,
        JSON.stringify(
          {
            status: row.status,
            errorCode: row.errorCode,
            model: row.modelId,
            elapsedMs: Date.now() - started,
            quality: row.quality,
            usage: row.usage,
            slideCount: row.slideCount,
            calls: run.calls,
            repairs: run.repairs,
            steps: run.steps.map(s => ({
              stage: s.stage,
              status: s.status,
              errorCode: s.errorCode,
              inputChars: s.inputChars,
              outputChars: s.outputChars,
            })),
          },
          null,
          2
        )
      );
      for (const artifact of run.artifacts) {
        if (artifact.key.startsWith('shot-'))
          await writeFile(`${directory}/${artifact.key}.jpg`, artifact.payload);
        else if (artifact.mime === 'application/json+gzip')
          await writeFile(
            `${directory}/${artifact.key}.json`,
            gunzipSync(artifact.payload)
          );
      }
      if (row.htmlGzip)
        await writeFile(`${directory}/report.html`, gunzipSync(row.htmlGzip));
      if (process.env.LOCALMIND_REPORT_DESIGN_PROBE_ONLY) {
        const proof = run.artifacts.find(a => a.key === 'vision-capability');
        t.truthy(proof);
        t.is(
          proof && JSON.parse(gunzipSync(proof.payload).toString()).supported,
          true
        );
        return;
      }
      t.is(row.status, 'ready', row.errorCode ?? '');
      const html = row.htmlGzip ? gunzipSync(row.htmlGzip).toString() : '';
      const visible = html.replace(/<[^>]+>/g, ' ').replace(/[,，]/g, '');
      for (const value of liveCase.mustInclude)
        t.true(
          visible.includes(value),
          `Grounded value ${value} must remain visible`
        );
      // The fast path has no model visual review by design.
      if ((row.usage as { mode?: string } | null)?.mode !== 'fast')
        t.is((row.quality as { visual?: string } | null)?.visual, 'complete');
      t.log({
        elapsedMs: Date.now() - started,
        calls: run.calls,
        repairs: run.repairs,
        model: row.modelId,
      });
    } finally {
      await app.close();
    }
  }
);
