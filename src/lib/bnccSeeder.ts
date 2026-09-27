/**
 * Script de população e sincronização das Habilidades da BNCC no Firebase RTDB.
 *
 * Pode ser executado:
 * 1. Pelo terminal com Node.js (via REST API autenticada por token de login ou service account)
 * 2. Direto pelo navegador na tela de Códigos BNCC com 1 clique.
 */

import { rtdb, ref, get, update, push } from '../lib/firebase';
import { OFFICIAL_BNCC_BLOCKS_SEED, OFFICIAL_BNCC_COMPUTACAO_SEED, BNCCSeedItem } from './bnccSeed';
import { getSkillApplicableYears } from './bnccHelper';

export interface SeedResult {
  totalInSeed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Função utilitária interna para sincronizar qualquer lista de sementes BNCC no Firebase RTDB.
 */
async function seedBNCCList(
  seedList: BNCCSeedItem[],
  onProgress?: (current: number, total: number, code: string) => void
): Promise<SeedResult> {
  const result: SeedResult = {
    totalInSeed: seedList.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: []
  };

  try {
    // 1. Ler todas as habilidades atuais na base de dados
    const snap = await get(ref(rtdb, 'diario-classe/bncc'));
    const currentData = snap.val() || {};

    // Mapear habilidades existentes pelo código normativo (maiúsculo)
    const existingByCode: Record<string, { id: string; val: any }> = {};
    Object.keys(currentData).forEach((k) => {
      const item = currentData[k];
      if (item && item.code) {
        const cleanCode = String(item.code).trim().toUpperCase();
        existingByCode[cleanCode] = { id: k, val: item };
      }
    });

    const updates: Record<string, any> = {};

    // 2. Iterar sobre os itens a serem semeados
    let processed = 0;
    for (const seedItem of seedList) {
      processed++;
      const cleanCode = seedItem.code.trim().toUpperCase();

      if (onProgress) {
        onProgress(processed, seedList.length, cleanCode);
      }

      const existing = existingByCode[cleanCode];

      if (existing) {
        // Habilidade já existe na base: verificar se precisa enriquecer os blocos/anos
        const existingYears = getSkillApplicableYears(existing.val);
        const needsYearsUpdate =
          seedItem.years.some((y) => !existingYears.includes(y)) ||
          !existing.val.years ||
          !Array.isArray(existing.val.years);

        const needsDescUpdate =
          (!existing.val.desc && !existing.val.description) ||
          (existing.val.desc && existing.val.desc.length < 10);

        if (needsYearsUpdate || needsDescUpdate) {
          const mergedYears = Array.from(new Set([...existingYears, ...seedItem.years])).sort();
          updates[`diario-classe/bncc/${existing.id}/years`] = mergedYears;
          updates[`diario-classe/bncc/${existing.id}/year`] = seedItem.year;
          if (needsDescUpdate) {
            updates[`diario-classe/bncc/${existing.id}/desc`] = seedItem.desc;
          }
          result.updated++;
        } else {
          result.unchanged++;
        }
      } else {
        // Habilidade nova: gerar nova chave push no RTDB
        const newRef = push(ref(rtdb, 'diario-classe/bncc'));
        const newKey = newRef.key;
        if (newKey) {
          updates[`diario-classe/bncc/${newKey}`] = {
            code: cleanCode,
            desc: seedItem.desc,
            year: seedItem.year,
            years: seedItem.years,
            createdAt: Date.now()
          };
          result.inserted++;
        }
      }
    }

    // 3. Efetuar a gravação atômica em lote no Firebase RTDB
    if (Object.keys(updates).length > 0) {
      await update(ref(rtdb), updates);
    }

    return result;
  } catch (err: any) {
    console.error('Erro ao popular habilidades BNCC na base:', err);
    result.errors.push(err?.message || 'Falha ao sincronizar com o banco de dados');
    throw err;
  }
}

/**
 * Insere ou sincroniza o catálogo completo da BNCC (incluindo BNCC Computação)
 * diretamente no nó `diario-classe/bncc` do Firebase RTDB (616 habilidades).
 */
export async function seedBNCCDatabase(
  onProgress?: (current: number, total: number, code: string) => void
): Promise<SeedResult> {
  return seedBNCCList(OFFICIAL_BNCC_BLOCKS_SEED, onProgress);
}

/**
 * Insere ou sincroniza exclusivamente as 42 habilidades da BNCC Computação
 * (Resolução CNE/CEB nº 1/2022 - Anos Iniciais 1º ao 5º ano) no Firebase RTDB.
 */
export async function seedBNCCComputacaoDatabase(
  onProgress?: (current: number, total: number, code: string) => void
): Promise<SeedResult> {
  return seedBNCCList(OFFICIAL_BNCC_COMPUTACAO_SEED, onProgress);
}
