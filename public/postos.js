// Aba "Posto a posto": compara duas planilhas, organizadas por posto.
'use strict';

const Postos = (() => {
  const { api, esc, lerLocal, gravarLocal, aviso } = Comum;
  const P = PostoAPosto;
  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

  const estado = {
    carregado: false,
    carregando: null,
    listas: [],
    novo: lerLocal('etiquetas.postos.novo', ''),
    base: lerLocal('etiquetas.postos.base', ''),
    posto: null, // null = todos os postos
    ordem: lerLocal('etiquetas.postos.ordem', 'planilha'),
    falar: Boolean(lerLocal('etiquetas.postos.falar', false)),
    resultado: null,
    itensCadastro: () => [],
    listasMudaram: () => {},
  };

  const comparador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

  function painelVisivel() {
    return !$('#aba-postos').hidden;
  }

  function listaDe(projeto) {
    return estado.listas.find((l) => l.projeto === projeto) || null;
  }

  function nomes() { return { novo: estado.novo || 'principal', base: estado.base || 'comparação' }; }

  // ---- Dados -------------------------------------------------------------------

  async function carregar() {
    estado.carregando ??= api('GET', '/api/postos')
      .then((dados) => {
        estado.listas = dados.listas;
        estado.listasMudaram(estado.listas);
        estado.carregado = true;
        escolherProjetos();
        recalcular();
      })
      .finally(() => {
        estado.carregando = null;
      });
    await estado.carregando;
    render();
  }

  // Padrão: BC22 comparado com BC12; senão, as duas primeiras listas.
  function escolherProjetos() {
    const projetos = estado.listas.map((l) => l.projeto);
    const achar = (regex) => projetos.find((p) => regex.test(p)) || '';
    if (!projetos.includes(estado.novo)) estado.novo = achar(/BC\s*22/i) || projetos[0] || '';
    if (!projetos.includes(estado.base) || estado.base === estado.novo) {
      estado.base = (achar(/BC\s*12/i) !== estado.novo && achar(/BC\s*12/i)) || projetos.find((p) => p !== estado.novo) || '';
    }
    if (!['planilha', 'codigo', 'descricao'].includes(estado.ordem)) estado.ordem = 'planilha';
    gravarLocal('etiquetas.postos.novo', estado.novo);
    gravarLocal('etiquetas.postos.base', estado.base);
    gravarLocal('etiquetas.postos.ordem', estado.ordem);
  }

  function recalcular() {
    const novo = listaDe(estado.novo);
    const base = listaDe(estado.base);
    estado.resultado = novo && base && novo !== base ? P.comparar(numerar(novo.itens), numerar(base.itens)) : null;
    if (estado.posto !== null && !estado.resultado?.postos.some((p) => p.posto === estado.posto)) estado.posto = null;
  }

  function numerar(itens) {
    return itens.map((i, ordem) => ({ ...i, ordem }));
  }

  // Endereços das etiquetas cadastradas (aba Materiais), pelo código SAP ou pela referência.
  function mapaEnderecos() {
    const mapa = new Map();
    const juntar = (chave, endereco) => {
      if (!chave || !endereco) return;
      const k = chave.toUpperCase().replace(/\s+/g, '');
      if (!mapa.has(k)) mapa.set(k, new Set());
      mapa.get(k).add(endereco);
    };
    for (const i of estado.itensCadastro()) {
      if (/\d/.test(i.codigo)) juntar(i.codigo, i.endereco);
      juntar(i.referencia, i.endereco);
    }
    return mapa;
  }

  function enderecosDe(material, mapa) {
    const lista = new Set();
    for (const chave of [material.codigo, material.partNumber]) {
      for (const e of mapa.get(String(chave || '').toUpperCase().replace(/\s+/g, '')) || []) lista.add(e);
    }
    return [...lista].sort(comparador.compare);
  }

  function termosDaBusca() {
    return P.normalizar($('#pp-busca').value).split(' ').filter(Boolean);
  }

  function passaBusca(l, termos) {
    if (!termos.length) return true;
    const m = l.material;
    const texto = P.normalizar(`${m.codigo} ${m.partNumber} ${m.descricao} ${l.a?.descricao || ''} ${l.b?.descricao || ''}`);
    return termos.every((t) => texto.includes(t));
  }

  function linhasDoPosto() {
    const termos = termosDaBusca();
    return (estado.resultado?.linhas || []).filter((l) => (estado.posto === null || l.posto === estado.posto) && passaBusca(l, termos));
  }

  function ordenar(linhas) {
    const chaves = {
      codigo: (a, b) => comparador.compare(a.material.codigo || a.material.partNumber, b.material.codigo || b.material.partNumber),
      descricao: (a, b) => comparador.compare(a.material.descricao || '￿', b.material.descricao || '￿'),
      planilha: (a, b) => a.material.ordem - b.material.ordem,
    };
    const porChave = chaves[estado.ordem] || chaves.planilha;
    return linhas.slice().sort((a, b) => P.compararPostos(a.posto, b.posto) || porChave(a, b) || a.material.ordem - b.material.ordem);
  }

  // ---- Tela -------------------------------------------------------------------------

  function render() {
    if (!estado.carregado) return;
    renderSeletores();
    renderLateral();
    renderControles();
    renderTabelas();
    renderVeredito();
  }

  function renderSeletores() {
    const opcoes = (atual, vazio) =>
      (atual ? '' : `<option value="">${esc(vazio)}</option>`) + estado.listas.map((l) => `<option${l.projeto === atual ? ' selected' : ''}>${esc(l.projeto)}</option>`).join('');
    $('#pp-novo').innerHTML = opcoes(estado.novo, 'Importe uma planilha');
    $('#pp-base').innerHTML = opcoes(estado.base, estado.listas.length ? 'Escolha outro modelo' : '—');
    $('#pp-inverter').disabled = !(estado.novo && estado.base);
    $('#pp-planilhas').textContent = estado.listas.length ? `Planilhas importadas (${estado.listas.length})` : 'Planilhas importadas';
  }

  function porcentagem(parte, total) {
    return total ? Math.round((parte / total) * 100) : 0;
  }

  function medidor(parte, total, rotulo) {
    const p = porcentagem(parte, total);
    return `<span class="pp-medidor" role="img" aria-label="${esc(rotulo)}"><span style="width:${p}%"></span></span>`;
  }

  function renderLateral() {
    const r = estado.resultado;
    const n = nomes();
    if (!r) {
      $('#pp-geral').innerHTML = '';
      $('#pp-postos').innerHTML = '';
      return;
    }
    const s = r.resumo;
    const p = porcentagem(s.comuns, s.materiaisNovo);
    const semLocalizacao = [n.novo, n.base].filter((projeto) => {
      const lista = listaDe(projeto);
      return lista?.itens.length && !lista.itens.some((i) => i.endereco);
    });
    $('#pp-geral').innerHTML = `
      <div class="pp-geral-numero"><strong>${p}%</strong> <span>em comum entre ${esc(n.novo)} e ${esc(n.base)}</span></div>
      ${medidor(s.comuns, s.materiaisNovo, `${p}% em comum`)}
      <div class="pp-geral-texto"><span><i class="ponto ponto-comum"></i>${s.comuns} comuns</span><span><i class="ponto ponto-nao"></i>${s.naoComuns} só no ${esc(n.novo)}</span><span><i class="ponto ponto-base"></i>${s.soBase} só no ${esc(n.base)}</span></div>
      <div class="pp-geral-dica">Verde: comum. Vermelho: não é comum. A comparação considera SAP ou Part Number.</div>
      ${semLocalizacao.length ? `<div class="pp-aviso-local">Reimporte ${esc(semLocalizacao.join(' e '))} para carregar as localizações próprias dessas planilhas.</div>` : ''}`;

    const linhaPosto = (posto, c, titulo) => {
      const ativo = estado.posto === posto;
      const comuns = c.comum + c['comum-outro'];
      const diferentes = c['nao-comum'] + c['so-base'];
      return `<li><button type="button" class="pp-posto${ativo ? ' ativo' : ''}" data-posto="${posto === null ? '*' : esc(posto)}" aria-pressed="${ativo}">
        <span class="pp-posto-nome">${esc(titulo)}</span>
        <span class="pp-posto-total">${comuns + diferentes}</span>
        ${medidor(comuns, comuns + diferentes, `${comuns} comuns`)}
        <span class="pp-posto-info">${comuns} comuns · ${diferentes} diferentes</span>
      </button></li>`;
    };
    const total = r.postos.reduce(
      (soma, c) => {
        for (const k of Object.keys(soma)) soma[k] += c[k];
        return soma;
      },
      { comum: 0, 'comum-outro': 0, 'nao-comum': 0, 'so-base': 0, novo: 0 },
    );
    $('#pp-postos').innerHTML =
      `<li class="pp-postos-titulo" aria-hidden="true">Comparação por posto</li>` +
      linhaPosto(null, total, 'Todos os postos') +
      r.postos.map((c) => linhaPosto(c.posto, c, P.rotuloPosto(c.posto))).join('');
  }

  function renderControles() {
    const vazio = !estado.resultado;
    for (const id of ['#pp-exportar', '#pp-imprimir']) $(id).disabled = vazio;
    $('.pp-ordem').hidden = vazio;
    $('#pp-ordem').value = estado.ordem;
  }

  function celulaQtde(entrada) {
    if (!entrada) return '<td class="pp-qtd vazio-cel">—</td>';
    return `<td class="pp-qtd">${esc(entrada.qtde || '—')}</td>`;
  }

  function celulaEndereco(entrada) {
    return entrada?.endereco ? `<td class="pp-end"><span class="tag">${esc(entrada.endereco)}</span></td>` : '<td class="pp-end vazio-cel">—</td>';
  }

  function enderecosDoResultado(material, lado) {
    return [...new Set((estado.resultado?.linhas || []).filter((l) => l.material === material && l[lado]?.endereco).map((l) => l[lado].endereco))].sort(comparador.compare);
  }

  function renderTabelas() {
    const vazio = $('#pp-vazio');
    const alvo = $('#pp-tabelas');
    const n = nomes();
    if (!estado.resultado) {
      alvo.innerHTML = '';
      vazio.hidden = false;
      vazio.innerHTML = estadoVazio();
      return;
    }
    const linhas = ordenar(linhasDoPosto());
    if (!linhas.length) {
      alvo.innerHTML = '';
      vazio.hidden = false;
      vazio.innerHTML = '<p><strong>Nenhum material encontrado.</strong></p><p class="dica">Troque o posto ou limpe a busca.</p>';
      return;
    }
    vazio.hidden = true;
    const grupos = new Map();
    for (const l of linhas) {
      if (!grupos.has(l.posto)) grupos.set(l.posto, []);
      grupos.get(l.posto).push(l);
    }
    const cabecalho = `<colgroup><col class="c-caixa so-impressao"><col class="c-sit"><col class="c-cod"><col class="c-pn"><col class="c-desc"><col class="c-qtd"><col class="c-qtd"><col class="c-end"><col class="c-end"><col class="c-obs"></colgroup>
      <thead><tr>
        <th class="so-impressao pp-caixa" title="Conferido">✓</th>
        <th>Resultado</th><th>Código SAP</th><th class="pp-pn">Part Number</th><th>Descrição</th>
        <th class="pp-qtd">Qtd ${esc(n.novo)}</th><th class="pp-qtd">Qtd ${esc(n.base)}</th>
        <th class="pp-end">Local ${esc(n.novo)}</th><th class="pp-end">Local ${esc(n.base)}</th><th>Comparação do posto</th>
      </tr></thead>`;
    alvo.innerHTML = [...grupos.entries()]
      .map(([posto, doGrupo]) => {
        const comuns = doGrupo.filter((l) => l.situacao === 'comum' || l.situacao === 'comum-outro').length;
        const resumo = `${comuns} comuns · ${doGrupo.length - comuns} diferentes`;
        const filas = doGrupo
          .map((l) => {
            const m = l.material;
            const pn = m.partNumber && P.normalizar(m.partNumber) !== P.normalizar(m.codigo) ? esc(m.partNumber) : '';
            const comum = l.situacao === 'comum' || l.situacao === 'comum-outro';
            const status = comum ? 'Comum' : l.situacao === 'so-base' ? `Só ${n.base}` : `Só ${n.novo}`;
            const onde = l.situacao === 'comum-outro'
              ? `${n.novo}: ${P.textoPostos(m.postosA)} · ${n.base}: ${P.textoPostos(m.postosB)}`
              : comum ? 'Mesmo posto' : l.situacao === 'so-base' && m.emA ? `${n.novo}: ${P.textoPostos(m.postosA)}` : '';
            return `<tr class="pp-linha sit-${l.situacao}">
              <td class="so-impressao pp-caixa"><span></span></td>
              <td><span class="pp-status ${comum ? 'comum' : 'nao'}"><i class="ponto"></i>${esc(status)}</span></td>
              <td class="codigo">${m.codigo ? esc(m.codigo) : '<span class="sem-sap">sem SAP</span>'}</td>
              <td class="pp-pn">${pn}</td>
              <td class="desc">${esc(m.descricao) || '<span class="sem-sap">—</span>'}</td>
              ${celulaQtde(l.a)}
              ${celulaQtde(l.b)}
              ${celulaEndereco(l.a)}
              ${celulaEndereco(l.b)}
              <td class="pp-obs">${esc(onde)}</td>
            </tr>`;
          })
          .join('');
        return `<section class="pp-grupo">
          <h3 class="pp-grupo-titulo"><span>${esc(P.rotuloPosto(posto))}</span><small>${esc(resumo)}</small></h3>
          <table class="tabela pp-tabela">${cabecalho}<tbody>${filas}</tbody></table>
        </section>`;
      })
      .join('');
  }

  function estadoVazio() {
    if (!estado.listas.length) {
      return `<div class="pp-boas-vindas">
        <h2>Comparador posto a posto</h2>
        <p>Importe duas planilhas para descobrir o que é comum e o que é diferente em cada posto.</p>
        <button type="button" class="botao primario" data-pp-importar>Importar planilha</button>
      </div>`;
    }
    return `<div class="pp-boas-vindas"><h2>Escolha dois modelos</h2><p>Selecione o modelo principal e o modelo para comparação na lateral. Se faltar uma planilha, use <strong>Importar planilha</strong>.</p></div>`;
  }

  // ---- Bipar / buscar um código -------------------------------------------------------

  function pareceCodigo(texto) {
    return /^\d{6,}/.test(texto) || (/\d{3,}/.test(texto) && /^[A-Z0-9][A-Z0-9._/-]{5,}$/i.test(texto) && !/\s/.test(texto));
  }

  function usosDe(material) {
    const usosA = new Map();
    for (const l of estado.resultado.linhas) {
      if (l.material !== material) continue;
      if (l.a) usosA.set(l.inferido === 'a' ? '' : l.posto, l.a);
    }
    const texto = (usos) =>
      [...usos.entries()]
        .sort((a, b) => P.compararPostos(a[0], b[0]))
        .map(([posto, e]) => `${posto === '' ? 'sem posto' : P.rotuloPosto(posto)}${e.qtde ? ` (${e.qtde}${e.unidade ? ` ${e.unidade}` : ''})` : ''}`)
        .join(', ');
    return texto(usosA);
  }

  function veredito() {
    const texto = $('#pp-busca').value.trim();
    if (!texto || !estado.resultado) return null;
    const achados = P.acharMaterial(estado.resultado.materiais, texto);
    if (!achados.length) return pareceCodigo(texto) ? { texto, material: null } : null;
    return { texto, material: achados[0], outros: achados.length - 1 };
  }

  function renderVeredito() {
    const caixa = $('#pp-veredito');
    const v = veredito();
    if (!v) {
      caixa.hidden = true;
      caixa.innerHTML = '';
      return;
    }
    const n = nomes();
    caixa.hidden = false;
    if (!v.material) {
      caixa.className = 'pp-veredito sit-nada';
      caixa.innerHTML = `<div class="pp-veredito-selo">Não encontrado</div><div class="pp-veredito-texto"><strong>${esc(v.texto)}</strong> não está em nenhum dos dois modelos.</div>`;
      return;
    }
    const m = v.material;
    const endsA = enderecosDoResultado(m, 'a');
    const endsB = enderecosDoResultado(m, 'b');
    const comum = m.situacao === 'comum';
    const titulo = comum ? 'Comum aos dois modelos' : m.situacao === 'so-base' ? `Somente no ${n.base}` : `Somente no ${n.novo}`;
    caixa.className = `pp-veredito ${comum ? 'sit-comum' : 'sit-nao-comum'}`;
    caixa.innerHTML = `
      <div class="pp-veredito-selo"><i class="ponto"></i>${esc(titulo)}</div>
      <div class="pp-veredito-texto">
        <div><strong>${esc(m.codigo || m.partNumber)}</strong>${m.descricao ? ` · ${esc(m.descricao)}` : ''}${m.codigo && m.partNumber && m.partNumber !== m.codigo ? ` <span class="sem-sap">${esc(m.partNumber)}</span>` : ''}${v.outros > 0 ? ` <span class="sem-sap">(+${v.outros})</span>` : ''}</div>
        <div class="pp-veredito-usos">
          <span><b>${esc(n.novo)}:</b> ${m.postosA.length ? esc(P.textoPostos(m.postosA)) : 'não usa'}</span>
          <span><b>${esc(n.base)}:</b> ${m.postosB.length ? esc(P.textoPostos(m.postosB)) : 'não usa'}</span>
          ${endsA.length ? `<span><b>Local ${esc(n.novo)}:</b> ${endsA.map((e) => `<span class="tag">${esc(e)}</span>`).join(' ')}</span>` : ''}
          ${endsB.length ? `<span><b>Local ${esc(n.base)}:</b> ${endsB.map((e) => `<span class="tag">${esc(e)}</span>`).join(' ')}</span>` : ''}
        </div>
      </div>`;
  }

  // Lê o resultado em voz alta (opcional), para quem está bipando no posto.
  function falarVeredito() {
    if (!estado.falar || !('speechSynthesis' in window)) return;
    const v = veredito();
    if (!v) return;
    const posto = (postos) => (postos.length ? postos.map((p) => (p === '½' ? 'meio' : p)).join(' e ') : '');
    let frase = 'Não encontrado.';
    if (v.material) {
      const m = v.material;
      if (m.situacao === 'comum') frase = 'Material comum aos dois modelos.';
      else frase = `Material não comum. Existe somente no ${m.situacao === 'so-base' ? nomes().base : nomes().novo}.`;
    }
    const fala = new SpeechSynthesisUtterance(frase.replace(/\bBC\s*(\d+)/gi, 'BC $1'));
    fala.lang = 'pt-BR';
    const voz = speechSynthesis.getVoices().find((x) => /^pt[-_]BR/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^pt/i.test(x.lang));
    if (voz) fala.voice = voz;
    speechSynthesis.cancel();
    speechSynthesis.speak(fala);
  }

  function atualizarBotaoFalar() {
    const botao = $('#pp-falar');
    botao.setAttribute('aria-pressed', String(estado.falar));
    botao.classList.toggle('ativo', estado.falar);
    botao.title = estado.falar ? 'Falando o resultado ao bipar (clique para desligar)' : 'Falar o resultado ao bipar (Enter)';
  }

  // ---- Exportar e imprimir -------------------------------------------------------------

  function linhasParaExportar() {
    return ordenar(linhasDoPosto());
  }

  function exportar() {
    const n = nomes();
    const cab = ['Posto', 'Resultado', 'Código SAP', 'Part Number', 'Descrição', `Qtd ${n.novo}`, `Qtd ${n.base}`, 'Unidade', `Local ${n.novo}`, `Local ${n.base}`];
    const linhas = linhasParaExportar().map((l) => [
      P.rotuloPosto(l.posto),
      l.situacao === 'comum' || l.situacao === 'comum-outro' ? 'Comum' : l.situacao === 'so-base' ? `Só ${n.base}` : `Só ${n.novo}`,
      l.material.codigo,
      l.material.partNumber,
      l.material.descricao,
      l.a?.qtde || '',
      l.b?.qtde || '',
      l.a?.unidade || l.b?.unidade || '',
      l.a?.endereco || '',
      l.b?.endereco || '',
    ]);
    const celula = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    const corpo = [cab, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' }));
    a.download = `posto-a-posto-${n.novo}-x-${n.base}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^\w.-]+/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // A impressão usa folha A4 em pé com margem (a aba Imprimir usa folha sem margem para as etiquetas).
  let estiloAntesDaImpressao = null;
  function prepararImpressao() {
    if (!painelVisivel() || !estado.resultado) return;
    const n = nomes();
    const partes = [estado.posto === null ? 'Todos os postos' : P.rotuloPosto(estado.posto)];
    if ($('#pp-busca').value.trim()) partes.push(`busca “${$('#pp-busca').value.trim()}”`);
    $('#pp-cabecalho-impressao').innerHTML = `<h1>Posto a posto — ${esc(n.novo)} × ${esc(n.base)}</h1>
      <p>${esc(partes.join(' · '))} · impresso em ${esc(new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</p>`;
    document.body.classList.add('imprimindo-postos');
    const estilo = $('#estilo-pagina');
    // Alguns navegadores avisam "vai imprimir" duas vezes: guarda só o estilo original.
    if (estiloAntesDaImpressao === null) estiloAntesDaImpressao = estilo.textContent;
    estilo.textContent = '@page { size: A4 portrait; margin: 10mm; }';
  }
  function terminarImpressao() {
    if (estiloAntesDaImpressao === null) return;
    document.body.classList.remove('imprimindo-postos');
    $('#estilo-pagina').textContent = estiloAntesDaImpressao;
    estiloAntesDaImpressao = null;
  }

  // ---- Importação ------------------------------------------------------------------------

  const imp = { opcoes: [], arquivo: '', projetoAuto: '' };

  function formatarData(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  function renderImportadas() {
    $('#pp-importadas').innerHTML = estado.listas.length
      ? `<ul class="pp-lista-importadas">${estado.listas
          .map((l) => {
            const postos = new Set(l.itens.map((i) => i.posto));
            const detalhes = [l.arquivo, `${l.itens.length} posições`, postos.has('') && postos.size === 1 ? 'sem posto' : `${[...postos].filter(Boolean).length} postos`, formatarData(l.importadoEm)].filter(Boolean);
            return `<li><div><strong>${esc(l.projeto)}</strong><span>${esc(detalhes.join(' · '))}</span>${l.origem ? `<span class="dica">${esc(l.origem)}</span>` : ''}</div>
              <button type="button" class="botao pequeno perigo" data-excluir="${esc(l.projeto)}">Excluir</button></li>`;
          })
          .join('')}</ul>`
      : '<p class="dica">Nenhuma planilha importada ainda.</p>';
    $('#pp-sugestoes').innerHTML = [...new Set(['BC22', 'BC12', ...estado.listas.map((l) => l.projeto)])].map((p) => `<option value="${esc(p)}">`).join('');
  }

  function abrirImportacao() {
    imp.opcoes = [];
    imp.arquivo = '';
    imp.projetoAuto = '';
    $('#pp-colar').value = '';
    $('#pp-projeto').value = '';
    $('#pp-leitura').hidden = true;
    renderImportadas();
    atualizarConfirmar();
    $('#dlg-postos').showModal();
    if (!estado.carregado) carregar().then(renderImportadas, () => {});
  }

  function opcaoEscolhida() {
    return imp.opcoes[Number($('#pp-forma').value) || 0] || null;
  }

  function atualizarConfirmar() {
    const botao = $('#pp-confirmar');
    const opcao = opcaoEscolhida();
    const projeto = $('#pp-projeto').value.trim();
    botao.disabled = !opcao || !projeto;
    botao.textContent = projeto && opcao ? `Importar como ${projeto}` : 'Importar';
    const existente = estado.listas.find((l) => l.projeto.toUpperCase() === projeto.toUpperCase());
    $('#pp-substitui').textContent = existente
      ? `Substitui a lista atual do ${existente.projeto} (${existente.itens.length} posições, importada em ${formatarData(existente.importadoEm)}).`
      : '';
  }

  function renderLeitura() {
    const opcao = opcaoEscolhida();
    $('#pp-leitura').hidden = !opcao;
    if (!opcao) return atualizarConfirmar();
    $('#pp-leitura-info').innerHTML = `${imp.arquivo ? `<strong>${esc(imp.arquivo)}</strong> · ` : ''}${opcao.materiais} materiais, ${opcao.entradas.length} posições${
      opcao.postos.length === 1 && opcao.postos[0] === '' ? ' — <span class="alerta">sem posto</span>' : ` em ${opcao.postos.filter(Boolean).length} postos`
    }`;
    $('#pp-forma-rotulo').hidden = imp.opcoes.length < 2;
    const contagem = new Map();
    for (const e of opcao.entradas) contagem.set(e.posto, (contagem.get(e.posto) || 0) + 1);
    $('#pp-previa-postos').innerHTML = [...contagem.entries()]
      .sort((a, b) => P.compararPostos(a[0], b[0]))
      .map(([posto, qtd]) => `<span class="tag">${esc(P.rotuloPosto(posto))} · ${qtd}</span>`)
      .join(' ');
    const amostra = opcao.entradas.slice(0, 8);
    $('#pp-previa').innerHTML =
      '<thead><tr><th>Posto</th><th>Código SAP</th><th>Part Number</th><th>Descrição</th><th>Localização</th><th>Qtd</th></tr></thead>' +
      `<tbody>${amostra
        .map(
          (e) =>
            `<tr><td>${esc(P.rotuloPosto(e.posto))}</td><td>${e.codigo ? esc(e.codigo) : '<span class="sem-sap">sem SAP</span>'}</td><td>${esc(e.partNumber)}</td><td>${esc(e.descricao)}</td><td>${esc(e.endereco)}</td><td>${esc(e.qtde)}</td></tr>`,
        )
        .join('')}</tbody>`;
    atualizarConfirmar();
  }

  function usarPlanilhas(planilhas, nomeArquivo) {
    imp.opcoes = P.analisar(planilhas);
    imp.arquivo = nomeArquivo;
    if (!imp.opcoes.length) {
      $('#pp-leitura').hidden = true;
      atualizarConfirmar();
      aviso('Não encontrei uma lista de materiais nessa planilha (coluna SAP/Código ou Part Number).', 'erro');
      return;
    }
    $('#pp-forma').innerHTML = imp.opcoes
      .map((o, i) => `<option value="${i}">${esc(o.titulo)} — ${o.entradas.length} posições</option>`)
      .join('');
    $('#pp-forma').value = '0';
    const detectado = P.detectarProjeto(planilhas, nomeArquivo);
    const campo = $('#pp-projeto');
    if (detectado && (!campo.value.trim() || campo.value.trim() === imp.projetoAuto)) {
      campo.value = detectado;
      imp.projetoAuto = detectado;
    }
    renderLeitura();
  }

  async function lerArquivo(arquivo) {
    if (/\.xlsx$/i.test(arquivo.name)) {
      const xlsx = await Importar.lerXlsx(await arquivo.arrayBuffer());
      const planilhas = [];
      for (const p of xlsx.planilhas) planilhas.push({ nome: p.nome, linhas: await xlsx.linhasDa(p) });
      return planilhas;
    }
    const bytes = await arquivo.arrayBuffer();
    let texto = new TextDecoder('utf-8').decode(bytes);
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(bytes);
    return [{ nome: arquivo.name, linhas: Importar.lerTexto(texto.replace(/^﻿/, '')) }];
  }

  async function confirmarImportacao(botao) {
    const opcao = opcaoEscolhida();
    const projeto = $('#pp-projeto').value.trim();
    if (!opcao || !projeto) return;
    const existente = estado.listas.find((l) => l.projeto.toUpperCase() === projeto.toUpperCase());
    if (existente && !confirm(`Substituir a lista do ${existente.projeto} (${existente.itens.length} posições) pela desta planilha (${opcao.entradas.length} posições)?`)) return;
    botao.disabled = true;
    try {
      const itens = opcao.entradas.map(({ posto, codigo, partNumber, descricao, endereco, qtde, unidade }) => ({ posto, codigo, partNumber, descricao, endereco, qtde, unidade }));
      const r = await api('POST', '/api/postos/importar', { projeto, arquivo: imp.arquivo, origem: opcao.titulo, itens });
      $('#dlg-postos').close();
      aviso(`Lista do ${r.projeto} importada: ${r.posicoes} posições.`, 'ok');
      // Completa primeiro o par de comparação; depois mostra a planilha recém-importada como principal.
      if (!estado.novo) estado.novo = r.projeto;
      else if (estado.novo !== r.projeto && !estado.base) estado.base = r.projeto;
      else if (estado.base !== r.projeto) estado.novo = r.projeto;
      gravarLocal('etiquetas.postos.novo', estado.novo);
      gravarLocal('etiquetas.postos.base', estado.base);
      estado.carregado = false;
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  async function excluirLista(projeto) {
    const lista = listaDe(projeto);
    if (!lista || !confirm(`Excluir a lista do ${projeto} (${lista.itens.length} posições)? O cadastro de etiquetas não é alterado.`)) return;
    try {
      await api('DELETE', `/api/postos/${encodeURIComponent(projeto)}`);
      aviso(`Lista do ${projeto} excluída.`, 'ok');
      estado.carregado = false;
      await carregar();
      renderImportadas();
      atualizarConfirmar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  }

  // ---- Eventos -------------------------------------------------------------------------------

  function ligarEventos() {
    const aoTrocarProjeto = () => {
      gravarLocal('etiquetas.postos.novo', estado.novo);
      gravarLocal('etiquetas.postos.base', estado.base);
      recalcular();
      render();
    };
    $('#pp-novo').addEventListener('change', (e) => {
      if (e.target.value === estado.base) estado.base = estado.novo;
      estado.novo = e.target.value;
      aoTrocarProjeto();
    });
    $('#pp-base').addEventListener('change', (e) => {
      if (e.target.value === estado.novo) estado.novo = estado.base;
      estado.base = e.target.value;
      aoTrocarProjeto();
    });
    $('#pp-inverter').addEventListener('click', () => {
      [estado.novo, estado.base] = [estado.base, estado.novo];
      aoTrocarProjeto();
    });

    $('#pp-postos').addEventListener('click', (e) => {
      const botao = e.target.closest('[data-posto]');
      if (!botao) return;
      estado.posto = botao.dataset.posto === '*' ? null : botao.dataset.posto;
      renderLateral();
      renderTabelas();
      $('.pp-rolagem').scrollTop = 0;
    });
    $('#pp-ordem').addEventListener('change', (e) => {
      estado.ordem = e.target.value;
      gravarLocal('etiquetas.postos.ordem', estado.ordem);
      renderTabelas();
    });

    let atraso;
    const busca = $('#pp-busca');
    busca.addEventListener('input', () => {
      clearTimeout(atraso);
      atraso = setTimeout(() => {
        renderTabelas();
        renderVeredito();
      }, 120);
    });
    // Leitor de código de barras digita o código e aperta Enter.
    busca.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(atraso);
      renderTabelas();
      renderVeredito();
      falarVeredito();
      busca.select();
    });
    $('#pp-falar').addEventListener('click', () => {
      estado.falar = !estado.falar;
      gravarLocal('etiquetas.postos.falar', estado.falar);
      atualizarBotaoFalar();
      if (estado.falar) falarVeredito();
      else if ('speechSynthesis' in window) speechSynthesis.cancel();
    });

    $('#pp-exportar').addEventListener('click', exportar);
    $('#pp-imprimir').addEventListener('click', () => window.print());
    window.addEventListener('beforeprint', prepararImpressao);
    window.addEventListener('afterprint', terminarImpressao);

    $('#pp-importar').addEventListener('click', abrirImportacao);
    $('#pp-planilhas').addEventListener('click', abrirImportacao);
    $('#aba-postos').addEventListener('click', (e) => {
      if (e.target.closest('[data-pp-importar]')) abrirImportacao();
    });

    $('#pp-arquivo').addEventListener('change', async (e) => {
      const arquivo = e.target.files[0];
      e.target.value = '';
      if (!arquivo) return;
      try {
        $('#pp-colar').value = '';
        usarPlanilhas(await lerArquivo(arquivo), arquivo.name);
      } catch (err) {
        aviso(err.message, 'erro');
      }
    });
    let atrasoColar;
    $('#pp-colar').addEventListener('input', (e) => {
      clearTimeout(atrasoColar);
      atrasoColar = setTimeout(() => {
        const linhas = Importar.lerTexto(e.target.value);
        if (linhas.length) usarPlanilhas([{ nome: 'Colado do Excel', linhas }], '');
      }, 200);
    });
    $('#pp-forma').addEventListener('change', renderLeitura);
    $('#pp-projeto').addEventListener('input', atualizarConfirmar);
    $('#form-postos').addEventListener('submit', (e) => e.preventDefault());
    $('#pp-projeto').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!$('#pp-confirmar').disabled) $('#pp-confirmar').click();
      }
    });
    $('#pp-confirmar').addEventListener('click', (e) => confirmarImportacao(e.currentTarget));
    $('#pp-importadas').addEventListener('click', (e) => {
      const botao = e.target.closest('[data-excluir]');
      if (botao) excluirLista(botao.dataset.excluir);
    });
  }

  // ---- Interface com o app.js ------------------------------------------------------------------

  function iniciar({ itensCadastro, listasMudaram }) {
    estado.itensCadastro = itensCadastro;
    estado.listasMudaram = listasMudaram || (() => {});
    ligarEventos();
    atualizarBotaoFalar();
  }

  function mostrar() {
    if (estado.carregado) return render();
    carregar().catch((err) => aviso(`Não foi possível carregar as listas posto a posto: ${err.message}`, 'erro'));
  }

  function cadastroMudou() {
    if (estado.carregado && painelVisivel()) {
      renderTabelas();
      renderVeredito();
    }
  }

  return { iniciar, mostrar, cadastroMudou };
})();
