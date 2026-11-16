import React from 'react';
import {
  horarioDaTurma,
  getSinoConfigAtiva,
  rotulosDasAulas,
  grupoDaTurma,
  normalizarIntervaloGrupoPorDia,
  GRUPOS_SINO,
  perfisDoTurno,
  resolverPerfilIdTurma,
  type HorarioTurma,
  type GrupoSinoId,
  type PerfilSino,
  SINO_PADRAO
} from './lib/sino';

export {
  grupoDaTurma,
  normalizarIntervaloGrupoPorDia,
  GRUPOS_SINO,
  perfisDoTurno,
  resolverPerfilIdTurma,
  type GrupoSinoId,
  type PerfilSino
};

export interface School {
  id?: string;
  name: string;
  address?: string;
  createdAt?: number;
}

export interface Student {
  id?: string;
  classId: string;
  number: number;
  name: string;
  ra: string;
  rm?: string;
  birthdate: string;
  status: 'ativo' | 'recebida' | 'expedida';
  transferDate?: string; // Legado / espelho da última data de transferência
  transferInDate?: string; // Data da Transferência Recebida (Entrada)
  transferOutDate?: string; // Data da Transferência Expedida (Saída)
  transferidoDe?: string; // ID da linha anterior de onde o aluno foi transferido
  anoLetivo: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ClassRoom {
  id?: string;
  schoolId: string;
  schoolName: string;
  year: string;
  letter: string;
  shift: string;
  anoLetivo: string;
  createdAt?: number;
  criadoPor?: string;
  teacherId?: string;
  alunos?: Record<string, Student>;
  /**
   * Grupo de recreio da turma no matutino: 'G1' (1º ano), 'G23' (2º e 3º) ou 'G45' (4º e 5º).
   * 'A' e 'B' são valores antigos e continuam aceitos (ver grupoDaTurma em lib/sino.ts).
   * Os horários de cada grupo são configuráveis por escola (config/sino).
   */
  intervaloGrupo?: '1' | 'A' | 'B' | 'G1' | 'G23' | 'G45' | 'ano1' | 'ano23' | 'ano45' | string;
  /** Sobrescrita do grupo de sino por dia da semana (chaves '1'..'5' ou 'd1'..'d5'). */
  intervaloGrupoPorDia?: Record<string, string>;
  gradeHoraria?: Record<string, HorarioSlot>; // Chave: `${diaSemana}_${ordemAula}` ex: "1_1" = Segunda 1ª aula
}

export type DiaSemana = 1 | 2 | 3 | 4 | 5; // 1: Segunda, 2: Terça, 3: Quarta, 4: Quinta, 5: Sexta

export interface HorarioSlot {
  disciplinaId: string;
  disciplinaNome: string;
  disciplinaSigla?: string;
  teacherId?: string; // ID do professor especialista ou regente
  teacherNome?: string;
  isEspecialista?: boolean;
  isHA?: boolean; // Define se este horário é uma Hora-Atividade (H.A.) / Planejamento
  haTipo?: TipoHoraAtividade;
  horarioCustomInicio?: string; // Ex: '09:30' (ajuste pontual de horário)
  horarioCustomFim?: string; // Ex: '10:20'
  observacao?: string; // Ex: 'Aula adiantada/subida', 'Permuta com Ed. Física'
}

/**
 * Hora-Atividade (H.A.): tempo dentro da jornada reservado a planejamento, correção, reuniões e formação.
 * Vale para regentes e especialistas. Guardada por professor em `diario-classe/config/horaAtividade/{professorId}/{dia}_{HHMM}`.
 */
export type TipoHoraAtividade = 'planejamento' | 'reuniao' | 'formacao' | 'atendimento' | 'outro';

export const TIPOS_HORA_ATIVIDADE: { id: TipoHoraAtividade; nome: string; emoji: string }[] = [
  { id: 'planejamento', nome: 'Planejamento e correção', emoji: '📝' },
  { id: 'reuniao', nome: 'Reunião pedagógica', emoji: '👥' },
  { id: 'formacao', nome: 'Formação continuada', emoji: '🎓' },
  { id: 'atendimento', nome: 'Atendimento a famílias', emoji: '🤝' },
  { id: 'outro', nome: 'Outra atividade', emoji: '📌' }
];

export interface HoraAtividade {
  dia: number; // 1 (Seg) a 5 (Sex)
  inicio: string; // 'HH:MM'
  fim: string; // 'HH:MM'
  tipo: TipoHoraAtividade;
  schoolId?: string; // escola onde a H.A. é cumprida (especialistas atuam em várias)
  observacao?: string;
  createdAt?: number;
  updatedAt?: number;
}

export const GRADE_DIAS_SEMANA = [
  { id: 1 as DiaSemana, nome: 'Segunda-feira', sigla: 'SEG', curto: 'Seg' },
  { id: 2 as DiaSemana, nome: 'Terça-feira', sigla: 'TER', curto: 'Ter' },
  { id: 3 as DiaSemana, nome: 'Quarta-feira', sigla: 'QUA', curto: 'Qua' },
  { id: 4 as DiaSemana, nome: 'Quinta-feira', sigla: 'QUI', curto: 'Qui' },
  { id: 5 as DiaSemana, nome: 'Sexta-feira', sigla: 'SEX', curto: 'Sex' }
];

export type IntervaloGrupo = '1' | 'A' | 'B' | 'G1' | 'G23' | 'G45' | 'ano1' | 'ano23' | 'ano45' | string;

export const HORARIOS_SINO = SINO_PADRAO;

/**
 * Horários de uma turma (aulas, recreio, complementar). Vêm da configuração por escola (config/sino) quando
 * ela foi carregada pela tela; do contrário, do padrão embutido em lib/sino.ts.
 */
export function getHorariosTurma(
  shift?: string,
  intervaloGrupo?: string,
  year?: string,
  schoolId?: string,
  dia?: number,
  intervaloGrupoPorDia?: unknown
): HorarioTurma {
  return horarioDaTurma(getSinoConfigAtiva(), { shift, year, intervaloGrupo, intervaloGrupoPorDia, schoolId }, dia);
}

/** Linhas de rótulo de horário das 5 aulas de um turno (um horário, ou um por grupo quando diferem). */
export function getRotulosDasAulas(
  turno: 'manha' | 'tarde',
  schoolId?: string
): { ordem: number; linhas: string[] }[] {
  return rotulosDasAulas(getSinoConfigAtiva(), schoolId, turno);
}

export function getTurnoCanonical(shift?: string): 'manha' | 'tarde' | 'noite' | 'outro' {
  const s = (shift || '').trim().toLowerCase();
  if (s.includes('manh') || s.includes('matut')) return 'manha';
  if (s.includes('tard') || s.includes('vesp')) return 'tarde';
  if (s.includes('noit') || s.includes('notur')) return 'noite';
  return 'outro';
}

export function timeToMinutes(timeStr?: string): number | null {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function getSlotTimeRange(
  classItem: {
    shift?: string;
    intervaloGrupo?: IntervaloGrupo | string;
    intervaloGrupoPorDia?: unknown;
    year?: string;
    schoolId?: string;
  },
  ordem: number,
  customInicio?: string,
  customFim?: string,
  dia?: number
): { startMin: number; endMin: number; inicioStr: string; fimStr: string } {
  const cStart = timeToMinutes(customInicio);
  const cEnd = timeToMinutes(customFim);
  if (cStart !== null && cEnd !== null && cEnd > cStart) {
    return { startMin: cStart, endMin: cEnd, inicioStr: customInicio!, fimStr: customFim! };
  }
  const sched = getHorariosTurma(
    classItem.shift,
    classItem.intervaloGrupo,
    classItem.year,
    classItem.schoolId,
    dia,
    classItem.intervaloGrupoPorDia
  );
  const aula = sched.aulas.find((a) => a.ordem === ordem);
  if (aula) {
    const sMin = timeToMinutes(aula.inicio) ?? 0;
    const eMin = timeToMinutes(aula.fim) ?? 0;
    return { startMin: sMin, endMin: eMin, inicioStr: aula.inicio, fimStr: aula.fim };
  }
  const turno = getTurnoCanonical(classItem.shift);
  if (turno === 'tarde') {
    const sMin = 12 * 60 + 30 + (ordem - 1) * 50;
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      startMin: sMin,
      endMin: sMin + 50,
      inicioStr: `${pad(Math.floor(sMin / 60))}:${pad(sMin % 60)}`,
      fimStr: `${pad(Math.floor((sMin + 50) / 60))}:${pad((sMin + 50) % 60)}`
    };
  }
  const sMin = 7 * 60 + (ordem - 1) * 50;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startMin: sMin,
    endMin: sMin + 50,
    inicioStr: `${pad(Math.floor(sMin / 60))}:${pad(sMin % 60)}`,
    fimStr: `${pad(Math.floor((sMin + 50) / 60))}:${pad((sMin + 50) % 60)}`
  };
}

export interface Category {
  id?: string;
  name: string;
  color: string;
  createdAt?: number;
}

export interface EventType {
  id?: string;
  name: string;
  color: string;
  createdAt?: number;
}

export interface BNCCSkill {
  id?: string;
  year: string; // Ex: '1', '2', '12', '35', '15', '1,2,3,4,5' (compatibilidade)
  years?: string[]; // Lista de anos atendidos: ['1', '2', '3', '4', '5']
  code: string;
  desc?: string;
  description?: string;
  createdAt?: number;
}

export interface SubjectItem {
  id: string;
  name: string;
  shortName: string;
  color?: string;
  category?: 'regente' | 'diversificada';
  order?: number; // Ordem de exibição no Boletim Escolar (1, 2, 3...)
}

export const DEFAULT_SUBJECTS: SubjectItem[] = [
  { id: 'portugues', name: 'Língua Portuguesa', shortName: 'LP', category: 'regente', order: 1 },
  { id: 'arte', name: 'Arte', shortName: 'ART', category: 'diversificada', order: 2 },
  { id: 'ed_fisica', name: 'Educação Física', shortName: 'EF', category: 'diversificada', order: 3 },
  { id: 'ingles', name: 'Língua Inglesa', shortName: 'ING', category: 'diversificada', order: 4 },
  { id: 'matematica', name: 'Matemática', shortName: 'MAT', category: 'regente', order: 5 },
  { id: 'ciencias', name: 'Ciências', shortName: 'CIE', category: 'regente', order: 6 },
  { id: 'geografia', name: 'Geografia', shortName: 'GEO', category: 'regente', order: 7 },
  { id: 'historia', name: 'História', shortName: 'HIST', category: 'regente', order: 8 },
  { id: 'ens_religioso', name: 'Ensino Religioso', shortName: 'ER', category: 'regente', order: 9 },
  { id: 'computacao', name: 'Computação e Tecnologia', shortName: 'COMP', category: 'diversificada', order: 10 }
];

export function sortSubjectsByOrder<T extends { order?: number; name?: string }>(subjects: T[]): T[] {
  return [...subjects].sort((a, b) => {
    const oA = typeof a.order === 'number' && !isNaN(a.order) ? a.order : 9999;
    const oB = typeof b.order === 'number' && !isNaN(b.order) ? b.order : 9999;
    if (oA !== oB) return oA - oB;
    return (a.name || '').localeCompare(b.name || '');
  });
}

export interface AttendanceRecord {
  id?: string;
  classId: string;
  bimester: string;
  date: string;
  studentId: string;
  status: 'P' | 'F';
  teacher: string;
  anoLetivo: string;
  classId_bimester_date?: string;
  classId_date?: string;
}

export interface GradeRecord {
  id?: string;
  classId: string;
  studentId: string;
  bimester: string;
  subject?: string; // Disciplina / Matéria (ex: portugues, matematica, arte, etc.)
  value: number;
  teacher?: string;
  anoLetivo?: string;
  origem?: string; // Ex: 'nota de origem'
  isOrigem?: boolean;
  createdAt?: number;
}

export interface LessonPlan {
  id?: string;
  classId: string;
  bimester: string;
  date: string;
  categoryId?: string;
  category?: string;
  subject?: string;
  planned: string;
  executed?: string;
  given?: string;
  obs?: string;
  bnccId?: string;
  bnccIds?: string[];
  bnccCodes?: string[];
  teacher: string;
  anoLetivo: string;
  createdAt?: number;
  updatedAt?: number;
  ratifiedAt?: number;
}

export interface EventOccurrence {
  id?: string;
  classId: string;
  bimester: string;
  date: string;
  typeId: string;
  type?: string;
  studentId: string;
  description: string;
  teacher: string;
  anoLetivo: string;
  absentOnDate?: boolean;
  studentAttendanceStatus?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Teacher {
  id?: string;
  authUid?: string;
  name: string;
  email: string;
  registration?: string; // Matrícula / Registro funcional
  phone?: string;
  subject?: string; // Disciplina principal / Especialidade (ex: 'Regente', 'Arte', 'Educação Física', 'Inglês')
  status?: 'active' | 'inactive';
  canManageLibrary?: boolean; // Permissão configurável para gerenciar acervo e empréstimos da biblioteca
  exibirApresentacaoAdmin?: boolean; // Checkbox para exibir atalho da Apresentação Municipal/Pitch no painel principal
  diasDisponiveis?: number[]; // [1, 2, 3, 4, 5] (1: Seg ... 5: Sex). Se vazio ou ausente, todos os 5 dias são úteis/disponíveis
  diasDisponiveisUpdatedAt?: number; // Timestamp específico da última alteração manual da escala/folga
  folgaDia?: number | null; // Compatibilidade com registros legados (1..5)
  schoolId?: string; // Escola principal
  schools?: string[]; // Escolas vinculadas
  metaHA?: number; // Quantidade de H.A. (aulas atividades) semanais estipuladas pela coordenação/secretaria
  tipoDocente?: 'regente' | 'especialista'; // Classificação docente (regente polivalente ou especialista de disciplina)
  haHorariosFixos?: string[]; // Para especialistas: slots de H.A. fixos pré-definidos (ex: ['1_3', '3_4'])
  turmasSuplementares?: Record<string, boolean>; // classId -> true se for carga suplementar (não considerada na sugestão regular de horários)
  createdAt?: number;
  updatedAt?: number;
}

export interface SchoolCopyHolding {
  schoolName: string;
  totalCopies: number;
  availableCopies: number;
  code?: string; // Código de tombamento específico da unidade
  location?: string;
}

export interface SchoolAcervoItem {
  totalCopies: number;
  availableCopies: number;
  code?: string;
  schoolName?: string;
  location?: string;
  updatedAt?: number;
}

export interface BookReservation {
  id?: string;
  bookId: string;
  bookTitle: string;
  bookCode?: string;
  schoolId: string;
  schoolName?: string;
  classId: string;
  className?: string;
  studentId: string;
  studentName: string;
  studentRa?: string;
  status: 'ativa' | 'atendida' | 'cancelada';
  reservationDate: string; // YYYY-MM-DD
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Book {
  id?: string;
  code: string; // Tombamento / ISBN / Código de barras ou numérico
  title: string; // Título da obra
  subtitle?: string;
  author: string; // Autor(a)
  illustrator?: string;
  genre?: string; // Gênero literário
  publisher?: string; // Editora
  year?: string; // Ano de publicação
  synopsis?: string; // Sinopse ou observação da obra
  collection?: string; // Coleção / Selo
  coverUrl?: string; // URL da miniatura da capa

  // Total consolidado da rede municipal
  totalCopies: number;
  availableCopies: number;

  // Exemplares alocados em cada Escola (chave = schoolId)
  copiesBySchool?: Record<string, SchoolCopyHolding>;

  // Campos de compatibilidade retroativa / escola padrão
  schoolId?: string;
  schoolName?: string;
  location?: string;

  createdAt?: number;
  updatedAt?: number;
}

export interface BookMovement {
  id?: string;
  type?: 'remanejamento' | 'ajuste_inventario' | 'entrada' | 'baixa';
  bookId: string;
  bookTitle: string;
  bookCode?: string;
  sourceSchoolId: string;
  sourceSchoolName: string;
  targetSchoolId: string;
  targetSchoolName: string;
  copies: number;
  previousCopies?: number;
  newCopies?: number;
  date: string; // YYYY-MM-DD
  reason?: string; // Motivo: Remanejamento, Doação, Descarte, Ajuste de Inventário
  responsibleUid?: string;
  responsibleName?: string;
  userName?: string;
  createdAt?: number;
}

export interface BookLoan {
  id?: string;
  bookId: string;
  bookTitle: string;
  bookCode?: string;
  studentId: string;
  studentName: string;
  studentNumber?: number | string;
  studentRa?: string;
  classId: string;
  className?: string; // Ex: '1º Ano A'
  schoolId?: string; // ID da escola onde o empréstimo foi realizado
  schoolName?: string;
  loanDate: string; // YYYY-MM-DD
  dueDate: string; // Data prevista de devolução YYYY-MM-DD
  returnDate?: string; // Data real de devolução YYYY-MM-DD
  status: 'ativo' | 'devolvido' | 'atrasado';
  renewalsCount?: number; // Contador de renovações
  notes?: string; // Observações sobre conservação ou atraso
  registeredByUid?: string;
  registeredByName?: string;
  isReadingCorner?: boolean; // Se o empréstimo foi feito diretamente no Cantinho da Leitura da sala de aula
  readingCornerTurmaId?: string;
  readingCornerTurmaName?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ReadingCornerBook {
  id?: string;
  turmaId: string;
  turmaName: string;
  schoolId: string;
  schoolName: string;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookCode?: string;
  coverUrl?: string;
  genre?: string;
  totalCopies: number; // Quantidade total enviada para o Cantinho da Leitura da sala
  availableCopies: number; // Quantidade presente na estante da sala (não emprestada a alunos)
  allocatedAt: number;
  allocatedByUid?: string;
  allocatedByName?: string;
  notes?: string;
  updatedAt?: number;
}

export interface TeacherAssignment {
  id?: string;
  teacherId: string;
  classId: string;
  anoLetivo?: string;
  subject?: string; // Matéria específica atribuída
  createdAt?: number;
}

export type ScreenType =
  | 'login-screen'
  | 'dashboard'
  | 'schools-screen'
  | 'schools'
  | 'classes-screen'
  | 'classes'
  | 'students-screen'
  | 'students'
  | 'teachers-screen'
  | 'teachers'
  | 'assignments-screen'
  | 'assignments'
  | 'attendance-screen'
  | 'attendance'
  | 'lesson-plan-screen'
  | 'lessonPlan'
  | 'events-screen'
  | 'events'
  | 'event-types-screen'
  | 'eventTypes'
  | 'bncc-screen'
  | 'bncc'
  | 'grades-screen'
  | 'grades'
  | 'reports-screen'
  | 'reports'
  | 'categories-screen'
  | 'categories'
  | 'subjects-screen'
  | 'subjects'
  | 'library-screen'
  | 'library'
  | 'backup-screen'
  | 'backup'
  | 'schedule-screen'
  | 'schedule'
  | 'presentation-screen'
  | 'presentation';

export interface ModalConfig {
  isOpen: boolean;
  type?: 'alert' | 'confirm' | 'custom';
  title?: string;
  message?: string;
  icon?: string;
  danger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  children?: React.ReactNode;
}

const DIAS_UTEIS_PADRAO: number[] = [1, 2, 3, 4, 5];

/**
 * Converte valores heterogêneos do Firebase RTDB (Array de números/strings,
 * Objeto esparso `{ "1": 2, "2": 3 }` ou mapa booleano `{ "1": true }`)
 * para uma lista ordenada de dias da semana (1=Seg .. 5=Sex).
 */
export function normalizarDiasDisponiveis(raw: unknown): number[] {
  if (!raw) return [...DIAS_UTEIS_PADRAO];

  const extrairDiaDeChave = (chave: string): number | null => {
    const num = Number(chave);
    if (Number.isInteger(num) && num >= 1 && num <= 5) return num;
    const low = chave.trim().toLowerCase();
    if (low.startsWith('seg')) return 1;
    if (low.startsWith('ter')) return 2;
    if (low.startsWith('qua')) return 3;
    if (low.startsWith('qui')) return 4;
    if (low.startsWith('sex')) return 5;
    return null;
  };

  let coletados: number[] = [];

  if (Array.isArray(raw)) {
    coletados = raw
      .map((item) => Number(item))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  } else if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const entries = Object.entries(obj);
    const pareceMapaBooleano = entries.some(([, v]) => typeof v === 'boolean');
    if (pareceMapaBooleano) {
      entries.forEach(([k, v]) => {
        if (v === true || v === 'true' || v === 1) {
          const d = extrairDiaDeChave(k);
          if (d) coletados.push(d);
        }
      });
    } else {
      coletados = Object.values(obj)
        .map((item) => Number(item))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    }
  }

  const unicos = Array.from(new Set(coletados)).sort((a, b) => a - b);
  return unicos.length > 0 ? unicos : [...DIAS_UTEIS_PADRAO];
}

function parseTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function extrairDiasEfetivosRegistro(val: Teacher | null | undefined): number[] | null {
  if (!val) return null;
  const hasDias = val.diasDisponiveis !== undefined && val.diasDisponiveis !== null;
  const rawFolga = (val as any).folgaDia;
  const folgaNum = rawFolga !== undefined && rawFolga !== null ? Number(rawFolga) : NaN;
  const hasFolga = Number.isInteger(folgaNum) && folgaNum >= 1 && folgaNum <= 5;
  if (!hasDias && !hasFolga) return null;

  let dias = hasDias ? normalizarDiasDisponiveis(val.diasDisponiveis) : [...DIAS_UTEIS_PADRAO];
  if (hasFolga) {
    dias = dias.filter((d) => d !== folgaNum);
  }
  return dias.length > 0 ? dias : [...DIAS_UTEIS_PADRAO];
}

/**
 * Resolve `diasDisponiveis` considerando possíveis registros espelho do mesmo docente
 * (ex: ID manual vs `authUid` ou mesmo e-mail em `diario-classe/professores`).
 */
export function resolverDiasDisponiveisDocente(
  docente: { id: string; val?: Teacher | null } | null | undefined,
  todosDocentes?: Array<{ id: string; val: Teacher }>
): number[] {
  if (!docente?.val) return [...DIAS_UTEIS_PADRAO];
  const proprioDias = extrairDiasEfetivosRegistro(docente.val);

  if (!todosDocentes || todosDocentes.length === 0) {
    return proprioDias || [...DIAS_UTEIS_PADRAO];
  }

  const normMail = (v?: string) => (v || '').trim().toLowerCase();
  const seedsIds = new Set<string>([docente.id]);
  if (docente.val.authUid) seedsIds.add(docente.val.authUid);
  const seedsEmails = new Set<string>();
  const addEmails = (v?: Teacher | null) => {
    if (!v) return;
    const m1 = normMail(v.email);
    const m2 = normMail((v as any).authEmail);
    if (m1) seedsEmails.add(m1);
    if (m2) seedsEmails.add(m2);
  };
  addEmails(docente.val);

  // Coleta transitiva de aliases que compartilhem id, authUid ou e-mail
  let expanded = true;
  while (expanded) {
    expanded = false;
    todosDocentes.forEach((other) => {
      const oMail = normMail(other.val.email);
      const oAuthMail = normMail((other.val as any).authEmail);
      const matches =
        seedsIds.has(other.id) ||
        (other.val.authUid ? seedsIds.has(other.val.authUid) : false) ||
        (oMail ? seedsEmails.has(oMail) : false) ||
        (oAuthMail ? seedsEmails.has(oAuthMail) : false);
      if (matches) {
        if (!seedsIds.has(other.id)) {
          seedsIds.add(other.id);
          expanded = true;
        }
        if (other.val.authUid && !seedsIds.has(other.val.authUid)) {
          seedsIds.add(other.val.authUid);
          expanded = true;
        }
        if (oMail && !seedsEmails.has(oMail)) {
          seedsEmails.add(oMail);
          expanded = true;
        }
        if (oAuthMail && !seedsEmails.has(oAuthMail)) {
          seedsEmails.add(oAuthMail);
          expanded = true;
        }
      }
    });
  }

  const aliases = todosDocentes.filter(
    (other) =>
      seedsIds.has(other.id) ||
      (other.val.authUid ? seedsIds.has(other.val.authUid) : false) ||
      (normMail(other.val.email) ? seedsEmails.has(normMail(other.val.email)) : false) ||
      (normMail((other.val as any).authEmail) ? seedsEmails.has(normMail((other.val as any).authEmail)) : false)
  );
  if (!aliases.some((a) => a.id === docente.id)) {
    aliases.push({ id: docente.id, val: docente.val });
  }

  const candidatos = aliases
    .map((a) => {
      const dias = extrairDiasEfetivosRegistro(a.val);
      if (!dias) return null;
      return {
        isProprio: a.id === docente.id,
        dias,
        diasUpdatedAt: parseTimestampMs((a.val as any).diasDisponiveisUpdatedAt),
        updatedAt: parseTimestampMs(a.val.updatedAt)
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidatos.length === 0) {
    return [...DIAS_UTEIS_PADRAO];
  }

  // Se algum registro possui marcação específica de edição da escala/folga, prioriza-o sobre edições genéricas (ex: metaHA)
  const algumTemDiasUpdatedAt = candidatos.some((c) => c.diasUpdatedAt > 0);
  candidatos.sort((a, b) => {
    if (algumTemDiasUpdatedAt && b.diasUpdatedAt !== a.diasUpdatedAt) {
      return b.diasUpdatedAt - a.diasUpdatedAt;
    }
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    const aTemFolga = a.dias.length < 5 ? 1 : 0;
    const bTemFolga = b.dias.length < 5 ? 1 : 0;
    if (bTemFolga !== aTemFolga) return bTemFolga - aTemFolga;
    return (b.isProprio ? 1 : 0) - (a.isProprio ? 1 : 0);
  });

  return candidatos[0].dias;
}

/**
 * Retorna os IDs dos dias da semana (1..5) em que o docente está de folga / ausente.
 */
export function obterDiasFolga(diasDisponiveisRaw?: unknown, folgaDia?: number | null): number[] {
  const diasAtivos = normalizarDiasDisponiveis(diasDisponiveisRaw);
  const setFolga = new Set<number>(DIAS_UTEIS_PADRAO.filter((d) => !diasAtivos.includes(d)));
  if (typeof folgaDia === 'number' && folgaDia >= 1 && folgaDia <= 5) {
    setFolga.add(folgaDia);
  }
  return Array.from(setFolga).sort((a, b) => a - b);
}

/**
 * Formata textualmente os dias de folga do docente (ex: "Quinta-feira", "Qui, Sex" ou "Sem folga fixa").
 */
export function formatarDiasFolgaResumo(
  diasDisponiveisRaw?: unknown,
  folgaDia?: number | null,
  curto = false
): string {
  const folgas = obterDiasFolga(diasDisponiveisRaw, folgaDia);
  if (folgas.length === 0) return 'Sem folga fixa';
  const nomesCompletos = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
  const nomesCurtos = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  return folgas
    .map((d) => (curto ? nomesCurtos[d - 1] : nomesCompletos[d - 1]) || `Dia ${d}`)
    .join(', ');
}

