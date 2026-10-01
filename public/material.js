// Página aberta pelo QR code da etiqueta: /m/<código do material>
'use strict';

(() => {
  const { api, esc, urlFoto, reduzirImagem, aviso } = Comum;
  const conteudo = document.getElementById('m-conteudo');
  const codigo = decodeURIComponent(location.pathname.replace(/^\/m\//, '').replace(/\/+$/, ''));

  function campo(rotulo, valor) {
    return valor ? `<div><dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd></div>` : '';
  }

  function render(dados) {
    const itens = dados.itens || [];
    const base = itens[0] || {};
    document.title = `${dados.codigo} — ${base.descricao || 'Material'}`;
    const foto = urlFoto(dados.foto);
    const unicos = (campo) => [...new Set(itens.map((i) => i[campo]).filter(Boolean))].join(' · ');
    const locais = itens.filter((i) => i.endereco || i.projeto);

    conteudo.innerHTML = `
      ${
        foto
          ? `<figure class="m-foto"><a href="${esc(foto)}" target="_blank" rel="noopener" title="Abrir foto em tamanho real"><img src="${esc(foto)}" alt="Foto do material ${esc(dados.codigo)}"></a></figure>`
          : `<figure class="m-foto sem"><div class="grande" aria-hidden="true">📷</div><strong>Este material ainda não tem foto</strong><span>Use o botão abaixo para fotografar.</span></figure>`
      }
      <div>
        <h1 class="m-codigo">${esc(dados.codigo)}</h1>
        ${base.descricao ? `<p class="m-desc">${esc(base.descricao)}</p>` : ''}
      </div>
      ${
        itens.length
          ? `<dl class="m-dados">${campo('Referência', unicos('referencia'))}${campo('BOM', unicos('bom'))}${campo('Projeto / linha', unicos('projeto'))}</dl>`
          : ''
      }
      ${
        locais.length
          ? `<section class="m-locais"><h2>Onde fica</h2><ul>${locais
              .map((i) => `<li>${esc(i.endereco || '—')}${i.projeto ? `<span>${esc(i.projeto)}</span>` : ''}</li>`)
              .join('')}</ul></section>`
          : ''
      }
      <div class="m-acoes">
        <button class="botao ${foto ? '' : 'primario'}" id="m-tirar">${foto ? 'Tirar nova foto' : 'Tirar foto do material'}</button>
        <button class="botao" id="m-escolher">Escolher da galeria</button>
      </div>
      ${dados.foto ? `<p class="m-rodape">${dados.foto.credito ? `Foto: ${esc(dados.foto.credito)}` : `Foto atualizada em ${new Date(dados.foto.atualizadoEm).toLocaleString('pt-BR')}`}</p>` : ''}`;

    document.getElementById('m-tirar').addEventListener('click', () => document.getElementById('m-camera').click());
    document.getElementById('m-escolher').addEventListener('click', () => document.getElementById('m-galeria').click());
  }

  function renderErro(titulo, texto) {
    document.title = titulo;
    conteudo.innerHTML = `<div class="m-erro"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><p><a href="/">Ir para o site de etiquetas</a></p></div>`;
  }

  async function carregar() {
    if (!codigo) return renderErro('Código não informado', 'O QR code não contém o código do material.');
    try {
      render(await api('GET', `/api/material/${encodeURIComponent(codigo)}`));
    } catch (err) {
      if (err.status === 404) renderErro(`Material ${codigo}`, 'Este código não está cadastrado no site de etiquetas.');
      else renderErro('Sem conexão', `Não foi possível carregar o material (${err.message}).`);
    }
  }

  async function enviar(e) {
    const arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    conteudo.classList.add('carregando');
    try {
      const blob = await reduzirImagem(arquivo);
      await api('PUT', `/api/fotos/${encodeURIComponent(codigo)}`, blob);
      aviso('Foto salva!', 'ok');
      await carregar();
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      conteudo.classList.remove('carregando');
    }
  }

  document.getElementById('m-camera').addEventListener('change', enviar);
  document.getElementById('m-galeria').addEventListener('change', enviar);
  carregar();
})();
