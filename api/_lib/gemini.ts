/**
 * Camada fina sobre o SDK @google/genai:
 *  - escolha da chave de API;
 *  - cadeia de modelos com fallback (indisponibilidade, cota, modelo inexistente);
 *  - classificação de erros, retentativas e orçamento de tempo (as funções da Vercel têm limite de duração);
 *  - extração tolerante de JSON da resposta.
 *
 * Observações sobre a família Gemini 3.x (documentação oficial do Google):
 *  - NÃO ajustar temperature/top_p/top_k: o padrão (1.0) é o recomendado; valores baixos
 *    (ex.: 0.1) podem causar repetição/loops e piorar a leitura de imagens.
 *  - Para texto pequeno/denso (ISBN, contracapa) usar media_resolution HIGH.
 */
import { GoogleGenAI } from '@google/genai';

export type GeminiErrorKind =
  | 'auth'
  | 'quota'
  | 'unavailable'
  | 'timeout'
  | 'notfound'
  | 'badrequest'
  | 'blocked'
  | 'recitation'
  | 'empty'
  | 'parse'
  | 'unknown';

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  status?: number;

  constructor(kind: GeminiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Modelos padrão para leitura de imagens (capa/contracapa), do preferido ao último recurso. */
export const DEFAULT_SCAN_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash'
];

/** Modelos padrão para tarefas só de texto (complementação bibliográfica). */
export const DEFAULT_TEXT_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];

export function getGeminiApiKey(): string | undefined {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  // O .env.example traz um valor de exemplo; ele não é uma chave real.
  if (!key || /^MY_GEMINI_API_KEY$/i.test(key)) return undefined;
  return key;
}

/** Lê uma lista de modelos (separados por vírgula) de uma variável de ambiente, com padrão. */
export function modelsFromEnv(envName: string, defaults: string[]): string[] {
  const raw = (process.env[envName] || '').trim();
  if (!raw) return defaults;
  const list = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : defaults;
}

export function makeDeadline(ms: number): number {
  return Date.now() + ms;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GeminiError('timeout', `Tempo esgotado após ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Converte qualquer erro do SDK/rede em GeminiError com uma categoria útil para decidir o que fazer. */
export function classifyError(e: any): GeminiError {
  if (e instanceof GeminiError) return e;

  const rawStatus = Number(e?.status ?? e?.code ?? e?.error?.code);
  const status = Number.isFinite(rawStatus) && rawStatus > 0 ? rawStatus : undefined;
  const msg = String(e?.message ?? e ?? '');
  const low = msg.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    low.includes('api key not valid') ||
    low.includes('api_key_invalid') ||
    low.includes('permission_denied') ||
    low.includes('api key expired')
  ) {
    return new GeminiError('auth', msg, status);
  }
  if (status === 429 || low.includes('resource_exhausted') || low.includes('quota')) {
    return new GeminiError('quota', msg, status);
  }
  if (status === 404 || (low.includes('not found') && low.includes('model'))) {
    return new GeminiError('notfound', msg, status);
  }
  if (
    (status !== undefined && status >= 500) ||
    low.includes('unavailable') ||
    low.includes('high demand') ||
    low.includes('overloaded') ||
    low.includes('deadline_exceeded') ||
    low.includes('internal')
  ) {
    return new GeminiError('unavailable', msg, status);
  }
  if (
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    low.includes('timed out') ||
    low.includes('timeout') ||
    low.includes('fetch failed') ||
    low.includes('econnreset') ||
    low.includes('etimedout') ||
    low.includes('socket')
  ) {
    return new GeminiError('timeout', msg, status);
  }
  if (status === 400 || low.includes('invalid_argument')) {
    return new GeminiError('badrequest', msg, status);
  }
  return new GeminiError('unknown', msg, status);
}

/** Mensagem amigável (pt-BR) e status HTTP para exibir ao usuário. */
export function describeGeminiError(e: GeminiError): { status: number; message: string } {
  switch (e.kind) {
    case 'auth':
      return {
        status: 503,
        message:
          'A chave da IA (GEMINI_API_KEY) é inválida, expirou ou não tem permissão. Verifique a variável de ambiente no servidor / na Vercel.'
      };
    case 'quota':
      return {
        status: 429,
        message: 'O limite de uso da IA foi atingido no momento. Aguarde cerca de um minuto e tente novamente, ou use a busca por ISBN.'
      };
    case 'unavailable':
    case 'timeout':
      return {
        status: 503,
        message: 'Os servidores de IA estão com alta demanda ou demoraram a responder. Aguarde alguns segundos e tente novamente, ou use a busca por ISBN.'
      };
    case 'notfound':
      return {
        status: 503,
        message: 'Nenhum dos modelos de IA configurados está disponível para esta chave. Ajuste a variável GEMINI_SCAN_MODELS.'
      };
    case 'blocked':
      return {
        status: 422,
        message: 'A IA não conseguiu analisar estas imagens (filtro de segurança). Tente novamente com fotos mais nítidas e bem enquadradas.'
      };
    case 'recitation':
      return {
        status: 422,
        message: 'A IA não conseguiu transcrever o texto da contracapa. Tente novamente ou preencha a sinopse manualmente.'
      };
    case 'empty':
    case 'parse':
      return {
        status: 422,
        message: 'A IA não devolveu dados legíveis para estas fotos. Tente novamente com fotos mais nítidas, ou use a busca por ISBN.'
      };
    default:
      return {
        status: 502,
        message: `Falha ao consultar a IA${e.status ? ` (código ${e.status})` : ''}. Tente novamente em instantes.`
      };
  }
}

// ---------------------------------------------------------------------------
// Chamada com fallback
// ---------------------------------------------------------------------------

export interface RunGeminiOptions<T> {
  models: string[];
  /** Conteúdo no formato do SDK (array de { role, parts }). */
  contents: unknown;
  /** Converte o texto bruto da resposta; devolva null se não for utilizável. */
  parse: (text: string) => T | null;
  /** true quando há imagens: ativa media_resolution HIGH (leitura de texto pequeno). */
  media?: boolean;
  /** Já começar em modo JSON (bom para respostas curtas). */
  startWithJson?: boolean;
  /** Instante limite (epoch ms) para todas as tentativas. */
  deadline: number;
  /** Tempo máximo de cada chamada individual. */
  perCallTimeoutMs?: number;
}

function extractText(res: any): string {
  try {
    if (typeof res?.text === 'string' && res.text.trim()) return res.text;
  } catch {
    // o getter .text pode lançar quando a resposta não tem partes de texto
  }
  const parts = res?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p: any) => typeof p?.text === 'string' && !p.thought)
      .map((p: any) => p.text)
      .join('');
  }
  return '';
}

async function callModel(
  ai: any,
  model: string,
  contents: unknown,
  cfg: { media: boolean; enhanced: boolean; json: boolean; timeoutMs: number }
): Promise<string> {
  const config: Record<string, unknown> = {
    httpOptions: { timeout: cfg.timeoutMs }
  };
  if (cfg.media && cfg.enhanced) config.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
  if (cfg.json) config.responseMimeType = 'application/json';

  const res: any = await withTimeout<any>(ai.models.generateContent({ model, contents, config }), cfg.timeoutMs + 3000);

  const text = extractText(res);
  if (text.trim()) return text;

  const blockReason = res?.promptFeedback?.blockReason;
  const finish = String(res?.candidates?.[0]?.finishReason ?? '');
  if (finish.toUpperCase().includes('RECITATION')) {
    throw new GeminiError('recitation', 'Resposta interrompida por recitação de conteúdo protegido.');
  }
  if (blockReason || /SAFETY|BLOCK|PROHIBITED/i.test(finish)) {
    throw new GeminiError('blocked', `Resposta bloqueada (${blockReason || finish}).`);
  }
  throw new GeminiError('empty', 'A IA devolveu uma resposta vazia.');
}

/**
 * Executa a requisição percorrendo a lista de modelos até obter uma resposta utilizável.
 * - Erros de chave/permissão e de recitação interrompem imediatamente (trocar de modelo não ajuda).
 * - Indisponibilidade/cota: uma nova tentativa no mesmo modelo, depois passa para o próximo.
 * - Modelo inexistente: passa para o próximo.
 * - 400 com configuração avançada: repete o mesmo modelo com a configuração mínima.
 * - Resposta que não é JSON utilizável: repete o modelo em modo JSON estruturado.
 */
export async function runGemini<T>(opts: RunGeminiOptions<T>): Promise<{ model: string; value: T; text: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new GeminiError('auth', 'GEMINI_API_KEY não configurada.');

  // Tipado como any de propósito: a superfície usada é pequena e estável (models.generateContent).
  const ai: any = new GoogleGenAI({ apiKey });
  const perCall = opts.perCallTimeoutMs ?? 30_000;
  const media = !!opts.media;

  let lastError: GeminiError | null = null;

  for (const model of opts.models) {
    let enhanced = true;
    let json = !!opts.startWithJson;
    let transientRetries = 0;
    let parseRetries = 0;

    while (true) {
      const remaining = opts.deadline - Date.now();
      if (remaining < 4000) {
        throw lastError ?? new GeminiError('timeout', 'Orçamento de tempo esgotado antes da resposta da IA.');
      }

      try {
        const text = await callModel(ai, model, opts.contents, {
          media,
          enhanced,
          json,
          timeoutMs: Math.min(perCall, remaining - 1000)
        });
        const value = opts.parse(text);
        if (value !== null && value !== undefined) return { model, value, text };

        lastError = new GeminiError('parse', 'Resposta da IA sem dados utilizáveis.');
        console.warn(`[gemini] ${model}: resposta sem dados utilizáveis (primeiros 300 chars): ${text.slice(0, 300)}`);
        if (!json && parseRetries++ < 1) {
          json = true;
          continue;
        }
        break; // próximo modelo
      } catch (e) {
        const err = classifyError(e);
        lastError = err;
        console.warn(`[gemini] ${model}: ${err.kind}${err.status ? ` (${err.status})` : ''} — ${err.message.slice(0, 300)}`);

        if (err.kind === 'auth' || err.kind === 'recitation') throw err;

        if (err.kind === 'badrequest' && enhanced) {
          enhanced = false; // pode ser um parâmetro opcional não aceito por este modelo
          continue;
        }
        if ((err.kind === 'unavailable' || err.kind === 'quota' || err.kind === 'timeout') && transientRetries++ < 1) {
          await sleep(1200);
          continue;
        }
        if (err.kind === 'empty' && !json) {
          json = true;
          continue;
        }
        break; // próximo modelo
      }
    }
  }

  throw lastError ?? new GeminiError('unknown', 'Nenhum modelo de IA respondeu.');
}

// ---------------------------------------------------------------------------
// Extração de JSON tolerante
// ---------------------------------------------------------------------------

function tryParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    try {
      // vírgula sobrando antes de } ou ]
      return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

/** Extrai o primeiro objeto JSON de um texto, mesmo com markdown ou explicações ao redor. */
export function extractJsonObject(text: string): Record<string, any> | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let value: any = tryParse(t);

  if (value === undefined) {
    const start = t.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            value = tryParse(t.slice(start, i + 1));
            break;
          }
        }
      }
    }
  }

  if (Array.isArray(value)) value = value.find((x) => x && typeof x === 'object');
  return value && typeof value === 'object' ? (value as Record<string, any>) : null;
}

/**
 * Último recurso quando o JSON veio truncado/quebrado: recupera campos de texto simples
 * ("chave": "valor") por expressão regular.
 */
export function salvageFields(text: string, keys: string[]): Record<string, any> | null {
  const out: Record<string, any> = {};
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = text.match(re);
    if (m) {
      try {
        out[key] = JSON.parse(`"${m[1]}"`);
      } catch {
        out[key] = m[1];
      }
    }
  }
  return Object.keys(out).length ? out : null;
}
