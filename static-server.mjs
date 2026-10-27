// Servidor estático do CRM-Hermes (substitui `npx serve -s dist`).
//
// MOTIVO (27/10/2026): o `serve` nao permitia controlar o Cache-Control, e
// o `index.html` saia sem `no-cache`. Resultado: um browser que tinha o
// index.html antigo em cache continuava a pedir o bundle ANTIGO (que ja nao
// existia em dist/) — o `serve` respondia 404 e, por ser SPA (-s), devolvia
// o index.html em vez de JavaScript. O browser tentava parsear HTML como JS
// e a aplicacao ficava em branco (0 cards, 0 mensagens, sem tenants).
//
// Aqui:
//   * index.html (e qualquer rota da SPA) -> no-store, SEMPRE revalidado
//   * /assets/* (nome com hash de conteudo) -> immutable, 1 ano
//   * ficheiros nao hasheados -> sem cache
// Assim, um deploy novo é sempre visto imediatamente, e os bundles
// continues a ser servidos do cache do browser.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3007);

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');

const NO_CACHE = 'no-cache, no-store, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Assets com hash de conteudo: imutaveis, 1 ano no cache.
app.use(
  '/assets',
  express.static(path.join(DIST, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  })
);

// Ficheiros nao hasheados (ex.: esvc-logo.svg): revalidacao curta.
app.use(
  express.static(DIST, {
    index: false,
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', NO_CACHE),
  })
);

// REDE DE SEGURANCA: um browser com o index.html antigo em cache vai pedir o
// bundle antigo (que ja nao existe). Em vez de devolver HTML com um
// Content-Type de JavaScript (o que rebenta a app com "Unexpected token '<'"),
// respondemos 410 com um script que forca a recarga. Como o index.html e
// servido com no-store, a recarga traz a versao nova.
app.get(/^\/assets\/.*\.(js|css|mjs|woff2?|map)$/, (_req, res) => {
  res.setHeader('Cache-Control', NO_CACHE);
  res.status(410).type('application/javascript').send(
    '/* bundle antigo */location.reload(true);'
  );
});

// Rotas da SPA + index.html: NUNCA em cache.
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', NO_CACHE);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[crm-frontend] a servir ${DIST} na porta ${PORT}`);
});
