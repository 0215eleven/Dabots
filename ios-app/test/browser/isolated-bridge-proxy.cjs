// Test only: fixed disposable loopback target, exact browser origin. No auth bypass,
// arbitrary forwarding, TLS exception, or changes to the shipped Bridge server.
const http = require('node:http');
exports.startProxy = async function startProxy(bridgeUrl, appOrigin) {
  const target = new URL(bridgeUrl), origin = new URL(appOrigin).origin;
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' || target.username || target.password) throw Error('Only an isolated loopback fixture is supported');
  const sockets = new Set(), controls = { loseNext: null, loseText: null, denyNext: null, writes: [], drops: [], dropped: 0, upgrades: 0 };
  const destination = req => {
    if (req.headers.origin && req.headers.origin !== origin) return null;
    // Validate what will actually be forwarded after URL dot-segment normalization.
    // Checking the raw prefix alone permits /mobile/v1/../../outside (also %2e).
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return null;
    try {
      const url = new URL(req.url, target);
      return url.origin === target.origin && url.pathname.startsWith('/mobile/v1/') ? url : null;
    } catch { return null; }
  };
  const server = http.createServer((req, res) => {
    const url = destination(req);
    if (!url) return res.writeHead(403).end();
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
      let mutation;
      if (req.method === 'POST' && /\/(actions|submissions)(\/|$)/.test(url.pathname)) { mutation = JSON.parse(body); controls.writes.push({path:url.pathname, body:mutation}); }
      if (controls.denyNext && req.url.includes(controls.denyNext)) { controls.denyNext = null; res.writeHead(403, {'content-type':'application/json'}).end(JSON.stringify({error:{code:'FORBIDDEN',message:'Controlled isolated owner denial'}})); return; }
      const upstream = http.request(url, { method: req.method, headers }, reply => {
        const lose = controls.loseNext === '/mobile/v1/submissions' && req.method === 'POST'
          && url.pathname === '/mobile/v1/submissions' && typeof mutation?.requestId === 'string'
          && reply.statusCode >= 200 && reply.statusCode < 300 && (!controls.loseText || mutation.text === controls.loseText);
        if (lose) {
          controls.loseNext = null; controls.loseText = null;
          // A bare reset before any headers lets Chromium transparently resend a
          // POST. Deliver only its successful status and an incomplete JSON prefix,
          // then cut the acknowledgement body so the app must reconcile by receipt.
          res.writeHead(reply.statusCode, {'content-type':'application/json', 'content-length':'2'});
          res.write('{');
          reply.resume(); reply.on('end', () => {
            controls.dropped++;
            controls.drops.push({method:req.method, path:url.pathname, requestId:mutation.requestId, status:reply.statusCode});
            setImmediate(() => res.destroy());
          });
          return;
        }
        res.writeHead(reply.statusCode, {...reply.headers, 'access-control-allow-origin':origin}); reply.pipe(res);
      });
      upstream.on('error', () => res.destroy()); upstream.end(body);
    });
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const streams = new Set();
  server.on('upgrade', (req, socket, head) => {
    const url = destination(req);
    if (!url || req.headers.origin !== origin) return socket.destroy();
    const headers = {...req.headers, host:target.host}; delete headers.origin;
    const upstream = http.request(url, { headers });
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
