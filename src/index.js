// Site de etiquetas de material rodando na Cloudflare (Worker + banco D1).
// Os arquivos da tela (pasta public/) são servidos pela própria Cloudflare;
// este Worker cuida da API, das fotos e da página aberta pelo QR code.

const CAMPOS = ['codigo', 'referencia', 'bom', 'descricao', 'endereco', 'projeto'];
const LIMITE_JSON = 20 * 1024 * 1024;
// O D1 aceita no máximo 2 MB por linha; as fotos chegam reduzidas pelo navegador.
const LIMITE_IMAGEM = 1900 * 1024;
// Imagens baixadas da internet podem ser grandes; o navegador reduz antes de salvar.
const LIMITE_DOWNLOAD = 10 * 1024 * 1024;
const MAX_TENTATIVAS = 10;
const JANELA_TENTATIVAS_MS = 10 * 60 * 1000;
const ITERACOES_PIN = 100000;

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS itens (
    id TEXT PRIMARY KEY,
    codigo TEXT NOT NULL,
    referencia TEXT NOT NULL DEFAULT '',
    bom TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    endereco TEXT NOT NULL DEFAULT '',
    projeto TEXT NOT NULL DEFAULT '',
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS itens_codigo ON itens (upper(codigo))',
  `CREATE TABLE IF NOT EXISTS fotos (
    codigo_chave TEXT PRIMARY KEY,
    codigo TEXT NOT NULL,
    arquivo TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL,
    dados BLOB NOT NULL,
    atualizado_em TEXT NOT NULL,
    origem TEXT NOT NULL DEFAULT 'foto',
    credito TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS arquivos (
    nome TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    dados BLOB NOT NULL
  )`,
  'CREATE TABLE IF NOT EXISTS tentativas (ip TEXT PRIMARY KEY, inicio INTEGER NOT NULL, falhas INTEGER NOT NULL)',
];

// Cria as tabelas na primeira requisição: não é preciso rodar nenhum comando no banco.
let esquemaPronto = null;
function garantirEsquema(db) {
  esquemaPronto ??= (async () => {
    await db.batch(ESQUEMA.map((sql) => db.prepare(sql)));
    // Bancos criados antes da busca na internet não têm as colunas "origem" e "credito".
    const { results } = await db.prepare('PRAGMA table_info(fotos)').all();
    if (!results.some((c) => c.name === 'origem')) {
      await db.prepare("ALTER TABLE fotos ADD COLUMN origem TEXT NOT NULL DEFAULT 'foto'").run();
    }
    if (!results.some((c) => c.name === 'credito')) {
      await db.prepare("ALTER TABLE fotos ADD COLUMN credito TEXT NOT NULL DEFAULT ''").run();
    }
  })().catch((err) => {
    esquemaPronto = null;
    throw err;
  });
  return esquemaPronto;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function limparTexto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizarItem(entrada) {
  const item = {};
  for (const campo of CAMPOS) item[campo] = limparTexto(entrada && entrada[campo]);
  return item;
}

function chaveItem(item) {
  return [item.codigo, item.endereco, item.projeto].map((v) => v.toUpperCase()).join('|');
}

function novoId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function lerCorpo(request, limite) {
  const tamanho = Number(request.headers.get('content-length'));
  if (tamanho > limite) throw new ErroHttp(413, 'Arquivo grande demais.');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > limite) throw new ErroHttp(413, 'Arquivo grande demais.');
  return new Uint8Array(buf);
}

async function lerJson(request) {
  const corpo = await lerCorpo(request, LIMITE_JSON);
  if (!corpo.length) return {};
  try {
    return JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

function tipoImagem(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: '.jpg', tipo: 'image/jpeg' };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length > 8 && png.every((v, i) => b[i] === v)) return { ext: '.png', tipo: 'image/png' };
  const ascii = (ini, fim) => String.fromCharCode(...b.subarray(ini, fim));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: '.webp', tipo: 'image/webp' };
  return null;
}

async function nomeArquivoFoto(codigo, ext) {
  const slug = codigo.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'material';
  const hash = hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(codigo))).slice(0, 8);
  return `${slug}-${hash}-${Date.now().toString(36)}${ext}`;
}

// ---------------------------------------------------------------------------
// PIN de edição (opcional)
// ---------------------------------------------------------------------------

async function derivarPin(pin, salHex) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const sal = new Uint8Array(salHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES_PIN }, chave, 256));
}

async function hashPin(pin) {
  const sal = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { sal, hash: await derivarPin(String(pin), sal) };
}

async function pinConfere(pin, guardado) {
  if (!guardado || typeof pin !== 'string' || !pin) return false;
  const calculado = await derivarPin(pin, guardado.sal);
  if (calculado.length !== guardado.hash.length) return false;
  let diferenca = 0;
  for (let i = 0; i < calculado.length; i++) diferenca |= calculado.charCodeAt(i) ^ guardado.hash.charCodeAt(i);
  return diferenca === 0;
}

// ---------------------------------------------------------------------------
// Acesso ao banco
// ---------------------------------------------------------------------------

function linhaParaItem(r) {
  return {
    id: r.id,
    codigo: r.codigo,
    referencia: r.referencia,
    bom: r.bom,
    descricao: r.descricao,
    endereco: r.endereco,
    projeto: r.projeto,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}

async function todosItens(db) {
  const { results } = await db.prepare('SELECT * FROM itens ORDER BY ordem, criado_em').all();
  return results.map(linhaParaItem);
}

function linhaParaFoto(f) {
  return { arquivo: f.arquivo, atualizadoEm: f.atualizado_em, origem: f.origem, credito: f.credito || '' };
}

async function mapaFotos(db) {
  const { results } = await db.prepare('SELECT codigo, arquivo, atualizado_em, origem, credito FROM fotos').all();
  return Object.fromEntries(results.map((f) => [f.codigo, linhaParaFoto(f)]));
}

async function fotoDoCodigo(db, codigo) {
  const f = await db.prepare('SELECT codigo, arquivo, atualizado_em, origem, credito FROM fotos WHERE codigo_chave = ?').bind(codigo.toUpperCase()).first();
  return f ? { codigo: f.codigo, foto: linhaParaFoto(f) } : null;
}

async function salvarFoto(db, codigo, bytes, tipo, origem, credito = '') {
  const agora = new Date().toISOString();
  const item = await db.prepare('SELECT codigo FROM itens WHERE upper(codigo) = ? LIMIT 1').bind(codigo.toUpperCase()).first();
  const arquivo = await nomeArquivoFoto(codigo, tipo.ext);
  await db
    .prepare(
      `INSERT INTO fotos (codigo_chave, codigo, arquivo, tipo, dados, atualizado_em, origem, credito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(codigo_chave) DO UPDATE SET codigo = excluded.codigo, arquivo = excluded.arquivo, tipo = excluded.tipo,
         dados = excluded.dados, atualizado_em = excluded.atualizado_em, origem = excluded.origem, credito = excluded.credito`,
    )
    .bind(codigo.toUpperCase(), item?.codigo || codigo, arquivo, tipo.tipo, bytes, agora, origem, credito)
    .run();
  return { arquivo, atualizadoEm: agora, origem, credito };
}

// ---------------------------------------------------------------------------
// Busca de fotos na internet: Google Imagens (pelo serviço Serper.dev, quando a
// chave SERPER_API_KEY está configurada) ou, sem chave, Wikimedia Commons e
// Openverse (imagens livres).
// ---------------------------------------------------------------------------

const MODELO_TRADUCAO = '@cf/meta/m2m100-1.2b';
const AGENTE = 'EtiquetasDeMaterial/1.0 (+https://github.com/T-800009/Etiquetas)';
const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Nos testes, o acesso à internet é trocado por um serviço simulado.
function acessoInternet(env) {
  return env.INTERNET ? (url, init) => env.INTERNET.fetch(url, init) : (url, init) => fetch(url, init);
}

function semHtml(texto) {
  return String(texto || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// As fotos livres na internet estão quase todas descritas em inglês.
async function traduzir(env, texto) {
  if (!env.AI) return texto;
  try {
    const t = await env.AI.run(MODELO_TRADUCAO, { text: texto, source_lang: 'portuguese', target_lang: 'english' });
    return t?.translated_text || texto;
  } catch (err) {
    console.warn('Tradução falhou, buscando com o texto original:', err);
    return texto;
  }
}

// Termos menos específicos para tentar quando a busca exata não acha nada.
function variacoesDaBusca(texto) {
  const palavras = texto.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').split(/\s+/).filter(Boolean);
  const semMedidas = palavras.filter((p) => !/\d/.test(p));
  return [...new Set([palavras.join(' '), semMedidas.join(' '), semMedidas.slice(0, 3).join(' '), semMedidas.slice(0, 2).join(' ')])].filter(Boolean);
}

async function buscarCommons(baixar, termo) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const params = {
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${termo} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '800',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await baixar(url.toString(), { headers: { 'User-Agent': AGENTE } });
  if (!resp.ok) throw new Error(`Commons respondeu ${resp.status}`);
  const dados = await resp.json();
  return Object.values(dados?.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime || '')) return null;
      const meta = info.extmetadata || {};
      const autor = semHtml(meta.Artist?.value);
      const licenca = semHtml(meta.LicenseShortName?.value);
      return {
        url: info.thumburl,
        titulo: semHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
        credito: [autor, 'Wikimedia Commons', licenca].filter(Boolean).join(' · '),
        pagina: info.descriptionurl || '',
      };
    })
    .filter(Boolean);
}

async function buscarOpenverse(baixar, termo) {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', termo);
  url.searchParams.set('page_size', '12');
  url.searchParams.set('mature', 'false');
  const resp = await baixar(url.toString(), { headers: { 'User-Agent': AGENTE } });
  if (!resp.ok) throw new Error(`Openverse respondeu ${resp.status}`);
  const dados = await resp.json();
  return (dados?.results || [])
    .filter((r) => r.thumbnail)
    .map((r) => ({
      url: r.thumbnail,
      titulo: semHtml(r.title),
      credito: [semHtml(r.creator), r.source || 'Openverse', r.license ? `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim() : ''].filter(Boolean).join(' · '),
      pagina: r.foreign_landing_url || '',
    }));
}

async function buscarGoogle(env, termo) {
  const resp = await acessoInternet(env)('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: termo, gl: 'br', hl: 'pt-br', num: 20 }),
  });
  if (resp.status === 401 || resp.status === 403) throw new ErroHttp(502, 'A chave do Google (SERPER_API_KEY) foi recusada. Confira a chave na Cloudflare.');
  if (resp.status === 429 || resp.status === 400) throw new ErroHttp(429, 'Acabaram os créditos de busca no Google (Serper.dev).');
  if (!resp.ok) throw new Error(`Serper respondeu ${resp.status}`);
  const dados = await resp.json();
  return (dados?.images || [])
    .filter((r) => r.imageUrl || r.thumbnailUrl)
    .map((r) => ({
      url: r.imageUrl || r.thumbnailUrl,
      reserva: r.thumbnailUrl || '',
      miniatura: r.thumbnailUrl || r.imageUrl,
      titulo: semHtml(r.title),
      credito: r.domain || r.source || '',
      pagina: r.link || '',
    }));
}

async function buscarImagens(env, descricao, limite = 12) {
  // O Google entende a descrição em português; usado quando há chave.
  if (env.SERPER_API_KEY) {
    try {
      const resultados = (await buscarGoogle(env, descricao)).slice(0, limite);
      if (resultados.length) return { termo: descricao, fonte: 'google', resultados };
    } catch (err) {
      if (err instanceof ErroHttp) throw err;
      console.warn('Busca no Google falhou, usando fontes livres:', err);
    }
  }
  const baixar = acessoInternet(env);
  const termo = await traduzir(env, descricao);
  const vistos = new Set();
  const resultados = [];
  const juntar = (lista) => {
    for (const r of lista) {
      if (vistos.has(r.url) || resultados.length >= limite) continue;
      vistos.add(r.url);
      resultados.push(r);
    }
  };
  for (const variacao of variacoesDaBusca(termo)) {
    const [commons, openverse] = await Promise.allSettled([buscarCommons(baixar, variacao), buscarOpenverse(baixar, variacao)]);
    if (commons.status === 'fulfilled') juntar(commons.value);
    else console.warn(commons.reason);
    if (openverse.status === 'fulfilled') juntar(openverse.value);
    else console.warn(openverse.reason);
    if (resultados.length >= 6) break;
  }
  return { termo, fonte: 'livre', resultados: resultados.map((r) => ({ ...r, miniatura: r.url })) };
}

async function baixarImagem(env, endereco) {
  let url;
  try {
    url = new URL(endereco);
  } catch {
    throw new ErroHttp(400, 'Endereço de imagem inválido.');
  }
  if (url.protocol !== 'https:') throw new ErroHttp(400, 'Só é possível baixar imagens de endereços https.');
  const resp = await acessoInternet(env)(url.toString(), { headers: { 'User-Agent': NAVEGADOR, Accept: 'image/*' } });
  if (!resp.ok) throw new ErroHttp(502, 'Não foi possível baixar esta imagem. Escolha outra.');
  if (Number(resp.headers.get('content-length')) > LIMITE_DOWNLOAD) throw new ErroHttp(413, 'Imagem grande demais. Escolha outra.');
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length > LIMITE_DOWNLOAD) throw new ErroHttp(413, 'Imagem grande demais. Escolha outra.');
  const tipo = tipoImagem(bytes);
  if (!tipo) throw new ErroHttp(415, 'O endereço não é uma imagem JPG, PNG ou WEBP. Escolha outra.');
  return { bytes, tipo };
}

async function lerConfig(db) {
  const { results } = await db.prepare('SELECT chave, valor FROM config').all();
  return Object.fromEntries(results.map((r) => [r.chave, JSON.parse(r.valor)]));
}

function gravarConfig(db, chave, valor) {
  if (valor === undefined) return db.prepare('DELETE FROM config WHERE chave = ?').bind(chave).run();
  return db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').bind(chave, JSON.stringify(valor)).run();
}

// Grava a lista inteira numa única transação. Os itens vão como JSON num só
// parâmetro (em blocos), porque o D1 limita a quantidade de parâmetros por consulta.
function comandosSubstituirItens(db, itens) {
  const comandos = [db.prepare('DELETE FROM itens')];
  const sql = `INSERT INTO itens (id, codigo, referencia, bom, descricao, endereco, projeto, ordem, criado_em, atualizado_em)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.codigo'), json_extract(value, '$.referencia'),
           json_extract(value, '$.bom'), json_extract(value, '$.descricao'), json_extract(value, '$.endereco'),
           json_extract(value, '$.projeto'), json_extract(value, '$.ordem'), json_extract(value, '$.criadoEm'),
           json_extract(value, '$.atualizadoEm')
    FROM json_each(?)`;
  let bloco = [];
  let tamanho = 0;
  itens.forEach((item, ordem) => {
    const texto = JSON.stringify({ ...item, ordem });
    if (bloco.length && tamanho + texto.length > 80000) {
      comandos.push(db.prepare(sql).bind(`[${bloco.join(',')}]`));
      bloco = [];
      tamanho = 0;
    }
    bloco.push(texto);
    tamanho += texto.length + 1;
  });
  if (bloco.length) comandos.push(db.prepare(sql).bind(`[${bloco.join(',')}]`));
  return comandos;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

async function exigirPin(request, db, config) {
  if (!config.pin) return;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const agora = Date.now();
  const registro = await db.prepare('SELECT inicio, falhas FROM tentativas WHERE ip = ?').bind(ip).first();
  const valido = registro && agora - registro.inicio <= JANELA_TENTATIVAS_MS;
  if (valido && registro.falhas >= MAX_TENTATIVAS) throw new ErroHttp(429, 'Muitas tentativas erradas. Aguarde alguns minutos.');
  if (await pinConfere(request.headers.get('x-pin') || '', config.pin)) {
    if (registro) await db.prepare('DELETE FROM tentativas WHERE ip = ?').bind(ip).run();
    return;
  }
  await db
    .prepare('INSERT INTO tentativas (ip, inicio, falhas) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET inicio = excluded.inicio, falhas = excluded.falhas')
    .bind(ip, valido ? registro.inicio : agora, valido ? registro.falhas + 1 : 1)
    .run();
  throw new ErroHttp(401, 'PIN de edição necessário.');
}

function configPublica(config, env) {
  return {
    urlBase: config.urlBase || '',
    temPin: Boolean(config.pin),
    logo: config.logo ? `/logo?v=${encodeURIComponent(config.logo)}` : '/img/logo-padrao.png',
    logoPersonalizado: Boolean(config.logo),
    buscaGoogle: Boolean(env.SERPER_API_KEY),
  };
}

async function rotaApi(request, env, url) {
  const db = env.DB;
  const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  const [, recurso, id, acao] = partes;
  const metodo = request.method;
  const config = await lerConfig(db);
  const agora = new Date().toISOString();

  if (recurso === 'itens' && !id && metodo === 'GET') {
    const [itens, fotos] = await Promise.all([todosItens(db), mapaFotos(db)]);
    return json({ itens, fotos });
  }

  if (recurso === 'itens' && !id && metodo === 'POST') {
    await exigirPin(request, db, config);
    const item = normalizarItem(await lerJson(request));
    if (!item.codigo) throw new ErroHttp(400, 'Informe o código do material.');
    const novo = { id: novoId(), ...item, criadoEm: agora, atualizadoEm: agora };
    await db
      .prepare(
        `INSERT INTO itens (id, codigo, referencia, bom, descricao, endereco, projeto, ordem, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(ordem), 0) + 1 FROM itens), ?, ?)`,
      )
      .bind(novo.id, ...CAMPOS.map((c) => novo[c]), agora, agora)
      .run();
    return json(novo, 201);
  }

  if (recurso === 'itens' && id === 'importar' && metodo === 'POST') {
    await exigirPin(request, db, config);
    const corpo = await lerJson(request);
    if (!Array.isArray(corpo.itens)) throw new ErroHttp(400, 'Lista de itens ausente.');
    const itens = corpo.modo === 'substituir' ? [] : await todosItens(db);
    const porChave = new Map(itens.map((i, idx) => [chaveItem(i), idx]));
    let novos = 0;
    let atualizados = 0;
    let ignorados = 0;
    for (const entrada of corpo.itens) {
      const item = normalizarItem(entrada);
      if (!item.codigo) {
        ignorados += 1;
        continue;
      }
      const chave = chaveItem(item);
      if (porChave.has(chave)) {
        const idx = porChave.get(chave);
        itens[idx] = { ...itens[idx], ...item, atualizadoEm: agora };
        atualizados += 1;
      } else {
        porChave.set(chave, itens.length);
        itens.push({ id: novoId(), ...item, criadoEm: agora, atualizadoEm: agora });
        novos += 1;
      }
    }
    await db.batch(comandosSubstituirItens(db, itens));
    return json({ novos, atualizados, ignorados, total: itens.length });
  }

  if (recurso === 'itens' && id === 'excluir' && metodo === 'POST') {
    await exigirPin(request, db, config);
    const corpo = await lerJson(request);
    const ids = Array.isArray(corpo.ids) ? corpo.ids.map(String) : [];
    const r = await db.prepare('DELETE FROM itens WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run();
    return json({ excluidos: r.meta.changes });
  }

  if (recurso === 'itens' && id && !acao && (metodo === 'PUT' || metodo === 'DELETE')) {
    await exigirPin(request, db, config);
    const atual = await db.prepare('SELECT * FROM itens WHERE id = ?').bind(id).first();
    if (!atual) throw new ErroHttp(404, 'Material não encontrado.');
    if (metodo === 'DELETE') {
      await db.prepare('DELETE FROM itens WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    const item = normalizarItem(await lerJson(request));
    if (!item.codigo) throw new ErroHttp(400, 'Informe o código do material.');
    const comandos = [
      db
        .prepare('UPDATE itens SET codigo = ?, referencia = ?, bom = ?, descricao = ?, endereco = ?, projeto = ?, atualizado_em = ? WHERE id = ?')
        .bind(...CAMPOS.map((c) => item[c]), agora, id),
    ];
    // Se o código foi corrigido, a foto acompanha (quando nenhum outro item usa o código antigo).
    if (atual.codigo.toUpperCase() !== item.codigo.toUpperCase()) {
      const outros = await db.prepare('SELECT count(*) AS n FROM itens WHERE upper(codigo) = ? AND id <> ?').bind(atual.codigo.toUpperCase(), id).first();
      const fotoAntiga = await fotoDoCodigo(db, atual.codigo);
      if (fotoAntiga && !outros.n && !(await fotoDoCodigo(db, item.codigo))) {
        comandos.push(
          db.prepare('UPDATE fotos SET codigo_chave = ?, codigo = ? WHERE codigo_chave = ?').bind(item.codigo.toUpperCase(), item.codigo, atual.codigo.toUpperCase()),
        );
      }
    }
    await db.batch(comandos);
    return json({ ...linhaParaItem(atual), ...item, atualizadoEm: agora });
  }

  if (recurso === 'material' && id && metodo === 'GET') {
    const { results } = await db.prepare('SELECT * FROM itens WHERE upper(codigo) = ? ORDER BY ordem, criado_em').bind(id.toUpperCase()).all();
    const foto = await fotoDoCodigo(db, id);
    if (!results.length && !foto) throw new ErroHttp(404, 'Material não cadastrado.');
    return json({ codigo: results[0]?.codigo || foto.codigo, foto: foto?.foto || null, itens: results.map(linhaParaItem) });
  }

  if (recurso === 'fotos' && id && !acao && metodo === 'PUT') {
    await exigirPin(request, db, config);
    const codigo = limparTexto(id);
    if (!codigo) throw new ErroHttp(400, 'Código inválido.');
    const corpo = await lerCorpo(request, LIMITE_IMAGEM);
    const tipo = tipoImagem(corpo);
    if (!tipo) throw new ErroHttp(415, 'Envie uma imagem JPG, PNG ou WEBP.');
    // Fotos vindas da internet não substituem foto tirada no local, a não ser que o pedido diga.
    const origem = request.headers.get('x-origem') === 'internet' ? 'internet' : 'foto';
    let credito = '';
    if (origem === 'internet') {
      const atual = await fotoDoCodigo(db, codigo);
      if (atual && atual.foto.origem !== 'internet' && request.headers.get('x-substituir') !== '1') throw new ErroHttp(409, 'Este material já tem foto tirada no local.');
      try {
        credito = limparTexto(decodeURIComponent(request.headers.get('x-credito') || ''));
      } catch {
        credito = '';
      }
    }
    return json(await salvarFoto(db, codigo, corpo, tipo, origem, credito));
  }

  // Busca fotos na internet pela descrição (só consulta, não salva nada).
  if (recurso === 'imagens' && id === 'buscar' && metodo === 'GET') {
    const descricao = limparTexto(url.searchParams.get('q'));
    if (!descricao) throw new ErroHttp(400, 'Informe o que buscar.');
    return json(await buscarImagens(env, descricao));
  }

  // Baixa uma imagem encontrada na busca (o navegador não pode baixar direto de
  // outros sites) para o navegador remover o fundo e salvar.
  if (recurso === 'imagens' && id === 'baixar' && metodo === 'GET') {
    await exigirPin(request, db, config);
    const imagem = await baixarImagem(env, url.searchParams.get('url') || '');
    return new Response(imagem.bytes, { headers: { 'Content-Type': imagem.tipo.tipo, 'Cache-Control': 'no-store' } });
  }

  if (recurso === 'fotos' && id && !acao && metodo === 'DELETE') {
    await exigirPin(request, db, config);
    await db.prepare('DELETE FROM fotos WHERE codigo_chave = ?').bind(id.toUpperCase()).run();
    return json({ ok: true });
  }

  if (recurso === 'config' && !id && metodo === 'GET') return json(configPublica(config, env));

  if (recurso === 'config' && !id && metodo === 'PUT') {
    await exigirPin(request, db, config);
    const corpo = await lerJson(request);
    if (typeof corpo.urlBase === 'string') {
      const urlBase = corpo.urlBase.trim().replace(/\/+$/, '');
      if (urlBase && !/^https?:\/\/[^\s/]+/i.test(urlBase)) throw new ErroHttp(400, 'O endereço precisa começar com http:// ou https://');
      config.urlBase = urlBase;
      await gravarConfig(db, 'urlBase', urlBase);
    }
    return json(configPublica(config, env));
  }

  if (recurso === 'config' && id === 'pin' && metodo === 'PUT') {
    await exigirPin(request, db, config);
    const corpo = await lerJson(request);
    const novo = typeof corpo.novo === 'string' ? corpo.novo.trim() : '';
    if (novo && novo.length < 4) throw new ErroHttp(400, 'O PIN precisa ter pelo menos 4 caracteres.');
    config.pin = novo ? await hashPin(novo) : undefined;
    await gravarConfig(db, 'pin', config.pin);
    return json(configPublica(config, env));
  }

  if (recurso === 'pin' && id === 'verificar' && metodo === 'POST') {
    await exigirPin(request, db, config);
    return json({ ok: true });
  }

  if (recurso === 'logo' && !id && metodo === 'PUT') {
    await exigirPin(request, db, config);
    const corpo = await lerCorpo(request, LIMITE_IMAGEM);
    const tipo = tipoImagem(corpo);
    if (!tipo) throw new ErroHttp(415, 'Envie uma imagem JPG, PNG ou WEBP.');
    const nome = `logo-${Date.now().toString(36)}${tipo.ext}`;
    const comandos = [db.prepare('INSERT INTO arquivos (nome, tipo, dados) VALUES (?, ?, ?)').bind(nome, tipo.tipo, corpo)];
    if (config.logo) comandos.push(db.prepare('DELETE FROM arquivos WHERE nome = ?').bind(config.logo));
    comandos.push(db.prepare("INSERT INTO config (chave, valor) VALUES ('logo', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(JSON.stringify(nome)));
    await db.batch(comandos);
    config.logo = nome;
    return json(configPublica(config, env));
  }

  if (recurso === 'logo' && !id && metodo === 'DELETE') {
    await exigirPin(request, db, config);
    if (config.logo) {
      await db.batch([db.prepare('DELETE FROM arquivos WHERE nome = ?').bind(config.logo), db.prepare("DELETE FROM config WHERE chave = 'logo'")]);
      delete config.logo;
    }
    return json(configPublica(config, env));
  }

  if (recurso === 'backup' && !id && metodo === 'GET') {
    const [itens, fotos] = await Promise.all([todosItens(db), mapaFotos(db)]);
    return json({ versao: 1, exportadoEm: agora, itens, fotos }, 200, {
      'Content-Disposition': `attachment; filename="etiquetas-backup-${agora.slice(0, 10)}.json"`,
    });
  }

  throw new ErroHttp(404, 'Rota não encontrada.');
}

async function servirBlob(linha, cache) {
  if (!linha) return null;
  return new Response(new Uint8Array(linha.dados), { headers: { 'Content-Type': linha.tipo, 'Cache-Control': cache } });
}

async function tratar(request, env) {
  const url = new URL(request.url);
  try {
    await garantirEsquema(env.DB);
    if (url.pathname.startsWith('/api/')) return await rotaApi(request, env, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');

    // Página aberta pelo QR code: /m/<código>
    if (url.pathname.startsWith('/m/')) {
      const pagina = await env.ASSETS.fetch(new Request(new URL('/material', url)));
      return new Response(pagina.body, { status: pagina.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (url.pathname.startsWith('/fotos/')) {
      const nome = decodeURIComponent(url.pathname.slice('/fotos/'.length));
      const foto = await env.DB.prepare('SELECT tipo, dados FROM fotos WHERE arquivo = ?').bind(nome).first();
      return (await servirBlob(foto, 'public, max-age=31536000, immutable')) || new Response('Foto não encontrada.', { status: 404 });
    }
    if (url.pathname === '/logo') {
      const config = await lerConfig(env.DB);
      const logo = config.logo && (await env.DB.prepare('SELECT tipo, dados FROM arquivos WHERE nome = ?').bind(config.logo).first());
      return (await servirBlob(logo, 'public, max-age=86400')) || env.ASSETS.fetch(new Request(new URL('/img/logo-padrao.png', url)));
    }
    return env.ASSETS.fetch(request);
  } catch (err) {
    const status = err instanceof ErroHttp ? err.status : err instanceof URIError ? 400 : 500;
    if (status === 500) console.error(err);
    const mensagem = status === 500 ? 'Erro interno no servidor.' : err.message;
    if (url.pathname.startsWith('/api/')) return json({ erro: mensagem }, status);
    return new Response(mensagem, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

export default {
  async fetch(request, env) {
    const resposta = await tratar(request, env);
    const headers = new Headers(resposta.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers });
  },
};
