import handler from '../server/handler.mjs';
export default async function endpoint(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${req.headers.host}${req.url}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const response = await handler(new Request(url, { method: req.method, headers: req.headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
