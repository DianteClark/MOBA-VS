// MOBA-VS online API (Cloudflare Worker). Static files are served from assets before this runs;
// only unmatched routes (e.g. /api/*) reach here.
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return json({ ok: true, db: !!env.DB, time: Date.now() });
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
