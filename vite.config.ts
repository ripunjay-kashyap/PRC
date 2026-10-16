import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only: serve /api/chat from api/chat.ts so `npm run dev` works without `vercel dev`. */
function devChatApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-chat-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/chat.ts');
        const out = await mod.handleChat(Buffer.concat(chunks).toString('utf8'), {
          GEMINI_API_KEY: env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY,
          GEMINI_MODEL: env.GEMINI_MODEL ?? process.env.GEMINI_MODEL,
        });
        res.statusCode = req.method === 'POST' ? out.status : 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.method === 'POST' ? out.body : { error: 'Method not allowed. Use POST.' }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), devChatApi(env)],
    worker: { format: 'es' },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: { output: { manualChunks: { recharts: ['recharts'] } } },
    },
  };
});
