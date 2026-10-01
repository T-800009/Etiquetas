// Substitui a IA da Cloudflare nos testes (a de verdade só funciona dentro da conta).
import { WorkerEntrypoint } from 'cloudflare:workers';

// JPEG mínimo, só para passar na checagem de tipo de imagem.
const JPEG_BASE64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9));

export class IaFalsa extends WorkerEntrypoint {
  async run(modelo, entrada) {
    if (modelo.includes('m2m100')) return { translated_text: `EN(${entrada.text})` };
    if (modelo.includes('flux')) {
      if (entrada.prompt.includes('ESGOTADO')) throw new Error('3036: Account limited: daily free allocation of 10,000 neurons exceeded');
      return { image: JPEG_BASE64 };
    }
    throw new Error(`modelo inesperado: ${modelo}`);
  }
}

export default { fetch: () => new Response('ia falsa') };
