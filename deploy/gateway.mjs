// The games' gateway on the gutsengine Droplet: nginx sends /play/* here. Each game is its own
// server.js (its own port, its own world); the gateway starts a game's server when someone opens
// it, passes its pages, files and socket through (the /play/<slug> prefix taken off), and stops it
// once nobody has been connected for IDLE minutes, so a small Droplet can host several games.
//
//   node gateway.mjs          (systemd: guts-gateway.service)
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import httpProxy from 'http-proxy';

const PORT = 9000, IDLE = 15 * 60 * 1000, ROOT = '/srv/games';
const GAMES = {
    age:       { title: 'Age of Defiance',    port: 4101, heap: 900 },
    kingdom:   { title: 'Kingdom of Defiance', port: 4102, heap: 900 },
    realm:     { title: 'Realm of Defiance',  port: 4103, heap: 700 },
    heroarena: { title: 'HeroArena',          port: 4104, heap: 600 },
    descent:   { title: 'Descent',            port: 4105, heap: 900 },
    wiki:      { title: 'GUTS Wiki',          port: 4106, heap: 256 }
};
const state = Object.fromEntries(Object.keys(GAMES).map(k => [k, { proc: null, ready: null, sockets: 0, last: 0 }]));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true, proxyTimeout: 0 });
proxy.on('error', (e, req, res) => { log('proxy error', req?.url, e.code || e.message); if (res?.writeHead && !res.headersSent) { res.writeHead(502); res.end('The game server did not answer. Try again in a moment.'); } else res?.destroy?.(); });

const up = (port) => new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });

/** The game's server, started if it isn't running; resolves once it accepts connections. */
function wake(slug) {
    const st = state[slug], g = GAMES[slug];
    if (st.ready) return st.ready;
    log('starting', slug);
    st.proc = spawn('node', [`--max-old-space-size=${g.heap}`, 'server.js', '--prod'], {
        cwd: `${ROOT}/${slug}`, env: { ...process.env, PORT: String(g.port), NODE_ENV: 'production' }, stdio: ['ignore', 'inherit', 'inherit']
    });
    st.proc.on('exit', (code, sig) => { log(slug, 'exited', code ?? sig); st.proc = null; st.ready = null; st.sockets = 0; });
    st.last = Date.now();
    st.ready = (async () => {
        for (let i = 0; i < 240; i++) { if (await up(g.port)) { log(slug, 'up'); return true; } if (!st.proc) break; await new Promise(r => setTimeout(r, 500)); }
        throw new Error(`${slug} did not start`);
    })();
    st.ready.catch(() => { st.ready = null; });
    return st.ready;
}

function stop(slug, why) {
    const st = state[slug];
    if (!st.proc) return;
    log('stopping', slug, why);
    st.proc.kill('SIGINT');                                    // the servers save their worlds on SIGINT
    const p = st.proc;
    setTimeout(() => { if (p.exitCode == null) p.kill('SIGKILL'); }, 20000);
}

// asleep: nobody connected and nothing asked of it for IDLE
setInterval(() => { for (const [slug, st] of Object.entries(state)) if (st.proc && st.sockets === 0 && Date.now() - st.last > IDLE) stop(slug, 'idle'); }, 60000);

const route = (url) => { const m = /^\/play\/([a-z0-9]+)(\/.*)?$/.exec(url.split('?')[0]); return m && GAMES[m[1]] ? { slug: m[1], rest: m[2] } : null; };
const strip = (url, slug) => url.slice(`/play/${slug}`.length) || '/';

const waking = (title) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<meta http-equiv="refresh" content="3"><body style="background:#0d0b09;color:#e8d9a8;font:18px Georgia,serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:28px;margin-bottom:12px">${title}</div>Waking the world&hellip; this takes a few seconds.</div>`;

const index = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Play</title>
<body style="background:#0d0b09;color:#e8d9a8;font:18px Georgia,serif;margin:0;padding:40px 16px"><div style="max-width:560px;margin:auto"><h1 style="font-weight:normal">Games</h1>
${Object.entries(GAMES).map(([k, g]) => `<p><a style="color:#f2c66d" href="/play/${k}/">${g.title}</a>${state[k].proc ? ' &middot; <span style="color:#8fbf6a">running</span>' : ''}</p>`).join('')}</div>`;

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.socket.remoteAddress?.endsWith('127.0.0.1') && /^\/_restart\/(\w+)$/.test(req.url)) {     // after a deploy (localhost only)
        const slug = req.url.split('/')[2]; if (GAMES[slug]) stop(slug, 'redeploy'); res.end('ok'); return;
    }
    if (req.url === '/play' || req.url === '/play/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(index()); return; }
    const r = route(req.url);
    if (!r) { res.writeHead(404); res.end('No such game.'); return; }
    if (r.rest == null) { res.writeHead(301, { location: `/play/${r.slug}/` }); res.end(); return; }      // the page's relative URLs need the slash
    const st = state[r.slug];
    st.last = Date.now();
    if (!st.proc || !(await up(GAMES[r.slug].port))) {
        const starting = wake(r.slug);
        if (/text\/html/.test(req.headers.accept || '')) { res.writeHead(503, { 'content-type': 'text/html', 'retry-after': '3' }); res.end(waking(GAMES[r.slug].title)); return; }
        try { await starting; } catch (e) { res.writeHead(503); res.end('Starting failed.'); return; }
    }
    req.url = strip(req.url, r.slug);
    proxy.web(req, res, { target: `http://127.0.0.1:${GAMES[r.slug].port}` });
});

server.on('upgrade', async (req, socket, head) => {
    const r = route(req.url);
    if (!r || r.rest == null) { socket.destroy(); return; }
    try { await wake(r.slug); } catch (e) { socket.destroy(); return; }
    state[r.slug].last = Date.now();
    req.url = strip(req.url, r.slug);
    proxy.ws(req, socket, head, { target: `http://127.0.0.1:${GAMES[r.slug].port}` }, () => {});
    state[r.slug].sockets++;                                   // a player connected: it stays awake while they are
    socket.once('close', () => { state[r.slug].sockets = Math.max(0, state[r.slug].sockets - 1); state[r.slug].last = Date.now(); });
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { for (const k of Object.keys(state)) stop(k, 'gateway stopping'); setTimeout(() => process.exit(0), 21000).unref(); server.close(); });
server.listen(PORT, '127.0.0.1', () => log(`gateway on :${PORT}`, Object.keys(GAMES).join(', ')));
