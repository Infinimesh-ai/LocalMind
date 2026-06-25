# Repair Recommendation And Execution Contracts

Archived from the former docs/ai-capability-modernization-plan.md.
Use docs/ai-modernization/README.md as the active planning entrypoint.
The archived body below may still mention former entrypoint paths; those
references are historical only.

---
## 225. P1 落地记录：Repair Recommendation Instance Key

本轮继续收敛第 224 节剩余风险中 “同一 action/step 下多条 unhealthy routes 目前会按 category/code/target 去重为一条 recommendation”。实际代码与目标架构的冲突点是：
`repairRecommendations` 已经能把 action dry-run provider health 风险显示给 Admin；但去重 key 只有 category/code/target，导致同一个 action prompt、同一个 step 下多个 unhealthy fallback provider route 会被压成一条建议，后续 Admin repair mutation、provider probe 面板和 Agent Runtime run/step trace 无法稳定定位每个具体 route。本轮新增可选 `instanceKey`，让 recommendation 可以在不改变 target 语义的前提下表达 route/provider 级实例。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增可选 `instanceKey`。
  - recommendation 去重 key 从 `category/code/target` 扩展为 `category/code/target/instanceKey`；未提供 instanceKey 的既有建议保持原行为。
  - action dry-run provider health recommendation 增加 route 级 `instanceKey=<actionId-or-feature>:<stepId>:<providerId>:<routeIndex>`。
  - provider health evidence 增加 `routeIndex` 与 `fallbackOrderIndex`，便于 Admin 和后续修复入口定位具体 fallback route。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `instanceKey` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `instance <instanceKey>`，可复制 diagnostics 和页面 recommendation 文本都能保留实例定位。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 将 action dry-run mismatch 场景扩展为两个 unhealthy provider routes，断言两个 `action_generate_provider_health_not_healthy` recommendations 都被保留，并且 instanceKey 分别指向 local/cloud route。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 断言 Admin diagnostics 展示 action provider health recommendation 的 instanceKey、routeIndex 与 fallbackOrderIndex。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “目标级建议” 推进到 “目标级建议 + 可选实例定位”，为后续 provider probe、Admin repair mutation、Model Registry DB row/revision/scope 和 Agent Runtime route-level diagnostics 提供更稳定的实例 key。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `instanceKey` 仍是运行时派生字符串，不是持久化 provider probe id、Model Registry row id 或 action run step id；后续 DB 化后需要补充稳定实体引用。
- 当前只有 action dry-run provider health recommendation 使用 route 级 instanceKey；其他 recommendation 仍按 category/code/target 去重。
- `instanceKey` 是只读 diagnostics contract，不会自动执行修复，也不会影响 Prompt Registry publish blocker。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 226. P1 落地记录：Action Route Recommendation Instance Coverage

本轮继续收敛第 225 节剩余风险中 “当前只有 action dry-run provider health recommendation 使用 route 级 instanceKey”。实际代码与目标架构的冲突点是：
`repairRecommendations.instanceKey` 已经能定位 action dry-run provider health 的具体 route；但 action dry-run failed/skipped 和 route count mismatch 仍没有 instanceKey，导致 Admin diagnostics、后续 repair mutation 和 Agent Runtime trace 面板在同一 action prompt 下无法用统一方式锚定 action-level 或 step-level 建议。本轮把 action route 类建议的 instanceKey 覆盖从 provider health route 级扩展到 dry-run status 级和 route-count step 级。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `actionDryRunRepairInstancePrefix()`，统一使用 `actionId ?? featureKind` 作为 action route recommendation instance 前缀。
  - `action_route_dry_run_failed/skipped` 增加 `instanceKey=<action-or-feature>:dry-run:<status>`。
  - `${featureKind}_${stepId}_route_count_mismatch` 增加 `instanceKey=<action-or-feature>:<stepId>:route-count-mismatch`。
  - provider health recommendation 复用同一前缀，保持 route 级 `instanceKey=<action-or-feature>:<stepId>:<providerId>:<routeIndex>`。
- `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts`：
  - 断言 route count mismatch recommendation 的 `instanceKey`。
  - 断言 dry-run failed recommendation 的 `instanceKey`。
- `packages/frontend/admin/src/modules/ai/index.spec.tsx`：
  - 更新 failed action dry-run fixture 和 diagnostics 断言，确保 Admin 可复制文本显示 `make-it-real:dry-run:failed`。

该实现不新增 GraphQL 字段、DB migration 或 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 action route repair recommendations 从 “部分实例化” 推进到 “dry-run status / step route count / provider health 都有实例 key”，为后续 Admin repair mutation、Agent Runtime step trace 和 provider probe 面板提供一致的定位约定。

验证策略：

- 本轮为 TypeScript/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 字段或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `instanceKey` 仍是运行时派生字符串，不是持久化 provider probe id、Model Registry row id 或 action run step id；后续 DB 化后需要补充稳定实体引用。
- 非 action-route categories 仍主要按 category/code/target 去重；如果后续 model/task/provider recommendation 也需要多实例定位，需要逐类设计 instance key。
- `instanceKey` 仍是只读 diagnostics contract，不会自动执行修复，也不会影响 Prompt Registry publish blocker。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 227. P1 落地记录：Model and Task Route Recommendation Instance Coverage

本轮继续收敛第 226 节剩余风险中 “非 action-route categories 仍主要按 category/code/target 去重”。实际代码与目标架构的冲突点是：
`repairRecommendations.instanceKey` 已经覆盖 action route 的 dry-run status、step route count 与 provider health，但 model route、provider health 和 embedding/rerank task route 的建议仍缺少实例定位。对于同一 prompt 下多个 optional/pro/registry 候选、同一 provider profile target 下多个候选 health 风险、或同一 task config 下 diagnostics/unavailable/dimension/policy 多类问题，Admin 后续 repair mutation、provider probe 面板和 Model Registry DB 化前的只读诊断都需要更稳定的实例 key。本轮把 instance key 覆盖扩展到 model/task/provider route recommendation。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `modelRouteRepairInstanceKey()`，使用 `featureKind:outputType:candidateKind:candidateIndex:requestedModelId` 定位 prompt model candidate 实例。
  - `*_model_route_unavailable`、`${featureKind}_provider_policy_blocks_route` 与 `selected_provider_health_not_healthy` 增加 model route instance key。
  - 新增 `taskRouteRepairInstanceKey()`，使用 `featureKind:requestedModelConfigKey:requestedModelId:<suffix>` 定位 task route diagnostics/unavailable/dimension/policy 实例。
  - task route diagnostics error、task route unavailable、embedding dimension mismatch 与 task policy blocked recommendation 增加 task route instance key。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - repair recommendation 列表 React key 纳入 `instanceKey`，避免同一 category/code/target 下多实例建议在 UI 层继续共用不稳定 key。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 optional model route、selected provider health、rerank task unavailable、default model route diagnostics 与 workspace indexing diagnostics error 的 instance key。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixture，断言可复制 diagnostics 文本展示 model route 和 task route instance key。

该实现不新增 GraphQL 字段、DB migration 或 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 action-route 局部实例化推进到 model route、provider health 与 task route 的实例级只读定位，为后续 Admin repair mutation、Model Registry row/revision/scope、provider probe freshness policy 和 Agent Runtime run/step trace 提供更一致的 contract。

验证策略：

- 本轮为 TypeScript/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 字段或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `instanceKey` 仍是运行时派生字符串，不是持久化 provider probe id、Model Registry row id、Prompt Registry revision id 或 action run step id；后续 DB 化后需要补充稳定实体引用。
- 旧客户端如果不查询 `instanceKey`，仍只能按 category/code/target 展示建议；正式 Admin repair mutation 需要把实例键、目标 locator 与权限/审计一起设计。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 314. P1 落地记录：Task Route Policy Candidate Provider Profile Evidence

本轮回到当前优先级中的自部署模型配置、前端模型列表与 embedding/rerank route diagnostics。实际代码与目标架构的冲突点是：
`models(promptName)` 的 embedding/rerank task route 已经能展示 route candidate、prepare candidate 与 prepared route 的 provider profile / configured model evidence，但 policy candidate 阶段仍只暴露 provider id/source/type/privacy/health/priority。管理员在 `/admin/ai` 看到 workspace indexing 或 rerank 被 route policy 拦截、provider unavailable 或 privacy 不允许时，仍需要跳到其它 candidate trace 才能定位具体的 `copilot.providers.profiles[...]` 配置来源和该 profile 声明了哪些模型。本轮把安全的 provider profile evidence 补到 task route policy candidate 诊断中，不读取或暴露 provider secret、baseURL、headers、BYOK token 或 native request payload。

- `packages/backend/server/src/plugins/copilot/providers/provider-registry.ts`：
  - `CopilotProviderRoutePolicyCandidateDiagnostics` 新增 `providerProfileId`、`providerProfileSource`、`providerProfileConfigPath`、`providerConfiguredModelIds` 与 `providerConfiguredModelCount`。
  - 新增共享 helper `providerProfileConfigPathHint()` 与 `getProfileModelIds()`，让 policy candidate 与 route/prepare candidate 使用一致的 provider profile 路径和 configured model id 归一化逻辑。
- `packages/backend/server/src/plugins/copilot/providers/factory.ts`：
  - 复用 provider registry 的共享 helper，避免 route candidate 与 policy candidate 对 provider profile evidence 的格式分叉。
- `packages/backend/server/src/plugins/copilot/resolver.ts`、`packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotTaskRoutePolicyCandidateDiagnosticsType` 与 `getPromptModels` 的 embedding/rerank `policyCandidates` selection 同步新增 provider profile/configured model evidence 字段。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelTaskRoutePolicyCandidate` 与 `AIModelTaskRoutePolicyCandidateTraceRow` 保留 provider profile evidence。
  - `getAIModelTaskRoutePolicyCandidateTrace()` 不再丢弃 `providerProfileConfigPath`、`providerProfileId`、`providerProfileSource`、`providerConfiguredModelIds` 与 `providerConfiguredModelCount`。
  - copyable task route diagnostics 的 `policy candidates ...` 文本新增 provider profile label，与 route candidate / prepare candidate 诊断展示口径对齐。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `/admin/ai` task route policy candidate 文本显示 provider profile label，管理员可直接从 policy 阶段定位 `workspace.byok.local`、`workspace.byok.server`、legacy provider 或 `copilot.providers.profiles[id=...]`。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/provider-registry.spec.ts` 断言 route policy candidate 返回 provider profile config path 与 configured model ids/count，且不改变 `resolveModel()` 的 route policy 输出。
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `models(promptName)` 的 workspace indexing policy candidate 带 provider profile id/config path 与 configured model evidence。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 断言 policy candidate trace row 与 copyable task route label 保留 provider profile evidence。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 断言 Admin route diagnostics 在 workspace indexing/rerank policy candidate 文本中显示 profile config 与 profile models。

该实现只扩展只读 diagnostics，不新增 DB migration，不新增 mutation，不改变 provider route selection、route policy allow/block 语义、fallback order、BYOK/quota gate、provider health 判定、embedding/rerank 执行路径、Prompt Registry publish gate、execution request contract 或 native dispatch。它把 task route policy 阶段从“只知道哪个 provider 被允许/阻止”推进到“知道该 provider 来自哪个 provider profile 配置和声明了哪些模型”，为后续 DB-backed Provider/Model Registry、Admin profile editor、route policy 修复建议和模型能力矩阵提供更完整的可观测输入。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、provider registry AVA、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- policy candidate evidence 仍来自当前内存中的 normalized provider profile，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- `providerConfiguredModelIds` 仍只来自 `profile.models + modelDefinitions[].id + aliases`，不包含 native registry 全量 fallback 或 provider runtime 动态发现模型。
- health、priority、privacy 与 source 仍是 resolver 当前快照，不代表实时 latency、quota、probe freshness、失败计数或 native runtime span。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 provider profile、route policy、task model config 或 modelDefinitions。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 228. P1 落地记录：Repair Recommendation Target Locator

本轮继续收敛第 227 节剩余风险中 “正式 Admin repair mutation 需要把实例键、目标 locator 与权限/审计一起设计”。实际代码与目标架构的冲突点是：
`repairRecommendations.instanceKey` 已经能区分同一 target 下的实例，但建议仍主要依赖字符串 `target` 和 evidence 文本；后续 Admin repair mutation、provider probe 面板、Model Registry DB 化和 Agent Runtime trace 如果继续反解析这些字符串，会把只读 diagnostics contract 和未来写入/审计 contract 耦合得过紧。本轮新增只读 `repairRecommendations.targetLocator`，为每条建议提供结构化目标定位，同时不引入 mutation、DB migration 或发布策略变更。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairTargetLocator` 与 GraphQL object type。
  - locator 统一包含 `kind/path/registryId/registryFingerprint/registryUpdatedAt`，并按建议来源补充 model route、task route、action route 和 provider profile 的可选字段。
  - prompt registry remediation/stale、model route unavailable、provider policy、provider health、task diagnostics/unavailable/dimension/policy、action dry-run failed/skipped、action route-count mismatch 和 action provider health recommendations 都会生成只读 target locator。
  - 不复用 `PromptRegistryValidationSourceLocator`，因为后者只适合 `ai_prompts_metadata/messages` 表；新 locator 可以表达 provider profile、task config、route policy 和 action dry-run step/route。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `targetLocator` selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `locator ...` 摘要，Admin 可复制 diagnostics 文本可以直接携带结构化定位信息。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、default route、task diagnostics 和 action provider health recommendations 的 target locator。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 locator 摘要。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “target string + instanceKey + evidence” 推进到 “target string + instanceKey + typed target locator + evidence”，为后续 Admin repair mutation、权限审计、Model Registry row/revision/scope 和 provider probe freshness policy 提供更稳定的只读前置 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `targetLocator` 仍是只读 diagnostics locator，不是 repair mutation 输入 contract；后续写入路径仍需要单独设计权限、审计、预览 diff、幂等性和回滚。
- locator 中的 registry version 信息来自当前 publish gate verdict，不是持久化 repair job snapshot；后续正式修复需要带 expected version 或 revision guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 229. P1 落地记录：Repair Recommendation Action Taxonomy

本轮继续收敛第 228 节剩余风险中 “`targetLocator` 仍是只读 diagnostics locator，不是 repair mutation 输入 contract”。实际代码与目标架构的冲突点是：
`repairRecommendations.targetLocator` 已经能结构化定位目标，但后续 Admin repair mutation、配置编辑入口、provider probe 和 Prompt Registry 修复流程仍需要根据“应该做什么动作”稳定分流。若只依赖 `code` 或 `suggestedAction` 文本，问题分类、UI 文案和可执行动作会继续耦合。本轮新增只读 `suggestedActionKind` 字符串 taxonomy，把 human-readable `suggestedAction` 和 machine-readable action kind 分离。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `suggestedActionKind`。
  - prompt registry remediation 使用 `registry_<kind>`，stale gate 使用 `refresh_publish_gate`。
  - model route 使用 `repair_default_model_route` / `review_non_default_model_route`，provider health 使用 `check_provider_health`，provider policy 使用 `relax_provider_route_policy`。
  - task route 使用 `inspect_task_route_diagnostics`、`repair_task_model_route`、`fix_embedding_dimensions` 与 `relax_task_route_policy`。
  - action route 使用 `review_action_route_dry_run`、`repair_action_fallback_route_coverage` 与 `check_action_provider_health`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `suggestedActionKind` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `action kind ...`，让复制 diagnostics 能同时包含问题 code、实例 key、target locator 和建议动作类型。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics 和 action provider health 的 action kind。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 action kind。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “code + target string + instanceKey + targetLocator + suggestedAction 文本” 推进到 “问题 code 与建议 action kind 分离”，为后续 Admin repair mutation、配置编辑入口、provider probe 和权限审计提供更稳定的只读 taxonomy。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `suggestedActionKind` 当前是字符串 taxonomy，不是 GraphQL enum；这是为了避免探索期过早固化枚举，但后续正式 repair mutation 需要收敛为版本化 action catalog。
- action kind 仍是只读建议，不代表当前系统已经能自动执行修复；后续写入路径仍需要权限、审计、预览 diff、幂等性、expected version guard 和回滚。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 230. P1 落地记录：Repair Action Catalog Version

本轮继续收敛第 229 节剩余风险中 “`suggestedActionKind` 当前是字符串 taxonomy，不是 GraphQL enum；后续正式 repair mutation 需要收敛为版本化 action catalog”。实际代码与目标架构的冲突点是：
`suggestedActionKind` 已经让 Admin 和后续修复入口不用解析 `suggestedAction` 文本，但它缺少版本标识。若后续 action kind 名称、语义、输入参数或权限模型发生演进，旧客户端和新的 repair mutation 无法判断当前 diagnostics 属于哪一版 action catalog。本轮新增只读 `suggestedActionCatalogVersion`，先把 repair action taxonomy 版本写入 publish gate recommendation contract。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `COPILOT_PROMPT_REGISTRY_REPAIR_ACTION_CATALOG_VERSION = 'repair-actions/v1'`。
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `suggestedActionCatalogVersion`。
  - 在 `pushRecommendation()` 中统一注入 catalog version，避免每条 recommendation 手写版本导致漂移。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `suggestedActionCatalogVersion` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `action catalog repair-actions/v1`，让复制 diagnostics 同时包含 action taxonomy 版本和 action kind。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics 和 action provider health recommendation 都使用 `repair-actions/v1`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 action catalog version。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “action kind 字符串” 推进到 “action catalog version + action kind”，为后续 Admin repair mutation、配置编辑入口、provider probe 和权限审计提供更明确的兼容边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repair-actions/v1` 仍只是只读 diagnostics catalog version，不是正式 repair mutation capability registry；后续写入路径仍需要定义输入 schema、权限、审计、预览 diff、幂等性、expected version guard 和回滚。
- 当前 catalog version 是单一全局版本；如果后续不同 action kind 独立演进，可能需要 per-action version 或 capability flags。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 231. P1 落地记录：Repair Action Safety Contract

本轮继续收敛第 230 节剩余风险中 “`repair-actions/v1` 仍只是只读 diagnostics catalog version，不是正式 repair mutation capability registry”。实际代码与目标架构的冲突点是：
`suggestedActionCatalogVersion` 与 `suggestedActionKind` 已经能稳定标识建议动作，但后续 Admin repair mutation、provider probe、配置编辑入口和 Agent Runtime 审批仍需要知道动作的执行安全边界。若客户端只能按 action kind 自行硬编码判断，会把安全策略散落在 UI、mutation 和后续 runtime 里。本轮新增只读 `suggestedActionSafety`，由后端集中从 action kind 派生，先把安全语义纳入 publish gate recommendation contract。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `suggestedActionSafety`。
  - 新增 `promptRegistryRepairActionSafety()`，把 action kind 映射为 `read_only_probe`、`read_only_refresh`、`preview_required`、`dry_run_required` 或 `manual_review_required`。
  - 在 `pushRecommendation()` 中统一注入 safety，避免每条 recommendation 手写安全语义导致漂移。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `suggestedActionSafety` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `action safety ...`，让复制 diagnostics 同时包含 action catalog、action kind 和安全语义。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics、task diagnostics probe 和 action provider health recommendation 的 safety。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 action safety。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “action catalog version + action kind” 推进到 “action catalog version + action kind + safety”，为后续 Admin repair mutation、provider probe、预览 diff、审批与审计提供更清晰的只读前置 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `suggestedActionSafety` 仍是只读 diagnostics safety hint，不是权限系统、可执行 mutation、审批策略或审计事件；正式修复路径仍需要单独实现 mutation、preview diff、expected version guard、idempotency 和 rollback。
- safety 映射当前由 action kind 派生，尚未成为可配置 action catalog；后续如果 action kind 输入 schema、权限或执行模式演进，需要把 safety 与 action catalog 同步版本化。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 232. P1 落地记录：Repair Action Required Capabilities

本轮继续收敛第 231 节剩余风险中 “`suggestedActionSafety` 仍是只读 diagnostics safety hint，不是权限系统、可执行 mutation、审批策略或审计事件”。实际代码与目标架构的冲突点是：
`suggestedActionSafety` 能表达动作执行风险级别，但后续 Admin repair mutation、provider probe、Prompt Registry 预览写入、Model Registry route preview 和 Agent Runtime 审批仍需要知道建议动作依赖哪些平台能力。如果客户端继续从 action kind 或 safety 文本反推能力，会把权限、预览和 probe 分流逻辑散落在 UI 与未来 mutation 中。本轮新增只读 `suggestedActionRequiredCapabilities`，由后端集中从 action kind 派生，先把 capability hint 纳入 publish gate recommendation contract。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `suggestedActionRequiredCapabilities: string[]`。
  - 新增 `promptRegistryRepairActionRequiredCapabilities()`，把 action kind 映射到 `prompt_registry.preview_write`、`provider_health.probe`、`provider_route.preview`、`action_route.dry_run`、`embedding_index.migration_review` 等只读 capability hints。
  - 在 `pushRecommendation()` 中统一注入 required capabilities，避免 Admin 和后续 mutation 反解析 action kind。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `suggestedActionRequiredCapabilities` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `required capabilities ...`，让复制 diagnostics 同时包含 action catalog、kind、safety 和 capability hints。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics、task diagnostics probe 和 action provider health recommendation 的 required capabilities。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 required capabilities。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “action catalog version + action kind + safety” 推进到 “action catalog version + action kind + safety + required capabilities”，为后续 Admin repair mutation、权限检查、provider probe、预览 diff、审批与审计提供更明确的只读前置 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `suggestedActionRequiredCapabilities` 仍是只读 diagnostics capability hint，不是权限校验、授权策略或可执行 action capability registry；正式修复路径仍需要把这些 hints 接入权限、审计、预览 diff、expected version guard、idempotency 和 rollback。
- capability 映射当前由 action kind 派生，尚未成为可配置 action catalog；后续如果 action kind 输入 schema、权限或执行模式演进，需要把 capabilities 与 action catalog 同步版本化。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 233. P1 落地记录：Repair Recommendation Diagnostics Fingerprint

本轮继续收敛第 232 节剩余风险中 “`suggestedActionRequiredCapabilities` 仍是只读 diagnostics capability hint，不是权限校验、授权策略或可执行 action capability registry”。实际代码与目标架构的冲突点是：
repair recommendation 已经包含 action catalog、action kind、safety、required capabilities、target locator 和 evidence，但后续 Admin repair mutation、expected-version guard、审计事件或 Agent Runtime trace 仍需要一个稳定的诊断快照标识。如果继续用 category/code/target/instanceKey 或 evidence 文本拼接，客户端和未来写入路径都会重新实现不一致的 hash 逻辑。本轮新增只读 `diagnosticsFingerprint`，由后端基于 recommendation 的 action/target/evidence/locator/capability 快照集中派生。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `diagnosticsFingerprint`。
  - 新增稳定 stringify 与 `promptRegistryRepairRecommendationFingerprint()`，使用 16 位 SHA-256 摘要绑定 category/code/target/instanceKey、action catalog、action kind、safety、required capabilities、evidence 和 target locator。
  - 在 `pushRecommendation()` 中先统一注入 catalog/safety/capabilities，再派生 diagnostics fingerprint，避免客户端重复计算。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `diagnosticsFingerprint` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `fingerprint ...`，让复制 diagnostics 能直接携带 recommendation 快照标识。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics、task diagnostics probe 和 action provider health recommendation 的 fingerprint 为 16 位 hex，并覆盖同一 gate 内 fingerprint 不重复。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 fingerprint。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “action catalog version + action kind + safety + required capabilities” 推进到 “可被 expected-version guard 和审计引用的只读 diagnostics snapshot”，为后续 Admin repair mutation、预览 diff、审批与 Agent Runtime trace 提供更稳定的前置 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `diagnosticsFingerprint` 仍是当前 resolver 调用派生的只读快照标识，不是持久化 repair job id、audit event id 或 provider probe id；正式修复路径仍需要 expected version guard、权限、审计、预览 diff、idempotency 和 rollback。
- fingerprint 当前只覆盖 recommendation contract 的诊断快照，不覆盖未来 mutation 输入 schema 或 DB revision；后续如果 action catalog 输入 schema 独立演进，需要把 schema version 纳入 fingerprint 或 expected-version guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 234. P1 落地记录：Repair Action Input Schema Preview

本轮继续收敛第 233 节剩余风险中 “fingerprint 当前只覆盖 recommendation contract 的诊断快照，不覆盖未来 mutation 输入 schema 或 DB revision”。实际代码与目标架构的冲突点是：
repair recommendation 已经能暴露 action catalog、kind、safety、required capabilities 和 diagnostics fingerprint，但未来 Admin repair mutation 仍需要明确每类建议动作的输入形态。若等到写入 mutation 才定义输入 schema，Admin diagnostics、preview diff、expected-version guard 和 Agent Runtime 审批会继续依赖隐含约定。本轮新增只读 `suggestedActionInputSchema`，以 JSON Schema 风格预告 repair action 输入契约，同时仍不提供任何写入入口。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairRecommendation`，新增必填 `suggestedActionInputSchema`。
  - 新增 `promptRegistryRepairActionInputSchema()`，为 provider health probe、publish gate refresh、action dry-run、embedding dimension review 与 preview-only repair 生成只读 JSON schema。
  - fingerprint payload 纳入 `suggestedActionInputSchema`，使 action input schema 变化会改变 recommendation diagnostics snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `suggestedActionInputSchema` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 显示 `input schema required ...` 摘要，避免复制 diagnostics 依赖整段 JSON。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route、provider health、task route、default route diagnostics、task diagnostics probe 和 action provider health recommendation 的 input schema required 字段。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 model/task/action repair recommendation diagnostics 文本显示 input schema 摘要。

该实现新增 GraphQL JSON 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair recommendation 从 “可被 expected-version guard 和审计引用的只读 diagnostics snapshot” 推进到 “带只读输入 schema 预告的 repair action catalog contract”，为后续 Admin repair mutation、预览 diff、权限校验与 Agent Runtime 审批提供更明确的前置契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `suggestedActionInputSchema` 仍是只读 schema preview，不是正式 mutation 输入类型、权限校验或执行 contract；正式修复路径仍需要 expected version guard、权限、审计、预览 diff、idempotency 和 rollback。
- schema 当前是 JSON object，不是 GraphQL input type 或版本化 action catalog 实体；后续如果 action kind 输入 schema 独立演进，需要将 schema version 与 action catalog version 显式拆分。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 235. P1 落地记录：Publish Gate Repair Action Catalog Snapshot

本轮继续收敛第 234 节剩余风险中 “schema 当前是 JSON object，不是 GraphQL input type 或版本化 action catalog 实体”。实际代码与目标架构的冲突点是：
每条 `repairRecommendations` 已携带 action catalog、kind、safety、capabilities 和 input schema，但 Admin、后续 repair mutation 入口、权限检查或 Agent Runtime 审批如果想知道“当前 publish gate 需要哪些 repair action”，仍要扫描所有 recommendations 并自行去重。本轮新增只读 `repairActionCatalog`，在 publish gate verdict 顶层暴露由 recommendations 派生的去重 action catalog snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairActionCatalogEntry` 与 GraphQL object type。
  - 新增 `buildPromptRegistryPublishGateRepairActionCatalog()`，按 `catalogVersion + actionKind` 去重，保留 safety、required capabilities、input schema 和 recommendation count。
  - `toPromptRegistryPublishGateVerdictWithRepairRecommendations()` 先构建 recommendations，再派生 `repairActionCatalog`，确保二者语义一致。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `repairActionCatalog` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 新增 `Repair action catalog ...` 和 catalog entry 摘要，展示 action kind、catalog version、safety、recommendation count、required capabilities 和 input schema。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 gate 级 repair action catalog 的去重条目、capabilities、safety、count 和 input schema。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 diagnostics 文本显示 action catalog snapshot。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair action 信息从“每条 recommendation 重复携带”推进到“publish gate 顶层只读 action catalog snapshot”，为后续 Admin repair mutation、权限预检、批量预览 diff 与 Agent Runtime 审批提供更稳定的入口。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repairActionCatalog` 仍是由当前 recommendations 派生的只读 snapshot，不是持久化 action catalog registry、权限系统或可执行 mutation registry；正式修复路径仍需要 expected version guard、权限、审计、预览 diff、idempotency 和 rollback。
- catalog entry 的 input schema 仍是 JSON object，不是 GraphQL input type 或 DB 中可版本化的 action schema；后续如果 action kind 输入 schema独立演进，需要拆分 schema version 与 catalog version。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 236. P1 落地记录：Repair Action Catalog Snapshot Fingerprint

本轮继续收敛第 235 节剩余风险中 “`repairActionCatalog` 仍是由当前 recommendations 派生的只读 snapshot，不是持久化 action catalog registry、权限系统或可执行 mutation registry”。实际代码与目标架构的冲突点是：
publish gate 顶层已经暴露去重后的 `repairActionCatalog`，但后续 Admin repair mutation、权限预检、批量预览 diff、审计事件或 Agent Runtime 审批如果需要引用“整个动作目录快照”，仍要重新扫描 catalog entry 并自行计算版本标识。本轮新增只读 `repairActionCatalogFingerprint`，由后端对 catalog entries 的版本、action kind、safety、required capabilities、input schema 和 recommendation count 统一派生稳定 16 位 SHA-256 摘要。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryPublishGateVerdictType` 新增必填 `repairActionCatalogFingerprint`。
  - 新增 `promptRegistryPublishGateRepairActionCatalogFingerprint()`，对排序后的 catalog entries 生成稳定 fingerprint。
  - `toPromptRegistryPublishGateVerdictWithRepairRecommendations()` 先构建 recommendations，再派生 `repairActionCatalog` 与 `repairActionCatalogFingerprint`，确保 recommendation、catalog 和 fingerprint 来自同一快照。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `repairActionCatalogFingerprint` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 新增 `Repair action catalog fingerprint ...`，让 Admin diagnostics 可直接引用 gate 级 action catalog 快照。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 catalog fingerprint 为 16 位 hex，且同一 gate 重算时保持稳定。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate fixtures，断言 ready、blocked registry 与 action dry-run failed diagnostics 文本显示 catalog fingerprint。

该实现新增 GraphQL 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 publish gate repair catalog 从“可读 action catalog snapshot”推进到“可被缓存、expected-version guard、权限预检和审计引用的只读 catalog snapshot fingerprint”，为后续正式 repair mutation 和 Agent Runtime 审批提供更稳定的前置 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repairActionCatalogFingerprint` 仍是当前 resolver 调用派生的只读快照标识，不是持久化 action catalog id、repair job id、audit event id 或权限授权结果；正式修复路径仍需要 expected version guard、权限、审计、预览 diff、idempotency 和 rollback。
- fingerprint 当前覆盖 catalog entry 的 JSON schema preview，但 schema 仍不是 GraphQL input type 或 DB 中可版本化的 action schema；后续如果 action kind 输入 schema 独立演进，需要显式拆分 schema version 与 catalog version，并把 schema version 纳入 guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 237. P1 落地记录：Repair Action Mutation Guard Snapshot

本轮继续收敛第 236 节剩余风险中 “`repairActionCatalogFingerprint` 仍是当前 resolver 调用派生的只读快照标识，不是持久化 action catalog id、repair job id、audit event id 或权限授权结果”。实际代码与目标架构的冲突点是：
publish gate 已经能提供 recommendation fingerprint 与 catalog fingerprint，但未来 Admin repair mutation 或 Agent Runtime 审批仍需要一个单一 guard 对象来同时绑定 Prompt Registry expected version、repair action catalog fingerprint 和 recommendation fingerprint 列表。如果客户端自行组装这些字段，后续 expected-version guard、preview diff、权限预检和审计事件容易出现输入不一致。本轮新增只读 `repairActionMutationGuard`，由后端统一生成未来 mutation 可复用的 guard snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairActionMutationGuard` 与 GraphQL object type。
  - 新增 `buildPromptRegistryPublishGateRepairActionMutationGuard()`，聚合 `expectedRegistryId`、`expectedRegistryFingerprint`、`expectedRegistryUpdatedAt`、`catalogVersion`、`catalogFingerprint`、`recommendationFingerprints`、`recommendationCount` 与 `required`。
  - guard 自身新增 `guardFingerprint`，用 16 位 SHA-256 摘要绑定上述字段，确保后续 preview/mutation/audit 可以引用同一只读快照。
  - `toPromptRegistryPublishGateVerdictWithRepairRecommendations()` 在同一次 diagnostics 中派生 recommendations、catalog、catalog fingerprint 和 mutation guard，避免 Admin 或未来 mutation 入口重组 guard。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `repairActionMutationGuard` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 新增 `Repair action mutation guard ...`，展示 guard fingerprint、catalog fingerprint、expected registry version 与 recommendation fingerprints。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 guard 绑定 catalog fingerprint、registry expected version、recommendation fingerprint 列表和稳定 guard fingerprint。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 mutation guard snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 publish gate repair diagnostics 从“各字段可单独引用”推进到“后端生成的只读 mutation guard snapshot”，为后续正式 repair mutation、预览 diff、权限预检、审计和 Agent Runtime 审批提供更明确的 expected-version 输入契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repairActionMutationGuard` 仍是只读 diagnostics guard，不是可执行 mutation、权限授权、preview diff、audit event、repair job 或持久化 action catalog revision；正式修复路径仍需要单独实现 mutation、权限、审计、预览 diff、expected-version 校验、idempotency 和 rollback。
- guard 目前绑定的是当前 resolver 快照中的 recommendations 与 catalog schema preview；如果后续 repair action schema 独立版本化，需要将 schema version 与 catalog version 拆分并纳入 guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 238. P1 落地记录：Repair Action Mutation Guard Capability Snapshot

本轮继续收敛第 237 节剩余风险中 “`repairActionMutationGuard` 仍是只读 diagnostics guard，不是可执行 mutation、权限授权、preview diff、audit event、repair job 或持久化 action catalog revision”。实际代码与目标架构的冲突点是：
guard 已经绑定 registry expected version、catalog fingerprint 和 recommendation fingerprints，但后续权限预检、Admin repair mutation、Agent Runtime 审批或审计事件仍需要知道整个 guard 快照涉及哪些 required capabilities 和 safety levels。如果这些信息仍要从 recommendations 或 catalog entries 扫描出来，客户端与未来 mutation 入口会重复实现权限聚合逻辑。本轮在只读 `repairActionMutationGuard` 上新增聚合 `requiredCapabilities` 与 `safetyLevels`。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `requiredCapabilities: string[]` 与 `safetyLevels: string[]`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 从当前 recommendations 中聚合去重并排序的 capabilities 与 safety levels，并把二者纳入 `guardFingerprint` payload。
  - 这使 capability 或 safety contract 变化会改变 guard fingerprint，方便后续 expected-version guard、权限预检和审计引用。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 `requiredCapabilities` 与 `safetyLevels` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 `required capabilities ...` 与 `safety levels ...`。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 guard 聚合的 capabilities 与 safety levels。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 guard 级 capability/safety 聚合。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“版本与 recommendation 快照”推进到“包含权限能力与安全等级的只读 guard snapshot”，为后续正式 repair mutation、权限预检、审批、预览 diff 和审计提供更完整的输入契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `requiredCapabilities` 与 `safetyLevels` 仍是只读 guard 聚合，不是权限授权结果、审批策略或执行系统；正式修复路径仍需要单独实现 permission check、preview diff、mutation、audit、idempotency 和 rollback。
- capability/safety 聚合来自当前 resolver 快照中的 recommendations；如果后续引入持久化 action catalog registry，需要保证 registry version、schema version、capability version 与 guard fingerprint 一起演进。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 239. P1 落地记录：Repair Action Mutation Guard Review Modes

本轮继续收敛第 238 节剩余风险中 “`requiredCapabilities` 与 `safetyLevels` 仍是只读 guard 聚合，不是权限授权结果、审批策略或执行系统”。实际代码与目标架构的冲突点是：
guard 已经聚合 capabilities 和 safety levels，但后续 Admin repair mutation、preview diff、Agent Runtime 审批或审计事件仍需要知道“该 guard 需要走哪类 review 流程”：只读 probe、refresh、preview、dry-run 或人工 review。如果客户端继续从 safety 字符串自行推断 review mode，审批分流逻辑会再次散落在 UI 和未来 mutation 入口。本轮在只读 `repairActionMutationGuard` 上新增聚合 `requiredReviewModes`。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `requiredReviewModes: string[]`。
  - 新增 `promptRegistryRepairSafetyReviewMode()`，把 `read_only_probe`、`read_only_refresh`、`preview_required`、`dry_run_required` 与 `manual_review_required` 映射为 `probe`、`refresh`、`preview`、`dry_run` 与 `manual_review`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 从 guard safety levels 派生去重排序的 review modes，并把它纳入 `guardFingerprint` payload。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 `requiredReviewModes` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 `review modes ...`。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 ready gate 的 guard review modes 为 `preview` 与 `probe`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 `Preview`、`Probe`、`Dry Run` 等 review modes。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“权限能力与安全等级快照”推进到“包含审批分流模式的只读 guard snapshot”，为后续正式 repair mutation、preview diff、审批队列、Agent Runtime 审批与审计事件提供更直接的输入契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `requiredReviewModes` 仍是只读审批分流 hint，不是实际审批策略、权限授权、preview diff 或执行系统；正式修复路径仍需要单独实现 permission check、审批状态、preview mutation、audit、idempotency 和 rollback。
- review mode 映射当前由 safety level 派生，尚未成为持久化 action catalog registry 的版本化字段；后续引入正式 action catalog 时，需要把 safety、review mode、capability 和 schema version 一起版本化。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 240. P1 落地记录：Repair Action Mutation Guard Input Schema Fingerprint

本轮继续收敛第 239 节剩余风险中 “review mode 映射当前由 safety level 派生，尚未成为持久化 action catalog registry 的版本化字段”。实际代码与目标架构的冲突点是：
guard 已经绑定 catalog fingerprint、recommendation fingerprints、capabilities、safety levels 与 review modes，但后续 Admin repair mutation 或 preview diff 仍需要明确知道 guard 生成时使用的是哪一组 repair action input schema。如果只依赖 catalog fingerprint 或 recommendation fingerprint 间接覆盖 schema，未来 schema 独立版本化时不够直观。本轮在只读 `repairActionMutationGuard` 上新增 `inputSchemaFingerprint`，作为 action input schema snapshot 的显式标识。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `inputSchemaFingerprint: string`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 对当前 recommendations 的 `suggestedActionInputSchema` 做稳定 stringify、去重、排序，并生成 16 位 SHA-256 摘要。
  - `inputSchemaFingerprint` 纳入 `guardFingerprint` payload，使 input schema preview 变化会同步改变 guard snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 `inputSchemaFingerprint` GraphQL 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 `input schema fingerprint ...`。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 guard input schema fingerprint 为 16 位 hex。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 schema fingerprint。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“审批分流模式快照”推进到“显式绑定 action input schema 快照的只读 guard”，为后续正式 repair mutation、preview diff、expected-version 校验和审计事件提供更直接的 schema guard。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `inputSchemaFingerprint` 仍是只读 schema preview fingerprint，不是正式 GraphQL input type、DB schema registry、action catalog schema version 或 mutation validation；正式修复路径仍需要 schema versioning、preview mutation、permission check、audit、idempotency 和 rollback。
- schema fingerprint 当前来自 recommendations 中的 JSON schema preview；如果后续引入持久化 action catalog registry，需要将 schema version、catalog version、capability version 与 guard fingerprint 一起演进。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 241. P1 落地记录：Repair Action Mutation Guard Target Locator Snapshot

本轮继续收敛第 240 节剩余风险中 “`inputSchemaFingerprint` 仍是只读 schema preview fingerprint，不是正式 GraphQL input type、DB schema registry、action catalog schema version 或 mutation validation”。实际代码与目标架构的冲突点是：
guard 已经绑定 registry expected version、catalog、recommendation、capability、review mode 与 input schema，但未来 Admin repair preview/mutation、Agent Runtime 审批或审计事件仍需要明确知道本次 guard 覆盖的是哪组 repair target locator。如果只从 recommendation 列表重新扫描 target locator，客户端、mutation 入口和审计系统会重复实现 target set 归一化逻辑，也不利于后续 idempotency guard。本轮在只读 `repairActionMutationGuard` 上新增目标定位快照字段。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `targetLocatorFingerprint: string`、`targetLocatorCount: number` 与 `targetLocatorKinds: string[]`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 对 recommendations 中的 `targetLocator` 做稳定 stringify、去重和排序，生成 16 位 `targetLocatorFingerprint`，并统计唯一 locator 数量与 locator kind 集合。
  - `targetLocatorFingerprint`、`targetLocatorCount` 与 `targetLocatorKinds` 纳入 `guardFingerprint` payload，使 repair target set 变化会同步改变 guard snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 target locator snapshot 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 target locator fingerprint、locator count 与 locator kinds。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 target locator count、kinds、16 位 fingerprint 与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 target locator snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“schema 快照”推进到“显式绑定 repair target set 的只读 guard”，为后续正式 repair preview、expected-version 校验、idempotency、权限预检、Agent Runtime 审批和审计事件提供更完整的输入契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `targetLocatorFingerprint` 仍是只读 resolver 快照 fingerprint，不是持久化 repair target set id、mutation id、audit event id 或授权结果；正式修复路径仍需要 preview mutation、permission check、audit、idempotency 和 rollback。
- target locator snapshot 来自当前 recommendations 的 JSON object；如果后续引入持久化 action catalog registry 或 target locator schema version，需要将 locator schema version 与 catalog/schema/capability version 一起纳入 guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 242. P1 落地记录：Repair Action Mutation Guard Intent Snapshot

本轮继续收敛第 241 节剩余风险中 “`targetLocatorFingerprint` 仍是只读 resolver 快照 fingerprint，不是持久化 repair target set id、mutation id、audit event id 或授权结果”。实际代码与目标架构的冲突点是：
guard 已经绑定 target locator set、schema、catalog、capability 与 review mode，但未来 Admin repair mutation、Agent Runtime 审批队列或审计检索仍需要知道这组 guard 对应哪些 recommendation category、code 和 suggested action kind。如果这些语义索引只能从 recommendation 列表重新扫描，mutation 入口、审批 UI 和审计系统会重复实现 intent 聚合逻辑，也不利于后续对不同 repair action family 做权限分流。本轮在只读 `repairActionMutationGuard` 上新增语义意图快照字段。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `intentFingerprint: string`、`recommendationCategories: string[]`、`recommendationCodes: string[]` 与 `suggestedActionKinds: string[]`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 从当前 recommendations 中聚合去重排序的 category、code 与 suggested action kind，并生成 16 位 `intentFingerprint`。
  - `intentFingerprint`、categories、codes 与 action kinds 纳入 `guardFingerprint` payload，使 repair intent 变化会同步改变 guard snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 intent snapshot 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 intent fingerprint、recommendation categories、recommendation codes 与 suggested actions。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 guard 聚合的 categories、codes、action kinds、16 位 intent fingerprint 与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 guard 级 intent snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“目标定位快照”推进到“包含 repair intent 语义索引的只读 guard”，为后续正式 repair preview、permission check、Agent Runtime 审批分流、审计检索、idempotency 和 rollback 提供更完整的输入契约。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `intentFingerprint` 仍是只读 resolver 快照 fingerprint，不是持久化 repair intent id、mutation authorization、audit event id 或 approval policy；正式修复路径仍需要 preview mutation、permission check、audit、idempotency 和 rollback。
- intent 聚合来自当前 recommendations 的 category/code/action kind 字符串；如果后续引入持久化 action catalog registry，需要将 action kind version、intent taxonomy version 与 catalog/schema/capability/locator version 一起纳入 guard。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 243. P1 落地记录：Repair Action Mutation Guard Audit Summary

本轮继续收敛第 242 节剩余风险中 “`intentFingerprint` 仍是只读 resolver 快照 fingerprint，不是持久化 repair intent id、mutation authorization、audit event id 或 approval policy”。实际代码与目标架构的冲突点是：
guard 已经绑定 expected registry、catalog、schema、target locator、intent、capability、review mode 与 safety，但未来 Admin repair mutation、Agent Runtime 审批和审计事件仍需要一个稳定的人读摘要来记录“这次 guard 到底覆盖什么”。如果审计摘要由前端或未来 mutation 入口临时拼接，容易与后端 guard fingerprint 的输入不一致。本轮在只读 `repairActionMutationGuard` 上新增后端统一生成的审计摘要快照。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionMutationGuard`，新增 `auditSummary: string` 与 `auditSummaryFingerprint: string`。
  - `buildPromptRegistryPublishGateRepairActionMutationGuard()` 使用 registry id/fingerprint、catalog version/fingerprint、recommendation count、intent fingerprint、target locator count/kinds、review modes 与 safety levels 生成稳定 `auditSummary`。
  - `auditSummaryFingerprint` 对 `auditSummary` 生成 16 位 SHA-256 摘要，并与 `auditSummary` 一起纳入 `guardFingerprint` payload。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 guard 级 audit summary 字段、selection 和类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action mutation guard ...` 摘要新增 audit summary fingerprint 与 audit summary。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 audit summary 包含 registry、catalog、recommendation count、target kinds 与 review modes，断言 audit summary fingerprint 为 16 位 hex，并验证重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 guard 级 audit summary snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 mutation guard 从“语义索引快照”推进到“包含后端统一审计摘要的只读 guard”，为后续正式 repair preview、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供更稳定的记录输入。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `auditSummary` 与 `auditSummaryFingerprint` 仍是只读 resolver 快照，不是持久化 audit event、approval record、repair job id 或 mutation authorization；正式修复路径仍需要 preview mutation、permission check、audit persistence、idempotency 和 rollback。
- audit summary 当前是后端拼接的人读字符串；如果后续引入持久化 repair action catalog registry，需要同时提供结构化 audit payload 或 versioned audit schema，避免只依赖字符串解析。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 244. P1 落地记录：Repair Action Preview Contract

本轮继续收敛第 243 节剩余风险中 “`auditSummary` 与 `auditSummaryFingerprint` 仍是只读 resolver 快照，不是持久化 audit event、approval record、repair job id 或 mutation authorization”。实际代码与目标架构的冲突点是：
guard 已经能描述 expected registry、catalog、schema、target locator、intent、capability、review mode、safety 与审计摘要，但未来 Admin repair mutation、Agent Runtime 审批或审计事件还需要一个后端统一生成的“待预览操作列表”。如果 preview 候选由前端从 recommendations 临时重建，后续 permission check、preview diff、idempotency guard 与审计事件容易和后端 guard fingerprint 的输入脱节。本轮新增只读 `repairActionPreview`，把 recommendations 映射成稳定的 preview operation contract。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairActionPreview` 与 `CopilotPromptRegistryPublishGateRepairActionPreviewOperation` GraphQL object。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 从当前 repair recommendations 与 mutation guard 派生只读 preview，包含 `previewFingerprint`、`guardFingerprint`、`auditSummaryFingerprint`、`catalogFingerprint`、`candidateCount`、`status`、`readOnly` 与 operation 列表。
  - 每条 operation 记录 action kind、category、code、diagnostics fingerprint、input schema、review mode、safety、target、target locator、target locator fingerprint 与 required capabilities；operation status 根据 safety 区分 `preview_required`、`read_only_probe`、`read_only_refresh`、`dry_run_required` 与 `manual_review_required`。
  - `previewFingerprint` 由 guard/catalog/audit 指纹与稳定化 operation 摘要生成，使 preview 候选变化会产生新的只读 preview snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 `repairActionPreview` schema、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 新增 `Repair action preview ...` 汇总和 `Repair action preview operation ...` 明细，展示 preview fingerprint、guard/audit/catalog 指纹、read-only 状态、operation status、review mode、safety、capabilities、input schema 与 locator fingerprint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 preview read-only、summary status、candidate count、catalog/guard/audit 指纹绑定、16 位 preview fingerprint、operation status/review mode/safety 映射、target locator fingerprint 与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 preview summary 与 operation 明细。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair guard 从“审计摘要快照”推进到“后端统一只读 preview contract”，为后续正式 repair preview mutation、permission check、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供更稳定的输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repairActionPreview` 仍是只读 resolver 快照，不是正式 preview mutation、diff 结果、permission authorization、repair job id、approval record 或 audit event；正式修复路径仍需要权限预检、预览 diff、审计持久化、idempotency、rollback 与并发 stale guard。
- operation `inputSchema` 仍来自当前 action catalog preview JSON schema，不是 DB-versioned action schema registry 或 GraphQL input type；如果后续引入持久化 action catalog registry，需要将 action schema version、target locator schema version 与 preview fingerprint 一起演进。
- preview operation 的 target locator fingerprint 是 resolver 内稳定快照，不是持久化 target id；未来 mutation 入口仍需要 expected registry version、guard fingerprint、preview fingerprint 与 target locator fingerprint 联合校验。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 245. P1 落地记录：Repair Action Preview Operation Fingerprint

本轮继续收敛第 244 节剩余风险中 “preview operation 的 target locator fingerprint 是 resolver 内稳定快照，不是持久化 target id；未来 mutation 入口仍需要 expected registry version、guard fingerprint、preview fingerprint 与 target locator fingerprint 联合校验”。实际代码与目标架构的冲突点是：
`repairActionPreview` 已经给出了只读 operation 列表，但后续 Admin repair mutation、Agent Runtime 审批、单操作审计或幂等校验仍需要一个 operation 级稳定标识。如果只用 recommendation diagnostics fingerprint 或 target locator fingerprint，无法完整覆盖 action kind、schema、capability、review mode、safety 和 target 的组合变化。本轮在每条 preview operation 上新增 `operationFingerprint`。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionPreviewOperation`，新增 `operationFingerprint: string`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 先构造单条 operation 的稳定 payload，再用 action kind、catalog version、diagnostics fingerprint、input schema、required capabilities、preview status、review mode、safety、target 与 target locator fingerprint 生成 16 位 `operationFingerprint`。
  - `previewFingerprint` 的 payload 同步纳入每条 `operationFingerprint`，使单个 operation 的可审批/可预览契约变化会同步改变 preview snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 operation 级 fingerprint schema、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action preview operation ...` 明细新增 operation fingerprint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言每条 operation fingerprint 为 16 位 hex、operation fingerprint 唯一且重复调用稳定。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 operation fingerprint。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“preview 级快照”推进到“单 operation 可识别快照”，为后续正式 preview mutation、permission check、Agent Runtime 审批分流、单操作审计、idempotency 和 rollback 提供更细粒度的输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `operationFingerprint` 仍是只读 resolver 快照，不是持久化 operation id、mutation authorization、approval record、repair job id 或 audit event id；正式修复路径仍需要 expected registry version、guard fingerprint、preview fingerprint、operation fingerprint 与 target locator fingerprint 的联合校验。
- operation fingerprint 当前覆盖 action kind、schema、capability、review mode、safety 和 target 快照，但不替代 DB-versioned action catalog registry、GraphQL input type 或权限系统；后续需要把 action schema version、capability version、approval policy version 与 fingerprint 体系一起演进。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 246. P1 落地记录：Repair Action Preview Operation Set Snapshot

本轮继续收敛第 245 节剩余风险中 “正式修复路径仍需要 expected registry version、guard fingerprint、preview fingerprint、operation fingerprint 与 target locator fingerprint 的联合校验”。实际代码与目标架构的冲突点是：
每条 preview operation 已经有 `operationFingerprint`，但 preview 级对象还没有显式暴露 operation fingerprint 集合与集合指纹。后续 Admin repair mutation、Agent Runtime 审批或审计事件如果需要批量校验本次 preview 覆盖的 operation set，只能遍历 operations 自行排序和 hash，容易与后端 preview fingerprint 输入不一致。本轮在只读 `repairActionPreview` 上新增 operation set snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionPreview`，新增 `operationFingerprints: string[]` 与 `operationSetFingerprint: string`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 聚合每条 operation 的 `operationFingerprint`，排序后生成 16 位 `operationSetFingerprint`。
  - `previewFingerprint` 的 payload 纳入 `operationSetFingerprint`，使 operation set 变化会同步改变 preview snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preview 级 operation set 字段、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action preview ...` 汇总新增 operation set fingerprint 与 operation fingerprints 列表。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 operation fingerprints 等于 operations 中 fingerprint 的排序集合、`operationSetFingerprint` 为 16 位 hex 且重复调用稳定。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 operation set fingerprint 与 operation fingerprints。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“单 operation 可识别快照”推进到“preview 级 operation set 可校验快照”，为后续正式 preview mutation、permission check、Agent Runtime 审批、批量审计、idempotency 和 rollback 提供更稳定的集合边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `operationSetFingerprint` 仍是只读 resolver 快照，不是持久化 repair batch id、mutation authorization、approval record、repair job id 或 audit event id；正式修复路径仍需要 expected registry version、guard fingerprint、preview fingerprint、operation set fingerprint、operation fingerprints 与 target locator fingerprints 的联合校验。
- operation set snapshot 只证明当前 resolver preview 的集合边界，不提供预览 diff、权限授权、审批状态、回滚计划或持久化审计。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 247. P1 落地记录：Repair Action Preview Authorization Snapshot

本轮继续收敛第 246 节剩余风险中 “operation set snapshot 只证明当前 resolver preview 的集合边界，不提供预览 diff、权限授权、审批状态、回滚计划或持久化审计”。实际代码与目标架构的冲突点是：
preview 已经能稳定标识 operation set，但后续 Admin repair mutation、Agent Runtime 审批或审计事件仍需要在 preview 汇总层直接读取本次修复候选需要哪些 capabilities、哪些审批模式，以及当前是否只能进入 approval-required 路径。如果这些信息只从 operation 列表临时聚合，mutation 入口和审批 UI 会重复实现权限/审批分流逻辑。本轮在只读 `repairActionPreview` 上新增 authorization/approval snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionPreview`，新增 `authorizationStatus`、`authorizationFingerprint`、`approvalRequired`、`approvalModes` 与 `requiredCapabilities`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 从 operation 的 required capabilities 与 review mode 聚合 preview 级 capability set 和 approval mode set。
  - `authorizationStatus` 根据 operation set 判定为 `not_required`、`preauthorized_read_only` 或 `approval_required`；`authorizationFingerprint` 由 authorization status、approval modes、approval required、required capabilities 与 operation set fingerprint 生成 16 位快照。
  - `previewFingerprint` 的 payload 纳入 `authorizationFingerprint`，使权限/审批分流快照变化会同步改变 preview snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preview 级 authorization/approval 字段、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action preview ...` 汇总新增 authorization status/fingerprint、approval required、approval modes 与 required capabilities。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 authorization status、approval required、authorization fingerprint、approval modes、required capabilities 与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 authorization/approval snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“operation set 可校验快照”推进到“preview 级权限/审批分流快照”，为后续正式 preview mutation、permission check、Agent Runtime 审批、批量审计、idempotency 和 rollback 提供更明确的只读输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `authorizationStatus` 与 `authorizationFingerprint` 仍是只读 resolver 快照，不是实际 permission check、mutation authorization、approval record、repair job id 或 audit event id；正式修复路径仍需要接入权限系统、审批状态机、preview diff、审计持久化、idempotency 与 rollback。
- `approvalModes` 和 `requiredCapabilities` 来自当前 preview operation 聚合，不替代 DB-versioned action catalog、capability registry 或 approval policy registry；后续需要引入版本化 policy/capability schema。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 248. P1 落地记录：Repair Action Preview Approval Policy Snapshot

本轮继续收敛第 247 节剩余风险中 “`approvalModes` 和 `requiredCapabilities` 来自当前 preview operation 聚合，不替代 DB-versioned action catalog、capability registry 或 approval policy registry”。实际代码与目标架构的冲突点是：
preview 已经暴露 authorization status/fingerprint，但后续 Admin repair mutation、Agent Runtime 审批或审计事件还需要知道这组审批判断遵循哪个策略版本，以及 mutation 入口应校验哪些只读 checkpoint。如果只把这些规则隐含在 resolver 代码里，后续权限系统、审批状态机和审计持久化很难判断旧 preview snapshot 是否仍可接受。本轮在只读 `repairActionPreview` 上新增 approval policy snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 扩展 `CopilotPromptRegistryPublishGateRepairActionPreview`，新增 `approvalPolicyVersion`、`approvalPolicyFingerprint` 与 `approvalCheckpoints`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 固定当前策略版本为 `repair-preview-approval/v1`，并从 read-only contract、operation set、capability scope、authorization status 与 review modes 派生 checkpoint 集合。
  - `approvalPolicyFingerprint` 由 policy version、checkpoints、authorization fingerprint/status、approval modes、approval required、required capabilities 与 operation set fingerprint 生成 16 位快照。
  - `previewFingerprint` 的 payload 纳入 `approvalPolicyFingerprint`，使审批策略快照变化会同步改变 preview snapshot。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preview 级 approval policy 字段、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action preview ...` 汇总新增 approval policy version/fingerprint 与 approval checkpoints。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 approval policy version、policy fingerprint、checkpoint 集合与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 approval policy snapshot。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“权限/审批分流快照”推进到“带版本的审批策略只读快照”，为后续正式 preview mutation、permission check、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供更明确的策略边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `approvalPolicyFingerprint` 仍是 resolver 派生的只读策略快照，不是实际 permission check、policy registry version、approval record、repair job id 或 audit event id；正式修复路径仍需要接入权限系统、审批状态机、preview diff、审计持久化、idempotency 与 rollback。
- `approvalCheckpoints` 当前是字符串 checkpoint 集合，不是 DB-versioned policy DSL、capability schema 或 GraphQL input contract；后续引入真实审批策略注册表时，需要把 policy id、policy version、capability version 与 approval policy fingerprint 一起校验。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 249. P1 落地记录：Repair Action Preview Submission Contract

本轮继续收敛第 248 节剩余风险中 “正式修复路径仍需要接入权限系统、审批状态机、preview diff、审计持久化、idempotency 与 rollback”。实际代码与目标架构的冲突点是：
preview 已经暴露 guard、operation set、authorization 和 approval policy 快照，但后续 Admin repair mutation 或 Agent Runtime 审批入口仍缺少一个明确的“提交契约”对象来说明客户端必须回传哪些 fingerprint、expected registry 字段和幂等键。如果这些字段继续分散在 preview 顶层，mutation 入口容易漏校验某个快照，或者和前端拼装的 idempotency scope 不一致。本轮新增只读 `submissionContract`，把未来 repair mutation 的最小提交边界先固化为后端派生契约。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairActionSubmissionContract` GraphQL object，并挂到 `repairActionPreview.submissionContract`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 派生 `contractVersion: repair-preview-submission/v1`、`submissionFingerprint`、`idempotencyKey`、`requiredInputs`、expected registry 三元组、guard/preview/operation set/authorization/approval policy/catalog 指纹。
  - 当前 `submissionContract.readOnly = true` 且 `mutationAvailable = false`，明确这是正式 mutation 前的只读提交契约，不开放 repair 写入。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 submission contract schema、selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Repair action preview ...` 汇总新增 submission contract version/fingerprint、read-only 状态、mutation availability、idempotency key、expected registry 与 required inputs。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 submission contract 的 version、fingerprint 格式、只读状态、mutation availability、绑定到 guard/preview/operation set/authorization/approval policy/catalog 指纹、expected registry 字段、idempotency key、required inputs 与重复调用稳定性。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 ready、blocked registry 与 action dry-run failed fixtures，并断言 diagnostics 文本显示 submission contract。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“带版本的审批策略只读快照”推进到“未来 mutation 可复用的只读提交契约”，为后续正式 preview mutation、permission check、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供更明确的输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `submissionContract` 仍是只读 resolver 快照，不是正式 repair mutation、permission authorization、approval record、repair job id、preview diff、audit event 或 rollback plan；正式修复路径仍需要实现 mutation、权限预检、审批状态机、审计持久化、并发 stale guard、幂等执行和回滚。
- `idempotencyKey` 当前由 registry id/fingerprint、preview fingerprint 与 operation set fingerprint 组成，只定义提交范围，不保证持久化幂等锁；后续 mutation 需要服务端持久化 request key、actor、workspace、policy version 与 result 状态。
- `requiredInputs` 当前是字符串字段清单，不是 GraphQL input type、DB-versioned repair contract 或 policy DSL；后续引入正式 mutation 时需要把这些字段落成强类型 input，并验证 schema/version 兼容。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 250. P1 落地记录：Repair Submission Preflight Query

本轮继续收敛第 249 节剩余风险中 “`requiredInputs` 当前是字符串字段清单，不是 GraphQL input type、DB-versioned repair contract 或 policy DSL；后续引入正式 mutation 时需要把这些字段落成强类型 input，并验证 schema/version 兼容”。实际代码与目标架构的冲突点是：
`submissionContract` 已经说明未来 mutation 需要哪些字段，但客户端还没有一个强类型入口可以把这些字段回传给后端做只读一致性校验。如果直接进入正式 mutation，权限系统、审批状态机和审计链路会同时承担“输入是否仍匹配当前 preview”的校验风险。本轮新增只读 preflight query，把 submission contract 的强类型 input 和服务端重新计算校验先落地。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryRepairSubmissionInput`，把 approval policy、authorization、catalog、expected registry、guard、idempotency key、operation set、preview、required inputs 与 submission fingerprint 落成强类型 GraphQL input。
  - 新增 `CopilotPromptRegistryRepairPreflightType` 与 `Copilot.promptRegistryRepairPreflight(...)` resolve field。
  - preflight 会重新读取当前 registry publish gate verdict，并复用 `withPromptRegistryPublishGateRouteReadiness()` 重新生成当前 `repairActionPreview.submissionContract`，再逐项比较客户端提交的 input 与当前 contract。
  - 当前返回 `readOnly = true`、`mutationAvailable = false`、`accepted = false`；完全匹配时 status 为 `ready_for_review`，不匹配时 status 为 `stale_submission` 并返回 `mismatchedFields`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、
  `packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight schema、query 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin publish gate 诊断会用当前 `submissionContract` 调用 preflight query，并在 diagnostics 中显示 preflight status、read-only、mutation availability、accepted 状态、current/expected submission fingerprint、matched fields 与 mismatched fields。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 submission 返回 `ready_for_review`、无 mismatched fields、仍不 accepted，篡改 preview/submission fingerprint 时返回 `stale_submission` 与对应 mismatched fields。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 Admin query mock 和 diagnostics 断言，覆盖 ready、blocked registry 与 action dry-run failed 的 preflight 展示。

该实现新增 GraphQL query/input/object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preview contract 从“只读提交契约”推进到“强类型只读提交预检”，为后续正式 repair mutation、permission check、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供可复用的服务端校验入口。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `promptRegistryRepairPreflight` 仍是只读 query，不是正式 repair mutation、permission authorization、approval record、repair job id、preview diff、audit event 或 rollback plan；正式修复路径仍需要实现 mutation、权限预检、审批状态机、审计持久化、并发 stale guard、幂等执行和回滚。
- preflight 当前只比较 submission contract 字段是否匹配当前 resolver 快照，不执行 actor/workspace 级 repair permission、capability registry lookup、policy DSL 校验或持久化 idempotency lock。
- Admin 目前只把当前 contract 原样提交给 preflight 用于诊断展示，还没有提供人工审批 UI、差异预览、执行按钮或 repair job 状态。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 251. P1 落地记录：Repair Preflight Permission Snapshot

本轮继续收敛第 250 节剩余风险中 “preflight 当前只比较 submission contract 字段是否匹配当前 resolver 快照，不执行 actor/workspace 级 repair permission”。实际代码与目标架构的冲突点是：
`promptRegistryRepairPreflight` 已经能验证客户端回传的 submission contract 是否仍匹配当前 preview，但返回值里没有明确说明本次预检是否绑定到当前 actor/workspace 权限边界。后续正式 repair mutation、审批记录和审计事件如果直接复用 preflight 结果，会缺少可复制的 permission snapshot。本轮在只读 preflight 上新增 permission snapshot，并在有 workspaceId 时先执行现有 `Workspace.Copilot` 断言。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `Copilot.promptRegistryRepairPreflight(...)` 新增 `@CurrentUser()` 注入；当 `copilot.workspaceId` 存在时，先通过 `PermissionAccess.user(user.id).workspace(workspaceId).allowLocal().assert('Workspace.Copilot')` 做只读预检权限边界校验。
  - `CopilotPromptRegistryRepairPreflightType` 新增 `permissionCheckMode`、`permissionChecked`、`permissionFingerprint`、`permissionScope`、`permissionStatus`、`requiredPermission` 与 `workspaceId`。
  - `buildPromptRegistryRepairPreflight()` 继续只比较 submission contract 字段，不把 permission snapshot 纳入客户端 submission input；permission fingerprint 由 check mode、checked 状态、scope、status、required permission 与 workspaceId 派生，用于后续审计/审批链路引用。
  - 没有 workspaceId 的 Admin global 诊断返回 `permissionChecked=false`、`permissionScope=global`、`permissionStatus=workspace_not_selected`，避免把全局只读诊断误判为 workspace repair 授权。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight permission snapshot selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 permission status、check mode、scope、workspace、required permission 与 permission fingerprint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 用最小 `PermissionAccess` mock 断言 workspace preflight 会执行 `Workspace.Copilot`，并返回 `permissionChecked=true`、`permissionScope=workspace`、`permissionStatus=granted`、workspaceId 与 16 位 permission fingerprint。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 和 ready、blocked registry、action dry-run failed diagnostics 断言，覆盖 global/no-workspace permission snapshot 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“只读提交一致性校验”推进到“带 actor/workspace 权限边界快照的只读预检”，为后续正式 repair mutation、Agent Runtime 审批、审计事件、idempotency 和 rollback 提供更明确的权限输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `permissionFingerprint` 仍是 resolver 派生的只读快照，不是正式 repair mutation authorization、approval record、repair job id、preview diff、audit event 或 rollback plan；正式修复路径仍需要实现 mutation、权限再校验、审批状态机、审计持久化、并发 stale guard、幂等执行和回滚。
- 当前权限边界复用现有 `Workspace.Copilot`，还没有独立的 `PromptRegistry.Repair` 或 capability registry policy；后续引入 capability/policy registry 时，需要把 action catalog capability、workspace permission、policy version 与 approval policy fingerprint 一起校验。
- Admin 目前只展示 permission snapshot，没有人工审批 UI、差异预览、执行按钮或 repair job 状态。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 252. P1 落地记录：Repair Preflight Capability Snapshot

本轮继续收敛第 251 节剩余风险中 “当前权限边界复用现有 `Workspace.Copilot`，还没有独立的 `PromptRegistry.Repair` 或 capability registry policy”。实际代码与目标架构的冲突点是：
preflight 已经能返回 actor/workspace 权限快照，但还没有把本次 repair preview 需要的 action catalog capabilities 作为 preflight 自身的可审计快照暴露出来。后续正式 repair mutation、Agent Runtime 审批或审计事件如果只记录 workspace permission，而不记录当时声明的 required capabilities，会缺少把 permission、approval policy 与 action catalog capability 对齐的输入边界。本轮在只读 preflight 上新增 capability snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `capabilityCheckMode`、`capabilityFingerprint`、`capabilitySource`、`capabilityStatus`、`requiredCapabilities` 与 `requiredCapabilityCount`。
  - `buildPromptRegistryRepairPreflight()` 继续只比较 submission contract 字段，不把 capability snapshot 纳入客户端 submission input；capability fingerprint 由 action catalog fingerprint、check mode、source、status 与排序后的 required capabilities 派生。
  - `promptRegistryRepairPreflight(...)` 从当前 `repairActionPreview.requiredCapabilities` 和 `repairActionPreview.catalogFingerprint` 生成 `preview_capability_snapshot`，状态在存在 capability 声明时为 `declared`，否则为 `not_required`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight capability snapshot selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 capability status、check mode、source、fingerprint、required capability count 与 capability set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `capabilityCheckMode=preview_capability_snapshot`、`capabilitySource=repair_action_preview`、`capabilityStatus=declared`、16 位 capability fingerprint，并且 required capabilities 与当前 repair preview 的 required capabilities 一致。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global 与 workspace capability snapshot 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“带 actor/workspace 权限边界快照的只读预检”推进到“同时记录 action catalog capability 边界的只读预检”，为后续正式 repair mutation、Agent Runtime 审批、审计事件、policy registry、idempotency 和 rollback 提供更完整的只读输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `capabilityFingerprint` 仍是 resolver 派生的只读快照，不是正式 capability registry lookup、policy DSL 校验、mutation authorization、approval record、repair job id、preview diff、audit event 或 rollback plan；正式修复路径仍需要实现 mutation、权限/能力再校验、审批状态机、审计持久化、并发 stale guard、幂等执行和回滚。
- capability snapshot 当前来自 `repairActionPreview.requiredCapabilities`，不是 DB-versioned capability registry 或 action catalog registry；后续引入 capability/policy registry 时，需要把 action catalog version、capability schema version、workspace permission、approval policy version 与 submission/preflight fingerprint 一起校验。
- Admin 目前只展示 permission/capability snapshot，没有人工审批 UI、差异预览、执行按钮或 repair job 状态。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 253. P1 落地记录：Repair Preflight Review Binding Snapshot

本轮继续收敛第 252 节剩余风险中 “`capabilityFingerprint` 仍是 resolver 派生的只读快照，不是正式 capability registry lookup、policy DSL 校验、mutation authorization、approval record、repair job id、preview diff、audit event 或 rollback plan”。实际代码与目标架构的冲突点是：
preflight 已经分别暴露 submission、permission 与 capability 快照，但后续正式 repair mutation、Agent Runtime 审批或审计事件还需要一个单独的 review/audit binding，明确本次预检把哪些快照绑定在一起。如果每个入口分别组合这些 fingerprint，审批记录和 mutation stale guard 容易遗漏某一类输入。本轮在只读 preflight 上新增 review binding snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `reviewBindingVersion`、`reviewBindingFingerprint`、`reviewBindingStatus` 与 `reviewBindingInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定当前 binding 版本为 `repair-preflight-review-binding/v1`，并把 `submissionFingerprint`、`permissionFingerprint` 与 `capabilityFingerprint` 作为绑定输入。
  - matching submission 时 `reviewBindingStatus=ready_for_review`；stale/tampered submission 时 `reviewBindingStatus=stale_submission`，且 binding fingerprint 会随 expected/current submission fingerprint、permission/capability fingerprint 或 status 改变。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight review binding selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 review binding version、status、fingerprint 与 binding inputs。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 matching preflight 返回 `repair-preflight-review-binding/v1`、`ready_for_review`、16 位 binding fingerprint 与三项 binding inputs；篡改 submission 时返回 `stale_submission` binding status 且 binding fingerprint 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 review binding 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“同时记录 action catalog capability 边界的只读预检”推进到“带 submission/permission/capability 绑定指纹的只读预检”，为后续正式 repair mutation、Agent Runtime 审批、审计事件、policy registry、idempotency 和 rollback 提供更明确的 review 输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `reviewBindingFingerprint` 仍是 resolver 派生的只读快照，不是正式 approval record、repair job id、audit event、preview diff、policy registry decision、mutation authorization 或 rollback plan；正式修复路径仍需要实现 mutation、权限/能力再校验、审批状态机、审计持久化、并发 stale guard、幂等执行和回滚。
- review binding 当前只绑定 submission、permission 与 capability 三组 fingerprint，还没有绑定真实 approval record id、policy registry version、capability registry version、actor session id、repair job id 或 persisted idempotency key。
- Admin 目前只展示 review binding snapshot，没有人工审批 UI、差异预览、执行按钮或 repair job 状态。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 254. P1 落地记录：Repair Preflight Idempotency Guard Snapshot

本轮继续收敛第 253 节剩余风险中 “review binding 当前只绑定 submission、permission 与 capability 三组 fingerprint，还没有绑定真实 approval record id、policy registry version、capability registry version、actor session id、repair job id 或 persisted idempotency key”。实际代码与目标架构的冲突点是：
`submissionContract.idempotencyKey` 已经给出了未来 repair mutation 的幂等 key，但 preflight 返回值还没有明确说明当前只做只读预检，不获取持久化锁，也没有把 idempotency key 与 review binding、workspace scope 绑定成独立快照。后续正式 mutation 如果直接复用 submission contract 的 key，容易混淆“key 已声明”和“锁已获取”。本轮在只读 preflight 上新增 idempotency guard snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `idempotencyVersion`、`idempotencyKey`、`idempotencyScope`、`idempotencyStatus`、`idempotencyLockAcquired` 与 `idempotencyFingerprint`。
  - `buildPromptRegistryRepairPreflight()` 固定当前幂等预检版本为 `repair-preflight-idempotency/v1`，复用当前 `submissionContract.idempotencyKey`，并把 review binding fingerprint、scope、workspaceId 与 read-only lock state 纳入 idempotency fingerprint。
  - 当前 `idempotencyStatus=not_acquired_read_only` 且 `idempotencyLockAcquired=false`，明确 preflight 不写入幂等锁、不创建 repair job。
  - 有 workspaceId 时 `idempotencyScope=workspace`；没有 workspaceId 的 Admin global 诊断使用 `idempotencyScope=global_diagnostics`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight idempotency guard selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 idempotency version、status、scope、lock acquired、key 与 fingerprint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-idempotency/v1`、submission contract 的 idempotency key、workspace scope、`not_acquired_read_only`、`lockAcquired=false` 与 16 位 idempotency fingerprint；篡改 submission 时 idempotency fingerprint 随 review binding 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace idempotency guard 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“带 submission/permission/capability 绑定指纹的只读预检”推进到“明确声明幂等 key scope 且不获取锁的只读预检”，为后续正式 repair mutation、持久化 idempotency lock、Agent Runtime 审批、审计事件、policy registry 和 rollback 提供更明确的输入边界。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `idempotencyFingerprint` 仍是 resolver 派生的只读快照，不是正式持久化 idempotency lock、approval record、repair job id、audit event、mutation authorization 或 rollback plan；正式修复路径仍需要实现 mutation、锁记录、结果缓存、并发 stale guard、审计持久化和回滚。
- idempotency guard 当前未绑定 actor session id、approval record id、policy registry version 或 capability registry version；后续引入正式 mutation 时需要把这些字段纳入锁记录和审计 payload。
- Admin 目前只展示 idempotency guard snapshot，没有人工审批 UI、差异预览、执行按钮或 repair job 状态。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 255. P1 落地记录：Repair Preflight Job Contract Snapshot

本轮继续收敛第 254 节剩余风险中 “`idempotencyFingerprint` 仍是 resolver 派生的只读快照，不是正式持久化 idempotency lock、approval record、repair job id、audit event、mutation authorization 或 rollback plan”。实际代码与目标架构的冲突点是：
preflight 已经明确声明幂等 key 和 read-only lock 状态，但仍没有一个单独的 repair job contract 说明“哪些快照将构成未来执行 job 的输入边界”，也没有明确当前 preflight 不创建执行 job。后续正式 repair mutation、Agent Runtime job 或审计事件如果直接从多个字段临时拼装 job 输入，容易遗漏 operation set、submission、review binding 或 idempotency guard。本轮在只读 preflight 上新增 repair job contract snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `repairJobVersion`、`repairJobStatus`、`repairJobCreated`、`repairJobFingerprint` 与 `repairJobInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定当前 job contract 版本为 `repair-preflight-job-contract/v1`，当前 `repairJobStatus=not_created_read_only` 且 `repairJobCreated=false`。
  - `repairJobFingerprint` 绑定 `idempotencyFingerprint`、`reviewBindingFingerprint`、`operationSetFingerprint`、`submissionFingerprint`、workspaceId 与只读创建状态；篡改 submission 时会随 review/idempotency fingerprint 改变。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight repair job contract selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 repair job version、status、created、fingerprint 与 inputs，明确 Admin 当前只展示执行前 contract，不创建 job。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-job-contract/v1`、`not_created_read_only`、`repairJobCreated=false`、16 位 repair job fingerprint 与四项 job inputs；篡改 submission 时 repair job fingerprint 会变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace repair job contract 展示。
- 运行时契约补充：
  - `packages/backend/server/src/plugins/copilot/runtime/contracts/execution-plan-contract.ts` 保持 `ExecutionRoute` 为 native execution plan 的最小可序列化 route：`providerId`、`protocol`、`model`、`backendConfig`。
  - 新增 `ExecutionRouteDiagnostics` 与 `ExecutionPlan.routeDiagnostics` 承载 provider health、privacy、profile source、model definition source、alias/raw model 等 Admin/action dry-run 观测字段。
  - `packages/backend/server/src/plugins/copilot/runtime/execution-plan.ts` 的 `serializable.routes` 仍只写入最小 native contract；`resolver.ts` 与 `action-runtime-bridge.ts` 的 dry-run/trace 展示改读 `plan.routeDiagnostics`，避免把诊断字段传入 native schema。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“明确声明幂等 key scope 且不获取锁的只读预检”推进到“同时声明未来 repair job 输入边界且不创建 job 的只读预检”，为后续正式 repair mutation、Agent Runtime job、持久化 idempotency lock、审计事件、policy registry 和 rollback 提供更稳定的 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、focused backend AVA、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `repairJobFingerprint` 仍是 resolver 派生的只读快照，不是正式 repair job id、job queue record、approval record、audit event、mutation authorization、execution state 或 rollback plan；正式修复路径仍需要实现 mutation、权限/能力再校验、幂等锁记录、job 状态机、审计持久化和回滚。
- job contract 当前未绑定 actor session id、approval record id、policy registry version、capability registry version 或 persisted idempotency lock id；后续引入正式 mutation 时需要把这些字段纳入 job payload 和审计 payload。
- Admin 目前只展示 repair job contract snapshot，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 256. P1 落地记录：Repair Preflight Actor Audit Snapshot

本轮继续收敛第 255 节剩余风险中 “job contract 当前未绑定 actor session id、approval record id、policy registry version、capability registry version 或 persisted idempotency lock id”。实际代码与目标架构的冲突点是：
preflight 已经声明未来 repair job 的输入边界，但该边界仍没有把当前 actor 及审计绑定作为一等快照暴露出来。后续正式 repair mutation、Agent Runtime job 或审计事件如果只记录 workspace permission 和 repair job fingerprint，而不记录 actor 绑定，无法稳定证明本次只读预检是由哪个当前用户上下文发起，也难以把 actor、permission、capability 与 review binding 一起纳入 job payload。本轮在只读 preflight 上新增 actor/audit snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `actorSnapshotVersion`、`actorSnapshotStatus`、`actorType`、`actorFingerprint`、`actorSnapshotInputs`、`auditBindingVersion`、`auditBindingStatus`、`auditBindingFingerprint` 与 `auditBindingInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 actor snapshot 版本为 `repair-preflight-actor-snapshot/v1`，仅返回当前 user id 的 16 位 hash 派生 fingerprint，不直接暴露 actor id。
  - 新增 `repair-preflight-audit-binding/v1`，把 `actorFingerprint`、`permissionFingerprint`、`capabilityFingerprint` 与 `reviewBindingFingerprint` 绑定为 audit fingerprint；stale submission 时 audit binding status 跟随 `stale_submission`。
  - `repairJobInputs` 与 `repairJobFingerprint` 新增绑定 `actorFingerprint` 与 `auditBindingFingerprint`，让未来 job contract 明确包含 actor/audit 边界。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight actor/audit snapshot selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 actor snapshot version/status/type/fingerprint/inputs 与 audit binding version/status/fingerprint/inputs。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-actor-snapshot/v1`、`bound_to_current_user`、`user`、16 位 actor fingerprint、actor inputs、`repair-preflight-audit-binding/v1`、ready/stale audit status 与 audit inputs；篡改 submission 时 audit binding fingerprint 和 repair job fingerprint 会变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace actor/audit snapshot 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“声明未来 repair job 输入边界且不创建 job 的只读预检”推进到“同时绑定当前 actor 与审计输入边界的只读预检”，为后续正式 repair mutation、Agent Runtime job、approval record、持久化 idempotency lock、审计事件、policy registry 和 rollback 提供更完整的 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `actorFingerprint` 与 `auditBindingFingerprint` 仍是 resolver 派生的只读快照，不是正式 actor session id、approval record id、audit event id、repair job id、mutation authorization、policy registry decision、execution state 或 rollback plan。
- actor snapshot 当前只绑定 current user 的短 hash、actor type 与 workspaceId；后续正式 mutation 仍需要绑定 session id/token id、approval record id、policy registry version、capability registry version、persisted idempotency lock id 与审计事件持久化记录。
- Admin 目前只展示 actor/audit snapshot，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 257. P1 落地记录：Repair Preflight Policy Binding Snapshot

本轮继续收敛第 256 节剩余风险中 “`actorFingerprint` 与 `auditBindingFingerprint` 仍是 resolver 派生的只读快照，不是正式 policy registry decision”。实际代码与目标架构的冲突点是：
preflight 已经绑定 actor、permission、capability、review 与 audit，但还没有把 approval policy fingerprint、authorization fingerprint 和这些只读快照聚合成独立的 policy binding。后续正式 repair mutation、Agent Runtime approval 或审计事件如果直接依赖散落字段，容易遗漏 authorization 或 approval policy 输入，也不利于未来替换为 DB-versioned policy registry verdict。本轮在只读 preflight 上新增 policy binding snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `policyBindingVersion`、`policyBindingStatus`、`policySource`、`policyBindingFingerprint` 与 `policyBindingInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 policy binding 版本为 `repair-preflight-policy-binding/v1`，把 `actorFingerprint`、`permissionFingerprint`、`capabilityFingerprint`、`auditBindingFingerprint`、当前 preview 的 `approvalPolicyFingerprint` 与 `authorizationFingerprint` 绑定为 policy fingerprint。
  - matching submission 时 `policyBindingStatus=ready_for_review`；stale/tampered submission 时跟随 `stale_submission`。
  - `repairJobInputs` 与 `repairJobFingerprint` 新增绑定 `policyBindingFingerprint`，让未来 job contract 明确包含 policy 边界。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight policy binding selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 policy binding version/status/source/fingerprint/inputs。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-policy-binding/v1`、`ready_for_review`、`repair_action_preview_policy_snapshot`、16 位 policy fingerprint 与六项 policy inputs；篡改 submission 时 policy binding fingerprint 和 repair job fingerprint 会变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace policy binding 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“同时绑定当前 actor 与审计输入边界的只读预检”推进到“同时绑定 preview approval/authorization policy 输入边界的只读预检”，为后续正式 repair mutation、Agent Runtime approval、policy registry verdict、持久化 idempotency lock、审计事件和 rollback 提供更完整的 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID前后不变作为不重建证据。

剩余风险：

- `policyBindingFingerprint` 仍是 resolver 派生的只读快照，不是正式 policy registry decision、approval record id、authorization grant、audit event id、repair job id、mutation authorization、execution state 或 rollback plan。
- policy binding 当前只绑定 preview contract 的 approval/authorization fingerprint 和 preflight 派生快照；后续正式 mutation 仍需要绑定 policy registry version、capability registry version、approval record id、actor session/token id、persisted idempotency lock id 与审计事件持久化记录。
- Admin 目前只展示 policy binding snapshot，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 258. P1 落地记录：Repair Preflight Execution Gate Snapshot

本轮继续收敛第 257 节剩余风险中 “`policyBindingFingerprint` 仍是 resolver 派生的只读快照，不是正式 mutation authorization、execution state 或 rollback plan”。实际代码与目标架构的冲突点是：
preflight 已经暴露 policy、idempotency 与 job contract 快照，但还没有一个单独的 execution gate 明确说明当前预检是否允许进入正式 repair mutation/job execution。后续正式 repair mutation 如果只读取 `status`、`readOnly`、`mutationAvailable`、policy binding 与 job contract 的散落字段，容易遗漏 stale submission、read-only contract、未获取幂等锁或未创建 job 等执行前置条件。本轮在只读 preflight 上新增 execution gate snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `executionGateVersion`、`executionGateStatus`、`executionGateFingerprint` 与 `executionGateInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 execution gate 版本为 `repair-preflight-execution-gate/v1`，把 `readOnly`、`mutationAvailable`、`reviewBindingFingerprint`、`policyBindingFingerprint`、`idempotencyFingerprint` 与 `repairJobFingerprint` 绑定为 execution gate fingerprint。
  - matching submission 且当前 read-only contract 下返回 `executionGateStatus=blocked_read_only`；stale/tampered submission 返回 `blocked_stale_submission`，并让 execution gate fingerprint 随 stale 状态和下游 fingerprint 变化。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight execution gate selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 execution gate version/status/fingerprint/inputs，明确当前 Admin 只展示进入正式执行前的只读阻断原因。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-execution-gate/v1`、`blocked_read_only`、16 位 gate fingerprint 与六项 gate inputs；篡改 submission 时 execution gate status 变为 `blocked_stale_submission` 且 fingerprint 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace execution gate 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“绑定 preview approval/authorization policy 输入边界的只读预检”推进到“显式暴露正式执行门禁状态的只读预检”，为后续正式 repair mutation、Agent Runtime job、持久化 idempotency lock、审计事件和 rollback 提供更明确的执行前 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `executionGateFingerprint` 仍是 resolver 派生的只读快照，不是正式 persisted execution gate、mutation authorization、approval record id、authorization grant、audit event id、repair job id、execution state 或 rollback plan。
- execution gate 当前只表达 read-only/stale 阻断，不会获取幂等锁、不创建 repair job、不生成 approval record，也不会持久化 gate verdict；后续正式 mutation 仍需要把 policy registry version、capability registry version、approval record id、actor session/token id、persisted idempotency lock id 与 audit event id 纳入 gate verdict。
- Admin 目前只展示 execution gate snapshot，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 259. P1 落地记录：Repair Preflight Approval Request Snapshot

本轮继续收敛第 258 节剩余风险中 “execution gate 当前只表达 read-only/stale 阻断，不会生成 approval record”。实际代码与目标架构的冲突点是：
repair preview 已经计算 approval policy、authorization status、approval modes 与 approval checkpoints，但 preflight 还没有把这些审批输入绑定成一个独立的 approval request snapshot。后续正式 repair mutation、Agent Runtime approval 或审计事件如果只从 preview 与 policy binding 分散读取这些字段，容易遗漏 approval request 与 execution gate、review binding、policy binding 的一致性校验。本轮在只读 preflight 上新增 approval request snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `approvalRequestVersion`、`approvalRequestStatus`、`approvalRequestFingerprint`、`approvalRequestInputs`、`approvalRequired`、`approvalModes`、`approvalCheckpoints` 与 `authorizationStatus`。
  - `promptRegistryRepairPreflight()` 把当前 `repairActionPreview` 的 approval/authorization 元数据传入 `buildPromptRegistryRepairPreflight()`，避免 preflight 重复推导审批语义。
  - `buildPromptRegistryRepairPreflight()` 固定 approval request 版本为 `repair-preflight-approval-request/v1`，把 approval policy fingerprint、authorization fingerprint/status、approval modes/checkpoints、approvalRequired、policyBindingFingerprint 与 reviewBindingFingerprint 绑定为 approval request fingerprint。
  - `executionGateInputs` 与 `executionGateFingerprint` 新增绑定 `approvalRequestFingerprint`，让未来正式执行门禁明确包含审批请求快照。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight approval request selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 approval request version/status/fingerprint/inputs、approvalRequired、authorizationStatus、approvalModes 与 approvalCheckpoints。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-approval-request/v1`、`approval_required`、16 位 approval request fingerprint、preview approval modes/checkpoints 与八项 approval request inputs；篡改 submission 时 approval request fingerprint 会随 review/policy binding 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace approval request 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“显式暴露正式执行门禁状态的只读预检”推进到“同时暴露审批请求输入边界的只读预检”，为后续正式 repair mutation、Agent Runtime approval record、持久化 idempotency lock、审计事件和 rollback 提供更完整的执行前 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `approvalRequestFingerprint` 仍是 resolver 派生的只读快照，不是正式 approval record id、approval state machine、authorization grant、audit event id、repair job id、execution state 或 rollback plan。
- approval request 当前只绑定 preview approval/authorization 元数据、policy binding 与 review binding；后续正式 mutation 仍需要把 policy registry version、capability registry version、approval actor/session/token id、persisted idempotency lock id、audit event id 与 approval decision 纳入持久化记录。
- Admin 目前只展示 approval request snapshot，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 260. P1 落地记录：Repair Preflight Approval Record Contract Snapshot

本轮继续收敛第 259 节剩余风险中 “`approvalRequestFingerprint` 仍是 resolver 派生的只读快照，不是正式 approval record id”。实际代码与目标架构的冲突点是：
preflight 已经有 approval request snapshot，但仍没有明确未来正式 approval record 应绑定哪些只读输入，也没有明确当前 preflight 不创建 approval record。后续正式 repair mutation、Agent Runtime approval 或审计事件如果直接从 approval request、policy binding、actor/audit binding 分散拼装 approval record，容易遗漏 workspace scope 或 review binding。本轮在只读 preflight 上新增 approval record contract snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `approvalRecordVersion`、`approvalRecordStatus`、`approvalRecordCreated`、`approvalRecordFingerprint` 与 `approvalRecordInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 approval record contract 版本为 `repair-preflight-approval-record/v1`，当前 `approvalRecordStatus=not_created_read_only` 且 `approvalRecordCreated=false`。
  - `approvalRecordFingerprint` 绑定 `actorFingerprint`、`approvalRequestFingerprint`、`auditBindingFingerprint`、`policyBindingFingerprint`、`reviewBindingFingerprint` 与 workspaceId，明确未来 approval record 的输入边界。
  - `executionGateInputs` 与 `executionGateFingerprint` 新增绑定 `approvalRecordFingerprint`，让正式执行门禁明确包含 approval record contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight approval record contract selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 approval record version/status/created/fingerprint/inputs，明确当前 Admin 只展示 approval record contract，不创建记录。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-approval-record/v1`、`not_created_read_only`、`approvalRecordCreated=false`、16 位 approval record fingerprint 与六项 approval record inputs；篡改 submission 时 approval record fingerprint 会随 approval request/review binding 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace approval record contract 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“暴露审批请求输入边界的只读预检”推进到“同时声明未来 approval record 输入边界且不创建记录的只读预检”，为后续正式 repair mutation、Agent Runtime approval record、持久化 idempotency lock、审计事件和 rollback 提供更明确的 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `approvalRecordFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted approval record id、approval state machine、authorization grant、audit event id、repair job id、execution state 或 rollback plan。
- approval record contract 当前不记录 approval decision、不获取 actor session/token id、不写入 DB，也不持久化 policy/capability registry version；后续正式 mutation 仍需要把这些字段纳入 approval record 和 audit event。
- Admin 目前只展示 approval record contract，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 261. P1 落地记录：Repair Preflight Audit Event Contract Snapshot

本轮继续收敛第 260 节剩余风险中 “approval record contract 当前不记录 approval decision、不写入 DB，也不持久化 audit event”。实际代码与目标架构的冲突点是：
preflight 已经有 actor/audit binding 和 approval record contract，但仍没有明确未来正式 audit event 应绑定哪些只读输入，也没有明确当前 preflight 不创建审计事件。后续正式 repair mutation、Agent Runtime job 或审批执行如果直接从 approval record、repair job、policy binding 和 operation set 分散拼装 audit event，容易遗漏 submission、workspace scope 或 repair job contract。本轮在只读 preflight 上新增 audit event contract snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `auditEventVersion`、`auditEventStatus`、`auditEventCreated`、`auditEventFingerprint` 与 `auditEventInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 audit event contract 版本为 `repair-preflight-audit-event/v1`，当前 `auditEventStatus=not_created_read_only` 且 `auditEventCreated=false`。
  - `auditEventFingerprint` 绑定 `actorFingerprint`、`approvalRecordFingerprint`、`auditBindingFingerprint`、`operationSetFingerprint`、`policyBindingFingerprint`、`repairJobFingerprint`、`submissionFingerprint` 与 workspaceId，明确未来审计事件的输入边界。
  - `executionGateInputs` 与 `executionGateFingerprint` 新增绑定 `auditEventFingerprint`，让正式执行门禁明确包含 audit event contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight audit event contract selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 audit event version/status/created/fingerprint/inputs，明确当前 Admin 只展示 audit event contract，不创建事件。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-audit-event/v1`、`not_created_read_only`、`auditEventCreated=false`、16 位 audit event fingerprint 与七项 audit event inputs；篡改 submission 时 audit event fingerprint 会随 approval record/repair job contract 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace audit event contract 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“声明未来 approval record 输入边界且不创建记录的只读预检”推进到“同时声明未来 audit event 输入边界且不创建事件的只读预检”，为后续正式 repair mutation、Agent Runtime job、持久化 idempotency lock、审计事件和 rollback 提供更完整的执行前 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 focused resolver smoke、Admin AI Vitest、prettier、oxlint 与本轮文件的 `git diff --check`；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `auditEventFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted audit event id、approval decision、authorization grant、repair job execution state 或 rollback plan。
- audit event contract 当前不写入 DB，不记录真实 request/session/token id，不持久化 policy/capability registry version，也不包含执行结果；后续正式 mutation 仍需要把这些字段纳入审计事件和 job 状态机。
- Admin 目前只展示 audit event contract，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 262. P1 落地记录：Repair Preflight Execution State Contract Snapshot

本轮继续收敛第 261 节剩余风险中 “`auditEventFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted audit event id、approval decision、authorization grant、repair job execution state 或 rollback plan”。实际代码与目标架构的冲突点是：
preflight 已经声明 future repair job 与 audit event 的输入边界，但仍没有明确正式 job 状态机启动前应绑定哪些只读输入，也没有明确当前 preflight 不创建执行状态。后续正式 repair mutation、Agent Runtime job 或审批执行如果直接从 audit event、idempotency、repair job 和 operation set 分散拼装 execution state，容易遗漏 submission、review binding 或 workspace scope。本轮在只读 preflight 上新增 execution state contract snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `executionStateVersion`、`executionStateStatus`、`executionStateCreated`、`executionStateFingerprint` 与 `executionStateInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 execution state contract 版本为 `repair-preflight-execution-state/v1`，当前 `executionStateStatus=not_started_read_only` 且 `executionStateCreated=false`。
  - `executionStateFingerprint` 绑定 `auditEventFingerprint`、`idempotencyFingerprint`、`operationSetFingerprint`、`repairJobFingerprint`、`reviewBindingFingerprint`、`submissionFingerprint` 与 workspaceId，明确未来 repair job execution state 的输入边界。
  - `executionGateInputs` 与 `executionGateFingerprint` 新增绑定 `executionStateFingerprint`，让正式执行门禁明确包含 execution state contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight execution state contract selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 execution state version/status/created/fingerprint/inputs，明确当前 Admin 只展示 execution state contract，不启动状态机。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-execution-state/v1`、`not_started_read_only`、`executionStateCreated=false`、16 位 execution state fingerprint 与六项 execution state inputs；篡改 submission 时 execution state fingerprint 会随 audit event/job/review binding 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace execution state contract 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“声明未来 audit event 输入边界且不创建事件的只读预检”推进到“同时声明未来 execution state 输入边界且不启动状态机的只读预检”，为后续正式 repair mutation、Agent Runtime job、持久化 idempotency lock、审计事件、执行状态机和 rollback 提供更完整的执行前 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 field-chain `rg`、`git diff --check`、container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `executionStateFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted job execution state id、audit event result、approval decision、authorization grant、rollback checkpoint 或状态机事件。
- execution state contract 当前不写入 DB，不记录真实 request/session/token id，不持久化 policy/capability registry version，也不包含执行结果、失败原因、retry metadata 或 rollback checkpoint；后续正式 mutation 仍需要把这些字段纳入 job 状态机和审计事件。
- Admin 目前只展示 execution state contract，没有人工审批 UI、差异预览、执行按钮或 job 状态轮询。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 263. P1 落地记录：Repair Preflight Rollback Plan Contract Snapshot

本轮继续收敛第 262 节剩余风险中 “execution state contract 当前不写入 DB，不记录真实 request/session/token id，不持久化 policy/capability registry version，也不包含执行结果、失败原因、retry metadata 或 rollback checkpoint”。实际代码与目标架构的冲突点是：
preflight 已经声明 future execution state 输入边界，但仍没有明确正式 repair job 在执行前应绑定哪些 rollback checkpoint 输入，也没有明确当前 preflight 不创建回滚计划。后续正式 repair mutation、Agent Runtime job 或审批执行如果只从 execution state、audit event 和 operation set 分散拼装 rollback plan，容易遗漏 review binding、submission 或 workspace scope。本轮在只读 preflight 上新增 rollback plan contract snapshot。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairPreflightType` 新增 `rollbackPlanVersion`、`rollbackPlanStatus`、`rollbackPlanCreated`、`rollbackPlanFingerprint` 与 `rollbackPlanInputs`。
  - `buildPromptRegistryRepairPreflight()` 固定 rollback plan contract 版本为 `repair-preflight-rollback-plan/v1`，当前 `rollbackPlanStatus=not_created_read_only` 且 `rollbackPlanCreated=false`。
  - `rollbackPlanFingerprint` 绑定 `auditEventFingerprint`、`executionStateFingerprint`、`operationSetFingerprint`、`repairJobFingerprint`、`reviewBindingFingerprint`、`submissionFingerprint` 与 workspaceId，明确未来 rollback checkpoint 的输入边界。
  - `executionGateInputs` 与 `executionGateFingerprint` 新增绑定 `rollbackPlanFingerprint`，让正式执行门禁明确包含 rollback plan contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 preflight rollback plan contract selection 与类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate diagnostics 的 `Repair action preflight ...` 汇总新增 rollback plan version/status/created/fingerprint/inputs，明确当前 Admin 只展示 rollback plan contract，不创建计划。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 workspace preflight 返回 `repair-preflight-rollback-plan/v1`、`not_created_read_only`、`rollbackPlanCreated=false`、16 位 rollback plan fingerprint 与六项 rollback plan inputs；篡改 submission 时 rollback plan fingerprint 会随 execution state/audit event/job/review binding 变化。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 preflight mock 与 ready、workspace action dry-run failed、blocked registry diagnostics 断言，覆盖 global/workspace rollback plan contract 展示。

该实现新增 GraphQL object 字段，但不新增 DB migration，不新增 mutation，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“声明未来 execution state 输入边界且不启动状态机的只读预检”推进到“同时声明未来 rollback plan 输入边界且不创建计划的只读预检”，为后续正式 repair mutation、Agent Runtime job、持久化 idempotency lock、审计事件、执行状态机、回滚 checkpoint 和 rollback 执行提供更完整的执行前 contract。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 field-chain `rg`、`git diff --check`、container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `rollbackPlanFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback plan id、rollback checkpoint、job execution event、audit result 或状态机事件。
- rollback plan contract 当前不写入 DB，不记录真实 request/session/token id，不持久化 policy/capability registry version，也不包含可执行 inverse operation、数据快照、恢复顺序、失败补偿或 rollback result；后续正式 mutation 仍需要把这些字段纳入 job 状态机、审计事件和回滚执行器。
- Admin 目前只展示 rollback plan contract，没有人工审批 UI、差异预览、执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 264. P1 落地记录：Repair Execution Request Mutation Read-only Gate

本轮继续收敛第 263 节剩余风险中 “后续正式 mutation 仍需要把这些字段纳入 job 状态机、审计事件和回滚执行器”。实际代码与目标架构的冲突点是：
preflight 已经声明 submission、permission、approval、audit event、execution state 与 rollback plan 的输入边界，但 GraphQL 仍没有一个正式写入口形状可以承接客户端回传的 preflight fingerprints。如果后续直接新增可执行 repair mutation，会同时引入输入校验、权限、幂等锁、job 创建和审计写入，风险过大。本轮先新增 `requestCopilotPromptRegistryRepairExecution` mutation，作为正式执行入口的只读受阻壳层：它重新运行 preflight、校验客户端回传的 execution/rollback/idempotency 等关键 fingerprint，但固定返回 `blocked_*`，不创建任何持久化状态。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryRepairExecutionRequestInput`，要求客户端回传 workspace/name/submission/expectedVersion，以及 approval record、approval request、audit event、execution gate、execution state、idempotency、policy binding、preflight status、repair job、review binding、rollback plan 等 expected fingerprints。
  - 新增 `CopilotPromptRegistryRepairExecutionRequestType`，返回 `requestVersion=repair-execution-request/v1`、`requestStatus`、`requestFingerprint`、matched/mismatched fields、`readOnly=true`、`mutationAvailable=false`、`accepted=false`、`executionRequested=false` 与当前 preflight。
  - 抽出 `buildPromptRegistryRepairPreflightForCurrentUser()`，让 preflight query 与 execution request mutation 共用同一套权限、route readiness、approval/capability/policy 和 stale 校验逻辑。
  - 新增 `requestCopilotPromptRegistryRepairExecution(...)` mutation；当前只读执行请求会重新构建 preflight 并返回 `blocked_read_only`、`blocked_stale_preflight` 或 `blocked_stale_submission`，不写 DB、不获取幂等锁、不创建 repair job、不生成 approval/audit/rollback 记录。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation schema、operation 文档与 generated 类型。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 直接调用 mutation，断言匹配 preflight 时返回 `repair-execution-request/v1`、`blocked_read_only`、16 位 request fingerprint、全量 matched fields、空 mismatched fields、`accepted=false`、`executionRequested=false`，且返回 preflight 绑定到 execution gate 与 rollback plan fingerprint。
  - 同一 smoke 覆盖篡改 `expectedExecutionGateFingerprint` 时返回 `blocked_stale_preflight`，request fingerprint 随 mismatched field 改变。

该实现新增 GraphQL mutation 形状，但仍不新增 DB migration，不新增持久化 mutation 行为，不改变 Prompt Registry 发布语义、provider route policy、provider route selection、fallback、native dispatch、action run 状态机、embedding/rerank 执行路径或 publish blocker。它把 repair preflight 从“只读预检对象”推进到“正式写入口的只读受阻壳层”，为后续逐步接入持久化 idempotency lock、approval record、audit event、repair job queue、execution state machine 和 rollback executor 提供稳定 GraphQL contract。

验证策略：

- 本轮为 TypeScript/GraphQL/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 field-chain `rg`、`git diff --check`、container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest；当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、固定 image id、不传 `--build`、`--pull never` 和镜像 ID 前后不变作为不重建证据。

剩余风险：

- `requestCopilotPromptRegistryRepairExecution` 当前是只读受阻 mutation；它不获取持久化幂等锁、不创建 repair job、不写 approval record、不写 audit event、不启动 execution state，也不创建 rollback checkpoint。
- mutation 目前只校验客户端回传的关键 fingerprint 与当前 preflight 是否一致；正式执行仍需要把 permission/capability/policy registry version、actor session/token id、request id、job id、audit event id 和 rollback checkpoint id 纳入持久化记录。
- Admin 目前仍只展示 preflight diagnostics，没有调用该 mutation，也没有人工审批 UI、差异预览、执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 265. P1 落地记录：Admin Repair Execution Request Gate Check

本轮继续收敛第 264 节剩余风险中 “Admin 目前仍只展示 preflight diagnostics，没有调用该 mutation”。实际代码与目标架构的冲突点是：
后端已经提供 `requestCopilotPromptRegistryRepairExecution` 只读受阻 mutation，但 Admin 诊断页仍只展示 publish gate 与 repair preflight，缺少一个客户端侧的 contract 回传路径来验证 UI 能否按正式执行入口形状提交 expected fingerprints。如果直接加入“执行修复”按钮，会与当前只读 gate 语义冲突。本轮只新增显式的 `Check request gate` 诊断动作：用户点击后调用 mutation，展示 request snapshot，但不创建执行按钮、不启动 job、不轮询状态。

- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - 引入 `requestCopilotPromptRegistryRepairExecutionMutation` 与 Admin `useMutation`。
  - 新增 `buildPromptRegistryRepairSubmissionInput()`，复用 publish gate 的 `repairActionPreview.submissionContract` 构造 preflight query 与 execution request mutation 的 submission input，避免前端两处手写 contract 字段漂移。
  - 新增 `buildPromptRegistryRepairExecutionRequestInput()`，把当前 `repairPreflight` 的 approval record、approval request、audit event、execution gate、execution state、idempotency、policy binding、repair job、review binding、rollback plan 与 preflight status fingerprints 回填为 expected inputs。
  - `PromptRegistryPublishGateQueryResult` 新增本地 request snapshot 状态；只有点击 `Check request gate` 时才调用 mutation，渲染切换 prompt/workspace 时通过 key 重置旧 snapshot。
  - `buildPromptRegistryPublishGateDiagnosticsText()` 与 `formatPromptRegistryRepairExecutionRequest()` 新增 `Repair execution request ...` 诊断行，展示 `repair-execution-request/v1`、`blocked_read_only`、matched/mismatched fields、request fingerprint 与返回 preflight 的关键 fingerprints。
- `packages/frontend/admin/src/modules/ai/index.spec.tsx`：
  - mock Admin `useMutation` 与 `requestCopilotPromptRegistryRepairExecutionMutation`。
  - 新增交互覆盖：渲染 Admin 诊断页不会自动调用 mutation；点击 `Check request gate` 后提交 name、workspaceId、expectedVersion、submission contract 与 preflight expected fingerprints；返回 snapshot 后诊断文本包含只读 blocked request gate、execution gate fingerprint 与 workspace scope。

该实现只把只读 mutation 接入 Admin 诊断面板，不新增 repair execution UI，不改变 publish gate/preflight resolver 行为，不新增 DB migration，不写 approval/audit/job/rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/Admin UI/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 首次 Admin Vitest 使用了当前容器内不支持的 `--runInBand` 参数而失败；随后改用 `yarn vitest run packages/frontend/admin/src/modules/ai/index.spec.tsx`。第二次失败暴露容器 `/workspace` 未同步当前分支的 `packages/frontend/core/src/modules/ai-button/services/models.ts`，导致 Admin 导入旧 helper；补同步该依赖文件后，Admin AI Vitest 通过：`1 passed, 20 tests passed`。

剩余风险：

- Admin 的 `Check request gate` 仍是只读诊断动作；它不提供人工审批 UI、差异预览、正式执行按钮、repair job 创建、job 状态轮询或 rollback 操作入口。
- request gate snapshot 未持久化；页面刷新或切换 prompt/workspace 会丢弃本地结果。
- mutation 返回仍固定 blocked，不获取持久化幂等锁、不创建 approval record、不写 audit event、不启动 execution state，也不创建 rollback checkpoint。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 266. P1 落地记录：Repair Execution Request Idempotency Lock Contract Snapshot

本轮继续收敛第 265 节剩余风险中 “mutation 返回仍固定 blocked，不获取持久化幂等锁”。实际代码与目标架构的冲突点是：
`requestCopilotPromptRegistryRepairExecution` 已经作为正式 repair execution 入口的只读受阻壳层存在，但它只返回 request/preflight 基础信息，没有明确未来正式执行在获取 persisted idempotency lock 前应绑定哪些输入。后续如果直接在 mutation 内写入锁，容易把 preflight idempotency、review binding、policy binding、submission fingerprint 与 request status 分散拼装。本轮新增 execution request 级别的 idempotency lock contract snapshot，继续保持只读、不获取锁。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `idempotencyLockVersion`、`idempotencyLockStatus`、`idempotencyLockAcquired`、`idempotencyLockScope`、`idempotencyLockFingerprint` 与 `idempotencyLockInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 idempotency lock 版本为 `repair-execution-idempotency-lock/v1`，当前 `idempotencyLockStatus=not_acquired_read_only` 且 `idempotencyLockAcquired=false`。
  - `idempotencyLockFingerprint` 绑定 preflight `idempotencyFingerprint`、`idempotencyKey`、`policyBindingFingerprint`、`reviewBindingFingerprint`、当前 submission fingerprint、request status、scope 与 workspaceId，明确未来 persisted lock request 的输入边界。
  - `requestFingerprint` 新增绑定 `idempotencyLockFingerprint`，让客户端看到的 execution request snapshot 覆盖未来锁请求 contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 idempotency lock version/status/scope/acquired/fingerprint/inputs，明确当前仅展示 lock contract，不获取锁。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-idempotency-lock/v1`、`not_acquired_read_only`、workspace scope、`idempotencyLockAcquired=false`、16 位 lock fingerprint 与六项 lock inputs。
  - 同一 smoke 覆盖 stale preflight request 的 lock fingerprint 会随 request status 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 idempotency lock contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建锁记录，不改变 request mutation 的 blocked 语义，不写 approval/audit/job/rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 运行器校正：直接用 `tsx` 跑 smoke 会因为 Nest 参数装饰器未按 server tsconfig 编译而失败；改用仓库 runner `yarn r packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 后通过。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `idempotencyLockFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted idempotency lock id。
- mutation 仍不获取锁、不写 DB、不处理锁冲突、不记录 request/session/token id、不关联 approval record/audit event/repair job，也不实现 retry 或 lock expiry。
- Admin 仍只展示 request gate 与 idempotency lock contract，没有人工审批 UI、差异预览、正式执行按钮、repair job 创建、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 267. P1 落地记录：Repair Execution Request Approval Record Contract Snapshot

本轮继续收敛第 266 节剩余风险中 “mutation 仍不获取锁、不写 DB、不关联 approval record/audit event/repair job”。实际代码与目标架构的冲突点是：
execution request 已经声明 persisted idempotency lock 的只读请求边界，但还没有在 execution request 层明确未来正式 approval record 应绑定哪些输入。preflight 里虽然已有 approval record contract，但正式 mutation 入口还需要把 request status、idempotency lock request、actor、policy、audit binding 和 review binding 组合成同一个审批记录请求快照。本轮新增 execution request 级别的 approval record request contract snapshot，继续保持只读、不创建审批记录。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `approvalRecordRequestVersion`、`approvalRecordRequestStatus`、`approvalRecordRequestCreated`、`approvalRecordRequestFingerprint` 与 `approvalRecordRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 approval record request 版本为 `repair-execution-approval-record-request/v1`，当前 `approvalRecordRequestStatus=not_created_read_only` 且 `approvalRecordRequestCreated=false`。
  - `approvalRecordRequestFingerprint` 绑定 `actorFingerprint`、preflight `approvalRecordFingerprint`、`approvalRequestFingerprint`、`auditBindingFingerprint`、`policyBindingFingerprint`、`reviewBindingFingerprint`、execution request `idempotencyLockFingerprint`、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `approvalRecordRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 approval record request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 approval record request version/status/created/fingerprint/inputs，明确当前仅展示 approval record request contract，不创建记录。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-approval-record-request/v1`、`not_created_read_only`、`approvalRecordRequestCreated=false`、16 位 request fingerprint 与九项 approval record request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 approval record request fingerprint 会随 request status/idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 approval record request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 approval record，不改变 request mutation 的 blocked 语义，不写 audit/job/rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `approvalRecordRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted approval record id。
- mutation 仍不写 DB、不创建 approval record、不记录 approval decision、不关联真实 actor session/token id、不写 audit event、不创建 repair job，也不实现审批状态机。
- Admin 仍只展示 request gate、idempotency lock 和 approval record request contract，没有人工审批 UI、差异预览、正式执行按钮、repair job 创建、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 268. P1 落地记录：Repair Execution Request Audit Event Contract Snapshot

本轮继续收敛第 267 节剩余风险中 “mutation 仍不写 DB、不创建 approval record、不写 audit event”。实际代码与目标架构的冲突点是：
execution request 已经声明 idempotency lock 与 approval record request 的只读边界，但还没有在正式 mutation 入口层明确未来 audit event 应绑定哪些 request 级输入。preflight 有 audit event contract，approval record request 也已有快照，但正式审计事件需要把 approval record request、idempotency lock request、operation set、repair job、policy binding、submission 与 request status 合并到同一个 request snapshot。本轮新增 execution request 级别的 audit event request contract snapshot，继续保持只读、不创建审计事件。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `auditEventRequestVersion`、`auditEventRequestStatus`、`auditEventRequestCreated`、`auditEventRequestFingerprint` 与 `auditEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 audit event request 版本为 `repair-execution-audit-event-request/v1`，当前 `auditEventRequestStatus=not_created_read_only` 且 `auditEventRequestCreated=false`。
  - `auditEventRequestFingerprint` 绑定 `actorFingerprint`、`approvalRecordRequestFingerprint`、preflight `auditBindingFingerprint`、`auditEventFingerprint`、execution request `idempotencyLockFingerprint`、submission `operationSetFingerprint`、`policyBindingFingerprint`、`repairJobFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `auditEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 audit event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 audit event request version/status/created/fingerprint/inputs，明确当前仅展示 audit event request contract，不创建事件。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-audit-event-request/v1`、`not_created_read_only`、`auditEventRequestCreated=false`、16 位 request fingerprint 与十一项 audit event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 audit event request fingerprint 会随 request status、approval record request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 audit event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 audit event，不改变 request mutation 的 blocked 语义，不写 job/rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `auditEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted audit event id。
- mutation 仍不写 DB、不创建 audit event、不记录 approval decision 或执行结果、不关联真实 request/session/token id，也不创建 repair job 或 rollback checkpoint。
- Admin 仍只展示 request gate、idempotency lock、approval record request 和 audit event request contract，没有人工审批 UI、差异预览、正式执行按钮、repair job 创建、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 269. P1 落地记录：Repair Execution Request Repair Job Request Contract Snapshot

本轮继续收敛第 268 节剩余风险中 “mutation 仍不写 DB、不创建 audit event、不记录 approval decision 或执行结果、不关联真实 request/session/token id，也不创建 repair job 或 rollback checkpoint”。实际代码与目标架构的冲突点是：
execution request 已经声明 idempotency lock、approval record request 与 audit event request 的只读边界，但还没有在正式 mutation 入口层明确未来 repair job queue record 应绑定哪些 request 级输入。preflight 里已有 `repair-preflight-job-contract/v1`，但正式 job 创建请求需要把 approval record request、audit event request、idempotency lock request、operation set、review/policy binding、submission 与 request status 合并到同一个 request snapshot。本轮新增 execution request 级别的 repair job request contract snapshot，继续保持只读、不创建 job。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `repairJobRequestVersion`、`repairJobRequestStatus`、`repairJobRequestCreated`、`repairJobRequestFingerprint` 与 `repairJobRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 repair job request 版本为 `repair-execution-repair-job-request/v1`，当前 `repairJobRequestStatus=not_created_read_only` 且 `repairJobRequestCreated=false`。
  - `repairJobRequestFingerprint` 绑定 `actorFingerprint`、`approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、execution request `idempotencyLockFingerprint`、submission `operationSetFingerprint`、`policyBindingFingerprint`、preflight `repairJobFingerprint`、`reviewBindingFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `repairJobRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 repair job request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 repair job request version/status/created/fingerprint/inputs，明确当前仅展示 job request contract，不创建队列任务。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-repair-job-request/v1`、`not_created_read_only`、`repairJobRequestCreated=false`、16 位 request fingerprint 与十一项 repair job request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 repair job request fingerprint 会随 request status、audit event request、approval record request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 repair job request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 repair job，不改变 request mutation 的 blocked 语义，不写 execution state/rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `repairJobRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted repair job id 或 queue record id。
- mutation 仍不写 DB、不创建 repair job、不启动 execution state、不记录执行结果、不关联真实 request/session/token id，也不创建 rollback checkpoint。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request 和 repair job request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 270. P1 落地记录：Repair Execution Request Execution State Request Contract Snapshot

本轮继续收敛第 269 节剩余风险中 “mutation 仍不写 DB、不创建 repair job、不启动 execution state”。实际代码与目标架构的冲突点是：
execution request 已经声明 repair job request 的只读边界，但还没有在正式 mutation 入口层明确未来启动 job execution state 前应绑定哪些 request 级输入。preflight 里已有 `repair-preflight-execution-state/v1`，但正式 execution state request 需要把 audit event request、repair job request、idempotency lock request、operation set、review binding、submission 与 request status 合并到同一个 request snapshot。本轮新增 execution request 级别的 execution state request contract snapshot，继续保持只读、不启动状态机。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionStateRequestVersion`、`executionStateRequestStatus`、`executionStateRequestCreated`、`executionStateRequestFingerprint` 与 `executionStateRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 execution state request 版本为 `repair-execution-state-request/v1`，当前 `executionStateRequestStatus=not_started_read_only` 且 `executionStateRequestCreated=false`。
  - `executionStateRequestFingerprint` 绑定 `auditEventRequestFingerprint`、preflight `executionStateFingerprint`、execution request `idempotencyLockFingerprint`、submission `operationSetFingerprint`、`repairJobRequestFingerprint`、`reviewBindingFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionStateRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution state request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution state request version/status/created/fingerprint/inputs，明确当前仅展示 execution state request contract，不启动状态机。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-state-request/v1`、`not_started_read_only`、`executionStateRequestCreated=false`、16 位 request fingerprint 与九项 execution state request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution state request fingerprint 会随 request status、audit event request、repair job request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution state request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不启动 execution state，不改变 request mutation 的 blocked 语义，不写 rollback 状态，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionStateRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted execution state id 或 job state machine event id。
- mutation 仍不写 DB、不启动 execution state、不记录执行结果、失败原因、retry metadata 或真实 request/session/token id，也不创建 rollback checkpoint。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request 和 execution state request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 271. P1 落地记录：Repair Execution Request Rollback Plan Request Contract Snapshot

本轮继续收敛第 270 节剩余风险中 “mutation 仍不写 DB、不启动 execution state、不记录执行结果、失败原因、retry metadata 或真实 request/session/token id，也不创建 rollback checkpoint”。实际代码与目标架构的冲突点是：
execution request 已经声明 execution state request 的只读边界，但还没有在正式 mutation 入口层明确未来创建 rollback checkpoint 前应绑定哪些 request 级输入。preflight 里已有 `repair-preflight-rollback-plan/v1`，但正式 rollback plan request 需要把 audit event request、execution state request、repair job request、operation set、review binding、submission 与 request status 合并到同一个 request snapshot。本轮新增 execution request 级别的 rollback plan request contract snapshot，继续保持只读、不创建 checkpoint。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `rollbackPlanRequestVersion`、`rollbackPlanRequestStatus`、`rollbackPlanRequestCreated`、`rollbackPlanRequestFingerprint` 与 `rollbackPlanRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 rollback plan request 版本为 `repair-execution-rollback-plan-request/v1`，当前 `rollbackPlanRequestStatus=not_created_read_only` 且 `rollbackPlanRequestCreated=false`。
  - `rollbackPlanRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionStateRequestFingerprint`、submission `operationSetFingerprint`、`repairJobRequestFingerprint`、`reviewBindingFingerprint`、preflight `rollbackPlanFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `rollbackPlanRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 rollback checkpoint request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 rollback plan request version/status/created/fingerprint/inputs，明确当前仅展示 rollback checkpoint request contract，不创建计划或 checkpoint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-rollback-plan-request/v1`、`not_created_read_only`、`rollbackPlanRequestCreated=false`、16 位 request fingerprint 与九项 rollback plan request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 rollback plan request fingerprint 会随 request status、audit event request、execution state request 与 repair job request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 rollback plan request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 rollback plan 或 checkpoint，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `rollbackPlanRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback checkpoint id、rollback plan id 或 job state event id。
- mutation 仍不写 DB、不创建 rollback checkpoint、不记录 rollback executor payload、执行结果、失败原因、retry metadata 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request 和 rollback plan request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 272. P1 落地记录：Repair Execution Request Execution Trace Request Contract Snapshot

本轮继续收敛第 271 节剩余风险中 “mutation 仍不写 DB、不创建 rollback checkpoint、不记录 rollback executor payload、执行结果、失败原因、retry metadata 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 rollback plan request 的只读边界，但还没有在正式 mutation 入口层明确未来持久化 request/session/token/trace 记录前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接从 approval、audit、job、execution state 与 rollback request 分散拼装 trace payload，容易遗漏 actor、idempotency、submission 或 request status。本轮新增 execution request 级别的 execution trace request contract snapshot，继续保持只读、不创建 trace 记录。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionTraceRequestVersion`、`executionTraceRequestStatus`、`executionTraceRequestCreated`、`executionTraceRequestFingerprint` 与 `executionTraceRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 execution trace request 版本为 `repair-execution-trace-request/v1`，当前 `executionTraceRequestStatus=not_created_read_only` 且 `executionTraceRequestCreated=false`。
  - `executionTraceRequestFingerprint` 绑定 `actorFingerprint`、`approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、`executionStateRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionTraceRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 persisted trace request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution trace request version/status/created/fingerprint/inputs，明确当前仅展示 persisted trace request contract，不创建 request/session/token/trace 记录。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-trace-request/v1`、`not_created_read_only`、`executionTraceRequestCreated=false`、16 位 request fingerprint 与十项 execution trace request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution trace request fingerprint 会随 request status、approval record request、audit event request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution trace request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 request/session/token/trace 记录，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionTraceRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted request id、session id、token id 或 trace id。
- mutation 仍不写 DB、不创建 persisted trace、不记录执行结果、失败原因、retry metadata、latency、provider response、rollback executor payload 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request 和 execution trace request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 273. P1 落地记录：Repair Execution Request Execution Result Request Contract Snapshot

本轮继续收敛第 272 节剩余风险中 “mutation 仍不写 DB、不创建 persisted trace、不记录执行结果、失败原因、retry metadata、latency、provider response、rollback executor payload 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 persisted trace request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 execution result 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把执行结果、失败原因、retry metadata、latency 或 provider response 写入审计/trace，而不绑定 trace、execution state、job、rollback 与 submission 快照，容易出现结果记录和请求 contract 漂移。本轮新增 execution request 级别的 execution result request contract snapshot，继续保持只读、不记录结果。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionResultRequestVersion`、`executionResultRequestStatus`、`executionResultRequestCreated`、`executionResultRequestFingerprint` 与 `executionResultRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 execution result request 版本为 `repair-execution-result-request/v1`，当前 `executionResultRequestStatus=not_recorded_read_only` 且 `executionResultRequestCreated=false`。
  - `executionResultRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionResultRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution result request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution result request version/status/created/fingerprint/inputs，明确当前仅展示 result recording request contract，不记录执行结果、失败原因、retry metadata、latency 或 provider response。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-result-request/v1`、`not_recorded_read_only`、`executionResultRequestCreated=false`、16 位 request fingerprint 与八项 execution result request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution result request fingerprint 会随 request status、audit event request、execution state request、execution trace request、repair job request 与 rollback plan request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution result request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录 execution result，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionResultRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted execution result id、failure event id 或 retry event id。
- mutation 仍不写 DB、不记录执行结果、失败原因、retry metadata、latency、provider response、rollback executor payload 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request 和 execution result request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 274. P1 落地记录：Repair Execution Request Retry Policy Request Contract Snapshot

本轮继续收敛第 273 节剩余风险中 “mutation 仍不写 DB、不记录执行结果、失败原因、retry metadata、latency、provider response、rollback executor payload 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 execution result request 的只读边界，但还没有在正式 mutation 入口层明确未来 retry/failure policy 记录前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把 retry policy、failure event 或 provider response 记录挂到 result/trace 之后，而不绑定 idempotency、rollback、job、execution state 与 submission 快照，容易出现同一次 repair request 的重试策略与执行结果漂移。本轮新增 execution request 级别的 execution retry policy request contract snapshot，继续保持只读、不创建 retry policy 或 failure event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRetryPolicyRequestVersion`、`executionRetryPolicyRequestStatus`、`executionRetryPolicyRequestCreated`、`executionRetryPolicyRequestFingerprint` 与 `executionRetryPolicyRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 retry policy request 版本为 `repair-execution-retry-policy-request/v1`，当前 `executionRetryPolicyRequestStatus=not_created_read_only` 且 `executionRetryPolicyRequestCreated=false`。
  - `executionRetryPolicyRequestFingerprint` 绑定 `executionResultRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRetryPolicyRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 retry/failure policy request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution retry policy request version/status/created/fingerprint/inputs，明确当前仅展示 retry policy request contract，不创建 retry policy、failure event、provider response 或 latency 记录。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-retry-policy-request/v1`、`not_created_read_only`、`executionRetryPolicyRequestCreated=false`、16 位 request fingerprint 与九项 execution retry policy request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution retry policy request fingerprint 会随 request status、execution result request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution retry policy request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 retry policy/failure event/provider response 记录，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRetryPolicyRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry policy id、failure event id、provider response id 或 latency event id。
- mutation 仍不写 DB、不记录 retry policy、失败原因、latency、provider response、rollback executor payload 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request 和 execution retry policy request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 275. P1 落地记录：Repair Execution Request Provider Response Request Contract Snapshot

本轮继续收敛第 274 节剩余风险中 “mutation 仍不写 DB、不记录 retry policy、失败原因、latency、provider response、rollback executor payload 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry policy request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 provider response 与 latency metadata 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把 provider response、latency 或 failure metadata 写入 trace/result，而不绑定 audit event request、retry policy、idempotency、rollback、job、execution state 与 submission 快照，容易出现 provider response 记录和 execution request contract 漂移。本轮新增 execution request 级别的 execution provider response request contract snapshot，继续保持只读、不记录 provider response 或 latency。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionProviderResponseRequestVersion`、`executionProviderResponseRequestStatus`、`executionProviderResponseRequestCreated`、`executionProviderResponseRequestFingerprint` 与 `executionProviderResponseRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 provider response request 版本为 `repair-execution-provider-response-request/v1`，当前 `executionProviderResponseRequestStatus=not_recorded_read_only` 且 `executionProviderResponseRequestCreated=false`。
  - `executionProviderResponseRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionProviderResponseRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 provider response/latency request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution provider response request version/status/created/fingerprint/inputs，明确当前仅展示 provider response request contract，不记录 provider response、latency 或 failure metadata。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-provider-response-request/v1`、`not_recorded_read_only`、`executionProviderResponseRequestCreated=false`、16 位 request fingerprint 与十一项 execution provider response request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution provider response request fingerprint 会随 request status、audit event request、execution result request、execution retry policy request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution provider response request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 provider response/latency/failure metadata 记录，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionProviderResponseRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted provider response id、latency event id、failure event id 或 retry event id。
- mutation 仍不写 DB、不记录 provider response、latency、retry policy、失败原因、rollback executor payload 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request 和 execution provider response request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 276. P1 落地记录：Repair Execution Request Failure Event Request Contract Snapshot

本轮继续收敛第 275 节剩余风险中 “mutation 仍不写 DB、不记录 provider response、latency、retry policy、失败原因、rollback executor payload 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 provider response request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 failure event 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把失败原因、retry event 或 rollback 触发原因写入 trace/result，而不绑定 provider response request、retry policy、idempotency、rollback、job、execution state 与 submission 快照，容易出现 failure event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution failure event request contract snapshot，继续保持只读、不记录失败事件。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionFailureEventRequestVersion`、`executionFailureEventRequestStatus`、`executionFailureEventRequestCreated`、`executionFailureEventRequestFingerprint` 与 `executionFailureEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 failure event request 版本为 `repair-execution-failure-event-request/v1`，当前 `executionFailureEventRequestStatus=not_recorded_read_only` 且 `executionFailureEventRequestCreated=false`。
  - `executionFailureEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionFailureEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 failure event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution failure event request version/status/created/fingerprint/inputs，明确当前仅展示 failure event request contract，不记录 failure reason、retry event 或 rollback trigger。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-failure-event-request/v1`、`not_recorded_read_only`、`executionFailureEventRequestCreated=false`、16 位 request fingerprint 与十二项 execution failure event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution failure event request fingerprint 会随 request status、audit event request、provider response request、execution result request、execution retry policy request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution failure event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 failure event/retry event/rollback trigger 记录，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionFailureEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted failure event id、retry event id、rollback trigger id 或 provider response id。
- mutation 仍不写 DB、不记录 failure reason、retry event、rollback trigger、provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request 和 execution failure event request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 277. P1 落地记录：Repair Execution Request Rollback Trigger Request Contract Snapshot

本轮继续收敛第 276 节剩余风险中 “mutation 仍不写 DB、不记录 failure reason、retry event、rollback trigger、provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 failure event request 的只读边界，但还没有在正式 mutation 入口层明确未来触发 rollback 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接依据 failure event 或 provider response 启动 rollback executor，而不绑定 retry policy、result、trace、execution state、repair job、rollback plan、idempotency 与 submission 快照，容易出现 rollback trigger 和 execution request contract 漂移。本轮新增 execution request 级别的 execution rollback trigger request contract snapshot，继续保持只读、不创建 rollback trigger。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRollbackTriggerRequestVersion`、`executionRollbackTriggerRequestStatus`、`executionRollbackTriggerRequestCreated`、`executionRollbackTriggerRequestFingerprint` 与 `executionRollbackTriggerRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 rollback trigger request 版本为 `repair-execution-rollback-trigger-request/v1`，当前 `executionRollbackTriggerRequestStatus=not_created_read_only` 且 `executionRollbackTriggerRequestCreated=false`。
  - `executionRollbackTriggerRequestFingerprint` 绑定 `executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRollbackTriggerRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 rollback trigger request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution rollback trigger request version/status/created/fingerprint/inputs，明确当前仅展示 rollback trigger request contract，不触发 rollback executor。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-rollback-trigger-request/v1`、`not_created_read_only`、`executionRollbackTriggerRequestCreated=false`、16 位 request fingerprint 与十二项 execution rollback trigger request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution rollback trigger request fingerprint 会随 request status、failure event request、provider response request、execution result request、execution retry policy request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution rollback trigger request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 rollback trigger，不启动 rollback executor，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRollbackTriggerRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback trigger id、rollback executor job id、failure event id 或 retry event id。
- mutation 仍不写 DB、不触发 rollback executor、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request 和 execution rollback trigger request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 278. P1 落地记录：Repair Execution Request Rollback Executor Request Contract Snapshot

本轮继续收敛第 277 节剩余风险中 “mutation 仍不写 DB、不触发 rollback executor、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 rollback trigger request 的只读边界，但还没有在正式 mutation 入口层明确未来启动 rollback executor job 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接从 rollback trigger 进入 executor，而不绑定 failure event、provider response、result、trace、execution state、repair job、rollback plan、idempotency 与 submission 快照，容易出现 rollback executor job 和 execution request contract 漂移。本轮新增 execution request 级别的 execution rollback executor request contract snapshot，继续保持只读、不启动 executor。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRollbackExecutorRequestVersion`、`executionRollbackExecutorRequestStatus`、`executionRollbackExecutorRequestCreated`、`executionRollbackExecutorRequestFingerprint` 与 `executionRollbackExecutorRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 rollback executor request 版本为 `repair-execution-rollback-executor-request/v1`，当前 `executionRollbackExecutorRequestStatus=not_started_read_only` 且 `executionRollbackExecutorRequestCreated=false`。
  - `executionRollbackExecutorRequestFingerprint` 绑定 `executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRollbackTriggerRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRollbackExecutorRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 rollback executor request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution rollback executor request version/status/created/fingerprint/inputs，明确当前仅展示 rollback executor request contract，不启动 rollback executor job。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-rollback-executor-request/v1`、`not_started_read_only`、`executionRollbackExecutorRequestCreated=false`、16 位 request fingerprint 与十二项 execution rollback executor request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution rollback executor request fingerprint 会随 request status、failure event request、provider response request、execution result request、rollback trigger request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution rollback executor request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 rollback executor job，不启动 rollback executor，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRollbackExecutorRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback executor job id、rollback operation id、failure event id 或 retry event id。
- mutation 仍不写 DB、不创建 rollback executor job、不执行 rollback operation、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request 和 execution rollback executor request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 279. P1 落地记录：Repair Execution Request Rollback Operation Request Contract Snapshot

本轮继续收敛第 278 节剩余风险中 “mutation 仍不写 DB、不创建 rollback executor job、不执行 rollback operation、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 rollback executor request 的只读边界，但还没有在正式 mutation 入口层明确未来创建 rollback operation 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接从 executor job 写入 rollback operation，而不绑定 rollback trigger、failure event、provider response、result、trace、execution state、repair job、rollback plan、idempotency 与 submission 快照，容易出现 rollback operation 和 execution request contract 漂移。本轮新增 execution request 级别的 execution rollback operation request contract snapshot，继续保持只读、不创建 rollback operation。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRollbackOperationRequestVersion`、`executionRollbackOperationRequestStatus`、`executionRollbackOperationRequestCreated`、`executionRollbackOperationRequestFingerprint` 与 `executionRollbackOperationRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 rollback operation request 版本为 `repair-execution-rollback-operation-request/v1`，当前 `executionRollbackOperationRequestStatus=not_created_read_only` 且 `executionRollbackOperationRequestCreated=false`。
  - `executionRollbackOperationRequestFingerprint` 绑定 `executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRollbackExecutorRequestFingerprint`、`executionRollbackTriggerRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRollbackOperationRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 rollback operation request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution rollback operation request version/status/created/fingerprint/inputs，明确当前仅展示 rollback operation request contract，不创建 rollback operation。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-rollback-operation-request/v1`、`not_created_read_only`、`executionRollbackOperationRequestCreated=false`、16 位 request fingerprint 与十三项 execution rollback operation request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution rollback operation request fingerprint 会随 request status、failure event request、provider response request、execution result request、rollback executor request、rollback trigger request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution rollback operation request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 rollback operation，不执行 rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRollbackOperationRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback operation id、rollback executor job id、failure event id 或 retry event id。
- mutation 仍不写 DB、不创建 rollback operation、不执行 rollback 操作、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request 和 execution rollback operation request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 280. P1 落地记录：Repair Execution Request Rollback Outcome Request Contract Snapshot

本轮继续收敛第 279 节剩余风险中 “mutation 仍不写 DB、不创建 rollback operation、不执行 rollback 操作、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 rollback operation request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 rollback outcome 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把 rollback 结果写入 trace/result，而不绑定 rollback operation、executor、trigger、failure event、provider response、execution result、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现 rollback outcome 和 execution request contract 漂移。本轮新增 execution request 级别的 execution rollback outcome request contract snapshot，继续保持只读、不记录 rollback outcome。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRollbackOutcomeRequestVersion`、`executionRollbackOutcomeRequestStatus`、`executionRollbackOutcomeRequestCreated`、`executionRollbackOutcomeRequestFingerprint` 与 `executionRollbackOutcomeRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 rollback outcome request 版本为 `repair-execution-rollback-outcome-request/v1`，当前 `executionRollbackOutcomeRequestStatus=not_recorded_read_only` 且 `executionRollbackOutcomeRequestCreated=false`。
  - `executionRollbackOutcomeRequestFingerprint` 绑定 `executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRollbackExecutorRequestFingerprint`、`executionRollbackOperationRequestFingerprint`、`executionRollbackTriggerRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRollbackOutcomeRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 rollback outcome request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution rollback outcome request version/status/created/fingerprint/inputs，明确当前仅展示 rollback outcome request contract，不记录 rollback outcome。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-rollback-outcome-request/v1`、`not_recorded_read_only`、`executionRollbackOutcomeRequestCreated=false`、16 位 request fingerprint 与十四项 execution rollback outcome request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution rollback outcome request fingerprint 会随 request status、failure event request、provider response request、execution result request、rollback executor request、rollback operation request、rollback trigger request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution rollback outcome request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建 rollback outcome 记录，不执行 rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRollbackOutcomeRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted rollback outcome id、rollback operation id、rollback executor job id 或 failure event id。
- mutation 仍不写 DB、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 281. P1 落地记录：Repair Execution Request Completion Request Contract Snapshot

本轮继续收敛第 280 节剩余风险中 “mutation 仍不写 DB、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 rollback trigger、failure reason、retry event、provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 result 与 rollback outcome 的只读边界，但还没有在正式 mutation 入口层明确未来把 execution 标记完成前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接从 result 或 rollback outcome 进入 completed state，而不绑定 audit event、failure event、provider response、retry policy、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现 completion state 和 execution request contract 漂移。本轮新增 execution request 级别的 execution completion request contract snapshot，继续保持只读、不完成 execution。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionCompletionRequestVersion`、`executionCompletionRequestStatus`、`executionCompletionRequestCreated`、`executionCompletionRequestFingerprint` 与 `executionCompletionRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 completion request 版本为 `repair-execution-completion-request/v1`，当前 `executionCompletionRequestStatus=not_completed_read_only` 且 `executionCompletionRequestCreated=false`。
  - `executionCompletionRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionCompletionRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution completion request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution completion request version/status/created/fingerprint/inputs，明确当前仅展示 completion request contract，不完成 execution。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-completion-request/v1`、`not_completed_read_only`、`executionCompletionRequestCreated=false`、16 位 request fingerprint 与十四项 execution completion request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution completion request fingerprint 会随 request status、audit event request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution completion request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不完成 execution，不创建 completion event，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionCompletionRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted completion event id、completed execution state id、result id 或 rollback outcome id。
- mutation 仍不写 DB、不完成 execution、不记录 completion event、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 completion/rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 282. P1 落地记录：Repair Execution Request Completion Event Request Contract Snapshot

本轮继续收敛第 281 节剩余风险中 “mutation 仍不写 DB、不完成 execution、不记录 completion event、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 completion request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 completion event 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接把 completion event 写入 trace/audit，而不绑定 completion request、audit event、failure event、provider response、retry policy、rollback outcome、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现完成事件和 execution request contract 漂移。本轮新增 execution request 级别的 execution completion event request contract snapshot，继续保持只读、不记录 completion event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionCompletionEventRequestVersion`、`executionCompletionEventRequestStatus`、`executionCompletionEventRequestCreated`、`executionCompletionEventRequestFingerprint` 与 `executionCompletionEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 completion event request 版本为 `repair-execution-completion-event-request/v1`，当前 `executionCompletionEventRequestStatus=not_recorded_read_only` 且 `executionCompletionEventRequestCreated=false`。
  - `executionCompletionEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionCompletionRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionCompletionEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 completion event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution completion event request version/status/created/fingerprint/inputs，明确当前仅展示 completion event request contract，不记录 completion event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-completion-event-request/v1`、`not_recorded_read_only`、`executionCompletionEventRequestCreated=false`、16 位 request fingerprint 与十五项 execution completion event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution completion event request fingerprint 会随 request status、audit event request、completion request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution completion event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录 completion event，不完成 execution，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionCompletionEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted completion event id、completed execution state id、trace event id 或 audit event id。
- mutation 仍不写 DB、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 completion/rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 283. P1 落地记录：Repair Execution Request Finalization Request Contract Snapshot

本轮继续收敛第 282 节剩余风险中 “mutation 仍不写 DB、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 completion event request 的只读边界，但还没有在正式 mutation 入口层明确未来进入最终 finalized 状态前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接依据 completion event 或 rollback outcome 结束 job，而不绑定 completion request、completion event、audit event、failure event、provider response、retry policy、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现最终状态和 execution request contract 漂移。本轮新增 execution request 级别的 execution finalization request contract snapshot，继续保持只读、不 finalize execution。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionFinalizationRequestVersion`、`executionFinalizationRequestStatus`、`executionFinalizationRequestCreated`、`executionFinalizationRequestFingerprint` 与 `executionFinalizationRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 finalization request 版本为 `repair-execution-finalization-request/v1`，当前 `executionFinalizationRequestStatus=not_finalized_read_only` 且 `executionFinalizationRequestCreated=false`。
  - `executionFinalizationRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionCompletionEventRequestFingerprint`、`executionCompletionRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionFinalizationRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 finalization request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution finalization request version/status/created/fingerprint/inputs，明确当前仅展示 finalization request contract，不 finalize execution。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-finalization-request/v1`、`not_finalized_read_only`、`executionFinalizationRequestCreated=false`、16 位 request fingerprint 与十六项 execution finalization request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution finalization request fingerprint 会随 request status、audit event request、completion event request、completion request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution finalization request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录 completion event，不 finalize execution，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionFinalizationRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted finalization event id、completed execution state id、trace event id 或 audit event id。
- mutation 仍不写 DB、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 completion/rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 284. P1 落地记录：Repair Execution Request Finalization Event Request Contract Snapshot

本轮继续收敛第 283 节剩余风险中 “mutation 仍不写 DB、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 finalization request 的只读边界，但还没有在正式 mutation 入口层明确未来记录 finalization event 前应绑定哪些 request 级输入。后续正式 Agent Runtime job 如果直接写入 finalization event 或 completed state，而不绑定 finalization request、completion event、completion request、audit event、failure event、provider response、retry policy、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现 finalization event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution finalization event request contract snapshot，继续保持只读、不记录 finalization event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionFinalizationEventRequestVersion`、`executionFinalizationEventRequestStatus`、`executionFinalizationEventRequestCreated`、`executionFinalizationEventRequestFingerprint` 与 `executionFinalizationEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 finalization event request 版本为 `repair-execution-finalization-event-request/v1`，当前 `executionFinalizationEventRequestStatus=not_recorded_read_only` 且 `executionFinalizationEventRequestCreated=false`。
  - `executionFinalizationEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionCompletionEventRequestFingerprint`、`executionCompletionRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionFinalizationRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionFinalizationEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 finalization event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution finalization event request version/status/created/fingerprint/inputs，明确当前仅展示 finalization event request contract，不记录 finalization event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-finalization-event-request/v1`、`not_recorded_read_only`、`executionFinalizationEventRequestCreated=false`、16 位 request fingerprint 与十七项 execution finalization event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution finalization event request fingerprint 会随 request status、audit event request、completion event request、completion request、finalization request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution finalization event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录 finalization event，不 finalize execution，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionFinalizationEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted finalization event id、completed execution state id、trace event id 或 audit event id。
- mutation 仍不写 DB、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮、job 状态轮询或 completion/rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 285. P1 落地记录：Repair Execution Request Status Poll Request Contract Snapshot

本轮继续收敛第 284 节剩余风险中 “Admin 仍只展示 request gate ... 没有 ... job 状态轮询或 completion/rollback 操作入口”。实际代码与目标架构的冲突点是：
execution request 已经声明 finalization event request 的只读边界，但还没有在正式 mutation 入口层明确未来 job status polling 应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接暴露 polling endpoint，而不绑定 finalization event、finalization request、completion event、completion request、failure event、provider response、result、retry policy、rollback outcome、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现轮询状态和 execution request contract 漂移。本轮新增 execution request 级别的 execution status poll request contract snapshot，继续保持只读、不启动 job polling。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionStatusPollRequestVersion`、`executionStatusPollRequestStatus`、`executionStatusPollRequestCreated`、`executionStatusPollRequestFingerprint` 与 `executionStatusPollRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 status poll request 版本为 `repair-execution-status-poll-request/v1`，当前 `executionStatusPollRequestStatus=not_started_read_only` 且 `executionStatusPollRequestCreated=false`。
  - `executionStatusPollRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionCompletionEventRequestFingerprint`、`executionCompletionRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionFinalizationEventRequestFingerprint`、`executionFinalizationRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionStatusPollRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 status polling request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution status poll request version/status/created/fingerprint/inputs，明确当前仅展示 status poll request contract，不启动 job polling。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-status-poll-request/v1`、`not_started_read_only`、`executionStatusPollRequestCreated=false`、16 位 request fingerprint 与十八项 execution status poll request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution status poll request fingerprint 会随 request status、audit event request、completion event request、completion request、finalization event request、finalization request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution status poll request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不启动 job polling，不记录 finalization event，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionStatusPollRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted polling subscription id、job id、run id 或 execution state id。
- mutation 仍不写 DB、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览、正式执行按钮或 completion/rollback 操作入口。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 286. P1 落地记录：Repair Execution Request Operation Entry Request Contract Snapshot

本轮继续收敛第 285 节剩余风险中 “Admin 仍只展示 request gate ... 没有 ... completion/rollback 操作入口”。实际代码与目标架构的冲突点是：
execution request 已经声明 status polling request 的只读边界，但还没有在正式 mutation 入口层明确未来 completion/rollback 操作入口应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接开放执行、完成或回滚按钮，而不绑定 approval record、audit event、status polling、finalization、completion、failure、provider response、result、retry policy、rollback outcome、execution state、trace、repair job、rollback plan、idempotency 与 submission 快照，容易出现操作入口和 execution request contract 漂移。本轮新增 execution request 级别的 execution operation entry request contract snapshot，继续保持只读、不开放真实操作入口。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionOperationEntryRequestVersion`、`executionOperationEntryRequestStatus`、`executionOperationEntryRequestCreated`、`executionOperationEntryRequestFingerprint` 与 `executionOperationEntryRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 operation entry request 版本为 `repair-execution-operation-entry-request/v1`，当前 `executionOperationEntryRequestStatus=not_opened_read_only` 且 `executionOperationEntryRequestCreated=false`。
  - `executionOperationEntryRequestFingerprint` 绑定 `approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、`executionCompletionEventRequestFingerprint`、`executionCompletionRequestFingerprint`、`executionFailureEventRequestFingerprint`、`executionFinalizationEventRequestFingerprint`、`executionFinalizationRequestFingerprint`、`executionProviderResponseRequestFingerprint`、`executionResultRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRollbackOutcomeRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionOperationEntryRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 operation entry request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution operation entry request version/status/created/fingerprint/inputs，明确当前仅展示 operation entry request contract，不开放正式执行、completion 或 rollback 操作入口。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-operation-entry-request/v1`、`not_opened_read_only`、`executionOperationEntryRequestCreated=false`、16 位 request fingerprint 与二十项 execution operation entry request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution operation entry request fingerprint 会随 request status、approval record request、audit event request、completion event request、completion request、finalization event request、finalization request、status poll request、failure event request、provider response request、execution result request、retry policy request、rollback outcome request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution operation entry request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionOperationEntryRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted operation entry id、UI action id、job id、run id 或 execution state id。
- mutation 仍不写 DB、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有人工审批 UI、差异预览或正式执行按钮。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 287. P1 落地记录：Repair Execution Request Approval UI Request Contract Snapshot

本轮继续收敛第 286 节剩余风险中 “Admin 仍只展示 request gate ... 没有人工审批 UI、差异预览或正式执行按钮”。实际代码与目标架构的冲突点是：
execution request 已经声明 operation entry request 的只读边界，但还没有在正式 Admin 人工审批 UI 层明确未来审批界面渲染应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接渲染审批 UI 或差异预览，而不绑定 approval record、audit event、operation entry、status polling、repair job、rollback plan、idempotency 与 submission 快照，容易出现审批 UI、执行入口和 execution request contract 漂移。本轮新增 execution request 级别的 execution approval UI request contract snapshot，继续保持只读、不渲染正式审批 UI。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionApprovalUiRequestVersion`、`executionApprovalUiRequestStatus`、`executionApprovalUiRequestCreated`、`executionApprovalUiRequestFingerprint` 与 `executionApprovalUiRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 approval UI request 版本为 `repair-execution-approval-ui-request/v1`，当前 `executionApprovalUiRequestStatus=not_rendered_read_only` 且 `executionApprovalUiRequestCreated=false`。
  - `executionApprovalUiRequestFingerprint` 绑定 `approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、`executionOperationEntryRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionApprovalUiRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 approval UI request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution approval UI request version/status/created/fingerprint/inputs，明确当前仅展示 approval UI request contract，不渲染人工审批 UI、差异预览或正式执行按钮。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-approval-ui-request/v1`、`not_rendered_read_only`、`executionApprovalUiRequestCreated=false`、16 位 request fingerprint 与十项 execution approval UI request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution approval UI request fingerprint 会随 request status、approval record request、audit event request、operation entry request、status poll request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution approval UI request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionApprovalUiRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted approval UI request id、approval screen id、diff preview id、UI action id、job id、run id 或 execution state id。
- mutation 仍不写 DB、不渲染人工审批 UI、不生成差异预览、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览或正式执行按钮。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 288. P1 落地记录：Repair Execution Request Diff Preview Request Contract Snapshot

本轮继续收敛第 287 节剩余风险中 “mutation 仍不写 DB、不渲染人工审批 UI、不生成差异预览”。实际代码与目标架构的冲突点是：
execution request 已经声明 approval UI request 的只读边界，但还没有在正式差异预览层明确未来 preview 生成应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接生成或渲染 diff preview，而不绑定 approval UI request、operation entry、approval record、audit event、repair action preview submission、repair job、rollback plan、idempotency 与 request status，容易出现差异预览、审批界面和 execution request contract 漂移。本轮新增 execution request 级别的 execution diff preview request contract snapshot，继续保持只读、不生成真实 diff preview。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionDiffPreviewRequestVersion`、`executionDiffPreviewRequestStatus`、`executionDiffPreviewRequestCreated`、`executionDiffPreviewRequestFingerprint` 与 `executionDiffPreviewRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 diff preview request 版本为 `repair-execution-diff-preview-request/v1`，当前 `executionDiffPreviewRequestStatus=not_generated_read_only` 且 `executionDiffPreviewRequestCreated=false`。
  - `executionDiffPreviewRequestFingerprint` 绑定 `approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、`executionApprovalUiRequestFingerprint`、`executionOperationEntryRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`guardFingerprint`、`operationSetFingerprint`、`previewFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionDiffPreviewRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 diff preview request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution diff preview request version/status/created/fingerprint/inputs，明确当前仅展示 diff preview request contract，不生成或渲染真实差异预览。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-diff-preview-request/v1`、`not_generated_read_only`、`executionDiffPreviewRequestCreated=false`、16 位 request fingerprint 与十三项 execution diff preview request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution diff preview request fingerprint 会随 request status、approval record request、audit event request、approval UI request、operation entry request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution diff preview request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionDiffPreviewRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted diff preview id、rendered preview id、preview artifact id、approval screen id、job id、run id 或 execution state id。
- mutation 仍不写 DB、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览或正式执行按钮。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 289. P1 落地记录：Repair Execution Request Approval Decision Request Contract Snapshot

本轮继续收敛第 288 节剩余风险中 “mutation 仍不写 DB、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮”。实际代码与目标架构的冲突点是：
execution request 已经声明 diff preview request 的只读边界，但还没有在正式审批决策层明确未来用户批准/拒绝/要求重试等 decision 记录应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接开放执行按钮或记录审批决策，而不绑定 approval UI request、diff preview request、approval record、audit event、repair job、rollback plan、idempotency 与 submission 快照，容易出现审批决策、差异预览和 execution request contract 漂移。本轮新增 execution request 级别的 execution approval decision request contract snapshot，继续保持只读、不记录真实审批决策。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionApprovalDecisionRequestVersion`、`executionApprovalDecisionRequestStatus`、`executionApprovalDecisionRequestCreated`、`executionApprovalDecisionRequestFingerprint` 与 `executionApprovalDecisionRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 approval decision request 版本为 `repair-execution-approval-decision-request/v1`，当前 `executionApprovalDecisionRequestStatus=not_recorded_read_only` 且 `executionApprovalDecisionRequestCreated=false`。
  - `executionApprovalDecisionRequestFingerprint` 绑定 `approvalRecordRequestFingerprint`、`auditEventRequestFingerprint`、`executionApprovalUiRequestFingerprint`、`executionDiffPreviewRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionApprovalDecisionRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 approval decision request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution approval decision request version/status/created/fingerprint/inputs，明确当前仅展示 approval decision request contract，不记录真实审批决策。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-approval-decision-request/v1`、`not_recorded_read_only`、`executionApprovalDecisionRequestCreated=false`、16 位 request fingerprint 与十项 execution approval decision request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution approval decision request fingerprint 会随 request status、approval record request、audit event request、approval UI request、diff preview request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution approval decision request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionApprovalDecisionRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted approval decision id、approval actor session id、approval token id、approval screen id、job id、run id 或 execution state id。
- mutation 仍不写 DB、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录或正式执行按钮。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 290. P1 落地记录：Repair Execution Request Start Request Contract Snapshot

本轮继续收敛第 289 节剩余风险中 “Admin 仍只展示 request gate ... 没有真正的人工审批 UI、差异预览、审批决策记录或正式执行按钮”。实际代码与目标架构的冲突点是：
execution request 已经声明 approval decision request 的只读边界，但还没有在正式执行启动层明确未来点击执行或调度 repair job 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接启动 job，而不绑定 approval decision、operation entry、status polling、execution state、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现执行启动、审批决策和 execution request contract 漂移。本轮新增 execution request 级别的 execution start request contract snapshot，继续保持只读、不启动真实执行。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionStartRequestVersion`、`executionStartRequestStatus`、`executionStartRequestCreated`、`executionStartRequestFingerprint` 与 `executionStartRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 start request 版本为 `repair-execution-start-request/v1`，当前 `executionStartRequestStatus=not_started_read_only` 且 `executionStartRequestCreated=false`。
  - `executionStartRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionApprovalDecisionRequestFingerprint`、`executionOperationEntryRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionStartRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution start request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution start request version/status/created/fingerprint/inputs，明确当前仅展示 start request contract，不启动真实 repair job。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-start-request/v1`、`not_started_read_only`、`executionStartRequestCreated=false`、16 位 request fingerprint 与十二项 execution start request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution start request fingerprint 会随 request status、approval decision request、operation entry request、status poll request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution start request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionStartRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted execution start id、job id、run id、queue id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮或 repair job 调度。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 291. P1 落地记录：Repair Execution Request Queue Request Contract Snapshot

本轮继续收敛第 290 节剩余风险中 “mutation 仍不写 DB、不启动真实 repair job ... 不启动 job polling”。实际代码与目标架构的冲突点是：
execution request 已经声明 start request 的只读边界，但还没有在正式队列层明确未来把 repair job 放入异步执行队列前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接创建 queue item，而不绑定 start request、status polling、execution state、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现队列项、执行启动和 execution request contract 漂移。本轮新增 execution request 级别的 execution queue request contract snapshot，继续保持只读、不创建真实队列项。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionQueueRequestVersion`、`executionQueueRequestStatus`、`executionQueueRequestCreated`、`executionQueueRequestFingerprint` 与 `executionQueueRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 queue request 版本为 `repair-execution-queue-request/v1`，当前 `executionQueueRequestStatus=not_enqueued_read_only` 且 `executionQueueRequestCreated=false`。
  - `executionQueueRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionQueueRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution queue request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution queue request version/status/created/fingerprint/inputs，明确当前仅展示 queue request contract，不创建真实 queue item。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-queue-request/v1`、`not_enqueued_read_only`、`executionQueueRequestCreated=false`、16 位 request fingerprint 与十一项 execution queue request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution queue request fingerprint 会随 request status、start request、status poll request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution queue request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionQueueRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted queue item id、job id、run id、queue lease id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度或队列项。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 292. P1 落地记录：Repair Execution Request Worker Lease Request Contract Snapshot

本轮继续收敛第 291 节剩余风险中 “mutation 仍不写 DB、不创建真实 queue item、不启动真实 repair job ... 没有 ... 队列项”。实际代码与目标架构的冲突点是：
execution request 已经声明 queue request 的只读边界，但还没有在正式 worker 调度层明确未来 worker 获取 queue lease 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接让 worker 获取 lease 或启动 job run，而不绑定 queue request、start request、status polling、execution state、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 worker lease、队列项和 execution request contract 漂移。本轮新增 execution request 级别的 execution worker lease request contract snapshot，继续保持只读、不获取真实 worker lease。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionWorkerLeaseRequestVersion`、`executionWorkerLeaseRequestStatus`、`executionWorkerLeaseRequestCreated`、`executionWorkerLeaseRequestFingerprint` 与 `executionWorkerLeaseRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 worker lease request 版本为 `repair-execution-worker-lease-request/v1`，当前 `executionWorkerLeaseRequestStatus=not_acquired_read_only` 且 `executionWorkerLeaseRequestCreated=false`。
  - `executionWorkerLeaseRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionWorkerLeaseRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution worker lease request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution worker lease request version/status/created/fingerprint/inputs，明确当前仅展示 worker lease request contract，不获取真实 worker lease。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-worker-lease-request/v1`、`not_acquired_read_only`、`executionWorkerLeaseRequestCreated=false`、16 位 request fingerprint 与十二项 execution worker lease request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution worker lease request fingerprint 会随 request status、queue request、start request、status poll request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution worker lease request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionWorkerLeaseRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted worker lease id、lease token、queue item id、job id、run id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项或 worker lease。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 293. P1 落地记录：Repair Execution Request Job Run Request Contract Snapshot

本轮继续收敛第 292 节剩余风险中 “mutation 仍不写 DB、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job ... 没有 ... worker lease”。实际代码与目标架构的冲突点是：
execution request 已经声明 worker lease request 的只读边界，但还没有在正式 job run 层明确未来 worker 获取 lease 后启动 run 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接启动 job run，而不绑定 worker lease、queue request、start request、status polling、execution state、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 job run、worker lease 和 execution request contract 漂移。本轮新增 execution request 级别的 execution job run request contract snapshot，继续保持只读、不启动真实 job run。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionJobRunRequestVersion`、`executionJobRunRequestStatus`、`executionJobRunRequestCreated`、`executionJobRunRequestFingerprint` 与 `executionJobRunRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 job run request 版本为 `repair-execution-job-run-request/v1`，当前 `executionJobRunRequestStatus=not_started_read_only` 且 `executionJobRunRequestCreated=false`。
  - `executionJobRunRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionJobRunRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution job run request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution job run request version/status/created/fingerprint/inputs，明确当前仅展示 job run request contract，不启动真实 job run。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-job-run-request/v1`、`not_started_read_only`、`executionJobRunRequestCreated=false`、16 位 request fingerprint 与十三项 execution job run request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution job run request fingerprint 会随 request status、worker lease request、queue request、start request、status poll request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution job run request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionJobRunRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted job run id、run attempt id、worker lease id、lease token、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease 或 job run。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 294. P1 落地记录：Repair Execution Request Run Step Request Contract Snapshot

本轮继续收敛第 293 节剩余风险中 “mutation 仍不写 DB、不启动真实 job run ... 没有 ... job run”。实际代码与目标架构的冲突点是：
execution request 已经声明 job run request 的只读边界，但还没有在正式 run step 层明确未来 job run 创建 step 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接创建 run step、trace step 或工具执行 step，而不绑定 job run、worker lease、queue request、start request、status polling、execution state、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 run step、job run 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step request contract snapshot，继续保持只读、不创建真实 run step。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRequestVersion`、`executionRunStepRequestStatus`、`executionRunStepRequestCreated`、`executionRunStepRequestFingerprint` 与 `executionRunStepRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step request 版本为 `repair-execution-run-step-request/v1`，当前 `executionRunStepRequestStatus=not_created_read_only` 且 `executionRunStepRequestCreated=false`。
  - `executionRunStepRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step request version/status/created/fingerprint/inputs，明确当前仅展示 run step request contract，不创建真实 run step。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-request/v1`、`not_created_read_only`、`executionRunStepRequestCreated=false`、16 位 request fingerprint 与十四项 execution run step request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step request fingerprint 会随 request status、job run request、worker lease request、queue request、start request、status poll request、execution state request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted run step id、trace step id、tool call step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run 或 run step。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 295. P1 落地记录：Repair Execution Request Run Step Trace Request Contract Snapshot

本轮继续收敛第 294 节剩余风险中 “mutation 仍不写 DB、不创建真实 run step ... 没有 ... run step”。实际代码与目标架构的冲突点是：
execution request 已经声明 run step request 的只读边界，且早前已有全局 `executionTraceRequest` contract，但还没有在正式 step 级 trace 层明确未来 run step 写入 trace 事件前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 run step trace、tool call trace 或 step event，而不绑定 run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 step trace、run step 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step trace request contract snapshot，继续保持只读、不创建真实 step trace。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepTraceRequestVersion`、`executionRunStepTraceRequestStatus`、`executionRunStepTraceRequestCreated`、`executionRunStepTraceRequestFingerprint` 与 `executionRunStepTraceRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step trace request 版本为 `repair-execution-run-step-trace-request/v1`，当前 `executionRunStepTraceRequestStatus=not_created_read_only` 且 `executionRunStepTraceRequestCreated=false`。
  - `executionRunStepTraceRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepTraceRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step trace request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step trace request version/status/created/fingerprint/inputs，明确当前仅展示 step 级 trace request contract，不创建真实 step trace。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-trace-request/v1`、`not_created_read_only`、`executionRunStepTraceRequestCreated=false`、16 位 request fingerprint 与十六项 execution run step trace request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step trace request fingerprint 会随 request status、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step trace request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 trace request，不替代已有全局 `executionTraceRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepTraceRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step 或 step trace。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 296. P1 落地记录：Repair Execution Request Run Step Result Request Contract Snapshot

本轮继续收敛第 295 节剩余风险中 “mutation 仍不写 DB、不创建真实 step trace、不创建真实 run step ... 不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 step 级 trace request 的只读边界，且早前已有全局 `executionResultRequest` contract，但还没有在正式 step result 层明确未来 run step 记录输出结果前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 step result、tool output 或 provider/tool response summary，而不绑定 run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 step result、step trace 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step result request contract snapshot，继续保持只读、不记录真实 step result。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepResultRequestVersion`、`executionRunStepResultRequestStatus`、`executionRunStepResultRequestCreated`、`executionRunStepResultRequestFingerprint` 与 `executionRunStepResultRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step result request 版本为 `repair-execution-run-step-result-request/v1`，当前 `executionRunStepResultRequestStatus=not_recorded_read_only` 且 `executionRunStepResultRequestCreated=false`。
  - `executionRunStepResultRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepResultRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step result request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step result request version/status/created/fingerprint/inputs，明确当前仅展示 step 级 result request contract，不记录真实 step result。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-result-request/v1`、`not_recorded_read_only`、`executionRunStepResultRequestCreated=false`、16 位 request fingerprint 与十八项 execution run step result request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step result request fingerprint 会随 request status、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step result request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 result request，不替代已有全局 `executionResultRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepResultRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace 或 step result。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 297. P1 落地记录：Repair Execution Request Run Step Completion Request Contract Snapshot

本轮继续收敛第 296 节剩余风险中 “mutation 仍不写 DB、不记录真实 step result、不创建真实 step trace、不创建真实 run step ... 不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 step 级 result request 的只读边界，且早前已有全局 `executionCompletionRequest` contract，但还没有在正式 step completion 层明确未来 run step 标记完成前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接将 step 标记为 completed、failed 或 skipped，而不绑定 step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 step completion、step result 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step completion request contract snapshot，继续保持只读、不完成真实 run step。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepCompletionRequestVersion`、`executionRunStepCompletionRequestStatus`、`executionRunStepCompletionRequestCreated`、`executionRunStepCompletionRequestFingerprint` 与 `executionRunStepCompletionRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step completion request 版本为 `repair-execution-run-step-completion-request/v1`，当前 `executionRunStepCompletionRequestStatus=not_completed_read_only` 且 `executionRunStepCompletionRequestCreated=false`。
  - `executionRunStepCompletionRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepCompletionRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step completion request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step completion request version/status/created/fingerprint/inputs，明确当前仅展示 step 级 completion request contract，不完成真实 run step。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-completion-request/v1`、`not_completed_read_only`、`executionRunStepCompletionRequestCreated=false`、16 位 request fingerprint 与十九项 execution run step completion request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step completion request fingerprint 会随 request status、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step completion request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 completion request，不替代已有全局 `executionCompletionRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepCompletionRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step completion id、step status event id、step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result 或 step completion。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 298. P1 落地记录：Repair Execution Request Run Step Status Event Request Contract Snapshot

本轮继续收敛第 297 节剩余风险中 “`executionRunStepCompletionRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step completion id、step status event id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 step 级 completion request 的只读边界，但还没有在正式 step status event 层明确未来记录 step status event 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 completed、failed、skipped 或 retrying 等 step status event，而不绑定 step completion、step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 step status event、step completion 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step status event request contract snapshot，继续保持只读、不记录真实 step status event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepStatusEventRequestVersion`、`executionRunStepStatusEventRequestStatus`、`executionRunStepStatusEventRequestCreated`、`executionRunStepStatusEventRequestFingerprint` 与 `executionRunStepStatusEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step status event request 版本为 `repair-execution-run-step-status-event-request/v1`，当前 `executionRunStepStatusEventRequestStatus=not_recorded_read_only` 且 `executionRunStepStatusEventRequestCreated=false`。
  - `executionRunStepStatusEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepStatusEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step status event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step status event request version/status/created/fingerprint/inputs，明确当前仅展示 step status event request contract，不记录真实 step status event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-status-event-request/v1`、`not_recorded_read_only`、`executionRunStepStatusEventRequestCreated=false`、16 位 request fingerprint 与二十项 execution run step status event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step status event request fingerprint 会随 request status、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step status event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 status event request，不替代已有全局 `executionStateRequest` 或 `executionCompletionRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step status event id、step completion id、step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion 或 step status event。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 299. P1 落地记录：Repair Execution Request Run Step Retry Request Contract Snapshot

本轮继续收敛第 298 节剩余风险中 “mutation 仍不写 DB、不记录真实 step status event、不完成真实 run step ... 不记录 provider response、latency 或真实 request/session/token id”。实际代码与目标架构的冲突点是：
execution request 已经声明 step status event request 的只读边界，且早前已有全局 `executionRetryPolicyRequest` contract，但还没有在正式 step retry 调度层明确未来针对某个 run step 安排 retry 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接创建 retry attempt 或重新入队 run step，而不绑定全局 retry policy、step status event、step completion、step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 step retry、step status event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry request contract snapshot，继续保持只读、不调度真实 step retry。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryRequestVersion`、`executionRunStepRetryRequestStatus`、`executionRunStepRetryRequestCreated`、`executionRunStepRetryRequestFingerprint` 与 `executionRunStepRetryRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry request 版本为 `repair-execution-run-step-retry-request/v1`，当前 `executionRunStepRetryRequestStatus=not_scheduled_read_only` 且 `executionRunStepRetryRequestCreated=false`。
  - `executionRunStepRetryRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry request version/status/created/fingerprint/inputs，明确当前仅展示 step retry request contract，不调度真实 step retry。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-request/v1`、`not_scheduled_read_only`、`executionRunStepRetryRequestCreated=false`、16 位 request fingerprint 与二十二项 execution run step retry request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry request fingerprint 会随 request status、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不调度真实 step retry，不创建 retry attempt，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 retry request，不替代已有全局 `executionRetryPolicyRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step retry id、retry attempt id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不调度真实 step retry、不创建 retry attempt、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event 或 step retry。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 300. P1 落地记录：Repair Execution Request Run Step Retry Attempt Request Contract Snapshot

本轮继续收敛第 299 节剩余风险中 “`executionRunStepRetryRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted step retry id、retry attempt id、queue retry item id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 step retry request 的只读边界，但还没有在正式 retry attempt 层明确未来创建具体 retry attempt 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接创建 retry attempt、attempt run 或 attempt queue item，而不绑定 step retry request、全局 retry policy、step status event、step completion、step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt、step retry 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt request contract snapshot，继续保持只读、不创建真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptRequestVersion`、`executionRunStepRetryAttemptRequestStatus`、`executionRunStepRetryAttemptRequestCreated`、`executionRunStepRetryAttemptRequestFingerprint` 与 `executionRunStepRetryAttemptRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt request 版本为 `repair-execution-run-step-retry-attempt-request/v1`，当前 `executionRunStepRetryAttemptRequestStatus=not_created_read_only` 且 `executionRunStepRetryAttemptRequestCreated=false`。
  - `executionRunStepRetryAttemptRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt request contract，不创建真实 retry attempt。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-request/v1`、`not_created_read_only`、`executionRunStepRetryAttemptRequestCreated=false`、16 位 request fingerprint 与二十三项 execution run step retry attempt request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt request fingerprint 会随 request status、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 retry attempt request，不替代已有 step retry request 或全局 `executionRetryPolicyRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry 或 retry attempt。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 301. P1 落地记录：Repair Execution Request Run Step Retry Attempt Status Event Request Contract Snapshot

本轮继续收敛第 300 节剩余风险中 “`executionRunStepRetryAttemptRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt id、step retry id、queue retry item id、step status event id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 step retry attempt request 的只读边界，但还没有在正式 retry attempt status event 层明确未来记录 attempt started、failed、succeeded、exhausted 或 cancelled 等状态事件前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 retry attempt status event，而不绑定 retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt status event、retry attempt 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt status event request contract snapshot，继续保持只读、不记录真实 retry attempt status event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptStatusEventRequestVersion`、`executionRunStepRetryAttemptStatusEventRequestStatus`、`executionRunStepRetryAttemptStatusEventRequestCreated`、`executionRunStepRetryAttemptStatusEventRequestFingerprint` 与 `executionRunStepRetryAttemptStatusEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt status event request 版本为 `repair-execution-run-step-retry-attempt-status-event-request/v1`，当前 `executionRunStepRetryAttemptStatusEventRequestStatus=not_recorded_read_only` 且 `executionRunStepRetryAttemptStatusEventRequestCreated=false`。
  - `executionRunStepRetryAttemptStatusEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptStatusEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt status event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt status event request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt status event request contract，不记录真实 retry attempt status event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-status-event-request/v1`、`not_recorded_read_only`、`executionRunStepRetryAttemptStatusEventRequestCreated=false`、16 位 request fingerprint 与二十四项 execution run step retry attempt status event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt status event request fingerprint 会随 request status、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt status event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step 级 retry attempt status event request，不替代已有 step retry attempt request、step retry request、step status event request 或全局 `executionRetryPolicyRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt 或 retry attempt status event。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 302. P1 落地记录：Repair Execution Request Run Step Retry Attempt Trace Request Contract Snapshot

本轮继续收敛第 301 节剩余风险中 “`executionRunStepRetryAttemptStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt status event id、retry attempt id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt status event request 的只读边界，但还没有在正式 retry attempt trace 层明确未来记录 attempt trace、tool-call trace 或 provider trace 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接写入 retry attempt trace，而不绑定 retry attempt status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt trace、retry attempt status event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt trace request contract snapshot，继续保持只读、不创建真实 retry attempt trace。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptTraceRequestVersion`、`executionRunStepRetryAttemptTraceRequestStatus`、`executionRunStepRetryAttemptTraceRequestCreated`、`executionRunStepRetryAttemptTraceRequestFingerprint` 与 `executionRunStepRetryAttemptTraceRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt trace request 版本为 `repair-execution-run-step-retry-attempt-trace-request/v1`，当前 `executionRunStepRetryAttemptTraceRequestStatus=not_created_read_only` 且 `executionRunStepRetryAttemptTraceRequestCreated=false`。
  - `executionRunStepRetryAttemptTraceRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptTraceRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt trace request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt trace request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt trace request contract，不创建真实 retry attempt trace。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-trace-request/v1`、`not_created_read_only`、`executionRunStepRetryAttemptTraceRequestCreated=false`、16 位 request fingerprint 与二十五项 execution run step retry attempt trace request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt trace request fingerprint 会随 request status、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt trace request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 级 trace request，不替代已有 run step trace request、step retry attempt status event request、step retry attempt request、step retry request 或全局 `executionTraceRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptTraceRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event 或 retry attempt trace。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 303. P1 落地记录：Repair Execution Request Run Step Retry Attempt Result Request Contract Snapshot

本轮继续收敛第 302 节剩余风险中 “`executionRunStepRetryAttemptTraceRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt trace id、retry attempt status event id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt trace request 的只读边界，但还没有在正式 retry attempt result 层明确未来记录 attempt result、provider response summary 或 tool output result 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接写入 retry attempt result，而不绑定 retry attempt trace、retry attempt status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt result、retry attempt trace 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt result request contract snapshot，继续保持只读、不记录真实 retry attempt result。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptResultRequestVersion`、`executionRunStepRetryAttemptResultRequestStatus`、`executionRunStepRetryAttemptResultRequestCreated`、`executionRunStepRetryAttemptResultRequestFingerprint` 与 `executionRunStepRetryAttemptResultRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt result request 版本为 `repair-execution-run-step-retry-attempt-result-request/v1`，当前 `executionRunStepRetryAttemptResultRequestStatus=not_recorded_read_only` 且 `executionRunStepRetryAttemptResultRequestCreated=false`。
  - `executionRunStepRetryAttemptResultRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptResultRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt result request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt result request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt result request contract，不记录真实 retry attempt result。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-result-request/v1`、`not_recorded_read_only`、`executionRunStepRetryAttemptResultRequestCreated=false`、16 位 request fingerprint 与二十六项 execution run step retry attempt result request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt result request fingerprint 会随 request status、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt result request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 级 result request，不替代已有 run step result request、retry attempt trace request、retry attempt status event request、step retry attempt request、step retry request 或全局 `executionResultRequest`。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptResultRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace 或 retry attempt result。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 304. P1 落地记录：Repair Execution Request Run Step Retry Attempt Completion Request Contract Snapshot

本轮继续收敛第 303 节剩余风险中 “`executionRunStepRetryAttemptResultRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt result id、retry attempt trace id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt result request 的只读边界，但还没有在正式 retry attempt completion 层明确未来完成 attempt 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接标记 retry attempt completed、failed 或 exhausted，而不绑定 retry attempt result、retry attempt trace、retry attempt status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt completion、retry attempt result 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt completion request contract snapshot，继续保持只读、不完成真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptCompletionRequestVersion`、`executionRunStepRetryAttemptCompletionRequestStatus`、`executionRunStepRetryAttemptCompletionRequestCreated`、`executionRunStepRetryAttemptCompletionRequestFingerprint` 与 `executionRunStepRetryAttemptCompletionRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt completion request 版本为 `repair-execution-run-step-retry-attempt-completion-request/v1`，当前 `executionRunStepRetryAttemptCompletionRequestStatus=not_completed_read_only` 且 `executionRunStepRetryAttemptCompletionRequestCreated=false`。
  - `executionRunStepRetryAttemptCompletionRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptCompletionRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt completion request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt completion request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt completion request contract，不完成真实 retry attempt。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-completion-request/v1`、`not_completed_read_only`、`executionRunStepRetryAttemptCompletionRequestCreated=false`、16 位 request fingerprint 与二十七项 execution run step retry attempt completion request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt completion request fingerprint 会随 request status、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt completion request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 级 completion request，不替代已有 run step completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptCompletionRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result 或 retry attempt completion。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 305. P1 落地记录：Repair Execution Request Run Step Retry Attempt Completion Status Event Request Contract Snapshot

本轮继续收敛第 304 节剩余风险中 “mutation 仍不写 DB、不完成真实 retry attempt ... 没有 ... retry attempt completion”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt completion request 的只读边界，但还没有在正式 completion status event 层明确未来记录 retry attempt completion 状态事件前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 retry attempt completed/failed/exhausted status event，而不绑定 retry attempt completion request、retry attempt result、retry attempt trace、retry attempt status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt completion status event、completion request 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt completion status event request contract snapshot，继续保持只读、不记录真实 retry attempt completion status event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptCompletionStatusEventRequestVersion`、`executionRunStepRetryAttemptCompletionStatusEventRequestStatus`、`executionRunStepRetryAttemptCompletionStatusEventRequestCreated`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint` 与 `executionRunStepRetryAttemptCompletionStatusEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt completion status event request 版本为 `repair-execution-run-step-retry-attempt-completion-status-event-request/v1`，当前 `executionRunStepRetryAttemptCompletionStatusEventRequestStatus=not_recorded_read_only` 且 `executionRunStepRetryAttemptCompletionStatusEventRequestCreated=false`。
  - `executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt completion status event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt completion status event request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt completion status event request contract，不记录真实 retry attempt completion status event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-completion-status-event-request/v1`、`not_recorded_read_only`、`executionRunStepRetryAttemptCompletionStatusEventRequestCreated=false`、16 位 request fingerprint 与二十八项 execution run step retry attempt completion status event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt completion status event request fingerprint 会随 request status、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt completion status event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt completion 级 status event request，不替代已有 retry attempt status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion 或 retry attempt completion status event。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 306. P1 落地记录：Repair Execution Request Run Step Retry Attempt Finalization Request Contract Snapshot

本轮继续收敛第 305 节剩余风险中 “`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt completion status event id、retry attempt completion id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt completion status event request 的只读边界，但还没有在正式 retry attempt finalization 层明确未来把 retry attempt 标记为最终 finalized 状态前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接 finalize retry attempt，而不绑定 retry attempt completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt finalization、completion status event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt finalization request contract snapshot，继续保持只读、不 finalize 真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptFinalizationRequestVersion`、`executionRunStepRetryAttemptFinalizationRequestStatus`、`executionRunStepRetryAttemptFinalizationRequestCreated`、`executionRunStepRetryAttemptFinalizationRequestFingerprint` 与 `executionRunStepRetryAttemptFinalizationRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt finalization request 版本为 `repair-execution-run-step-retry-attempt-finalization-request/v1`，当前 `executionRunStepRetryAttemptFinalizationRequestStatus=not_finalized_read_only` 且 `executionRunStepRetryAttemptFinalizationRequestCreated=false`。
  - `executionRunStepRetryAttemptFinalizationRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptFinalizationRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt finalization request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt finalization request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt finalization request contract，不 finalize 真实 retry attempt。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-finalization-request/v1`、`not_finalized_read_only`、`executionRunStepRetryAttemptFinalizationRequestCreated=false`、16 位 request fingerprint 与二十九项 execution run step retry attempt finalization request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt finalization request fingerprint 会随 request status、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt finalization request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 级 finalization request，不替代已有 execution finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptFinalizationRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event 或 retry attempt finalization。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 307. P1 落地记录：Repair Execution Request Run Step Retry Attempt Finalization Status Event Request Contract Snapshot

本轮继续收敛第 306 节剩余风险中 “`executionRunStepRetryAttemptFinalizationRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt finalization id、retry attempt completion status event id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt finalization request 的只读边界，但还没有在正式 finalization status event 层明确未来记录 retry attempt finalized 状态事件前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 retry attempt finalized/closed/aborted status event，而不绑定 retry attempt finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt finalization status event、finalization request 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt finalization status event request contract snapshot，继续保持只读、不记录真实 retry attempt finalization status event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptFinalizationStatusEventRequestVersion`、`executionRunStepRetryAttemptFinalizationStatusEventRequestStatus`、`executionRunStepRetryAttemptFinalizationStatusEventRequestCreated`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint` 与 `executionRunStepRetryAttemptFinalizationStatusEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt finalization status event request 版本为 `repair-execution-run-step-retry-attempt-finalization-status-event-request/v1`，当前 `executionRunStepRetryAttemptFinalizationStatusEventRequestStatus=not_recorded_read_only` 且 `executionRunStepRetryAttemptFinalizationStatusEventRequestCreated=false`。
  - `executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt finalization status event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt finalization status event request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt finalization status event request contract，不记录真实 retry attempt finalization status event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-finalization-status-event-request/v1`、`not_recorded_read_only`、`executionRunStepRetryAttemptFinalizationStatusEventRequestCreated=false`、16 位 request fingerprint 与三十项 execution run step retry attempt finalization status event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt finalization status event request fingerprint 会随 request status、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt finalization status event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt finalization 级 status event request，不替代已有 execution finalization event request、execution finalization request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization 或 retry attempt finalization status event。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 308. P1 落地记录：Repair Execution Request Run Step Retry Attempt Close Request Contract Snapshot

本轮继续收敛第 307 节剩余风险中 “`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt finalization status event id、retry attempt finalization id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt finalization status event request 的只读边界，但还没有在正式 close 层明确未来关闭 retry attempt 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接把 retry attempt 标记为 closed，而不绑定 retry attempt finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt close、finalization status event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt close request contract snapshot，继续保持只读、不关闭真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptCloseRequestVersion`、`executionRunStepRetryAttemptCloseRequestStatus`、`executionRunStepRetryAttemptCloseRequestCreated`、`executionRunStepRetryAttemptCloseRequestFingerprint` 与 `executionRunStepRetryAttemptCloseRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt close request 版本为 `repair-execution-run-step-retry-attempt-close-request/v1`，当前 `executionRunStepRetryAttemptCloseRequestStatus=not_closed_read_only` 且 `executionRunStepRetryAttemptCloseRequestCreated=false`。
  - `executionRunStepRetryAttemptCloseRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptCloseRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt close request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt close request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt close request contract，不关闭真实 retry attempt。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-close-request/v1`、`not_closed_read_only`、`executionRunStepRetryAttemptCloseRequestCreated=false`、16 位 request fingerprint 与三十一项 execution run step retry attempt close request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt close request fingerprint 会随 request status、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt close request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 级 close request，不替代已有 retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptCloseRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event 或 retry attempt close。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 309. P1 落地记录：Repair Execution Request Run Step Retry Attempt Close Status Event Request Contract Snapshot

本轮继续收敛第 308 节剩余风险中 “`executionRunStepRetryAttemptCloseRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt close id、retry attempt finalization status event id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt close request 的只读边界，但还没有在正式 close status event 层明确未来记录 retry attempt closed 状态事件前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接记录 retry attempt closed/close-failed status event，而不绑定 close request、finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt close status event、close request 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt close status event request contract snapshot，继续保持只读、不记录真实 retry attempt close status event。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptCloseStatusEventRequestVersion`、`executionRunStepRetryAttemptCloseStatusEventRequestStatus`、`executionRunStepRetryAttemptCloseStatusEventRequestCreated`、`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint` 与 `executionRunStepRetryAttemptCloseStatusEventRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt close status event request 版本为 `repair-execution-run-step-retry-attempt-close-status-event-request/v1`，当前 `executionRunStepRetryAttemptCloseStatusEventRequestStatus=not_recorded_read_only` 且 `executionRunStepRetryAttemptCloseStatusEventRequestCreated=false`。
  - `executionRunStepRetryAttemptCloseStatusEventRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCloseRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptCloseStatusEventRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt close status event request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt close status event request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt close status event request contract，不记录真实 retry attempt close status event。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-close-status-event-request/v1`、`not_recorded_read_only`、`executionRunStepRetryAttemptCloseStatusEventRequestCreated=false`、16 位 request fingerprint 与三十二项 execution run step retry attempt close status event request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt close status event request fingerprint 会随 request status、run step retry attempt close request、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt close status event request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不记录真实 retry attempt close status event，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt close 级 status event request，不替代已有 close request、retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据；镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptCloseStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt close status event id、retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不记录真实 retry attempt close status event、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt close status event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event、retry attempt close 或 retry attempt close status event。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 310. P1 落地记录：Repair Execution Request Run Step Retry Attempt Archive Request Contract Snapshot

本轮继续收敛第 309 节剩余风险中 “`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt close status event id、retry attempt close id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt close status event request 的只读边界，但还没有在正式归档/保留策略层明确未来归档 retry attempt 前应绑定哪些 request 级输入。后续正式 Agent Runtime 如果直接归档或清理 retry attempt，而不绑定 close status event、close request、finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照，容易出现 retry attempt archive、close status event 和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt archive request contract snapshot，继续保持只读、不归档或清理真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptArchiveRequestVersion`、`executionRunStepRetryAttemptArchiveRequestStatus`、`executionRunStepRetryAttemptArchiveRequestCreated`、`executionRunStepRetryAttemptArchiveRequestFingerprint` 与 `executionRunStepRetryAttemptArchiveRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt archive request 版本为 `repair-execution-run-step-retry-attempt-archive-request/v1`，当前 `executionRunStepRetryAttemptArchiveRequestStatus=not_archived_read_only` 且 `executionRunStepRetryAttemptArchiveRequestCreated=false`。
  - `executionRunStepRetryAttemptArchiveRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCloseRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptArchiveRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt archive request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt archive request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt archive request contract，不归档或清理真实 retry attempt。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-archive-request/v1`、`not_archived_read_only`、`executionRunStepRetryAttemptArchiveRequestCreated=false`、16 位 request fingerprint 与三十三项 execution run step retry attempt archive request inputs。
  - 同一 smoke 覆盖 stale preflight request 的 execution run step retry attempt archive request fingerprint 会随 request status、run step retry attempt close status event request、run step retry attempt close request、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt archive request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不归档或清理真实 retry attempt，不记录真实 retry attempt close status event，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 归档级 request，不替代已有 close status event request、close request、retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据；镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptArchiveRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt archive id、retry attempt retention policy id、retry attempt close status event id、retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不归档或清理真实 retry attempt、不记录真实 retry attempt close status event、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt archive request、execution run step retry attempt close status event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event、retry attempt close、retry attempt close status event 或 retry attempt archive。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 311. P1 落地记录：Repair Execution Request Run Step Retry Attempt Retention Policy Request Contract Snapshot

本轮继续收敛第 310 节剩余风险中 “`executionRunStepRetryAttemptArchiveRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt archive id、retry attempt retention policy id ...”。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt archive request 的只读边界，但 archive request 本身还没有显式绑定未来的 retry attempt retention policy request。后续正式 Agent Runtime 如果直接归档或清理 retry attempt，而不先把 retention policy、close status event、close request、finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照绑定在同一 contract 中，容易出现归档行为和保留策略漂移。本轮新增 execution request 级别的 execution run step retry attempt retention policy request contract snapshot，并让 archive request fingerprint 绑定 retention policy fingerprint，继续保持只读、不创建真实 retention policy。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptRetentionPolicyRequestVersion`、`executionRunStepRetryAttemptRetentionPolicyRequestStatus`、`executionRunStepRetryAttemptRetentionPolicyRequestCreated`、`executionRunStepRetryAttemptRetentionPolicyRequestFingerprint` 与 `executionRunStepRetryAttemptRetentionPolicyRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt retention policy request 版本为 `repair-execution-run-step-retry-attempt-retention-policy-request/v1`，当前 `executionRunStepRetryAttemptRetentionPolicyRequestStatus=not_created_read_only` 且 `executionRunStepRetryAttemptRetentionPolicyRequestCreated=false`。
  - `executionRunStepRetryAttemptRetentionPolicyRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCloseRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `executionRunStepRetryAttemptArchiveRequestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionPolicyRequestFingerprint`，让归档 request contract 显式依赖保留策略 request contract。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionPolicyRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt retention policy request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt retention policy request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt retention policy request contract，不创建真实 retention policy。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-retention-policy-request/v1`、`not_created_read_only`、`executionRunStepRetryAttemptRetentionPolicyRequestCreated=false`、16 位 request fingerprint 与三十三项 execution run step retry attempt retention policy request inputs。
  - 同一 smoke 覆盖 archive request inputs 新增 `executionRunStepRetryAttemptRetentionPolicyRequestFingerprint`，并覆盖 stale preflight request 的 execution run step retry attempt retention policy request fingerprint 会随 request status、run step retry attempt close status event request、run step retry attempt close request、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt retention policy request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 retry attempt retention policy，不归档或清理真实 retry attempt，不记录真实 retry attempt close status event，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 保留策略级 request，不替代已有 archive request、close status event request、close request、retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据；镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptRetentionPolicyRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt retention policy id、retention policy rule id、retention lease id、retry attempt archive id、retry attempt close status event id、retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 retry attempt retention policy、不归档或清理真实 retry attempt、不记录真实 retry attempt close status event、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt retention policy request、execution run step retry attempt archive request、execution run step retry attempt close status event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event、retry attempt close、retry attempt close status event、retry attempt archive 或 retry attempt retention policy。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 312. P1 落地记录：Repair Execution Request Run Step Retry Attempt Retention Policy Rule Request Contract Snapshot

本轮继续收敛第 311 节剩余风险中 "`executionRunStepRetryAttemptRetentionPolicyRequestFingerprint` 仍不是正式 persisted retry attempt retention policy id、retention policy rule id 或 retention lease id" 的 contract 空缺。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt retention policy request 的只读边界，但 archive request 还没有显式绑定未来的 retry attempt retention policy rule request。后续正式 Agent Runtime 如果直接按 retention policy 清理或归档 retry attempt，而不把 retention policy rule、retention policy、close status event、close request、finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照绑定在同一个 contract 中，容易出现保留规则选择、归档行为和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt retention policy rule request contract snapshot，并让 archive request fingerprint 绑定 retention policy rule fingerprint，继续保持只读、不创建真实 retention policy rule。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptRetentionPolicyRuleRequestVersion`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestStatus`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestCreated`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint` 与 `executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt retention policy rule request 版本为 `repair-execution-run-step-retry-attempt-retention-policy-rule-request/v1`，当前 `executionRunStepRetryAttemptRetentionPolicyRuleRequestStatus=not_created_read_only` 且 `executionRunStepRetryAttemptRetentionPolicyRuleRequestCreated=false`。
  - `executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCloseRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptRetentionPolicyRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `executionRunStepRetryAttemptArchiveRequestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint`，让归档 request contract 显式依赖保留策略规则 request contract。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt retention policy rule request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt retention policy rule request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt retention policy rule request contract，不创建真实 retention policy rule。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-retention-policy-rule-request/v1`、`not_created_read_only`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestCreated=false`、16 位 request fingerprint 与三十四项 execution run step retry attempt retention policy rule request inputs。
  - 同一 smoke 覆盖 archive request inputs 新增 `executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint`，并覆盖 stale preflight request 的 execution run step retry attempt retention policy rule request fingerprint 会随 request status、run step retry attempt retention policy request、run step retry attempt close status event request、run step retry attempt close request、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt retention policy rule request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不创建真实 retry attempt retention policy rule，不创建真实 retry attempt retention policy，不归档或清理真实 retry attempt，不记录真实 retry attempt close status event，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 保留策略规则级 request，不替代已有 retention policy request、archive request、close status event request、close request、retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据；镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt retention policy rule id、retry attempt retention policy id、retention lease id、retry attempt archive id、retry attempt close status event id、retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不创建真实 retry attempt retention policy rule、不创建真实 retry attempt retention policy、不归档或清理真实 retry attempt、不记录真实 retry attempt close status event、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt retention policy rule request、execution run step retry attempt retention policy request、execution run step retry attempt archive request、execution run step retry attempt close status event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event、retry attempt close、retry attempt close status event、retry attempt archive、retry attempt retention policy 或 retry attempt retention policy rule。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 313. P1 落地记录：Repair Execution Request Run Step Retry Attempt Retention Lease Request Contract Snapshot

本轮继续收敛第 312 节剩余风险中 "`executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint` 仍不是正式 persisted retry attempt retention policy rule id、retry attempt retention policy id 或 retention lease id" 的 contract 空缺。实际代码与目标架构的冲突点是：
execution request 已经声明 retry attempt retention policy rule request 的只读边界，但 archive request 还没有显式绑定未来的 retry attempt retention lease request。后续正式 Agent Runtime 如果直接按 retention policy rule 归档或清理 retry attempt，而不把 retention lease、retention policy rule、retention policy、close status event、close request、finalization status event、finalization request、completion status event、completion request、result、trace、status event、retry attempt request、step retry request、全局 retry policy、step status event、step completion、step result、run step trace、run step、job run、worker lease、queue request、start request、status polling、execution state、全局 trace request、全局 result request、repair job、rollback plan、idempotency、operation set 与 submission 快照绑定在同一个 contract 中，容易出现保留 lease、归档行为和 execution request contract 漂移。本轮新增 execution request 级别的 execution run step retry attempt retention lease request contract snapshot，并让 archive request fingerprint 绑定 retention lease fingerprint，继续保持只读、不获取真实 retention lease。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestType` 新增 `executionRunStepRetryAttemptRetentionLeaseRequestVersion`、`executionRunStepRetryAttemptRetentionLeaseRequestStatus`、`executionRunStepRetryAttemptRetentionLeaseRequestCreated`、`executionRunStepRetryAttemptRetentionLeaseRequestFingerprint` 与 `executionRunStepRetryAttemptRetentionLeaseRequestInputs`。
  - `buildPromptRegistryRepairExecutionRequest()` 固定 run step retry attempt retention lease request 版本为 `repair-execution-run-step-retry-attempt-retention-lease-request/v1`，当前 `executionRunStepRetryAttemptRetentionLeaseRequestStatus=not_acquired_read_only` 且 `executionRunStepRetryAttemptRetentionLeaseRequestCreated=false`。
  - `executionRunStepRetryAttemptRetentionLeaseRequestFingerprint` 绑定 `auditEventRequestFingerprint`、`executionRunStepRetryAttemptCloseStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCloseRequestFingerprint`、`executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint`、`executionRunStepRetryAttemptFinalizationRequestFingerprint`、`executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint`、`executionRunStepRetryAttemptCompletionRequestFingerprint`、`executionRunStepRetryAttemptRetentionPolicyRequestFingerprint`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint`、`executionRunStepRetryAttemptResultRequestFingerprint`、`executionRunStepRetryAttemptTraceRequestFingerprint`、`executionRunStepRetryAttemptStatusEventRequestFingerprint`、`executionRunStepRetryAttemptRequestFingerprint`、`executionRunStepRetryRequestFingerprint`、`executionRetryPolicyRequestFingerprint`、`executionRunStepStatusEventRequestFingerprint`、`executionRunStepCompletionRequestFingerprint`、`executionRunStepResultRequestFingerprint`、`executionRunStepTraceRequestFingerprint`、`executionRunStepRequestFingerprint`、`executionJobRunRequestFingerprint`、`executionWorkerLeaseRequestFingerprint`、`executionQueueRequestFingerprint`、`executionStartRequestFingerprint`、`executionStateRequestFingerprint`、`executionStatusPollRequestFingerprint`、`executionTraceRequestFingerprint`、`executionResultRequestFingerprint`、`idempotencyLockFingerprint`、`repairJobRequestFingerprint`、`rollbackPlanRequestFingerprint`、`operationSetFingerprint`、当前 submission fingerprint、request status 与 workspaceId。
  - `executionRunStepRetryAttemptArchiveRequestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionLeaseRequestFingerprint`，让归档 request contract 显式依赖保留 lease request contract。
  - `requestFingerprint` 新增绑定 `executionRunStepRetryAttemptRetentionLeaseRequestFingerprint`，让客户端看到的 execution request snapshot 覆盖未来 execution run step retry attempt retention lease request contract。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts` 同步新增 mutation selection 与 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair execution request ...` 诊断文本新增 execution run step retry attempt retention lease request version/status/created/fingerprint/inputs，明确当前仅展示 step retry attempt retention lease request contract，不获取真实 retention lease。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言匹配 request 返回 `repair-execution-run-step-retry-attempt-retention-lease-request/v1`、`not_acquired_read_only`、`executionRunStepRetryAttemptRetentionLeaseRequestCreated=false`、16 位 request fingerprint 与三十五项 execution run step retry attempt retention lease request inputs。
  - 同一 smoke 覆盖 archive request inputs 新增 `executionRunStepRetryAttemptRetentionLeaseRequestFingerprint`，并覆盖 stale preflight request 的 execution run step retry attempt retention lease request fingerprint 会随 request status、run step retry attempt retention policy rule request、run step retry attempt retention policy request、run step retry attempt close status event request、run step retry attempt close request、run step retry attempt finalization status event request、run step retry attempt finalization request、run step retry attempt completion status event request、run step retry attempt completion request、run step retry attempt result request、run step retry attempt trace request、run step retry attempt status event request、run step retry attempt request、run step retry request、execution retry policy request、run step status event request、run step completion request、run step result request、run step trace request、run step request、job run request、worker lease request、queue request、start request、status poll request、execution state request、execution trace request、execution result request、repair job request、rollback plan request 与 idempotency lock request 改变。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 mutation mock 与诊断断言，覆盖 Admin request gate 文本中的 execution run step retry attempt retention lease request contract。

该实现只新增只读 execution request contract 字段，不新增 DB migration，不获取真实 retry attempt retention lease，不创建真实 retry attempt retention policy rule，不创建真实 retry attempt retention policy，不归档或清理真实 retry attempt，不记录真实 retry attempt close status event，不关闭真实 retry attempt，不记录真实 retry attempt finalization status event，不 finalize 真实 retry attempt，不记录真实 retry attempt completion status event，不完成真实 retry attempt，不记录真实 retry attempt result，不创建真实 retry attempt trace，不记录真实 retry attempt status event，不创建真实 retry attempt，不调度真实 step retry，不重新入队 run step，不记录真实 step status event，不完成真实 run step，不记录真实 step result，不创建真实 step trace，不创建真实 run step，不启动真实 job run，不获取真实 worker lease，不创建真实 queue item，不启动真实 repair job，不记录真实 approval decision，不生成真实 diff preview，不渲染正式审批 UI，不开放正式执行按钮，不启动 completion/rollback 操作，不改变 request mutation 的 blocked 语义，也不改变 provider route、task route、action route 或 native dispatch。该 contract 是 step retry attempt 保留 lease 级 request，不替代已有 retention policy rule request、retention policy request、archive request、close status event request、close request、retry attempt finalization status event request、retry attempt finalization request、retry attempt completion status event request、retry attempt completion request、retry attempt result request、retry attempt trace request、retry attempt status event request、step retry attempt request 或 step retry request。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 和宿主源码 bind mount 运行 container Prettier、container oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据；镜像 digest 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`。
- 最终容器验证通过：Prettier `All matched files use Prettier code style`，oxlint `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest `1 passed, 20 tests passed`。

剩余风险：

- `executionRunStepRetryAttemptRetentionLeaseRequestFingerprint` 仍是 resolver 派生的只读 contract，不是正式 persisted retry attempt retention lease id、retry attempt retention policy rule id、retry attempt retention policy id、retry attempt archive id、retry attempt close status event id、retry attempt close id、retry attempt finalization status event id、retry attempt finalization id、retry attempt completion status event id、retry attempt completion id、retry attempt result id、retry attempt trace id、retry attempt status event id、retry attempt id、step retry id、queue retry item id、step status event id、step completion id、step result id、tool output id、provider response id、run step trace id、trace event id、tool call trace id、run step id、job run id、worker lease id、queue item id、job id、worker id、approval decision id、actor session id 或 execution state id。
- mutation 仍不写 DB、不获取真实 retry attempt retention lease、不创建真实 retry attempt retention policy rule、不创建真实 retry attempt retention policy、不归档或清理真实 retry attempt、不记录真实 retry attempt close status event、不关闭真实 retry attempt、不记录真实 retry attempt finalization status event、不 finalize 真实 retry attempt、不记录真实 retry attempt completion status event、不完成真实 retry attempt、不记录真实 retry attempt result、不创建真实 retry attempt trace、不记录真实 retry attempt status event、不创建真实 retry attempt、不调度真实 step retry、不重新入队 run step、不记录真实 step status event、不完成真实 run step、不记录真实 step result、不创建真实 step trace、不创建真实 run step、不启动真实 job run、不获取真实 worker lease、不创建真实 queue item、不启动真实 repair job、不记录真实审批决策、不生成真实差异预览、不渲染人工审批 UI、不开放正式执行按钮、不启动 completion/rollback 操作、不启动 job polling、不记录 finalization event、不 finalize execution、不记录 completion event、不完成 execution、不记录 rollback outcome、不创建 rollback operation、不执行 rollback 操作、不记录 provider response、latency 或真实 request/session/token id。
- Admin 仍只展示 request gate、idempotency lock、approval record request、audit event request、execution run step retry attempt retention lease request、execution run step retry attempt retention policy rule request、execution run step retry attempt retention policy request、execution run step retry attempt archive request、execution run step retry attempt close status event request、execution run step retry attempt close request、execution run step retry attempt finalization status event request、execution run step retry attempt finalization request、execution run step retry attempt completion status event request、execution run step retry attempt completion request、execution run step retry attempt result request、execution run step retry attempt trace request、execution run step retry attempt status event request、execution run step retry attempt request、execution run step retry request、execution run step status event request、execution run step completion request、execution run step result request、execution run step trace request、execution run step request、execution job run request、execution worker lease request、execution queue request、execution start request、execution approval decision request、execution diff preview request、execution approval UI request、execution operation entry request、execution status poll request、execution finalization event request、execution finalization request、execution completion event request、execution completion request、repair job request、execution state request、rollback plan request、execution trace request、execution result request、execution retry policy request、execution provider response request、execution failure event request、execution rollback trigger request、execution rollback executor request、execution rollback operation request 和 execution rollback outcome request contract，没有真正的人工审批 UI、差异预览、审批决策记录、执行按钮、repair job 调度、队列项、worker lease、job run、run step、step trace、step result、step completion、step status event、step retry、retry attempt、retry attempt status event、retry attempt trace、retry attempt result、retry attempt completion、retry attempt completion status event、retry attempt finalization、retry attempt finalization status event、retry attempt close、retry attempt close status event、retry attempt archive、retry attempt retention policy、retry attempt retention policy rule 或 retry attempt retention lease。
- provider health 与 task diagnostics 仍来自当前 resolver 调用快照，不是实时 service probe 或持久化 freshness policy。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 315. P1 落地记录：Task Route Prepared Route Embedding Dimension Evidence

本轮继续收敛第 3.5、23、70、149 与 314 节中自部署 embedding 诊断的剩余风险。实际代码与目标架构的冲突点是：
`models(promptName)` 的 workspace indexing route 顶层已经能显示最终选中 embedding route 的 `requestedDimensions`、`modelEmbeddingDimensions` 与 `dimensionMismatch`，但 `preparedRoutes` 列表仍只显示 provider/model/protocol/layer/backend/canonical/flags。管理员在多个本地或私有云 embedding fallback 都能进入 prepared route 时，无法逐条判断哪条 prepared fallback 声明了 768、1024 或其它 embedding 维度，也无法把 pgvector `vector(1024)` 写入约束和每条 fallback route 对齐。本轮把安全的 embedding dimension evidence 下沉到 task route prepared route 列表，不读取或暴露 provider secret、baseURL、headers、BYOK token、prompt payload 或 native request body。

- `packages/backend/server/src/plugins/copilot/runtime/capability-runtime.ts`：
  - `PreparedTaskRouteDiagnostics` 新增 `requestedDimensions`、`modelEmbeddingDimensions` 与 `dimensionMismatch`。
  - `describePreparedTaskRoutes()` 从 `PreparedNativeEmbeddingExecution.requestedDimensions` 与 `modelLimits.embeddingDimensions` 投影维度证据；只有存在维度证据时才返回 `dimensionMismatch`，避免 rerank prepared route 被标记无意义的 `false`。
- `packages/backend/server/src/plugins/copilot/resolver.ts`、`packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotPreparedTaskRouteDiagnosticsType` 和 `models(promptName)` / publish gate task route prepared route selection 同步新增 prepared route 维度字段。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelPreparedTaskRoute` 保留 prepared route 维度字段。
  - copyable task route diagnostics 的 `prepared routes ...` 文本新增 `requested <n>d`、`model <n>d` 与 `dimension mismatch`，让模型菜单复制结果能逐条解释 embedding fallback 维度。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `/admin/ai` prepared routes 表格 runtime metadata 与 copyable task route diagnostics 文本显示 prepared route 维度 evidence。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `models(promptName)` 的 workspace indexing prepared route 返回 `requestedDimensions=1024`、`modelEmbeddingDimensions=768` 与 `dimensionMismatch=true`。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 断言 copyable task route diagnostics 的 prepared route 文本包含逐 route embedding dimension mismatch evidence。

该实现只扩展只读 diagnostics，不新增 DB migration，不改变 provider route selection、fallback order、BYOK/quota gate、embedding request dimensions 选择顺序、pgvector `vector(1024)` 存储约束、provider health 判定、Prompt Registry publish gate 判定、execution request contract 或 native dispatch。它把 task route prepared route 列表从“哪些 fallback 已进入 native prepared route”推进到“哪些 fallback 已进入 native prepared route，并且每条 embedding fallback 的请求维度和模型声明维度是什么”，为后续 DB-backed Model Registry、embedding 索引版本、重建任务、Admin profile editor 和 route repair 建议提供更完整的 evidence。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- prepared route dimension evidence 仍来自 Node 侧 `PreparedNativeEmbeddingExecution`，不是 provider 实际响应向量长度、持久化 probe 结果或 runtime span。
- `modelEmbeddingDimensions` 仍来自 `modelDefinitions[].limits.embeddingDimensions` 或 provider runtime 已知 limits；如果 provider 忽略 `dimensions` 参数，仍需要真实 embedding 返回后的长度校验阻断写入。
- prepared route 列表只展示成功进入 prepared fallback 的 route，不包含被 route policy、capability matching、BYOK/quota 或 provider prepare error 过滤的候选；这些仍需结合 policy/route/prepare candidates 排查。
- Admin 页面仍是只读 diagnostics，不支持直接修改 model definition 的 embedding dimensions、触发索引重建或自动选择兼容维度。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 316. P1 落地记录：Prompt Registry Publish Gate Policy Candidate Provider Profile Selection

本轮继续收敛第 211、214、314 节中 provider profile evidence 在不同诊断入口不一致的剩余风险。实际代码与目标架构的冲突点是：
后端 `CopilotPromptRegistryPublishGatePolicyCandidateType` 和 task route policy candidate 已经能返回 provider profile / configured model evidence，但 `copilot-prompt-registry-publish-gate-get.gql` 与内置 `getCopilotPromptRegistryPublishGateQuery` 的 publish gate `modelRoute`、`modelRoutes`、`taskRoutes` policy candidate selection 仍没有完整选择这些字段；同时 Admin publish gate 的 policy candidate 文本也只显示 provider id/source/type/privacy/health。结果是 resolver 中已有的安全 profile evidence 在真实 GraphQL 查询和可复制 diagnostics 中被丢失，管理员仍需要跳到 route candidate 或其它 task route diagnostics 才能定位具体 `copilot.providers.profiles[...]` 来源。本轮把 publish gate policy candidate selection 与 Admin 文本口径补齐，不读取或暴露 provider secret、baseURL、headers、BYOK token、prompt payload 或 native request body。

- `packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql` 与 `packages/common/graphql/src/graphql/index.ts`：
  - publish gate `modelRoute.policyCandidates`、`modelRoutes.policyCandidates` 与 `taskRoutes.policyCandidates` selection 新增 `providerConfiguredModelCount`、`providerConfiguredModelIds`、`providerProfileConfigPath`、`providerProfileId` 与 `providerProfileSource`。
- `packages/common/graphql/src/schema.ts`：
  - `GetCopilotPromptRegistryPublishGateQuery` 的 model route policy candidate operation type 同步新增 provider profile / configured model 字段；task route 继续复用共享 `CopilotTaskRouteDiagnosticsType`，该共享类型已包含同类字段。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate 可复制 diagnostics 的 `Model route policy candidate ...` 文本新增 provider profile label，与 task route policy candidate、route candidate 和 prepare candidate 诊断口径对齐。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 publish gate model route policy candidate 与 task route policy candidate 均保留 provider profile id/config path/configured model ids/count。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate policy candidate fixtures，并断言 Admin diagnostics 显示 policy candidate profile label。

该实现只同步只读 GraphQL selection、operation type、Admin diagnostics 和测试，不新增 DB migration，不改变 provider route policy、provider route selection、fallback order、Prompt Registry publish gate 判定、repair execution request contract、embedding/rerank 执行路径或 native dispatch。它把 publish gate policy candidate 从“仅解释 provider policy/health/privacy”推进到“能直接解释是哪一个 provider profile 及其声明模型进入 policy 阶段”，为后续 DB-backed Provider Registry / Model Registry、Admin profile editor 和 route repair 建议提供更一致的 evidence。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- provider profile evidence 仍来自当前 resolver/provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- publish gate policy candidate 仍不包含 provider secret、endpoint reachability probe、latency、quota usage 或 native dispatch span；真实 provider 可用性仍需结合 provider health freshness policy 与后续 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 provider profile、修复 policy block、调整 provider priority 或重新执行 publish repair。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 317. P1 落地记录：Prepared Route Trace Provider Profile Label Consistency

本轮继续收敛第 134、135、217、218、314、316 节中 provider profile evidence 在不同 Admin diagnostics 入口展示格式不一致的剩余风险。实际代码与目标架构的冲突点是：
action run prepared route trace 和 Prompt Registry publish gate action route dry-run 已经通过 GraphQL 选择了 `providerConfiguredModelIds`、`providerConfiguredModelCount`、`providerProfileConfigPath`、`providerProfileId` 与 `providerProfileSource`，但 Admin 共享的 prepared route trace 文本仍把这些字段拆成 `profile ... / profile source ... / profile config ... / profile models ... / profile model count ...` 多段；而 model route、task route、policy candidate 已经使用统一 `Profile <id> / <source> / config <path> / <n> configured models / models ...` label。管理员复制跨入口 diagnostics 时，需要人工判断两种格式是否表达同一个 provider profile。本轮统一 prepared route trace provider profile label，不改变任何后端字段或路由语义。

- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPreparedRouteTraceRoute()` 改为复用 `formatAIModelProviderProfileLabel()` 输出 provider profile / configured model evidence。
  - 该 formatter 同时覆盖 action run prepared route trace 和 publish gate action route dry-run route 文本。
- `packages/frontend/admin/src/modules/ai/index.spec.tsx`：
  - 更新 publish gate action route dry-run route diagnostics 和 action run prepared route trace diagnostics 断言，覆盖统一后的 provider profile label。

该实现只调整 Admin 只读 diagnostics 文本，不新增 GraphQL 字段，不新增 DB migration，不改变 provider route selection、fallback order、action dry-run route count、prepared route trace persistence、Prompt Registry publish gate 判定、repair execution request contract、Action Runtime 状态机或 native dispatch。它把 prepared route trace 的 profile evidence 展示口径与 model route、task route、policy candidate、route candidate、prepare candidate 对齐，为后续 DB-backed Provider Registry / Model Registry 和跨入口 diagnostics diff 提供更稳定的文本 contract。

验证策略：

- 本轮为 Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- 统一后的 provider profile label 仍来自当前 prepared route trace payload，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- prepared route trace 仍只覆盖成功进入 prepared route 的路由，不包含 provider prepare 失败候选、policy block、quota/BYOK 裁决、latency、usage、cost、retry 原因或真实 native fallback 执行结果。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 provider profile、修复 action route dry-run failure 或重新执行 action route repair。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 318. P1 落地记录：Repair Target Locator Provider Profile Source

本轮继续收敛第 316、317 节中 provider profile evidence 在 Prompt Registry repair diagnostics 入口不完整的剩余风险。实际代码与目标架构的冲突点是：
model route、action route、policy candidate 和 prepared route trace 已经能展示 `providerProfileSource`，但 repair recommendation 与 repair preview operation 的 `targetLocator` 只携带 `providerProfileId` 与 `providerProfileConfigPath`。管理员复制 repair diagnostics 时，只能看到 `profile openai-fallback / profile config ...`，无法判断该 locator 指向的是 configured、legacy、BYOK local 还是 BYOK server profile；同时该文本格式也与第 317 节统一后的 provider profile label 不一致。本轮把安全的 provider profile source 补进 repair target locator contract，并让 Admin locator 文本复用统一 profile label，不读取或暴露 provider secret、baseURL、headers、BYOK token、prompt payload 或 native request body。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryPublishGateRepairTargetLocator` 与 GraphQL object 新增 `providerProfileSource`。
  - `modelRouteRepairTargetLocator()` 从 model route evidence 透传 `providerProfileSource`。
  - `actionRouteRepairTargetLocator()` 从 action route dry-run route evidence 透传 `providerProfileSource`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - publish gate repair preview operation `targetLocator` 与 repair recommendation `targetLocator` selection/type 同步新增 `providerProfileSource`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairTargetLocator()` 改为复用 `formatAIModelProviderProfileLabel()` 输出 provider profile label。
  - locator 中缺少 configured model ids/count 时只显示 profile id、source 与 config path，不伪造模型数量。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 model route repair locator 与 action route repair locator 均保留 `providerProfileSource=configured`，并覆盖 preview operation locator 继续稳定携带同一 locator evidence。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 publish gate repair fixtures，并断言 Admin 可复制 diagnostics 中的 repair locator 文本使用 `Profile <id> / <source> / config <path>` 统一格式。

该实现只扩展只读 repair target locator contract、GraphQL selection/type、Admin diagnostics 和测试，不新增 DB migration，不改变 provider route policy、provider route selection、fallback order、Prompt Registry publish gate 判定、repair execution request contract、Action Runtime 状态机、embedding/rerank 执行路径或 native dispatch。它把 repair locator 从“只知道 profile id/config path”推进到“知道 profile id/source/config path”，为后续 DB-backed Provider Registry / Model Registry、repair preview mutation、审计事件和跨入口 diagnostics diff 提供更完整的 locator evidence。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `providerProfileSource` 仍来自当前 resolver/provider registry 或 action dry-run trace 的内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- repair target locator 仍不包含 provider secret、endpoint reachability probe、latency、quota usage、cost、native dispatch span 或真实 repair job id；真实 provider 可用性仍需结合 provider health freshness policy 与后续 runtime telemetry。
- task route repair locator 当前仍只携带 providerId 与 task model config evidence，不会在没有完整 profile evidence 时推断 `providerProfileSource`；后续如 task route 顶层 locator 需要 profile source，应从 task route selected provider evidence 显式透传。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 provider profile、修复 route block、执行 repair mutation 或生成正式 audit event。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 319. P1 落地记录：Task Route Repair Locator Provider Profile Evidence

本轮继续收敛第 318 节剩余风险中 “task route repair locator 当前仍只携带 providerId 与 task model config evidence，不会在没有完整 profile evidence 时推断 `providerProfileSource`” 的问题。实际代码与目标架构的冲突点是：
embedding/rerank task route 的 policy candidate、route candidate、prepare candidate 和 prepared route trace 已经可以解释 provider profile / configured model evidence，但 `CapabilityRuntime.describeEmbeddingRoute()` / `describeRerankRoute()` 返回的顶层 selected task route 仍缺少 provider profile metadata；同时 Admin copyable task route 摘要只显示 provider/model，不显示选中 route 来自哪个 `copilot.providers.profiles[...]`。这会让 Prompt Registry publish gate 和 repair diagnostics 在 task route 层无法稳定定位 selected provider profile，只能回看候选 trace。由于该 evidence 必须来自 execution plan / prepared route，而不是从候选列表猜测，本轮把 selected prepared route 的安全 profile evidence 提升到顶层 task route diagnostics，并补齐 GraphQL schema/query/type 与 Admin/core formatter。

- `packages/backend/server/src/plugins/copilot/runtime/capability-runtime.ts`：
  - `PreparedTaskRouteDiagnostics`、`EmbeddingRouteDiagnostics` 与 `RerankRouteDiagnostics` 新增 `providerName`、`providerSource`、`providerProfileId`、`providerProfileSource`、`providerProfileConfigPath`、`providerConfiguredModelIds`、`providerConfiguredModelCount`、`providerType` 与 `providerPriority`。
  - `describeEmbeddingRoute()` / `describeRerankRoute()` 从 selected prepared route 透传顶层 provider profile evidence，保证来源是执行计划准备出的 route。
- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotTaskRouteDiagnosticsType` 顶层新增 provider profile / configured model 字段，并在 publish gate task route diagnostics 中透传。
  - `taskRouteRepairTargetLocator()` 从 task route selected evidence 透传 `providerProfileId`、`providerProfileSource` 与 `providerProfileConfigPath`。
  - `CopilotPromptRegistryPublishGatePolicyCandidateType` 补齐已被查询选择的 provider profile / configured model schema 字段，消除 publish gate GraphQL query 与后端 object type 的漂移。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotTaskRouteDiagnosticsType` 和 `models(promptName)` / publish gate task route selection/type 同步新增顶层 provider profile / configured model evidence。
  - publish gate policy candidate schema 与已存在 query/type selection 对齐 provider profile / configured model 字段。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelTaskRoute` 保留顶层 provider profile / configured model metadata。
  - `formatAIModelTaskRoutesLabel()` 在 selected task route 摘要中输出统一 `Profile <id> / <source> / config <path> / <n> configured models / models ...` label。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - publish gate task route 摘要复用 `formatAIModelProviderProfileLabel()`，让 `/admin/ai` 可复制 diagnostics 直接显示 selected task route profile evidence。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 publish gate workspace indexing task route 顶层保留 `providerProfileId=local`、`providerProfileSource=configured`、`providerProfileConfigPath=copilot.providers.profiles[id=local]` 与 configured model ids/count。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 断言 task route diagnostics 和 copyable model diagnostics 显示 selected embedding/rerank provider profile label。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 断言 publish gate task route diagnostics 显示 selected rerank route provider profile label。

该实现只扩展只读 diagnostics、GraphQL selection/type、Admin/core 文本和测试，不新增 DB migration，不读取或暴露 provider secret、baseURL、headers、BYOK token、prompt payload 或 native request body，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair execution request contract、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 task route selected evidence 从“只能从候选 trace 间接判断”推进到“顶层 route 和 repair locator 可以直接定位 selected provider profile”，为后续 DB-backed Provider Registry / Model Registry、Admin profile editor、task route repair mutation 和审计事件提供更完整的 evidence 链。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- 顶层 task route provider profile evidence 仍来自当前 execution plan / provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- 当 task route 完全未配置或没有任何 prepared route 时，顶层 route 仍不会伪造 provider profile metadata；此时仍需要 policy/route/prepare candidate trace 解释候选 provider。
- selected prepared route evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度或 rerank provider response；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 327. P1 落地记录：Repair Submission Candidate Evidence Set Preflight Binding

本轮继续收敛第 326 节剩余风险中 “preview operation 暴露的是 candidate evidence fingerprints/keys 摘要，不是正式 mutation input；如果未来 mutation 要执行 repair，仍必须把 explicit candidate locator/fingerprint 纳入 mutation input schema、guard fingerprint 和 preflight 校验” 的问题。实际代码与目标架构的冲突点是：
repair preview operation 已经有 candidate evidence snapshot，但 submission contract 与 preflight 仍只校验 registry、guard、operation set、preview、authorization 和 approval policy 指纹。这样后续即使 preview operation 对 candidate evidence snapshot 敏感，提交方也不能在 submission/preflight 层显式声明“我确认的是哪一组 candidate evidence snapshot”。本轮新增只读 `candidateEvidenceSetFingerprint`，先把 candidate evidence set 绑定到 submission contract 和 preflight stale 校验，不开放 mutation。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryPublishGateRepairActionPreview` 与 `CopilotPromptRegistryPublishGateRepairActionSubmissionContract` 新增 `candidateEvidenceSetFingerprint`。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 从 preview operations 的 `candidateEvidenceFingerprint`、fingerprints、keys、diagnostics fingerprint 与 operation fingerprint 派生 candidate evidence set fingerprint，并纳入 preview fingerprint 与 submission fingerprint payload。
  - `CopilotPromptRegistryRepairSubmissionInput` 新增必填 `candidateEvidenceSetFingerprint`；`buildPromptRegistryRepairPreflight()` 将其加入 matched/mismatched 字段校验，并在 review binding、audit event、idempotency、repair job、execution state 与 rollback plan 只读 fingerprint payload 中绑定该 evidence set。
  - `CopilotPromptRegistryRepairPreflight` 新增 current/expected candidate evidence set fingerprint 输出，方便 Admin 和后续审计对齐当前 contract 与提交方输入。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - publish gate preview、submission contract、repair submission input 与 preflight selection/type 同步新增 `candidateEvidenceSetFingerprint` 和 `expectedCandidateEvidenceSetFingerprint`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin 构造 repair submission input 时回传 `candidateEvidenceSetFingerprint`。
  - Repair action preview 与 repair preflight 文本输出 candidate evidence set fingerprint 和 expected candidate evidence set fingerprint，方便复制、比对和审计。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 preview/submission/preflight 的 candidate evidence set fingerprint 对齐，并覆盖 preflight matched fields 与 review/audit/execution/rollback 只读输入列表。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 覆盖 Admin submission input、preview 文本与 preflight 文本中的 candidate evidence set fingerprint。

该实现只扩展只读 repair submission/preflight contract、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不开放 repair mutation，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence 从“preview operation 层有摘要”推进到“submission/preflight 层显式绑定 evidence set 指纹”，为后续 explicit candidate locator mutation input、审计事件和 DB-backed Provider Registry / Model Registry revision 对齐提供更清晰的提交前置条件。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `candidateEvidenceSetFingerprint` 仍是 resolver 派生的只读 preview/submission hash，不是持久化 Provider Registry / Model Registry candidate row id；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- 该字段绑定的是 candidate evidence set 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- candidate evidence set fingerprint 对 preview/submission/preflight 敏感，但 repair recommendation `diagnosticsFingerprint` 仍不包含 candidate evidence；这保持 recommendation diagnostics guard 语义不漂移，后续正式 mutation guard 需要单独设计 candidate locator 语义。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 320. P1 落地记录：Prepared Task Route Provider Profile Evidence

本轮继续收敛第 319 节剩余风险中 “selected prepared route evidence 不包含完整逐条 diagnostics 展示” 的问题。实际代码与目标架构的冲突点是：
`CapabilityRuntime.describePreparedTaskRoutes()` 已经能够从 execution plan / provider registry 生成每条 prepared route 的 provider profile evidence，但 GraphQL `CopilotPreparedTaskRouteDiagnosticsType`、`models(promptName)` 查询、Prompt Registry publish gate 查询和前端/Admin formatter 只稳定展示顶层 task route profile label，逐条 prepared route 仍主要显示 provider/model/protocol/layer/backend/canonical/flags/dimension。管理员在排查 embedding/rerank fallback 或维度不匹配时，需要知道每个 prepared provider 分别来自哪个 provider profile、profile source、config path 和配置模型集合，而不是只知道最终 selected task route 的 profile。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPreparedTaskRouteDiagnosticsType` 新增 `providerName`、`providerSource`、`providerProfileId`、`providerProfileSource`、`providerProfileConfigPath`、`providerConfiguredModelIds`、`providerConfiguredModelCount`、`providerType` 与 `providerPriority`。
  - prepared route diagnostics 继续透传 runtime 已提供的安全 profile evidence，不从 provider secret、baseURL、headers、BYOK token 或 native request body 推断。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotPreparedTaskRouteDiagnosticsType` 和 embedding/rerank task route `preparedRoutes` selection/type 同步新增 provider profile / configured model evidence。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelPreparedTaskRoute` 保留逐条 prepared route 的 provider profile / configured model metadata。
  - `formatPreparedTaskRoute()` 在每条 prepared route 文本中输出 provider type、source、priority 与统一 `Profile <id> / <source> / config <path> / <n> configured models / models ...` label。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatTaskRoutePreparedRouteText()` 对 publish gate task route diagnostics 的每条 prepared route 输出同一套 provider profile label，让 `/admin/ai` copyable diagnostics 可直接定位每个 prepared provider profile。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `models()` 与 Prompt Registry publish gate 返回的 `preparedRoutes[0]` 保留 provider name/source/profile id/source/config path/configured model ids/count/type/priority。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 补齐 build fixture、直接 formatter fixture 与 copyable diagnostics 断言，覆盖 embedding fallback 两条 prepared route 和 rerank prepared route 的 profile label。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 补齐 publish gate ready rerank prepared route fixture，并断言 Admin diagnostics 的 `Prepared route ...` 行包含统一 profile label。

该实现只扩展只读 diagnostics、GraphQL selection/type、Admin/core 文本和测试，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair execution request contract、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 prepared route evidence 从“只在 runtime 内部可用或顶层 route 间接可见”推进到“每条 prepared route 都能解释其 provider profile 来源”，为后续 DB-backed Provider Registry / Model Registry、Admin profile editor、task route repair mutation 和跨 provider fallback diff 提供更细粒度 evidence 链。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- prepared route provider profile evidence 仍来自当前 execution plan / provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- prepared route 只覆盖成功进入 prepared route 的 provider/model，不包含被 policy block、capability mismatch、quota/BYOK 裁决或 provider prepare failure 过滤掉的候选；这些仍需结合 policy/route/prepare candidate trace 判断。
- prepared route evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 321. P1 落地记录：Task Route Repair Candidate Profile Evidence

本轮继续收敛第 320 节剩余风险中 “prepared route 只覆盖成功进入 prepared route 的 provider/model，不包含被 policy block、capability mismatch、quota/BYOK 裁决或 provider prepare failure 过滤掉的候选；这些仍需结合 policy/route/prepare candidate trace 判断” 的问题。实际代码与目标架构的冲突点是：
task route diagnostics 的 policy candidate、route candidate 与 prepare candidate 已经携带 provider profile / configured model evidence，但 Prompt Registry repair recommendation 的 `evidence` 只记录了 feature、configured、preparedProviderCount、requested model、diagnostics error 和 route trace reasons。管理员看到 `workspace_indexing_task_route_unavailable` 或 `workspace_indexing_task_route_diagnostics_error` 建议时，仍需要回到 task route candidate trace 手工定位哪些 provider profile 参与了 policy、resolution、prepare 阶段。本轮把候选 profile evidence 汇总进 task route repair recommendation evidence，保持 target locator 继续只表达当前 repair target，不把未选中的候选伪装成 selected route。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `taskRouteCandidateProfileEvidence()`，从 task route policy candidates、route candidates 与 prepare candidates 中提取安全的 provider id/name/source/type、profile id/source/config path、configured model ids/count、requested/model/prepared model 与 candidate reason evidence。
  - task route diagnostics error、task route unavailable、embedding dimension mismatch 与 task policy blocked repair recommendation 的 `evidence` 追加候选 profile evidence，并显式放宽该类 evidence 的条目上限，避免 profile config path 被截断。
- `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts`：
  - 覆盖 `workspace_indexing_task_route_diagnostics_error` repair recommendation 保留 `policyCandidate#0:providerProfileId`、`policyCandidate#0:providerProfileConfigPath`、`routeCandidate#0:providerConfiguredModel` 与 `prepareCandidate#0:preparedModelId` evidence。
- `packages/frontend/admin/src/modules/ai/index.spec.tsx`：
  - 在 publish gate repair fixture 中补入 task route candidate profile evidence，并断言 `/admin/ai` 可复制 diagnostics 展示这些 evidence 字符串。

该实现只扩展只读 repair recommendation evidence 与测试，不新增 GraphQL 字段，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 repair recommendation 从“提示去看 candidate trace”推进到“recommendation 自身携带候选 provider profile 证据”，为后续 DB-backed Provider Registry / Model Registry、Admin profile editor、task route repair mutation preview 和审计事件提供更直接的证据链。

验证策略：

- 本轮为 TypeScript/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- repair recommendation candidate profile evidence 仍来自当前 resolver/provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt 和 actor。
- evidence 仍是只读字符串摘要，不是结构化 candidate evidence object；后续如果 repair mutation preview 需要精确选择某个候选 provider profile，应新增结构化 contract，而不是解析 evidence 字符串。
- candidate evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 322. P1 落地记录：Task Route Repair Structured Candidate Evidence

本轮继续收敛第 321 节剩余风险中 “evidence 仍是只读字符串摘要，不是结构化 candidate evidence object；后续如果 repair mutation preview 需要精确选择某个候选 provider profile，应新增结构化 contract，而不是解析 evidence 字符串” 的问题。实际代码与目标架构的冲突点是：
task route repair recommendation 已经能把 policy candidate、route candidate 与 prepare candidate 的 provider profile evidence 汇总进 `evidence: string[]`，但 Admin、后续 repair preview 或审计侧如果要精确识别某个候选 provider profile，仍只能解析字符串摘要。字符串适合复制和人工排查，不适合作为可演进的只读合同。本轮新增结构化 `candidateEvidence` 字段，并保留原字符串 evidence 作为兼容输出。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairCandidateEvidence` 与 GraphQL object type，字段覆盖 `scope`、`candidateIndex`、provider id/name/source/type/priority、provider profile id/source/config path、configured model ids/count、requested/model/prepared model、route model definition id、candidate model ids 与 reasons。
  - 将 task route candidate evidence 构造拆分为结构化对象与字符串摘要两层；字符串 `evidence` 从结构化对象派生，避免两份逻辑漂移。
  - task route diagnostics error、task route unavailable、embedding dimension mismatch 与 task policy blocked repair recommendation 追加 `candidateEvidence`。
  - `candidateEvidence` 作为只读 diagnostics/display contract，不纳入 `diagnosticsFingerprint` payload，避免仅新增结构化展示字段导致 repair action guard、preview 和 preflight 指纹语义变化。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - 新增 `CopilotPromptRegistryPublishGateRepairCandidateEvidenceType`，并在 publish gate `repairRecommendations` selection/type 中暴露 nullable `candidateEvidence`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - `formatPromptRegistryPublishGateRepairRecommendation()` 追加结构化 `candidate evidence ...` 文本，直接展示 provider profile、configured models、requested/prepared model 与 reasons，不再要求 UI 解析旧字符串 evidence。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `workspace_indexing_task_route_diagnostics_error` repair recommendation 返回结构化 policy/route/prepare candidate evidence。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 在 publish gate repair fixture 中补入结构化 task route candidate evidence，并断言 `/admin/ai` diagnostics 显示结构化 provider profile/configured model/prepared model 文本。

该实现只扩展只读 repair diagnostics、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、repair mutation guard 指纹、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 repair recommendation 从“可复制字符串 evidence”推进到“同时提供结构化候选 evidence contract”，为后续 DB-backed Provider Registry / Model Registry、Admin profile editor、task route repair mutation preview 和审计事件提供可直接读取的证据对象。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- structured candidate evidence 仍来自当前 resolver/provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt、actor 与 candidate stable id。
- `candidateEvidence` 目前是只读 diagnostics contract，不参与 repair recommendation fingerprint；如果未来 repair mutation preview 要把某个 candidate 作为可执行目标，需要新增 explicit candidate target locator 或 mutation input fingerprint，而不是隐式依赖 display contract。
- candidate evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 323. P1 落地记录：Task Route Repair Candidate Evidence Stable Identity

本轮继续收敛第 322 节剩余风险中 “structured candidate evidence 仍来自当前 resolver/provider registry 内存快照，不是持久化 Provider Registry / Model Registry row；DB 化后需要补 registry id、revision、scope、updatedAt、actor 与 candidate stable id” 以及 “未来 repair mutation preview 需要 explicit candidate target locator 或 mutation input fingerprint” 的问题。实际代码与目标架构的冲突点是：
`candidateEvidence` 已经是结构化对象，但仍只能靠 `scope + candidateIndex + providerId` 临时定位候选；route/prepare candidate 事实上已有 `candidateKey`，只是没有进入 repair evidence contract。同时没有 candidate 级 fingerprint 时，Admin copyable diagnostics 与后续 preview/audit 很难引用某个候选 evidence 快照而不重新解析整段对象。本轮新增只读 `candidateKey` 与 `candidateFingerprint`，先建立 stable identity 的 diagnostics 层，不把它升级为可执行 mutation target。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryPublishGateRepairCandidateEvidence` 与 GraphQL object type 新增 `candidateKey` 和 `candidateFingerprint`。
  - `taskRouteCandidateProfileStructuredEvidence()` 透传 task route route/prepare candidate 的 `candidateKey`；policy candidate 当前没有底层 key 时保持为空，不伪造。
  - 新增 `taskRouteRepairCandidateEvidenceFingerprint()`，使用现有稳定 stringify 规则对 candidate evidence 快照生成 16 位 fingerprint。
  - 字符串 evidence 同步输出 `candidateFingerprint` 与可用的 `candidateKey`，方便旧 copyable evidence 与结构化 evidence 对齐。
  - repair recommendation `diagnosticsFingerprint` 仍不包含 `candidateEvidence`，保持 repair action guard、preview、preflight 指纹语义不因只读展示字段变化而漂移。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - publish gate repair candidate evidence selection/type 同步新增非空 `candidateFingerprint` 与 nullable `candidateKey`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin candidate evidence 文本显示 `fingerprint <hash>` 与 `key <candidateKey>`，让 diagnostics 可以复制并定位结构化候选快照。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 policy/route/prepare candidate evidence 均携带 16 位 candidate fingerprint，并覆盖 route/prepare candidate key。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 在 publish gate repair fixture 中生成 candidate fingerprint，覆盖 Admin diagnostics 中的 fingerprint/key 展示。

该实现只扩展只读 repair diagnostics、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、repair mutation guard 指纹、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence 从“结构化但缺少稳定身份”推进到“结构化且带只读 candidate key/fingerprint”，为后续 DB-backed Provider Registry / Model Registry、task route repair mutation preview explicit locator 和审计事件提供更好的 evidence anchor。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `candidateFingerprint` 仍是 resolver 派生的只读 diagnostics hash，不是持久化 Provider Registry / Model Registry candidate row id；`candidateKey` 透传当前 diagnostics 层已有 key，格式不承诺给外部解析；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- policy candidate 当前没有底层 `candidateKey`，只提供 fingerprint；如后续 policy repair mutation 需要选择 policy candidate，应先在 policy diagnostics 层引入 explicit key/locator。
- `candidateFingerprint` 目前不参与 repair recommendation fingerprint；如果未来 mutation input 要引用 candidate evidence，必须把 explicit candidate locator/fingerprint 纳入 mutation input schema 和 guard fingerprint，而不是隐式读取 display-only 字段。
- candidate evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 324. P1 落地记录：Task Route Policy Candidate Stable Key

本轮继续收敛第 323 节剩余风险中 “policy candidate 当前没有底层 `candidateKey`，只提供 fingerprint；如后续 policy repair mutation 需要选择 policy candidate，应先在 policy diagnostics 层引入 explicit key/locator” 的问题。实际代码与目标架构的冲突点是：
route/prepare candidate 已经有 diagnostics 层 `candidateKey` 并进入 repair candidate evidence，但 policy candidate 仍只能依赖 `candidateFingerprint`。这会让 policy-blocked route 或后续 policy repair preview 难以从 task route policy trace 到 repair candidate evidence 稳定对应同一个 provider/profile 候选。本轮在 task route policy candidate diagnostics 层新增只读 `candidateKey`，再透传到 repair candidate evidence。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 新增 `buildTaskRoutePolicyCandidateKey()` 与 `withTaskRoutePolicyCandidateKeys()`，用 policy scope、feature kind、workspace/global scope、provider id、provider profile id、privacy、health、available/allowed 状态生成 diagnostics 层 key。
  - `CopilotTaskRoutePolicyCandidateDiagnosticsType` 新增非空 `candidateKey`。
  - embedding/rerank task route policy candidate 列表统一通过 `withTaskRoutePolicyCandidateKeys()` 生成，repair candidate evidence 自动透传 policy candidate key。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotTaskRoutePolicyCandidateDiagnosticsType` selection/type 同步新增 `candidateKey`，覆盖 `models(promptName)` 与 Prompt Registry publish gate task route diagnostics。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelTaskRoutePolicyCandidate` 与 policy candidate trace row 保留 `candidateKey`。
  - copyable task route policy candidate label 输出 `key <candidateKey>`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin task route policy candidate diagnostics 文本输出 `candidateKey`，让 policy trace、repair candidate evidence 和 copyable diagnostics 可以对齐。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `models()` 与 publish gate repair candidate evidence 中的 policy candidate key 覆盖 feature/provider。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 覆盖 policy candidate trace row 保留 key。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 覆盖 task route policy candidate diagnostics 与 repair candidate evidence 中的 policy key 展示。

该实现只扩展只读 diagnostics、GraphQL selection/type、Admin/core 文本和测试，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、repair mutation guard 指纹、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 policy candidate evidence 从“只有 fingerprint 的显示对象”推进到“policy trace 和 repair evidence 均有 diagnostics key”，为后续 explicit policy candidate locator、task route repair preview 和审计事件提供更稳定的对齐依据。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin/core diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `candidateKey` 仍是 diagnostics 层 key，不是持久化 Provider Registry / Model Registry row id；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- policy candidate key 当前绑定 provider/profile/privacy/health/allowed 状态，适合定位一次 publish gate 快照，不应作为长期持久主键或跨 revision mutation target。
- `candidateKey` 和 `candidateFingerprint` 目前不参与 repair recommendation fingerprint；如果未来 mutation input 要引用 policy candidate evidence，必须把 explicit candidate locator/fingerprint 纳入 mutation input schema 和 guard fingerprint。
- candidate evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 325. P1 落地记录：Task Route Policy Candidate Diagnostics Fingerprint

本轮继续收敛第 324 节剩余风险中 “`candidateKey` 和 `candidateFingerprint` 目前不参与 repair recommendation fingerprint；如果未来 mutation input 要引用 policy candidate evidence，必须把 explicit candidate locator/fingerprint 纳入 mutation input schema 和 guard fingerprint” 的问题。实际代码与目标架构的冲突点是：
policy candidate 已经有 diagnostics 层 `candidateKey`，且 repair candidate evidence 有 `candidateFingerprint`，但 task route policy candidate trace 自身还没有同源 fingerprint。管理员需要先跳到 repair recommendation 的 candidate evidence 才能复制 fingerprint，后续 policy repair preview 也缺少从 policy trace 到 candidate evidence 的同源 fingerprint 对齐。本轮在 task route policy candidate diagnostics 层新增只读 `candidateFingerprint`，并复用 repair candidate evidence 的稳定化规则生成 fingerprint。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - 抽出 `taskRouteRepairCandidateEvidenceBase()`，让 policy candidate diagnostics fingerprint 与 repair candidate evidence fingerprint 使用同一 evidence payload。
  - `withTaskRoutePolicyCandidateKeys()` 同时生成 `candidateKey` 与 16 位 SHA-256 `candidateFingerprint`。
  - `CopilotTaskRoutePolicyCandidateDiagnosticsType` 新增非空 `candidateFingerprint`。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-models-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotTaskRoutePolicyCandidateDiagnosticsType` selection/type 同步新增 `candidateFingerprint`，覆盖 `models(promptName)` 与 Prompt Registry publish gate task route diagnostics；未给 publish gate model-route policy candidate 类型新增该字段。
- `packages/frontend/core/src/modules/ai-button/services/models.ts`：
  - `AIModelTaskRoutePolicyCandidate` 与 policy candidate trace row 保留 `candidateFingerprint`。
  - copyable task route policy candidate label 输出 `fingerprint <candidateFingerprint>`。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin task route policy candidate diagnostics 文本输出 fingerprint，让 policy trace、repair candidate evidence 和 copyable diagnostics 可以用同源 fingerprint 对齐。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 `models()` policy candidate fingerprint 为 16 位 hex，并与 publish gate repair candidate evidence fingerprint 一致。
  - `packages/frontend/core/src/modules/ai-button/services/models.spec.ts` 覆盖 policy candidate trace row 保留 fingerprint。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 覆盖 task route policy candidate diagnostics 展示 fingerprint。

该实现只扩展只读 diagnostics、GraphQL selection/type、Admin/core 文本和测试，不新增 DB migration，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、repair mutation guard 指纹、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 policy candidate 从“key 可定位、fingerprint 只在 repair evidence 中可见”推进到“policy trace 与 repair evidence 共享同源 diagnostics fingerprint”，为后续 explicit policy candidate locator、task route repair preview、审计事件和 DB-backed registry revision 对齐提供更稳定的 evidence anchor。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin/core diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke、frontend core AI model service Vitest 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `candidateFingerprint` 仍是 resolver 派生的只读 diagnostics hash，不是持久化 Provider Registry / Model Registry candidate row id；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- policy candidate fingerprint 当前绑定 provider/profile/privacy/health/allowed 状态，适合定位一次 publish gate 快照，不应作为长期持久主键或跨 revision mutation target。
- `candidateKey` 和 `candidateFingerprint` 仍不参与 repair recommendation fingerprint；如果未来 mutation input 要引用 policy candidate evidence，必须把 explicit candidate locator/fingerprint 纳入 mutation input schema 和 guard fingerprint。
- candidate evidence 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 326. P1 落地记录：Repair Preview Candidate Evidence Snapshot

本轮继续收敛第 325 节剩余风险中 “`candidateKey` 和 `candidateFingerprint` 仍不参与 repair recommendation fingerprint；如果未来 mutation input 要引用 policy candidate evidence，必须把 explicit candidate locator/fingerprint 纳入 mutation input schema 和 guard fingerprint” 的问题。实际代码与目标架构的冲突点是：
repair recommendation 已经有结构化 `candidateEvidence`，task route policy candidate trace 也有同源 `candidateFingerprint`，但 repair preview operation 只暴露 operation fingerprint、target locator fingerprint 和 target locator。管理员和后续审计只能从 recommendation 回推候选 evidence，preview operation 本身没有候选 evidence 的只读快照摘要。本轮在 repair preview operation 层新增 candidate evidence snapshot，让 preview contract 可以显式说明本次 operation 绑定了哪些 candidate evidence fingerprints/keys。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryPublishGateRepairActionPreviewOperation` 新增 `candidateEvidenceCount`、`candidateEvidenceFingerprint`、`candidateEvidenceFingerprints` 与 `candidateEvidenceKeys`。
  - 新增 `promptRegistryRepairCandidateEvidenceSnapshot()`，从 recommendation `candidateEvidence` 派生候选 evidence 数量、fingerprint 列表、key 列表与聚合 fingerprint。
  - preview operation fingerprint 和 preview fingerprint 纳入 `candidateEvidenceFingerprint`，让 preview contract 对只读候选 evidence snapshot 的变化敏感；仍不把完整 candidate evidence 对象复制到 preview operation。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - `CopilotPromptRegistryPublishGateRepairActionPreviewOperationType` selection/type 同步新增 candidate evidence snapshot 字段。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin `Repair action preview operation ...` 文本输出 candidate evidence count、聚合 fingerprint、fingerprints 列表和 keys 列表，方便复制 preview operation 级 evidence anchor。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 task route diagnostics error 的 preview operation candidate evidence snapshot 与 recommendation `candidateEvidence` 对齐。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 覆盖 Admin preview operation 文本中的 candidate evidence count/fingerprint/keys。

该实现只扩展只读 repair preview contract、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不开放 mutation，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、repair execution request contract、repair mutation guard 指纹、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence 从“recommendation 层可见”推进到“preview operation 层也有只读候选 evidence snapshot”，为后续 explicit candidate locator mutation input、审计事件和 DB-backed Provider Registry / Model Registry revision 对齐提供更稳定的 preview anchor。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `candidateEvidenceFingerprint` 仍是 resolver 派生的只读 preview snapshot hash，不是持久化 Provider Registry / Model Registry candidate row id；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- preview operation 暴露的是 candidate evidence fingerprints/keys 摘要，不是正式 mutation input；如果未来 mutation 要执行 repair，仍必须把 explicit candidate locator/fingerprint 纳入 mutation input schema、guard fingerprint 和 preflight 校验。
- 本轮让 preview/operation fingerprint 对 candidate evidence snapshot 变化敏感，但 repair recommendation `diagnosticsFingerprint` 仍不包含 candidate evidence；这保持 recommendation diagnostics guard 语义不漂移，但后续正式 mutation guard 需要显式设计 candidate locator 语义。
- candidate evidence snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 328. P1 落地记录：Repair Execution Request Candidate Evidence Set Binding

本轮继续收敛第 327 节剩余风险中 “`candidateEvidenceSetFingerprint` 绑定的是 candidate evidence set 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan” 的问题。实际代码与目标架构的冲突点是：
repair submission 与 preflight 已经显式校验 candidate evidence set fingerprint，但 `requestCopilotPromptRegistryRepairExecution` 的 request input 仍只声明 approval、audit、execution gate/state、idempotency、policy、preflight、repair job、review 与 rollback 指纹。这样 request gate 虽然可以从 nested preflight 间接看到 candidate evidence set，但提交方没有在 execution request 层显式声明“我确认的 preflight candidate evidence set fingerprint”。本轮新增只读 `expectedCandidateEvidenceSetFingerprint`，把 evidence set 从 submission/preflight 继续绑定到 execution request stale 校验和 request diagnostics，不开放真实 repair mutation。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairExecutionRequestInput` 新增必填 `expectedCandidateEvidenceSetFingerprint`，并在 `buildPromptRegistryRepairExecutionRequest()` 的 matched/mismatched/request inputs 中校验它必须等于当前 preflight `candidateEvidenceSetFingerprint`。
  - `CopilotPromptRegistryRepairExecutionRequest` 与 GraphQL object type 新增 `expectedCandidateEvidenceSetFingerprint` 输出，方便 Admin 和后续审计对齐 request input 与 preflight snapshot。
  - idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace/result/retry policy/provider response request 和顶层 request fingerprint 的只读 payload 绑定 `candidateEvidenceSetFingerprint`，让 request gate 后续阶段对 evidence set stale 更敏感。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - repair execution request input/output selection/type 同步新增 `expectedCandidateEvidenceSetFingerprint`。
  - repair execution request 的 nested preflight selection/type 同步暴露 `candidateEvidenceSetFingerprint`，避免 Admin 只能从另一条 preflight query 间接比对。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin 构造 repair execution request input 时传入 `repairPreflight.candidateEvidenceSetFingerprint`。
  - Repair execution request 文本输出 expected candidate evidence set fingerprint 与 nested preflight candidate evidence set fingerprint，方便复制、比对和审计。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 execution request input matching、request inputs、idempotency/approval/audit/job/state/rollback/trace/result/retry/provider-response inputs 与 nested preflight candidate evidence set 对齐。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 覆盖 Admin mutation input、mock execution request contract 和 copyable diagnostics 中的 expected/preflight candidate evidence set fingerprint。

该实现只扩展只读 repair execution request gate contract、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不开放 repair mutation，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence 从“submission/preflight 层显式绑定 evidence set 指纹”推进到“execution request gate 层也必须显式确认同一 evidence set”，为后续 explicit candidate locator mutation input、approval record、audit event、rollback plan 和 DB-backed Provider Registry / Model Registry revision 对齐提供更清晰的 request 前置条件。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `expectedCandidateEvidenceSetFingerprint` 仍是 request gate 只读 stale 校验字段，不是持久化 Provider Registry / Model Registry candidate row id；DB 化后仍需要 registry id、revision、scope、updatedAt、actor 与正式 candidate stable id。
- 该字段确认的是 preflight candidate evidence set fingerprint，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮让 request gate 与部分只读 request fingerprints 对 candidate evidence set 敏感，但 repair recommendation `diagnosticsFingerprint` 仍不包含 candidate evidence；这保持 recommendation diagnostics guard 语义不漂移，后续正式 mutation guard 需要单独设计 candidate locator 语义。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 329. P1 落地记录：Repair Execution Failure/Rollback Candidate Evidence Set Binding

本轮继续收敛第 328 节剩余风险中 “本轮让 request gate 与部分只读 request fingerprints 对 candidate evidence set 敏感” 的问题。实际代码与目标架构的冲突点是：
execution provider response request 已经显式绑定 `candidateEvidenceSetFingerprint`，但紧随其后的 failure event 与 rollback trigger/executor/operation/outcome request 仍只绑定 provider response、result、retry、state、trace、idempotency、job、rollback plan 和 submission 指纹。这样 failure/rollback 链路会通过上游 fingerprint 间接感知 evidence set，但每个 downstream contract 自身的 `inputs` 和 payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入 failure/rollback 五个只读 request contract，不开放真实 rollback 执行。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionFailureEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在 `executionFailureEventRequestFingerprint` payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionRollbackTriggerRequestInputs`、`executionRollbackExecutorRequestInputs`、`executionRollbackOperationRequestInputs` 与 `executionRollbackOutcomeRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步写入当前 preflight `candidateEvidenceSetFingerprint`。
  - 由于顶层 request fingerprint 已绑定这些 downstream fingerprints，execution request snapshot 会随 failure/rollback 层 evidence set 绑定变化产生新的只读 fingerprint。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 failure event 与 rollback trigger/executor/operation/outcome request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 failure/rollback request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不执行真实 rollback、不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“request gate 与基础 execution request 显式绑定”继续推进到“failure/rollback downstream contract 也显式绑定同一 evidence set”，为后续 approval/audit/rollback plan 持久化和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- failure/rollback request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 failure event id、rollback trigger id、rollback executor id、rollback operation id 或 rollback outcome id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 failure event 与 rollback trigger/executor/operation/outcome；completion/completion event、finalization/finalization event、status poll、operation entry、approval UI、diff preview、approval decision、start/queue/worker/job/run-step/retry-attempt 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 330. P1 落地记录：Repair Execution Completion/Finalization Candidate Evidence Set Binding

本轮继续收敛第 329 节剩余风险中 “completion/completion event、finalization/finalization event、status poll 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
failure/rollback request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 completion、completion event、finalization、finalization event 与 status poll request 仍只绑定 failure/rollback/result/retry/state/trace/idempotency/job/submission 等指纹。这样 completion/finalization/status 链路会通过上游 request fingerprint 间接感知 evidence set，但每个 contract 自身的 `inputs` 与 fingerprint payload 仍没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这五个只读 request contract，不开放真实 completion、finalization 或 polling 状态机。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionCompletionRequestInputs` 与 `executionCompletionEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionFinalizationRequestInputs` 与 `executionFinalizationEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
  - `executionStatusPollRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并让 status poll request fingerprint 对同一 evidence set 直接敏感。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 completion、completion event、finalization、finalization event 与 status poll request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 completion/finalization/status request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不执行真实 completion/finalization/polling，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“failure/rollback downstream contract 显式绑定”继续推进到“completion/finalization/status polling contract 也显式绑定同一 evidence set”，为后续 execution operation entry、approval UI/diff/decision、start/queue/worker/job/run-step 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- completion/finalization/status request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 completion id、completion event id、finalization id、finalization event id、status poll job id 或 execution state id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 completion、completion event、finalization、finalization event 与 status poll；operation entry、approval UI、diff preview、approval decision、start/queue/worker/job/run-step/retry-attempt 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 331. P1 落地记录：Repair Execution Operation/Approval Candidate Evidence Set Binding

本轮继续收敛第 330 节剩余风险中 “operation entry、approval UI、diff preview、approval decision 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
completion/finalization/status request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 operation entry、approval UI、diff preview 与 approval decision request 仍只绑定 approval record、audit、status poll、operation set、preview/guard、idempotency、job、rollback plan 和 submission 等指纹。这样人工审批前后的只读 contract 会通过上游 request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这四个只读 request contract，不开放真实审批 UI、diff 生成或 approval decision 记录。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionOperationEntryRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在 operation entry fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionApprovalUiRequestInputs`、`executionDiffPreviewRequestInputs` 与 `executionApprovalDecisionRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 operation entry、approval UI、diff preview 与 approval decision request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 operation/approval request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不渲染真实 approval UI、不生成真实 diff preview、不记录真实 approval decision，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“completion/finalization/status polling contract 显式绑定”继续推进到“operation/approval contract 也显式绑定同一 evidence set”，为后续 start/queue/worker/job/run-step 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- operation/approval request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 operation entry id、approval UI render id、diff preview id、approval decision id 或 actor session id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 operation entry、approval UI、diff preview 与 approval decision；start、queue、worker lease、job run、run step、run step trace/result/completion/status/retry/retry-attempt 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 332. P1 落地记录：Repair Execution Start/Queue/Worker Candidate Evidence Set Binding

本轮继续收敛第 331 节剩余风险中 “start、queue、worker lease、job run 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
operation/approval request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 start、queue、worker lease 与 job run request 仍只绑定 approval decision、operation entry、execution state、status poll、idempotency、operation set、job、rollback plan 和 submission 等指纹。这样进入执行队列和 worker lease 前后的只读 contract 会通过上游 request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这四个只读 request contract，不启动真实 job、不入队真实 queue item、不获取真实 worker lease。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionStartRequestInputs` 与 `executionQueueRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionWorkerLeaseRequestInputs` 与 `executionJobRunRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 start、queue、worker lease 与 job run request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 start/queue/worker/job request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不启动真实 repair job、不创建真实 queue item、不获取真实 worker lease、不记录真实 job run，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“operation/approval contract 显式绑定”继续推进到“start/queue/worker/job contract 也显式绑定同一 evidence set”，为后续 run step、run step trace/result/completion/status/retry/retry-attempt 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- start/queue/worker/job request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 execution start id、queue item id、worker lease id、worker id 或 job run id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 start、queue、worker lease 与 job run；run step、run step trace/result/completion/status/retry/retry-attempt 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 333. P1 落地记录：Repair Execution Run Step Candidate Evidence Set Binding

本轮继续收敛第 332 节剩余风险中 “run step、run step trace/result/completion/status/retry 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
start/queue/worker/job request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 run step、run step trace、run step result、run step completion、run step status event 与 run step retry request 仍只绑定 job/queue/start/state/status/trace/result/retry policy/worker、operation set、job、rollback plan 和 submission 等指纹。这样 run step 基础 contract 会通过 job run 与上游 request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这六个只读 request contract，不创建真实 run step、不记录真实 trace/result/status event、不调度真实 retry。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRequestInputs` 与 `executionRunStepTraceRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionRunStepResultRequestInputs`、`executionRunStepCompletionRequestInputs`、`executionRunStepStatusEventRequestInputs` 与 `executionRunStepRetryRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 run step、trace、result、completion、status event 与 retry request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 run-step base request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不创建真实 run step、不记录真实 trace/result/status event、不调度真实 retry，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“start/queue/worker/job contract 显式绑定”继续推进到“run step base contract 也显式绑定同一 evidence set”，为后续 retry attempt、retry attempt trace/result/completion/finalization/retention/archive 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- run step base request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 run step id、trace id、result id、completion id、status event id 或 retry id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 run step、trace、result、completion、status event 与 retry；retry attempt、retry attempt trace/result/status/completion/finalization/retention/archive 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 334. P1 落地记录：Repair Execution Run Step Retry Attempt Candidate Evidence Set Binding

本轮继续收敛第 333 节剩余风险中 “retry attempt、retry attempt trace/result/status/completion/finalization/retention/archive 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
run step base request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 retry attempt request、retry attempt status event request、retry attempt trace request 与 retry attempt result request 仍只绑定 run step retry、run step status/trace/result/completion、job/queue/start/state/status、worker、operation set、job、rollback plan 和 submission 等指纹。这样 retry attempt 基础 contract 会通过 run step retry 与上游 request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这四个只读 request contract，不创建真实 retry attempt、不记录真实 retry attempt status event、trace 或 result。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptRequestInputs` 与 `executionRunStepRetryAttemptStatusEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionRunStepRetryAttemptTraceRequestInputs` 与 `executionRunStepRetryAttemptResultRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt request、status event、trace 与 result request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 retry attempt 基础 request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不创建真实 retry attempt、不记录真实 retry attempt status event、不创建真实 retry attempt trace、不记录真实 retry attempt result，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“run step base contract 显式绑定”继续推进到“retry attempt base contract 也显式绑定同一 evidence set”，为后续 retry attempt completion/finalization/close/retention/archive 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- retry attempt base request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt id、retry attempt status event id、retry attempt trace id 或 retry attempt result id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 retry attempt request、status event、trace 与 result；retry attempt completion、completion status event、finalization、finalization status event、close、close status event、retention policy、retention policy rule、retention lease 与 archive 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 335. P1 落地记录：Repair Execution Run Step Retry Attempt Completion/Finalization Candidate Evidence Set Binding

本轮继续收敛第 334 节剩余风险中 “retry attempt completion、completion status event、finalization、finalization status event、close、close status event、retention policy、retention policy rule、retention lease 与 archive 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
retry attempt base request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 retry attempt completion request、completion status event request、finalization request 与 finalization status event request 仍只绑定 retry attempt request/status/trace/result、run step retry、run step status/trace/result/completion、job/queue/start/state/status、worker、operation set、job、rollback plan 和 submission 等指纹。这样 retry attempt completion/finalization contract 会通过上游 retry attempt request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这四个只读 request contract，不完成真实 retry attempt、不记录真实 completion/finalization status event、不 finalize 真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptCompletionRequestInputs` 与 `executionRunStepRetryAttemptCompletionStatusEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionRunStepRetryAttemptFinalizationRequestInputs` 与 `executionRunStepRetryAttemptFinalizationStatusEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt completion、completion status event、finalization 与 finalization status event request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 retry attempt completion/finalization request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不完成真实 retry attempt、不记录真实 retry attempt completion status event、不 finalize 真实 retry attempt、不记录真实 retry attempt finalization status event，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“retry attempt base contract 显式绑定”继续推进到“retry attempt completion/finalization contract 也显式绑定同一 evidence set”，为后续 retry attempt close/retention/archive 和 DB-backed Provider Registry / Model Registry revision 对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- retry attempt completion/finalization request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt completion id、completion status event id、finalization id 或 finalization status event id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮只覆盖 retry attempt completion、completion status event、finalization 与 finalization status event；retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive 后续链路仍需要继续显式审计和分段绑定。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 336. P1 落地记录：Repair Execution Run Step Retry Attempt Close/Retention/Archive Candidate Evidence Set Binding

本轮继续收敛第 335 节剩余风险中 “retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive 后续链路仍需要继续显式审计和分段绑定” 的问题。实际代码与目标架构的冲突点是：
retry attempt completion/finalization request 已经显式绑定 `candidateEvidenceSetFingerprint`，但 retry attempt close request、close status event request、retention policy request、retention policy rule request、retention lease request 与 archive request 仍只绑定 retry attempt completion/finalization、retry attempt request/status/trace/result、run step retry、run step status/trace/result/completion、job/queue/start/state/status、worker、operation set、job、rollback plan 和 submission 等指纹。这样 retry attempt close/retention/archive contract 会通过上游 retry attempt completion/finalization request fingerprint 间接感知 evidence set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 candidate evidence set”。本轮把 candidate evidence set 显式纳入这六个只读 request contract，不关闭真实 retry attempt、不记录真实 close status event、不创建真实 retention policy/rule/lease、不归档真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptCloseRequestInputs` 与 `executionRunStepRetryAttemptCloseStatusEventRequestInputs` 新增 `candidateEvidenceSetFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `candidateEvidenceSetFingerprint`。
  - `executionRunStepRetryAttemptRetentionPolicyRequestInputs`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs`、`executionRunStepRetryAttemptRetentionLeaseRequestInputs` 与 `executionRunStepRetryAttemptArchiveRequestInputs` 新增 `candidateEvidenceSetFingerprint`，对应 fingerprint payload 同步绑定当前 preflight evidence set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive request inputs 均包含 `candidateEvidenceSetFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 retry attempt close/retention/archive request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution downstream contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不关闭真实 retry attempt、不记录真实 retry attempt close status event、不创建真实 retry attempt retention policy、不创建真实 retention policy rule、不获取真实 retention lease、不归档真实 retry attempt，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair target locator、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 candidate evidence set 从“retry attempt completion/finalization contract 显式绑定”继续推进到“retry attempt close/retention/archive contract 也显式绑定同一 evidence set”，为后续 DB-backed Provider Registry / Model Registry revision、真实 Agent Runtime retry attempt 生命周期和审计持久化对齐提供更完整的 request 链路证据。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。
- 最终容器验证通过：Prettier 输出 `All matched files use Prettier code style`，oxlint 输出 `0 warnings and 0 errors`，resolver smoke 输出 `resolver source chain smoke passed`，Admin AI Vitest 输出 `1 passed, 20 tests passed`。`localmind-affine:test` 镜像 ID 前后保持 `sha256:c3389960f5edde0288533ab9ba62cf9e2806ee25d78c7c468c10df8bde62cc50`，且没有残留 `affine_test` runner 容器。

剩余风险：

- retry attempt close/retention/archive request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt close id、close status event id、retention policy id、retention policy rule id、retention lease id 或 archive id。
- candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema、guard fingerprint、权限模型、approval record、audit event 和 rollback plan。
- 本轮完成 retry attempt close/retention/archive 只读 contract 的 evidence set 显式绑定，但整个 repair execution request 仍不创建真实 execution job、queue item、worker lease、run step、retry attempt、completion、finalization、close、retention 或 archive 记录；后续阶段需要把这些只读 contract 逐步迁移到 DB-backed Agent Runtime 状态机。
- candidate evidence set 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 337. P1 落地记录：Repair Execution Target Locator Fingerprint Binding

本轮继续收敛第 336 节剩余风险中 “candidate evidence set 仍是 preflight 摘要，不是可执行 mutation locator；未来 repair mutation 仍必须新增 explicit candidate locator/fingerprint input schema” 的问题。实际代码与目标架构的冲突点是：
repair action preview 与 mutation guard 已经有 `targetLocatorFingerprint`，但 submission contract、preflight stale 校验和 repair execution request input 只显式确认 candidate evidence set、operation set、preview、guard 与 approval/audit/job/rollback 指纹。这样执行请求入口可以从 guard/preview 间接感知 locator set，却不能在 submission/preflight/request 三层明确声明“本次请求确认的是哪一组 repair target locator”。本轮把现有只读 `targetLocatorFingerprint` 纳入 submission/preflight/execution request contract，不开放真实 repair mutation。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `CopilotPromptRegistryRepairSubmissionInput` 与 `CopilotPromptRegistryPublishGateRepairActionSubmissionContract` 新增必填 `targetLocatorFingerprint`，由 publish gate mutation guard 的 locator set snapshot 派生。
  - `buildPromptRegistryPublishGateRepairActionPreview()` 把 `targetLocatorFingerprint` 纳入 submission required inputs 与 submission fingerprint payload，使 target locator set 变化会让 submission contract stale。
  - `buildPromptRegistryRepairPreflight()` 校验 expected/current `targetLocatorFingerprint`，并把它纳入 review binding、audit event、repair job、execution state、rollback plan 与 execution gate 的只读 request payload。
  - `CopilotPromptRegistryRepairExecutionRequestInput` 新增 `expectedTargetLocatorFingerprint`，`buildPromptRegistryRepairExecutionRequest()` 在 request gate 中校验它必须等于当前 preflight `targetLocatorFingerprint`，并在 request fingerprint payload 与输出 diagnostics 中暴露。
- `packages/backend/server/src/schema.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-publish-gate-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-preflight-get.gql`、`packages/common/graphql/src/graphql/copilot-prompt-registry-repair-execution-request.gql`、`packages/common/graphql/src/graphql/index.ts` 与 `packages/common/graphql/src/schema.ts`：
  - 同步新增 submission input/output、preflight output 与 execution request input/output 的 target locator fingerprint schema、selection 和 generated 类型。
- `packages/frontend/admin/src/modules/ai/index.tsx`：
  - Admin 构造 repair submission input 时传入 submission contract 的 `targetLocatorFingerprint`。
  - Admin 构造 execution request input 时传入 preflight 的 `targetLocatorFingerprint` 作为 `expectedTargetLocatorFingerprint`。
  - repair preview、preflight 与 execution request 可复制 diagnostics 显示 target locator fingerprint 与 expected target locator fingerprint，方便后续审计比对。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 submission/preflight/execution request 的 target locator fingerprint 与 mutation guard 对齐，并覆盖 request input/matched fields。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 Admin mock contract、mutation input 与 diagnostics 期望，覆盖 submission required inputs、preflight target locator 字段和 execution request expected target locator 字段。

该实现只扩展只读 repair target locator fingerprint contract、GraphQL selection/type、Admin 文本和测试，不新增 DB migration，不开放 repair mutation，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“preview/guard 层有只读 snapshot”推进到“submission/preflight/execution request gate 三层都必须显式确认 locator set fingerprint”，为后续 explicit candidate locator mutation input、approval record、audit event、rollback plan 和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的 request 前置条件。

验证策略：

- 本轮为 TypeScript/GraphQL/Admin diagnostics/test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- `targetLocatorFingerprint` 仍是 resolver 派生的只读 locator set hash，不是持久化 repair target id、operation id、mutation authorization、approval record、repair job id 或 audit event id。
- 本轮只把 locator set fingerprint 绑定到 submission/preflight/execution request gate 与 preflight 关键前置 contract；下游 execution trace/result/retry/run-step/retry-attempt/retention/archive request contract 仍主要通过 upstream request fingerprint 间接感知 locator set，后续可按 candidate evidence set 的方式分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 338. P1 落地记录：Repair Execution Core Lifecycle Target Locator Fingerprint Binding

本轮继续收敛第 337 节剩余风险中 “下游 execution trace/result/retry/run-step/retry-attempt/retention/archive request contract 仍主要通过 upstream request fingerprint 间接感知 locator set” 的问题。实际代码与目标架构的冲突点是：
repair execution request gate 已经显式校验 `expectedTargetLocatorFingerprint` 与当前 preflight `targetLocatorFingerprint`，但进入核心 lifecycle contract 后，idempotency lock、approval record request、audit event request、repair job request、execution state request、rollback plan request、execution trace/result/retry policy/provider response request、failure/rollback、completion/finalization 与 status poll request 仍只显式绑定 candidate evidence set、submission、request status、job/state/trace/result/rollback 等指纹。这样下游 contract 会通过顶层 request fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这些核心 lifecycle 只读 request contract，不启动真实 execution，也不改变 run step / retry attempt 深链。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `idempotencyLockInputs`、`approvalRecordRequestInputs`、`auditEventRequestInputs`、`repairJobRequestInputs`、`executionStateRequestInputs`、`rollbackPlanRequestInputs` 新增 `targetLocatorFingerprint`，并在对应 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionTraceRequestInputs`、`executionResultRequestInputs`、`executionRetryPolicyRequestInputs`、`executionProviderResponseRequestInputs`、`executionFailureEventRequestInputs` 新增 `targetLocatorFingerprint`，让 trace/result/retry/provider response/failure contract 对 locator set 直接敏感。
  - `executionRollbackTriggerRequestInputs`、`executionRollbackExecutorRequestInputs`、`executionRollbackOperationRequestInputs`、`executionRollbackOutcomeRequestInputs`、`executionCompletionRequestInputs`、`executionCompletionEventRequestInputs`、`executionFinalizationRequestInputs`、`executionFinalizationEventRequestInputs` 与 `executionStatusPollRequestInputs` 新增 `targetLocatorFingerprint`，使 rollback/completion/finalization/status poll 核心 lifecycle contract 显式绑定同一 target locator set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言上述核心 lifecycle request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的核心 lifecycle request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution core lifecycle contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不启动真实 execution job、不创建真实 idempotency lock、approval record、audit event、repair job、trace、result、provider response、rollback、completion、finalization 或 status poll 记录，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“execution request gate 显式确认”继续推进到“核心 lifecycle request contract 也显式绑定同一 locator set”，为后续 run step / retry attempt 深链、真实 Agent Runtime 状态机和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- 核心 lifecycle request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 idempotency lock id、approval record id、audit event id、repair job id、execution trace id、result id、rollback id、completion id、finalization id 或 status poll id。
- 本轮只覆盖 execution core lifecycle contract；operation entry、approval UI、diff preview、approval decision、start、queue、worker lease、job run、run step、retry attempt、retention 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set，后续需要继续分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 339. P1 落地记录：Repair Execution Operation/Queue Target Locator Fingerprint Binding

本轮继续收敛第 338 节剩余风险中 “operation entry、approval UI、diff preview、approval decision、start、queue、worker lease、job run 深链仍主要通过 upstream request fingerprint 间接感知 target locator set” 的问题。实际代码与目标架构的冲突点是：
核心 lifecycle request 已经显式绑定 `targetLocatorFingerprint`，但 execution operation entry、approval UI、diff preview、approval decision、start、queue、worker lease 与 job run request 仍只显式绑定 candidate evidence set、submission、operation set、request status、core lifecycle 与上游 execution request 指纹。这样 operation/queue/job-run contract 会通过 request/status/core lifecycle fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这八个只读 request contract，不打开真实 operation entry、不渲染真实 approval UI、不生成真实 diff preview、不记录 approval decision、不启动真实 execution、不入队、不获取 worker lease、不运行真实 job。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionOperationEntryRequestInputs`、`executionApprovalUiRequestInputs`、`executionDiffPreviewRequestInputs` 与 `executionApprovalDecisionRequestInputs` 新增 `targetLocatorFingerprint`，并在对应 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionStartRequestInputs`、`executionQueueRequestInputs`、`executionWorkerLeaseRequestInputs` 与 `executionJobRunRequestInputs` 新增 `targetLocatorFingerprint`，使 start/queue/worker/job-run 只读 contract 对同一 locator set 直接敏感。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言上述 operation/queue/job-run request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 operation/queue/job-run request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution operation/queue/job-run contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不启动真实 execution job、不创建真实 operation entry、approval UI、diff preview、approval decision、queue item、worker lease 或 job run 记录，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“核心 lifecycle request contract 显式绑定”继续推进到“operation/queue/job-run request contract 也显式绑定同一 locator set”，为后续 run step / retry attempt 深链、真实 Agent Runtime 状态机和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- operation/queue/job-run request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 operation entry id、approval UI session id、diff preview id、approval decision id、queue item id、worker lease id 或 job run id。
- 本轮只覆盖 operation entry、approval UI、diff preview、approval decision、start、queue、worker lease 与 job run；run step、retry attempt、retention 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set，后续需要继续分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 340. P1 落地记录：Repair Execution Run Step Target Locator Fingerprint Binding

本轮继续收敛第 339 节剩余风险中 “run step、retry attempt、retention 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set” 的问题。实际代码与目标架构的冲突点是：
operation/queue/job-run request 已经显式绑定 `targetLocatorFingerprint`，但 run step、run step trace、run step result、run step completion、run step status event 与 run step retry request 仍只显式绑定 candidate evidence set、job/queue/start/state/status、worker、operation set、job、rollback plan、submission 与上游 request 指纹。这样 run step base contract 会通过 job run 与上游 request fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这六个只读 request contract，不创建真实 run step、不记录真实 trace/result/status event、不完成真实 run step、不调度真实 retry。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRequestInputs` 与 `executionRunStepTraceRequestInputs` 新增 `targetLocatorFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionRunStepResultRequestInputs`、`executionRunStepCompletionRequestInputs`、`executionRunStepStatusEventRequestInputs` 与 `executionRunStepRetryRequestInputs` 新增 `targetLocatorFingerprint`，对应 fingerprint payload 同步绑定当前 preflight locator set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 run step、trace、result、completion、status event 与 retry request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 run step base request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution run step base contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不创建真实 run step、不记录真实 trace/result/status event、不完成真实 run step、不调度真实 retry，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“operation/queue/job-run request contract 显式绑定”继续推进到“run step base request contract 也显式绑定同一 locator set”，为后续 retry attempt、retention/archive 深链、真实 Agent Runtime 状态机和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- run step base request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 run step id、trace id、result id、completion id、status event id 或 retry id。
- 本轮只覆盖 run step、trace、result、completion、status event 与 retry；retry attempt、retry attempt completion/finalization/close、retention 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set，后续需要继续分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 341. P1 落地记录：Repair Execution Retry Attempt Target Locator Fingerprint Binding

本轮继续收敛第 340 节剩余风险中 “retry attempt、retry attempt completion/finalization/close、retention 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set” 的问题。实际代码与目标架构的冲突点是：
run step base request 已经显式绑定 `targetLocatorFingerprint`，但 retry attempt request、retry attempt status event request、retry attempt trace request 与 retry attempt result request 仍只显式绑定 candidate evidence set、run step retry/status/trace/result/completion、job/queue/start/state/status、worker、operation set、job、rollback plan、submission 与上游 request 指纹。这样 retry attempt base contract 会通过 run step retry 与上游 request fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这四个只读 request contract，不创建真实 retry attempt、不记录真实 retry attempt status event、trace 或 result。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptRequestInputs` 与 `executionRunStepRetryAttemptStatusEventRequestInputs` 新增 `targetLocatorFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionRunStepRetryAttemptTraceRequestInputs` 与 `executionRunStepRetryAttemptResultRequestInputs` 新增 `targetLocatorFingerprint`，对应 fingerprint payload 同步绑定当前 preflight locator set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt request、status event、trace 与 result request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 retry attempt base request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution retry attempt base contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不创建真实 retry attempt、不记录真实 retry attempt status event、不创建真实 retry attempt trace、不记录真实 retry attempt result，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“run step base request contract 显式绑定”继续推进到“retry attempt base request contract 也显式绑定同一 locator set”，为后续 retry attempt completion/finalization/close、retention/archive 深链、真实 Agent Runtime 状态机和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- retry attempt base request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt id、retry attempt status event id、retry attempt trace id 或 retry attempt result id。
- 本轮只覆盖 retry attempt request、status event、trace 与 result；retry attempt completion、completion status event、finalization、finalization status event、close、close status event、retention policy、retention policy rule、retention lease 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set，后续需要继续分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 342. P1 落地记录：Repair Execution Retry Attempt Completion/Finalization Target Locator Fingerprint Binding

本轮继续收敛第 341 节剩余风险中 “retry attempt completion、completion status event、finalization、finalization status event、close、close status event、retention policy、retention policy rule、retention lease 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set” 的问题。实际代码与目标架构的冲突点是：
retry attempt base request 已经显式绑定 `targetLocatorFingerprint`，但 retry attempt completion request、completion status event request、finalization request 与 finalization status event request 仍只显式绑定 candidate evidence set、retry attempt request/status/trace/result、run step retry/status/trace/result/completion、job/queue/start/state/status、worker、operation set、job、rollback plan、submission 与上游 request 指纹。这样 retry attempt completion/finalization contract 会通过 retry attempt base request fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这四个只读 request contract，不完成真实 retry attempt、不记录真实 completion/finalization status event、不 finalize 真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptCompletionRequestInputs` 与 `executionRunStepRetryAttemptCompletionStatusEventRequestInputs` 新增 `targetLocatorFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionRunStepRetryAttemptFinalizationRequestInputs` 与 `executionRunStepRetryAttemptFinalizationStatusEventRequestInputs` 新增 `targetLocatorFingerprint`，对应 fingerprint payload 同步绑定当前 preflight locator set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt completion、completion status event、finalization 与 finalization status event request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 retry attempt completion/finalization request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution retry attempt completion/finalization contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不完成真实 retry attempt、不记录真实 retry attempt completion status event、不 finalize 真实 retry attempt、不记录真实 retry attempt finalization status event，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“retry attempt base request contract 显式绑定”继续推进到“retry attempt completion/finalization request contract 也显式绑定同一 locator set”，为后续 retry attempt close、retention/archive 深链、真实 Agent Runtime 状态机和 DB-backed Provider Registry / Model Registry revision 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- retry attempt completion/finalization request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt completion id、completion status event id、finalization id 或 finalization status event id。
- 本轮只覆盖 retry attempt completion、completion status event、finalization 与 finalization status event；retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set，后续需要继续分阶段显式绑定。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。

## 343. P1 落地记录：Repair Execution Retry Attempt Close/Retention/Archive Target Locator Fingerprint Binding

本轮继续收敛第 342 节剩余风险中 “retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive 深链仍主要通过 upstream request fingerprint 间接感知 target locator set” 的问题。实际代码与目标架构的冲突点是：
retry attempt completion/finalization request 已经显式绑定 `targetLocatorFingerprint`，但 retry attempt close request、close status event request、retention policy request、retention policy rule request、retention lease request 与 archive request 仍只显式绑定 candidate evidence set、retry attempt request/status/trace/result/completion/finalization、run step、job/queue/start/state/status、worker、operation set、job、rollback plan、submission 与上游 request 指纹。这样 close/retention/archive contract 会通过 completion/finalization 与上游 request fingerprint 间接感知 locator set，但自身 `inputs` 与 fingerprint payload 没有声明“本阶段也绑定同一 repair target locator set”。本轮把 `targetLocatorFingerprint` 显式纳入这六个只读 request contract，不关闭真实 retry attempt、不记录真实 close status event、不创建真实 retention policy/rule/lease、不归档真实 retry attempt。

- `packages/backend/server/src/plugins/copilot/resolver.ts`：
  - `executionRunStepRetryAttemptCloseRequestInputs` 与 `executionRunStepRetryAttemptCloseStatusEventRequestInputs` 新增 `targetLocatorFingerprint`，并在各自 fingerprint payload 中写入当前 preflight `targetLocatorFingerprint`。
  - `executionRunStepRetryAttemptRetentionPolicyRequestInputs`、`executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs`、`executionRunStepRetryAttemptRetentionLeaseRequestInputs` 与 `executionRunStepRetryAttemptArchiveRequestInputs` 新增 `targetLocatorFingerprint`，对应 fingerprint payload 同步绑定当前 preflight locator set。
- 测试覆盖：
  - `packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts` 断言 retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive request inputs 均包含 `targetLocatorFingerprint`。
  - `packages/frontend/admin/src/modules/ai/index.spec.tsx` 更新 repair execution request mock contract，确保 Admin diagnostics 展示的 close/retention/archive request inputs 与后端 contract 对齐。

该实现只扩展只读 repair execution retry attempt close/retention/archive contract 与测试，不新增 GraphQL 字段、不新增 DB migration、不开放 repair mutation、不关闭真实 retry attempt、不记录真实 retry attempt close status event、不创建真实 retention policy、retention policy rule 或 retention lease、不归档真实 retry attempt，不改变 provider route selection、fallback order、route policy、Prompt Registry publish gate 判定、repair action catalog、embedding/rerank request 参数、Action Runtime 状态机或 native dispatch。它把 target locator set 从“retry attempt completion/finalization request contract 显式绑定”继续推进到“retry attempt close/retention/archive request contract 也显式绑定同一 locator set”，为后续真实 Agent Runtime 状态机、DB-backed Provider Registry / Model Registry revision 与持久化 execution audit 对齐提供更明确的审计前置条件。

验证策略：

- 本轮为 TypeScript/Admin test 与规划文档改动，不涉及依赖、Dockerfile、native build、DB migration、GraphQL schema 或 runtime packaging，不重建 `localmind-affine:test`。
- 继续使用现有固定测试镜像 `localmind-affine:test`，通过 `.docker/selfhost/compose.localmind.yml` 的 `affine_test` 服务、`--pull never`、`--no-deps` 与宿主源码 bind mount 运行 focused Prettier、oxlint、resolver smoke 与 Admin AI Vitest。当前本机 Docker Compose `run` 不支持 `--no-build` flag，因此以镜像已存在、不传 `--build`、`--pull never` 与镜像 ID 前后不变作为不重建证据。

剩余风险：

- retry attempt close/retention/archive request fingerprints 仍是 resolver 派生的只读 contract hash，不是持久化 retry attempt close id、close status event id、retention policy id、retention rule id、retention lease id 或 archive id。
- 本轮只覆盖 retry attempt close、close status event、retention policy、retention policy rule、retention lease 与 archive；真实 Agent Runtime 仍缺少 DB-backed run/step/retry-attempt 状态机、队列消费、worker lease 持久化、执行幂等、失败恢复、审计事件与 rollback 记录。
- target locator fingerprint 只确认 locator set，不替代正式 mutation input 中的 explicit candidate locator/fingerprint、expected registry version、guard fingerprint、operation set fingerprint、operation fingerprint、权限模型、approval record、audit event 和 rollback plan。
- target locator snapshot 不包含 provider secret、endpoint probe latency、quota usage、cost、native dispatch span、真实 embedding 返回向量长度、rerank provider response 或 runtime retry 结果；真实运行可用性仍需结合 provider health freshness policy 与 runtime telemetry。
- Admin 页面仍是只读 diagnostics，不支持直接编辑 `copilot.tasks.models`、provider profile、model definition、route policy 或执行 task route repair mutation。
- 当前 runtime 镜像未包含本轮纯源码改动；阶段验收前仍需要完整构建 `localmind-affine:local` 并在容器内验证。
