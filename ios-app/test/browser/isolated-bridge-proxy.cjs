// Test only: fixed disposable loopback target, exact browser origin. No auth bypass,
// arbitrary forwarding, TLS exception, or changes to the shipped Bridge server.
const http = require('node:http');
exports.startProxy = async function startProxy(bridgeUrl, appOrigin) {
  const target = new URL(bridgeUrl), origin = new URL(appOrigin).origin;
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' || target.username || target.password) throw Error('Only an isolated loopback fixture is supported');
  const sockets = new Set(), controls = { loseNext: null, denyNext: null, writes: [], dropped: 0, upgrades: 0 };
  const allowed = req => (!req.headers.origin || req.headers.origin === origin) && req.url.startsWith('/mobile/v1/');
  const server = http.createServer((req, res) => {
    if (!allowed(req)) return res.writeHead(403).end();
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization,content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const headers = { ...req.headers, host: target.host }; delete headers.origin;
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      // Hold only noncredential mutation bodies, never auth/pairing headers or payloads.
      if (req.method === 'POST' && /\/(actions|submissions)(\/|$)/.test(req.url)) controls.writes.push({path:req.url, body:JSON.parse(body)});
      if (controls.denyNext && req.url.includes(controls.denyNext)) { controls.denyNext = null; res.writeHead(403, {'content-type':'application/json'}).end(JSON.stringify({error:{code:'FORBIDDEN',message:'Controlled isolated owner denial'}})); return; }
      const lose = controls.loseNext && req.url.includes(controls.loseNext);
      if (lose) controls.loseNext = null;
      const upstream = http.request(new URL(req.url, target), { method: req.method, headers }, reply => {
        if (lose) { reply.resume(); reply.on('end', () => { controls.dropped++; res.destroy(); }); return; }
        res.writeHead(reply.statusCode, {...reply.headers, 'access-control-allow-origin':origin}); reply.pipe(res);
      });
      upstream.on('error', () => res.destroy()); upstream.end(body);
    });
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const streams = new Set();
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req) || req.headers.origin !== origin) return socket.destroy();
    const headers = {...req.headers, host:target.host}; delete headers.origin;
    const upstream = http.request(new URL(req.url, target), { headers });
    upstream.on('upgrade', (reply, peer, pending) => {
      controls.upgrades++; streams.add(socket);
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(reply.headers).map(([k,v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
      if(head.length) peer.write(head); if(pending.length) socket.write(pending);
      peer.pipe(socket).pipe(peer); socket.on('close', () => {streams.delete(socket);peer.destroy();}); peer.on('error',()=>socket.destroy()); socket.on('error',()=>peer.destroy());
    });
    upstream.on('error',()=>socket.destroy()); upstream.on('response',()=>socket.destroy()); upstream.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url:`http://127.0.0.1:${server.address().port}`, controls, disconnect(){for(const socket of streams) socket.destroy();}, async close(){for(const socket of sockets) socket.destroy(); await new Promise(resolve=>server.close(resolve));} };
};
