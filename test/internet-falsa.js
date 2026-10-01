// Simula, nos testes, a IA de tradução da Cloudflare e os sites de fotos
// (Wikimedia Commons e Openverse), que só existem fora do ambiente de teste.
import { WorkerEntrypoint } from 'cloudflare:workers';

// JPEG mínimo, só para passar na checagem de tipo de imagem.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

export class IaFalsa extends WorkerEntrypoint {
  async run(modelo, entrada) {
    if (modelo.includes('m2m100')) return { translated_text: entrada.text === 'Arruela lisa M6' ? 'Flat washer M6' : entrada.text };
    throw new Error(`modelo inesperado: ${modelo}`);
  }
}

function commons(termo) {
  if (!termo.toLowerCase().startsWith('flat washer')) return { batchcomplete: '' };
  return {
    query: {
      pages: {
        11: {
          title: 'File:Washer B.jpg',
          index: 2,
          imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/washer-b.jpg', mime: 'image/jpeg', extmetadata: {} }],
        },
        10: {
          title: 'File:Flat washer.jpg',
          index: 1,
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/thumb/washer-a.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Flat_washer.jpg',
              mime: 'image/jpeg',
              extmetadata: { Artist: { value: '<a href="x">Fulano</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
            },
          ],
        },
      },
    },
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === 'commons.wikimedia.org') {
      const termo = url.searchParams.get('gsrsearch').replace(' filetype:bitmap', '');
      return Response.json(commons(termo));
    }
    if (url.hostname === 'api.openverse.org' && url.pathname === '/v1/images/') {
      const termo = url.searchParams.get('q');
      const results = termo.toLowerCase().startsWith('flat washer')
        ? [{ title: 'Washer', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', creator: 'Beltrano', source: 'flickr', license: 'by', license_version: '2.0' }]
        : [];
      return Response.json({ results });
    }
    if (url.hostname === 'upload.wikimedia.org' || url.pathname.endsWith('/thumb/')) return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response('não encontrado', { status: 404 });
  },
};
