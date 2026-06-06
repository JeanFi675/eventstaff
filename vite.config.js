import { defineConfig, loadEnv } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Charge .env / .env.local / .env.[mode] (même résolution que l'app Vite).
  const env = loadEnv(mode, process.cwd(), '');

  // Origines Supabase injectées dans le `connect-src` de la CSP au moment du build
  // (cf. docs/deployment.md §En-têtes de sécurité). Rend la CSP portable : elle suit
  // VITE_SUPABASE_URL au lieu d'une URL en dur. La variante WebSocket (Realtime) est
  // dérivée : https→wss, http→ws. Injecté en EJS via `<%- cspConnectSrc %>`.
  const supabaseUrl = env.VITE_SUPABASE_URL || '';
  const supabaseWs = supabaseUrl.replace(/^http/, 'ws');
  const cspConnectSrc = [supabaseUrl, supabaseWs].filter(Boolean).join(' ');

  // Données EJS communes à toutes les pages (titre injecté par page).
  const page = (entry, filename, title) => ({
    entry,
    filename,
    template: filename,
    injectOptions: {
      data: { title, cspConnectSrc },
      ejsOptions: { root: resolve(__dirname) },
    },
  });

  return {
    base: './', // Ensures relative paths for GitHub Pages
    plugins: [
      createHtmlPlugin({
        minify: true,
        pages: [
          page('src/js/main.js', 'index.html', 'Appel aux Bénévoles'),
          page('src/js/admin.js', 'admin.html', 'Administration'),
          page('src/js/debit.js', 'debit.html', 'Paiement'),
          page('src/js/scanner-tshirt.js', 'scanner-tshirt.html', 'Scanner T-Shirt'),
          page(
            'src/js/admin-connexions.js',
            'admin-connexions.html',
            'Diagnostic Connexions'
          ),
          page('src/js/besoins.js', 'besoins.html', 'Besoins Bénévoles'),
        ],
      }),
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      minify: 'esbuild',
      sourcemap: 'hidden',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          debit: resolve(__dirname, 'debit.html'),
          scanner: resolve(__dirname, 'scanner-tshirt.html'),
          'admin-connexions': resolve(__dirname, 'admin-connexions.html'),
          besoins: resolve(__dirname, 'besoins.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('alpinejs')) return 'vendor-alpine';
              if (id.includes('qrcode')) return 'vendor-qrcode';
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
