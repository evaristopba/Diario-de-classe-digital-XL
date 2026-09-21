import { jsonResponse, toHttpError } from '../../_lib/http.js';
import { lookupBookByIsbn } from '../../_lib/lookup.js';

/** GET /api/books/isbn/:isbn — consulta Brasil API (CBL), Google Books e OpenLibrary. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { pathname } = new URL(request.url);
    const isbn = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    const data = await lookupBookByIsbn(isbn);
    return jsonResponse(200, { success: true, data });
  } catch (e) {
    const { status, message } = toHttpError(e);
    if (status >= 500) console.error('Erro na rota /api/books/isbn:', e);
    return jsonResponse(status, { error: message });
  }
}
