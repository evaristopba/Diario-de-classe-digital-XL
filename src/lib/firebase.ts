import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  get,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  DatabaseReference,
  DataSnapshot
} from 'firebase/database';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { School, ClassRoom, Student, Book, BookLoan, Teacher, BookMovement, SchoolCopyHolding, BookReservation, SchoolAcervoItem, ReadingCornerBook } from '../types';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDBVGHr9RUJoFQfFcBAXm5elHuI0nKL4oQ",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "diario-de-classe-1f878.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://diario-de-classe-1f878-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "diario-de-classe-1f878",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "diario-de-classe-1f878.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "885884404967",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:885884404967:web:a5a76bf6c0c7a15c624e42"
};

// Initialize Firebase safely
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const rtdb = getDatabase(app);

let currentAuthUid: string | null = null;

/**
 * Remove recursivamente todas as propriedades com valor `undefined` de um objeto,
 * prevenindo o erro fatal do Firebase RTDB ("set failed: value argument contains undefined in property...").
 */
export function cleanFirebaseData<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => cleanFirebaseData(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirebaseData(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

export function setCurrentAuthUid(uid: string | null) {
  currentAuthUid = uid;
}

export function getCurrentAuthUid(): string | null {
  return currentAuthUid || auth.currentUser?.uid || null;
}

const CAMINHOS_COMPARTILHADOS = [
  'diario-classe/escolas',
  'diario-classe/turmas',
  'diario-classe/atribuicoes',
  'diario-classe/categorias',
  'diario-classe/bncc',
  'diario-classe/tipos-evento',
  'diario-classe/admins',
  'diario-classe/professores',
  'diario-classe/biblioteca'
];

export function dc(subPath?: string): string {
  const uid = getCurrentAuthUid();
  if (!uid) throw new Error('Usuário não autenticado.');
  return 'diario-classe/dados/' + uid + (subPath ? '/' + subPath : '');
}

export function isSharedPath(path: string): boolean {
  return CAMINHOS_COMPARTILHADOS.some((prefix) => path.startsWith(prefix));
}

export async function verificarIsAdmin(uid?: string | null): Promise<boolean> {
  const targetUid = uid || getCurrentAuthUid();
  if (!targetUid) return false;
  try {
    const adminSnap = await get(ref(rtdb, `diario-classe/admins/${targetUid}`));
    if (adminSnap.val() === true) return true;

    // Se a lista de administradores ainda não tiver sido criada (primeiro uso), considera admin
    const allAdminsSnap = await get(ref(rtdb, 'diario-classe/admins'));
    if (!allAdminsSnap.exists() || Object.keys(allAdminsSnap.val() || {}).length === 0) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getDbRef(path: string): DatabaseReference {
  let resolvedPath = path;
  if (path.startsWith('diario-classe/') && !path.startsWith('diario-classe/dados/')) {
    if (!isSharedPath(path)) {
      resolvedPath = dc(path.substring('diario-classe/'.length));
    }
  }
  return ref(rtdb, resolvedPath);
}

// Helpers for Classes & Students
export async function carregarMinhasTurmas(): Promise<{ id: string; val: ClassRoom }[]> {
  const uid = getCurrentAuthUid();
  if (!uid) return [];

  const currentUser = auth.currentUser;
  const currentEmail = currentUser?.email?.toLowerCase().trim();
  const currentDisplayName = (currentUser?.displayName || localStorage.getItem('dc_teacher_name') || '').toLowerCase().trim();

  // 1. Carrega todas as turmas cadastradas na base compartilhada
  const allTurmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
  if (!allTurmasSnap.exists()) {
    // Fallback para base pessoal antiga caso exista
    try {
      const personalSnap = await get(ref(rtdb, dc('turmas')));
      if (personalSnap.exists()) {
        const val = personalSnap.val();
        return Object.keys(val).map((id) => ({ id, val: val[id] as ClassRoom }));
      }
    } catch {
      // ignore
    }
    return [];
  }

  const allTurmasVal = allTurmasSnap.val() as Record<string, ClassRoom>;
  const allTurmasList = Object.keys(allTurmasVal).map((id) => ({ id, val: allTurmasVal[id] }));

  // 2. Se for admin, carrega todas as turmas
  const adminSnap = await get(ref(rtdb, `diario-classe/admins/${uid}`));
  const allAdminsSnap = await get(ref(rtdb, 'diario-classe/admins'));
  const hasAdminsConfigured = allAdminsSnap.exists() && Object.keys(allAdminsSnap.val() || {}).length > 0;

  if (adminSnap.val() === true) {
    return allTurmasList;
  }

  // 3. Mapear todas as chaves associadas a este usuário/docente
  const profsSnap = await get(ref(rtdb, 'diario-classe/professores'));
  const profsVal = profsSnap.val() || {};
  const relevantTeacherKeys = new Set<string>([uid]);
  let matchedTeacherRecordKey: string | null = null;

  Object.keys(profsVal).forEach((key) => {
    const p = profsVal[key] || {};
    const pEmail = (p.email || '').toLowerCase().trim();
    const pName = (p.name || '').toLowerCase().trim();
    const pAuthUid = p.authUid;

    if (
      key === uid ||
      pAuthUid === uid ||
      (currentEmail && pEmail && pEmail === currentEmail) ||
      (currentDisplayName && pName && pName === currentDisplayName)
    ) {
      relevantTeacherKeys.add(key);
      if (pAuthUid) relevantTeacherKeys.add(pAuthUid);
      matchedTeacherRecordKey = key;
    }
  });

  // 4. Carregar mapa de atribuições
  const atribsSnap = await get(ref(rtdb, 'diario-classe/atribuicoes'));
  const atribsVal = (atribsSnap.val() || {}) as Record<string, Record<string, boolean>>;

  const assignedClassIds = new Set<string>();

  // Coleta turmas atribuídas a qualquer um dos IDs do professor
  relevantTeacherKeys.forEach((key) => {
    const teacherAtribs = atribsVal[key] || {};
    Object.keys(teacherAtribs).forEach((classId) => {
      if (teacherAtribs[classId]) {
        assignedClassIds.add(classId);
      }
    });
  });

  // Também verifica se a turma foi criada pelo usuário ou possui seu ID
  allTurmasList.forEach((t) => {
    if (t.val.criadoPor === uid) {
      assignedClassIds.add(t.id);
    }
    if (t.val.teacherId && relevantTeacherKeys.has(t.val.teacherId)) {
      assignedClassIds.add(t.id);
    }
  });

  // Se encontrou turmas atribuídas, retorna filtrado
  if (assignedClassIds.size > 0) {
    // Sincroniza silenciosamente a atribuição no Firebase para o uid direto caso necessário
    if (!atribsVal[uid] || Object.keys(atribsVal[uid]).length === 0) {
      try {
        const syncUpdates: Record<string, any> = {};
        assignedClassIds.forEach((cid) => {
          syncUpdates[`diario-classe/atribuicoes/${uid}/${cid}`] = true;
        });
        if (matchedTeacherRecordKey && !profsVal[matchedTeacherRecordKey]?.authUid) {
          syncUpdates[`diario-classe/professores/${matchedTeacherRecordKey}/authUid`] = uid;
        }
        await update(ref(rtdb), syncUpdates);
      } catch {
        // Ignora silenciosamente se regras não permitirem
      }
    }

    return allTurmasList.filter((t) => assignedClassIds.has(t.id));
  }

  // Se o usuário ainda não tem atribuições cadastradas e não há lista de administradores fechada, exibe todas para não bloquear o uso inicial
  if (!hasAdminsConfigured) {
    return allTurmasList;
  }

  return [];
}

export async function alunosDasMinhasTurmas(
  filtroClassId?: string | null
): Promise<{ id: string; classId: string; val: Student }[]> {
  const turmas = await carregarMinhasTurmas();
  const lista: { id: string; classId: string; val: Student }[] = [];

  turmas.forEach((t) => {
    if (filtroClassId && t.id !== filtroClassId) return;
    const alunos = t.val.alunos || {};
    Object.keys(alunos).forEach((alunoId) => {
      lista.push({ id: alunoId, classId: t.id, val: alunos[alunoId] });
    });
  });

  return lista;
}

export async function migrarParaEstruturaCompartilhada(): Promise<{
  totalEscolas: number;
  totalTurmas: number;
  totalAlunos: number;
}> {
  const uid = getCurrentAuthUid();
  if (!uid) throw new Error('Faça login primeiro!');

  const escolasSnap = await get(ref(rtdb, dc('escolas')));
  const turmasSnap = await get(ref(rtdb, dc('turmas')));
  const alunosSnap = await get(ref(rtdb, dc('alunos')));

  const escolasVal = (escolasSnap.val() || {}) as Record<string, School>;
  const turmasVal = (turmasSnap.val() || {}) as Record<string, ClassRoom>;
  const alunosVal = (alunosSnap.val() || {}) as Record<string, Student>;

  const updates: Record<string, any> = {};
  let totalEscolas = 0;
  let totalTurmas = 0;
  let totalAlunos = 0;

  Object.keys(escolasVal).forEach((id) => {
    updates[`diario-classe/escolas/${id}`] = escolasVal[id];
    totalEscolas++;
  });

  Object.keys(turmasVal).forEach((turmaId) => {
    const turma = { ...turmasVal[turmaId], criadoPor: uid };
    const alunosDaTurma: Record<string, Student> = {};

    Object.keys(alunosVal).forEach((alunoId) => {
      if (alunosVal[alunoId].classId === turmaId) {
        alunosDaTurma[alunoId] = alunosVal[alunoId];
        totalAlunos++;
      }
    });

    if (Object.keys(alunosDaTurma).length > 0) {
      turma.alunos = alunosDaTurma;
    }

    updates[`diario-classe/turmas/${turmaId}`] = turma;
    updates[`diario-classe/atribuicoes/${uid}/${turmaId}`] = true;
    totalTurmas++;
  });

  if (totalEscolas === 0 && totalTurmas === 0) {
    return { totalEscolas: 0, totalTurmas: 0, totalAlunos: 0 };
  }

  await update(ref(rtdb), updates);
  return { totalEscolas, totalTurmas, totalAlunos };
}

// Cria conta no Firebase Authentication para o professor sem deslogar o Admin atual
export async function cadastrarContaProfessorAuth(email: string, pass: string, displayName: string): Promise<{ uid: string }> {
  const secondaryAppName = `SecondaryApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    if (displayName) {
      await updateProfile(userCredential.user, { displayName });
    }
    const uid = userCredential.user.uid;
    await signOut(secondaryAuth);
    return { uid };
  } catch (err: any) {
    throw err;
  }
}

// Envia e-mail de redefinição de senha para o professor
export async function enviarRedefinicaoSenha(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

// Helpers para Professores e Atribuições
export async function carregarProfessores() {
  const snap = await get(ref(rtdb, 'diario-classe/professores'));
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.keys(val).map((id) => ({ id, val: val[id] }));
}

export async function salvarProfessor(arg1: any, arg2?: any) {
  let id: string | null = null;
  let data: any = {};

  if (typeof arg1 === 'string') {
    id = arg1;
    data = arg2 || {};
  } else if (arg1 && typeof arg1 === 'object') {
    data = arg1;
    id = typeof arg2 === 'string' ? arg2 : null;
  } else {
    data = arg2 || {};
    id = typeof arg1 === 'string' ? arg1 : null;
  }

  if (id) {
    await update(ref(rtdb, `diario-classe/professores/${id}`), {
      ...data,
      updatedAt: Date.now()
    });
    return id;
  } else {
    const newRef = push(ref(rtdb, 'diario-classe/professores'));
    await set(newRef, {
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return newRef.key;
  }
}

export async function excluirProfessor(id: string) {
  await remove(ref(rtdb, `diario-classe/professores/${id}`));
  // Remover também atribuições do professor se houver
  await remove(ref(rtdb, `diario-classe/atribuicoes/${id}`));
}

export async function carregarTodasAtribuicoes() {
  const snap = await get(ref(rtdb, 'diario-classe/atribuicoes'));
  if (!snap.exists()) return {};
  return snap.val() as Record<string, Record<string, boolean>>;
}

export async function atribuirTurmaProfessor(teacherId: string, classId: string, status: boolean) {
  const updates: Record<string, any> = {};
  
  if (status) {
    updates[`diario-classe/atribuicoes/${teacherId}/${classId}`] = true;
  } else {
    updates[`diario-classe/atribuicoes/${teacherId}/${classId}`] = null;
  }

  try {
    // Buscar se esse professor tem authUid ou outros aliases em diario-classe/professores
    const profSnap = await get(ref(rtdb, `diario-classe/professores/${teacherId}`));
    if (profSnap.exists()) {
      const profData = profSnap.val();
      const authUid = profData?.authUid;
      if (authUid && authUid !== teacherId) {
        updates[`diario-classe/atribuicoes/${authUid}/${classId}`] = status ? true : null;
      }
    }
  } catch {
    // ignore
  }

  await update(ref(rtdb), updates);
}

// Helpers para Gestão da Biblioteca Escolar & Permissões

/**
 * Verifica se o usuário atual ou especificado possui permissão para gerenciar a biblioteca
 * (Administrador, nó dedicado de bibliotecários ou flag canManageLibrary no cadastro do docente).
 */
export async function verificarPodeGerenciarBiblioteca(uid?: string | null): Promise<boolean> {
  const targetUid = uid || getCurrentAuthUid();
  if (!targetUid) return false;

  // 1. Se for Admin, tem acesso total
  const isAdmin = await verificarIsAdmin(targetUid);
  if (isAdmin) return true;

  try {
    // 2. Verificar se está registrado no nó dedicado de bibliotecários
    const biblioSnap = await get(ref(rtdb, `diario-classe/bibliotecarios/${targetUid}`));
    if (biblioSnap.exists() && biblioSnap.val() === true) {
      return true;
    }

    // 3. Verificar no cadastro de professores se tem a flag canManageLibrary
    const profDirectSnap = await get(ref(rtdb, `diario-classe/professores/${targetUid}`));
    if (profDirectSnap.exists() && profDirectSnap.val()?.canManageLibrary === true) {
      return true;
    }

    // Buscar professores pelo authUid caso o ID da chave seja diferente
    const allProfsSnap = await get(ref(rtdb, 'diario-classe/professores'));
    if (allProfsSnap.exists()) {
      const profs = allProfsSnap.val();
      for (const k of Object.keys(profs)) {
        const p = profs[k];
        if (p?.authUid === targetUid && p?.canManageLibrary === true) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Carrega turmas especificamente para o módulo de Biblioteca Escolar.
 * Se o usuário for Administrador ou tiver permissão de gerenciar biblioteca (Bibliotecário / canManageLibrary),
 * ele tem acesso a todas as turmas cadastradas para realizar empréstimos globais e consultar acervos.
 * Caso seja um docente comum de sala de aula, mantém apenas as turmas atribuídas a ele (Cantinho de Leitura).
 * Isso garante que as demais telas (Notas, Frequência, Relatórios, etc.) permaneçam 100% isoladas.
 */
export async function carregarTurmasParaBiblioteca(): Promise<{ id: string; val: ClassRoom }[]> {
  const podeGerenciar = await verificarPodeGerenciarBiblioteca();
  if (podeGerenciar) {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/turmas'));
      if (snap.exists()) {
        const val = snap.val() as Record<string, ClassRoom>;
        return Object.keys(val).map((id) => ({ id, val: val[id] }));
      }
    } catch (e) {
      console.warn('Erro ao carregar todas as turmas para biblioteca:', e);
    }
  }
  return carregarMinhasTurmas();
}

/**
 * Carrega todos os livros do acervo da biblioteca e mescla os estoques físicos de biblioteca/acervos.
 */
export async function carregarLivros(): Promise<{ id: string; val: Book }[]> {
  const [livrosSnap, acervosSnap] = await Promise.all([
    get(ref(rtdb, 'diario-classe/biblioteca/livros')),
    get(ref(rtdb, 'diario-classe/biblioteca/acervos'))
  ]);

  if (!livrosSnap.exists()) return [];
  const val = livrosSnap.val() || {};
  const acervosVal = acervosSnap.exists() ? acervosSnap.val() : {};

  return Object.keys(val).map((id) => {
    const book = val[id] as Book;
    const holdings: Record<string, SchoolCopyHolding> = book.copiesBySchool ? { ...book.copiesBySchool } : {};

    // Sincroniza dados da árvore física acervos/$schoolId/$bookId se existirem
    Object.keys(acervosVal).forEach((sId) => {
      const schoolAcervo = acervosVal[sId];
      if (schoolAcervo && schoolAcervo[id]) {
        const item = schoolAcervo[id];
        holdings[sId] = {
          schoolName: item.schoolName || holdings[sId]?.schoolName || 'Escola',
          totalCopies: Number(item.totalCopies ?? holdings[sId]?.totalCopies ?? 0),
          availableCopies: Number(item.availableCopies ?? holdings[sId]?.availableCopies ?? 0),
          code: item.code || holdings[sId]?.code || book.code,
          location: item.location || holdings[sId]?.location || ''
        };
      }
    });

    const consolidatedTotal = Object.keys(holdings).length > 0
      ? Object.values(holdings).reduce((acc, h) => acc + (Number(h.totalCopies) || 0), 0)
      : (book.totalCopies || 1);

    const consolidatedAvail = Object.keys(holdings).length > 0
      ? Object.values(holdings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0)
      : (book.availableCopies ?? book.totalCopies ?? 1);

    return {
      id,
      val: {
        ...book,
        copiesBySchool: holdings,
        totalCopies: consolidatedTotal,
        availableCopies: consolidatedAvail
      }
    };
  });
}

/**
 * Salva ou atualiza um livro no acervo de forma centralizada e sem redundância.
 * Grava metadados universais em biblioteca/livros e estoque físico em biblioteca/acervos/$schoolId/$livroId.
 */
export async function salvarLivro(
  livro: Omit<Book, 'id'>,
  id?: string,
  auditOptions?: {
    justification?: string;
    userName?: string;
  }
): Promise<string> {
  const now = Date.now();
  const currentUid = auth.currentUser?.uid || '';
  const operatorName = auditOptions?.userName || auth.currentUser?.displayName || 'Operador da Biblioteca';
  const todayStr = new Date(now).toISOString().split('T')[0];
  const schoolId = livro.schoolId || 'rede-geral';
  const schoolName = livro.schoolName || 'Acervo Geral';
  const inputTotal = Math.max(1, Number(livro.totalCopies) || 1);
  const inputAvail = Math.max(0, Number(livro.availableCopies ?? livro.totalCopies) || inputTotal);

  if (id) {
    // Atualização de obra existente
    const snap = await get(ref(rtdb, `diario-classe/biblioteca/livros/${id}`));
    const current = snap.exists() ? (snap.val() as Book) : null;
    let currentHoldings: Record<string, SchoolCopyHolding> = {};

    if (livro.copiesBySchool && Object.keys(livro.copiesBySchool).length > 0) {
      // Usa a distribuição por escola configurada no formulário
      currentHoldings = { ...livro.copiesBySchool };
    } else {
      currentHoldings = (current && current.copiesBySchool) ? { ...current.copiesBySchool } : {};
      // Atualiza a escola específica nos holdings caso não tenha sido passado copiesBySchool
      currentHoldings[schoolId] = {
        schoolName,
        totalCopies: inputTotal,
        availableCopies: inputAvail,
        code: livro.code || currentHoldings[schoolId]?.code || '',
        location: livro.location || currentHoldings[schoolId]?.location || ''
      };
    }

    // Recalcula totais consolidados da rede
    const consolidatedTotal = Object.values(currentHoldings).reduce((acc, h) => acc + (Number(h.totalCopies) || 0), 0);
    const consolidatedAvail = Object.values(currentHoldings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);

    const dataToSave: Book = {
      ...livro,
      copiesBySchool: currentHoldings,
      totalCopies: consolidatedTotal,
      availableCopies: consolidatedAvail,
      updatedAt: now,
      createdAt: (current && current.createdAt) || livro.createdAt || now
    };

    // 1. Grava no catálogo geral de títulos
    await update(ref(rtdb, `diario-classe/biblioteca/livros/${id}`), cleanFirebaseData(dataToSave));

    // 2. Grava/atualiza no estoque físico de cada escola envolvida em acervos/$sId/$id
    // e registra auditoria se a quantidade de exemplares foi alterada
    for (const [sId, h] of Object.entries(currentHoldings)) {
      let origTotal = 0;
      if (current?.copiesBySchool?.[sId]) {
        origTotal = Number(current.copiesBySchool[sId].totalCopies) || 0;
      } else if (current && (!current.copiesBySchool || Object.keys(current.copiesBySchool).length === 0)) {
        if (current.schoolId === sId || Object.keys(currentHoldings).length === 1) {
          origTotal = Number(current.totalCopies) || 0;
        }
      }

      const newTotal = Number(h.totalCopies) || 0;

      await set(ref(rtdb, `diario-classe/biblioteca/acervos/${sId}/${id}`), cleanFirebaseData({
        totalCopies: newTotal,
        availableCopies: Number(h.availableCopies) || 0,
        code: h.code || livro.code || '',
        schoolName: h.schoolName || '',
        location: h.location || '',
        updatedAt: now
      }));

      // Auditoria patrimonial se for atualização de livro existente e houve variação de estoque
      if (current && origTotal !== newTotal) {
        const delta = newTotal - origTotal;
        const isReduction = delta < 0;
        const defaultReason = isReduction
          ? `Baixa patrimonial de ${Math.abs(delta)} exemplar(es) (${origTotal} ➔ ${newTotal})`
          : `Acréscimo de ${delta} exemplar(es) no acervo (${origTotal} ➔ ${newTotal})`;

        const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
        await set(movRef, cleanFirebaseData({
          type: isReduction ? 'baixa' : (origTotal === 0 ? 'entrada' : 'ajuste_inventario'),
          bookId: id,
          bookTitle: livro.title,
          bookCode: h.code || livro.code || '',
          sourceSchoolId: sId,
          sourceSchoolName: h.schoolName || schoolName,
          targetSchoolId: sId,
          targetSchoolName: h.schoolName || schoolName,
          copies: Math.abs(delta),
          previousCopies: origTotal,
          newCopies: newTotal,
          date: todayStr,
          reason: auditOptions?.justification?.trim() || defaultReason,
          responsibleUid: currentUid,
          responsibleName: operatorName,
          userName: operatorName,
          createdAt: now
        }));
      }
    }

    return id;
  } else {
    // Cadastro de obra: verifica se o título já existe no catálogo para evitar redundância
    const allBooksSnap = await get(ref(rtdb, 'diario-classe/biblioteca/livros'));
    let existingBookId: string | null = null;
    let existingBookData: Book | null = null;

    if (allBooksSnap.exists()) {
      const allBooks = allBooksSnap.val();
      const codeClean = (livro.code || '').replace(/[^0-9X]/gi, '').toLowerCase();
      const titleClean = (livro.title || '').trim().toLowerCase();
      const authorClean = (livro.author || '').trim().toLowerCase();

      for (const k of Object.keys(allBooks)) {
        const b = allBooks[k] as Book;
        const bCodeClean = (b.code || '').replace(/[^0-9X]/gi, '').toLowerCase();
        const bTitleClean = (b.title || '').trim().toLowerCase();
        const bAuthorClean = (b.author || '').trim().toLowerCase();

        // Correspondência por ISBN ou por (Título + Autor)
        const matchIsbn = codeClean.length >= 9 && bCodeClean.length >= 9 && codeClean === bCodeClean;
        const matchTitleAuthor = titleClean.length > 2 && bTitleClean === titleClean && (bAuthorClean === authorClean || !authorClean || !bAuthorClean);

        if (matchIsbn || matchTitleAuthor) {
          existingBookId = k;
          existingBookData = b;
          break;
        }
      }
    }

    if (existingBookId && existingBookData) {
      // Obra já catalogada! Apenas soma/atribui os exemplares das escolas à obra existente
      const holdings: Record<string, SchoolCopyHolding> = existingBookData.copiesBySchool ? { ...existingBookData.copiesBySchool } : {};
      
      if (livro.copiesBySchool && Object.keys(livro.copiesBySchool).length > 0) {
        // Se vier distribuição detalhada por escola
        for (const [sId, h] of Object.entries(livro.copiesBySchool)) {
          const prevH: SchoolCopyHolding = holdings[sId] || { schoolName: h.schoolName || '', totalCopies: 0, availableCopies: 0, code: '', location: '' };
          const addedTotal = Number(h.totalCopies) || 0;
          const addedAvail = Number(h.availableCopies) || 0;
          const mergedTotal = prevH.totalCopies + addedTotal;
          const mergedAvail = prevH.availableCopies + addedAvail;

          holdings[sId] = {
            schoolName: h.schoolName || prevH.schoolName || '',
            totalCopies: mergedTotal,
            availableCopies: mergedAvail,
            code: h.code || prevH.code || livro.code || existingBookData.code || '',
            location: h.location || prevH.location || ''
          };

          await set(ref(rtdb, `diario-classe/biblioteca/acervos/${sId}/${existingBookId}`), cleanFirebaseData({
            totalCopies: mergedTotal,
            availableCopies: mergedAvail,
            code: holdings[sId].code,
            schoolName: holdings[sId].schoolName,
            location: holdings[sId].location,
            updatedAt: now
          }));

          if (addedTotal > 0) {
            const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
            await set(movRef, cleanFirebaseData({
              type: 'entrada',
              bookId: existingBookId,
              bookTitle: existingBookData.title,
              bookCode: holdings[sId].code,
              sourceSchoolId: sId,
              sourceSchoolName: holdings[sId].schoolName,
              targetSchoolId: sId,
              targetSchoolName: holdings[sId].schoolName,
              copies: addedTotal,
              previousCopies: prevH.totalCopies,
              newCopies: mergedTotal,
              date: todayStr,
              reason: auditOptions?.justification?.trim() || `Entrada de ${addedTotal} exemplar(es) no acervo escolar`,
              responsibleUid: currentUid,
              responsibleName: operatorName,
              userName: operatorName,
              createdAt: now
            }));
          }
        }
      } else {
        // Entrada em uma única escola padrão
        const prev: SchoolCopyHolding = holdings[schoolId] || { schoolName, totalCopies: 0, availableCopies: 0, code: '', location: '' };
        const newSchoolTotal = prev.totalCopies + inputTotal;
        const newSchoolAvail = prev.availableCopies + inputAvail;

        holdings[schoolId] = {
          schoolName,
          totalCopies: newSchoolTotal,
          availableCopies: newSchoolAvail,
          code: livro.code || prev.code || existingBookData.code,
          location: livro.location || prev.location || ''
        };

        await set(ref(rtdb, `diario-classe/biblioteca/acervos/${schoolId}/${existingBookId}`), cleanFirebaseData({
          totalCopies: newSchoolTotal,
          availableCopies: newSchoolAvail,
          code: livro.code || prev.code || existingBookData.code,
          schoolName,
          location: livro.location || prev.location || '',
          updatedAt: now
        }));

        const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
        await set(movRef, cleanFirebaseData({
          type: 'entrada',
          bookId: existingBookId,
          bookTitle: existingBookData.title,
          bookCode: livro.code || prev.code || existingBookData.code || '',
          sourceSchoolId: schoolId,
          sourceSchoolName: schoolName,
          targetSchoolId: schoolId,
          targetSchoolName: schoolName,
          copies: inputTotal,
          previousCopies: prev.totalCopies,
          newCopies: newSchoolTotal,
          date: todayStr,
          reason: auditOptions?.justification?.trim() || `Entrada de ${inputTotal} exemplar(es) no acervo escolar`,
          responsibleUid: currentUid,
          responsibleName: operatorName,
          userName: operatorName,
          createdAt: now
        }));
      }

      const consolidatedTotal = Object.values(holdings).reduce((acc, h) => acc + (Number(h.totalCopies) || 0), 0);
      const consolidatedAvail = Object.values(holdings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);

      await update(ref(rtdb, `diario-classe/biblioteca/livros/${existingBookId}`), cleanFirebaseData({
        ...existingBookData,
        coverUrl: livro.coverUrl || existingBookData.coverUrl || '',
        synopsis: livro.synopsis || existingBookData.synopsis || '',
        publisher: livro.publisher || existingBookData.publisher || '',
        year: livro.year || existingBookData.year || '',
        genre: livro.genre || existingBookData.genre,
        copiesBySchool: holdings,
        totalCopies: consolidatedTotal,
        availableCopies: consolidatedAvail,
        updatedAt: now
      }));

      return existingBookId;
    } else {
      // Nova obra no catálogo
      let initialHoldings: Record<string, SchoolCopyHolding> = {};
      if (livro.copiesBySchool && Object.keys(livro.copiesBySchool).length > 0) {
        initialHoldings = { ...livro.copiesBySchool };
      } else {
        initialHoldings[schoolId] = {
          schoolName,
          totalCopies: inputTotal,
          availableCopies: inputAvail,
          code: livro.code || '',
          location: livro.location || ''
        };
      }

      const consolidatedTotal = Object.values(initialHoldings).reduce((acc, h) => acc + (Number(h.totalCopies) || 0), 0);
      const consolidatedAvail = Object.values(initialHoldings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);

      const dataToSave: Book = {
        ...livro,
        copiesBySchool: initialHoldings,
        totalCopies: consolidatedTotal,
        availableCopies: consolidatedAvail,
        createdAt: now,
        updatedAt: now
      };

      const newRef = push(ref(rtdb, 'diario-classe/biblioteca/livros'));
      await set(newRef, cleanFirebaseData(dataToSave));
      const bookId = newRef.key!;

      // Grava no acervo de cada escola que recebeu exemplares e registra auditoria inicial
      for (const [sId, h] of Object.entries(initialHoldings)) {
        const count = Number(h.totalCopies) || 0;
        await set(ref(rtdb, `diario-classe/biblioteca/acervos/${sId}/${bookId}`), cleanFirebaseData({
          totalCopies: count,
          availableCopies: Number(h.availableCopies) || 0,
          code: h.code || livro.code || '',
          schoolName: h.schoolName || '',
          location: h.location || '',
          updatedAt: now
        }));

        if (count > 0) {
          const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
          await set(movRef, cleanFirebaseData({
            type: 'entrada',
            bookId,
            bookTitle: livro.title,
            bookCode: h.code || livro.code || '',
            sourceSchoolId: sId,
            sourceSchoolName: h.schoolName || schoolName,
            targetSchoolId: sId,
            targetSchoolName: h.schoolName || schoolName,
            copies: count,
            previousCopies: 0,
            newCopies: count,
            date: todayStr,
            reason: auditOptions?.justification?.trim() || 'Entrada inicial no acervo da biblioteca escolar',
            responsibleUid: currentUid,
            responsibleName: operatorName,
            userName: operatorName,
            createdAt: now
          }));
        }
      }

      return bookId;
    }
  }
}

/**
 * Exclui um livro do catálogo e remove seus registros nos acervos físicos das escolas.
 */
export async function excluirLivro(id: string): Promise<void> {
  await remove(ref(rtdb, `diario-classe/biblioteca/livros/${id}`));

  // Limpa também as instâncias físicas em biblioteca/acervos
  try {
    const acervosSnap = await get(ref(rtdb, 'diario-classe/biblioteca/acervos'));
    if (acervosSnap.exists()) {
      const acervosVal = acervosSnap.val();
      for (const sId of Object.keys(acervosVal)) {
        if (acervosVal[sId] && acervosVal[sId][id]) {
          await remove(ref(rtdb, `diario-classe/biblioteca/acervos/${sId}/${id}`));
        }
      }
    }
  } catch {
    // Silencia se acervos não for acessível
  }
}

/**
 * Carrega todos os empréstimos registrados na biblioteca.
 */
export async function carregarEmprestimos(): Promise<{ id: string; val: BookLoan }[]> {
  const snap = await get(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.keys(val).map((id) => ({ id, val: val[id] }));
}

/**
 * Registra um novo empréstimo, decrementa availableCopies no acervo físico da escola e grava o empréstimo.
 */
export async function registrarEmprestimo(emprestimo: Omit<BookLoan, 'id'>): Promise<string> {
  const uid = getCurrentAuthUid();
  const now = Date.now();
  const schoolId = emprestimo.schoolId || 'rede-geral';

  // Se o empréstimo for originado do Cantinho da Leitura da sala de aula:
  // O exemplar físico JÁ foi transferido da biblioteca central para a sala de aula anteriormente.
  // Portanto, não devemos validar nem debitar o estoque da biblioteca central da escola novamente.
  if (!emprestimo.isReadingCorner) {
    // 0. Validação de segurança estrita por escola: verificar se a escola possui exemplar disponível
    const bookSnap = await get(ref(rtdb, `diario-classe/biblioteca/livros/${emprestimo.bookId}`));
    if (!bookSnap.exists()) {
      throw new Error('Obra não encontrada no catálogo da biblioteca.');
    }

    const bookData = bookSnap.val() as Book;

    // Se o livro tiver distribuição por escola e a escola estiver informada
    if (schoolId && schoolId !== 'rede-geral' && bookData.copiesBySchool) {
      const schoolHolding = bookData.copiesBySchool[schoolId];
      const schoolAvail = schoolHolding ? Number(schoolHolding.availableCopies ?? 0) : 0;
      if (schoolAvail <= 0) {
        const schoolName = schoolHolding?.schoolName || emprestimo.schoolName || 'esta escola';
        throw new Error(
          `Exemplar indisponível na unidade ${schoolName}. Não há exemplares físicos em estoque nesta escola para realizar o empréstimo.`
        );
      }
    } else {
      // Validação geral de segurança da rede
      const generalAvail = Number(bookData.availableCopies ?? 0);
      if (generalAvail <= 0) {
        throw new Error('Todos os exemplares desta obra estão atualmente emprestados.');
      }
    }

    // 1. Decrementar exemplar no acervo físico da escola (biblioteca/acervos/$schoolId/$bookId/availableCopies)
    try {
      const acervoSnap = await get(ref(rtdb, `diario-classe/biblioteca/acervos/${schoolId}/${emprestimo.bookId}`));
      if (acervoSnap.exists()) {
        const acervoData = acervoSnap.val();
        const curAvail = Number(acervoData.availableCopies ?? acervoData.totalCopies ?? 1);
        await update(ref(rtdb, `diario-classe/biblioteca/acervos/${schoolId}/${emprestimo.bookId}`), {
          availableCopies: Math.max(0, curAvail - 1),
          updatedAt: now
        });
      }
    } catch {
      // Continua para atualizar no livro
    }

    // 2. Decrementar exemplar no catálogo geral
    try {
      const currentAvail = Number(bookData.availableCopies ?? bookData.totalCopies ?? 1);

      const updates: Partial<Book> = {
        availableCopies: Math.max(0, currentAvail - 1),
        updatedAt: now
      };

      if (schoolId && bookData.copiesBySchool && bookData.copiesBySchool[schoolId]) {
        const holdings = { ...bookData.copiesBySchool };
        const schoolH = { ...holdings[schoolId] };
        schoolH.availableCopies = Math.max(0, (schoolH.availableCopies || 1) - 1);
        holdings[schoolId] = schoolH;
        updates.copiesBySchool = holdings;
      }

      await update(ref(rtdb, `diario-classe/biblioteca/livros/${emprestimo.bookId}`), updates);
    } catch {
      // Ignora se não puder atualizar o livro geral
    }
  }

  // 3. Salvar empréstimo com campos obrigatórios validados pelas regras
  const loanData: BookLoan = {
    ...emprestimo,
    schoolId,
    status: 'ativo',
    renewalsCount: 0,
    registeredByUid: uid || '',
    createdAt: now,
    updatedAt: now
  };

  const newRef = push(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
  await set(newRef, cleanFirebaseData(loanData));
  return newRef.key!;
}

/**
 * Registra a devolução de um empréstimo e repõe o exemplar no acervo correto (Cantinho ou Acervo da Escola).
 */
export async function devolverEmprestimo(
  loanId: string,
  bookId: string,
  returnDate: string,
  notes?: string
): Promise<void> {
  const now = Date.now();

  // 1. Buscar empréstimo para saber a escola e se pertence ao Cantinho da Leitura
  const loanSnap = await get(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`));
  const loanData = loanSnap.exists() ? (loanSnap.val() as BookLoan) : null;
  if (!loanData || loanData.status === 'devolvido') {
    // Se o empréstimo não existe ou já foi devolvido, aborta imediatamente para evitar duplicar devolução no estoque físico
    return;
  }
  const loanSchoolId = loanData?.schoolId || 'rede-geral';
  const isCornerLoan = Boolean(loanData?.isReadingCorner || loanData?.readingCornerTurmaId);
  const cornerTurmaId = loanData?.readingCornerTurmaId || loanData?.classId;

  // 2. Se o empréstimo foi realizado pelo Cantinho da Leitura, repor na estante da sala de aula
  if (isCornerLoan && cornerTurmaId) {
    try {
      const cornerKey = `${cornerTurmaId}_${bookId}`;
      const cornerRef = ref(rtdb, `diario-classe/biblioteca/cantinhos/${cornerKey}`);
      const cornerSnap = await get(cornerRef);
      if (cornerSnap.exists()) {
        const cornerVal = cornerSnap.val() as ReadingCornerBook;
        const curAvail = Number(cornerVal.availableCopies ?? 0);
        const totalCopies = Number(cornerVal.totalCopies ?? 1);
        await update(cornerRef, {
          availableCopies: Math.min(totalCopies, curAvail + 1),
          updatedAt: now
        });
      }
    } catch (e) {
      console.error('Erro ao repor exemplar no cantinho da leitura:', e);
    }
  } else {
    // Caso seja empréstimo convencional da biblioteca, repor no acervo físico da escola e catálogo geral
    try {
      const acervoSnap = await get(ref(rtdb, `diario-classe/biblioteca/acervos/${loanSchoolId}/${bookId}`));
      if (acervoSnap.exists()) {
        const acervoData = acervoSnap.val();
        const curAvail = Number(acervoData.availableCopies ?? 0);
        const totalCopies = Number(acervoData.totalCopies ?? 1);
        await update(ref(rtdb, `diario-classe/biblioteca/acervos/${loanSchoolId}/${bookId}`), {
          availableCopies: Math.min(totalCopies, curAvail + 1),
          updatedAt: now
        });
      }
    } catch {
      // Segue adiante
    }

    try {
      const bookSnap = await get(ref(rtdb, `diario-classe/biblioteca/livros/${bookId}`));
      if (bookSnap.exists()) {
        const bookData = bookSnap.val() as Book;
        const currentAvail = Number(bookData.availableCopies ?? 0);
        const totalCopies = Number(bookData.totalCopies ?? 1);

        const updates: Partial<Book> = {
          availableCopies: Math.min(totalCopies, currentAvail + 1),
          updatedAt: now
        };

        if (loanSchoolId && bookData.copiesBySchool && bookData.copiesBySchool[loanSchoolId]) {
          const holdings = { ...bookData.copiesBySchool };
          const schoolH = { ...holdings[loanSchoolId] };
          schoolH.availableCopies = Math.min(schoolH.totalCopies, (schoolH.availableCopies || 0) + 1);
          holdings[loanSchoolId] = schoolH;
          updates.copiesBySchool = holdings;
        }

        await update(ref(rtdb, `diario-classe/biblioteca/livros/${bookId}`), updates);
      }
    } catch {
      // Segue adiante
    }
  }

  // 4. Atualizar status do empréstimo para devolvido
  const updates: Partial<BookLoan> = {
    status: 'devolvido',
    returnDate,
    updatedAt: now
  };
  if (notes !== undefined) {
    updates.notes = notes;
  }

  await update(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`), updates);
}

/**
 * Renova o prazo de um empréstimo estendendo a nova data de devolução.
 */
export async function renovarEmprestimo(
  loanId: string,
  newDueDate: string,
  currentRenewals: number = 0
): Promise<void> {
  const now = Date.now();
  await update(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`), {
    dueDate: newDueDate,
    renewalsCount: (currentRenewals || 0) + 1,
    status: 'ativo',
    updatedAt: now
  });
}

/**
 * Exclui um registro individual de empréstimo (útil para limpeza de dados de teste ou devoluções concluídas).
 */
export async function excluirEmprestimo(loanId: string): Promise<void> {
  await remove(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`));
}

/**
 * Carrega a lista de escolas cadastradas.
 */
export async function carregarEscolas(): Promise<School[]> {
  const snap = await get(ref(rtdb, 'diario-classe/escolas'));
  if (!snap.exists()) return [];
  const val = snap.val() || {};
  const list: School[] = [];
  Object.keys(val).forEach((k) => {
    list.push({ id: k, ...val[k] });
  });
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return list;
}

/**
 * Carrega o histórico de movimentações e remanejamento de livros entre escolas.
 */
export async function carregarMovimentacoesLivros(): Promise<{ id: string; val: BookMovement }[]> {
  const snap = await get(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
  if (!snap.exists()) return [];
  const val = snap.val() || {};
  return Object.keys(val).map((id) => ({ id, val: val[id] }));
}

/**
 * Registra a transferência/remanejamento de exemplares de um livro entre escolas.
 * Atualiza os acervos no MESMO registro do livro (SEM redundância de catálogo),
 * transferindo o quantitativo de exemplares entre as escolas.
 */
export async function registrarMovimentacaoLivro(params: {
  bookId: string;
  bookData: Book;
  sourceSchoolId: string;
  sourceSchoolName: string;
  targetSchoolId: string;
  targetSchoolName: string;
  copies: number;
  reason?: string;
  targetLocation?: string;
  responsibleName?: string;
}): Promise<string> {
  const now = Date.now();
  const uid = getCurrentAuthUid();
  const copiesToMove = Math.max(1, Number(params.copies) || 1);

  // 1. Validar e transferir cópias no mesmo documento do livro
  const bookSnap = await get(ref(rtdb, `diario-classe/biblioteca/livros/${params.bookId}`));
  if (!bookSnap.exists()) {
    throw new Error('Livro não encontrado no catálogo da rede.');
  }

  const book = bookSnap.val() as Book;
  const holdings: Record<string, SchoolCopyHolding> = book.copiesBySchool ? { ...book.copiesBySchool } : {};

  // Se o livro ainda não tinha copiesBySchool estruturado, inicializa a partir dos dados do livro
  if (Object.keys(holdings).length === 0) {
    const origId = book.schoolId || params.sourceSchoolId;
    holdings[origId] = {
      schoolName: book.schoolName || params.sourceSchoolName,
      totalCopies: Number(book.totalCopies || 1),
      availableCopies: Number(book.availableCopies ?? book.totalCopies ?? 1),
      location: book.location || ''
    };
  }

  const sourceHolding = holdings[params.sourceSchoolId] || {
    schoolName: params.sourceSchoolName,
    totalCopies: Number(book.totalCopies || 0),
    availableCopies: Number(book.availableCopies ?? 0),
    location: book.location || ''
  };

  const currentAvail = Number(sourceHolding.availableCopies ?? 0);
  if (currentAvail < copiesToMove) {
    throw new Error(
      `Exemplares insuficientes na escola de origem (${params.sourceSchoolName}). Disponíveis: ${currentAvail}, solicitados: ${copiesToMove}.`
    );
  }

  // Abate da escola de origem
  sourceHolding.totalCopies = Math.max(0, sourceHolding.totalCopies - copiesToMove);
  sourceHolding.availableCopies = Math.max(0, sourceHolding.availableCopies - copiesToMove);
  holdings[params.sourceSchoolId] = sourceHolding;

  // Adiciona à escola de destino
  const targetHolding = holdings[params.targetSchoolId] || {
    schoolName: params.targetSchoolName,
    totalCopies: 0,
    availableCopies: 0,
    location: params.targetLocation || ''
  };

  targetHolding.totalCopies = (targetHolding.totalCopies || 0) + copiesToMove;
  targetHolding.availableCopies = (targetHolding.availableCopies || 0) + copiesToMove;
  if (params.targetLocation) {
    targetHolding.location = params.targetLocation;
  }
  holdings[params.targetSchoolId] = targetHolding;

  // Recalcula totais consolidados da rede
  const consolidatedTotal = Object.values(holdings).reduce((acc, h) => acc + (Number(h.totalCopies) || 0), 0);
  const consolidatedAvail = Object.values(holdings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);

  // Atualiza O MESMO registro do livro (SEM DUPLICAÇÃO DE DADOS!)
  await update(ref(rtdb, `diario-classe/biblioteca/livros/${params.bookId}`), {
    copiesBySchool: holdings,
    totalCopies: consolidatedTotal,
    availableCopies: consolidatedAvail,
    updatedAt: now
  });

  // Atualiza também os acervos físicos das duas escolas
  await update(ref(rtdb, `diario-classe/biblioteca/acervos/${params.sourceSchoolId}/${params.bookId}`), {
    totalCopies: sourceHolding.totalCopies,
    availableCopies: sourceHolding.availableCopies,
    updatedAt: now
  });
  await set(ref(rtdb, `diario-classe/biblioteca/acervos/${params.targetSchoolId}/${params.bookId}`), {
    totalCopies: targetHolding.totalCopies,
    availableCopies: targetHolding.availableCopies,
    code: targetHolding.code || book.code,
    schoolName: params.targetSchoolName,
    location: targetHolding.location || '',
    updatedAt: now
  });

  // 2. Gravar histórico de movimentação
  const movData: BookMovement = {
    bookId: params.bookId,
    bookTitle: book.title,
    bookCode: book.code,
    sourceSchoolId: params.sourceSchoolId,
    sourceSchoolName: params.sourceSchoolName,
    targetSchoolId: params.targetSchoolId,
    targetSchoolName: params.targetSchoolName,
    copies: copiesToMove,
    date: new Date().toISOString().split('T')[0],
    reason: params.reason || 'Remanejamento de acervo entre escolas',
    responsibleUid: uid || '',
    responsibleName: params.responsibleName || '',
    createdAt: now
  };

  const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
  await set(movRef, cleanFirebaseData(movData));
  return movRef.key!;
}

/**
 * Exclui um registro individual do histórico de movimentações da biblioteca.
 */
export async function excluirMovimentacaoLivro(id: string): Promise<void> {
  await remove(ref(rtdb, `diario-classe/biblioteca/movimentacoes/${id}`));
}

/**
 * Limpa todo o histórico de movimentações da biblioteca (para reiniciar em produção).
 */
export async function limparTodasMovimentacoes(): Promise<void> {
  await remove(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
}

/**
 * ============================================================================
 * CANTINHO DA LEITURA (BIBLIOTECA EM SALA DE AULA)
 * ============================================================================
 * Permite que professores e bibliotecários selecionem obras do acervo central
 * da biblioteca escolar para ficarem disponíveis temporariamente no espaço
 * de leitura da sala de aula / turma. Os exemplares selecionados saem do
 * acervo disponível da escola e passam a circular diretamente entre os alunos
 * daquela turma.
 */

/**
 * Aloca exemplares de uma obra literária para o Cantinho da Leitura de uma turma.
 * Os livros selecionados saem temporariamente do acervo central da biblioteca da escola (availableCopies diminui).
 */
export async function alocarLivroCantinho(params: {
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
  copies?: number;
  copiesToAllocate?: number;
  notes?: string;
  userDisplayName?: string;
}): Promise<void> {
  const copiesToMove = Math.max(1, Number(params.copiesToAllocate ?? params.copies) || 1);
  const now = Date.now();
  const uid = auth.currentUser?.uid || '';
  const allocationKey = `${params.turmaId}_${params.bookId}`;

  // 1. Verifica e debita exemplares no acervo da escola.
  // O nó "acervos" pode estar ausente/desatualizado em livros cadastrados antes de uma correção
  // de permissão anterior — nesse caso, sincroniza a partir de livros/{id}.copiesBySchool
  // (a mesma fonte que a aba Acervo exibe) antes de desistir.
  const acervoRef = ref(rtdb, `diario-classe/biblioteca/acervos/${params.schoolId}/${params.bookId}`);
  let acervoSnap = await get(acervoRef);

  if (!acervoSnap.exists()) {
    const bookSnapForSync = await get(ref(rtdb, `diario-classe/biblioteca/livros/${params.bookId}`));
    const holding = bookSnapForSync.exists()
      ? ((bookSnapForSync.val() as Book).copiesBySchool || {})[params.schoolId]
      : null;

    if (!holding) {
      throw new Error('A obra não foi localizada no acervo desta escola.');
    }

    // Sincroniza o nó acervos a partir do holding encontrado no catálogo, para este e futuros usos
    await set(acervoRef, cleanFirebaseData({
      totalCopies: Number(holding.totalCopies) || 0,
      availableCopies: Number(holding.availableCopies) || 0,
      code: holding.code || '',
      schoolName: holding.schoolName || params.schoolName,
      location: holding.location || '',
      updatedAt: now
    }));
    acervoSnap = await get(acervoRef);
  }

  const acervoVal = acervoSnap.val();
  const currentAvail = Number(acervoVal.availableCopies) || 0;
  if (currentAvail < copiesToMove) {
    throw new Error(`Exemplares insuficientes no acervo da escola (${currentAvail} disponível(is), requisitado: ${copiesToMove}).`);
  }

  // Atualiza estoque físico da escola
  await update(acervoRef, {
    availableCopies: Math.max(0, currentAvail - copiesToMove),
    updatedAt: now
  });

  // Atualiza também o catálogo geral da rede
  try {
    const bookRef = ref(rtdb, `diario-classe/biblioteca/livros/${params.bookId}`);
    const bookSnap = await get(bookRef);
    if (bookSnap.exists()) {
      const bVal = bookSnap.val() as Book;
      const holdings = bVal.copiesBySchool ? { ...bVal.copiesBySchool } : {};
      if (holdings[params.schoolId]) {
        holdings[params.schoolId].availableCopies = Math.max(0, (holdings[params.schoolId].availableCopies || 0) - copiesToMove);
      }
      const consolidatedAvail = Object.values(holdings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);
      await update(bookRef, cleanFirebaseData({
        copiesBySchool: holdings,
        availableCopies: consolidatedAvail,
        updatedAt: now
      }));
    }
  } catch {
    // Continua caso não tenha permissão de gravar no catálogo global
  }

  // 2. Registra ou atualiza alocação no Cantinho da Leitura
  const cantinhoRef = ref(rtdb, `diario-classe/biblioteca/cantinhos/${allocationKey}`);
  const cantinhoSnap = await get(cantinhoRef);
  if (cantinhoSnap.exists()) {
    const existing = cantinhoSnap.val() as ReadingCornerBook;
    const newTotal = (Number(existing.totalCopies) || 0) + copiesToMove;
    const newAvail = (Number(existing.availableCopies) || 0) + copiesToMove;
    await update(cantinhoRef, cleanFirebaseData({
      totalCopies: newTotal,
      availableCopies: newAvail,
      notes: params.notes || existing.notes || '',
      updatedAt: now
    }));
  } else {
    const newCornerBook: ReadingCornerBook = {
      id: allocationKey,
      turmaId: params.turmaId,
      turmaName: params.turmaName,
      schoolId: params.schoolId,
      schoolName: params.schoolName,
      bookId: params.bookId,
      bookTitle: params.bookTitle,
      bookAuthor: params.bookAuthor || '',
      bookCode: params.bookCode || '',
      coverUrl: params.coverUrl || '',
      genre: params.genre || '',
      totalCopies: copiesToMove,
      availableCopies: copiesToMove,
      allocatedAt: now,
      allocatedByUid: uid,
      allocatedByName: params.userDisplayName || '',
      notes: params.notes || '',
      updatedAt: now
    };
    await set(cantinhoRef, cleanFirebaseData(newCornerBook));
  }

  // 3. Registra movimentação no histórico
  try {
    const movData: BookMovement = {
      bookId: params.bookId,
      bookTitle: params.bookTitle,
      bookCode: params.bookCode,
      sourceSchoolId: params.schoolId,
      sourceSchoolName: `${params.schoolName} (Acervo Central)`,
      targetSchoolId: params.turmaId,
      targetSchoolName: `Cantinho da Leitura (${params.turmaName})`,
      copies: copiesToMove,
      date: new Date().toISOString().split('T')[0],
      reason: `Disponibilizado no Cantinho da Leitura da turma ${params.turmaName}`,
      responsibleUid: uid,
      responsibleName: params.userDisplayName || 'Professor/Bibliotecário',
      createdAt: now
    };
    const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
    await set(movRef, cleanFirebaseData(movData));
  } catch (errMov) {
    console.warn('Registro de movimentação para o cantinho:', errMov);
  }
}

/**
 * Retorna exemplares do Cantinho da Leitura da sala de aula de volta para o acervo central da biblioteca.
 */
export async function retornarLivroCantinho(params: {
  turmaId: string;
  turmaName: string;
  schoolId: string;
  schoolName: string;
  bookId: string;
  bookTitle: string;
  bookCode?: string;
  copiesToReturn: number;
  userDisplayName?: string;
}): Promise<void> {
  const copiesToMove = Math.max(1, Number(params.copiesToReturn) || 1);
  const now = Date.now();
  const uid = auth.currentUser?.uid || '';
  const allocationKey = `${params.turmaId}_${params.bookId}`;

  // 1. Verifica alocação no Cantinho
  const cantinhoRef = ref(rtdb, `diario-classe/biblioteca/cantinhos/${allocationKey}`);
  const cantinhoSnap = await get(cantinhoRef);
  if (!cantinhoSnap.exists()) {
    throw new Error('Esta obra não está registrada no Cantinho da Leitura desta turma.');
  }

  const cornerVal = cantinhoSnap.val() as ReadingCornerBook;
  const totalCornerCopies = Math.max(1, Number(cornerVal.totalCopies) || 1);

  // Calcula disponibilidade física real consultando empréstimos ativos da turma
  let activeLoansCount = 0;
  try {
    const loansSnap = await get(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
    if (loansSnap.exists()) {
      const allLoans = loansSnap.val() || {};
      activeLoansCount = Object.values(allLoans).filter(
        (l: any) =>
          l &&
          l.status === 'ativo' &&
          l.bookId === params.bookId &&
          (l.readingCornerTurmaId === params.turmaId || l.classId === params.turmaId)
      ).length;
    }
  } catch {
    activeLoansCount = Math.max(0, totalCornerCopies - (Number(cornerVal.availableCopies) || 0));
  }

  const realCornerAvail = Math.max(0, totalCornerCopies - activeLoansCount);
  if (realCornerAvail < copiesToMove) {
    throw new Error(`Não é possível devolver ${copiesToMove} exemplar(es). Apenas ${realCornerAvail} exemplar(es) estão fisicamente na estante da sala (os demais estão emprestados a alunos).`);
  }

  const newTotalCorner = totalCornerCopies - copiesToMove;
  const newAvailCorner = Math.max(0, realCornerAvail - copiesToMove);

  // 2. Prepara referências e validação do Acervo da Escola e Catálogo Geral ANTES de alterar o Cantinho
  const acervoRef = ref(rtdb, `diario-classe/biblioteca/acervos/${params.schoolId}/${params.bookId}`);
  const bookRef = ref(rtdb, `diario-classe/biblioteca/livros/${params.bookId}`);

  const [acervoSnap, bookSnap] = await Promise.all([
    get(acervoRef),
    get(bookRef)
  ]);

  let schoolTotalCopies = 1;
  let currSchoolAvail = 0;
  let bookVal: Book | null = bookSnap.exists() ? (bookSnap.val() as Book) : null;
  let holdings: Record<string, SchoolCopyHolding> = bookVal?.copiesBySchool ? { ...bookVal.copiesBySchool } : {};

  if (acervoSnap.exists()) {
    const acervoVal = acervoSnap.val();
    schoolTotalCopies = Math.max(1, Number(acervoVal.totalCopies) || Number(holdings[params.schoolId]?.totalCopies) || 1);
    currSchoolAvail = Math.max(0, Number(acervoVal.availableCopies) || 0);
  } else if (holdings[params.schoolId]) {
    schoolTotalCopies = Math.max(1, Number(holdings[params.schoolId].totalCopies) || 1);
    currSchoolAvail = Math.max(0, Number(holdings[params.schoolId].availableCopies) || 0);
  } else if (bookVal) {
    schoolTotalCopies = Math.max(1, Number(bookVal.totalCopies) || 1);
    currSchoolAvail = Math.max(0, Number(bookVal.availableCopies) || 0);
  }

  // Teto patrimonial rigoroso: availableCopies da escola NUNCA pode ultrapassar schoolTotalCopies
  const newSchoolAvail = Math.min(schoolTotalCopies, currSchoolAvail + copiesToMove);

  // 3. Atualiza o acervo físico da escola
  await set(acervoRef, cleanFirebaseData({
    totalCopies: schoolTotalCopies,
    availableCopies: newSchoolAvail,
    code: params.bookCode || holdings[params.schoolId]?.code || bookVal?.code || '',
    schoolName: params.schoolName || holdings[params.schoolId]?.schoolName || '',
    location: holdings[params.schoolId]?.location || bookVal?.location || '',
    updatedAt: now
  }));

  // 4. Atualiza catálogo geral de títulos na rede
  if (bookVal) {
    if (holdings[params.schoolId]) {
      const holdingTotal = Math.max(1, Number(holdings[params.schoolId].totalCopies) || schoolTotalCopies);
      holdings[params.schoolId].availableCopies = Math.min(
        holdingTotal,
        (Number(holdings[params.schoolId].availableCopies) || 0) + copiesToMove
      );
    }
    const consolidatedAvail = Object.values(holdings).reduce((acc, h) => acc + (Number(h.availableCopies) || 0), 0);
    await update(bookRef, cleanFirebaseData({
      copiesBySchool: holdings,
      availableCopies: consolidatedAvail,
      updatedAt: now
    }));
  }

  // 5. Aplica a baixa no Cantinho da Leitura
  if (newTotalCorner <= 0) {
    await remove(cantinhoRef);
  } else {
    await update(cantinhoRef, cleanFirebaseData({
      totalCopies: newTotalCorner,
      availableCopies: newAvailCorner,
      updatedAt: now
    }));
  }

  // 4. Registra movimentação no histórico
  try {
    const movData: BookMovement = {
      bookId: params.bookId,
      bookTitle: params.bookTitle,
      bookCode: params.bookCode,
      sourceSchoolId: params.turmaId,
      sourceSchoolName: `Cantinho da Leitura (${params.turmaName})`,
      targetSchoolId: params.schoolId,
      targetSchoolName: `${params.schoolName} (Acervo Central)`,
      copies: copiesToMove,
      date: new Date().toISOString().split('T')[0],
      reason: `Retorno do Cantinho da Leitura (${params.turmaName}) ao acervo central`,
      responsibleUid: uid,
      responsibleName: params.userDisplayName || 'Professor/Bibliotecário',
      createdAt: now
    };
    const movRef = push(ref(rtdb, 'diario-classe/biblioteca/movimentacoes'));
    await set(movRef, cleanFirebaseData(movData));
  } catch (errMov) {
    console.warn('Registro de retorno do cantinho:', errMov);
  }
}

/**
 * Carrega todos os livros alocados nos Cantinhos da Leitura das salas de aula.
 * Realiza auto-reconciliação com o banco de dados contra empréstimos ativos para desengargalar contagens presas.
 */
export async function carregarCantinhos(turmaId?: string): Promise<{ id: string; val: ReadingCornerBook }[]> {
  const snap = await get(ref(rtdb, 'diario-classe/biblioteca/cantinhos'));
  if (!snap.exists()) return [];
  const val = snap.val() || {};

  // Buscar empréstimos ativos para reconciliação automática do banco
  let activeLoans: BookLoan[] = [];
  try {
    const loansSnap = await get(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
    if (loansSnap.exists()) {
      const allLoans = loansSnap.val() || {};
      activeLoans = Object.values(allLoans).filter((l: any) => l && l.status === 'ativo') as BookLoan[];
    }
  } catch {
    // Continua se falhar a leitura
  }

  const list: { id: string; val: ReadingCornerBook }[] = [];
  for (const id of Object.keys(val)) {
    const cornerBook = val[id] as ReadingCornerBook;
    const total = Math.max(1, Number(cornerBook.totalCopies) || 1);

    // Contar empréstimos ativos reais desta turma/obra
    const activeForThisBook = activeLoans.filter(
      (l) =>
        l.bookId === cornerBook.bookId &&
        (l.readingCornerTurmaId === cornerBook.turmaId || l.classId === cornerBook.turmaId)
    ).length;
    const calculatedAvail = Math.max(0, Math.min(total, total - activeForThisBook));

    // Se o banco estiver com valor divergente (ex: travado em 0 por falhas passadas), auto-repara no Firebase
    if (cornerBook.availableCopies !== calculatedAvail) {
      cornerBook.availableCopies = calculatedAvail;
      update(ref(rtdb, `diario-classe/biblioteca/cantinhos/${id}`), {
        availableCopies: calculatedAvail,
        updatedAt: Date.now()
      }).catch(() => {});
    }

    list.push({ id, val: cornerBook });
  }

  if (turmaId && turmaId !== 'todas') {
    return list.filter((item) => item.val.turmaId === turmaId);
  }
  return list;
}

/**
 * Registra o empréstimo de um livro diretamente a partir do Cantinho da Leitura da sala de aula.
 */
export async function emprestarLivroCantinho(params: {
  turmaId: string;
  turmaName: string;
  schoolId: string;
  schoolName: string;
  bookId: string;
  bookTitle: string;
  bookCode?: string;
  studentId: string;
  studentName: string;
  studentNumber?: number | string;
  studentRa?: string;
  dueDate: string;
  notes?: string;
  userDisplayName?: string;
}): Promise<string> {
  const allocationKey = `${params.turmaId}_${params.bookId}`;
  const cantinhoRef = ref(rtdb, `diario-classe/biblioteca/cantinhos/${allocationKey}`);
  const cantinhoSnap = await get(cantinhoRef);
  if (!cantinhoSnap.exists()) {
    throw new Error('A obra selecionada não está disponível no Cantinho da Leitura desta turma.');
  }

  const cornerVal = cantinhoSnap.val() as ReadingCornerBook;
  const total = Math.max(1, Number(cornerVal.totalCopies) || 1);

  // Calcula a disponibilidade REAL confrontando os empréstimos ativos reais da turma
  let activeLoansCount = 0;
  try {
    const loansSnap = await get(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
    if (loansSnap.exists()) {
      const allLoans = loansSnap.val() || {};
      activeLoansCount = Object.values(allLoans).filter(
        (l: any) =>
          l &&
          l.status === 'ativo' &&
          l.bookId === params.bookId &&
          (l.readingCornerTurmaId === params.turmaId || l.classId === params.turmaId)
      ).length;
    }
  } catch {
    activeLoansCount = Math.max(0, total - (Number(cornerVal.availableCopies) || 0));
  }

  const realAvail = Math.max(0, total - activeLoansCount);
  if (realAvail < 1) {
    throw new Error('Todos os exemplares desta obra no Cantinho da Leitura já estão emprestados a outros alunos.');
  }

  // Registra empréstimo oficial primeiro (sem debitar da biblioteca central da escola)
  const loanId = await registrarEmprestimo({
    bookId: params.bookId,
    bookTitle: params.bookTitle,
    bookCode: params.bookCode,
    studentId: params.studentId,
    studentName: params.studentName,
    studentNumber: params.studentNumber,
    studentRa: params.studentRa,
    classId: params.turmaId,
    className: params.turmaName,
    schoolId: params.schoolId,
    schoolName: params.schoolName,
    loanDate: new Date().toISOString().split('T')[0],
    dueDate: params.dueDate,
    status: 'ativo',
    notes: params.notes ? `[Cantinho da Leitura] ${params.notes}` : '[Cantinho da Leitura]',
    registeredByName: params.userDisplayName || 'Professor',
    isReadingCorner: true,
    readingCornerTurmaId: params.turmaId,
    readingCornerTurmaName: params.turmaName
  });

  // Decrementa disponível no cantinho da sala após salvar o empréstimo com base no valor real
  try {
    await update(cantinhoRef, {
      availableCopies: Math.max(0, realAvail - 1),
      updatedAt: Date.now()
    });
  } catch (errCorner) {
    // Se falhar no cantinho, desfaz o empréstimo para manter consistência
    try {
      await remove(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`));
    } catch {
      // ignore
    }
    throw errCorner;
  }

  return loanId;
}

/**
 * Devolução de empréstimo realizado a partir do Cantinho da Leitura.
 * O exemplar volta para a estante da sala de aula (cantinho).
 */
export async function devolverEmprestimoCantinho(loanId: string, notes?: string): Promise<void> {
  const loanSnap = await get(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`));
  if (!loanSnap.exists()) throw new Error('Empréstimo não localizado.');
  const loan = loanSnap.val() as BookLoan;
  if (loan.status === 'devolvido') return;

  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];

  // Incrementa exemplar disponível na estante da sala de aula
  if (loan.readingCornerTurmaId || loan.classId) {
    const turmaId = loan.readingCornerTurmaId || loan.classId;
    const allocationKey = `${turmaId}_${loan.bookId}`;
    const cantinhoRef = ref(rtdb, `diario-classe/biblioteca/cantinhos/${allocationKey}`);
    const cantinhoSnap = await get(cantinhoRef);
    if (cantinhoSnap.exists()) {
      const cornerVal = cantinhoSnap.val() as ReadingCornerBook;
      const currAvail = Number(cornerVal.availableCopies) || 0;
      await update(cantinhoRef, {
        availableCopies: Math.min(Number(cornerVal.totalCopies) || 1, currAvail + 1),
        updatedAt: now
      });
    }
  }

  // Atualiza registro de empréstimo para devolvido
  await update(ref(rtdb, `diario-classe/biblioteca/emprestimos/${loanId}`), cleanFirebaseData({
    status: 'devolvido',
    returnDate: todayStr,
    notes: notes ? `${loan.notes || ''} • Devolução: ${notes}` : loan.notes,
    updatedAt: now
  }));
}

/**
 * Carrega a lista de reservas de livros.
 */
export async function carregarReservas(schoolId?: string): Promise<{ id: string; val: BookReservation }[]> {
  const snap = await get(ref(rtdb, 'diario-classe/biblioteca/reservas'));
  if (!snap.exists()) return [];
  const val = snap.val() || {};
  const list = Object.keys(val).map((id) => ({ id, val: val[id] as BookReservation }));
  if (schoolId) {
    return list.filter((item) => !item.val.schoolId || item.val.schoolId === schoolId);
  }
  return list;
}

/**
 * Cria uma nova reserva de livro quando não houver exemplares disponíveis.
 */
export async function criarReserva(
  reserva: Omit<BookReservation, 'id' | 'createdAt' | 'updatedAt' | 'status'>
): Promise<string> {
  const now = Date.now();
  const data: BookReservation = {
    ...reserva,
    status: 'ativa',
    createdAt: now,
    updatedAt: now
  };

  const newRef = push(ref(rtdb, 'diario-classe/biblioteca/reservas'));
  await set(newRef, data);
  return newRef.key!;
}

/**
 * Cancela uma reserva existente.
 */
export async function cancelarReserva(reservaId: string): Promise<void> {
  const now = Date.now();
  await update(ref(rtdb, `diario-classe/biblioteca/reservas/${reservaId}`), {
    status: 'cancelada',
    updatedAt: now
  });
}

/**
 * Marca uma reserva como atendida (quando o exemplar é retirado).
 */
export async function atenderReserva(reservaId: string): Promise<void> {
  const now = Date.now();
  await update(ref(rtdb, `diario-classe/biblioteca/reservas/${reservaId}`), {
    status: 'atendida',
    updatedAt: now
  });
}

export type { User };

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  ref,
  get,
  set,
  update,
  push,
  remove,
  query,
  orderByChild,
  equalTo,
  limitToLast
};
