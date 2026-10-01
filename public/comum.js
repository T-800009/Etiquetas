// Funções usadas tanto no site principal quanto na página aberta pelo QR code.
'use strict';

const Comum = (() => {
  const CHAVE_PIN = 'etiquetas.pin';

  function lerLocal(chave, padrao) {
    try {
      const v = localStorage.getItem(chave);
      return v === null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  }

  function gravarLocal(chave, valor) {
    try {
      if (valor === undefined || valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* navegador sem armazenamento: segue sem lembrar */
    }
  }

  function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ---- Diálogo de PIN --------------------------------------------------------

  function pedirPin(mensagem) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialogo dialogo-pin';
      dlg.innerHTML = `
        <form method="dialog">
          <h2>PIN de edição</h2>
          <p>${esc(mensagem || 'Para alterar o cadastro, digite o PIN de edição.')}</p>
          <input name="pin" type="password" inputmode="numeric" autocomplete="off" required autofocus>
          <div class="dialogo-botoes">
            <button type="button" class="botao" data-fechar>Cancelar</button>
            <button value="ok" class="botao primario">Confirmar</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close('cancelar'));
      dlg.addEventListener('close', () => {
        const pin = dlg.returnValue === 'ok' ? dlg.querySelector('input').value : null;
        dlg.remove();
        resolve(pin);
      });
      dlg.showModal();
    });
  }

  // ---- Chamadas ao servidor ---------------------------------------------------

  class ErroApi extends Error {
    constructor(status, mensagem) {
      super(mensagem);
      this.status = status;
    }
  }

  async function api(metodo, url, corpo, { bruto = false, tentativa = 0 } = {}) {
    const headers = {};
    const pin = lerLocal(CHAVE_PIN, '');
    if (pin) headers['X-Pin'] = pin;
    let body;
    if (corpo instanceof Blob) {
      body = corpo;
      headers['Content-Type'] = corpo.type || 'application/octet-stream';
    } else if (corpo !== undefined) {
      body = JSON.stringify(corpo);
      headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(url, { method: metodo, headers, body });
    if (resp.status === 401 && tentativa < 3) {
      const novo = await pedirPin(tentativa ? 'PIN incorreto. Tente novamente.' : undefined);
      if (novo === null) throw new ErroApi(401, 'Operação cancelada.');
      gravarLocal(CHAVE_PIN, novo);
      return api(metodo, url, corpo, { bruto, tentativa: tentativa + 1 });
    }
    if (bruto) return resp;
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ErroApi(resp.status, dados.erro || `Erro ${resp.status}`);
    return dados;
  }

  // ---- Fotos --------------------------------------------------------------------

  // Reduz fotos do celular (que costumam ter 4000px e vários MB) antes de enviar.
  // O banco aceita até ~1,9 MB por foto; se passar, tenta de novo com menos qualidade.
  async function reduzirImagem(arquivo, maximo = 1280, qualidade = 0.82) {
    let blob = await converterImagem(arquivo, maximo, qualidade);
    for (let i = 0; blob.size > 1.5 * 1024 * 1024 && i < 3; i++) {
      maximo = Math.round(maximo * 0.75);
      blob = await converterImagem(arquivo, maximo, qualidade);
    }
    return blob;
  }

  async function converterImagem(arquivo, maximo, qualidade) {
    let fonte;
    try {
      fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    } catch {
      fonte = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'));
        img.src = URL.createObjectURL(arquivo);
      });
    }
    const largura = fonte.width || fonte.naturalWidth;
    const altura = fonte.height || fonte.naturalHeight;
    const escala = Math.min(1, maximo / Math.max(largura, altura));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round(altura * escala);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
    if (fonte.close) fonte.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao converter a imagem.'))), 'image/jpeg', qualidade);
    });
  }

  function urlFoto(foto) {
    return foto ? `/fotos/${encodeURIComponent(foto.arquivo)}` : '';
  }

  // ---- QR code ------------------------------------------------------------------

  function urlMaterial(base, codigo) {
    const raiz = (base || location.origin).replace(/\/+$/, '');
    return `${raiz}/m/${encodeURIComponent(codigo)}`;
  }

  // Gera o QR code como SVG (fica nítido em qualquer tamanho de impressão).
  function qrSvg(texto, { margem = 0, cor = '#000' } = {}) {
    const qr = qrcode(0, 'M');
    qr.addData(texto, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    // Junta módulos escuros vizinhos na mesma linha para deixar o SVG menor.
    let caminho = '';
    for (let l = 0; l < n; l++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(l, c)) continue;
        let fim = c;
        while (fim + 1 < n && qr.isDark(l, fim + 1)) fim++;
        const largura = fim - c + 1;
        caminho += `M${c + margem} ${l + margem}h${largura}v1h-${largura}z`;
        c = fim;
      }
    }
    const tam = n + margem * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tam} ${tam}" shape-rendering="crispEdges"><rect width="${tam}" height="${tam}" fill="#fff"/><path d="${caminho}" fill="${cor}"/></svg>`;
  }

  function ehEnderecoLocal(url) {
    try {
      const host = new URL(url).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }

  function aviso(mensagem, tipo = 'info') {
    let area = document.querySelector('.avisos');
    if (!area) {
      area = document.createElement('div');
      area.className = 'avisos';
      area.setAttribute('role', 'status');
      document.body.appendChild(area);
    }
    const el = document.createElement('div');
    el.className = `aviso aviso-${tipo}`;
    el.textContent = mensagem;
    area.appendChild(el);
    setTimeout(() => el.classList.add('saindo'), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  if (window.qrcode) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  return { api, ErroApi, esc, lerLocal, gravarLocal, pedirPin, reduzirImagem, urlFoto, urlMaterial, qrSvg, ehEnderecoLocal, aviso };
})();
