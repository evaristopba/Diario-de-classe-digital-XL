import type { Request, Response } from 'express';
import { toHttpError } from '../_lib/http.js';
import { enrichBookWithAI } from '../_lib/lookup.js';

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  try {
    const data = await enrichBookWithAI(req.body || {});
    return res.json({ success: true, data });
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('Erro na rota /api/books/enrich:', err);
    return res.status(status).json({ error: message });
  }
}
