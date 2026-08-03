// Mock OpenAI-compatible SSE server with configurable quirks, to reproduce
// third-party-proxy behavior against the real pi client.
// MODE=ok        → standard: content deltas + final chunk with finish_reason + [DONE]
// MODE=nofinish  → content deltas + [DONE], never a finish_reason chunk
// MODE=nodone    → content deltas + finish_reason chunk, no [DONE]
// Logs every request's roles + params to stderr for inspection.
import { createServer } from 'node:http';

const MODE = process.env.MODE ?? 'ok';
const PORT = Number(process.env.PORT ?? 45990);

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const roles = (parsed.messages ?? []).map((m) => m.role).join(',');
    console.error(`[mock] ${req.method} ${req.url} roles=[${roles}] reasoning_effort=${JSON.stringify(parsed.reasoning_effort)} stream=${parsed.stream}`);

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const base = { id: 'cmpl-1', object: 'chat.completion.chunk', created: 1, model: parsed.model ?? 'test' };
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { content: ',世界' }, finish_reason: null }] });
    if (MODE !== 'nofinish') {
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    }
    if (MODE !== 'nodone') {
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => console.error(`[mock] MODE=${MODE} listening on ${PORT}`));
