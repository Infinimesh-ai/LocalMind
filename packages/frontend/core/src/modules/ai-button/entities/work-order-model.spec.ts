/**
 * @vitest-environment happy-dom
 */
import { copilotWorkOrderChatGetQuery } from '@affine/graphql';
import { Framework } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { GraphQLService } from '../../cloud';
import { WorkOrderAIModel } from './work-order-model';

const entities: WorkOrderAIModel[] = [];

function create(
  gql = vi.fn().mockResolvedValue({
    currentUser: {
      copilot: {
        myWorkOrderAiModel: {
          configured: true,
          modelId: 'global-project-model',
          provider: 'openai',
        },
      },
    },
  })
) {
  const framework = new Framework();
  framework
    .service(GraphQLService, { gql } as unknown as GraphQLService)
    .entity(WorkOrderAIModel, [GraphQLService]);
  const entity = framework
    .provider()
    .createEntity(WorkOrderAIModel, { workOrderId: 'work-order-a' });
  entities.push(entity);
  return { entity, gql };
}

afterEach(() => {
  entities.splice(0).forEach(entity => entity.dispose());
});

test('work-order model selection uses only the global Project BYOK model', async () => {
  const { entity, gql } = create();
  await vi.waitFor(() =>
    expect(entity.modelId.value).toBe('global-project-model')
  );
  expect(gql).toHaveBeenCalledWith({
    query: copilotWorkOrderChatGetQuery,
    variables: { workOrderId: 'work-order-a' },
  });
  expect(entity.models.value).toEqual([
    expect.objectContaining({
      id: 'global-project-model',
      providerSource: 'byok_project_global',
      isDefault: true,
    }),
  ]);
});

test('missing or rejected configuration exposes no fallback model', async () => {
  const missing = create(
    vi.fn().mockResolvedValue({
      currentUser: {
        copilot: {
          myWorkOrderAiModel: {
            configured: false,
            modelId: null,
            provider: null,
          },
        },
      },
    })
  );
  await vi.waitFor(() =>
    expect(missing.entity.configuration.value).toBe('missing')
  );
  expect(missing.entity.models.value).toEqual([]);

  const denied = create(vi.fn().mockRejectedValue(new Error('revoked')));
  await vi.waitFor(() =>
    expect(denied.entity.configuration.value).toBe('error')
  );
  expect(denied.entity.models.value).toEqual([]);
});
