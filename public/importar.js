// Leitura de planilhas: texto colado do Excel, arquivos .csv e arquivos .xlsx.
// O .xlsx é lido direto no navegador, sem bibliotecas externas.
'use strict';

const Importar = (() => {
  const CAMPOS = [
    { id: 'codigo', nome: 'Código do material', obrigatorio: true },
    { id: 'descricao', nome: 'Descrição' },
    { id: 'referencia', nome: 'Referência / especificação' },
    { id: 'bom', nome: 'BOM' },
    { id: 'endereco', nome: 'Endereço / posição' },
    { id: 'projeto', nome: 'Projeto / linha' },
  ];

  // ---- Texto (colado do Excel ou CSV) ------------------------------------------

  function detectarSeparador(texto) {
    const amostra = texto.split(/\r?\n/).slice(0, 10).join('\n');
    const contagem = (ch) => amostra.split(ch).length - 1;
    const opcoes = [['\t', contagem('\t')], [';', contagem(';')], [',', contagem(',')]];
    opcoes.sort((a, b) => b[1] - a[1]);
    return opcoes[0][1] > 0 ? opcoes[0][0] : '\t';
  }

  function lerTexto(texto, separador = detectarSeparador(texto)) {
    const linhas = [];
    let linha = [];
    let campo = '';
    let aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (aspas) {
        if (ch === '"' && texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else if (ch === '"') aspas = false;
        else campo += ch;
      } else if (ch === '"' && campo === '') aspas = true;
      else if (ch === separador) {
        linha.push(campo);
        campo = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo);
        linhas.push(linha);
        linha = [];
        campo = '';
      } else campo += ch;
    }
    if (campo !== '' || linha.length) {
      linha.push(campo);
      linhas.push(linha);
    }
    return limparLinhas(linhas);
  }

  function limparLinhas(linhas) {
    const uteis = linhas
      .map((l) => l.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()))
      .filter((l) => l.some((v) => v !== ''));
    const largura = Math.max(0, ...uteis.map((l) => l.length));
    return uteis.map((l) => (l.length < largura ? l.concat(Array(largura - l.length).fill('')) : l));
  }

  // ---- XLSX ---------------------------------------------------------------------

  async function descompactar(dados, metodo) {
    if (metodo === 0) return dados;
    if (metodo !== 8) throw new Error('Compressão do arquivo não suportada.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Navegador antigo: atualize o navegador ou cole os dados do Excel.');
    const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  async function lerZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let fim = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        fim = i;
        break;
      }
    }
    if (fim < 0) throw new Error('Este arquivo não parece ser um .xlsx válido.');
    const total = dv.getUint16(fim + 10, true);
    let pos = dv.getUint32(fim + 16, true);
    const arquivos = new Map();
    const decodificador = new TextDecoder();
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) break;
      const metodo = dv.getUint16(pos + 10, true);
      const tamanho = dv.getUint32(pos + 20, true);
      const tamNome = dv.getUint16(pos + 28, true);
      const tamExtra = dv.getUint16(pos + 30, true);
      const tamComentario = dv.getUint16(pos + 32, true);
      const local = dv.getUint32(pos + 42, true);
      const nome = decodificador.decode(bytes.subarray(pos + 46, pos + 46 + tamNome));
      const inicio = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      arquivos.set(nome.replace(/^\/+/, ''), { metodo, dados: bytes.subarray(inicio, inicio + tamanho) });
      pos += 46 + tamNome + tamExtra + tamComentario;
    }
    return {
      async texto(nome) {
        const a = arquivos.get(nome);
        if (!a) return null;
        return decodificador.decode(await descompactar(a.dados, a.metodo));
      },
    };
  }

  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xml(texto) {
    return new DOMParser().parseFromString(texto, 'application/xml');
  }

  function tags(no, nome) {
    return Array.from(no.getElementsByTagNameNS('*', nome));
  }

  function indiceColuna(ref) {
    const letras = /^[A-Z]+/i.exec(ref || '');
    if (!letras) return -1;
    let n = 0;
    for (const ch of letras[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function formatarNumero(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    return String(parseFloat(n.toPrecision(15)));
  }

  async function lerXlsx(buffer) {
    const zip = await lerZip(buffer);
    const livro = await zip.texto('xl/workbook.xml');
    if (!livro) throw new Error('Este arquivo não parece ser um .xlsx válido.');
    const rels = xml((await zip.texto('xl/_rels/workbook.xml.rels')) || '<r/>');
    const alvos = new Map(tags(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

    const compartilhados = [];
    const textoSS = await zip.texto('xl/sharedStrings.xml');
    if (textoSS) {
      for (const si of tags(xml(textoSS), 'si')) {
        // Ignora o texto fonético (rPh) que o Excel guarda junto em alguns idiomas.
        compartilhados.push(tags(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent).join(''));
      }
    }

    const planilhas = [];
    for (const folha of tags(xml(livro), 'sheet')) {
      const alvo = alvos.get(folha.getAttributeNS(NS_REL, 'id') || folha.getAttribute('r:id'));
      if (!alvo) continue;
      const caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
      planilhas.push({ nome: folha.getAttribute('name'), caminho });
    }

    async function linhasDa(planilha) {
      const texto = await zip.texto(planilha.caminho);
      if (!texto) return [];
      const linhas = [];
      for (const row of tags(xml(texto), 'row')) {
        const indiceLinha = Number(row.getAttribute('r')) - 1;
        const linha = [];
        let proxima = 0;
        for (const c of tags(row, 'c')) {
          const col = c.getAttribute('r') ? indiceColuna(c.getAttribute('r')) : proxima;
          proxima = col + 1;
          const tipo = c.getAttribute('t');
          const v = tags(c, 'v')[0]?.textContent ?? '';
          let valor;
          if (tipo === 's') valor = compartilhados[Number(v)] ?? '';
          else if (tipo === 'inlineStr') valor = tags(c, 't').map((t) => t.textContent).join('');
          else if (tipo === 'str' || tipo === 'e') valor = tipo === 'e' ? '' : v;
          else if (tipo === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO';
          else valor = v === '' ? '' : formatarNumero(v);
          linha[col] = valor;
        }
        linhas[Number.isFinite(indiceLinha) && indiceLinha >= 0 ? indiceLinha : linhas.length] = linha;
      }
      return limparLinhas(Array.from(linhas, (l) => Array.from(l || [], (v) => v ?? '')));
    }

    return { planilhas, linhasDa };
  }

  // ---- Mapeamento automático das colunas -----------------------------------------

  function normalizar(texto) {
    return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  const PELO_CABECALHO = [
    ['referencia', /refer|especif|fornecedor|fabricante|spec|desenho|drawing/],
    ['descricao', /descri|denomina|nome|description/],
    ['bom', /\bbom\b/],
    ['endereco', /ender|locali|local\b|posic|prateleira|\brua\b|\bbin\b|location/],
    ['projeto', /projeto|linha|\barea\b|setor|modelo|veiculo|project|posto/],
    ['codigo', /codigo|^cod\b|part ?(n|number)|^pn$|material|\bitem\b/],
  ];

  // A ordem importa: as colunas mais fáceis de reconhecer são escolhidas primeiro.
  const PELO_CONTEUDO = {
    codigo: (v) => /^\d{6,}(-\d{1,3})?$/.test(v),
    endereco: (v) => /^\d{1,3}\.[A-Z]{1,3}\.[A-Z0-9]{1,4}$/i.test(v),
    bom: (v) => /\bBOM\b/i.test(v),
    projeto: (v) => /^[A-Z]{2}\d{2}[A-Z]{1,3}$/i.test(v),
    referencia: (v) => /^[A-Z0-9][A-Z0-9.\-/]{5,}$/i.test(v) && /[A-Z]/i.test(v) && /\d/.test(v),
  };

  function sugerirMapeamento(linhas, temCabecalho) {
    const mapa = {};
    const usadas = new Set();
    const largura = linhas[0]?.length || 0;
    if (temCabecalho && linhas.length) {
      const cab = linhas[0].map(normalizar);
      for (const [campo, regex] of PELO_CABECALHO) {
        const col = cab.findIndex((t, i) => t && !usadas.has(i) && regex.test(t));
        if (col >= 0) {
          mapa[campo] = col;
          usadas.add(col);
        }
      }
    }
    const dados = linhas.slice(temCabecalho ? 1 : 0, 200);
    for (const [campo, teste] of Object.entries(PELO_CONTEUDO)) {
      if (campo in mapa) continue;
      let melhor = -1;
      let melhorNota = 0.5;
      for (let col = 0; col < largura; col++) {
        if (usadas.has(col)) continue;
        const valores = dados.map((l) => l[col]).filter(Boolean);
        if (!valores.length) continue;
        const nota = valores.filter(teste).length / valores.length;
        if (nota > melhorNota) {
          melhor = col;
          melhorNota = nota;
        }
      }
      if (melhor >= 0) {
        mapa[campo] = melhor;
        usadas.add(melhor);
      }
    }
    if (!('descricao' in mapa)) {
      // A descrição costuma ser a coluna com o texto mais longo.
      let melhor = -1;
      let maior = 8;
      for (let col = 0; col < largura; col++) {
        if (usadas.has(col)) continue;
        const valores = dados.map((l) => l[col]).filter(Boolean);
        const media = valores.reduce((s, v) => s + v.length, 0) / (valores.length || 1);
        if (media > maior && valores.some((v) => /\s/.test(v))) {
          melhor = col;
          maior = media;
        }
      }
      if (melhor >= 0) mapa.descricao = melhor;
    }
    return mapa;
  }

  function aplicarMapeamento(linhas, mapa, temCabecalho) {
    return linhas.slice(temCabecalho ? 1 : 0).map((l) => {
      const item = {};
      for (const { id } of CAMPOS) item[id] = mapa[id] >= 0 ? l[mapa[id]] ?? '' : '';
      return item;
    });
  }

  function pareceCabecalho(linha) {
    if (!linha) return false;
    const texto = linha.map(normalizar).join(' ');
    return PELO_CABECALHO.some(([, r]) => r.test(texto)) && !linha.some((v) => PELO_CONTEUDO.codigo(v));
  }

  function nomeColuna(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  // ---- Exportação CSV (abre direto no Excel em português) --------------------------

  function gerarCsv(itens) {
    const cab = CAMPOS.map((c) => c.nome);
    const linhas = [cab, ...itens.map((i) => CAMPOS.map((c) => i[c.id] ?? ''))];
    const corpo = linhas.map((l) => l.map((v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(';')).join('\r\n');
    return new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' });
  }

  return { CAMPOS, lerTexto, lerXlsx, sugerirMapeamento, aplicarMapeamento, pareceCabecalho, nomeColuna, gerarCsv };
})();
