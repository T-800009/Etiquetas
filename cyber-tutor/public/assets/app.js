import { DEFAULT_MODELS, parseStoredChats, sanitizeChats, escapeHTML, validPreview, formatMessage, buildMessages, streamText, exportMarkdown, parseImport } from '/assets/core.js';

const $ = id => document.getElementById(id);
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>', chevron: '<path d="m7 10 5 5 5-5"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>', 'arrow-down': '<path d="M12 4v16m-7-7 7 7 7-7"/>',
  'arrow-up': '<path d="M12 20V4m-7 7 7-7 7 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>', upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  paperclip: '<path d="m21 11-9 9a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.9-2.9L16 5"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>', square: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  terminal: '<path d="m5 6 5 6-5 6M12 18h7"/>', code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
  shield: '<path d="m12 3 8 4v6c0 4-8 9-8 9s-8-5-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  message: '<path d="M21 11.5A8.5 8.5 0 0 1 8 19l-6 2 2-6a8.5 8.5 0 1 1 17-3.5Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const chat = $('chat'), messages = $('messages'), prompt = $('prompt'), sendButton = $('send'), modelSelect = $('model'), modeSelect = $('mode');
let chats = Object.create(null), currentId = null, pendingImage = null, busy = false, activeController = null;
let manuallyScrolled = false, scrollIntentUntil = 0, toastTimer, knownModels = [], visionModel = null, previewVersion = 0, corruptHistory = null;
let storageAvailable = true, storedModel = '', storedMode = 'step';
try {
  const raw = localStorage.getItem('t800HackChats');
  const parsed = parseStoredChats(raw); chats = parsed.chats;
  if (parsed.corrupted) corruptHistory = raw;
  currentId = localStorage.getItem('t800HackCurrent');
  const prefs = JSON.parse(localStorage.getItem('t800HackPrefs') || '{}');
  storedModel = typeof prefs.model === 'string' ? prefs.model : '';
  storedMode = ['step', 'deep', 'quick', 'lab'].includes(prefs.mode) ? prefs.mode : 'step';
} catch { storageAvailable = false; }
if (!currentId || !chats[currentId]) currentId = Object.keys(chats).sort((a, b) => chats[b].updated - chats[a].updated)[0] || null;
const newId = () => Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), n => n.toString(16).padStart(2, '0')).join('');
function ensureChat() {
  if (!currentId || !chats[currentId]) { currentId = newId(); chats[currentId] = { title: 'Nova conversa', messages: [], updated: Date.now() }; }
  return chats[currentId];
}
function toast(text) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200);
}
function setStatus(text) { $('status').innerHTML = '<span class="status-dot"></span>'; $('status').append(document.createTextNode(text)); }
function persist() {
  try {
    if (corruptHistory) { localStorage.setItem('t800HackRecovery', corruptHistory); corruptHistory = null; }
    localStorage.setItem('t800HackChats', JSON.stringify(chats));
    localStorage.setItem('t800HackCurrent', currentId || '');
    storageAvailable = true; return true;
  } catch { storageAvailable = false; toast('Não foi possível salvar o histórico. Exporte esta conversa para guardá-la.'); return false; }
}
function savePrefs() { try { localStorage.setItem('t800HackPrefs', JSON.stringify({ model: modelSelect.value, mode: modeSelect.value })); } catch { /* The conversation stays usable without local storage. */ } }
const mobile = () => matchMedia('(max-width: 760px)').matches;
function closeSidebar() {
  $('app').classList.remove('sidebar-open'); $('backdrop').hidden = true; $('main').inert = false;
  if (mobile()) { $('sidebar').inert = true; $('toggleSidebar').setAttribute('aria-expanded', 'false'); }
}
function openSidebar() {
  if (mobile()) {
    $('app').classList.remove('sidebar-hidden'); $('app').classList.add('sidebar-open'); $('backdrop').hidden = false;
    $('sidebar').inert = false; $('main').inert = true; $('toggleSidebar').setAttribute('aria-expanded', 'true'); $('closeSidebar').focus();
  } else {
    $('app').classList.remove('sidebar-hidden'); $('sidebar').inert = false; $('toggleSidebar').setAttribute('aria-expanded', 'true');
  }
}
$('toggleSidebar').addEventListener('click', () => {
  if (mobile()) openSidebar();
  else {
    const collapsed = $('app').classList.toggle('sidebar-hidden');
    $('sidebar').inert = collapsed; $('toggleSidebar').setAttribute('aria-expanded', String(!collapsed));
  }
});
$('closeSidebar').addEventListener('click', () => { closeSidebar(); $('toggleSidebar').focus(); });
$('backdrop').addEventListener('click', closeSidebar);
matchMedia('(max-width: 760px)').addEventListener('change', () => {
  $('app').classList.remove('sidebar-hidden'); closeSidebar(); $('sidebar').inert = mobile();
  $('toggleSidebar').setAttribute('aria-expanded', String(!mobile()));
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); startNewChat(); }
  if (event.key === 'Escape' && $('app').classList.contains('sidebar-open')) { closeSidebar(); $('toggleSidebar').focus(); }
  if (event.key === 'Tab' && $('app').classList.contains('sidebar-open')) {
    const controls = Array.from($('sidebar').querySelectorAll('button:not(:disabled),input:not([hidden]),select:not(:disabled)')).filter(el => el.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function nearBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90; }
const markScrollIntent = () => { scrollIntentUntil = performance.now() + 700; };
chat.addEventListener('wheel', markScrollIntent, { passive: true });
chat.addEventListener('touchmove', markScrollIntent, { passive: true });
chat.addEventListener('pointerdown', event => { if (event.clientX >= chat.getBoundingClientRect().right - 18) markScrollIntent(); });
chat.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markScrollIntent(); });
chat.addEventListener('scroll', () => {
  if (performance.now() < scrollIntentUntil) manuallyScrolled = !nearBottom();
  else if (nearBottom()) manuallyScrolled = false;
  $('jumpBottom').hidden = !manuallyScrolled || !ensureChat().messages.length;
}, { passive: true });
function scrollBottom(force = false) {
  if (force) { manuallyScrolled = false; scrollIntentUntil = 0; }
  if (!manuallyScrolled) requestAnimationFrame(() => { chat.scrollTo({ top: chat.scrollHeight, behavior: 'instant' }); $('jumpBottom').hidden = true; });
}
$('jumpBottom').addEventListener('click', () => scrollBottom(true));
function updateDraft() {
  prompt.style.height = 'auto'; prompt.style.height = Math.min(prompt.scrollHeight, 180) + 'px';
  sendButton.disabled = busy || (!prompt.value.trim() && !pendingImage);
}
prompt.addEventListener('input', updateDraft);
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) send(); }
});
function setBusy(value) {
  busy = value;
  for (const id of ['newChat', 'mobileNewChat', 'model', 'mode', 'clearHistory', 'importChat', 'attachButton', 'removeFile', 'signIn']) $(id).disabled = value;
  document.querySelectorAll('.conv').forEach(el => { el.disabled = value; });
  $('stop').hidden = !value; sendButton.hidden = value; updateDraft();
  $('chat').setAttribute('aria-busy', String(value));
}
function emptyState() {
  const root = document.createElement('div'); root.className = 'welcome';
  root.innerHTML = '<div class="hero-image-wrap"><img class="hero-image" src="/assets/t800.jpg" alt="T-800" width="84" height="94"></div><p class="hero-eyebrow"><span class="blue-dot"></span> SEU ESPAÇO DE INVESTIGAÇÃO</p><h1>T800 <span>HACK</span></h1><p class="welcome-subtitle">Entenda o porquê. Aprenda o próximo passo.</p><p class="welcome-description">Do primeiro log à revisão de código. Traga suas evidências e construa o raciocínio, uma etapa de cada vez.</p><div class="quickstarts"></div><p class="welcome-note">CIBERSEGURANÇA · CTFs · LABORATÓRIOS</p>';
  const starts = [
    { icon: 'terminal', title: 'Entender uma saída', detail: 'Logs, erros e diagnósticos', prompt: 'Quero entender uma saída do meu laboratório. Vou colar o log a seguir; explique os achados e o que preciso verificar.' },
    { icon: 'shield', title: 'Estudar um conceito', detail: 'Fundamentos com exemplos', prompt: 'Explique autenticação e autorização com um exemplo simples e um exercício didático local.' },
    { icon: 'code', title: 'Revisar um código', detail: 'Encontre a causa. Entenda a correção.', prompt: 'Quero revisar um código do meu projeto. Vou colá-lo a seguir; explique os problemas e como corrigi-los.' }
  ];
  for (const s of starts) {
    const button = document.createElement('button'); button.className = 'quickstart'; button.type = 'button';
    button.innerHTML = '<span class="quickstart-icon">' + icon(s.icon) + '</span><strong>' + s.title + '</strong><small>' + s.detail + '</small><span class="quickstart-arrow">' + icon('arrow-up-right') + '</span>';
    button.addEventListener('click', () => { prompt.value = s.prompt; updateDraft(); prompt.focus(); });
    root.querySelector('.quickstarts').appendChild(button);
  }
  return root;
}
async function copyText(value, control, successText) {
  try { await navigator.clipboard.writeText(value); if (successText) { const old = control.innerHTML; control.textContent = successText; setTimeout(() => { if (control.isConnected) control.innerHTML = old; }, 1800); } else toast('Mensagem copiada.'); }
  catch { toast('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }
}
function addMessage(message, options = {}) {
  messages.querySelector('.welcome')?.remove();
  const row = document.createElement('article'); row.className = 'message ' + message.role + (options.error ? ' error' : '');
  const head = document.createElement('div'); head.className = 'message-head';
  head.innerHTML = message.role === 'assistant' ? '<img src="/assets/t800.jpg" alt="T-800" width="26" height="28"><span>T800 HACK</span>' : '<span class="you-avatar">EU</span><span>Você</span>';
  if (message.created) { const time = document.createElement('span'); time.className = 'message-time'; time.textContent = new Date(message.created).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); head.appendChild(time); }
  const body = document.createElement('div'); body.className = 'message-body'; body.innerHTML = options.loading ? '<span class="generating" aria-label="Preparando resposta"><i></i><i></i><i></i></span>' : formatMessage(message.content);
  row.append(head, body);
  if (message.file) { const file = document.createElement('div'); file.className = 'message-attachment'; file.innerHTML = icon('paperclip'); file.append(document.createTextNode(message.file)); body.appendChild(file); }
  if (validPreview(message.preview)) { const image = document.createElement('img'); image.className = 'message-preview'; image.src = message.preview; image.alt = message.file || 'Imagem anexada'; image.addEventListener('load', () => scrollBottom()); body.appendChild(image); }
  if (message.interrupted) { const note = document.createElement('p'); note.className = 'partial-note'; note.textContent = 'Resposta interrompida'; row.appendChild(note); }
  if (message.role === 'assistant' && !options.loading && !options.error) {
    const foot = document.createElement('div'); foot.className = 'message-footer';
    const copy = document.createElement('button'); copy.className = 'copy-message'; copy.type = 'button'; copy.setAttribute('aria-label', 'Copiar resposta'); copy.title = 'Copiar resposta'; copy.innerHTML = icon('copy'); copy.addEventListener('click', () => copyText(message.content, copy)); foot.appendChild(copy); row.appendChild(foot);
  }
  messages.appendChild(row); scrollBottom(); return row;
}
messages.addEventListener('click', event => {
  const button = event.target.closest('.copy-code');
  if (button) copyText(button.closest('.code-block').querySelector('code').textContent, button, 'Copiado!');
});
function renderConversations() {
  const list = $('convList'), search = $('searchChats').value.trim().toLocaleLowerCase('pt-BR'); list.replaceChildren();
  const records = Object.entries(chats).sort((a, b) => b[1].updated - a[1].updated);
  $('chatCount').textContent = records.length;
  const matching = records.filter(([, c]) => c.title.toLocaleLowerCase('pt-BR').includes(search));
  for (const [id, c] of matching) {
    const button = document.createElement('button'); button.className = 'conv' + (id === currentId ? ' active' : ''); button.type = 'button'; button.disabled = busy; button.title = c.title;
    button.innerHTML = icon('message') + '<span></span>'; button.querySelector('span').textContent = c.title;
    if (id === currentId) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => { if (busy) return; currentId = id; persist(); clearAttachment(); prompt.value = ''; updateDraft(); renderAll(); closeSidebar(); });
    list.appendChild(button);
  }
  if (!matching.length) { const p = document.createElement('p'); p.className = 'no-results'; p.textContent = search ? 'Nenhuma conversa encontrada.' : 'Suas conversas aparecerão aqui.'; list.appendChild(p); }
}
$('searchChats').addEventListener('input', renderConversations);
function renderAll() {
  const c = ensureChat(); messages.replaceChildren(); manuallyScrolled = false;
  if (!c.messages.length) messages.appendChild(emptyState()); else c.messages.forEach(m => addMessage(m));
  $('conversationTitle').textContent = c.title; $('exportChat').disabled = !c.messages.length;
  renderConversations(); scrollBottom(true);
}
function startNewChat() {
  if (busy) return;
  const c = ensureChat();
  if (c.messages.length) { currentId = newId(); chats[currentId] = { title: 'Nova conversa', messages: [], updated: Date.now() }; }
  $('searchChats').value = ''; prompt.value = ''; clearAttachment(); updateDraft(); persist(); renderAll(); closeSidebar(); setStatus('Pronto para conversar'); prompt.focus();
}
$('newChat').addEventListener('click', startNewChat); $('mobileNewChat').addEventListener('click', startNewChat);
$('clearHistory').addEventListener('click', () => { if (!busy) $('clearDialog').showModal(); });
$('clearDialog').addEventListener('close', () => {
  if ($('clearDialog').returnValue !== 'clear' || busy) return;
  chats = Object.create(null); currentId = null; clearAttachment(); prompt.value = ''; updateDraft(); renderAll(); persist();
  $('searchChats').value = ''; renderConversations(); toast('Histórico deste navegador limpo.');
});
$('exportChat').addEventListener('click', () => {
  const c = ensureChat(); if (!c.messages.length) return;
  const url = URL.createObjectURL(new Blob([exportMarkdown(c)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = c.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 65) + '.md'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Conversa exportada em Markdown.');
});
$('importChat').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files?.[0]; $('importFile').value = ''; if (!file || busy) return;
  if (file.size > 10 * 1024 * 1024) { toast('Escolha um arquivo de até 10 MB.'); return; }
  try {
    const imported = parseImport(await file.text(), file.name);
    for (const c of imported) { currentId = newId(); chats[currentId] = c; }
    $('searchChats').value = ''; persist(); renderAll(); closeSidebar(); toast(imported.length === 1 ? 'Conversa importada.' : imported.length + ' conversas importadas.');
  } catch (error) { toast('Não foi possível importar: ' + (error.message || 'arquivo inválido')); }
});
function clearAttachment() { previewVersion++; pendingImage = null; $('file').value = ''; $('attachmentPreview').hidden = true; $('attachmentImage').removeAttribute('src'); $('fileName').textContent = ''; updateDraft(); }
$('removeFile').addEventListener('click', clearAttachment);
$('attachButton').addEventListener('click', () => $('file').click());
async function attachFile(file) {
  if (!file || busy) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast('Use uma imagem PNG, JPG ou WebP.'); $('file').value = ''; return; }
  if (file.size > 5 * 1024 * 1024) { toast('A imagem deve ter até 5 MB.'); $('file').value = ''; return; }
  const version = ++previewVersion;
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    if (version !== previewVersion) return;
    if (!validPreview(data)) throw new Error('Formato inválido');
    pendingImage = { name: file.name || 'print.png', data }; $('attachmentImage').src = data; $('fileName').textContent = pendingImage.name; $('attachmentPreview').hidden = false; updateDraft(); prompt.focus();
  } catch { toast('Não foi possível ler esta imagem.'); }
}
$('file').addEventListener('change', () => attachFile($('file').files?.[0]));
prompt.addEventListener('paste', event => { const image = Array.from(event.clipboardData?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/')); if (image) { event.preventDefault(); attachFile(image.getAsFile()); } });
modeSelect.value = storedMode;
function refreshMode() { $('activeMode').textContent = modeSelect.options[modeSelect.selectedIndex].textContent; }
modeSelect.addEventListener('change', () => { refreshMode(); savePrefs(); }); refreshMode();
modelSelect.addEventListener('change', () => { savePrefs(); updateModelHint(); });
function updateModelHint() {
  if (knownModels.length) $('modelHint').textContent = visionModel ? 'Imagens usam visão automaticamente.' : 'Modelo verificado no catálogo Puter.';
  else $('modelHint').textContent = 'Catálogo indisponível. Reconecte para verificar os modelos.';
}
async function refreshModels() {
  try {
    const catalog = await window.puter.ai.listModels();
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('Catálogo vazio');
    const all = Array.from(new Map(catalog.filter(m => typeof m.id === 'string').map(m => [m.id, m])).values());
    const preferred = DEFAULT_MODELS.map(m => all.find(item => item.id === m.id)).filter(Boolean);
    const deepseek = all.filter(m => /deepseek/i.test(m.id) && !/distill|ocr|0324|r1-0528/.test(m.id)).slice(0, 12);
    const others = all.filter(m => /^(?:gemini-3\.5-flash-lite|gpt-5\.4-nano|mistral-small-latest|claude-sonnet-4-6)$/.test(m.id));
    const choices = Array.from(new Map([...preferred, ...deepseek, ...others].map(m => [m.id, m])).values());
    knownModels = choices.length ? choices : all.slice(0, 20);
    visionModel = all.find(m => /deepseek.*vision/i.test(m.id))?.id || all.find(m => m.id === 'gemini-3.5-flash-lite')?.id || all.find(m => m.id === 'gpt-5.4-nano')?.id || all.find(m => m.id === 'claude-sonnet-4-6')?.id || null;
    const previous = storedModel || modelSelect.value; modelSelect.replaceChildren();
    for (const m of knownModels) { const option = document.createElement('option'); option.value = m.id; option.textContent = DEFAULT_MODELS.find(x => x.id === m.id)?.name || (m.name || m.id).replace(/^DeepSeek: /i, '').replace(/ — .*/, ''); option.title = m.id; modelSelect.appendChild(option); }
    if (knownModels.some(m => m.id === previous)) modelSelect.value = previous;
    $('catalogState').textContent = 'Catálogo verificado'; updateModelHint();
  } catch { $('catalogState').textContent = 'Verificar conexão'; updateModelHint(); }
}
async function refreshAuth() {
  try {
    const signedIn = await window.puter.auth.isSignedIn();
    if (signedIn) {
      const user = await window.puter.auth.getUser(); $('accountName').textContent = user.username || 'Conta conectada'; $('authState').textContent = 'Puter conectado'; $('accountDot').classList.add('connected'); $('signIn').firstChild.textContent = 'Conta conectada '; $('signIn').setAttribute('aria-label', 'Conta Puter conectada');
    } else { $('accountName').textContent = 'Sua conta Puter'; $('authState').textContent = 'Conecte para começar'; $('accountDot').classList.remove('connected'); }
    return signedIn;
  } catch { $('authState').textContent = 'Puter indisponível'; return false; }
}
$('signIn').addEventListener('click', async () => {
  if (!window.puter?.auth) { toast('Não foi possível carregar o Puter. Confira a conexão e recarregue a página.'); return; }
  try {
    if (await window.puter.auth.isSignedIn()) { toast('Sua conta Puter já está conectada.'); return; }
    await window.puter.auth.signIn();
    if (await refreshAuth()) { toast('Conta conectada. Você já pode enviar sua mensagem.'); closeSidebar(); prompt.focus(); refreshModels(); }
  } catch (error) { toast('Conexão não concluída. Sua mensagem continua aqui.'); }
});
$('composer').addEventListener('submit', event => { event.preventDefault(); send(); });
$('stop').addEventListener('click', () => { activeController?.abort(); setStatus('Interrompendo resposta…'); });
async function send() {
  const text = prompt.value.trim(); if (busy || (!text && !pendingImage)) return;
  if (!window.puter?.ai) { toast('O Puter está indisponível. Confira sua conexão. Sua mensagem foi mantida.'); return; }
  setBusy(true);
  if (!(await refreshAuth())) { setBusy(false); toast('Conecte sua conta Puter para enviar. Sua mensagem foi mantida.'); openSidebar(); $('signIn').focus(); return; }
  if (pendingImage && !visionModel) { setBusy(false); toast('Não consegui confirmar um modelo com visão. Conecte novamente e tente outra vez.'); return; }
  // Capture the conversation before awaiting the provider. UI changes cannot redirect its reply.
  const c = ensureChat(), useVision = Boolean(pendingImage), usedModel = useVision ? visionModel : modelSelect.value;
  const user = { role: 'user', content: text || 'Explique o que aparece nesta imagem.', created: Date.now(), ...(pendingImage ? { file: pendingImage.name, preview: pendingImage.data } : {}) };
  c.messages.push(user); if (c.title === 'Nova conversa' || c.title === 'Novo chat') c.title = (text || pendingImage?.name || 'Análise de imagem').slice(0, 65); c.updated = Date.now();
  persist(); manuallyScrolled = false; addMessage(user); renderConversations(); $('conversationTitle').textContent = c.title; $('exportChat').disabled = false;
  prompt.value = ''; clearAttachment(); updateDraft(); setBusy(true); setStatus(useVision ? 'Lendo imagem…' : 'Preparando resposta…');
  const controller = new AbortController(); activeController = controller;
  let draft = addMessage({ role: 'assistant', content: '' }, { loading: true }), output = '', completed = false, timedOut = false, providerError = null;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
  try {
    const response = await window.puter.ai.chat(buildMessages(c.messages, modeSelect.value, useVision), { model: usedModel, stream: true, temperature: .2, signal: controller.signal });
    if (!response?.[Symbol.asyncIterator]) throw new Error('O provedor não retornou um fluxo de resposta válido.');
    setStatus('T800 HACK está respondendo…');
    for await (const part of response) {
      if (controller.signal.aborted) break;
      const chunk = streamText(part);
      if (chunk) { output += chunk; draft.querySelector('.message-body').innerHTML = formatMessage(output); scrollBottom(); }
    }
    if (!output && !controller.signal.aborted) throw new Error('O modelo encerrou sem enviar conteúdo. Tente outro modelo.');
    completed = !controller.signal.aborted;
  } catch (error) {
    if (!controller.signal.aborted) {
      const detail = error?.message || error?.error?.message || (typeof error === 'string' ? error : 'Não foi possível concluir a solicitação.');
      providerError = 'Não consegui concluir a resposta: ' + detail;
    }
  } finally {
    clearTimeout(timer); activeController = null; draft.remove();
    if (output) { const assistant = { role: 'assistant', content: output, created: Date.now(), ...(!completed ? { interrupted: true } : {}) }; c.messages.push(assistant); addMessage(assistant); }
    if (providerError) addMessage({ role: 'assistant', content: providerError }, { error: true });
    if (timedOut) toast('O provedor demorou para responder. Você pode tentar outro modelo.');
    else if (controller.signal.aborted && !output) toast('Resposta interrompida. A mensagem enviada foi preservada.');
    c.updated = Date.now(); persist(); renderConversations(); setBusy(false); setStatus(completed ? 'Resposta concluída' : controller.signal.aborted ? 'Resposta interrompida' : 'Resposta não concluída'); scrollBottom(); prompt.focus();
  }
}
async function initProvider() {
  for (let i = 0; i < 40 && !window.puter?.ai; i++) await new Promise(resolve => setTimeout(resolve, 125));
  if (window.puter?.ai) { await Promise.allSettled([refreshAuth(), refreshModels()]); }
  else { $('authState').textContent = 'Puter indisponível'; $('catalogState').textContent = 'Sem conexão'; updateModelHint(); }
}
new ResizeObserver(entries => { $('jumpBottom').style.bottom = Math.ceil(entries[0].contentRect.height + 22) + 'px'; }).observe(document.querySelector('.composer-shell'));
renderAll(); updateDraft(); closeSidebar(); initProvider();
if (!storageAvailable) toast('O navegador não permitiu ler o histórico local. Você pode conversar e exportar.');
else if (corruptHistory) toast('O histórico salvo está inválido. Uma cópia será preservada antes de salvar novas conversas.');
