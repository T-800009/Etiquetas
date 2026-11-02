export const SYSTEM = 'Você é o T800 HACK, tutor de cibersegurança para estudos, CTFs e laboratórios. Responda em português com clareza e precisão. Analise as evidências enviadas, explique os conceitos, separe fatos de hipóteses e ensine uma etapa por vez quando solicitado. Não invente resultados. Ajude com revisão de código, diagnóstico, proteção, correção e exercícios didáticos isolados. Não execute ferramentas ou ações em sistemas externos; não forneça instruções de invasão, evasão de controles ou exploração contra terceiros. Preserve as regras de segurança do provedor.';
export const MODE_INSTRUCTIONS = {
  step: 'Modo passo a passo: apresente uma única ação didática e aguarde o retorno do usuário.',
  deep: 'Modo análise aprofundada: explique fundamentos, evidências, hipóteses e correções com detalhes.',
  quick: 'Modo resposta rápida: seja conciso e priorize a explicação ou correção mais útil.',
  lab: 'Modo código e laboratório: explique e revise código; use exemplos didáticos isolados e inclua a correção de falhas.'
};
export const DEFAULT_MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro 0813' },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' }
];
export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function validPreview(value) {
  return typeof value === 'string' && value.length <= 7200000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
}
export function sanitizeChats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  const chats = Object.create(null);
  for (const [id, c] of Object.entries(value)) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.messages)) continue;
    chats[id] = {
      title: typeof c.title === 'string' ? c.title.slice(0, 150) : 'Nova conversa',
      updated: Number.isFinite(c.updated) ? c.updated : 0,
      messages: c.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({
        role: m.role, content: m.content,
        ...(typeof m.file === 'string' ? { file: m.file.slice(0, 250) } : {}),
        ...(validPreview(m.preview) ? { preview: m.preview } : {}),
        ...(Number.isFinite(m.created) ? { created: m.created } : {}),
        ...(m.interrupted === true ? { interrupted: true } : {})
      }))
    };
  }
  return chats;
}
export function parseStoredChats(raw) {
  if (!raw) return { chats: Object.create(null), corrupted: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid history');
    return { chats: sanitizeChats(parsed), corrupted: false };
  } catch { return { chats: Object.create(null), corrupted: true }; }
}
function inline(text) {
  return String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map(p => {
    if (p.startsWith('`') && p.endsWith('`')) return '<code>' + escapeHTML(p.slice(1, -1)) + '</code>';
    if (p.startsWith('**') && p.endsWith('**')) return '<strong>' + escapeHTML(p.slice(2, -2)) + '</strong>';
    return escapeHTML(p);
  }).join('');
}
function prose(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let output = '', paragraph = [], list = null;
  const flushParagraph = () => { if (paragraph.length) { output += '<p>' + paragraph.map(inline).join('<br>') + '</p>'; paragraph = []; } };
  const closeList = () => { if (list) { output += '</' + list + '>'; list = null; } };
  for (const line of lines) {
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    const bullet = line.match(/^\s*([-*]|\d+[.)])\s+(.+)/);
    if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length + 1, 4); output += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'; }
    else if (bullet) { flushParagraph(); const type = /^\d/.test(bullet[1]) ? 'ol' : 'ul'; if (list !== type) { closeList(); list = type; output += '<' + list + '>'; } output += '<li>' + inline(bullet[2]) + '</li>'; }
    else { closeList(); paragraph.push(line); }
  }
  flushParagraph(); closeList(); return output;
}
export function formatMessage(text = '') {
  return String(text).split('```').map((part, i) => {
    if (i % 2 === 0) return prose(part);
    const nl = part.indexOf('\n');
    const lang = nl >= 0 ? part.slice(0, nl).replace(/[^a-zA-Z0-9_+.-]/g, '').slice(0, 24) : '';
    const code = nl >= 0 ? part.slice(nl + 1).replace(/\n$/, '') : part;
    return '<div class="code-block"><div class="code-heading"><span>' + (lang || 'código') + '</span><button class="copy-code" type="button" aria-label="Copiar código">Copiar código</button></div><pre><code>' + escapeHTML(code) + '</code></pre></div>';
  }).join('');
}
export function buildMessages(messages, mode = 'step', includeImages = false) {
  return [{ role: 'system', content: SYSTEM + '\n' + (MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.step) },
    ...messages.filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-24).map(m => ({ role: m.role, content: includeImages && m.role === 'user' && validPreview(m.preview) ? [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: m.preview } }] : m.content }))];
}
export function streamText(part) {
  if (part?.type === 'error') throw new Error(typeof part.message === 'string' ? part.message : part.message?.message || 'O provedor interrompeu a resposta.');
  if (typeof part?.text === 'string') return part.text;
  if (typeof part?.message?.content === 'string') return part.message.content;
  if (typeof part?.content === 'string') return part.content;
  return '';
}
export function exportMarkdown(chat) {
  return '# ' + (chat.title || 'T800 HACK') + '\n\n' + chat.messages.map(m => '## ' + (m.role === 'user' ? 'Você' : 'T800 HACK') + '\n\n' + m.content + (m.file ? '\n\n[Imagem anexada: ' + m.file + ']' : '') + '\n').join('\n');
}
export function parseImport(text, fileName) {
  if (/\.json$/i.test(fileName)) {
    const parsed = JSON.parse(text);
    const chats = sanitizeChats(parsed.chats || parsed);
    if (!Object.keys(chats).length) throw new Error('O arquivo não contém conversas no formato do T800 HACK.');
    return Object.values(chats);
  }
  const chunks = text.split(/^## (Você|T800 HACK)\s*$/m);
  if (chunks.length < 3) throw new Error('Use o Markdown exportado pelo T800 HACK.');
  const messages = [];
  for (let i = 1; i < chunks.length; i += 2) messages.push({ role: chunks[i] === 'Você' ? 'user' : 'assistant', content: (chunks[i + 1] || '').trim() });
  const title = text.match(/^# (.+)/m)?.[1] || fileName.replace(/\.md$/i, '');
  return [{ title: title.slice(0, 150), messages, updated: Date.now() }];
}
