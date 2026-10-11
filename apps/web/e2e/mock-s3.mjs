/**
 * In-memory S3 stand-in for the e2e suite (path-style, no signature check): PUT / GET / HEAD of
 * `/{bucket}/{key}` plus CORS, enough for the presigned upload of `/api/files` and the server reads in
 * `lib/storage.ts`. Never used outside local tests.
 *
 *   node apps/web/e2e/mock-s3.mjs          # listens on 127.0.0.1:9339 (MOCK_S3_PORT)
 */
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_S3_PORT ?? 9339);
const store = new Map();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'ETag',
};

createServer((req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      store.set(key, { body, type: req.headers['content-type'] ?? 'application/octet-stream' });
      res.writeHead(200, { ...cors, ETag: `"${body.length}"` }).end();
    });
    return;
  }
  const o = store.get(key);
  if (!o) { res.writeHead(404, { ...cors, 'Content-Type': 'application/xml' }).end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>'); return; }
  res.writeHead(200, { ...cors, 'Content-Type': o.type, 'Content-Length': o.body.length, ETag: `"${o.body.length}"` });
  res.end(req.method === 'HEAD' ? undefined : o.body);
}).listen(port, '127.0.0.1', () => console.log(`mock S3 on http://127.0.0.1:${port}`));
