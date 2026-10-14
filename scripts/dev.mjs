import http from 'node:http';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { resolve } from 'node:path';
// Load Vercel-style server variables locally without ever exposing them to Vite.
if (process.loadEnvFile) { try { process.loadEnvFile('.env.local'); } catch { try { process.loadEnvFile('.env'); } catch { /* no env: preview works */ } } }
const { default: handler } = await import('../server/handler.mjs');
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) { res.writeHead(413); res.end('{"error":"Request too large"}'); return; } chunks.push(chunk); }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const response = await handler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Service unavailable"}'); }
});
server.listen(3001, '127.0.0.1');
const vite = await createServer(); await vite.listen(); vite.printUrls();
const stop = async () => { server.close(); await vite.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
