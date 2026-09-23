import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_SCAN_MODELS, getGeminiApiKey, modelsFromEnv } from './api/_lib/gemini.js';
import { toHttpError } from './api/_lib/http.js';
import { enrichBookWithAI, lookupBookByIsbn } from './api/_lib/lookup.js';
import { scanBook } from './api/_lib/scan.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Suporte a payloads JSON maiores para envio de fotos da capa/contracapa em base64
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Headers CORS para suportar chamadas no preview do AI Studio e iframes
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // As rotas de API compartilham a mesma lógica das funções serverless da Vercel (pasta /api),
  // então o comportamento é idêntico no AI Studio / servidor Node e no deploy da Vercel.

  // API de Verificação de Saúde
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      hasGeminiKey: !!getGeminiApiKey(),
      scanModels: modelsFromEnv('GEMINI_SCAN_MODELS', DEFAULT_SCAN_MODELS)
    });
  });

  // Rota de Consulta Rápida de ISBN (Brasil API / CBL + Google Books + OpenLibrary + IA)
  app.get('/api/books/isbn/:isbn', async (req, res) => {
    try {
      const data = await lookupBookByIsbn(req.params.isbn);
      return res.json({ success: true, data });
    } catch (err) {
      const { status, message } = toHttpError(err);
      if (status >= 500) console.error('Erro na rota /api/books/isbn:', err);
      return res.status(status).json({ error: message });
    }
  });

  // API de Enriquecimento de Metadados de Obras com Gemini
  app.post('/api/books/enrich', async (req, res) => {
    try {
      const data = await enrichBookWithAI(req.body || {});
      return res.json({ success: true, data });
    } catch (err) {
      const { status, message } = toHttpError(err);
      if (status >= 500) console.error('Erro na rota /api/books/enrich:', err);
      return res.status(status).json({ error: message });
    }
  });

  // API de Leitura Inteligente de Capa & Contracapa de Livros com Gemini Vision
  app.post('/api/books/scan', async (req, res) => {
    try {
      return res.json(await scanBook(req.body));
    } catch (err) {
      const { status, message } = toHttpError(err);
      if (status >= 500) console.error('Erro na rota /api/books/scan:', err);
      return res.status(status).json({ error: message });
    }
  });

  // Configuração do Vite middleware em desenvolvimento e arquivos estáticos em produção
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Diário de Classe rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer();
