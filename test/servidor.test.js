'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let processo;
let base;
let dadosDir;

// Menor JPEG válido o bastante para passar na checagem de tipo.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

async function chamar(metodo, rota, { json, corpo, tipo, pin } = {}) {
  const headers = {};
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (tipo) headers['Content-Type'] = tipo;
  if (pin) headers['X-Pin'] = pin;
  const resp = await fetch(base + rota, { method: metodo, headers, body: json !== undefined ? JSON.stringify(json) : corpo });
  const texto = await resp.text();
  let dados = texto;
  try {
    dados = JSON.parse(texto);
  } catch {
    /* resposta não é JSON */
  }
  return { status: resp.status, dados, headers: resp.headers };
}

// Sobe o Worker localmente (wrangler dev) com um banco D1 temporário.
function iniciarWorker() {
  const porta = 8800 + Math.floor(Math.random() * 1000);
  processo = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--port', String(porta), '--ip', '127.0.0.1', '--persist-to', dadosDir, '--show-interactive-dev-session=false'],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  base = `http://127.0.0.1:${porta}`;
  return new Promise((ok, falha) => {
    let saida = '';
    const tempo = setTimeout(() => falha(new Error('wrangler dev não iniciou:\n' + saida)), 60000);
    const ler = (b) => {
      saida += b;
      if (/Ready on/.test(saida)) {
        clearTimeout(tempo);
        ok();
      }
    };
    processo.stdout.on('data', ler);
    processo.stderr.on('data', ler);
    processo.on('exit', (c) => falha(new Error(`wrangler saiu (${c}):\n${saida}`)));
  });
}

before(async () => {
  dadosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'etiquetas-teste-'));
  await iniciarWorker();
});

after(async () => {
  processo.removeAllListeners('exit');
  processo.kill();
  await new Promise((ok) => processo.once('exit', ok));
  await fs.rm(dadosDir, { recursive: true, force: true });
});

test('cadastra, edita e lista materiais', async () => {
  const criado = await chamar('POST', '/api/itens', {
    json: { codigo: ' 13020085-00 ', descricao: 'Porca hexagonal de metal com trava', endereco: '01.A.C2', projeto: 'BC22LE', extra: 'ignorado' },
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.codigo, '13020085-00');
  assert.equal(criado.dados.extra, undefined);

  const editado = await chamar('PUT', `/api/itens/${criado.dados.id}`, { json: { ...criado.dados, bom: 'BOM-1339 e BOM-1268' } });
  assert.equal(editado.status, 200);
  assert.equal(editado.dados.bom, 'BOM-1339 e BOM-1268');

  const lista = await chamar('GET', '/api/itens');
  assert.equal(lista.dados.itens.length, 1);

  const semCodigo = await chamar('POST', '/api/itens', { json: { descricao: 'sem código' } });
  assert.equal(semCodigo.status, 400);
});

test('importação adiciona, atualiza pela chave código+endereço+projeto e ignora linhas sem código', async () => {
  const r = await chamar('POST', '/api/itens/importar', {
    json: {
      modo: 'adicionar',
      itens: [
        { codigo: '13020085-00', descricao: 'Porca atualizada', endereco: '01.A.C2', projeto: 'BC22LE' },
        { codigo: '11701773-00', descricao: 'Suporte de aterramento', endereco: '05.A.C4', projeto: 'BC22LE' },
        { codigo: '11701773-00', descricao: 'Suporte de aterramento', endereco: '07.B.A1', projeto: 'BC22LE' },
        { codigo: '', descricao: 'linha vazia' },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual({ novos: r.dados.novos, atualizados: r.dados.atualizados, ignorados: r.dados.ignorados }, { novos: 2, atualizados: 1, ignorados: 1 });

  const material = await chamar('GET', '/api/material/11701773-00');
  assert.equal(material.status, 200);
  assert.equal(material.dados.itens.length, 2, 'mesmo material em dois endereços');
});

test('foto é ligada ao código e aparece na página do material', async () => {
  const invalida = await chamar('PUT', '/api/fotos/13020085-00', { corpo: Buffer.from('<svg></svg>'), tipo: 'image/svg+xml' });
  assert.equal(invalida.status, 415);

  const enviada = await chamar('PUT', '/api/fotos/13020085-00', { corpo: JPEG, tipo: 'image/jpeg' });
  assert.equal(enviada.status, 200);
  assert.match(enviada.dados.arquivo, /^13020085-00-[0-9a-f]{8}-\w+\.jpg$/);

  const material = await chamar('GET', '/api/material/13020085-00');
  assert.equal(material.dados.foto.arquivo, enviada.dados.arquivo);

  const arquivo = await fetch(`${base}/fotos/${enviada.dados.arquivo}`);
  assert.equal(arquivo.status, 200);
  assert.equal(arquivo.headers.get('content-type'), 'image/jpeg');

  // Trocar a foto substitui a antiga.
  const nova = await chamar('PUT', '/api/fotos/13020085-00', { corpo: JPEG, tipo: 'image/jpeg' });
  assert.notEqual(nova.dados.arquivo, enviada.dados.arquivo);
  assert.equal((await fetch(`${base}/fotos/${enviada.dados.arquivo}`)).status, 404);
  assert.equal((await fetch(`${base}/fotos/${nova.dados.arquivo}`)).status, 200);
});

test('página do QR code é servida para qualquer código', async () => {
  const pagina = await fetch(`${base}/m/13020085-00`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /material\.js/);

  const inexistente = await chamar('GET', '/api/material/NAO-EXISTE');
  assert.equal(inexistente.status, 404);
});

test('PIN protege alterações mas não a consulta', async () => {
  const definido = await chamar('PUT', '/api/config/pin', { json: { novo: '4321' } });
  assert.equal(definido.status, 200);
  assert.equal(definido.dados.temPin, true);

  assert.equal((await chamar('POST', '/api/itens', { json: { codigo: 'X1' } })).status, 401);
  assert.equal((await chamar('POST', '/api/itens', { json: { codigo: 'X1' }, pin: '0000' })).status, 401);
  assert.equal((await chamar('POST', '/api/itens', { json: { codigo: 'X1' }, pin: '4321' })).status, 201);
  assert.equal((await chamar('GET', '/api/itens')).status, 200);
  assert.equal((await chamar('GET', '/api/material/13020085-00')).status, 200);

  const removido = await chamar('PUT', '/api/config/pin', { json: { novo: '' }, pin: '4321' });
  assert.equal(removido.dados.temPin, false);
});

test('endereço do QR code é validado e salvo', async () => {
  assert.equal((await chamar('PUT', '/api/config', { json: { urlBase: 'javascript:alert(1)' } })).status, 400);
  const ok = await chamar('PUT', '/api/config', { json: { urlBase: 'http://192.168.0.10:3000/' } });
  assert.equal(ok.dados.urlBase, 'http://192.168.0.10:3000');
});

test('substituir cadastro mantém as fotos', async () => {
  const r = await chamar('POST', '/api/itens/importar', { json: { modo: 'substituir', itens: [{ codigo: '13020085-00', endereco: '09.Z.Z9' }] } });
  assert.equal(r.dados.total, 1);
  const material = await chamar('GET', '/api/material/13020085-00');
  assert.ok(material.dados.foto, 'foto continua ligada ao código');
  assert.equal(material.dados.itens[0].endereco, '09.Z.Z9');
});

test('importação grande vai em blocos numa transação só', async () => {
  const itens = Array.from({ length: 1500 }, (_, i) => ({ codigo: `${20000000 + i}-00`, descricao: 'Parafuso sextavado flangeado M8x20 '.repeat(3), endereco: `0${i % 9}.A.C${i % 6}` }));
  const r = await chamar('POST', '/api/itens/importar', { json: { modo: 'adicionar', itens } });
  assert.equal(r.status, 200);
  assert.equal(r.dados.total, 1501);
  const lista = await chamar('GET', '/api/itens');
  assert.equal(lista.dados.itens.length, 1501);
  assert.equal(lista.dados.itens[1].codigo, '20000000-00', 'mantém a ordem da planilha');
});

test('telas e página do QR code são servidas', async () => {
  const inicio = await fetch(`${base}/`);
  assert.equal(inicio.status, 200);
  assert.match(await inicio.text(), /app\.js/);
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /svg/);
});
