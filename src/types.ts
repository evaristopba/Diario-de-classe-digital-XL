import React from 'react';

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
  intervaloGrupo?: 'A' | 'B'; // 'A': 09:30-09:50 (Infantil/1º-3º), 'B': 10:00-10:20 (4º e 5º anos)
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
  horarioCustomInicio?: string; // Ex: '09:30' (ajuste pontual de horário)
  horarioCustomFim?: string; // Ex: '10:20'
  observacao?: string; // Ex: 'Aula adiantada/subida', 'Permuta com Ed. Física'
}

export const GRADE_DIAS_SEMANA = [
  { id: 1 as DiaSemana, nome: 'Segunda-feira', sigla: 'SEG', curto: 'Seg' },
  { id: 2 as DiaSemana, nome: 'Terça-feira', sigla: 'TER', curto: 'Ter' },
  { id: 3 as DiaSemana, nome: 'Quarta-feira', sigla: 'QUA', curto: 'Qua' },
  { id: 4 as DiaSemana, nome: 'Quinta-feira', sigla: 'QUI', curto: 'Qui' },
  { id: 5 as DiaSemana, nome: 'Sexta-feira', sigla: 'SEX', curto: 'Sex' }
];

export const HORARIOS_SINO = {
  matutino: {
    A: {
      grupo: 'A' as const,
      nome: 'Grupo A (Infantil / 1º ao 3º Ano)',
      intervalo: { inicio: '09:30', fim: '09:50', duracaoMin: 20, rotulo: 'Intervalo / Recreio (09:30 – 09:50)' },
      refeicaoFinal: { inicio: '11:30', fim: '12:00', duracaoMin: 30, rotulo: 'Refeição e Saída (11:30 – 12:00)' },
      aulas: [
        { ordem: 1, nome: '1ª Aula', inicio: '07:00', fim: '07:50', duracaoMin: 50 },
        { ordem: 2, nome: '2ª Aula', inicio: '07:50', fim: '08:40', duracaoMin: 50 },
        { ordem: 3, nome: '3ª Aula', inicio: '08:40', fim: '09:30', duracaoMin: 50 },
        { ordem: 4, nome: '4ª Aula', inicio: '09:50', fim: '10:40', duracaoMin: 50 },
        { ordem: 5, nome: '5ª Aula', inicio: '10:40', fim: '11:30', duracaoMin: 50 }
      ]
    },
    B: {
      grupo: 'B' as const,
      nome: 'Grupo B (4º e 5º Anos)',
      intervalo: { inicio: '10:00', fim: '10:20', duracaoMin: 20, rotulo: 'Intervalo / Recreio (10:00 – 10:20)' },
      complementar: { inicio: '09:30', fim: '10:00', duracaoMin: 30, rotulo: 'Leitura / Lanche dos Maiores (09:30 – 10:00)' },
      aulas: [
        { ordem: 1, nome: '1ª Aula', inicio: '07:00', fim: '07:50', duracaoMin: 50 },
        { ordem: 2, nome: '2ª Aula', inicio: '07:50', fim: '08:40', duracaoMin: 50 },
        { ordem: 3, nome: '3ª Aula', inicio: '08:40', fim: '09:30', duracaoMin: 50 },
        { ordem: 4, nome: '4ª Aula', inicio: '10:20', fim: '11:10', duracaoMin: 50 },
        { ordem: 5, nome: '5ª Aula', inicio: '11:10', fim: '12:00', duracaoMin: 50 }
      ]
    }
  },
  vespertino: {
    padrao: {
      grupo: 'T' as const,
      nome: 'Vespertino (Todas as Turmas)',
      intervalo: { inicio: '15:00', fim: '15:20', duracaoMin: 20, rotulo: 'Intervalo / Recreio (15:00 – 15:20)' },
      aulas: [
        { ordem: 1, nome: '1ª Aula', inicio: '12:30', fim: '13:20', duracaoMin: 50 },
        { ordem: 2, nome: '2ª Aula', inicio: '13:20', fim: '14:10', duracaoMin: 50 },
        { ordem: 3, nome: '3ª Aula', inicio: '14:10', fim: '15:00', duracaoMin: 50 },
        { ordem: 4, nome: '4ª Aula', inicio: '15:20', fim: '16:10', duracaoMin: 50 },
        { ordem: 5, nome: '5ª Aula', inicio: '16:10', fim: '17:00', duracaoMin: 50 }
      ]
    }
  }
};

export function getHorariosTurma(shift?: string, intervaloGrupo?: 'A' | 'B', year?: string) {
  const isVespertino = (shift || '').toLowerCase().includes('vesp') || (shift || '').toLowerCase().includes('tarde');
  if (isVespertino) {
    return HORARIOS_SINO.vespertino.padrao;
  }
  const grupo = intervaloGrupo || (year === '4' || year === '5' ? 'B' : 'A');
  return HORARIOS_SINO.matutino[grupo] || HORARIOS_SINO.matutino.A;
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
  classItem: { shift?: string; intervaloGrupo?: 'A' | 'B'; year?: string },
  ordem: number,
  customInicio?: string,
  customFim?: string
): { startMin: number; endMin: number; inicioStr: string; fimStr: string } {
  const cStart = timeToMinutes(customInicio);
  const cEnd = timeToMinutes(customFim);
  if (cStart !== null && cEnd !== null && cEnd > cStart) {
    return { startMin: cStart, endMin: cEnd, inicioStr: customInicio!, fimStr: customFim! };
  }
  const sched = getHorariosTurma(classItem.shift, classItem.intervaloGrupo, classItem.year);
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
