export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/health') {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
      const body = JSON.stringify({ ok: true, name: 'T800 HACK', runtime: 'Cloudflare Worker', aiProvider: 'Puter', version: '2.0.0' });
      return new Response(request.method === 'HEAD' ? null : body, { headers });
    }
    if (path.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
