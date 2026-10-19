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
import { ReportWebGenerationService } from '../../plugins/copilot/report-web-design/generation';
import { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';
import { createTestingApp } from '../utils';

const file = process.env.LOCALMIND_REPORT_DESIGN_BYOK_FILE;
(file ? test.serial : test.skip)(
  'actual selected BYOK: one-submit Chinese custom design and screenshot repair',
  async t => {
    t.timeout(960000);
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
            title: 'Atlas 验证资料（全部虚构）',
            markdown:
              '# Atlas 原型验证\n以下全部为虚构测试材料，不涉及真实业务或个人。\n## 已完成\n2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。\n文档模块已经完成离线预览验证。\n同步模块已经完成断网重连验证。\n## 风险\n移动端长表格仍有溢出风险。\n中文字体回退还需要在 Linux 环境完成验证。\n## 下一步\n下一阶段计划修复剩余 3 项检查，然后再讨论发布。\n发布时间尚未确定，负责人未指定，不要补写。',
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
          length: process.env.LOCALMIND_REPORT_DESIGN_LONG ? 'long' : 'short',
          language: 'zh-CN',
          customStyle: process.env.LOCALMIND_REPORT_DESIGN_BOLDER
            ? '有强烈视觉冲击力的技术发布简报。沿用暖白、深墨绿和橙色，允许深墨绿大面积底色与橙色重点图形。首屏像数据海报，有鲜明主视觉、不对称构图、清晰字体对比；证据章用真正的图形编码呈现数量与状态。各章有构图和明暗节奏，避免每章都是大标题加段落，避免散乱装饰。'
            : '现代编辑式技术简报。暖白与墨绿为主，橙色只突出待决事项。大标题、清晰留白、非卡片堆砌。',
          instructions:
            '用清晰的证据图解区分已完成、风险和下一步，不虚构指标、负责人或截止日期。' +
            (process.env.LOCALMIND_REPORT_DESIGN_LONG
              ? '本次验证输出恰好 8 个章节。'
              : ''),
        }),
      });
      assert('deck' in result && result.deck);
      const runtime = app.get(PromptRuntime);
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
      const directory =
        (process.env.LOCALMIND_REPORT_DESIGN_BOLDER
          ? '/workspace/.codex-artifacts/report-custom-v31/'
          : '/workspace/.codex-artifacts/report-custom-v3/') +
        (process.env.LOCALMIND_REPORT_DESIGN_PROBE_ONLY ? 'probe' : 'live') +
        (process.env.LOCALMIND_REPORT_DESIGN_LONG ? '-long' : '');
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
      const accepted = run.artifacts.find(
        a =>
          a.key.startsWith('candidate-') &&
          a.inputHash ===
            (row.quality as { artifactHash?: string } | null)?.artifactHash
      );
      t.truthy(accepted);
      if (accepted) {
        const claims = JSON.parse(gunzipSync(accepted.payload).toString())
          .artifact.chapters.flatMap(
            (ch: { claims: Array<{ text: string }> }) =>
              ch.claims.map(c => c.text)
          )
          .join(' ');
        t.true(
          claims.includes('12'),
          'The grounded quantitative result must remain visible in the accepted artifact'
        );
      }
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
