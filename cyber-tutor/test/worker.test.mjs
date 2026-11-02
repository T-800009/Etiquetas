import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, stat } from 'node:fs/promises';
import worker from '../src/index.js';
import * as core from '../public/assets/core.js';

test('Public page references real styles, modules and the T-800 image', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>T800 HACK<\/title>/);
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m => m[1]);
  for (const path of new Set(assetPaths)) {
    assert.ok((await stat(new URL('../public' + path, import.meta.url))).size > 100, path);
  }
  const image = await readFile(new URL('../public/assets/t800.jpg', import.meta.url));
  assert.deepEqual([...image.subarray(0, 3)], [255, 216, 255]);
  assert.deepEqual([...image.subarray(-2)], [255, 217]);
  assert.match(html, /id="prompt"/); assert.match(html, /id="toggleSidebar"/);
});
test('Worker health, HEAD, method handling and static-asset delegation', async () => {
  const health = await worker.fetch(new Request('https://example.test/api/health'), {});
  assert.deepEqual(await health.json(), { ok: true, name: 'T800 HACK', runtime: 'Cloudflare Worker', aiProvider: 'Puter', version: '2.0.0' });
  assert.equal(await (await worker.fetch(new Request('https://example.test/api/health', { method: 'HEAD' }), {})).text(), '');
  assert.equal((await worker.fetch(new Request('https://example.test/api/health', { method: 'POST' }), {})).status, 405);
  assert.equal((await worker.fetch(new Request('https://example.test/api/missing'), {})).status, 404);
  const request = new Request('https://example.test/assets/app.js');
  const response = await worker.fetch(request, { ASSETS: { fetch: incoming => { assert.equal(incoming, request); return new Response('asset'); } } });
  assert.equal(await response.text(), 'asset');
});
test('Saved history tolerates corruption and rejects invalid message shapes', () => {
  assert.equal(core.parseStoredChats('{broken').corrupted, true);
  assert.equal(core.parseStoredChats('[]').corrupted, true);
  const result = core.parseStoredChats(JSON.stringify({ a: { title: 'Antiga conversa', messages: [{ role: 'user', content: 'oi' }, { role: 'system', content: 'bad' }, { role: 'assistant', content: 'olá', preview: 'javascript:alert(1)' }] } }));
  assert.equal(result.chats.a.messages.length, 2); assert.equal(result.chats.a.messages[1].preview, undefined);
  assert.equal(Object.getPrototypeOf(result.chats), null);
});
test('Markdown escapes HTML and renders code, lists, headings and partial fences', () => {
  const formatted = core.formatMessage('# Teste\n\n**forte** e `inline`\n\n- um\n- dois\n\n```python\nprint("<script>")\n```\n<img src=x onerror=alert(1)>');
  assert.ok(formatted.includes('<h2>Teste</h2>')); assert.ok(formatted.includes('<strong>forte</strong>')); assert.ok(formatted.includes('<ul><li>um</li>'));
  assert.ok(formatted.includes('print(&quot;&lt;script&gt;&quot;)')); assert.ok(!formatted.includes('<img')); assert.ok(formatted.includes('Copiar código'));
  assert.ok(core.formatMessage('```js\nconst a = 1').includes('const a = 1'));
});
test('Request builder bounds context, protects system role and handles images', () => {
  const preview = 'data:image/png;base64,YWJj';
  const source = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i), ...(i === 28 ? { preview } : {}) }));
  source.push({ role: 'system', content: 'untrusted' });
  const built = core.buildMessages(source, 'step', true);
  assert.equal(built.length, 25); assert.equal(built[0].role, 'system'); assert.equal(built[1].content, '6');
  assert.equal(built.at(-2).content[1].image_url.url, preview);
  assert.equal(core.buildMessages(source, 'step', false).at(-2).content, '28');
});
test('Streaming accepts text chunks and detects provider failures', () => {
  assert.equal(core.streamText({ type: 'text', text: 'olá' }), 'olá');
  assert.equal(core.streamText({ message: { content: 'mundo' } }), 'mundo');
  assert.equal(core.streamText({ type: 'usage', usage: {} }), '');
  assert.throws(() => core.streamText({ type: 'error', message: 'quota' }), /quota/);
});
test('Exported Markdown round-trips through conversation import', () => {
  const chat = { title: 'Teste de migração', messages: [{ role: 'user', content: 'O que significa HTTP 200?' }, { role: 'assistant', content: 'A requisição foi atendida.\n\n```text\nHTTP/1.1 200 OK\n```' }] };
  const [imported] = core.parseImport(core.exportMarkdown(chat), 'teste.md');
  assert.equal(imported.title, chat.title); assert.deepEqual(imported.messages, chat.messages);
  assert.equal(core.parseImport(JSON.stringify({ chats: { a: chat } }), 'historia.json').length, 1);
  assert.throws(() => core.parseImport('{}', 'historia.json'));
  assert.throws(() => core.parseImport('apenas texto', 'erro.md'));
});
test('Browser modules parse without relying on a bundler', async () => {
  for (const name of ['app.js', 'core.js']) new vm.SourceTextModule(await readFile(new URL('../public/assets/' + name, import.meta.url), 'utf8'));
});
test('Deploy scripts select the T800 configuration within the shared repository', async () => {
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const packageJSON = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(config, /^name = "t800-hack"$/m);
  assert.match(config, /directory = "\.\/public"/);
  assert.match(packageJSON.scripts.deploy, /--config \.\/wrangler\.toml/);
  assert.match(packageJSON.scripts.dev, /--config \.\/wrangler\.toml/);
  assert.ok(!config.includes('d1_databases'));
});
