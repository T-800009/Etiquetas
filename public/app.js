'use strict';

(() => {
  const { api, esc, lerLocal, gravarLocal, reduzirImagem, removerFundo, urlFoto, aviso } = Comum;
  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

  const PAPEIS = { A4: [210, 297], Carta: [215.9, 279.4] };
  const MODELOS = {
    padrao: { largura: 90, altura: 32 },
    pequena: { largura: 70, altura: 25 },
    grande: { largura: 100, altura: 50 },
  };
  const LAYOUT_PADRAO = {
    modelo: 'padrao',
    papel: 'A4',
    orientacao: 'paisagem',
    largura: 90,
    altura: 32,
    margem: 8,
    espaco: 0,
    copias: 1,
    pular: 0,
    corte: true,
    centralizar: true,
    // Tamanho das letras, em % do tamanho normal
    letra: 100,
    tCodigo: 100,
    tDescricao: 100,
    tEndereco: 100,
    tReferencia: 100,
    tBom: 100,
    tProjeto: 100,
    linhasDescricao: 2,
    // Campos que aparecem na etiqueta
    verLogo: true,
    verProjeto: true,
    verReferencia: true,
    verBom: true,
    verDescricao: true,
    verEndereco: true,
  };
  const TAMANHOS = { letra: '--fg', tCodigo: '--t-codigo', tDescricao: '--t-descricao', tEndereco: '--t-endereco', tReferencia: '--t-referencia', tBom: '--t-bom', tProjeto: '--t-projeto' };
  const POR_PAGINA = 200;

  const estado = {
    itens: [],
    fotos: {},
    fotosPorCodigo: new Map(),
    config: { urlBase: '', temPin: false, logo: '/img/logo-padrao.svg' },
    selecao: new Map(), // id do item -> número de cópias
    layout: carregarLayout(),
    zoom: lerLocal('etiquetas.zoom', 60),
    limiteLista: POR_PAGINA,
    limiteTabela: POR_PAGINA,
    marcadosTabela: new Set(),
  };

  function carregarLayout() {
    const salvo = lerLocal('etiquetas.layout', {});
    // Opções antigas (foto/QR code ao lado do texto) não existem mais.
    delete salvo.qr;
    delete salvo.lateral;
    return { ...LAYOUT_PADRAO, ...salvo };
  }

  // ---------------------------------------------------------------------------
  // Dados
  // ---------------------------------------------------------------------------

  async function carregar() {
    const [dados, config] = await Promise.all([api('GET', '/api/itens'), api('GET', '/api/config')]);
    estado.itens = dados.itens;
    estado.fotos = dados.fotos;
    estado.fotosPorCodigo = new Map(Object.entries(dados.fotos).map(([c, f]) => [c.toUpperCase(), f]));
    estado.config = config;
    const ids = new Set(estado.itens.map((i) => i.id));
    for (const id of estado.selecao.keys()) if (!ids.has(id)) estado.selecao.delete(id);
    for (const id of estado.marcadosTabela) if (!ids.has(id)) estado.marcadosTabela.delete(id);
    $('.marca-logo').src = config.logo;
    atualizarProjetos();
    renderLista();
    agendarFolhas();
    renderTabela();
    renderConfig();
  }

  function fotoDe(codigo) {
    return estado.fotosPorCodigo.get(String(codigo).toUpperCase()) || null;
  }

  function normalizar(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function filtrar(itens, busca, projeto) {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    return itens.filter((i) => {
      if (projeto && i.projeto !== projeto) return false;
      if (!termos.length) return true;
      const texto = normalizar(`${i.codigo} ${i.descricao} ${i.referencia} ${i.bom} ${i.endereco} ${i.projeto}`);
      return termos.every((t) => texto.includes(t));
    });
  }

  const comparador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  function ordenar(itens, chave) {
    if (chave === 'cadastro') return itens.slice();
    const lista = itens.slice();
    lista.sort((a, b) => comparador.compare(a[chave] || '￿', b[chave] || '￿') || comparador.compare(a.codigo, b.codigo));
    return lista;
  }

  // ---------------------------------------------------------------------------
  // Abas
  // ---------------------------------------------------------------------------

  function mostrarAba(nome) {
    if (!['imprimir', 'materiais', 'config'].includes(nome)) nome = 'imprimir';
    for (const botao of $$('.aba')) {
      const ativa = botao.dataset.aba === nome;
      botao.classList.toggle('ativa', ativa);
      botao.setAttribute('aria-selected', String(ativa));
    }
    for (const painel of $$('.painel-aba')) painel.hidden = painel.id !== `aba-${nome}`;
  }

  for (const botao of $$('.aba')) {
    botao.addEventListener('click', () => {
      history.replaceState(null, '', `#${botao.dataset.aba}`);
      mostrarAba(botao.dataset.aba);
    });
  }
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-ir]');
    if (!link) return;
    e.preventDefault();
    history.replaceState(null, '', `#${link.dataset.ir}`);
    mostrarAba(link.dataset.ir);
  });
  window.addEventListener('hashchange', () => mostrarAba(location.hash.slice(1)));

  // ---------------------------------------------------------------------------
  // Aba Imprimir — lista de seleção
  // ---------------------------------------------------------------------------

  function atualizarProjetos() {
    const select = $('#imp-projeto');
    const atual = select.value;
    const projetos = [...new Set(estado.itens.map((i) => i.projeto).filter(Boolean))].sort(comparador.compare);
    select.innerHTML = '<option value="">Todos os projetos</option>' + projetos.map((p) => `<option>${esc(p)}</option>`).join('');
    select.value = projetos.includes(atual) ? atual : '';
  }

  function itensDaLista() {
    return ordenar(filtrar(estado.itens, $('#imp-busca').value, $('#imp-projeto').value), $('#imp-ordem').value);
  }

  function renderLista() {
    const lista = itensDaLista();
    const ul = $('#imp-lista');
    if (!estado.itens.length) {
      ul.innerHTML = '<li class="lista-vazia">Nenhum material cadastrado.<br><a href="#materiais" data-ir="materiais">Cadastrar ou importar</a></li>';
    } else if (!lista.length) {
      ul.innerHTML = '<li class="lista-vazia">Nada encontrado com esse filtro.</li>';
    } else {
      const visiveis = lista.slice(0, estado.limiteLista);
      ul.innerHTML =
        visiveis.map(htmlItemLista).join('') +
        (lista.length > visiveis.length
          ? `<li class="lista-vazia"><button class="botao pequeno" data-mais>Mostrar mais (${lista.length - visiveis.length})</button></li>`
          : '');
    }
    atualizarContador(lista.length);
  }

  function htmlItemLista(item) {
    const copias = estado.selecao.get(item.id);
    const marcado = copias !== undefined;
    return `<li class="sel-item${marcado ? ' marcado' : ''}" data-id="${esc(item.id)}">
      <input type="checkbox" ${marcado ? 'checked' : ''} aria-label="Selecionar ${esc(item.codigo)}">
      <div class="sel-texto">
        <div class="sel-linha1">${fotoDe(item.codigo) ? '' : '<span class="sem-foto-ponto" title="Sem foto cadastrada"></span>'}<span class="sel-cod">${esc(item.codigo)}</span>${item.endereco ? `<span class="tag">${esc(item.endereco)}</span>` : ''}</div>
        <div class="sel-desc">${esc(item.descricao || '—')}</div>
      </div>
      ${marcado ? `<div class="qtd" title="Cópias"><button type="button" data-qtd="-1" aria-label="Menos uma cópia">−</button><input type="number" min="1" max="999" value="${copias}" aria-label="Cópias"><button type="button" data-qtd="1" aria-label="Mais uma cópia">+</button></div>` : ''}
    </li>`;
  }

  function atualizarItemLista(id) {
    const li = $(`#imp-lista .sel-item[data-id="${CSS.escape(id)}"]`);
    const item = estado.itens.find((i) => i.id === id);
    if (li && item) li.outerHTML = htmlItemLista(item);
  }

  function atualizarContador(total = itensDaLista().length) {
    const n = estado.selecao.size;
    $('#imp-contador').textContent = n ? `${n} selecionado${n > 1 ? 's' : ''}` : `${total} na lista`;
  }

  function alternar(id, marcar) {
    if (marcar) estado.selecao.set(id, Math.max(1, Number(estado.layout.copias) || 1));
    else estado.selecao.delete(id);
    atualizarItemLista(id);
    atualizarContador();
    agendarFolhas();
  }

  const ul = $('#imp-lista');
  ul.addEventListener('click', (e) => {
    if (e.target.closest('[data-mais]')) {
      estado.limiteLista += POR_PAGINA;
      return renderLista();
    }
    const li = e.target.closest('.sel-item');
    if (!li) return;
    const id = li.dataset.id;
    const botaoQtd = e.target.closest('[data-qtd]');
    if (botaoQtd) {
      const atual = estado.selecao.get(id) || 1;
      const novo = Math.min(999, Math.max(1, atual + Number(botaoQtd.dataset.qtd)));
      estado.selecao.set(id, novo);
      $('.qtd input', li).value = novo;
      agendarFolhas();
      return;
    }
    if (e.target.closest('.qtd')) return;
    if (e.target.matches('input[type="checkbox"]')) return alternar(id, e.target.checked);
    alternar(id, !estado.selecao.has(id));
  });
  ul.addEventListener('change', (e) => {
    if (!e.target.matches('.qtd input')) return;
    const id = e.target.closest('.sel-item').dataset.id;
    const valor = Math.min(999, Math.max(1, Math.round(Number(e.target.value)) || 1));
    e.target.value = valor;
    estado.selecao.set(id, valor);
    agendarFolhas();
  });

  let atrasoBusca;
  $('#imp-busca').addEventListener('input', () => {
    clearTimeout(atrasoBusca);
    atrasoBusca = setTimeout(() => {
      estado.limiteLista = POR_PAGINA;
      renderLista();
    }, 120);
  });
  $('#imp-projeto').addEventListener('change', () => {
    estado.limiteLista = POR_PAGINA;
    renderLista();
  });
  $('#imp-ordem').addEventListener('change', () => {
    renderLista();
    agendarFolhas();
  });
  $('#imp-todos').addEventListener('click', () => {
    const copias = Math.max(1, Number(estado.layout.copias) || 1);
    for (const item of itensDaLista()) if (!estado.selecao.has(item.id)) estado.selecao.set(item.id, copias);
    renderLista();
    agendarFolhas();
  });
  $('#imp-limpar').addEventListener('click', () => {
    estado.selecao.clear();
    renderLista();
    agendarFolhas();
  });

  // ---------------------------------------------------------------------------
  // Aba Imprimir — layout e folhas
  // ---------------------------------------------------------------------------

  function geometria(l) {
    let [pw, ph] = PAPEIS[l.papel] || PAPEIS.A4;
    if (l.orientacao === 'paisagem') [pw, ph] = [ph, pw];
    const w = Number(l.largura) || 0;
    const h = Number(l.altura) || 0;
    const m = Math.max(0, Number(l.margem) || 0);
    const gap = Math.max(0, Number(l.espaco) || 0);
    const cols = w > 0 ? Math.max(0, Math.floor((pw - 2 * m + gap + 0.001) / (w + gap))) : 0;
    const rows = h > 0 ? Math.max(0, Math.floor((ph - 2 * m + gap + 0.001) / (h + gap))) : 0;
    const usadoW = cols * w + Math.max(0, cols - 1) * gap;
    const usadoH = rows * h + Math.max(0, rows - 1) * gap;
    return {
      pw,
      ph,
      w,
      h,
      gap,
      cols,
      rows,
      ml: l.centralizar ? (pw - usadoW) / 2 : m,
      mt: l.centralizar ? (ph - usadoH) / 2 : m,
      porFolha: cols * rows,
    };
  }

  function aplicarVariaveis(el, g) {
    const vars = { '--pw': g.pw, '--ph': g.ph, '--w': g.w, '--h': g.h, '--gap': g.gap, '--ml': g.ml, '--mt': g.mt };
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, `${v}mm`);
    el.style.setProperty('--cols', g.cols);
    const l = estado.layout;
    for (const [campo, variavel] of Object.entries(TAMANHOS)) el.style.setProperty(variavel, (Number(l[campo]) || 100) / 100);
    el.style.setProperty('--linhas-descricao', Math.min(3, Math.max(1, Number(l.linhasDescricao) || 2)));
  }

  function htmlEtiqueta(item, { escalas = {}, classes = '' } = {}) {
    const l = estado.layout;
    const s = (k) => (escalas[k] && escalas[k] < 1 ? ` style="--s:${escalas[k]}"` : '');
    const topo =
      l.verLogo || l.verProjeto
        ? `<div class="etq-topo">${l.verLogo ? `<img class="etq-logo" src="${esc(estado.config.logo)}" alt="">` : '<span></span>'}${l.verProjeto ? `<span class="etq-projeto"${s('projeto')}>${esc(item.projeto)}</span>` : ''}</div>`
        : '';
    const rodape =
      l.verDescricao || l.verEndereco
        ? `<div class="etq-rodape">${l.verDescricao ? `<span class="etq-desc"${s('descricao')}>${esc(item.descricao)}</span>` : '<span class="etq-desc"></span>'}${l.verEndereco ? `<span class="etq-end"${s('endereco')}>${esc(item.endereco)}</span>` : ''}</div>`
        : '';
    return `<div class="etq${classes}">
      <div class="etq-info">
        ${topo}
        <div class="etq-codigo"${s('codigo')}>${esc(item.codigo)}</div>
        ${l.verReferencia && item.referencia ? `<div class="etq-ref"${s('referencia')}>${esc(item.referencia)}</div>` : ''}
        ${l.verBom && item.bom ? `<div class="etq-bom"${s('bom')}>${esc(item.bom)}</div>` : ''}
        ${rodape}
      </div>
    </div>`;
  }

  // Diminui a fonte dos textos que não cabem na etiqueta (em vez de cortar como no Excel).
  const UMA_LINHA = [
    ['projeto', '.etq-projeto'],
    ['codigo', '.etq-codigo'],
    ['referencia', '.etq-ref'],
    ['bom', '.etq-bom'],
    ['endereco', '.etq-end'],
  ];
  const cacheEscalas = new Map();

  function medirEscalas(itens, g) {
    const l = estado.layout;
    const chaveLayout = [g.w, g.h, estado.config.logo, l.linhasDescricao, ...Object.keys(TAMANHOS).map((k) => l[k]), ...Object.keys(l).filter((k) => k.startsWith('ver')).map((k) => l[k])].join('|');
    const chave = (i) => `${chaveLayout}|${i.codigo}|${i.referencia}|${i.bom}|${i.descricao}|${i.endereco}|${i.projeto}`;
    const faltando = itens.filter((i) => !cacheEscalas.has(chave(i)));
    if (faltando.length) {
      const medidor = $('#medidor');
      aplicarVariaveis(medidor, g);
      medidor.innerHTML = faltando.map((i) => htmlEtiqueta(i)).join('');
      const etiquetas = Array.from(medidor.children);
      const escalas = etiquetas.map(() => ({}));

      // 1) textos de uma linha: reduz na proporção exata do que sobrou
      const leituras = etiquetas.map((el) =>
        UMA_LINHA.map(([, sel]) => {
          const alvo = $(sel, el);
          return alvo && alvo.scrollWidth > alvo.clientWidth + 0.5 ? alvo.clientWidth / alvo.scrollWidth : 1;
        }),
      );
      etiquetas.forEach((el, k) => {
        UMA_LINHA.forEach(([campo, sel], j) => {
          if (leituras[k][j] >= 1) return;
          const s = Math.max(0.5, Math.floor(leituras[k][j] * 100) / 100 - 0.01);
          escalas[k][campo] = s;
          $(sel, el).style.setProperty('--s', s);
        });
      });

      // 2) descrição: até 2 linhas, diminuindo aos poucos se não couber (sem ficar ilegível;
      //    o que ainda sobrar termina em "…")
      const descricoes = etiquetas.map((el) => $('.etq-desc', el));
      for (let passo = 0; passo < 4; passo++) {
        const sobrando = descricoes.map((d) => Boolean(d) && d.scrollHeight > d.clientHeight + 0.5);
        if (!sobrando.some(Boolean)) break;
        sobrando.forEach((s, k) => {
          if (!s) return;
          const atual = escalas[k].descricao || 1;
          if (atual <= 0.76) return;
          escalas[k].descricao = Math.round((atual - 0.08) * 100) / 100;
          descricoes[k].style.setProperty('--s', escalas[k].descricao);
        });
      }
      // 3) marca as etiquetas em que o texto não coube na altura (letra grande demais)
      etiquetas.forEach((el, k) => {
        const info = $('.etq-info', el);
        const necessario = Array.from(info.children).reduce((soma, filho) => soma + filho.scrollHeight, 0);
        escalas[k].naoCoube = necessario > info.clientHeight + 1;
      });
      faltando.forEach((item, k) => cacheEscalas.set(chave(item), escalas[k]));
      medidor.innerHTML = '';
    }
    return new Map(itens.map((i) => [i.id, cacheEscalas.get(chave(i))]));
  }

  let quadroFolhas = 0;
  function agendarFolhas() {
    cancelAnimationFrame(quadroFolhas);
    quadroFolhas = requestAnimationFrame(renderFolhas);
  }

  function renderFolhas() {
    quadroFolhas = 0;
    const l = estado.layout;
    const g = geometria(l);
    const folhas = $('#imp-folhas');
    const selecionados = ordenar(
      estado.itens.filter((i) => estado.selecao.has(i.id)),
      $('#imp-ordem').value,
    );
    const total = selecionados.reduce((s, i) => s + estado.selecao.get(i.id), 0);

    $('#imp-layout-info').textContent = g.porFolha
      ? `Cabem ${g.cols} × ${g.rows} = ${g.porFolha} etiquetas por folha.`
      : 'A etiqueta não cabe na folha com essas medidas. Diminua o tamanho ou a margem.';
    $('#estilo-pagina').textContent = `@page { size: ${g.pw}mm ${g.ph}mm; margin: 0; }`;
    folhas.style.zoom = estado.zoom / 100;

    if (!total || !g.porFolha) {
      folhas.innerHTML = '';
      $('#imp-vazio').hidden = Boolean(total);
      $('#imp-resumo').textContent = total ? 'Ajuste o tamanho da etiqueta' : 'Nenhuma etiqueta selecionada';
      $('#imp-imprimir').disabled = true;
      return;
    }

    const escalas = medirEscalas(selecionados, g);
    const naoCouberam = selecionados.filter((i) => escalas.get(i.id)?.naoCoube).length;
    if (naoCouberam) {
      $('#imp-layout-info').textContent += ` Atenção: em ${naoCouberam} material(is) o texto não coube na altura — diminua as letras, tire algum campo ou aumente a altura da etiqueta.`;
    }
    $('#imp-layout-info').classList.toggle('alerta', naoCouberam > 0);
    const pular = Math.min(Math.max(0, Math.floor(Number(l.pular) || 0)), g.porFolha - 1);
    const posicoes = Array(pular).fill(null);
    for (const item of selecionados) for (let c = 0; c < estado.selecao.get(item.id); c++) posicoes.push(item);

    const paginas = [];
    for (let i = 0; i < posicoes.length; i += g.porFolha) paginas.push(posicoes.slice(i, i + g.porFolha));
    const classeFolha = `folha${l.corte ? ' corte' : ''}${l.corte && g.gap > 0 ? ' separadas' : ''}`;
    folhas.innerHTML = paginas
      .map((pagina) => {
        const html = pagina.map((item, idx) => {
          const classes = `${idx % g.cols === 0 ? ' col0' : ''}${idx < g.cols ? ' lin0' : ''}${item ? '' : ' vazia'}`;
          if (!item) return `<div class="etq${classes}"></div>`;
          return htmlEtiqueta(item, { escalas: escalas.get(item.id), classes });
        });
        return `<div class="${classeFolha}">${html.join('')}</div>`;
      })
      .join('');
    aplicarVariaveis(folhas, g);
    $('#imp-vazio').hidden = true;
    $('#imp-resumo').innerHTML = `${total} etiqueta${total > 1 ? 's' : ''} · ${paginas.length} folha${paginas.length > 1 ? 's' : ''}<small>${g.porFolha} por folha</small>`;
    $('#imp-imprimir').disabled = false;
  }

  // Formulário de layout
  const formLayout = $('#imp-layout');
  function preencherLayout() {
    for (const [nome, valor] of Object.entries(estado.layout)) {
      const campo = formLayout.elements[nome];
      if (!campo) continue;
      if (campo.type === 'checkbox') campo.checked = Boolean(valor);
      else campo.value = valor;
      if (campo.type === 'range') campo.nextElementSibling.textContent = `${valor}%`;
    }
  }
  formLayout.addEventListener('input', (e) => {
    const campo = e.target;
    if (!campo.name) return;
    const l = estado.layout;
    if (campo.type === 'checkbox') l[campo.name] = campo.checked;
    else if (campo.type === 'number' || campo.type === 'range') {
      if (campo.value === '' || !Number.isFinite(Number(campo.value))) return;
      l[campo.name] = Number(campo.value);
    } else l[campo.name] = campo.value;

    if (campo.name === 'modelo' && MODELOS[campo.value]) Object.assign(l, MODELOS[campo.value]);
    if (campo.name === 'largura' || campo.name === 'altura') {
      const modelo = Object.entries(MODELOS).find(([, m]) => m.largura === l.largura && m.altura === l.altura);
      l.modelo = modelo ? modelo[0] : 'personalizado';
    }
    preencherLayout();
    gravarLocal('etiquetas.layout', l);
    agendarFolhas();
  });
  formLayout.addEventListener('submit', (e) => e.preventDefault());
  $('#imp-layout-padrao').addEventListener('click', () => {
    estado.layout = { ...LAYOUT_PADRAO };
    preencherLayout();
    gravarLocal('etiquetas.layout', estado.layout);
    agendarFolhas();
  });
  // Botões − / + ao lado das letras
  formLayout.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-passo]');
    if (!botao) return;
    const faixa = botao.parentElement.querySelector('input[type="range"]');
    faixa.value = Number(faixa.value) + Number(botao.dataset.passo);
    faixa.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#imp-layout-botao').addEventListener('click', (e) => {
    formLayout.hidden = !formLayout.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!formLayout.hidden));
  });
  $('#imp-zoom').value = estado.zoom;
  $('#imp-zoom').addEventListener('input', (e) => {
    estado.zoom = Number(e.target.value);
    $('#imp-folhas').style.zoom = estado.zoom / 100;
    gravarLocal('etiquetas.zoom', estado.zoom);
  });
  $('#imp-imprimir').addEventListener('click', () => {
    if (quadroFolhas) renderFolhas();
    // Espera o logo carregar para ele não sair em branco na impressão.
    const pendentes = $$('#imp-folhas img')
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise((pronto) => {
            img.addEventListener('load', pronto, { once: true });
            img.addEventListener('error', pronto, { once: true });
          }),
      );
    Promise.all(pendentes).then(() => window.print());
  });

  // ---------------------------------------------------------------------------
  // Aba Materiais
  // ---------------------------------------------------------------------------

  function itensDaTabela() {
    let lista = filtrar(estado.itens, $('#mat-busca').value, '');
    if ($('#mat-sem-foto').checked) lista = lista.filter((i) => !fotoDe(i.codigo));
    return ordenar(lista, 'codigo');
  }

  function renderTabela() {
    const lista = itensDaTabela();
    const visiveis = lista.slice(0, estado.limiteTabela);
    $('#mat-corpo').innerHTML = visiveis
      .map((i) => {
        const foto = fotoDe(i.codigo);
        const miniatura = foto
          ? `<button class="miniatura" data-acao="foto" style="background-image:url('${esc(urlFoto(foto))}')" title="${foto.origem === 'internet' ? 'Foto da internet — clique para enviar uma foto tirada no local' : 'Trocar foto'}" aria-label="Trocar foto de ${esc(i.codigo)}">${foto.origem === 'internet' ? '<span class="selo-web">web</span>' : ''}</button>`
          : `<button class="miniatura sem" data-acao="foto" title="Adicionar foto">+ foto</button>`;
        return `<tr data-id="${esc(i.id)}">
          <td class="col-check"><input type="checkbox" class="mat-check" ${estado.marcadosTabela.has(i.id) ? 'checked' : ''} aria-label="Selecionar ${esc(i.codigo)}"></td>
          <td>${miniatura}</td>
          <td class="codigo">${esc(i.codigo)}</td>
          <td class="desc">${esc(i.descricao)}</td>
          <td>${esc(i.referencia)}</td>
          <td class="nowrap">${esc(i.bom)}</td>
          <td class="nowrap">${i.endereco ? `<span class="tag">${esc(i.endereco)}</span>` : ''}</td>
          <td class="nowrap">${esc(i.projeto)}</td>
          <td class="col-acoes"><a class="botao pequeno" href="/m/${esc(encodeURIComponent(i.codigo))}" target="_blank" rel="noopener">Ver página</a> <button class="botao pequeno" data-acao="editar">Editar</button></td>
        </tr>`;
      })
      .join('');
    $('#mat-vazio').hidden = estado.itens.length > 0;
    $('#mat-mais').hidden = lista.length <= visiveis.length;
    $('#mat-mais').textContent = `Mostrar mais (${lista.length - visiveis.length})`;
    $('#mat-check-todos').checked = visiveis.length > 0 && visiveis.every((i) => estado.marcadosTabela.has(i.id));
    $('#mat-excluir-sel').hidden = estado.marcadosTabela.size === 0;
    atualizarBotaoWeb();
    $('#mat-excluir-sel').textContent = `Excluir selecionados (${estado.marcadosTabela.size})`;

    const codigos = new Set(estado.itens.map((i) => i.codigo.toUpperCase()));
    const semFoto = [...codigos].filter((c) => !estado.fotosPorCodigo.has(c)).length;
    const daInternet = [...codigos].filter((c) => estado.fotosPorCodigo.get(c)?.origem === 'internet').length;
    $('#mat-estat').innerHTML = estado.itens.length
      ? `<span><strong>${estado.itens.length}</strong> etiquetas cadastradas</span><span><strong>${codigos.size}</strong> códigos diferentes</span><span><strong>${codigos.size - semFoto - daInternet}</strong> com foto do local · <strong>${daInternet}</strong> com foto da internet · <strong>${semFoto}</strong> sem foto</span>${lista.length !== estado.itens.length ? `<span>${lista.length} no filtro</span>` : ''}`
      : '';
  }

  let atrasoTabela;
  $('#mat-busca').addEventListener('input', () => {
    clearTimeout(atrasoTabela);
    atrasoTabela = setTimeout(() => {
      estado.limiteTabela = POR_PAGINA;
      renderTabela();
    }, 120);
  });
  $('#mat-sem-foto').addEventListener('change', () => {
    estado.limiteTabela = POR_PAGINA;
    renderTabela();
  });
  $('#mat-mais').addEventListener('click', () => {
    estado.limiteTabela += POR_PAGINA;
    renderTabela();
  });
  $('#mat-check-todos').addEventListener('change', (e) => {
    for (const i of itensDaTabela().slice(0, estado.limiteTabela)) {
      if (e.target.checked) estado.marcadosTabela.add(i.id);
      else estado.marcadosTabela.delete(i.id);
    }
    renderTabela();
  });

  // Foto rápida: clicar na miniatura já abre o seletor de arquivo.
  const fotoRapida = document.createElement('input');
  fotoRapida.type = 'file';
  fotoRapida.accept = 'image/*';
  fotoRapida.hidden = true;
  document.body.appendChild(fotoRapida);
  let codigoFotoRapida = '';
  fotoRapida.addEventListener('change', async () => {
    const arquivo = fotoRapida.files[0];
    fotoRapida.value = '';
    if (!arquivo) return;
    try {
      await enviarFoto(codigoFotoRapida, arquivo);
      aviso(`Foto de ${codigoFotoRapida} salva.`, 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });

  $('#mat-corpo').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const item = estado.itens.find((i) => i.id === tr.dataset.id);
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    if (acao === 'foto') {
      codigoFotoRapida = item.codigo;
      fotoRapida.click();
    } else if (acao === 'editar') abrirMaterial(item);
  });
  $('#mat-corpo').addEventListener('change', (e) => {
    if (!e.target.matches('.mat-check')) return;
    const id = e.target.closest('tr').dataset.id;
    if (e.target.checked) estado.marcadosTabela.add(id);
    else estado.marcadosTabela.delete(id);
    renderTabela();
  });
  $('#mat-excluir-sel').addEventListener('click', async () => {
    const n = estado.marcadosTabela.size;
    if (!confirm(`Excluir ${n} material${n > 1 ? 'is' : ''} do cadastro? As fotos continuam guardadas.`)) return;
    try {
      await api('POST', '/api/itens/excluir', { ids: [...estado.marcadosTabela] });
      estado.marcadosTabela.clear();
      aviso(`${n} excluído${n > 1 ? 's' : ''}.`, 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });

  function baixarCsv() {
    const blob = Importar.gerarCsv(ordenar(estado.itens, 'codigo'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `materiais-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#mat-exportar').addEventListener('click', baixarCsv);
  $('#cfg-exportar').addEventListener('click', baixarCsv);

  async function enviarFoto(codigo, arquivo) {
    const blob = await reduzirImagem(arquivo);
    return api('PUT', `/api/fotos/${encodeURIComponent(codigo)}`, blob);
  }

  function buscarImagens(termo) {
    return api('GET', `/api/imagens/buscar?q=${encodeURIComponent(termo)}`);
  }

  // Baixa a imagem (pelo servidor) e tira o fundo. Se o site original bloquear,
  // tenta a miniatura do Google.
  async function prepararFotoInternet(resultado) {
    let ultimoErro;
    for (const endereco of [resultado.url, resultado.reserva].filter(Boolean)) {
      try {
        const resp = await api('GET', `/api/imagens/baixar?url=${encodeURIComponent(endereco)}`, undefined, { bruto: true });
        const { blob } = await removerFundo(await resp.blob());
        return { blob, credito: resultado.credito || '' };
      } catch (err) {
        if (err.status === 401) throw err;
        ultimoErro = err;
      }
    }
    throw ultimoErro || new Error('Não foi possível baixar esta imagem.');
  }

  function salvarFotoInternet(codigo, preparada, { substituir = false } = {}) {
    const extras = { 'X-Origem': 'internet', 'X-Credito': encodeURIComponent(preparada.credito) };
    if (substituir) extras['X-Substituir'] = '1';
    return api('PUT', `/api/fotos/${encodeURIComponent(codigo)}`, preparada.blob, { extras });
  }

  // ---- Fotos da internet em lote ------------------------------------------------

  // Um código por material sem foto que tenha descrição.
  function codigosSemFoto() {
    const vistos = new Set();
    const lista = [];
    for (const i of estado.itens) {
      const chave = i.codigo.toUpperCase();
      if (vistos.has(chave) || !i.descricao || fotoDe(i.codigo)) continue;
      vistos.add(chave);
      lista.push({ codigo: i.codigo, descricao: i.descricao });
    }
    return lista;
  }

  const lote = { rodando: false, parar: false, feitos: 0, total: 0 };
  function atualizarBotaoWeb() {
    const botao = $('#mat-buscar-web');
    if (lote.rodando) {
      botao.hidden = false;
      botao.textContent = lote.parar ? 'Parando…' : `Buscando ${lote.feitos + 1} de ${lote.total}… (parar)`;
      return;
    }
    const n = codigosSemFoto().length;
    botao.hidden = n === 0;
    botao.textContent = `Buscar fotos na internet (${n} sem foto)`;
  }

  $('#mat-buscar-web').addEventListener('click', async () => {
    if (lote.rodando) {
      lote.parar = true;
      return atualizarBotaoWeb();
    }
    const codigos = codigosSemFoto();
    if (
      !confirm(
        `Buscar na internet uma foto pela descrição para ${codigos.length} materia${codigos.length > 1 ? 'is' : 'l'} sem foto?\n\n` +
          'O site usa a primeira foto encontrada e tira o fundo. Ela é parecida com o material, mas pode não ser a peça exata: confira e troque quando precisar (no Editar dá para escolher entre várias).',
      )
    )
      return;
    Object.assign(lote, { rodando: true, parar: false, feitos: 0, total: codigos.length });
    let naoAchou = 0;
    let erros = 0;
    try {
      for (const { codigo, descricao } of codigos) {
        if (lote.parar) break;
        atualizarBotaoWeb();
        try {
          const { resultados } = await buscarImagens(descricao);
          let foto = null;
          // Tenta as primeiras opções até uma baixar.
          for (const resultado of resultados.slice(0, 3)) {
            try {
              foto = await salvarFotoInternet(codigo, await prepararFotoInternet(resultado));
              break;
            } catch (err) {
              if (err.status === 401 || err.status === 409) throw err;
            }
          }
          if (foto) estado.fotosPorCodigo.set(codigo.toUpperCase(), foto);
          else naoAchou += 1;
        } catch (err) {
          if (err.status === 401 || err.status === 429) throw err;
          erros += 1;
        }
        lote.feitos += 1;
        if (lote.feitos % 5 === 0) renderTabela();
      }
      const achou = lote.feitos - naoAchou - erros;
      aviso(`${achou} foto(s) adicionada(s)${naoAchou ? `, ${naoAchou} sem resultado` : ''}${erros ? `, ${erros} com erro` : ''}.`, achou ? 'ok' : 'info');
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      lote.rodando = false;
      await carregar();
    }
  });

  // ---- Escolher foto da internet -----------------------------------------------

  const dlgBusca = $('#dlg-busca');
  let resolverBusca = null;
  let resultadosBusca = [];

  async function buscarNaInternet() {
    const termo = $('#busca-termo').value.trim();
    if (!termo) return;
    const grade = $('#busca-resultados');
    $('#busca-status').textContent = 'Buscando…';
    grade.innerHTML = '';
    try {
      const r = await buscarImagens(termo);
      resultadosBusca = r.resultados;
      $('#busca-status').textContent = resultadosBusca.length
        ? `Clique na foto que mais se parece com o material. O fundo é removido automaticamente. (${r.fonte === 'google' ? 'Google Imagens' : `Fotos livres — buscado como “${r.termo}”`})`
        : `Nada encontrado para “${r.termo}”. Tente palavras mais simples, por exemplo só o tipo da peça.`;
      grade.innerHTML = resultadosBusca
        .map(
          (f, i) => `<button type="button" class="resultado" data-i="${i}" title="${esc(f.titulo)}">
            <img src="${esc(f.miniatura || f.url)}" alt="${esc(f.titulo)}" loading="lazy" referrerpolicy="no-referrer"><span>${esc(f.credito)}</span></button>`,
        )
        .join('');
    } catch (err) {
      $('#busca-status').textContent = err.message;
    }
  }

  function escolherFotoInternet(termo) {
    $('#busca-termo').value = termo;
    dlgBusca.showModal();
    buscarNaInternet();
    return new Promise((resolve) => (resolverBusca = resolve));
  }

  $('#form-busca').addEventListener('submit', (e) => {
    e.preventDefault();
    buscarNaInternet();
  });
  $('#busca-resultados').addEventListener('click', async (e) => {
    const botao = e.target.closest('.resultado');
    if (!botao || $('#busca-resultados').classList.contains('carregando')) return;
    $('#busca-resultados').classList.add('carregando');
    $('#busca-status').textContent = 'Baixando a foto e removendo o fundo…';
    try {
      const preparada = await prepararFotoInternet(resultadosBusca[Number(botao.dataset.i)]);
      resolverBusca?.(preparada);
      resolverBusca = null;
      dlgBusca.close();
    } catch (err) {
      $('#busca-status').textContent = `${err.message} Escolha outra foto.`;
      botao.disabled = true;
    } finally {
      $('#busca-resultados').classList.remove('carregando');
    }
  });
  dlgBusca.addEventListener('close', () => {
    resolverBusca?.(null);
    resolverBusca = null;
  });

  // ---- Diálogo de material ----------------------------------------------------

  const dlgMaterial = $('#dlg-material');
  const formMaterial = $('#form-material');
  const material = { item: null, fotoNova: null, removerFoto: false, urlPrevia: '', fotoWeb: null };

  function mostrarFotoDialogo() {
    const area = $('#dlg-foto-area');
    if (material.urlPrevia) URL.revokeObjectURL(material.urlPrevia);
    material.urlPrevia = '';
    let url = '';
    let credito = '';
    if (material.fotoNova) url = material.urlPrevia = URL.createObjectURL(material.fotoNova);
    else if (material.fotoWeb) {
      url = material.urlPrevia = URL.createObjectURL(material.fotoWeb.blob);
      credito = material.fotoWeb.credito;
    } else if (!material.removerFoto && material.item) {
      const foto = fotoDe(material.item.codigo);
      url = urlFoto(foto);
      credito = foto?.credito || '';
    }
    area.classList.toggle('com-foto', Boolean(url));
    area.style.backgroundImage = url ? `url("${url}")` : '';
    area.innerHTML = url
      ? credito
        ? `<span class="credito-foto">${esc(credito)}</span>`
        : ''
      : 'Sem foto. Escolha uma imagem do computador, tire uma foto pelo celular ou busque na internet.';
    $('#dlg-foto-remover').hidden = !url;
  }

  function abrirMaterial(item) {
    material.item = item || null;
    material.fotoNova = null;
    material.removerFoto = false;
    material.fotoWeb = null;
    formMaterial.reset();
    for (const campo of Importar.CAMPOS) formMaterial.elements[campo.id].value = item ? item[campo.id] : '';
    $('#dlg-material-titulo').textContent = item ? `Editar ${item.codigo}` : 'Novo material';
    $('#dlg-excluir').hidden = !item;
    mostrarFotoDialogo();
    dlgMaterial.showModal();
  }

  for (const id of ['#dlg-foto-arquivo', '#dlg-foto-camera']) {
    $(id).addEventListener('change', (e) => {
      const arquivo = e.target.files[0];
      e.target.value = '';
      if (!arquivo) return;
      material.fotoNova = arquivo;
      material.removerFoto = false;
      material.fotoWeb = null;
      mostrarFotoDialogo();
    });
  }
  $('#dlg-foto-remover').addEventListener('click', () => {
    material.fotoNova = null;
    material.fotoWeb = null;
    material.removerFoto = true;
    mostrarFotoDialogo();
  });
  $('#mat-novo').addEventListener('click', () => abrirMaterial(null));

  $('#dlg-foto-web').addEventListener('click', async () => {
    const termo = formMaterial.elements.descricao.value.trim() || formMaterial.elements.codigo.value.trim();
    const escolhida = await escolherFotoInternet(termo);
    if (!escolhida) return;
    material.fotoWeb = escolhida;
    material.fotoNova = null;
    material.removerFoto = false;
    mostrarFotoDialogo();
  });

  formMaterial.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'salvar') return;
    e.preventDefault();
    const dados = Object.fromEntries(Importar.CAMPOS.map((c) => [c.id, formMaterial.elements[c.id].value.trim()]));
    const botao = e.submitter;
    botao.disabled = true;
    try {
      const salvo = material.item ? await api('PUT', `/api/itens/${material.item.id}`, dados) : await api('POST', '/api/itens', dados);
      if (material.fotoNova) await enviarFoto(salvo.codigo, material.fotoNova);
      else if (material.fotoWeb) await salvarFotoInternet(salvo.codigo, material.fotoWeb, { substituir: true });
      else if (material.removerFoto) await api('DELETE', `/api/fotos/${encodeURIComponent(salvo.codigo)}`);
      dlgMaterial.close();
      aviso('Material salvo.', 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });
  $('#dlg-excluir').addEventListener('click', async () => {
    if (!material.item || !confirm(`Excluir ${material.item.codigo} (${material.item.endereco || 'sem endereço'}) do cadastro?`)) return;
    try {
      await api('DELETE', `/api/itens/${material.item.id}`);
      dlgMaterial.close();
      aviso('Material excluído.', 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });
  dlgMaterial.addEventListener('close', () => {
    if (material.urlPrevia) URL.revokeObjectURL(material.urlPrevia);
    material.urlPrevia = '';
  });

  // ---- Diálogo de importação ----------------------------------------------------

  const dlgImportar = $('#dlg-importar');
  const imp = { linhas: [], xlsx: null, mapa: {}, cabecalho: true, passo: 1 };

  function passoImportacao(n) {
    imp.passo = n;
    $('#imp-passo1').hidden = n !== 1;
    $('#imp-passo2').hidden = n !== 2;
    $('#imp-voltar').hidden = n !== 2;
    atualizarBotaoImportar();
  }

  function linhasValidas() {
    return Importar.aplicarMapeamento(imp.linhas, imp.mapa, imp.cabecalho).filter((i) => i.codigo);
  }

  function atualizarBotaoImportar() {
    const botao = $('#imp-confirmar');
    if (imp.passo === 1) {
      botao.textContent = 'Continuar';
      botao.disabled = imp.linhas.length === 0;
    } else {
      const n = linhasValidas().length;
      botao.textContent = `Importar ${n} linha${n === 1 ? '' : 's'}`;
      botao.disabled = n === 0;
    }
  }

  function definirLinhas(linhas) {
    imp.linhas = linhas;
    atualizarBotaoImportar();
  }

  $('#mat-importar').addEventListener('click', () => {
    imp.linhas = [];
    imp.xlsx = null;
    $('#imp-colar').value = '';
    $('#imp-planilha-rotulo').hidden = true;
    $('#form-importar').elements.modo.value = 'adicionar';
    passoImportacao(1);
    dlgImportar.showModal();
  });

  let atrasoColar;
  $('#imp-colar').addEventListener('input', (e) => {
    clearTimeout(atrasoColar);
    atrasoColar = setTimeout(() => {
      imp.xlsx = null;
      $('#imp-planilha-rotulo').hidden = true;
      definirLinhas(Importar.lerTexto(e.target.value));
    }, 150);
  });

  $('#imp-arquivo').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      $('#imp-colar').value = '';
      if (/\.xlsx$/i.test(arquivo.name)) {
        imp.xlsx = await Importar.lerXlsx(await arquivo.arrayBuffer());
        const select = $('#imp-planilha');
        select.innerHTML = imp.xlsx.planilhas.map((p, i) => `<option value="${i}">${esc(p.nome)}</option>`).join('');
        const entrada = imp.xlsx.planilhas.findIndex((p) => /entrada|dados|cadastro|lista/i.test(p.nome));
        select.value = String(Math.max(0, entrada));
        $('#imp-planilha-rotulo').hidden = imp.xlsx.planilhas.length < 2;
        await carregarPlanilha();
      } else {
        const bytes = await arquivo.arrayBuffer();
        let texto = new TextDecoder('utf-8').decode(bytes);
        // CSV salvo pelo Excel em português costuma vir em Windows-1252.
        if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(bytes);
        definirLinhas(Importar.lerTexto(texto.replace(/^﻿/, '')));
      }
      if (imp.linhas.length) $('#imp-confirmar').click();
      else aviso('Não encontrei dados nesse arquivo.', 'erro');
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });

  async function carregarPlanilha() {
    const planilha = imp.xlsx.planilhas[Number($('#imp-planilha').value)];
    definirLinhas(planilha ? await imp.xlsx.linhasDa(planilha) : []);
  }
  $('#imp-planilha').addEventListener('change', async () => {
    await carregarPlanilha();
    if (imp.passo === 2) prepararMapeamento();
  });

  function prepararMapeamento() {
    imp.cabecalho = Importar.pareceCabecalho(imp.linhas[0]);
    $('#imp-cabecalho').checked = imp.cabecalho;
    imp.mapa = Importar.sugerirMapeamento(imp.linhas, imp.cabecalho);
    renderMapeamento();
  }

  function renderMapeamento() {
    const largura = imp.linhas[0]?.length || 0;
    const opcoes = Array.from({ length: largura }, (_, i) => {
      const exemplo = imp.cabecalho ? imp.linhas[0][i] : imp.linhas.find((l) => l[i])?.[i];
      const rotulo = `Coluna ${Importar.nomeColuna(i)}${exemplo ? ` — ${exemplo.slice(0, 30)}` : ''}`;
      return `<option value="${i}">${esc(rotulo)}</option>`;
    }).join('');
    $('#imp-mapa').innerHTML = Importar.CAMPOS.map(
      (c) => `<label>${esc(c.nome)}${c.obrigatorio ? ' *' : ''}<select data-campo="${c.id}"><option value="-1">— não importar —</option>${opcoes}</select></label>`,
    ).join('');
    for (const select of $$('#imp-mapa select')) select.value = String(imp.mapa[select.dataset.campo] ?? -1);
    renderPreviaImportacao();
  }

  function renderPreviaImportacao() {
    const itens = Importar.aplicarMapeamento(imp.linhas, imp.mapa, imp.cabecalho).slice(0, 8);
    $('#imp-previa').innerHTML =
      `<thead><tr>${Importar.CAMPOS.map((c) => `<th>${esc(c.nome)}</th>`).join('')}</tr></thead>` +
      `<tbody>${itens.map((i) => `<tr>${Importar.CAMPOS.map((c) => (i[c.id] ? `<td>${esc(i[c.id])}</td>` : '<td class="faltando">—</td>')).join('')}</tr>`).join('')}</tbody>`;
    atualizarBotaoImportar();
  }

  $('#imp-mapa').addEventListener('change', (e) => {
    imp.mapa[e.target.dataset.campo] = Number(e.target.value);
    renderPreviaImportacao();
  });
  $('#imp-cabecalho').addEventListener('change', (e) => {
    imp.cabecalho = e.target.checked;
    renderMapeamento();
  });
  $('#imp-voltar').addEventListener('click', () => passoImportacao(1));

  $('#imp-confirmar').addEventListener('click', async (e) => {
    if (imp.passo === 1) {
      prepararMapeamento();
      return passoImportacao(2);
    }
    const itens = linhasValidas();
    const modo = $('#form-importar').elements.modo.value;
    if (modo === 'substituir' && !confirm(`Isto apaga os ${estado.itens.length} materiais atuais e deixa só os ${itens.length} da planilha. Continuar?`)) return;
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      const r = await api('POST', '/api/itens/importar', { modo, itens });
      dlgImportar.close();
      aviso(`Importação concluída: ${r.novos} novos, ${r.atualizados} atualizados${r.ignorados ? `, ${r.ignorados} sem código ignorados` : ''}.`, 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Aba Configurações
  // ---------------------------------------------------------------------------

  function renderConfig() {
    const c = estado.config;
    $('#cfg-google-status').innerHTML = c.buscaGoogle
      ? '<strong>Ativa.</strong> As fotos são buscadas no Google Imagens.'
      : '<strong>Sem chave do Google.</strong> Por enquanto as fotos vêm de bancos de fotos livres (Wikimedia Commons e Openverse), que têm menos peças. Para buscar no Google:';
    $('.passos').hidden = c.buscaGoogle;
    $('#cfg-logo-img').src = c.logo;
    $('#cfg-logo-padrao').hidden = !c.logoPersonalizado;

    $('#cfg-pin-status').textContent = c.temPin
      ? 'O cadastro está protegido. Qualquer pessoa pode ver e imprimir, mas só quem sabe o PIN altera materiais e fotos.'
      : 'Sem PIN: qualquer pessoa que acessar o site pode alterar o cadastro e as fotos. Recomendado definir um PIN.';
    $('#cfg-pin-remover').hidden = !c.temPin;
    $('#cfg-pin-form button.primario').textContent = c.temPin ? 'Trocar PIN' : 'Definir PIN';
  }

  $('#cfg-logo-arquivo').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      await api('PUT', '/api/logo', arquivo);
      aviso('Logo atualizado.', 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });
  $('#cfg-logo-padrao').addEventListener('click', async () => {
    try {
      await api('DELETE', '/api/logo');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });
  $('#cfg-pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const novo = $('#cfg-pin-novo').value.trim();
    if (novo.length < 4) return aviso('O PIN precisa ter pelo menos 4 caracteres.', 'erro');
    try {
      estado.config = await api('PUT', '/api/config/pin', { novo });
      gravarLocal('etiquetas.pin', novo);
      $('#cfg-pin-novo').value = '';
      aviso('PIN definido. Guarde-o em local seguro.', 'ok');
      renderConfig();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });
  $('#cfg-pin-remover').addEventListener('click', async () => {
    if (!confirm('Remover o PIN? Qualquer pessoa poderá alterar o cadastro.')) return;
    try {
      estado.config = await api('PUT', '/api/config/pin', { novo: '' });
      gravarLocal('etiquetas.pin', null);
      aviso('PIN removido.', 'ok');
      renderConfig();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  });

  // Botões "Cancelar" dos diálogos
  document.addEventListener('click', (e) => {
    const botao = e.target.closest('dialog [data-fechar]');
    if (botao) botao.closest('dialog').close('cancelar');
  });

  // ---------------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------------

  preencherLayout();
  mostrarAba(location.hash.slice(1));
  carregar().catch((err) => aviso(`Não foi possível carregar os dados: ${err.message}`, 'erro'));
})();
