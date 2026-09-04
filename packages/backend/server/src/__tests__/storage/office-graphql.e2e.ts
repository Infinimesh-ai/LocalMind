import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  createOfficeCommentMutation,
  createOfficeCommentReplyMutation,
  deleteOfficeCommentMutation,
  deleteOfficeCommentReplyMutation,
  officeCollaboratorsQuery,
  officeCommentsQuery,
  resolveOfficeCommentMutation,
  updateOfficeCommentMutation,
  updateOfficeCommentReplyMutation,
} from '@affine/graphql';
import {
  type DocxParagraph,
  type DocxSemanticState,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import test from 'ava';

import { Mockers } from '../mocks';
import { createTestingApp, TestingApp } from '../utils';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let app: TestingApp;

test.before(async () => {
  app = await createTestingApp();
});

test.beforeEach(async () => {
  await app.initTestingDB();
  app.clearAuth();
});

test.after.always(async () => {
  await app.close();
});

function firstEditableParagraph(state: DocxSemanticState) {
  const queue = [...state.body];
  while (queue.length) {
    const block = queue.shift();
    if (block?.type === 'paragraph' && block.text.length >= 4) return block;
    if (block?.type === 'contentControl') queue.unshift(...block.blocks);
    if (block?.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) queue.unshift(...cell.blocks);
      }
    }
  }
  throw new Error('fixture has no editable paragraph');
}

test.serial(
  'uploads, imports, previews, edits, queries, and downloads native DOCX revisions',
  async t => {
    const owner = await app.signupV1(`office-owner-${randomUUID()}@affine.pro`);
    const workspace = await app.create(Mockers.Workspace, {
      owner: { id: owner.id },
      name: 'Office GraphQL test',
    });
    const sourceBytes = await readFile(
      new URL(
        '../../../../../common/native/fixtures/demo.docx',
        import.meta.url
      )
    );
    const sourceKey = `office-e2e-${randomUUID()}.docx`;
    const uploaded = await app
      .POST('/graphql')
      .field(
        'operations',
        JSON.stringify({
          name: 'setBlob',
          query: `mutation setBlob($workspaceId: String!, $blob: Upload!) {
            setBlob(workspaceId: $workspaceId, blob: $blob)
          }`,
          variables: { workspaceId: workspace.id, blob: null },
        })
      )
      .field('map', JSON.stringify({ '0': ['variables.blob'] }))
      .attach('0', sourceBytes, {
        filename: sourceKey,
        contentType: DOCX_MIME,
      })
      .expect(200);
    t.deepEqual(uploaded.body.errors, undefined);
    t.is(uploaded.body.data.setBlob, sourceKey);

    const imported = await app.gql<{
      importOfficeDocx: {
        created: boolean;
        artifact: {
          id: string;
          revisionCounter: number;
          currentRevision: {
            id: string;
            stateUrl: string;
            packageUrl: string;
          };
        };
      };
    }>(
      `
      mutation importOfficeDocx($input: ImportOfficeDocxRequestInput!) {
        importOfficeDocx(input: $input) {
          created
          artifact {
            id
            revisionCounter
            currentRevision { id stateUrl packageUrl }
          }
        }
      }
    `,
      {
        input: {
          workspaceId: workspace.id,
          sourceBlobKey: sourceKey,
          title: 'Native DOCX fixture',
          sourceFileName: 'fixture.docx',
          idempotencyKey: `import-${randomUUID()}`,
        },
      }
    );
    const artifact = imported.importOfficeDocx.artifact;
    t.true(imported.importOfficeDocx.created);
    t.is(artifact.revisionCounter, 1);

    const stateResponse = await app
      .GET(new URL(artifact.currentRevision.stateUrl).pathname)
      .expect(200);
    const state = JSON.parse(stateResponse.text) as DocxSemanticState;
    const paragraph = firstEditableParagraph(state);

    const emptyComments = await app.gql({
      query: officeCommentsQuery,
      variables: { workspaceId: workspace.id, artifactId: artifact.id },
    });
    t.deepEqual(emptyComments.officeComments, []);
    const collaborators = await app.gql({
      query: officeCollaboratorsQuery,
      variables: { workspaceId: workspace.id, artifactId: artifact.id },
    });
    t.true(
      collaborators.officeCollaborators.some(user => user.id === owner.id)
    );

    const commentContent = {
      version: 'localmind-office-comment/v1',
      text: 'Review this paragraph.',
      anchor: {
        kind: 'document',
        revisionId: artifact.currentRevision.id,
        start: { blockId: paragraph.id, offset: 0 },
        end: { blockId: paragraph.id, offset: 4 },
      },
    };
    const createdComment = await app.gql({
      query: createOfficeCommentMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          artifactId: artifact.id,
          content: commentContent,
        },
      },
    });
    const commentId = createdComment.createOfficeComment.id;
    t.is(createdComment.createOfficeComment.content.text, commentContent.text);

    const updatedComment = await app.gql({
      query: updateOfficeCommentMutation,
      variables: {
        input: {
          id: commentId,
          content: { ...commentContent, text: 'Updated review note.' },
        },
      },
    });
    t.is(
      updatedComment.updateOfficeComment.content.text,
      'Updated review note.'
    );
    const resolvedComment = await app.gql({
      query: resolveOfficeCommentMutation,
      variables: { input: { id: commentId, resolved: true } },
    });
    t.true(resolvedComment.resolveOfficeComment.resolved);

    const createdReply = await app.gql({
      query: createOfficeCommentReplyMutation,
      variables: {
        input: {
          commentId,
          content: {
            version: 'localmind-office-comment-reply/v1',
            text: 'Reply from generated operation.',
          },
        },
      },
    });
    const replyId = createdReply.createOfficeCommentReply.id;
    const updatedReply = await app.gql({
      query: updateOfficeCommentReplyMutation,
      variables: {
        input: {
          id: replyId,
          content: {
            version: 'localmind-office-comment-reply/v1',
            text: 'Updated reply.',
          },
        },
      },
    });
    t.is(updatedReply.updateOfficeCommentReply.content.text, 'Updated reply.');
    const listedComments = await app.gql({
      query: officeCommentsQuery,
      variables: { workspaceId: workspace.id, artifactId: artifact.id },
    });
    t.is(listedComments.officeComments.length, 1);
    t.is(listedComments.officeComments[0].replies.length, 1);
    const deletedReply = await app.gql({
      query: deleteOfficeCommentReplyMutation,
      variables: { id: replyId },
    });
    t.true(deletedReply.deleteOfficeCommentReply);
    const deletedComment = await app.gql({
      query: deleteOfficeCommentMutation,
      variables: { id: commentId },
    });
    t.true(deletedComment.deleteOfficeComment);

    const command = {
      version: 'localmind-office-command/v1',
      commandId: `command-${randomUUID()}`,
      idempotencyKey: `command-${randomUUID()}`,
      artifactId: artifact.id,
      expectedRevisionId: artifact.currentRevision.id,
      source: 'user',
      operation: 'office.document.text.format',
      target: {
        type: 'text_range',
        start: { blockId: paragraph.id, offset: 0 },
        end: { blockId: paragraph.id, offset: 4 },
      },
      format: {
        fontSizePt: 14,
        textColor: '#0000FF',
        italic: true,
        underline: { style: 'wavy', color: '#FF0000' },
      },
    };

    const previewed = await app.gql<{
      previewOfficeDocxCommand: {
        expectedRevisionId: string;
        packageFingerprint: string;
        summary: { changedRuns: number };
      };
    }>(
      `
      query previewOfficeDocxCommand($input: OfficeDocxCommandInput!) {
        previewOfficeDocxCommand(input: $input) {
          expectedRevisionId
          packageFingerprint
          summary
        }
      }
    `,
      { input: { workspaceId: workspace.id, command } }
    );
    t.is(
      previewed.previewOfficeDocxCommand.expectedRevisionId,
      artifact.currentRevision.id
    );
    t.regex(
      previewed.previewOfficeDocxCommand.packageFingerprint,
      /^sha256:[0-9a-f]{64}$/
    );
    t.true(previewed.previewOfficeDocxCommand.summary.changedRuns > 0);

    const executed = await app.gql<{
      executeOfficeDocxCommand: {
        created: boolean;
        artifact: { revisionCounter: number };
        revision: {
          id: string;
          sequence: number;
          packageUrl: string;
          stateUrl: string;
        };
      };
    }>(
      `
      mutation executeOfficeDocxCommand($input: OfficeDocxCommandInput!) {
        executeOfficeDocxCommand(input: $input) {
          created
          artifact { revisionCounter }
          revision { id sequence packageUrl stateUrl }
        }
      }
    `,
      { input: { workspaceId: workspace.id, command } }
    );
    const revision = executed.executeOfficeDocxCommand.revision;
    t.true(executed.executeOfficeDocxCommand.created);
    t.is(executed.executeOfficeDocxCommand.artifact.revisionCounter, 2);
    t.is(revision.sequence, 2);

    const packageResponse = await app
      .GET(new URL(revision.packageUrl).pathname)
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
        response.on('error', callback);
      })
      .expect(200);
    const reopened = readDocxSemanticState(
      openDocxPackage(packageResponse.body)
    );
    const reopenedParagraph = firstEditableParagraph(reopened) as DocxParagraph;
    t.is(reopenedParagraph.text, paragraph.text);
    t.true(reopenedParagraph.runs.some(run => run.format?.italic));
    t.true(
      reopenedParagraph.runs.some(
        run =>
          run.format?.fontSizePt === 14 &&
          run.format.color === '#0000FF' &&
          run.format.underline !== false &&
          run.format.underline?.style === 'wavy' &&
          run.format.underline.color === '#FF0000'
      )
    );

    const listed = await app.gql<{
      officeArtifacts: Array<{
        id: string;
        revisionCounter: number;
        currentRevision: { id: string };
      }>;
    }>(`
    query {
      officeArtifacts(workspaceId: "${workspace.id}") {
        id
        revisionCounter
        currentRevision { id }
      }
    }
  `);
    t.is(listed.officeArtifacts.length, 1);
    t.is(listed.officeArtifacts[0].id, artifact.id);
    t.is(listed.officeArtifacts[0].currentRevision.id, revision.id);

    const compared = await app.gql<{
      officeRevisionCompare: {
        artifactId: string;
        changed: boolean;
        truncated: boolean;
        beforeRevision: { id: string; sequence: number };
        afterRevision: { id: string; sequence: number };
        changes: Array<{ entity: string; change: string }>;
      };
    }>(
      `
      query officeRevisionCompare(
        $workspaceId: String!
        $artifactId: String!
        $beforeRevisionId: String!
        $afterRevisionId: String!
      ) {
        officeRevisionCompare(
          workspaceId: $workspaceId
          artifactId: $artifactId
          beforeRevisionId: $beforeRevisionId
          afterRevisionId: $afterRevisionId
        ) {
          artifactId
          changed
          truncated
          beforeRevision { id sequence }
          afterRevision { id sequence }
          changes
        }
      }
    `,
      {
        workspaceId: workspace.id,
        artifactId: artifact.id,
        beforeRevisionId: artifact.currentRevision.id,
        afterRevisionId: revision.id,
      }
    );
    t.is(compared.officeRevisionCompare.artifactId, artifact.id);
    t.true(compared.officeRevisionCompare.changed);
    t.false(compared.officeRevisionCompare.truncated);
    t.is(compared.officeRevisionCompare.beforeRevision.sequence, 1);
    t.is(compared.officeRevisionCompare.afterRevision.sequence, 2);
    t.true(compared.officeRevisionCompare.changes.length > 0);

    await app.signupV1(`office-outsider-${randomUUID()}@affine.pro`);
    await t.throwsAsync(
      app.gql(`
      query {
        officeArtifact(workspaceId: "${workspace.id}", artifactId: "${artifact.id}") {
          id
        }
      }
    `)
    );
  }
);
