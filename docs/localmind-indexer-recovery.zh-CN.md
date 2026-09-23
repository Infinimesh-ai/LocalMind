# LocalMind Workspace 全文索引恢复手册（SSH / Docker Compose）

本文用于在已有服务器上定位 LocalMind，补齐 ManticoreSearch，恢复 Workspace
文档全文索引和 AI/MCP 关键词搜索。已有搜索代码无需重写；本文不升级应用镜像，
不运行 Prisma schema 迁移，不处理 Project 搜索或 Embedding 向量索引。

适用基线：仓库现有 `compose.localmind.yml` 的单主服务部署，镜像内应用目录为
`/app`，主进程为 `SERVER_FLAVOR=allinone`（未设置时默认也是 allinone）。
容器名、服务名、目录均以服务器实际发现结果为准。分离的 `graphql/doc/front`
部署需要把同样配置加到所有相关服务，并在重建索引期间停止所有索引 worker；
不要只照搬本文的单容器停止命令。

文档命令已按仓库实现核对；编写文档没有在你的远程服务器执行恢复。
按章节逐段执行，任何一步报错都先处理，不要一次粘贴整篇。

## 1. SSH 后先找到实际服务

```sh
docker version
docker compose version
docker compose ls --all
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

找到提供 LocalMind 网页的主容器。仓库默认名是 `localmind_affine_server`，
实际可能不同。下文在同一个 shell 会话中执行，先替换容器名：

```sh
LM_CONTAINER='localmind_affine_server'
docker inspect "$LM_CONTAINER" --format 'image={{.Config.Image}}
image_id={{.Image}}
working_dir={{.Config.WorkingDir}}
compose_project={{index .Config.Labels "com.docker.compose.project"}}
compose_service={{index .Config.Labels "com.docker.compose.service"}}
compose_working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}
compose_files={{index .Config.Labels "com.docker.compose.project.config_files"}}'
docker inspect "$LM_CONTAINER" --format '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}'
docker inspect "$LM_CONTAINER" --format '{{range $name, $value := .NetworkSettings.Networks}}{{println $name}}{{end}}'
docker exec "$LM_CONTAINER" node -e '
for (const k of ["SERVER_FLAVOR", "AFFINE_ENV", "AFFINE_INDEXER_ENABLED", "AFFINE_INDEXER_SEARCH_PROVIDER", "AFFINE_INDEXER_SEARCH_ENDPOINT"])
  console.log(k + "=" + (process.env[k] ?? "<unset>"));
'
```

记录 Compose 项目、服务、文件路径、镜像 ID 和挂载目录。不要输出全部环境变量或
完整 `docker inspect` 后上传，它们可能含数据库密码和模型密钥。

如果 Compose 标签为空，当前服务可能由 `docker run`、systemd、Swarm 或其他平台
管理：先找原启动入口，不能在旁边随意创建一个同名 Compose 部署。
如果标签路径不存在，先从部署记录找回原文件；仅凭容器名无法安全恢复完整配置。

## 2. 建立指向原部署的命令

按上一节输出设置变量。`LM_PROJECT_DIR` 使用原 Compose working directory；
`LM_ENV_FILE` 使用原部署实际使用的环境文件，不能新建模板覆盖它。

```sh
LM_PROJECT=$(docker inspect "$LM_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
LM_APP_SERVICE=$(docker inspect "$LM_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.service"}}')
LM_APP_IMAGE=$(docker inspect "$LM_CONTAINER" --format '{{.Image}}')
LM_PROJECT_DIR='/替换为原Compose工作目录'
LM_COMPOSE_FILE='/替换为实际路径/compose.localmind.yml'
LM_ENV_FILE='/替换为实际路径/.env'
LM_MIGRATION_SERVICE='affine_migration'
LM_DB_SERVICE='postgres'

lm_base() {
  docker compose -p "$LM_PROJECT" \
    --project-directory "$LM_PROJECT_DIR" \
    --env-file "$LM_ENV_FILE" \
    -f "$LM_COMPOSE_FILE" "$@"
}

lm_base config --quiet
lm_base config --services
lm_base ps --all
```

若原部署有多个 Compose 文件，在 `lm_base` 中按原顺序列出全部 `-f`；若原部署
没有环境文件，去掉 `--env-file "$LM_ENV_FILE"` 参数。原启动命令里的 profiles、插值环境变量
也要保留。不要把 `compose_files` 的逗号分隔字符串当成一个 `-f` 参数。

核对 `lm_base ps --all` 指向原来的主服务、PostgreSQL 和 Redis。根据服务列表修正
`LM_MIGRATION_SERVICE` 和 `LM_DB_SERVICE`。本文要求原迁移服务与主服务使用相同的
数据库、Redis 和配置挂载；缺少迁移服务时应先从原部署补齐这一等价维护入口。

```sh
LM_DB_CONTAINER=$(lm_base ps -q "$LM_DB_SERVICE")
test -n "$LM_DB_CONTAINER"
docker system df
df -h "$LM_PROJECT_DIR"
free -h
```

确认有能力容纳新搜索服务、索引数据和数据库备份。索引大小及内存占用取决于实际
文档内容，不能从文档篇数直接给出固定值。本流程不执行镜像构建或磁盘清理。

全文检索本身不需要模型，但现有 `indexDoc` 成功后会排队
`copilot.embedding.updateDoc`。如果实例原本支持 Embedding，回填可能连带增加
向量处理负载和模型请求；仍受现有 Embedding 配置约束，本手册不修改这些配置。

## 3. 保存恢复前证据并备份

备份目录可能包含敏感配置，只允许当前管理员访问。下面的文件操作发生在 SSH
服务器上，不是在你的电脑上。

```sh
umask 077
LM_RECOVERY_DIR="$LM_PROJECT_DIR/localmind-indexer-recovery-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LM_RECOVERY_DIR"
cp "$LM_COMPOSE_FILE" "$LM_RECOVERY_DIR/compose.before.yml"
cp "$LM_ENV_FILE" "$LM_RECOVERY_DIR/env.before"
printf '%s\n' "$LM_APP_IMAGE" > "$LM_RECOVERY_DIR/app-image.before.txt"
docker inspect "$LM_CONTAINER" --format '{{json .Mounts}}' > "$LM_RECOVERY_DIR/mounts.before.json"

docker exec "$LM_DB_CONTAINER" sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$LM_RECOVERY_DIR/database.before.dump"
test -s "$LM_RECOVERY_DIR/database.before.dump"
docker exec -i "$LM_DB_CONTAINER" pg_restore --list \
  < "$LM_RECOVERY_DIR/database.before.dump" \
  > "$LM_RECOVERY_DIR/database.before.contents.txt"
```

每条命令都必须成功。`pg_restore --list` 只验证归档可读取，不等于已演练完整恢复。
如果 PostgreSQL 是外部托管实例，使用对应实例的备份方式，不能备份另一个本地库
代替。有多个 Compose/环境文件时逐个备份；没有 `.env` 时跳过对应复制。
挂载的配置目录也应纳入现有备份。本文不会修改文档正文或 Blob。

## 4. 检查镜像和迁移，避免夹带升级

现有 CLI 的 `run` 会执行所有待执行数据迁移，并没有公开的 `run <name>` 命令。
因此先做只读检查。下面脚本验证运行镜像中可识别的迁移名与本文基线一致，且没有
待执行的非索引迁移；不同版本应停下核对，不能删除检查来强行继续。

```sh
docker exec -i -w /app "$LM_CONTAINER" node --input-type=module \
  > "$LM_RECOVERY_DIR/preflight.txt" <<'NODE'
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const known = [
  'Guid1698398506533',
  'UnamedAccount1703756315970',
  'RefreshUnnamedUser1721299086340',
  'CreateIndexerTables1745211351719',
  'CorrectSessionUpdateTime1751966744168',
  'RebuildManticoreMixedScriptIndexes1763800000000',
  'BackfillPermissionProjection1765500000000',
  'BackfillEntitlementProjection1765600000000',
  'BackfillTranscriptStorageKeys1786805802350',
].sort();
const bundle = fs.readFileSync('/app/dist/main.js', 'utf8');
const found = [...new Set(bundle.match(/[A-Z][A-Za-z]+\d{13}/g) ?? [])].sort();
if (JSON.stringify(found) !== JSON.stringify(known)) {
  console.log({ compiledMigrationNames: found });
  throw new Error('镜像迁移清单与本文不一致；请核对该版本源码后再安排恢复');
}
const db = new PrismaClient();
try {
  const schemaRows = await db.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
  `;
  const applied = new Set(schemaRows.filter(r => r.finished_at).map(r => r.migration_name));
  const pendingSchema = fs.readdirSync('/app/migrations', { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d/.test(e.name) && !applied.has(e.name))
    .map(e => e.name);
  if (pendingSchema.length || schemaRows.some(r => !r.finished_at && !r.rolled_back_at))
    throw new Error('存在待执行或失败的 schema 迁移，本次索引恢复不得夹带执行');
  const rows = await db.dataMigration.findMany({
    select: { name: true, finishedAt: true }, orderBy: { name: 'asc' },
  });
  console.table(rows);
  const indexMigrations = new Set([
    'CreateIndexerTables1745211351719',
    'RebuildManticoreMixedScriptIndexes1763800000000',
  ]);
  const completed = new Set(rows.filter(r => r.finishedAt).map(r => r.name));
  const otherPending = known.filter(n => !indexMigrations.has(n) && !completed.has(n));
  if (otherPending.length)
    throw new Error('先处理非索引迁移：' + otherPending.join(', '));
  console.log('PREFLIGHT_OK');
} finally {
  await db.$disconnect();
}
NODE
cat "$LM_RECOVERY_DIR/preflight.txt"
```

只有命令退出码为 0 且末尾显示 `PREFLIGHT_OK` 才继续。此检查依赖当前镜像保留的
迁移类名，不是通用版本识别器；匹配失败需要核对镜像对应源码，不表示数据库损坏。
本手册的索引重建迁移 `down()` 为空，仅在 `revert` 时移除该条数据迁移执行记录；
`up()` 会重建专用 Manticore 的 `doc`、`block` 表并为全部 Workspace 排队回填。

## 5. 增加专用搜索服务和持久化配置

使用独立补充文件，不覆盖原 Compose。下列 heredoc 会将已核对的服务名和镜像 ID
写入文件；执行前确认这些变量仍有值。搜索服务名固定为 `localmind_indexer`，
若原部署已有同名服务，先检查它，不要覆盖已有服务定义。

```sh
LM_INDEXER_OVERRIDE="$LM_PROJECT_DIR/compose.localmind-indexer.override.yml"
test ! -e "$LM_INDEXER_OVERRIDE"
```

如果文件已存在，停止下面的创建步骤，先检查是否已经执行过恢复。

```sh
cat > "$LM_INDEXER_OVERRIDE" <<YAML
services:
  ${LM_APP_SERVICE}:
    image: "${LM_APP_IMAGE}"
    pull_policy: never
    environment:
      AFFINE_INDEXER_ENABLED: 'true'
      AFFINE_INDEXER_SEARCH_PROVIDER: manticoresearch
      AFFINE_INDEXER_SEARCH_ENDPOINT: http://localmind_indexer:9308
    depends_on:
      localmind_indexer:
        condition: service_healthy

  ${LM_MIGRATION_SERVICE}:
    image: "${LM_APP_IMAGE}"
    pull_policy: never
    environment:
      AFFINE_INDEXER_ENABLED: 'true'
      AFFINE_INDEXER_SEARCH_PROVIDER: manticoresearch
      AFFINE_INDEXER_SEARCH_ENDPOINT: http://localmind_indexer:9308
    depends_on:
      localmind_indexer:
        condition: service_healthy

  localmind_indexer:
    image: manticoresearch/manticore:10.1.0
    restart: unless-stopped
    ulimits:
      nproc: 65535
      nofile:
        soft: 65535
        hard: 65535
      memlock:
        soft: -1
        hard: -1
    volumes:
      - localmind_indexer_data:/var/lib/manticore
    healthcheck:
      test: ['CMD', 'searchd', '--status']
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s

volumes:
  localmind_indexer_data:
YAML

lm() {
  lm_base -f "$LM_INDEXER_OVERRIDE" "$@"
}

lm config --quiet
lm config --services
lm pull localmind_indexer
lm up -d --no-deps --no-build localmind_indexer
lm ps localmind_indexer
lm logs --tail=80 localmind_indexer
```

这里沿用仓库开发容器和 CI 的 Manticore `10.1.0` 基线，不使用 `latest`。
`/var/lib/manticore` 是其数据目录；健康检查使用 `searchd --status`。
相关行为见 [Manticore 官方启动文档](https://manual.manticoresearch.com/Starting_the_server/Docker)。
搜索端口没有映射到宿主机，主服务通过 Compose 内网访问。

等待 `lm ps localmind_indexer` 显示 `healthy` 后再继续。若原主服务或迁移服务使用
自定义网络，必须把 `localmind_indexer` 加入它们共同使用的网络，不能只依赖默认网络。
恢复期间用旧主容器执行一次网络检查：

```sh
docker exec "$LM_CONTAINER" node --input-type=module -e '
const r = await fetch("http://localmind_indexer:9308/sql?mode=raw", {
  method: "POST", body: "SHOW TABLES", signal: AbortSignal.timeout(10000),
});
const data = await r.json();
if (!r.ok || !Array.isArray(data) || data.some(x => x.error))
  throw new Error("Manticore HTTP/SQL check failed");
console.log(JSON.stringify(data, null, 2));
'
```

首次应为空表列表。若专用新服务中已经有表，先核对数据卷来源。本流程的重建会清空
其中的 `doc`、`block` 派生索引；不能把共享给其他应用的搜索实例当成本手册目标。

## 6. 维护窗口内初始化并回填

这一节会短暂中断主服务。PostgreSQL、Redis、搜索服务保持运行；数据库备份和第 4 节
检查必须已成功。主服务停下后不再接收编辑和 AI 请求。

```sh
lm_base stop "$LM_APP_SERVICE"
```

### 6.1 保存可能覆盖环境变量的数据库配置

LocalMind 的配置 JSON 和数据库配置都可能覆盖环境变量。下面只保存本次涉及的三个
数据库键，并生成恢复文件；键原先不存在也会记录，便于回滚时准确恢复。

```sh
lm run --rm --no-deps -T -w /app --entrypoint node "$LM_MIGRATION_SERVICE" \
  --input-type=module \
  > "$LM_RECOVERY_DIR/indexer-db-config.before.json" <<'NODE'
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const keys = ['indexer.enabled', 'indexer.provider.type', 'indexer.provider.endpoint'];
try {
  const rows = await db.appConfig.findMany({ where: { id: { in: keys } } });
  console.log(JSON.stringify({ keys, rows }, null, 2));
} finally {
  await db.$disconnect();
}
NODE
test -s "$LM_RECOVERY_DIR/indexer-db-config.before.json"

cat > "$LM_RECOVERY_DIR/indexer-enable.json" <<'JSON'
{
  "indexer": {
    "enabled": true,
    "provider.type": "manticoresearch",
    "provider.endpoint": "http://localmind_indexer:9308"
  }
}
JSON

lm run --rm --no-deps -T -w /app \
  -v "$LM_RECOVERY_DIR/indexer-enable.json:/tmp/localmind-indexer-enable.json:ro" \
  -e SERVER_FLAVOR=script --entrypoint node "$LM_MIGRATION_SERVICE" \
  /app/dist/main.js import-config /tmp/localmind-indexer-enable.json
```

`import-config` 使用现有配置验证与保存入口，只更新上面三个键，不覆盖其他配置。
字段名 `provider.type`、`provider.endpoint` 必须保持点号形式。
这一步后续进程启动时才加载新的数据库配置。

### 6.2 重新执行已有索引重建迁移

先看第 4 节的表格。如果存在
`RebuildManticoreMixedScriptIndexes1763800000000` 这一行，执行：

```sh
lm run --rm --no-deps -T -w /app -e SERVER_FLAVOR=script --entrypoint node \
  "$LM_MIGRATION_SERVICE" /app/dist/main.js \
  revert RebuildManticoreMixedScriptIndexes1763800000000
```

如果从未有这一行，跳过 `revert`。这条迁移在索引关闭时也可能被记录为已完成，
所以单纯再次执行 `run` 不一定会触发全量回填。不要删除其他迁移记录。

然后执行已有数据迁移入口，保存输出并检查退出码：

```sh
lm run --rm --no-deps -T -w /app -e SERVER_FLAVOR=script --entrypoint node \
  "$LM_MIGRATION_SERVICE" /app/dist/main.js run \
  > "$LM_RECOVERY_DIR/indexer-migration.log" 2>&1
LM_MIGRATION_RC=$?
cat "$LM_RECOVERY_DIR/indexer-migration.log"
test "$LM_MIGRATION_RC" -eq 0
```

必须看到创建索引表和运行 `RebuildManticoreMixedScriptIndexes1763800000000`
成功；不能出现 `No search provider found` 或跳过重建的日志。不要改用
`self-host-predeploy.js` 代替这一命令，因为它还会执行 schema 迁移和其他准备动作。

重建迁移会将所有 Workspace 的 `indexed` 置为 `false` 并加入现有索引队列，不依赖
自动扫描“根快照最近 180 天更新”的条件。CLI 为 script 模式，不消费索引任务；
恢复主服务后才开始回填。

### 6.3 重新创建主容器，使配置生效

```sh
lm up -d --no-deps --no-build --pull never --force-recreate "$LM_APP_SERVICE"
LM_CONTAINER=$(lm ps -q "$LM_APP_SERVICE")
docker inspect "$LM_CONTAINER" --format '{{.Image}}'
lm logs --tail=150 "$LM_APP_SERVICE"
```

镜像 ID 应与 `app-image.before.txt` 一致。这里使用 `--no-deps` 是因为依赖已经核对并
启动，可以避免顺带重跑原迁移服务或重新创建 PostgreSQL/Redis。
只执行 `docker restart` 不会更新容器环境变量，不能代替此步骤。

## 7. 验证服务、数据和实际搜索

### 7.1 查看索引表和数量

定义一个仅用于管理员检查的 HTTP SQL 函数：

```sh
lm_index_sql() {
  docker exec "$LM_CONTAINER" node --input-type=module -e '
const r = await fetch("http://localmind_indexer:9308/sql?mode=raw", {
  method: "POST", body: process.argv[1], signal: AbortSignal.timeout(15000),
});
const data = await r.json();
if (!r.ok || !Array.isArray(data) || data.some(x => x.error)) {
  console.error(JSON.stringify(data));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
' "$1"
}

lm_index_sql 'SHOW TABLES'
lm_index_sql 'SELECT COUNT(*) AS count FROM doc'
lm_index_sql 'SELECT COUNT(*) AS count FROM block'
```

应存在 `doc` 和 `block` 表。已有同步文档时，数量应随后台任务执行增加。
该检查只证明搜索引擎和数据存在，不证明 LocalMind 权限过滤或全部历史文档已覆盖。
HTTP SQL 请求格式见 [Manticore 官方 HTTP 文档](https://manual.manticoresearch.com/Connecting_to_the_server/HTTP)。

不要用 `Workspace.indexed=true` 或“迁移执行成功”当作回填完成证明：前者在文档
索引任务排队后就可能设置，后者只证明已发起回填。持续查看：

```sh
lm logs --since=10m --tail=300 "$LM_APP_SERVICE"
lm logs --since=10m --tail=100 localmind_indexer
docker stats --no-stream
```

留意 `indexer.indexWorkspace`、`indexer.indexDoc`、`Job failed`、`failed to parse`、
连接错误，以及 `Workspace keyword index is unavailable`。当前 `indexDoc` 会把解析或
写入异常捕获为 warning，因此只看队列没有 failed 任务也不够。日志可能含业务标识或
查询内容，分享前脱敏。
队列重试耗尽的文档不会因为表中已经有一些数据而自动成为成功，需要定位失败原因。

### 7.2 验证用户能用，不能只测引擎

在正常 LocalMind 页面中完成下面检查，选取允许用于测试的文档：

1. 找一篇很久未更新、已同步到服务端且当前用户可读的旧 Workspace 文档，直接用
   它已有的独特关键词询问 AI。不要先编辑它，否则只能证明增量索引正常。
2. 有超过 200 篇文档时，特意选择更新排序位于 200 篇以后的文档。要求 AI 返回正确
   标题和可打开的文档链接；如果平时通过 MCP 使用，再从原 MCP 客户端重复这一步。
3. 测试一篇临时文档，标题和正文分别放唯一的中文、英文及数字关键词；确认能找到。
4. 修改正文关键词，等待索引任务完成后确认新内容可搜到、旧正文匹配不再残留。
5. 移入回收站后不能通过普通搜索返回；恢复后可重新找到。
6. 换成无权读取该文档的测试账号，确认 AI、MCP 和普通搜索都不能返回它的正文片段。

同时确认应用没有再记录“索引不可用，回退 Markdown 扫描”。普通客户端搜索可能使用
本地索引，因此只验证网页快捷搜索成功不足以证明服务端 AI 检索已经修好。

对于关键 Workspace，记录应覆盖的有效同步文档数量与索引中该 Workspace 的文档
数量，并检查差异；排除本地未同步、回收站等不应被普通搜索命中的资源。
空根快照、损坏快照或解析失败要逐个排查，不能仅凭总数增长就宣布全量完成。

## 8. 常见问题定位

| 现象                                                  | 检查和处理                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SearchProviderNotFound` / `No search provider found` | 检查主服务和迁移进程的三项索引配置；确认第 6.1 节 import-config 成功、进程已重新启动，没有连接另一套数据库。                 |
| `ENOTFOUND localmind_indexer`                         | 两个容器没有共同网络或服务名不同；检查 Compose networks。                                                                    |
| `ECONNREFUSED` / HTTP 超时                            | 搜索服务尚未 healthy、崩溃或地址错误；应用容器中的 localhost 指向应用自身。                                                  |
| `unknown table doc/block`                             | 仅启动搜索引擎，没有成功初始化；检查数据迁移日志和实际 endpoint。                                                            |
| 中文形态分析器 / `jieba_chinese` 错误                 | 核对实际拉取的 Manticore 版本和日志；不要为绕过错误删掉仓库索引定义中的中文配置。                                            |
| 表存在但持续为 0                                      | 检查回填迁移是否真正运行、主进程是否消费 indexer 队列、Redis/队列命名空间是否与迁移进程一致，以及 Workspace 根快照是否存在。 |
| 只查到新文档，旧文档缺失                              | 检查重建迁移执行证据和失败任务；不能只依靠定时补索引，也不能只修改 `indexed` 标志。                                          |
| 环境变量已改但行为没变                                | 容器可能只 restart 未 recreate；数据库、配置 JSON 可能覆盖环境变量；按第 6 节重查。                                          |
| 引擎能找到，AI 找不到                                 | 先查用户实时权限、Workspace 范围和同步状态，再查 AI 实际调用工具及运行日志；不要通过放宽 ACL 解决。                          |
| `unknown command revert/import-config` 或预检版本不符 | 服务器镜像不是本文代码基线；保留现场并核对该版本 CLI，不要临时切换到最新镜像。                                               |

若要重跑全量回填，再执行第 6.2 节之前仍需停止索引 worker；重建会清空派生索引，
不能在 worker 正常写入期间反复执行。不要清空 Redis，不要使用 `down -v`。

## 9. 失败回滚：恢复原应用配置，保留索引数据

只在第 6 节已开始修改配置后需要以下步骤。保留新增搜索服务和数据卷，回滚不需要
恢复整个 PostgreSQL 数据库，也不应覆盖维护后其他正常业务数据。

先停止主服务，避免配置还原期间继续消费索引任务：

```sh
lm stop "$LM_APP_SERVICE"
```

如果已生成第 6.1 节的配置备份，按原值恢复本次涉及的三个数据库键；原先没有的键
会移除。这是有界配置恢复，不修改其他 app_configs 或数据迁移记录。

```sh
lm run --rm --no-deps -T -w /app \
  -v "$LM_RECOVERY_DIR/indexer-db-config.before.json:/tmp/indexer-db-config.before.json:ro" \
  --entrypoint node "$LM_MIGRATION_SERVICE" --input-type=module <<'NODE'
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
const expected = ['indexer.enabled', 'indexer.provider.type', 'indexer.provider.endpoint'];
const saved = JSON.parse(fs.readFileSync('/tmp/indexer-db-config.before.json', 'utf8'));
if (JSON.stringify(saved.keys) !== JSON.stringify(expected) || !Array.isArray(saved.rows) ||
    saved.rows.some(r => !expected.includes(r.id))) throw new Error('配置备份格式不正确');
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    for (const id of expected) {
      const row = saved.rows.find(r => r.id === id);
      if (!row) {
        await tx.appConfig.deleteMany({ where: { id } });
      } else {
        const value = {
          value: row.value, lastUpdatedBy: row.lastUpdatedBy,
          createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt),
        };
        await tx.appConfig.upsert({ where: { id }, create: { id, ...value }, update: value });
      }
    }
  });
  console.log('INDEXER_CONFIG_RESTORED');
} finally {
  await db.$disconnect();
}
NODE
```

创建只固定原镜像的回滚补充文件，使用原配置重新创建主服务：

```sh
cat > "$LM_RECOVERY_DIR/rollback-image.yml" <<YAML
services:
  ${LM_APP_SERVICE}:
    image: "${LM_APP_IMAGE}"
    pull_policy: never
YAML

lm_base -f "$LM_RECOVERY_DIR/rollback-image.yml" \
  up -d --no-deps --no-build --pull never --force-recreate "$LM_APP_SERVICE"
lm_base logs --tail=100 "$LM_APP_SERVICE"
lm stop localmind_indexer
```

确认网页和原 AI 工作流恢复。先前关闭全文索引时，回滚后回到原有有限 Markdown
搜索行为。尚未处理的索引任务和派生索引数据可以保留；下次启用前重新核对回填状态。
如果第 6.2 节已经撤销执行记录但重建失败，不要伪造“已完成”记录。

## 10. 恢复成功后保存部署入口

补充文件必须成为服务器正式部署命令的一部分。以后启动、重新创建或维护 LocalMind
时，在原 Compose 文件之后继续加上：

```text
-f /实际路径/compose.localmind-indexer.override.yml
```

同步更新实际使用的运维脚本、systemd 或部署平台配置；否则下一次只用原 Compose
重新创建服务时，会重新使用原来的 `AFFINE_INDEXER_ENABLED=false`。
本文补充文件固定了恢复时的应用镜像 ID，未来正式升级应用时，应按升级流程同时更新
主服务和迁移服务的镜像设置，避免一直停留在旧镜像。

保存以下恢复记录：主容器与 Compose 服务名、原/新镜像标识、补充文件路径、
备份路径、迁移日志、索引数量、旧文档/增量/权限验收结果、尚未完成的回填任务。
新增 `localmind_indexer_data` 应纳入运维存储管理；它可以从源文档重建，但仍包含
文档派生内容，不能公开共享。

## 实现依据

- [默认 Compose](../.docker/selfhost/compose.localmind.yml)：当前主服务和迁移服务关闭全文索引。
- [索引配置](../packages/backend/server/src/plugins/indexer/config.ts)：三项环境变量与 provider 类型。
- [CLI](../packages/backend/server/src/cli.ts)：`run`、`revert`、`import-config` 的真实入口。
- [数据迁移执行器](../packages/backend/server/src/data/commands/run.ts)：已执行记录及 `always` 行为。
- [索引表初始化](../packages/backend/server/src/data/migrations/1745211351719-create-indexer-tables.ts)：每次 `run` 都尝试创建表。
- [重建迁移](../packages/backend/server/src/data/migrations/1763800000000-rebuild-manticore-mixed-script-indexes.ts)：重建入口与空 `down()`。
- [索引服务](../packages/backend/server/src/plugins/indexer/service.ts)：重建表、清除 indexed 标记、全 Workspace 入队。
- [索引任务](../packages/backend/server/src/plugins/indexer/job.ts)：回填、自动扫描条件及 indexed 标记含义。
- [Docker 开发约束](./localmind-docker-development-constraints.md)：固定应用镜像角色与数据保留要求。
