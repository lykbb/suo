import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function pdfAssets() {
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  let serving = false;
  const root = () => dirname(require.resolve('pdfjs-dist/package.json'));
  return {
    name: 'suo-local-pdf-assets',
    configureServer(server) {
      serving = true;
      server.middlewares.use('/pdf-assets/', async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        if (!/^(cmaps|standard_fonts|wasm)\/[a-zA-Z0-9._-]+$/.test(path)) { next(); return; }
        try {
          const bytes = await readFile(join(root(), path));
          res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          res.end(bytes);
        } catch { next(); }
      });
    },
    async buildStart() {
      if (serving) return;
      for (const folder of folders) {
        for (const name of await readdir(join(root(), folder))) {
          this.emitFile({ type: 'asset', fileName: `pdf-assets/${folder}/${name}`, source: await readFile(join(root(), folder, name)) });
        }
      }
    },
  };
}
