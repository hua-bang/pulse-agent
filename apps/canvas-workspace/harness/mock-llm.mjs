#!/usr/bin/env node
/**
 * Local mock OpenAI-compatible chat completions server for harness E2E.
 * Listens for /v1/chat/completions (stream + non-stream) and echoes the last
 * user message as streamed SSE deltas, so the Canvas Agent pipeline
 * (engine → stream callbacks → conversation runtime → renderer store → UI)
 * can be verified with REAL text without a paid API key.
 *
 * Usage: node mock-llm.mjs [port]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 18100);

function lastUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content
          .filter((p) => p?.type === 'text' || p?.type === 'input_text')
          .map((p) => p.text)
          .join(' ');
        if (text) return text;
      }
    }
  }
  return '(no user message)';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-model', object: 'model' }] }));
    return;
  }

  const chatCompletions = req.method === 'POST' && url.pathname.endsWith('/chat/completions');
  const responses = req.method === 'POST' && url.pathname.endsWith('/responses');
  if (!chatCompletions && !responses) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400);
      res.end('bad json');
      return;
    }
    const userText = lastUserContent(payload.messages || payload.input || []);
    const stream = payload.stream === true;
    const reply = `[mock] you said: ${userText.slice(0, 80)}`;

    if (!stream && chatCompletions) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      }));
      return;
    }

    if (!stream && responses) {
      const createdAt = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `mock-${Date.now()}`,
        created_at: createdAt,
        model: payload.model || 'mock-model',
        output: [{
          type: 'message',
          role: 'assistant',
          id: `msg-${Date.now()}`,
          content: [{ type: 'output_text', text: reply, annotations: [] }],
        }],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const chunks = reply.match(/.{1,5}/gs) || [reply];
    if (responses) {
      const responseId = `mock-${Date.now()}`;
      const messageId = `msg-${Date.now()}`;
      send({
        type: 'response.created',
        response: {
          id: responseId,
          created_at: Math.floor(Date.now() / 1000),
          model: payload.model || 'mock-model',
        },
      });
      send({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: messageId },
      });
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          send({
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'message', id: messageId },
          });
          send({
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          });
          res.end();
          clearInterval(timer);
          return;
        }
        send({
          type: 'response.output_text.delta',
          item_id: messageId,
          delta: chunks[i],
        });
        i++;
      }, 15);
      return;
    }

    let i = 0;
    const timer = setInterval(() => {
      if (i >= chunks.length) {
        send({ id: 'mock-' + Date.now(), object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
        clearInterval(timer);
        return;
      }
      send({ id: 'mock-' + Date.now(), object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: chunks[i] }, finish_reason: null }] });
      i++;
    }, 15);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-llm listening on http://127.0.0.1:${PORT}/v1`);
});
