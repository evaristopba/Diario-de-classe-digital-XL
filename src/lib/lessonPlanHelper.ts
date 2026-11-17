import { BNCCSkill, ClassRoom, GRADE_DIAS_SEMANA, Teacher } from '../types';
import { getSkillApplicableYears, isSkillApplicableToYear } from './bnccHelper';
import { collectTeacherAliasKeys, normTextoRegente } from './regenteHA';

export interface SuggestedDateResult {
  date: string;
  fromSchedule: boolean;
  diasGrade: number[];
}

export function normSeriePlano(year?: string): string {
  const raw = normTextoRegente(year);
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw;
}

/**
 * Verifica se uma turma de destino é compatível com a série de origem e as habilidades BNCC do plano.
 * - Sem BNCC associada: exige a mesma série da turma de origem.
 * - Com BNCC associada: exige que TODAS as habilidades selecionadas atendam ao ano da turma de destino.
 */
export function isTurmaCompativelComPlano(params: {
  targetYear?: string;
  sourceYear?: string;
  selectedBnccIds?: string[];
  selectedBnccCodes?: string[];
  bnccList: { id: string; val: BNCCSkill }[];
}): boolean {
  const {
    targetYear,
    sourceYear,
    selectedBnccIds = [],
    selectedBnccCodes = [],
    bnccList
  } = params;
  const targetNorm = normSeriePlano(targetYear);
  const sourceNorm = normSeriePlano(sourceYear);

  const matchedSkills: BNCCSkill[] = [];
  const seen = new Set<string>();

  selectedBnccIds.forEach((id) => {
    const found = bnccList.find((b) => b.id === id)?.val;
    if (found && !seen.has(found.code)) {
      matchedSkills.push(found);
      seen.add(found.code);
    }
  });

  selectedBnccCodes.forEach((code) => {
    if (seen.has(code)) return;
    const found = bnccList.find((b) => b.val.code === code)?.val;
    if (found) {
      matchedSkills.push(found);
      seen.add(found.code);
    } else {
      matchedSkills.push({ code, desc: '', year: '' });
      seen.add(code);
    }
  });

  if (matchedSkills.length === 0) {
    if (!sourceNorm || !targetNorm) return true;
    return targetNorm === sourceNorm;
  }

  return matchedSkills.every((skill) => {
    const applicable = getSkillApplicableYears(skill);
    if (applicable.length === 0) {
      return !sourceNorm || !targetNorm || targetNorm === sourceNorm;
    }
    return isSkillApplicableToYear(skill, targetYear || '');
  });
}

export function parseLocalDateString(dateStr?: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  const [y, m, d] = dateStr.trim().split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function formatLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekdayLabelPt(dateStr?: string): string {
  const dt = parseLocalDateString(dateStr);
  if (!dt) return '';
  const map = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return map[dt.getDay()] || '';
}

export function getDateInSameWeek(baseDateStr: string, targetDiaSemana: number): string {
  const dt = parseLocalDateString(baseDateStr);
  if (!dt) return baseDateStr;
  const jsDay = dt.getDay(); // 0=Dom..6=Sáb
  const currentIsoDay = jsDay === 0 ? 7 : jsDay; // 1=Seg..7=Dom
  const diff = targetDiaSemana - currentIsoDay;
  const result = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + diff);
  return formatLocalDateString(result);
}

export function buildTeacherAliasSet(
  authUid: string | null,
  currentTeacherName: string,
  teachers: { id: string; val: Teacher }[]
): { aliases: Set<string>; nameNorm: string } {
  const aliases = new Set<string>();
  const nameNorm = normTextoRegente(currentTeacherName);

  if (authUid) {
    collectTeacherAliasKeys(authUid, teachers).forEach((k) => aliases.add(k));
    aliases.add(authUid);
  }

  if (nameNorm) {
    teachers.forEach((t) => {
      if (normTextoRegente(t.val.name) === nameNorm) {
        collectTeacherAliasKeys(t.id, teachers).forEach((k) => aliases.add(k));
      }
    });
  }

  return { aliases, nameNorm };
}

export function getDiasAulaDocenteNaTurma(
  turma: ClassRoom,
  teacherAliases: Set<string>,
  teacherNameNorm: string
): number[] {
  const grade = turma.gradeHoraria;
  if (!grade) return [];

  const diasSet = new Set<number>();
  Object.entries(grade).forEach(([key, slot]) => {
    if (!slot || slot.isHA) return;
    const dia = Number(key.split('_')[0]);
    if (!Number.isInteger(dia) || dia < 1 || dia > 5) return;

    const matchById = Boolean(slot.teacherId && teacherAliases.has(slot.teacherId));
    const matchByName = Boolean(
      teacherNameNorm && slot.teacherNome && normTextoRegente(slot.teacherNome) === teacherNameNorm
    );

    if (matchById || matchByName) {
      diasSet.add(dia);
    }
  });

  return Array.from(diasSet).sort((a, b) => a - b);
}

export function formatDiasGradeResumo(dias: number[]): string {
  return dias
    .map((d) => GRADE_DIAS_SEMANA.find((g) => g.id === d)?.curto || '')
    .filter(Boolean)
    .join(', ');
}

export function sugerirDataTurmaPelaGrade(
  turma: ClassRoom,
  baseDateStr: string,
  teacherAliases: Set<string>,
  teacherNameNorm: string
): SuggestedDateResult {
  const diasGrade = getDiasAulaDocenteNaTurma(turma, teacherAliases, teacherNameNorm);
  if (diasGrade.length === 0) {
    return { date: baseDateStr, fromSchedule: false, diasGrade: [] };
  }

  const baseDt = parseLocalDateString(baseDateStr);
  if (baseDt) {
    const jsDay = baseDt.getDay();
    const baseIsoDay = jsDay === 0 ? 7 : jsDay;
    if (diasGrade.includes(baseIsoDay)) {
      return { date: baseDateStr, fromSchedule: true, diasGrade };
    }
  }

  const suggested = getDateInSameWeek(baseDateStr, diasGrade[0]);
  return { date: suggested, fromSchedule: true, diasGrade };
}
