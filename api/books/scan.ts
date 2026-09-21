import { jsonResponse, toHttpError } from '../_lib/http.js';
import { scanBook } from '../_lib/scan.js';

/**
 * POST /api/books/scan
 * Corpo: { images: [{ data, mimeType, role: 'front' | 'back' }], isbnHint?: string }
 * Lê capa/contracapa com Gemini Vision e devolve { success, data, meta }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Corpo da requisição inválido (JSON esperado).' });
    }
    return jsonResponse(200, await scanBook(body));
  } catch (e) {
    const { status, message } = toHttpError(e);
    if (status >= 500) console.error('Erro na rota /api/books/scan:', e);
    return jsonResponse(status, { error: message });
  }
}
