#!/usr/bin/env node
// Servidor do site de etiquetas de material.
// Não usa nenhuma dependência externa: basta ter o Node.js (18 ou mais novo)
// instalado e rodar `node server.js`.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const LIMITE_JSON = 20 * 1024 * 1024; // importações grandes de planilha
const LIMITE_IMAGEM = 15 * 1024 * 1024;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const CAMPOS = ['codigo', 'referencia', 'bom', 'descricao', 'endereco', 'projeto'];

// ---------------------------------------------------------------------------
// Banco de dados em arquivo JSON
// ---------------------------------------------------------------------------

class Banco {
  constructor(dir) {
    this.dir = dir;
    this.arquivo = path.join(dir, 'banco.json');
    this.fotosDir = path.join(dir, 'fotos');
    this.dados = { itens: [], fotos: {}, config: {} };
    this.fila = Promise.resolve();
  }

  async abrir() {
    await fsp.mkdir(this.fotosDir, { recursive: true });
    try {
      const texto = await fsp.readFile(this.arquivo, 'utf8');
      const lido = JSON.parse(texto);
      this.dados = {
        itens: Array.isArray(lido.itens) ? lido.itens : [],
        fotos: lido.fotos && typeof lido.fotos === 'object' ? lido.fotos : {},
        config: lido.config && typeof lido.config === 'object' ? lido.config : {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.salvar();
    }
  }

  // Grava em arquivo temporário e renomeia, para nunca deixar o banco pela metade.
  salvar() {
    const conteudo = JSON.stringify(this.dados, null, 1);
    this.fila = this.fila.then(async () => {
      const tmp = this.arquivo + '.tmp';
      await fsp.writeFile(tmp, conteudo);
      await fsp.rename(tmp, this.arquivo);
    });
    return this.fila;
  }
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
  return crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// PIN de edição (opcional)
// ---------------------------------------------------------------------------

function hashPin(pin, sal = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), sal, 32).toString('hex');
  return { sal, hash };
}

function pinConfere(pin, guardado) {
  if (!guardado || typeof pin !== 'string' || !pin) return false;
  const calculado = Buffer.from(hashPin(pin, guardado.sal).hash, 'hex');
  const esperado = Buffer.from(guardado.hash, 'hex');
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

// Limita tentativas erradas de PIN por IP para evitar adivinhação.
class LimiteTentativas {
  constructor(max = 10, janelaMs = 10 * 60 * 1000) {
    this.max = max;
    this.janelaMs = janelaMs;
    this.mapa = new Map();
  }
  bloqueado(ip) {
    const r = this.mapa.get(ip);
    if (!r) return false;
    if (Date.now() - r.inicio > this.janelaMs) {
      this.mapa.delete(ip);
      return false;
    }
    return r.falhas >= this.max;
  }
  falhou(ip) {
    const r = this.mapa.get(ip);
    if (!r || Date.now() - r.inicio > this.janelaMs) this.mapa.set(ip, { inicio: Date.now(), falhas: 1 });
    else r.falhas += 1;
  }
  acertou(ip) {
    this.mapa.delete(ip);
  }
}

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function enviarJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (parte) => {
      total += parte.length;
      if (total > limite) {
        reject(new ErroHttp(413, 'Arquivo grande demais.'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function lerJson(req) {
  const corpo = await lerCorpo(req, LIMITE_JSON);
  if (!corpo.length) return {};
  try {
    return JSON.parse(corpo.toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

function tipoImagem(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function nomeArquivoFoto(codigo, ext) {
  const slug = codigo.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'material';
  const hash = crypto.createHash('sha1').update(codigo).digest('hex').slice(0, 8);
  return `${slug}-${hash}-${Date.now().toString(36)}${ext}`;
}

async function servirArquivo(req, res, arquivo, cache) {
  let info;
  try {
    info = await fsp.stat(arquivo);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': info.size,
    'Cache-Control': cache,
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(arquivo).pipe(res);
  return true;
}

function enderecosRede(porta) {
  const lista = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces || []) {
      if (i.family === 'IPv4' && !i.internal) lista.push(`http://${i.address}:${porta}`);
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

async function criarServidor({ dadosDir = path.join(__dirname, 'dados') } = {}) {
  const banco = new Banco(dadosDir);
  await banco.abrir();
  const limite = new LimiteTentativas();
  let portaAtual = 0;

  function exigirPin(req) {
    const guardado = banco.dados.config.pin;
    if (!guardado) return;
    const ip = req.socket.remoteAddress || '';
    if (limite.bloqueado(ip)) throw new ErroHttp(429, 'Muitas tentativas erradas. Aguarde alguns minutos.');
    const pin = req.headers['x-pin'];
    if (!pinConfere(typeof pin === 'string' ? pin : '', guardado)) {
      limite.falhou(ip);
      throw new ErroHttp(401, 'PIN de edição necessário.');
    }
    limite.acertou(ip);
  }

  function configPublica() {
    const c = banco.dados.config;
    return {
      urlBase: c.urlBase || '',
      temPin: Boolean(c.pin),
      logo: c.logo ? `/logo?v=${encodeURIComponent(c.logo)}` : '/img/logo-padrao.svg',
      logoPersonalizado: Boolean(c.logo),
      sugestoesUrl: enderecosRede(portaAtual),
    };
  }

  function material(codigo) {
    const alvo = codigo.toUpperCase();
    const itens = banco.dados.itens.filter((i) => i.codigo.toUpperCase() === alvo);
    const fotoCodigo = Object.keys(banco.dados.fotos).find((c) => c.toUpperCase() === alvo);
    return { itens, foto: fotoCodigo ? banco.dados.fotos[fotoCodigo] : null, fotoCodigo };
  }

  async function removerArquivo(nome) {
    if (!nome) return;
    await fsp.rm(path.join(banco.fotosDir, path.basename(nome)), { force: true });
  }

  async function rotaApi(req, res, url) {
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
    const [, recurso, id, acao] = partes;
    const metodo = req.method;

    if (recurso === 'itens' && !id && metodo === 'GET') {
      return enviarJson(res, 200, { itens: banco.dados.itens, fotos: banco.dados.fotos });
    }

    if (recurso === 'itens' && !id && metodo === 'POST') {
      exigirPin(req);
      const item = normalizarItem(await lerJson(req));
      if (!item.codigo) throw new ErroHttp(400, 'Informe o código do material.');
      const agora = new Date().toISOString();
      const novo = { id: novoId(), ...item, criadoEm: agora, atualizadoEm: agora };
      banco.dados.itens.push(novo);
      await banco.salvar();
      return enviarJson(res, 201, novo);
    }

    if (recurso === 'itens' && id === 'importar' && metodo === 'POST') {
      exigirPin(req);
      const corpo = await lerJson(req);
      if (!Array.isArray(corpo.itens)) throw new ErroHttp(400, 'Lista de itens ausente.');
      const substituir = corpo.modo === 'substituir';
      const itens = substituir ? [] : banco.dados.itens.slice();
      const porChave = new Map(itens.map((i, idx) => [chaveItem(i), idx]));
      const agora = new Date().toISOString();
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
      banco.dados.itens = itens;
      await banco.salvar();
      return enviarJson(res, 200, { novos, atualizados, ignorados, total: itens.length });
    }

    if (recurso === 'itens' && id === 'excluir' && metodo === 'POST') {
      exigirPin(req);
      const corpo = await lerJson(req);
      const ids = new Set(Array.isArray(corpo.ids) ? corpo.ids : []);
      const antes = banco.dados.itens.length;
      banco.dados.itens = banco.dados.itens.filter((i) => !ids.has(i.id));
      await banco.salvar();
      return enviarJson(res, 200, { excluidos: antes - banco.dados.itens.length });
    }

    if (recurso === 'itens' && id && !acao && (metodo === 'PUT' || metodo === 'DELETE')) {
      exigirPin(req);
      const idx = banco.dados.itens.findIndex((i) => i.id === id);
      if (idx < 0) throw new ErroHttp(404, 'Material não encontrado.');
      if (metodo === 'DELETE') {
        banco.dados.itens.splice(idx, 1);
        await banco.salvar();
        return enviarJson(res, 200, { ok: true });
      }
      const item = normalizarItem(await lerJson(req));
      if (!item.codigo) throw new ErroHttp(400, 'Informe o código do material.');
      const codigoAntigo = banco.dados.itens[idx].codigo;
      banco.dados.itens[idx] = { ...banco.dados.itens[idx], ...item, atualizadoEm: new Date().toISOString() };
      // Se o código foi corrigido, a foto acompanha (quando nenhum outro item usa o código antigo).
      if (codigoAntigo.toUpperCase() !== item.codigo.toUpperCase()) {
        const antigo = material(codigoAntigo);
        if (antigo.foto && !antigo.itens.length && !material(item.codigo).foto) {
          banco.dados.fotos[item.codigo] = antigo.foto;
          delete banco.dados.fotos[antigo.fotoCodigo];
        }
      }
      await banco.salvar();
      return enviarJson(res, 200, banco.dados.itens[idx]);
    }

    if (recurso === 'material' && id && metodo === 'GET') {
      const m = material(id);
      if (!m.itens.length && !m.foto) throw new ErroHttp(404, 'Material não cadastrado.');
      return enviarJson(res, 200, { codigo: m.itens[0]?.codigo || m.fotoCodigo, foto: m.foto, itens: m.itens });
    }

    if (recurso === 'fotos' && id && metodo === 'PUT') {
      exigirPin(req);
      const codigo = limparTexto(id);
      if (!codigo) throw new ErroHttp(400, 'Código inválido.');
      const corpo = await lerCorpo(req, LIMITE_IMAGEM);
      const ext = tipoImagem(corpo);
      if (!ext) throw new ErroHttp(415, 'Envie uma imagem JPG, PNG ou WEBP.');
      const atual = material(codigo);
      const arquivo = nomeArquivoFoto(codigo, ext);
      await fsp.writeFile(path.join(banco.fotosDir, arquivo), corpo);
      if (atual.fotoCodigo) {
        await removerArquivo(atual.foto.arquivo);
        delete banco.dados.fotos[atual.fotoCodigo];
      }
      const foto = { arquivo, atualizadoEm: new Date().toISOString() };
      banco.dados.fotos[atual.itens[0]?.codigo || codigo] = foto;
      await banco.salvar();
      return enviarJson(res, 200, foto);
    }

    if (recurso === 'fotos' && id && metodo === 'DELETE') {
      exigirPin(req);
      const atual = material(id);
      if (atual.fotoCodigo) {
        await removerArquivo(atual.foto.arquivo);
        delete banco.dados.fotos[atual.fotoCodigo];
        await banco.salvar();
      }
      return enviarJson(res, 200, { ok: true });
    }

    if (recurso === 'config' && !id && metodo === 'GET') {
      return enviarJson(res, 200, configPublica());
    }

    if (recurso === 'config' && !id && metodo === 'PUT') {
      exigirPin(req);
      const corpo = await lerJson(req);
      if (typeof corpo.urlBase === 'string') {
        const url = corpo.urlBase.trim().replace(/\/+$/, '');
        if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new ErroHttp(400, 'O endereço precisa começar com http:// ou https://');
        banco.dados.config.urlBase = url;
      }
      await banco.salvar();
      return enviarJson(res, 200, configPublica());
    }

    if (recurso === 'config' && id === 'pin' && metodo === 'PUT') {
      exigirPin(req);
      const corpo = await lerJson(req);
      const novo = typeof corpo.novo === 'string' ? corpo.novo.trim() : '';
      if (novo && novo.length < 4) throw new ErroHttp(400, 'O PIN precisa ter pelo menos 4 caracteres.');
      if (novo) banco.dados.config.pin = hashPin(novo);
      else delete banco.dados.config.pin;
      await banco.salvar();
      return enviarJson(res, 200, configPublica());
    }

    if (recurso === 'pin' && id === 'verificar' && metodo === 'POST') {
      exigirPin(req);
      return enviarJson(res, 200, { ok: true });
    }

    if (recurso === 'logo' && !id && metodo === 'PUT') {
      exigirPin(req);
      const corpo = await lerCorpo(req, LIMITE_IMAGEM);
      const ext = tipoImagem(corpo);
      if (!ext) throw new ErroHttp(415, 'Envie uma imagem JPG, PNG ou WEBP.');
      const arquivo = `logo-${Date.now().toString(36)}${ext}`;
      await fsp.writeFile(path.join(dadosDir, arquivo), corpo);
      if (banco.dados.config.logo) await fsp.rm(path.join(dadosDir, path.basename(banco.dados.config.logo)), { force: true });
      banco.dados.config.logo = arquivo;
      await banco.salvar();
      return enviarJson(res, 200, configPublica());
    }

    if (recurso === 'logo' && !id && metodo === 'DELETE') {
      exigirPin(req);
      if (banco.dados.config.logo) {
        await fsp.rm(path.join(dadosDir, path.basename(banco.dados.config.logo)), { force: true });
        delete banco.dados.config.logo;
        await banco.salvar();
      }
      return enviarJson(res, 200, configPublica());
    }

    if (recurso === 'backup' && !id && metodo === 'GET') {
      const { itens, fotos } = banco.dados;
      res.setHeader('Content-Disposition', `attachment; filename="etiquetas-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      return enviarJson(res, 200, { versao: 1, exportadoEm: new Date().toISOString(), itens, fotos });
    }

    throw new ErroHttp(404, 'Rota não encontrada.');
  }

  async function tratar(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await rotaApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');

      // Página aberta pelo QR code: /m/<código>
      if (url.pathname.startsWith('/m/')) {
        return void (await servirArquivo(req, res, path.join(PUBLIC_DIR, 'material.html'), 'no-cache'));
      }
      if (url.pathname.startsWith('/fotos/')) {
        const nome = path.basename(decodeURIComponent(url.pathname.slice('/fotos/'.length)));
        if (await servirArquivo(req, res, path.join(banco.fotosDir, nome), 'public, max-age=31536000, immutable')) return;
        throw new ErroHttp(404, 'Foto não encontrada.');
      }
      if (url.pathname === '/logo') {
        const logo = banco.dados.config.logo;
        if (logo && (await servirArquivo(req, res, path.join(dadosDir, path.basename(logo)), 'public, max-age=86400'))) return;
        return void (await servirArquivo(req, res, path.join(PUBLIC_DIR, 'img', 'logo-padrao.svg'), 'no-cache'));
      }

      let relativo = decodeURIComponent(url.pathname);
      if (relativo.endsWith('/')) relativo += 'index.html';
      const arquivo = path.join(PUBLIC_DIR, path.normalize(relativo));
      if (!arquivo.startsWith(PUBLIC_DIR + path.sep)) throw new ErroHttp(403, 'Acesso negado.');
      if (await servirArquivo(req, res, arquivo, 'no-cache')) return;
      throw new ErroHttp(404, 'Página não encontrada.');
    } catch (err) {
      const status = err instanceof ErroHttp ? err.status : err instanceof URIError ? 400 : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return void res.end();
      if (url.pathname.startsWith('/api/')) return enviarJson(res, status, { erro: status === 500 ? 'Erro interno no servidor.' : err.message });
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 500 ? 'Erro interno no servidor.' : err.message);
    }
  }

  const servidor = http.createServer((req, res) => {
    tratar(req, res);
  });
  servidor.on('listening', () => {
    portaAtual = servidor.address().port;
  });
  servidor.banco = banco;
  return servidor;
}

module.exports = { criarServidor };

if (require.main === module) {
  const porta = Number(process.env.PORT) || 3000;
  const dadosDir = process.env.DADOS_DIR ? path.resolve(process.env.DADOS_DIR) : undefined;
  criarServidor({ dadosDir }).then((servidor) => {
    servidor.listen(porta, () => {
      console.log('');
      console.log('  Etiquetas de Material rodando!');
      console.log('');
      console.log(`  Neste computador:  http://localhost:${porta}`);
      for (const url of enderecosRede(porta)) console.log(`  Na rede (celular): ${url}`);
      console.log('');
      console.log('  Para parar, feche esta janela ou aperte Ctrl+C.');
    });
  });
}
