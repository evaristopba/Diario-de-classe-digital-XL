import {
  ClassRoom,
  HorarioSlot,
  SubjectItem,
  Teacher,
  getHorariosTurma
} from '../types';
import { minutosDe, SinoConfig, horarioDaTurma } from './sino';

export function normTextoRegente(val?: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Identifica se um cadastro atua exclusivamente como bibliotecário(a) / gestão de biblioteca
 * (não devendo ser classificado como Regente Polivalente nem listado no Controle de H.A.).
 * Professores regentes ou especialistas que apenas acumulam delegação de biblioteca (`canManageLibrary`)
 * continuam sendo reconhecidos normalmente por sua disciplina ou `tipoDocente`.
 */
export function isBibliotecarioDocente(teacher?: Teacher | null): boolean {
  if (!teacher) return false;
  if (teacher.tipoDocente === 'regente' || teacher.tipoDocente === 'especialista') {
    return false;
  }
  const subStr = normTextoRegente(teacher.subject);
  if (!subStr) return Boolean(teacher.canManageLibrary);
  return (
    subStr.includes('biblioteca') ||
    subStr.includes('bibliotecari') ||
    subStr === 'leitura'
  );
}

/**
 * Identifica se um docente atua como especialista (unificando critério com a Sugestão de Especialistas).
 * Respeita `tipoDocente` explícito e evita falsos positivos em regentes com descrições como
 * "Fundamental I", "Alfabetização", "Polivalente", etc.
 */
export function isSpecialistTeacherDocente(
  teacher?: Teacher | null,
  subjects: SubjectItem[] = []
): boolean {
  if (!teacher) return false;
  if (teacher.tipoDocente === 'regente') return false;

  const subStr = normTextoRegente(teacher.subject);
  if (subStr.includes('biblioteca') || subStr.includes('leitura')) {
    return false;
  }
  if (teacher.tipoDocente === 'especialista') return true;
  if (!subStr) return false;

  if (
    subStr.includes('polivalente') ||
    subStr.includes('regente') ||
    subStr.includes('geral') ||
    subStr.includes('pedagog') ||
    subStr.includes('classe') ||
    subStr.includes('fundamental') ||
    subStr.includes('alfabetiz') ||
    subStr.includes('anos iniciais')
  ) {
    return false;
  }

  const matched = subjects.find((s) => {
    const sName = normTextoRegente(s.name);
    const sId = normTextoRegente(s.id);
    const sShort = normTextoRegente(s.shortName);
    return (
      (sName && sName === subStr) ||
      (sId && sId === subStr) ||
      (sShort && sShort === subStr) ||
      (sName && subStr.includes(sName)) ||
      (sName && sName.includes(subStr))
    );
  });

  if (matched) return matched.category === 'diversificada';
  return true;
}

/**
 * Coleta todas as chaves-espelho de um docente (`id`, `authUid` e registros com mesmo e-mail).
 */
export function collectTeacherAliasKeys(
  teacherId: string,
  teachers: { id: string; val: Teacher }[]
): Set<string> {
  const keys = new Set<string>();
  if (!teacherId) return keys;
  keys.add(teacherId);

  const base = teachers.find((t) => t.id === teacherId || t.val.authUid === teacherId);
  if (!base) return keys;

  keys.add(base.id);
  if (base.val.authUid) keys.add(base.val.authUid);

  const bMail = (base.val.email || '').trim().toLowerCase();
  const bAuthMail = ((base.val as any).authEmail || '').trim().toLowerCase();

  teachers.forEach((other) => {
    const oMail = (other.val.email || '').trim().toLowerCase();
    const oAuthMail = ((other.val as any).authEmail || '').trim().toLowerCase();
    const sameId =
      other.id === base.id ||
      other.id === base.val.authUid ||
      other.val.authUid === base.id;
    const sameMail =
      (bMail && (oMail === bMail || oAuthMail === bMail)) ||
      (bAuthMail && (oMail === bAuthMail || oAuthMail === bAuthMail));

    if (sameId || sameMail) {
      keys.add(other.id);
      if (other.val.authUid) keys.add(other.val.authUid);
    }
  });

  return keys;
}

/**
 * Determina se um slot da grade representa aula de especialista (garantindo H.A. natural ao regente).
 */
export function isSlotEspecialistaEfetivo(
  slot: HorarioSlot | null | undefined,
  teachers: { id: string; val: Teacher }[],
  subjects: SubjectItem[] = []
): boolean {
  if (!slot) return false;
  if (slot.isEspecialista === true) return true;

  const slotSubNorm = normTextoRegente(slot.disciplinaNome);
  const subObj = subjects.find(
    (s) =>
      s.id === slot.disciplinaId ||
      (slotSubNorm && normTextoRegente(s.name) === slotSubNorm)
  );
  if (subObj?.category === 'diversificada') return true;
  if (subObj?.category === 'regente') return false;

  if (slot.teacherId) {
    const teacherMatch = teachers.find(
      (t) => t.id === slot.teacherId || t.val.authUid === slot.teacherId
    );
    if (teacherMatch && isSpecialistTeacherDocente(teacherMatch.val, subjects)) {
      return true;
    }
  }

  return false;
}

export interface RegenteResolvido {
  teacher: { id: string; val: Teacher } | null;
  source: 'explicit' | 'atribuicao_unica' | 'multiplos_atribuidos' | 'nao_atribuido';
  candidatosAtribuidos: { id: string; val: Teacher }[];
}

function deduplicarDocentesPorIdentidade(
  lista: { id: string; val: Teacher }[],
  allTeachers: { id: string; val: Teacher }[],
  preferirId?: string
): { id: string; val: Teacher }[] {
  const resultado: { id: string; val: Teacher }[] = [];
  const chavesVistas = new Set<string>();

  // Ordena para priorizar registro explícito ou registro com authUid/nome completo
  const ordenada = [...lista].sort((a, b) => {
    if (preferirId) {
      if (a.id === preferirId || a.val.authUid === preferirId) return -1;
      if (b.id === preferirId || b.val.authUid === preferirId) return 1;
    }
    const aAuth = a.val.authUid ? 1 : 0;
    const bAuth = b.val.authUid ? 1 : 0;
    if (aAuth !== bAuth) return bAuth - aAuth;
    return (a.val.name || '').localeCompare(b.val.name || '');
  });

  ordenada.forEach((doc) => {
    const aliases = collectTeacherAliasKeys(doc.id, allTeachers);
    let jaVisto = false;
    aliases.forEach((k) => {
      if (chavesVistas.has(k)) jaVisto = true;
    });
    if (jaVisto) return;
    aliases.forEach((k) => chavesVistas.add(k));
    resultado.push(doc);
  });

  return resultado;
}

/**
 * Resolve quem é o(a) Professor(a) Regente efetivo(a) de uma turma:
 * 1. Usa `classVal.teacherId` quando explicitamente definido (inclusive cruzando `authUid`/espelhos).
 * 2. Caso contrário, consulta `diario-classe/atribuicoes` para identificar automaticamente
 *    o docente não-especialista vinculado à turma (desconsiderando administradores-criadores
 *    quando houver exatamente um regente não-admin atribuído).
 */
export function resolveRegenteForClass(params: {
  classId: string;
  classVal: ClassRoom;
  teachers: { id: string; val: Teacher }[];
  atribuicoes?: Record<string, Record<string, boolean>>;
  subjects?: SubjectItem[];
  adminIds?: Record<string, boolean>;
}): RegenteResolvido {
  const {
    classId,
    classVal,
    teachers,
    atribuicoes = {},
    subjects = [],
    adminIds = {}
  } = params;

  // Coleta docentes não-especialistas (e não-bibliotecários) atribuídos à turma em `atribuicoes`
  const atribuidosBrutos = teachers.filter((t) => {
    if (isBibliotecarioDocente(t.val) || isSpecialistTeacherDocente(t.val, subjects)) return false;
    const aliases = collectTeacherAliasKeys(t.id, teachers);
    for (const key of aliases) {
      if (atribuicoes?.[key]?.[classId] === true) {
        return true;
      }
    }
    return false;
  });

  const candidatosAtribuidos = deduplicarDocentesPorIdentidade(
    atribuidosBrutos,
    teachers,
    classVal.teacherId
  );

  // 1. Vínculo explícito em `turma.teacherId`
  if (classVal.teacherId) {
    const explicitAliases = collectTeacherAliasKeys(classVal.teacherId, teachers);
    const match = teachers.find(
      (t) =>
        t.id === classVal.teacherId ||
        t.val.authUid === classVal.teacherId ||
        explicitAliases.has(t.id)
    );
    if (match) {
      return {
        teacher: match,
        source: 'explicit',
        candidatosAtribuidos
      };
    }
  }

  // 2. Fallback automático via `atribuicoes`
  if (candidatosAtribuidos.length === 1) {
    return {
      teacher: candidatosAtribuidos[0],
      source: 'atribuicao_unica',
      candidatosAtribuidos
    };
  }

  if (candidatosAtribuidos.length > 1) {
    // Ao criar uma turma, o Admin criador recebe atribuição automática em `ClassesScreen`.
    // Se removendo o criador/admins restar exatamente 1 regente não-admin, ele é o regente natural.
    const naoAdmins = candidatosAtribuidos.filter((t) => {
      const aliases = collectTeacherAliasKeys(t.id, teachers);
      for (const key of aliases) {
        if (adminIds?.[key] === true || classVal.criadoPor === key) {
          return false;
        }
      }
      return true;
    });

    if (naoAdmins.length === 1) {
      return {
        teacher: naoAdmins[0],
        source: 'atribuicao_unica',
        candidatosAtribuidos
      };
    }

    return {
      teacher: null,
      source: 'multiplos_atribuidos',
      candidatosAtribuidos
    };
  }

  return {
    teacher: null,
    source: 'nao_atribuido',
    candidatosAtribuidos: []
  };
}

/**
 * Verifica se dois intervalos de horário [iniA, fimA) e [iniB, fimB) em formato HH:MM se sobrepõem.
 */
export function intervalosSeSobrepoem(
  iniA?: string,
  fimA?: string,
  iniB?: string,
  fimB?: string
): boolean {
  const a1 = minutosDe(iniA);
  const a2 = minutosDe(fimA);
  const b1 = minutosDe(iniB);
  const b2 = minutosDe(fimB);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false;
  return a1 < b2 && b1 < a2;
}

/**
 * Calcula quantas H.A.s de regente uma grade de turma assegura com aulas de especialistas.
 */
export function contarHARegenteNaGrade(
  gradeHoraria: Record<string, HorarioSlot> | undefined,
  teachers: { id: string; val: Teacher }[],
  subjects: SubjectItem[] = []
): number {
  if (!gradeHoraria) return 0;
  let total = 0;
  Object.values(gradeHoraria).forEach((slot) => {
    if (isSlotEspecialistaEfetivo(slot, teachers, subjects)) {
      total++;
    }
  });
  return total;
}

/**
 * Obtém o intervalo HH:MM real de um slot da turma considerando o sino configurado e ajustes pontuais.
 */
export function resolverHorarioRealSlot(
  classVal: ClassRoom,
  dia: number,
  ordem: number,
  slot?: HorarioSlot,
  sinoConfig?: SinoConfig
): { inicio: string; fim: string } {
  const bell = sinoConfig
    ? horarioDaTurma(sinoConfig, classVal, dia)
    : getHorariosTurma(
        classVal.shift,
        classVal.intervaloGrupo,
        classVal.year,
        classVal.schoolId,
        dia,
        classVal.intervaloGrupoPorDia
      );
  const aula = bell.aulas.find((a) => a.ordem === ordem);
  return {
    inicio: slot?.horarioCustomInicio || aula?.inicio || '',
    fim: slot?.horarioCustomFim || aula?.fim || ''
  };
}
