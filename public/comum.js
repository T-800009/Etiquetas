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

  async function api(metodo, url, corpo, { bruto = false, tentativa = 0, extras = {} } = {}) {
    const headers = { ...extras };
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
      return api(metodo, url, corpo, { bruto, tentativa: tentativa + 1, extras });
    }
    if (bruto) {
      if (!resp.ok) throw new ErroApi(resp.status, (await resp.json().catch(() => ({}))).erro || `Erro ${resp.status}`);
      return resp;
    }
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

  async function abrirImagem(arquivo) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    } catch {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'));
        img.src = URL.createObjectURL(arquivo);
      });
    }
  }

  // Tira o fundo liso (branco, cinza ou de uma cor só) das fotos de produto da
  // internet: parte das bordas da imagem e apaga os pixels parecidos com o fundo.
  // Fundos complicados (cenários, mesas) não são mexidos. Devolve PNG transparente
  // recortado no tamanho do objeto, para ele ocupar todo o espaço da etiqueta.
  async function removerFundo(arquivo, maximo = 800) {
    const fonte = await abrirImagem(arquivo);
    const largura0 = fonte.width || fonte.naturalWidth;
    const altura0 = fonte.height || fonte.naturalHeight;
    const escala = Math.min(1, maximo / Math.max(largura0, altura0));
    const w = Math.max(1, Math.round(largura0 * escala));
    const h = Math.max(1, Math.round(altura0 * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fonte, 0, 0, w, h);
    if (fonte.close) fonte.close();
    const imagem = ctx.getImageData(0, 0, w, h);
    const px = imagem.data;
    const total = w * h;

    // Cor do fundo = mediana das bordas.
    const borda = [];
    for (let x = 0; x < w; x++) borda.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) borda.push(y * w, y * w + w - 1);
    const opacos = borda.filter((i) => px[i * 4 + 3] > 200);
    const mediana = (c) => {
      const v = opacos.map((i) => px[i * 4 + c]).sort((a, b) => a - b);
      return v[v.length >> 1] ?? 255;
    };
    const fundo = [mediana(0), mediana(1), mediana(2)];
    const TOL = 42 * 42;
    const distancia = (i) => {
      const dr = px[i * 4] - fundo[0];
      const dg = px[i * 4 + 1] - fundo[1];
      const db = px[i * 4 + 2] - fundo[2];
      return dr * dr + dg * dg + db * db;
    };
    const ehFundo = (i) => px[i * 4 + 3] < 20 || distancia(i) <= TOL;
    const bordaLisa = borda.filter(ehFundo).length / borda.length;

    let removido = false;
    if (bordaLisa >= 0.6) {
      // Inundação a partir das bordas.
      const marcado = new Uint8Array(total);
      const fila = new Int32Array(total);
      let ini = 0;
      let fim = 0;
      for (const i of borda) {
        if (!marcado[i] && ehFundo(i)) {
          marcado[i] = 1;
          fila[fim++] = i;
        }
      }
      while (ini < fim) {
        const i = fila[ini++];
        const x = i % w;
        const vizinhos = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < total - w ? i + w : -1];
        for (const v of vizinhos) {
          if (v >= 0 && !marcado[v] && ehFundo(v)) {
            marcado[v] = 1;
            fila[fim++] = v;
          }
        }
      }
      // Só aceita se sobrou um objeto de tamanho razoável.
      if (fim < total * 0.97) {
        removido = true;
        for (let i = 0; i < total; i++) {
          if (marcado[i]) {
            px[i * 4 + 3] = 0;
            continue;
          }
          // Suaviza a borda do objeto (pixels quase da cor do fundo ficam semitransparentes).
          const x = i % w;
          const encostaNoFundo = (x > 0 && marcado[i - 1]) || (x < w - 1 && marcado[i + 1]) || (i >= w && marcado[i - w]) || (i < total - w && marcado[i + w]);
          if (encostaNoFundo) {
            const d = Math.sqrt(distancia(i));
            const a = Math.min(1, Math.max(0.25, (d - 42) / 40));
            px[i * 4 + 3] = Math.round(px[i * 4 + 3] * a);
          }
        }
        ctx.putImageData(imagem, 0, 0);
      }
    }

    // Recorta no tamanho do objeto (com uma pequena margem).
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    let saida = canvas;
    if (x1 >= x0 && y1 >= y0) {
      const margem = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
      x0 = Math.max(0, x0 - margem);
      y0 = Math.max(0, y0 - margem);
      x1 = Math.min(w - 1, x1 + margem);
      y1 = Math.min(h - 1, y1 + margem);
      saida = document.createElement('canvas');
      saida.width = x1 - x0 + 1;
      saida.height = y1 - y0 + 1;
      saida.getContext('2d').drawImage(canvas, x0, y0, saida.width, saida.height, 0, 0, saida.width, saida.height);
    }
    const blob = await new Promise((resolve, reject) =>
      saida.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao converter a imagem.'))), removido ? 'image/png' : 'image/jpeg', 0.88),
    );
    if (blob.size > 1.5 * 1024 * 1024 && maximo > 400) return removerFundo(arquivo, Math.round(maximo * 0.7));
    return { blob, removido };
  }

  function urlFoto(foto) {
    return foto ? `/fotos/${encodeURIComponent(foto.arquivo)}` : '';
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

  return { api, ErroApi, esc, lerLocal, gravarLocal, pedirPin, reduzirImagem, removerFundo, urlFoto, aviso };
})();
