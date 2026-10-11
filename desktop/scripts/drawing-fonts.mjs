import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function drawingAssets() {
  let serving = false;
  const root = () => dirname(require.resolve('@excalidraw/excalidraw'));
  async function files(folder, prefix = '') {
    const result = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await files(join(folder, entry.name), relative + '/'));
      else if (entry.isFile()) result.push(relative);
    }
    return result;
  }
  return {
    name: 'suo-local-drawing-assets',
    configureServer(server) {
      serving = true;
      server.middlewares.use('/drawing-assets/', async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        if (!/^fonts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:woff2?|ttf)$/.test(name)) { next(); return; }
        try {
          const bytes = await readFile(join(root(), name));
          res.setHeader('Content-Type', name.endsWith('woff2') ? 'font/woff2' : name.endsWith('woff') ? 'font/woff' : 'font/ttf');
          res.setHeader('Cache-Control', 'public, max-age=3600'); res.end(bytes);
        } catch { next(); }
      });
    },
    async buildStart() {
      if (serving) return;
      for (const name of await files(join(root(), 'fonts'), 'fonts/')) {
        this.emitFile({ type: 'asset', fileName: 'drawing-assets/' + name, source: await readFile(join(root(), name)) });
      }
    },
  };
}
