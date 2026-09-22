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
  transferDate?: string;
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
}

export const DEFAULT_SUBJECTS: SubjectItem[] = [
  { id: 'portugues', name: 'Língua Portuguesa', shortName: 'LP', category: 'regente' },
  { id: 'matematica', name: 'Matemática', shortName: 'MAT', category: 'regente' },
  { id: 'ciencias', name: 'Ciências', shortName: 'CIE', category: 'regente' },
  { id: 'historia', name: 'História', shortName: 'HIST', category: 'regente' },
  { id: 'geografia', name: 'Geografia', shortName: 'GEO', category: 'regente' },
  { id: 'arte', name: 'Arte', shortName: 'ART', category: 'diversificada' },
  { id: 'ed_fisica', name: 'Educação Física', shortName: 'EF', category: 'diversificada' },
  { id: 'ingles', name: 'Língua Inglesa', shortName: 'ING', category: 'diversificada' },
  { id: 'ens_religioso', name: 'Ensino Religioso', shortName: 'ER', category: 'regente' }
];

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
  | 'backup';

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
