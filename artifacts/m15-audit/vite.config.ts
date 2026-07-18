import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(async ({ command }) => {
  // PORT n'est requis qu'en mode dev (vite dev). Pendant le build (vite build)
  // — typiquement sur Vercel — cette variable n'est pas définie et ce n'est
  // pas un problème car le serveur de développement ne démarre pas.
  let port = 3000;
  if (command === 'serve') {
    const rawPort = process.env.PORT;
    if (!rawPort) {
      throw new Error('PORT environment variable is required for dev server.');
    }
    const parsed = Number(rawPort);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid PORT value: "${rawPort}"`);
    }
    port = parsed;
  }

  // BASE_PATH est Replit-spécifique (routing multi-artefacts).
  // Sur Vercel l'app est servie à la racine, donc on se rabat sur '/'.
  const basePath = process.env.BASE_PATH ?? '/';

  // Plugins Replit uniquement en dev sur Replit (REPL_ID présent).
  const replitPlugins =
    command === 'serve' && process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-runtime-error-modal').then((m) =>
            m.default(),
          ),
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : [];

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), ...replitPlugins],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        // attached_assets est à la racine du monorepo ; le chemin relatif
        // fonctionne aussi bien sur Replit que lors du build Vercel.
        '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: { strict: true },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
