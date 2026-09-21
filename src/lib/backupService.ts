import { ref, get, set, update, rtdb, dc, getCurrentAuthUid, auth } from './firebase';
import {
  School,
  ClassRoom,
  Student,
  Teacher,
  SubjectItem,
  BNCCSkill,
  Category,
  EventType,
  AttendanceRecord,
  GradeRecord,
  LessonPlan,
  EventOccurrence,
  Book,
  BookLoan
} from '../types';

export interface BackupMetadata {
  appName: string;
  version: string;
  exportedAt: string;
  timestamp: number;
  exportedByUid?: string;
  exportedByName?: string;
  exportedByEmail?: string;
  system: string;
  recordCounts: {
    schools: number;
    classes: number;
    students: number;
    teachers: number;
    assignments: number;
    subjects: number;
    bncc: number;
    categories: number;
    eventTypes: number;
    attendances: number;
    grades: number;
    lessonPlans: number;
    events: number;
    books?: number;
    loans?: number;
    totalRecords: number;
  };
}

export interface BackupDataPayload {
  schools?: Record<string, School>;
  classes?: Record<string, ClassRoom>;
  teachers?: Record<string, Teacher>;
  assignments?: Record<string, Record<string, boolean>>;
  subjects?: Record<string, SubjectItem>;
  bncc?: Record<string, BNCCSkill>;
  categories?: Record<string, Category>;
  eventTypes?: Record<string, EventType>;
  books?: Record<string, Book>;
  loans?: Record<string, BookLoan>;
  // Dados pedagógicos do usuário autenticado
  attendances?: Record<string, AttendanceRecord>;
  grades?: Record<string, GradeRecord>;
  lessonPlans?: Record<string, LessonPlan>;
  events?: Record<string, EventOccurrence>;
  // Dados de todos os professores caso seja admin com acesso
  allUsersPedagogical?: Record<string, {
    chamada?: Record<string, AttendanceRecord>;
    notas?: Record<string, GradeRecord>;
    'planos-aula'?: Record<string, LessonPlan>;
    eventos?: Record<string, EventOccurrence>;
  }>;
}

export interface BackupPackage {
  metadata: BackupMetadata;
  data: BackupDataPayload;
}

export interface BackupHistoryItem {
  id: string;
  timestamp: number;
  dateStr: string;
  filename: string;
  totalRecords: number;
  sizeBytes?: number;
  exportedBy?: string;
  isAutomatic?: boolean;
}

export interface RestoreOptions {
  includeSchools: boolean;
  includeClassesAndStudents: boolean;
  includeTeachers: boolean;
  includeAssignments: boolean;
  includeSubjects: boolean;
  includeBNCC: boolean;
  includeCategories: boolean;
  includeEventTypes: boolean;
  includeAttendance: boolean;
  includeGrades: boolean;
  includeLessonPlans: boolean;
  includeEvents: boolean;
  includeLibrary?: boolean;
  mode: 'merge' | 'overwrite_selected';
}

const STORAGE_LAST_BACKUP_KEY = 'dc_last_backup_timestamp';
const STORAGE_BACKUP_HISTORY_KEY = 'dc_backup_history';
const STORAGE_REMINDER_FREQ_KEY = 'dc_backup_reminder_frequency_days';

// 1. Gera o Backup Completo do Banco de Dados
export async function generateFullBackup(userProfile?: {
  uid?: string;
  name?: string;
  email?: string;
}): Promise<{
  jsonString: string;
  jsonBlob: Blob;
  filename: string;
  backupPkg: BackupPackage;
}> {
  const uid = userProfile?.uid || getCurrentAuthUid() || auth.currentUser?.uid || 'anon';
  const name = userProfile?.name || auth.currentUser?.displayName || localStorage.getItem('dc_teacher_name') || 'Professor / Administrador';
  const email = userProfile?.email || auth.currentUser?.email || '';

  // 1. Carregar Coleções Compartilhadas
  const [
    escolasSnap,
    turmasSnap,
    professoresSnap,
    atribuicoesSnap,
    disciplinasSnap,
    bnccSnap,
    categoriasSnap,
    tiposEventoSnap,
    livrosSnap,
    emprestimosSnap
  ] = await Promise.all([
    get(ref(rtdb, 'diario-classe/escolas')).catch(() => null),
    get(ref(rtdb, 'diario-classe/turmas')).catch(() => null),
    get(ref(rtdb, 'diario-classe/professores')).catch(() => null),
    get(ref(rtdb, 'diario-classe/atribuicoes')).catch(() => null),
    get(ref(rtdb, 'diario-classe/disciplinas')).catch(() => null),
    get(ref(rtdb, 'diario-classe/bncc')).catch(() => null),
    get(ref(rtdb, 'diario-classe/categorias')).catch(() => null),
    get(ref(rtdb, 'diario-classe/tipos-evento')).catch(() => null),
    get(ref(rtdb, 'diario-classe/biblioteca/livros')).catch(() => null),
    get(ref(rtdb, 'diario-classe/biblioteca/emprestimos')).catch(() => null)
  ]);

  const schools = (escolasSnap?.val() || {}) as Record<string, School>;
  const classes = (turmasSnap?.val() || {}) as Record<string, ClassRoom>;
  const teachers = (professoresSnap?.val() || {}) as Record<string, Teacher>;
  const assignments = (atribuicoesSnap?.val() || {}) as Record<string, Record<string, boolean>>;
  const subjects = (disciplinasSnap?.val() || {}) as Record<string, SubjectItem>;
  const bncc = (bnccSnap?.val() || {}) as Record<string, BNCCSkill>;
  const categories = (categoriasSnap?.val() || {}) as Record<string, Category>;
  const eventTypes = (tiposEventoSnap?.val() || {}) as Record<string, EventType>;
  const books = (livrosSnap?.val() || {}) as Record<string, Book>;
  const loans = (emprestimosSnap?.val() || {}) as Record<string, BookLoan>;

  // 2. Contabilizar alunos dentro das turmas
  let totalStudents = 0;
  Object.values(classes).forEach((turma) => {
    if (turma.alunos) {
      totalStudents += Object.keys(turma.alunos).length;
    }
  });

  // 3. Carregar Dados Pedagógicos do Usuário Atual
  let attendances: Record<string, AttendanceRecord> = {};
  let grades: Record<string, GradeRecord> = {};
  let lessonPlans: Record<string, LessonPlan> = {};
  let events: Record<string, EventOccurrence> = {};
  let allUsersPedagogical: Record<string, any> | undefined = undefined;

  if (uid && uid !== 'anon') {
    try {
      const [chamadaSnap, notasSnap, planosSnap, eventosSnap] = await Promise.all([
        get(ref(rtdb, dc('chamada'))).catch(() => null),
        get(ref(rtdb, dc('notas'))).catch(() => null),
        get(ref(rtdb, dc('planos-aula'))).catch(() => null),
        get(ref(rtdb, dc('eventos'))).catch(() => null)
      ]);

      attendances = (chamadaSnap?.val() || {}) as Record<string, AttendanceRecord>;
      grades = (notasSnap?.val() || {}) as Record<string, GradeRecord>;
      lessonPlans = (planosSnap?.val() || {}) as Record<string, LessonPlan>;
      events = (eventosSnap?.val() || {}) as Record<string, EventOccurrence>;
    } catch (e) {
      console.warn('Erro ao carregar dados pedagógicos pessoais para backup:', e);
    }

    // Se for administrador, tenta ler o nó global diario-classe/dados
    try {
      const globalDadosSnap = await get(ref(rtdb, 'diario-classe/dados')).catch(() => null);
      if (globalDadosSnap && globalDadosSnap.exists()) {
        allUsersPedagogical = globalDadosSnap.val();
      }
    } catch {
      // Ignora se não tiver permissão global
    }
  }

  // 4. Calcular Estatísticas
  let totalAttendancesCount = Object.keys(attendances).length;
  let totalGradesCount = Object.keys(grades).length;
  let totalLessonPlansCount = Object.keys(lessonPlans).length;
  let totalEventsCount = Object.keys(events).length;

  if (allUsersPedagogical) {
    let globalAtt = 0;
    let globalNotas = 0;
    let globalPlanos = 0;
    let globalEv = 0;

    Object.values(allUsersPedagogical).forEach((uData: any) => {
      if (uData?.chamada) globalAtt += Object.keys(uData.chamada).length;
      if (uData?.notas) globalNotas += Object.keys(uData.notas).length;
      if (uData?.['planos-aula']) globalPlanos += Object.keys(uData['planos-aula']).length;
      if (uData?.eventos) globalEv += Object.keys(uData.eventos).length;
    });

    if (globalAtt > totalAttendancesCount) totalAttendancesCount = globalAtt;
    if (globalNotas > totalGradesCount) totalGradesCount = globalNotas;
    if (globalPlanos > totalLessonPlansCount) totalLessonPlansCount = globalPlanos;
    if (globalEv > totalEventsCount) totalEventsCount = globalEv;
  }

  const schoolsCount = Object.keys(schools).length;
  const classesCount = Object.keys(classes).length;
  const teachersCount = Object.keys(teachers).length;
  const assignmentsCount = Object.keys(assignments).length;
  const subjectsCount = Object.keys(subjects).length;
  const bnccCount = Object.keys(bncc).length;
  const categoriesCount = Object.keys(categories).length;
  const eventTypesCount = Object.keys(eventTypes).length;
  const booksCount = Object.keys(books).length;
  const loansCount = Object.keys(loans).length;

  const totalRecords =
    schoolsCount +
    classesCount +
    totalStudents +
    teachersCount +
    assignmentsCount +
    subjectsCount +
    bnccCount +
    categoriesCount +
    eventTypesCount +
    booksCount +
    loansCount +
    totalAttendancesCount +
    totalGradesCount +
    totalLessonPlansCount +
    totalEventsCount;

  const now = new Date();
  const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
  const filename = `backup-diario-de-classe-${dateStr}.json`;

  const backupPkg: BackupPackage = {
    metadata: {
      appName: 'Diário de Classe Digital',
      version: '2.0',
      exportedAt: now.toISOString(),
      timestamp: now.getTime(),
      exportedByUid: uid,
      exportedByName: name,
      exportedByEmail: email,
      system: 'Firebase Realtime Database',
      recordCounts: {
        schools: schoolsCount,
        classes: classesCount,
        students: totalStudents,
        teachers: teachersCount,
        assignments: assignmentsCount,
        subjects: subjectsCount,
        bncc: bnccCount,
        categories: categoriesCount,
        eventTypes: eventTypesCount,
        attendances: totalAttendancesCount,
        grades: totalGradesCount,
        lessonPlans: totalLessonPlansCount,
        events: totalEventsCount,
        books: booksCount,
        loans: loansCount,
        totalRecords
      }
    },
    data: {
      schools,
      classes,
      teachers,
      assignments,
      subjects,
      bncc,
      categories,
      eventTypes,
      books,
      loans,
      attendances,
      grades,
      lessonPlans,
      events,
      allUsersPedagogical
    }
  };

  const jsonString = JSON.stringify(backupPkg, null, 2);
  const jsonBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });

  // Salva no histórico de backups
  recordBackupInHistory({
    id: `bkp_${now.getTime()}`,
    timestamp: now.getTime(),
    dateStr: now.toLocaleString('pt-BR'),
    filename,
    totalRecords,
    sizeBytes: jsonBlob.size,
    exportedBy: name
  });

  return {
    jsonString,
    jsonBlob,
    filename,
    backupPkg
  };
}

// 2. Valida arquivo de backup carregado
export function validateBackupFile(jsonString: string): {
  isValid: boolean;
  error?: string;
  backup?: BackupPackage;
} {
  try {
    const parsed = JSON.parse(jsonString);

    if (!parsed || typeof parsed !== 'object') {
      return { isValid: false, error: 'O arquivo não contém um objeto JSON válido.' };
    }

    // Suporte a formato com metadata ou export direto de dados
    let backupPkg: BackupPackage;

    if (parsed.metadata && parsed.data) {
      backupPkg = parsed as BackupPackage;
    } else {
      // Cria wrapper de compatibilidade
      const data = parsed.data || parsed;
      const schools = data.schools || data.escolas || {};
      const classes = data.classes || data.turmas || {};
      const teachers = data.teachers || data.professores || {};
      const subjects = data.subjects || data.disciplinas || {};
      const bncc = data.bncc || {};
      const categories = data.categories || data.categorias || {};
      const eventTypes = data.eventTypes || data.tiposEvento || data['tipos-evento'] || {};
      const books = data.books || data.livros || {};
      const loans = data.loans || data.emprestimos || {};
      const attendances = data.attendances || data.chamada || {};
      const grades = data.grades || data.notas || {};
      const lessonPlans = data.lessonPlans || data['planos-aula'] || {};
      const events = data.events || data.eventos || {};

      let totalStudents = 0;
      Object.values(classes as Record<string, ClassRoom>).forEach((c) => {
        if (c.alunos) totalStudents += Object.keys(c.alunos).length;
      });

      const totalRecords =
        Object.keys(schools).length +
        Object.keys(classes).length +
        totalStudents +
        Object.keys(teachers).length +
        Object.keys(subjects).length +
        Object.keys(bncc).length +
        Object.keys(categories).length +
        Object.keys(eventTypes).length +
        Object.keys(books).length +
        Object.keys(loans).length +
        Object.keys(attendances).length +
        Object.keys(grades).length +
        Object.keys(lessonPlans).length +
        Object.keys(events).length;

      backupPkg = {
        metadata: {
          appName: 'Diário de Classe (Importado)',
          version: '2.0',
          exportedAt: new Date().toISOString(),
          timestamp: Date.now(),
          system: 'Importação Manual',
          recordCounts: {
            schools: Object.keys(schools).length,
            classes: Object.keys(classes).length,
            students: totalStudents,
            teachers: Object.keys(teachers).length,
            assignments: Object.keys(data.assignments || data.atribuicoes || {}).length,
            subjects: Object.keys(subjects).length,
            bncc: Object.keys(bncc).length,
            categories: Object.keys(categories).length,
            eventTypes: Object.keys(eventTypes).length,
            books: Object.keys(books).length,
            loans: Object.keys(loans).length,
            attendances: Object.keys(attendances).length,
            grades: Object.keys(grades).length,
            lessonPlans: Object.keys(lessonPlans).length,
            events: Object.keys(events).length,
            totalRecords
          }
        },
        data: {
          schools,
          classes,
          teachers,
          assignments: data.assignments || data.atribuicoes || {},
          subjects,
          bncc,
          categories,
          eventTypes,
          books,
          loans,
          attendances,
          grades,
          lessonPlans,
          events,
          allUsersPedagogical: data.allUsersPedagogical || data.dados
        }
      };
    }

    // Checagem se contém ao menos 1 registro relevante
    if (backupPkg.metadata.recordCounts.totalRecords === 0 && Object.keys(backupPkg.data).length === 0) {
      return {
        isValid: false,
        error: 'O arquivo de backup está vazio ou não contém registros compatíveis do Diário de Classe.'
      };
    }

    return { isValid: true, backup: backupPkg };
  } catch (err: any) {
    return { isValid: false, error: `Falha ao interpretar JSON: ${err.message || 'Arquivo corrompido'}` };
  }
}

// 3. Restauração Segura dos Dados no Firebase
export async function restoreBackup(
  backupPkg: BackupPackage,
  options: RestoreOptions,
  onProgress?: (message: string, percent: number) => void
): Promise<{
  success: boolean;
  importedCounts: Record<string, number>;
  errors: string[];
}> {
  const currentUid = getCurrentAuthUid() || auth.currentUser?.uid;
  if (!currentUid) {
    throw new Error('Você precisa estar autenticado no sistema para restaurar um backup.');
  }

  const errors: string[] = [];
  const importedCounts: Record<string, number> = {
    schools: 0,
    classes: 0,
    students: 0,
    teachers: 0,
    assignments: 0,
    subjects: 0,
    bncc: 0,
    categories: 0,
    eventTypes: 0,
    attendances: 0,
    grades: 0,
    lessonPlans: 0,
    events: 0,
    books: 0,
    loans: 0
  };

  const totalSteps = 11;
  let currentStep = 0;

  const report = (msg: string) => {
    currentStep++;
    const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
    if (onProgress) onProgress(msg, percent);
  };

  try {
    const rootUpdates: Record<string, any> = {};

    // 1. Restaurar Escolas
    if (options.includeSchools && backupPkg.data.schools) {
      report('Restaurando unidades escolares...');
      const schools = backupPkg.data.schools;
      Object.keys(schools).forEach((id) => {
        if (schools[id]) {
          rootUpdates[`diario-classe/escolas/${id}`] = schools[id];
          importedCounts.schools++;
        }
      });
    }

    // 2. Restaurar Turmas & Alunos
    if (options.includeClassesAndStudents && backupPkg.data.classes) {
      report('Restaurando turmas e cadastros de alunos...');
      const classes = backupPkg.data.classes;
      Object.keys(classes).forEach((id) => {
        const turma = classes[id];
        if (turma) {
          rootUpdates[`diario-classe/turmas/${id}`] = turma;
          importedCounts.classes++;
          if (turma.alunos) {
            importedCounts.students += Object.keys(turma.alunos).length;
          }
        }
      });
    }

    // 3. Restaurar Professores
    if (options.includeTeachers && backupPkg.data.teachers) {
      report('Restaurando corpo docente e professores...');
      const teachers = backupPkg.data.teachers;
      Object.keys(teachers).forEach((id) => {
        if (teachers[id]) {
          rootUpdates[`diario-classe/professores/${id}`] = teachers[id];
          importedCounts.teachers++;
        }
      });
    }

    // 4. Restaurar Atribuições
    if (options.includeAssignments && backupPkg.data.assignments) {
      report('Restaurando mapa de atribuições...');
      const assignments = backupPkg.data.assignments;
      Object.keys(assignments).forEach((tId) => {
        const map = assignments[tId];
        if (map) {
          rootUpdates[`diario-classe/atribuicoes/${tId}`] = map;
          importedCounts.assignments += Object.keys(map).length;
        }
      });
    }

    // 5. Restaurar Disciplinas
    if (options.includeSubjects && backupPkg.data.subjects) {
      report('Restaurando disciplinas curriculares...');
      const subjects = backupPkg.data.subjects;
      Object.keys(subjects).forEach((id) => {
        if (subjects[id]) {
          rootUpdates[`diario-classe/disciplinas/${id}`] = subjects[id];
          importedCounts.subjects++;
        }
      });
    }

    // 6. Restaurar BNCC
    if (options.includeBNCC && backupPkg.data.bncc) {
      report('Restaurando matriz de habilidades BNCC...');
      const bncc = backupPkg.data.bncc;
      Object.keys(bncc).forEach((id) => {
        if (bncc[id]) {
          rootUpdates[`diario-classe/bncc/${id}`] = bncc[id];
          importedCounts.bncc++;
        }
      });
    }

    // 7. Restaurar Categorias e Tipos de Evento
    if (options.includeCategories && backupPkg.data.categories) {
      report('Restaurando categorias pedagógicas...');
      const categories = backupPkg.data.categories;
      Object.keys(categories).forEach((id) => {
        if (categories[id]) {
          rootUpdates[`diario-classe/categorias/${id}`] = categories[id];
          importedCounts.categories++;
        }
      });
    }

    if (options.includeEventTypes && backupPkg.data.eventTypes) {
      report('Restaurando tipos de ocorrências...');
      const eventTypes = backupPkg.data.eventTypes;
      Object.keys(eventTypes).forEach((id) => {
        if (eventTypes[id]) {
          rootUpdates[`diario-classe/tipos-evento/${id}`] = eventTypes[id];
          importedCounts.eventTypes++;
        }
      });
    }

    // 8. Restaurar Biblioteca Escolar (Livros e Empréstimos)
    if (options.includeLibrary !== false && (backupPkg.data.books || backupPkg.data.loans)) {
      report('Restaurando acervo e empréstimos da biblioteca...');
      const books = backupPkg.data.books || {};
      Object.keys(books).forEach((id) => {
        if (books[id]) {
          rootUpdates[`diario-classe/biblioteca/livros/${id}`] = books[id];
          importedCounts.books++;
        }
      });

      const loans = backupPkg.data.loans || {};
      Object.keys(loans).forEach((id) => {
        if (loans[id]) {
          rootUpdates[`diario-classe/biblioteca/emprestimos/${id}`] = loans[id];
          importedCounts.loans++;
        }
      });
    }

    // Aplica alterações nas coleções globais
    if (Object.keys(rootUpdates).length > 0) {
      try {
        await update(ref(rtdb), rootUpdates);
      } catch (err: any) {
        console.error('Erro ao atualizar coleções compartilhadas:', err);
        errors.push(`Coleções compartilhadas: ${err.message}`);
      }
    }

    // 8. Restaurar Dados Pedagógicos (Chamadas, Notas, Planos de Aula, Ocorrências)
    report('Gravando registros pedagógicos no diário...');
    const userUpdates: Record<string, any> = {};

    // Chamadas
    if (options.includeAttendance) {
      const atts = backupPkg.data.attendances || {};
      Object.keys(atts).forEach((id) => {
        if (atts[id]) {
          userUpdates[`chamada/${id}`] = atts[id];
          importedCounts.attendances++;
        }
      });
    }

    // Notas
    if (options.includeGrades) {
      const notas = backupPkg.data.grades || {};
      Object.keys(notas).forEach((id) => {
        if (notas[id]) {
          userUpdates[`notas/${id}`] = notas[id];
          importedCounts.grades++;
        }
      });
    }

    // Planos de Aula
    if (options.includeLessonPlans) {
      const planos = backupPkg.data.lessonPlans || {};
      Object.keys(planos).forEach((id) => {
        if (planos[id]) {
          userUpdates[`planos-aula/${id}`] = planos[id];
          importedCounts.lessonPlans++;
        }
      });
    }

    // Ocorrências
    if (options.includeEvents) {
      const evs = backupPkg.data.events || {};
      Object.keys(evs).forEach((id) => {
        if (evs[id]) {
          userUpdates[`eventos/${id}`] = evs[id];
          importedCounts.events++;
        }
      });
    }

    // Grava dados pedagógicos do usuário atual
    if (Object.keys(userUpdates).length > 0) {
      try {
        await update(ref(rtdb, `diario-classe/dados/${currentUid}`), userUpdates);
      } catch (err: any) {
        console.error('Erro ao atualizar dados pedagógicos do usuário:', err);
        errors.push(`Dados pedagógicos: ${err.message}`);
      }
    }

    // Se houver dados globais de outros professores no backup e o usuário tiver permissão
    if (backupPkg.data.allUsersPedagogical) {
      report('Sincronizando dados pedagógicos estendidos...');
      const allPed = backupPkg.data.allUsersPedagogical;
      const multiUserUpdates: Record<string, any> = {};
      Object.keys(allPed).forEach((otherUid) => {
        if (otherUid !== currentUid && allPed[otherUid]) {
          multiUserUpdates[`diario-classe/dados/${otherUid}`] = allPed[otherUid];
        }
      });
      if (Object.keys(multiUserUpdates).length > 0) {
        try {
          await update(ref(rtdb), multiUserUpdates);
        } catch {
          // Normal se não for admin master
        }
      }
    }

    report('Restauração concluída com sucesso!');
    return {
      success: errors.length === 0,
      importedCounts,
      errors
    };
  } catch (err: any) {
    errors.push(err.message || 'Erro inesperado durante a restauração');
    return {
      success: false,
      importedCounts,
      errors
    };
  }
}

// 4. Rotinas de Verificação e Lembretes de Backup
export function getBackupRoutineStatus(): {
  lastBackupTime: number | null;
  lastBackupDateStr: string;
  daysSinceLastBackup: number | null;
  reminderFrequencyDays: number;
  needsBackup: boolean;
  statusText: string;
  statusColor: 'emerald' | 'amber' | 'red';
} {
  const rawTimestamp = localStorage.getItem(STORAGE_LAST_BACKUP_KEY);
  const freqStr = localStorage.getItem(STORAGE_REMINDER_FREQ_KEY) || '7'; // padrão: 7 dias (semanal)
  const reminderFrequencyDays = parseInt(freqStr, 10) || 7;

  if (!rawTimestamp) {
    return {
      lastBackupTime: null,
      lastBackupDateStr: 'Nenhum backup registrado',
      daysSinceLastBackup: null,
      reminderFrequencyDays,
      needsBackup: true,
      statusText: 'Nenhum backup realizado ainda. Recomendado fazer agora!',
      statusColor: 'red'
    };
  }

  const lastTime = parseInt(rawTimestamp, 10);
  const now = Date.now();
  const diffMs = now - lastTime;
  const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const lastDate = new Date(lastTime);
  const lastBackupDateStr = lastDate.toLocaleDateString('pt-BR') + ' às ' + lastDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const needsBackup = daysSince >= reminderFrequencyDays;

  let statusText = '';
  let statusColor: 'emerald' | 'amber' | 'red' = 'emerald';

  if (daysSince === 0) {
    statusText = 'Backup realizado hoje. Dados em segurança!';
    statusColor = 'emerald';
  } else if (daysSince === 1) {
    statusText = 'Último backup realizado ontem.';
    statusColor = 'emerald';
  } else if (daysSince < reminderFrequencyDays) {
    statusText = `Último backup há ${daysSince} dias (Em dia).`;
    statusColor = 'emerald';
  } else {
    statusText = `Último backup realizado há ${daysSince} dias. Recomendamos gerar uma nova cópia de segurança!`;
    statusColor = daysSince >= reminderFrequencyDays * 2 ? 'red' : 'amber';
  }

  return {
    lastBackupTime: lastTime,
    lastBackupDateStr,
    daysSinceLastBackup: daysSince,
    reminderFrequencyDays,
    needsBackup,
    statusText,
    statusColor
  };
}

export function setBackupReminderFrequency(days: number) {
  localStorage.setItem(STORAGE_REMINDER_FREQ_KEY, String(days));
}

// 5. Histórico Local de Backups
export function getBackupHistory(): BackupHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_BACKUP_HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordBackupInHistory(item: BackupHistoryItem) {
  try {
    localStorage.setItem(STORAGE_LAST_BACKUP_KEY, String(item.timestamp));
    const history = getBackupHistory();
    const updated = [item, ...history.filter((h) => h.id !== item.id)].slice(0, 15); // Guarda os 15 mais recentes
    localStorage.setItem(STORAGE_BACKUP_HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Erro ao salvar histórico de backup:', e);
  }
}

export function clearBackupHistory() {
  localStorage.removeItem(STORAGE_BACKUP_HISTORY_KEY);
}
