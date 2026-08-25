import http from 'node:http';

const port = Number.parseInt(process.env.SPARKCLAW_ADAPTER_PORT ?? '3100', 10);
const embeddingOrigin =
  process.env.SPARKCLAW_EMBEDDING_ORIGIN ??
  'https://sparkclaw.infinimesh.cloud/embedding';
const rerankOrigin =
  process.env.SPARKCLAW_RERANK_ORIGIN ??
  'https://sparkclaw.infinimesh.cloud/reranker';
const upstreamTimeoutMs = Number.parseInt(
  process.env.SPARKCLAW_UPSTREAM_TIMEOUT_MS ?? '5000',
  10
);

function upstreamSignal() {
  return AbortSignal.timeout(upstreamTimeoutMs);
}

function jsonResponse(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function forwardedHeaders(request) {
  const headers = { 'content-type': 'application/json' };
  if (request.headers.authorization) {
    headers.authorization = request.headers.authorization;
  }
  return headers;
}

async function forward(response, target, request, body) {
  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardedHeaders(request),
    signal: upstreamSignal(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  response.writeHead(upstream.status, {
    'content-type':
      upstream.headers.get('content-type') ?? 'application/json',
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function extractRerankPair(messages) {
  const userMessage = [...(messages ?? [])]
    .reverse()
    .find(message => message?.role === 'user');
  const content =
    typeof userMessage?.content === 'string'
      ? userMessage.content
      : Array.isArray(userMessage?.content)
        ? userMessage.content
            .filter(part => part?.type === 'text')
            .map(part => part.text)
            .join('\n')
        : '';
  const match = content.match(
    /<Query>:\s*([\s\S]*?)\n<Document>:\s*([\s\S]*)$/
  );
  return match
    ? { query: match[1].trim(), document: match[2].trim() }
    : null;
}

async function handleEmbedding(request, response, suffix) {
  if (request.method === 'POST' && suffix === '/v1/embeddings') {
    const body = await readJson(request);
    delete body.dimensions;
    await forward(
      response,
      `${embeddingOrigin}/v1/embeddings`,
      request,
      body
    );
    return;
  }
  await forward(response, `${embeddingOrigin}${suffix}`, request);
}

async function handleRerank(request, response, suffix) {
  if (
    request.method === 'POST' &&
    (suffix === '/chat/completions' || suffix === '/v1/chat/completions')
  ) {
    const body = await readJson(request);
    const pair = extractRerankPair(body.messages);
    if (!pair) {
      jsonResponse(response, 400, {
        error: {
          message: 'Unable to extract query and document from rerank request',
          type: 'adapter_error',
        },
      });
      return;
    }

    const upstream = await fetch(`${rerankOrigin}/v1/rerank`, {
      method: 'POST',
      headers: forwardedHeaders(request),
      signal: upstreamSignal(),
      body: JSON.stringify({
        model: body.model,
        query: pair.query,
        documents: [pair.document],
        top_n: 1,
      }),
    });
    const upstreamBody = await upstream.json();
    if (!upstream.ok) {
      jsonResponse(response, upstream.status, upstreamBody);
      return;
    }

    const rawScore = Number(upstreamBody.results?.[0]?.relevance_score ?? 0);
    const score = Math.min(1 - 1e-12, Math.max(1e-12, rawScore));
    jsonResponse(response, 200, {
      id: upstreamBody.id ?? 'chatcmpl-sparkclaw-rerank',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: upstreamBody.model ?? body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: score >= 0.5 ? 'Yes' : 'No',
          },
          logprobs: {
            content: [
              {
                token: score >= 0.5 ? ' Yes' : ' No',
                logprob: Math.log(Math.max(score, 1 - score)),
                bytes: null,
                top_logprobs: [
                  { token: ' Yes', logprob: Math.log(score), bytes: null },
                  { token: ' No', logprob: Math.log(1 - score), bytes: null },
                ],
              },
            ],
          },
          finish_reason: 'stop',
        },
      ],
      usage: upstreamBody.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
    return;
  }
  await forward(response, `${rerankOrigin}${suffix}`, request);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === '/health') {
      jsonResponse(response, 200, { status: 'ok' });
      return;
    }
    if (url.pathname.startsWith('/embedding')) {
      await handleEmbedding(
        request,
        response,
        url.pathname.slice('/embedding'.length) || '/'
      );
      return;
    }
    if (url.pathname.startsWith('/reranker')) {
      await handleRerank(
        request,
        response,
        url.pathname.slice('/reranker'.length) || '/'
      );
      return;
    }
    jsonResponse(response, 404, { error: 'not_found' });
  } catch (error) {
    jsonResponse(response, 502, {
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'adapter_error',
      },
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Sparkclaw adapter listening on ${port}`);
});
