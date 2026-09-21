import { DEFAULT_SCAN_MODELS, getGeminiApiKey, modelsFromEnv } from './_lib/gemini.js';
import { jsonResponse } from './_lib/http.js';

/** GET /api/health — verificação rápida do deploy e da configuração da chave de IA. */
export function GET(): Response {
  return jsonResponse(200, {
    status: 'ok',
    hasGeminiKey: !!getGeminiApiKey(),
    scanModels: modelsFromEnv('GEMINI_SCAN_MODELS', DEFAULT_SCAN_MODELS)
  });
}
