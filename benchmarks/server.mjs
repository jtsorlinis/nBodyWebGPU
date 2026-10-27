import { createServer } from 'vite';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const results = new URL('./results/', import.meta.url);
await mkdir(results, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  plugins: [{
    name: 'benchmark-results',
    configureServer(server) {
      server.middlewares.use('/__bench', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const data = Buffer.concat(chunks);
        if (req.url.startsWith('/image/')) {
          const name = req.url.slice('/image/'.length);
          if (!/^[a-z0-9-]+\.png$/.test(name)) { res.statusCode = 400; res.end(); return; }
          await writeFile(new URL(name, results), data);
        } else {
          const row = JSON.parse(data.toString());
          await appendFile(new URL('runs.jsonl', results), JSON.stringify(row) + '\n');
          console.log(JSON.stringify(row));
        }
        res.end('ok');
      });
    },
  }],
});
await server.listen();
server.printUrls();
