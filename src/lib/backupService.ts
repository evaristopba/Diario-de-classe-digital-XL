import { ref, get, set, update, rtdb, dc, getCurrentAuthUid, auth, verificarIsAdmin } from './firebase';
import {
  planejarRegistros,
  planejarTurmas,
  extrairDadosPorUsuario,
  dividirEmLotes,
  novaEstatistica,
  type EstatisticaGrupo,
  type NoUsuario
} from './restauracaoPlano';
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
  BookLoan,
  BookReservation,
  BookMovement,
  ReadingCornerBook
} from '../types';

export interface BackupMetadata {
  appName: string;
  version: string;
  exportedAt: string;
  timestamp: number;
  exportedByUid?: string;
  /** 'completo' só quando quem exportou é administrador e nenhuma leitura falhou. */
  escopo?: 'completo' | 'parcial';
  /** Nós que NÃO puderam ser lidos na exportação (permissão ou rede). O que está aqui não consta no arquivo. */
  leiturasIncompletas?: string[];
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
    holdings?: number;
    reservations?: number;
    movements?: number;
    readingCorners?: number;
    settings?: number;
    permissions?: number;
    /** Horários cadastrados na grade semanal das turmas */
    schedule?: number;
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
  /** biblioteca/acervos: estoque físico por escola -> livro */
  libraryHoldings?: Record<string, Record<string, any>>;
  libraryReservations?: Record<string, BookReservation>;
  libraryMovements?: Record<string, BookMovement>;
  readingCorners?: Record<string, ReadingCornerBook>;
  /** diario-classe/config */
  settings?: Record<string, any>;
  /** Listas de permissão (uid -> true). Restauradas só por opção explícita. */
  admins?: Record<string, boolean>;
  librarians?: Record<string, boolean>;
  /** BNCC, categorias e tipos de ocorrência do nó pessoal de quem exportou */
  ownUserExtras?: { bncc?: Record<string, any>; categorias?: Record<string, any>; 'tipos-evento'?: Record<string, any> };
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
    bncc?: Record<string, any>;
    categorias?: Record<string, any>;
    'tipos-evento'?: Record<string, any>;
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
  /** Configurações do sistema (diario-classe/config). Padrão: marcado. */
  includeSettings?: boolean;
  /** Listas de administradores e bibliotecários. Padrão: DESMARCADO (concede acesso). */
  includePermissions?: boolean;
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

  // Leitura que falha NÃO pode passar em silêncio: fica registrada no próprio arquivo de backup.
  const leiturasIncompletas: string[] = [];
  const lerSeguro = async (rotulo: string, path: string) => {
    try {
      return await get(ref(rtdb, path));
    } catch (e) {
      console.warn(`[backup] Não foi possível ler "${rotulo}" (${path}):`, e);
      leiturasIncompletas.push(rotulo);
      return null;
    }
  };

  let isAdmin = false;
  try {
    isAdmin = await verificarIsAdmin(uid);
  } catch {
    isAdmin = false;
  }

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
    emprestimosSnap,
    acervosSnap,
    reservasSnap,
    movimentacoesSnap,
    cantinhosSnap,
    configSnap,
    adminsSnap,
    bibliotecariosSnap
  ] = await Promise.all([
    lerSeguro('Escolas', 'diario-classe/escolas'),
    lerSeguro('Turmas e alunos', 'diario-classe/turmas'),
    lerSeguro('Professores', 'diario-classe/professores'),
    lerSeguro('Atribuições de turmas', 'diario-classe/atribuicoes'),
    lerSeguro('Disciplinas', 'diario-classe/disciplinas'),
    lerSeguro('BNCC', 'diario-classe/bncc'),
    lerSeguro('Categorias', 'diario-classe/categorias'),
    lerSeguro('Tipos de ocorrência', 'diario-classe/tipos-evento'),
    lerSeguro('Livros da biblioteca', 'diario-classe/biblioteca/livros'),
    lerSeguro('Empréstimos da biblioteca', 'diario-classe/biblioteca/emprestimos'),
    lerSeguro('Acervo físico por escola', 'diario-classe/biblioteca/acervos'),
    lerSeguro('Reservas da biblioteca', 'diario-classe/biblioteca/reservas'),
    lerSeguro('Movimentações da biblioteca', 'diario-classe/biblioteca/movimentacoes'),
    lerSeguro('Cantinho da Leitura', 'diario-classe/biblioteca/cantinhos'),
    lerSeguro('Configurações do sistema', 'diario-classe/config'),
    lerSeguro('Administradores', 'diario-classe/admins'),
    lerSeguro('Bibliotecários', 'diario-classe/bibliotecarios')
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
  const libraryHoldings = (acervosSnap?.val() || {}) as Record<string, Record<string, any>>;
  const libraryReservations = (reservasSnap?.val() || {}) as Record<string, BookReservation>;
  const libraryMovements = (movimentacoesSnap?.val() || {}) as Record<string, BookMovement>;
  const readingCorners = (cantinhosSnap?.val() || {}) as Record<string, ReadingCornerBook>;
  const settings = (configSnap?.val() || {}) as Record<string, any>;
  const admins = (adminsSnap?.val() || {}) as Record<string, boolean>;
  const librarians = (bibliotecariosSnap?.val() || {}) as Record<string, boolean>;

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
  let ownUserExtras: BackupDataPayload['ownUserExtras'] = undefined;

  if (uid && uid !== 'anon') {
    try {
      const [chamadaSnap, notasSnap, planosSnap, eventosSnap, bnccPessoalSnap, categoriasPessoaisSnap, tiposPessoaisSnap] =
        await Promise.all([
          lerSeguro('Chamadas (seu perfil)', dc('chamada')),
          lerSeguro('Notas (seu perfil)', dc('notas')),
          lerSeguro('Planos de aula (seu perfil)', dc('planos-aula')),
          lerSeguro('Ocorrências (seu perfil)', dc('eventos')),
          lerSeguro('BNCC pessoal (seu perfil)', dc('bncc')),
          lerSeguro('Categorias pessoais (seu perfil)', dc('categorias')),
          lerSeguro('Tipos de ocorrência pessoais (seu perfil)', dc('tipos-evento'))
        ]);

      attendances = (chamadaSnap?.val() || {}) as Record<string, AttendanceRecord>;
      grades = (notasSnap?.val() || {}) as Record<string, GradeRecord>;
      lessonPlans = (planosSnap?.val() || {}) as Record<string, LessonPlan>;
      events = (eventosSnap?.val() || {}) as Record<string, EventOccurrence>;

      const extras = {
        bncc: bnccPessoalSnap?.val() || undefined,
        categorias: categoriasPessoaisSnap?.val() || undefined,
        'tipos-evento': tiposPessoaisSnap?.val() || undefined
      };
      if (Object.values(extras).some((v) => v && Object.keys(v).length > 0)) ownUserExtras = extras;
    } catch (e) {
      console.warn('Erro ao carregar dados pedagógicos pessoais para backup:', e);
      leiturasIncompletas.push('Dados pedagógicos do seu perfil');
    }

    // Só administrador lê o nó global de todos os professores
    if (isAdmin) {
      const globalDadosSnap = await lerSeguro('Dados pedagógicos de todos os professores', 'diario-classe/dados');
      if (globalDadosSnap && globalDadosSnap.exists()) {
        allUsersPedagogical = globalDadosSnap.val();
      }
    }
  }

  const escopo: 'completo' | 'parcial' = isAdmin && leiturasIncompletas.length === 0 ? 'completo' : 'parcial';
  if (!isAdmin) {
    leiturasIncompletas.push('Dados pedagógicos dos demais professores (só administradores leem)');
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
  const holdingsCount = Object.values(libraryHoldings).reduce((acc, porEscola) => acc + Object.keys(porEscola || {}).length, 0);
  const reservationsCount = Object.keys(libraryReservations).length;
  const movementsCount = Object.keys(libraryMovements).length;
  const readingCornersCount = Object.keys(readingCorners).length;
  const settingsCount = Object.keys(settings).length;
  const scheduleCount = Object.values(classes).reduce(
    (acc, turma) => acc + Object.keys((turma as any).gradeHoraria || {}).length,
    0
  );
  const permissionsCount = Object.keys(admins).length + Object.keys(librarians).length;

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
    totalEventsCount +
    holdingsCount +
    reservationsCount +
    movementsCount +
    readingCornersCount +
    settingsCount +
    permissionsCount +
    scheduleCount;

  const now = new Date();
  const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
  const filename = `backup-diario-de-classe-${dateStr}.json`;

  const backupPkg: BackupPackage = {
    metadata: {
      appName: 'Diário de Classe Digital',
      version: '2.1',
      exportedAt: now.toISOString(),
      timestamp: now.getTime(),
      exportedByUid: uid,
      exportedByName: name,
      exportedByEmail: email,
      escopo,
      leiturasIncompletas,
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
        holdings: holdingsCount,
        reservations: reservationsCount,
        movements: movementsCount,
        readingCorners: readingCornersCount,
        settings: settingsCount,
        permissions: permissionsCount,
        schedule: scheduleCount,
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
      libraryHoldings,
      libraryReservations,
      libraryMovements,
      readingCorners,
      settings,
      admins,
      librarians,
      ownUserExtras,
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
          libraryHoldings: data.libraryHoldings || data.acervos,
          libraryReservations: data.libraryReservations || data.reservas,
          libraryMovements: data.libraryMovements || data.movimentacoes,
          readingCorners: data.readingCorners || data.cantinhos,
          settings: data.settings || data.config,
          admins: data.admins,
          librarians: data.librarians || data.bibliotecarios,
          ownUserExtras: data.ownUserExtras,
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
//
// A restauração é PLANEJADA antes de gravar (lógica em restauracaoPlano.ts): lê o estado atual do
// banco, compara registro a registro e só então grava, em lotes e por categoria.
//  - Nada é apagado: o que existe no banco e não está no backup permanece.
//  - Nunca troca um nó inteiro (turma, nó de um professor, mapa de atribuições): grava por registro.
//  - Modo "Mesclar" (merge): cria o que falta e só atualiza com prova de que o backup é mais recente.
//  - Modo "Substituição" (overwrite_selected): sobrescreve os registros de mesmo ID dos módulos
//    marcados, informando quantos eram mais recentes que o backup.
//  - Dados pedagógicos (chamada, notas, planos, ocorrências) voltam para o professor DONO, e só
//    para os módulos marcados.

export interface RelatorioCategoria extends EstatisticaGrupo {
  rotulo: string;
}

export interface AnaliseRestauracao {
  categorias: Record<string, RelatorioCategoria>;
  avisos: string[];
  totais: EstatisticaGrupo;
}

interface GrupoRestauracao {
  rotulo: string;
  /** Chaves de `categorias` cujas contagens dependem deste grupo ter sido gravado. */
  categorias: string[];
  updates: Record<string, any>;
}

async function lerNo(path: string): Promise<Record<string, any>> {
  const snap = await get(ref(rtdb, path));
  return (snap.exists() ? snap.val() : {}) || {};
}

async function montarPlanoDeRestauracao(
  backupPkg: BackupPackage,
  options: RestoreOptions
): Promise<{ grupos: GrupoRestauracao[]; categorias: Record<string, RelatorioCategoria>; avisos: string[] }> {
  const currentUid = getCurrentAuthUid() || auth.currentUser?.uid;
  if (!currentUid) {
    throw new Error('Você precisa estar autenticado no sistema para restaurar um backup.');
  }
  if (!(await verificarIsAdmin(currentUid))) {
    throw new Error('Apenas administradores podem restaurar backups ou importar dados.');
  }

  const modo = options.mode === 'overwrite_selected' ? 'overwrite_selected' : 'merge';
  const referenciaBackup = Number(backupPkg.metadata?.timestamp) || undefined;
  const data = backupPkg.data || {};
  const categorias: Record<string, RelatorioCategoria> = {};
  const grupos: GrupoRestauracao[] = [];
  const avisos: string[] = [];

  const categoria = (chave: string, rotulo: string): RelatorioCategoria => {
    if (!categorias[chave]) categorias[chave] = { ...novaEstatistica(), rotulo };
    return categorias[chave];
  };
  const temItens = (o: any) => !!o && Object.keys(o).length > 0;

  // Coleções simples: um registro por ID em um nó compartilhado
  const colecao = async (chave: string, rotulo: string, basePath: string, lista: Record<string, any> | undefined) => {
    if (!temItens(lista)) return;
    const stats = categoria(chave, rotulo);
    const updates: Record<string, any> = {};
    planejarRegistros({
      basePath,
      backup: lista,
      atual: await lerNo(basePath),
      modo,
      updates,
      stats,
      referenciaBackup
    });
    grupos.push({ rotulo, categorias: [chave], updates });
  };

  // Nós de dois níveis (ex.: acervos/{escola}/{livro}): cada registro do 2º nível é tratado
  // individualmente, para nunca trocar o conjunto inteiro de uma escola.
  const colecaoAninhada = async (
    chave: string,
    rotulo: string,
    basePath: string,
    lista: Record<string, Record<string, any>> | undefined
  ) => {
    if (!temItens(lista)) return;
    const stats = categoria(chave, rotulo);
    const atuais = await lerNo(basePath);
    const updates: Record<string, any> = {};
    Object.keys(lista || {}).forEach((primeiro) => {
      planejarRegistros({
        basePath: `${basePath}/${primeiro}`,
        backup: (lista as any)[primeiro],
        atual: atuais[primeiro],
        modo,
        updates,
        stats,
        referenciaBackup
      });
    });
    grupos.push({ rotulo, categorias: [chave], updates });
  };

  if (options.includeSchools) {
    await colecao('schools', 'Unidades escolares', 'diario-classe/escolas', data.schools);
  }

  if (options.includeClassesAndStudents && temItens(data.classes)) {
    const statsTurmas = categoria('classes', 'Turmas');
    const statsAlunos = categoria('students', 'Alunos');
    const temGrade = Object.values(data.classes || {}).some((t: any) => temItens(t?.gradeHoraria));
    const statsGrade = temGrade ? categoria('schedule', 'Grade de horários') : undefined;
    const updates: Record<string, any> = {};
    planejarTurmas({
      backup: data.classes,
      atuais: await lerNo('diario-classe/turmas'),
      modo,
      updates,
      statsTurmas,
      statsAlunos,
      statsGrade,
      referenciaBackup
    });
    grupos.push({
      rotulo: 'Turmas, alunos e grade de horários',
      categorias: ['classes', 'students', ...(temGrade ? ['schedule'] : [])],
      updates
    });
  }

  if (options.includeTeachers) {
    await colecao('teachers', 'Professores', 'diario-classe/professores', data.teachers);
  }

  if (options.includeAssignments && temItens(data.assignments)) {
    const stats = categoria('assignments', 'Atribuições de turmas');
    const atuais = await lerNo('diario-classe/atribuicoes');
    const updates: Record<string, any> = {};
    Object.keys(data.assignments || {}).forEach((tId) => {
      planejarRegistros({
        basePath: `diario-classe/atribuicoes/${tId}`,
        backup: (data.assignments as any)[tId],
        atual: atuais[tId],
        modo,
        updates,
        stats,
        referenciaBackup
      });
    });
    grupos.push({ rotulo: 'Atribuições de turmas', categorias: ['assignments'], updates });
  }

  if (options.includeSubjects) {
    await colecao('subjects', 'Disciplinas', 'diario-classe/disciplinas', data.subjects);
  }
  if (options.includeBNCC) {
    await colecao('bncc', 'Habilidades BNCC', 'diario-classe/bncc', data.bncc);
  }
  if (options.includeCategories) {
    await colecao('categories', 'Categorias', 'diario-classe/categorias', data.categories);
  }
  if (options.includeEventTypes) {
    await colecao('eventTypes', 'Tipos de ocorrência', 'diario-classe/tipos-evento', data.eventTypes);
  }
  if (options.includeLibrary !== false) {
    await colecao('books', 'Livros da biblioteca', 'diario-classe/biblioteca/livros', data.books);
    await colecao('loans', 'Empréstimos da biblioteca', 'diario-classe/biblioteca/emprestimos', data.loans);
    await colecaoAninhada('holdings', 'Acervo físico por escola', 'diario-classe/biblioteca/acervos', data.libraryHoldings);
    await colecao('reservations', 'Reservas da biblioteca', 'diario-classe/biblioteca/reservas', data.libraryReservations);
    await colecao('movements', 'Movimentações da biblioteca', 'diario-classe/biblioteca/movimentacoes', data.libraryMovements);
    await colecao('readingCorners', 'Cantinho da Leitura', 'diario-classe/biblioteca/cantinhos', data.readingCorners);
  }

  if (options.includeSettings !== false) {
    await colecao('settings', 'Configurações do sistema', 'diario-classe/config', data.settings);
  }

  // Permissões CONCEDEM acesso: só entram por opção explícita. Nunca removem ninguém, mas podem
  // devolver acesso a quem o perdeu depois do backup, por isso o aviso.
  if (options.includePermissions === true) {
    const qtdAdmins = Object.keys(data.admins || {}).length;
    const qtdBibliotecarios = Object.keys(data.librarians || {}).length;
    await colecao('admins', 'Administradores', 'diario-classe/admins', data.admins);
    await colecao('librarians', 'Bibliotecários', 'diario-classe/bibliotecarios', data.librarians);
    if (qtdAdmins + qtdBibliotecarios > 0) {
      avisos.push(
        `Permissões: ${qtdAdmins} administrador(es) e ${qtdBibliotecarios} bibliotecário(s) do backup serão (re)concedidos se ainda não tiverem o acesso. ` +
          'Quem teve o acesso revogado depois do backup voltaria a tê-lo; revise a lista antes de confirmar.'
      );
    }
  }

  // Backup gerado de forma parcial: o que não foi lido na época não está no arquivo
  const meta = backupPkg.metadata;
  if (meta?.escopo === 'parcial' || (meta?.leiturasIncompletas && meta.leiturasIncompletas.length > 0)) {
    avisos.push(
      'Este backup foi gerado de forma PARCIAL' +
        (meta.leiturasIncompletas && meta.leiturasIncompletas.length > 0
          ? ` (não constam: ${meta.leiturasIncompletas.join('; ')}).`
          : '.') +
        ' Use um backup completo de administrador sempre que possível.'
    );
  }

  // Dados pedagógicos: voltam para o professor DONO, só nos módulos marcados
  const autorUid = backupPkg.metadata?.exportedByUid;
  if (autorUid && autorUid !== currentUid) {
    avisos.push(
      `Este backup foi gerado por outro usuário (${backupPkg.metadata.exportedByName || autorUid}). ` +
        'As chamadas, notas, planos e ocorrências serão restaurados no perfil dele, não no seu.'
    );
  }
  const listasDoTopo = [data.attendances, data.grades, data.lessonPlans, data.events];
  const querDadosPedagogicos =
    options.includeAttendance || options.includeGrades || options.includeLessonPlans || options.includeEvents;
  if (!autorUid && querDadosPedagogicos && listasDoTopo.some((l) => temItens(l))) {
    avisos.push(
      'Este backup não identifica quem o gerou: as chamadas, notas, planos e ocorrências dele serão restaurados no SEU perfil.'
    );
  }
  const porUsuario = extrairDadosPorUsuario(data as any, autorUid || currentUid);
  const modulos: { no: NoUsuario; inclui: boolean; chave: string; rotulo: string }[] = [
    { no: 'chamada', inclui: !!options.includeAttendance, chave: 'attendances', rotulo: 'Chamadas' },
    { no: 'notas', inclui: !!options.includeGrades, chave: 'grades', rotulo: 'Notas' },
    { no: 'planos-aula', inclui: !!options.includeLessonPlans, chave: 'lessonPlans', rotulo: 'Planos de aula' },
    { no: 'eventos', inclui: !!options.includeEvents, chave: 'events', rotulo: 'Ocorrências' },
    { no: 'bncc', inclui: !!options.includeBNCC, chave: 'userBncc', rotulo: 'BNCC pessoal dos professores' },
    { no: 'categorias', inclui: !!options.includeCategories, chave: 'userCategories', rotulo: 'Categorias pessoais dos professores' },
    { no: 'tipos-evento', inclui: !!options.includeEventTypes, chave: 'userEventTypes', rotulo: 'Tipos de ocorrência pessoais dos professores' }
  ];
  const outrosUsuarios = new Set<string>();
  for (const uid of Object.keys(porUsuario)) {
    for (const m of modulos) {
      const lista = porUsuario[uid][m.no];
      if (!m.inclui || !temItens(lista)) continue;
      const stats = categoria(m.chave, m.rotulo);
      const updates: Record<string, any> = {};
      planejarRegistros({
        basePath: `diario-classe/dados/${uid}/${m.no}`,
        backup: lista,
        atual: await lerNo(`diario-classe/dados/${uid}/${m.no}`),
        modo,
        updates,
        stats,
        referenciaBackup
      });
      grupos.push({
        rotulo: uid === currentUid ? m.rotulo : `${m.rotulo} (professor ${uid.slice(0, 6)}…)`,
        categorias: [m.chave],
        updates
      });
      if (uid !== currentUid) outrosUsuarios.add(uid);
    }
  }
  if (outrosUsuarios.size > 0 && !(autorUid && autorUid !== currentUid && outrosUsuarios.size === 1)) {
    avisos.push(
      `Também serão restaurados dados pedagógicos de ${outrosUsuarios.size} outro(s) professor(es), registro a registro. ` +
        'O que eles lançaram depois do backup não é apagado.'
    );
  }

  return { grupos, categorias, avisos };
}

/** Simula a restauração sem gravar nada: diz quantos registros serão criados, atualizados ou mantidos. */
export async function analisarRestauracao(
  backupPkg: BackupPackage,
  options: RestoreOptions
): Promise<AnaliseRestauracao> {
  const { categorias, avisos } = await montarPlanoDeRestauracao(backupPkg, options);
  const totais = novaEstatistica();
  Object.values(categorias).forEach((c) => {
    totais.novos += c.novos;
    totais.atualizados += c.atualizados;
    totais.mantidos += c.mantidos;
    totais.maisRecentesSobrescritos += c.maisRecentesSobrescritos;
    totais.mantidosSemData += c.mantidosSemData;
    totais.mantidosBancoMaisNovo += c.mantidosBancoMaisNovo;
  });
  return { categorias, avisos, totais };
}

export async function restoreBackup(
  backupPkg: BackupPackage,
  options: RestoreOptions,
  onProgress?: (message: string, percent: number) => void
): Promise<{
  success: boolean;
  importedCounts: Record<string, number>;
  keptCounts: Record<string, number>;
  errors: string[];
  avisos: string[];
}> {
  const chaves = [
    'schools', 'classes', 'students', 'teachers', 'assignments', 'subjects', 'bncc', 'categories',
    'eventTypes', 'attendances', 'grades', 'lessonPlans', 'events', 'books', 'loans',
    'holdings', 'reservations', 'movements', 'readingCorners', 'settings', 'admins', 'librarians',
    'userBncc', 'userCategories', 'userEventTypes', 'schedule'
  ];
  const importedCounts: Record<string, number> = {};
  const keptCounts: Record<string, number> = {};
  chaves.forEach((c) => {
    importedCounts[c] = 0;
    keptCounts[c] = 0;
  });
  const errors: string[] = [];

  const report = (msg: string, percent: number) => {
    if (onProgress) onProgress(msg, Math.max(0, Math.min(100, Math.round(percent))));
  };

  let plano: Awaited<ReturnType<typeof montarPlanoDeRestauracao>>;
  try {
    report('Analisando o banco de dados atual...', 5);
    plano = await montarPlanoDeRestauracao(backupPkg, options);
  } catch (err: any) {
    errors.push(err.message || 'Erro inesperado ao preparar a restauração');
    return { success: false, importedCounts, keptCounts, errors, avisos: [] };
  }

  const categoriasComFalha = new Set<string>();
  const total = Math.max(1, plano.grupos.length);
  for (let i = 0; i < plano.grupos.length; i++) {
    const grupo = plano.grupos[i];
    report(`Gravando ${grupo.rotulo.toLowerCase()}...`, 10 + (80 * i) / total);
    try {
      for (const lote of dividirEmLotes(grupo.updates)) {
        await update(ref(rtdb), lote);
      }
    } catch (err: any) {
      console.error(`Erro ao restaurar ${grupo.rotulo}:`, err);
      errors.push(`${grupo.rotulo}: ${err?.message || 'falha ao gravar'}`);
      grupo.categorias.forEach((c) => categoriasComFalha.add(c));
    }
  }

  Object.keys(plano.categorias).forEach((chave) => {
    const c = plano.categorias[chave];
    if (!categoriasComFalha.has(chave)) importedCounts[chave] = c.novos + c.atualizados;
    keptCounts[chave] = c.mantidos;
  });

  report('Restauração concluída!', 100);
  return { success: errors.length === 0, importedCounts, keptCounts, errors, avisos: plano.avisos };
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
