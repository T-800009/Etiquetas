// Leitura das planilhas "posto a posto" e comparação entre dois projetos (ex.: BC22 × BC12).
// Só funções puras (sem tela): usadas pela aba Posto a posto (postos.js) e pelos testes.
'use strict';

const PostoAPosto = (() => {
  const SEM_POSTO = '';

  // ---- Textos -------------------------------------------------------------------

  function normalizar(texto) {
    return String(texto ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Células de erro do Excel (#N/A do PROCV etc.) contam como vazias.
  const VAZIOS = /^(#n\/a|#n\/d|#ref!|#valor!|#value!|#nome\?|#name\?|#div\/0!|n\/a|-+|—)$/i;
  function valor(v) {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    return VAZIOS.test(t) ? '' : t;
  }

  // Chave para comparar códigos: sem espaços e sem diferença de maiúsculas.
  function chaveTexto(t) {
    return String(t ?? '').toUpperCase().replace(/\s+/g, '');
  }

  // ---- Postos -------------------------------------------------------------------

  const MEIO = /^(½|1\/2|0[.,]5|meio|medio|intermediario)$/;

  // "Posto 2", "P2", "posto ½", "Posto meio", "02" -> '2' / '½'. Devolve null se não for posto.
  // Com exigirPrefixo, só aceita textos que começam com "posto"/"p" (cabeçalhos e nomes de aba).
  function lerPosto(texto, { exigirPrefixo = false } = {}) {
    const t = normalizar(texto).replace(/[º°ª]/g, '');
    const m = /^(?:(posto|pt|p|estacao|station)\s*[.:#-]?\s*)?(.+)$/.exec(t);
    if (!m || (exigirPrefixo && !m[1])) return null;
    const resto = m[2].trim();
    if (MEIO.test(resto)) return '½';
    if (/^\d{1,2}$/.test(resto)) return String(Number(resto));
    return null;
  }

  // Endereço da etiqueta: "02.A.C2", "0½.RACK.A1", "00.PALLET.01" -> posto do começo.
  function postoDoEndereco(endereco) {
    const m = /^\s*(0?½|\d{1,2})\s*[.\-_ ]/.exec(String(endereco ?? ''));
    if (!m) return null;
    return m[1].includes('½') ? '½' : String(Number(m[1]));
  }

  // Aba "P05" é o posto ½ quando a planilha também tem a aba "P5".
  function postoDaAba(nome, todosOsNomes = []) {
    const posto = lerPosto(nome, { exigirPrefixo: true });
    if (posto === '5' && /^p\s*0\s*5$/.test(normalizar(nome))) {
      const temP5 = todosOsNomes.some((outro) => outro !== nome && /^p\s*5$/.test(normalizar(outro)));
      if (temP5) return '½';
    }
    return posto;
  }

  function ordemPosto(posto) {
    if (posto === SEM_POSTO) return 1000;
    if (posto === '½') return 0.5;
    const n = Number(posto);
    return Number.isFinite(n) ? n : 999;
  }

  function compararPostos(a, b) {
    return ordemPosto(a) - ordemPosto(b) || String(a).localeCompare(String(b));
  }

  function rotuloPosto(posto) {
    return posto === SEM_POSTO ? 'Sem posto' : `Posto ${posto}`;
  }

  // ['1', '2', '5'] -> "Postos 1, 2 e 5"
  function textoPostos(postos) {
    const lista = [...postos].sort(compararPostos).map((p) => (p === SEM_POSTO ? 'sem posto' : p));
    if (!lista.length) return '';
    if (lista.length === 1) return postos[0] === SEM_POSTO ? 'Sem posto' : `Posto ${lista[0]}`;
    return `Postos ${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
  }

  // ---- Colunas da planilha --------------------------------------------------------

  const CABECALHOS = [
    ['sap', /\bsap\b|codigo sap|^material$|^codigo( do material)?$|^cod\.?( material)?$|numero do material/],
    ['pn', /part ?(number|no\b)|\bp\/n\b|^pn$|referencia|desenho|drawing/],
    ['descricao', /descri|denomina|part ?name|^nome|texto breve/],
    ['qtde', /^(qtde?|qtd|quant(idade)?|quantity|qty|total)\b/],
    ['unidade', /^(und|un|unid(ade)?|unit|um)\b/],
    ['endereco', /ender|localiza|^local$|posicao|prateleira|location|\bbin\b/],
    ['posto', /^(posto|estacao|station|assembly station)$/],
  ];
  const PARECE_SAP = /^\d{6,10}(-\d{1,3})?$/;

  function colunasDoCabecalho(linha) {
    const colunas = { postos: [] };
    (linha || []).forEach((celula, col) => {
      const texto = normalizar(celula);
      if (!texto) return;
      const posto = lerPosto(texto, { exigirPrefixo: true });
      if (posto !== null) {
        if (!colunas.postos.some((p) => p.posto === posto)) colunas.postos.push({ col, posto });
        return;
      }
      for (const [campo, regex] of CABECALHOS) {
        if (!(campo in colunas) && regex.test(texto)) {
          colunas[campo] = col;
          return;
        }
      }
    });
    return colunas;
  }

  function pontuarCabecalho(colunas) {
    const campos = ['sap', 'pn', 'descricao', 'qtde', 'unidade', 'endereco', 'posto'].filter((c) => c in colunas).length;
    if (!('sap' in colunas) && !('pn' in colunas)) return 0;
    return campos + (colunas.postos.length ? 2 : 0);
  }

  // Procura a linha de títulos nas primeiras linhas (algumas planilhas têm título antes).
  function acharCabecalho(linhas) {
    let melhor = null;
    linhas.slice(0, 20).forEach((linha, i) => {
      const colunas = colunasDoCabecalho(linha);
      const nota = pontuarCabecalho(colunas);
      if (nota >= 2 && (!melhor || nota > melhor.nota)) melhor = { linha: i, colunas, nota };
    });
    return melhor;
  }

  // Confere pelo conteúdo se a coluna "SAP" tem mesmo códigos SAP (e não um número de item 1, 2, 3...).
  function fracao(dados, col, teste) {
    const valores = dados.map((l) => valor(l[col])).filter(Boolean);
    if (!valores.length) return 0;
    return valores.filter(teste).length / valores.length;
  }

  function ajustarColunas(colunas, dados) {
    if ('sap' in colunas && fracao(dados, colunas.sap, (v) => PARECE_SAP.test(v)) < 0.5) delete colunas.sap;
    if (!('sap' in colunas)) {
      // Sem título reconhecido: a coluna com mais códigos no formato 12345678-00.
      let melhor = -1;
      let nota = 0.5;
      const largura = Math.max(0, ...dados.map((l) => l.length));
      for (let col = 0; col < largura; col++) {
        if (col === colunas.pn || colunas.postos.some((p) => p.col === col)) continue;
        const n = fracao(dados, col, (v) => /^\d{8}-\d{2}$/.test(v));
        if (n > nota) {
          melhor = col;
          nota = n;
        }
      }
      if (melhor >= 0) colunas.sap = melhor;
    }
    return colunas;
  }

  // ---- Leitura das abas -------------------------------------------------------------

  function novaEntrada(linha, colunas, posto, qtde) {
    const pegar = (campo) => (campo in colunas ? valor(linha[colunas[campo]]) : '');
    return {
      posto,
      codigo: pegar('sap'),
      partNumber: pegar('pn'),
      descricao: pegar('descricao'),
      qtde: qtde ?? pegar('qtde'),
      // A BOM da China repete a unidade na célula ("PCS PCS").
      unidade: pegar('unidade').split(' ')[0],
    };
  }

  function identidade(e) {
    return e.codigo ? `S:${chaveTexto(e.codigo)}` : `P:${chaveTexto(e.partNumber)}`;
  }

  // Junta repetições do mesmo material no mesmo posto (linha duplicada na planilha).
  function juntarRepetidas(entradas) {
    const porChave = new Map();
    const saida = [];
    for (const e of entradas) {
      const chave = `${e.posto}|${identidade(e)}`;
      const atual = porChave.get(chave);
      if (!atual) {
        porChave.set(chave, e);
        saida.push(e);
        continue;
      }
      if (atual.qtde === e.qtde) continue;
      const a = Number(String(atual.qtde).replace(',', '.'));
      const b = Number(String(e.qtde).replace(',', '.'));
      if (atual.qtde !== '' && e.qtde !== '' && Number.isFinite(a) && Number.isFinite(b)) atual.qtde = String(a + b);
      else if (!atual.qtde) atual.qtde = e.qtde;
      for (const campo of ['codigo', 'partNumber', 'descricao', 'unidade']) if (!atual[campo]) atual[campo] = e[campo];
    }
    return saida;
  }

  function qtdeInformada(v) {
    const t = valor(v);
    return t !== '' && t !== '0';
  }

  // Lê uma aba já em linhas de texto. Devolve null quando a aba não tem lista de materiais.
  function lerAba(aba, todosOsNomes) {
    const cabecalho = acharCabecalho(aba.linhas);
    if (!cabecalho) return null;
    const dados = aba.linhas.slice(cabecalho.linha + 1);
    const colunas = ajustarColunas(cabecalho.colunas, dados);
    if (!('sap' in colunas) && !('pn' in colunas)) return null;
    const linhasValidas = dados.filter((l) => {
      const codigo = 'sap' in colunas ? valor(l[colunas.sap]) : '';
      const pn = 'pn' in colunas ? valor(l[colunas.pn]) : '';
      if (!codigo && !pn) return false;
      // Linha de títulos repetida no meio da lista.
      return pontuarCabecalho(colunasDoCabecalho(l)) < 3;
    });

    const entradas = [];
    let tipo;
    let detalhe = '';
    if (colunas.postos.length >= 2) {
      tipo = 'matriz';
      colunas.postos.sort((a, b) => compararPostos(a.posto, b.posto));
      for (const linha of linhasValidas) {
        for (const { col, posto } of colunas.postos) {
          if (qtdeInformada(linha[col])) entradas.push(novaEntrada(linha, colunas, posto, valor(linha[col])));
        }
      }
      const postos = colunas.postos.map((p) => p.posto);
      detalhe = `colunas ${rotuloPosto(postos[0])} a ${rotuloPosto(postos[postos.length - 1])}`;
    } else if (colunas.postos.length === 1 || postoDaAba(aba.nome, todosOsNomes) !== null) {
      tipo = 'aba-posto';
      const doCabecalho = colunas.postos[0];
      const posto = doCabecalho ? doCabecalho.posto : postoDaAba(aba.nome, todosOsNomes);
      for (const linha of linhasValidas) {
        if (doCabecalho) {
          if (qtdeInformada(linha[doCabecalho.col])) entradas.push(novaEntrada(linha, colunas, posto, valor(linha[doCabecalho.col])));
        } else entradas.push(novaEntrada(linha, colunas, posto));
      }
      detalhe = rotuloPosto(posto);
    } else {
      // Lista com uma coluna "Posto" ou com o endereço da etiqueta (02.A.C2).
      let lerDaLinha = null;
      if ('posto' in colunas && fracao(linhasValidas, colunas.posto, (v) => lerPosto(v) !== null) >= 0.5) {
        lerDaLinha = (l) => lerPosto(l[colunas.posto]);
        detalhe = 'posto pela coluna Posto';
      } else if ('endereco' in colunas && fracao(linhasValidas, colunas.endereco, (v) => postoDoEndereco(v) !== null) >= 0.5) {
        lerDaLinha = (l) => postoDoEndereco(l[colunas.endereco]);
        detalhe = 'posto pelo endereço';
      }
      tipo = lerDaLinha ? 'lista' : 'sem-posto';
      if (!lerDaLinha) detalhe = 'sem posto (só a lista de materiais)';
      for (const linha of linhasValidas) entradas.push(novaEntrada(linha, colunas, lerDaLinha ? lerDaLinha(linha) ?? SEM_POSTO : SEM_POSTO));
    }
    return { tipo, nome: aba.nome, detalhe, entradas: juntarRepetidas(entradas) };
  }

  function resumirOpcao(opcao) {
    const materiais = new Set(opcao.entradas.map(identidade));
    const postos = [...new Set(opcao.entradas.map((e) => e.posto))].sort(compararPostos);
    return { ...opcao, materiais: materiais.size, postos };
  }

  // Analisa todas as abas e devolve as formas possíveis de ler a planilha, da melhor para a pior.
  // planilhas = [{ nome, linhas: [[texto, ...], ...] }]
  function analisar(planilhas) {
    const nomes = planilhas.map((p) => p.nome);
    const lidas = planilhas.map((aba) => lerAba(aba, nomes)).filter((l) => l && l.entradas.length);
    const opcoes = [];
    for (const l of lidas.filter((x) => x.tipo === 'matriz')) {
      opcoes.push({ id: `aba:${l.nome}`, tipo: 'matriz', titulo: `Aba “${l.nome}” — ${l.detalhe}`, entradas: l.entradas });
    }
    const porPosto = lidas.filter((x) => x.tipo === 'aba-posto');
    if (porPosto.length) {
      const entradas = juntarRepetidas(porPosto.flatMap((l) => l.entradas));
      const nomesAbas = porPosto.map((l) => l.nome);
      const lista = nomesAbas.length > 4 ? `${nomesAbas.slice(0, 3).join(', ')} … ${nomesAbas[nomesAbas.length - 1]}` : nomesAbas.join(', ');
      opcoes.push({
        id: 'abas-por-posto',
        tipo: 'abas-por-posto',
        titulo: porPosto.length > 1 ? `${porPosto.length} abas, uma por posto (${lista})` : `Aba “${nomesAbas[0]}” — ${porPosto[0].detalhe}`,
        entradas,
      });
    }
    for (const l of lidas.filter((x) => x.tipo === 'lista')) {
      opcoes.push({ id: `aba:${l.nome}`, tipo: 'lista', titulo: `Aba “${l.nome}” — ${l.detalhe}`, entradas: l.entradas });
    }
    for (const l of lidas.filter((x) => x.tipo === 'sem-posto').sort((a, b) => b.entradas.length - a.entradas.length)) {
      opcoes.push({ id: `aba:${l.nome}`, tipo: 'sem-posto', titulo: `Aba “${l.nome}” — ${l.detalhe}`, entradas: l.entradas });
    }
    // Entre as do mesmo tipo, a que tem mais posições vem primeiro.
    const peso = { matriz: 0, 'abas-por-posto': 1, lista: 2, 'sem-posto': 3 };
    opcoes.sort((a, b) => peso[a.tipo] - peso[b.tipo] || b.entradas.length - a.entradas.length);
    return opcoes.map((o, ordem) => resumirOpcao({ ...o, entradas: o.entradas.map((e, i) => ({ ...e, ordem: i })), ordem }));
  }

  // Nome do projeto pelo arquivo ("..._BC22_...") ou pelos desenhos mais comuns (BC12S01-...).
  function detectarProjeto(planilhas, nomeArquivo = '') {
    const doArquivo = /(?:^|[^A-Z0-9])(BC\d{2}|D9W)(?=[^0-9]|$)/i.exec(nomeArquivo);
    if (doArquivo) return doArquivo[1].toUpperCase();
    const contagem = new Map();
    for (const aba of planilhas) {
      for (const linha of aba.linhas.slice(0, 1500)) {
        for (const celula of linha) {
          const m = /\b(BC\d{2})S\d{2}/i.exec(String(celula));
          if (m) contagem.set(m[1].toUpperCase(), (contagem.get(m[1].toUpperCase()) || 0) + 1);
        }
      }
    }
    const [melhor] = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    return melhor ? melhor[0] : '';
  }

  // ---- Comparação --------------------------------------------------------------------

  // Dois registros são o mesmo material quando têm o mesmo código SAP ou o mesmo Part Number.
  function criarUniao() {
    const pai = new Map();
    function raiz(x) {
      if (!pai.has(x)) pai.set(x, x);
      let r = x;
      while (pai.get(r) !== r) r = pai.get(r);
      while (pai.get(x) !== r) {
        const proximo = pai.get(x);
        pai.set(x, r);
        x = proximo;
      }
      return r;
    }
    return {
      raiz,
      unir(a, b) {
        const ra = raiz(a);
        const rb = raiz(b);
        if (ra !== rb) pai.set(rb, ra);
      },
    };
  }

  function chavesDe(e) {
    const chaves = [];
    if (e.codigo) chaves.push(`S:${chaveTexto(e.codigo)}`);
    if (e.partNumber) chaves.push(`P:${chaveTexto(e.partNumber)}`);
    return chaves;
  }

  function numero(qtde) {
    const n = Number(String(qtde ?? '').replace(',', '.'));
    return String(qtde ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
  }

  function somarEm(atual, e) {
    const a = numero(atual.qtde);
    const b = numero(e.qtde);
    return { ...atual, qtde: a !== null && b !== null ? String(a + b) : atual.qtde || e.qtde };
  }

  const ORDEM_SITUACAO = { 'nao-comum': 0, 'comum-outro': 1, comum: 2, 'so-base': 3 };

  // novo = lista do projeto que vai entrar (ex.: BC22); base = lista com que se compara (ex.: BC12).
  function comparar(novo, base) {
    const uniao = criarUniao();
    for (const e of [...novo, ...base]) {
      const chaves = chavesDe(e);
      for (let i = 1; i < chaves.length; i++) uniao.unir(chaves[0], chaves[i]);
    }

    const materiais = new Map();
    for (const [lado, lista] of [['a', novo], ['b', base]]) {
      for (const e of lista) {
        const chaves = chavesDe(e);
        if (!chaves.length) continue;
        const id = uniao.raiz(chaves[0]);
        let m = materiais.get(id);
        if (!m) materiais.set(id, (m = { id, a: new Map(), b: new Map() }));
        const atual = m[lado].get(e.posto);
        m[lado].set(e.posto, atual ? somarEm(atual, e) : e);
      }
    }

    const linhas = [];
    const lista = [];
    for (const m of materiais.values()) {
      const entradasA = [...m.a.values()];
      const entradasB = [...m.b.values()];
      const todas = [...entradasA, ...entradasB];
      const primeiro = (campo) => todas.find((e) => e[campo])?.[campo] || '';
      // Descrição em português quando um dos lados vem da BOM em chinês.
      const descricao = todas.find((e) => e.descricao && !/[㐀-鿿]/.test(e.descricao))?.descricao || primeiro('descricao');
      const postosA = [...m.a.keys()].filter((p) => p !== SEM_POSTO).sort(compararPostos);
      const postosB = [...m.b.keys()].filter((p) => p !== SEM_POSTO).sort(compararPostos);
      const material = {
        id: m.id,
        codigo: primeiro('codigo'),
        partNumber: primeiro('partNumber'),
        descricao,
        unidade: primeiro('unidade'),
        emA: m.a.size > 0,
        emB: m.b.size > 0,
        postosA,
        postosB,
        semPostoA: m.a.has(SEM_POSTO),
        semPostoB: m.b.has(SEM_POSTO),
        ordem: Math.min(...entradasA.map((e) => e.ordem ?? 0), ...entradasB.map((e) => 100000 + (e.ordem ?? 0))),
      };
      material.situacao = material.emA && material.emB ? 'comum' : material.emA ? 'nao-comum' : 'so-base';
      lista.push(material);

      // Uma lista sem posto (só a BOM, por exemplo) usa os postos do outro projeto.
      const semA = m.a.get(SEM_POSTO) || null;
      const semB = m.b.get(SEM_POSTO) || null;
      const inferirA = Boolean(semA) && !postosA.length && postosB.length > 0;
      const inferirB = Boolean(semB) && !postosB.length && postosA.length > 0;
      const situacaoDe = (a, b) => (a && b ? 'comum' : a ? (material.emB ? 'comum-outro' : 'nao-comum') : 'so-base');
      const nova = (posto, a, b, inferido) => {
        const qa = numero(a?.qtde);
        const qb = numero(b?.qtde);
        linhas.push({
          posto,
          situacao: situacaoDe(a, b),
          material,
          a,
          b,
          inferido,
          qtdDiferente: Boolean(a && b && !inferido && qa !== null && qb !== null && qa !== qb),
        });
      };
      for (const posto of [...new Set([...postosA, ...postosB])].sort(compararPostos)) {
        let a = m.a.get(posto) || null;
        let b = m.b.get(posto) || null;
        let inferido = null;
        if (!a && inferirA && b) {
          a = semA;
          inferido = 'a';
        }
        if (!b && inferirB && a) {
          b = semB;
          inferido = 'b';
        }
        nova(posto, a, b, inferido);
      }
      const restaA = inferirA ? null : semA;
      const restaB = inferirB ? null : semB;
      if (restaA || restaB) nova(SEM_POSTO, restaA, restaB, null);
    }

    linhas.sort(
      (x, y) =>
        compararPostos(x.posto, y.posto) ||
        ORDEM_SITUACAO[x.situacao] - ORDEM_SITUACAO[y.situacao] ||
        x.material.ordem - y.material.ordem,
    );

    const postos = new Map();
    for (const l of linhas) {
      let p = postos.get(l.posto);
      if (!p) postos.set(l.posto, (p = { posto: l.posto, comum: 0, 'comum-outro': 0, 'nao-comum': 0, 'so-base': 0, novo: 0 }));
      p[l.situacao] += 1;
      if (l.a) p.novo += 1;
    }

    const resumo = {
      materiaisNovo: lista.filter((m) => m.emA).length,
      materiaisBase: lista.filter((m) => m.emB).length,
      comuns: lista.filter((m) => m.situacao === 'comum').length,
      naoComuns: lista.filter((m) => m.situacao === 'nao-comum').length,
      soBase: lista.filter((m) => m.situacao === 'so-base').length,
      postoDiferente: linhas.filter((l) => l.situacao === 'comum-outro').length,
    };
    return { linhas, materiais: lista, postos: [...postos.values()].sort((a, b) => compararPostos(a.posto, b.posto)), resumo };
  }

  // Acha o material pelo código bipado/digitado (código SAP com ou sem o "-00", ou Part Number).
  function acharMaterial(materiais, texto) {
    const alvo = chaveTexto(texto);
    if (!alvo) return [];
    const exatos = materiais.filter((m) => chaveTexto(m.codigo) === alvo || chaveTexto(m.partNumber) === alvo);
    if (exatos.length) return exatos;
    if (/^\d{6,10}$/.test(alvo)) return materiais.filter((m) => chaveTexto(m.codigo).replace(/-\d{1,3}$/, '') === alvo);
    return [];
  }

  return {
    SEM_POSTO,
    normalizar,
    valor,
    lerPosto,
    postoDoEndereco,
    postoDaAba,
    compararPostos,
    rotuloPosto,
    textoPostos,
    analisar,
    detectarProjeto,
    comparar,
    acharMaterial,
    numero,
  };
})();

if (typeof module !== 'undefined') module.exports = PostoAPosto;
