import { BNCCSkill } from '../types';

/**
 * Grupos oficiais da BNCC para Ensino Fundamental (Anos Iniciais)
 */
export interface BNCCGroupPreset {
  id: string;
  label: string;
  shortLabel: string;
  years: string[];
  description: string;
}

export const BNCC_GROUPS: BNCCGroupPreset[] = [
  { id: '1', label: '1º Ano (01)', shortLabel: '1º Ano', years: ['1'], description: 'Exclusivo do 1º Ano' },
  { id: '2', label: '2º Ano (02)', shortLabel: '2º Ano', years: ['2'], description: 'Exclusivo do 2º Ano' },
  { id: '3', label: '3º Ano (03)', shortLabel: '3º Ano', years: ['3'], description: 'Exclusivo do 3º Ano' },
  { id: '4', label: '4º Ano (04)', shortLabel: '4º Ano', years: ['4'], description: 'Exclusivo do 4º Ano' },
  { id: '5', label: '5º Ano (05)', shortLabel: '5º Ano', years: ['5'], description: 'Exclusivo do 5º Ano' },
  { id: '12', label: '1º e 2º Anos (12)', shortLabel: '1º e 2º', years: ['1', '2'], description: 'Bloco de Alfabetização (1º e 2º Anos)' },
  { id: '35', label: '3º ao 5º Anos (35)', shortLabel: '3º ao 5º', years: ['3', '4', '5'], description: 'Bloco Intermediário (3º, 4º e 5º Anos)' },
  { id: '15', label: '1º ao 5º Anos (15)', shortLabel: '1º ao 5º', years: ['1', '2', '3', '4', '5'], description: 'Plurianual / Geral Anos Iniciais (1º a 5º)' }
];

/**
 * Retorna todos os anos (1..5) atendidos por uma habilidade da BNCC.
 * Suporta formatos legados ("1", "2"), agrupados ("12", "35", "15", "1-5", "1-2"),
 * listas separadas por vírgula ("1,2,3,4,5") ou array no campo `years`.
 */
export function getSkillApplicableYears(skill: BNCCSkill | { year?: string; years?: string[]; code?: string }): string[] {
  if (!skill) return [];

  // Se já possui o array explícito de anos
  if (Array.isArray(skill.years) && skill.years.length > 0) {
    return Array.from(new Set(skill.years.map((y) => String(y).trim()))).sort();
  }

  // 1º: Se o código da habilidade indicar explicitamente uma abrangência plurianual oficial
  // (ex: EF15..., EF35..., EF12...), ela TEM PRECEDÊNCIA sobre qualquer campo 'year' legado isolado.
  // Isso resolve casos em que a habilidade foi cadastrada antigamente com year="1" mas seu código é EF15LP01.
  if (skill.code) {
    const inferred = inferBNCCYearsFromCode(skill.code);
    if (inferred.length > 1) {
      return inferred;
    }
  }

  const rawYear = String(skill.year || '').trim();

  // Se contém vírgula (ex: "1,2,3,4,5")
  if (rawYear.includes(',')) {
    return Array.from(new Set(rawYear.split(',').map((y) => y.trim()).filter(Boolean))).sort();
  }

  // Grupos conhecidos pelo código de ano
  switch (rawYear) {
    case '15':
    case '1-5':
    case '1..5':
      return ['1', '2', '3', '4', '5'];
    case '35':
    case '3-5':
    case '3..5':
      return ['3', '4', '5'];
    case '12':
    case '1-2':
    case '1..2':
      return ['1', '2'];
    case '1':
      return ['1'];
    case '2':
      return ['2'];
    case '3':
      return ['3'];
    case '4':
      return ['4'];
    case '5':
      return ['5'];
    default:
      break;
  }

  // Se o campo year estiver vazio ou não mapeado, tenta inferir pelo próprio código da BNCC
  if (skill.code) {
    const inferred = inferBNCCYearsFromCode(skill.code);
    if (inferred.length > 0) {
      return inferred;
    }
  }

  return rawYear ? [rawYear] : [];
}

/**
 * Extrai os anos atendidos a partir da convenção oficial de códigos da BNCC:
 * Ex: EF15LP01 -> ['1', '2', '3', '4', '5']
 *     EF12LP04 -> ['1', '2']
 *     EF35EF01 -> ['3', '4', '5']
 *     EF01MA01 -> ['1']
 *     EF04CI02 -> ['4']
 */
export function inferBNCCYearsFromCode(code: string): string[] {
  if (!code) return [];
  const clean = code.trim().toUpperCase();

  // Padrão BNCC: letras de etapa (ex: EF) seguidas de 2 dígitos de ano
  const match = clean.match(/^([A-Z]{2})([0-9]{2})/);
  if (match) {
    const digits = match[2];
    switch (digits) {
      case '15':
        return ['1', '2', '3', '4', '5'];
      case '12':
        return ['1', '2'];
      case '35':
        return ['3', '4', '5'];
      case '01':
        return ['1'];
      case '02':
        return ['2'];
      case '03':
        return ['3'];
      case '04':
        return ['4'];
      case '05':
        return ['5'];
      default:
        break;
    }
  }

  return [];
}

/**
 * Verifica se uma habilidade BNCC atende a um determinado ano escolar (ex: "1", "3", "5").
 */
export function isSkillApplicableToYear(
  skill: BNCCSkill | { year?: string; years?: string[]; code?: string },
  targetYear: string | number
): boolean {
  if (!targetYear) return true;
  // Extrai apenas os dígitos do ano (ex: "4", "4º", "4º Ano" -> "4")
  const rawTarget = String(targetYear).trim();
  const digitMatch = rawTarget.match(/\d+/);
  const target = digitMatch ? digitMatch[0] : rawTarget;

  const applicable = getSkillApplicableYears(skill);
  return applicable.includes(target) || applicable.includes(rawTarget);
}

/**
 * Retorna um texto amigável do escopo de anos atendidos pela habilidade.
 * Ex: "1º ao 5º Ano", "1º e 2º Anos", "3º Ano", etc.
 */
export function formatSkillYearsLabel(skill: BNCCSkill | { year?: string; years?: string[]; code?: string }): string {
  const years = getSkillApplicableYears(skill);
  if (years.length === 0) return 'Geral';
  if (years.length === 5 && ['1', '2', '3', '4', '5'].every((y) => years.includes(y))) {
    return '1º ao 5º Ano';
  }
  if (years.length === 3 && years.includes('3') && years.includes('4') && years.includes('5')) {
    return '3º ao 5º Ano';
  }
  if (years.length === 2 && years.includes('1') && years.includes('2')) {
    return '1º e 2º Ano';
  }
  if (years.length === 1) {
    return `${years[0]}º Ano`;
  }
  return years.map((y) => `${y}º`).join(', ') + ' Ano';
}
