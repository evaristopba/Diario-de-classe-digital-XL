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
  DataSnapshot,
  onValue
} from 'firebase/database';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { School, ClassRoom, Student, Book, BookLoan, Teacher, BookMovement, SchoolCopyHolding, BookReservation, SchoolAcervoItem, ReadingCornerBook } from '../types';
import {
  mesclarNotasDeUsuarios,
  decidirGravacaoNotaOrigem,
  consolidarNotasDeOrigem,
  type NotasAgregadas,
  type NotaOrigemColetada
} from './notasAgregadas';
import { normalizarRA, saoRAsIguais, compararIdentidade, type IdentidadeAluno } from './identidadeAluno';

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

// Sincronização de data/hora oficial do servidor Firebase Realtime Database
let serverTimeOffsetMs = 0;
try {
  const offsetRef = ref(rtdb, '.info/serverTimeOffset');
  onValue(offsetRef, (snap) => {
    const val = snap.val();
    if (typeof val === 'number') {
      serverTimeOffsetMs = val;
    }
  });
} catch {
  serverTimeOffsetMs = 0;
}

/**
 * Retorna o timestamp em milissegundos ajustado pelo offset oficial do servidor Firebase.
 */
export function getServerTimestamp(): number {
  return Date.now() + serverTimeOffsetMs;
}

/**
 * Retorna o objeto Date sincronizado com o relógio do servidor Firebase.
 */
export function getServerDate(): Date {
  return new Date(getServerTimestamp());
}

/**
 * Retorna a data atual no formato YYYY-MM-DD garantindo o alinhamento com a data
 * do dispositivo sincronizada ao servidor Firebase, prevenindo o salto involuntário
 * de dia ocasionado pela conversão UTC pura (ex.: noites após 21h no fuso de Brasília).
 */
export function getTodayDateString(customDate?: Date | number): string {
  const d = customDate
    ? (typeof customDate === 'number' ? new Date(customDate) : customDate)
    : getServerDate();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  'diario-classe/biblioteca',
  'diario-classe/config'
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

/**
 * Carrega as notas visíveis para o usuário atual.
 * - Professor (não administrador): somente o próprio nó (comportamento de sempre).
 * - Administrador: o próprio nó + o nó de cada professor/usuário conhecido, mesclados.
 *   Os uids vêm de professores, atribuições e administradores (listas legíveis), o que evita
 *   baixar chamadas, eventos e planos de todos os usuários só para ler as notas.
 *   Se a leitura dos demais nós falhar, mantém o que conseguiu ler (nunca quebra a tela).
 */
export async function carregarNotasVisiveis(isAdminConhecido?: boolean): Promise<NotasAgregadas & { parcial: boolean }> {
  const currentUid = getCurrentAuthUid();
  if (!currentUid) return { notas: {}, vencedor: {}, donos: {}, parcial: true };

  const porUsuario: Record<string, Record<string, any> | null> = {};
  const minhasSnap = await get(ref(rtdb, dc('notas')));
  porUsuario[currentUid] = minhasSnap.val() || {};

  const admin = isAdminConhecido ?? (await verificarIsAdmin(currentUid));
  // Professor comum só enxerga o próprio nó: leitura "parcial" por definição.
  let parcial = !admin;

  if (admin) {
    try {
      const [profSnap, atribSnap, adminsSnap] = await Promise.all([
        get(ref(rtdb, 'diario-classe/professores')).catch(() => null),
        get(ref(rtdb, 'diario-classe/atribuicoes')).catch(() => null),
        get(ref(rtdb, 'diario-classe/admins')).catch(() => null)
      ]);
      const uids = new Set<string>();
      [profSnap, atribSnap, adminsSnap].forEach((snap) => {
        if (!snap) {
          parcial = true; // uma das listas de usuários não pôde ser lida
          return;
        }
        if (snap.exists()) {
          Object.keys(snap.val() || {}).forEach((u) => uids.add(u));
        }
      });
      uids.delete(currentUid);

      await Promise.all(
        Array.from(uids).map(async (uid) => {
          try {
            const snap = await get(ref(rtdb, `diario-classe/dados/${uid}/notas`));
            if (snap.exists()) porUsuario[uid] = snap.val() || {};
          } catch (e) {
            parcial = true;
            console.warn(`[carregarNotasVisiveis] Sem leitura das notas de ${uid}:`, e);
          }
        })
      );
    } catch (e) {
      parcial = true;
      console.warn('[carregarNotasVisiveis] Leitura dos demais nós ignorada:', e);
    }
  }

  return { ...mesclarNotasDeUsuarios(porUsuario, currentUid), parcial };
}

/**
 * Substituto direto de `get(ref(rtdb, dc('notas')))` nos relatórios:
 * devolve um objeto com `val()` e `exists()`, já com as notas mescladas para administradores.
 */
export async function lerNotasDoPerfil(): Promise<{ val: () => Record<string, any>; exists: () => boolean }> {
  const { notas } = await carregarNotasVisiveis();
  return {
    val: () => notas,
    exists: () => Object.keys(notas).length > 0
  };
}

/**
 * Verifica se a opção de exibir a Apresentação Municipal/Pitch no painel principal está ativada.
 * Somente tem efeito se o usuário for Administrador.
 */
export async function verificarExibirApresentacaoAdmin(uid?: string | null): Promise<boolean> {
  const isAdmin = await verificarIsAdmin(uid);
  if (!isAdmin) return false;

  const targetUid = uid || getCurrentAuthUid();

  try {
    // 1. Verifica no banco se há configuração global/do admin
    const configSnap = await get(ref(rtdb, 'diario-classe/config/exibirApresentacaoAdmin'));
    if (configSnap.exists()) {
      return configSnap.val() === true;
    }

    if (targetUid) {
      // 2. Verifica se no nó do professor o campo exibirApresentacaoAdmin está true
      const profDirectSnap = await get(ref(rtdb, `diario-classe/professores/${targetUid}`));
      if (profDirectSnap.exists() && profDirectSnap.val()?.exibirApresentacaoAdmin !== undefined) {
        return profDirectSnap.val()?.exibirApresentacaoAdmin === true;
      }

      // Buscar professores pelo authUid
      const allProfsSnap = await get(ref(rtdb, 'diario-classe/professores'));
      if (allProfsSnap.exists()) {
        const profs = allProfsSnap.val();
        for (const k of Object.keys(profs)) {
          const p = profs[k];
          if (p?.authUid === targetUid && p?.exibirApresentacaoAdmin !== undefined) {
            return p.exibirApresentacaoAdmin === true;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback no localStorage
  return localStorage.getItem('dc_exibir_apresentacao_admin') === 'true';
}

/**
 * Salva a preferência de exibição do atalho de Apresentação Municipal para o Administrador.
 */
export async function salvarConfigExibirApresentacaoAdmin(exibir: boolean, teacherId?: string): Promise<void> {
  localStorage.setItem('dc_exibir_apresentacao_admin', exibir ? 'true' : 'false');
  try {
    await set(ref(rtdb, 'diario-classe/config/exibirApresentacaoAdmin'), exibir);
    if (teacherId) {
      await update(ref(rtdb, `diario-classe/professores/${teacherId}`), {
        exibirApresentacaoAdmin: exibir,
        updatedAt: Date.now()
      });
    } else {
      const uid = getCurrentAuthUid();
      if (uid) {
        const profRef = ref(rtdb, `diario-classe/professores/${uid}`);
        const profSnap = await get(profRef);
        if (profSnap.exists()) {
          await update(profRef, { exibirApresentacaoAdmin: exibir, updatedAt: Date.now() });
        }
      }
    }
  } catch (err) {
    console.warn('Erro ao sincronizar configuração de apresentação:', err);
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

export interface UserAccessStatus {
  isAuthorized: boolean;
  isAdmin: boolean;
  isLibrarian: boolean;
  hasAssignments: boolean;
  reason?: 'no_assignments' | 'ok';
}

/**
 * Verifica o status de autorização do usuário imediatamente após o login.
 * Lê apenas os nós permitidos pelas regras de segurança:
 * 1. admins/{uid} e admins (para bootstrap)
 * 2. bibliotecarios/{uid}
 * 3. atribuicoes/{uid}
 * Se não tiver papel de admin, bibliotecário ou turmas atribuídas, o app entra no estado gracioso de espera.
 */
export async function checkUserAccessStatus(uid: string): Promise<UserAccessStatus> {
  if (!uid) {
    return { isAuthorized: false, isAdmin: false, isLibrarian: false, hasAssignments: false, reason: 'no_assignments' };
  }

  // 1. Verificar se é Administrador
  try {
    const adminSnap = await get(ref(rtdb, `diario-classe/admins/${uid}`));
    if (adminSnap.val() === true) {
      return { isAuthorized: true, isAdmin: true, isLibrarian: false, hasAssignments: true, reason: 'ok' };
    }
  } catch {
    // ignore
  }

  // 1.1 Se a base não possuir nenhum admin configurado (bootstrap inicial)
  try {
    const allAdminsSnap = await get(ref(rtdb, 'diario-classe/admins'));
    if (!allAdminsSnap.exists() || allAdminsSnap.val() === null) {
      return { isAuthorized: true, isAdmin: true, isLibrarian: false, hasAssignments: true, reason: 'ok' };
    }
  } catch {
    // ignore
  }

  // 2. Verificar se é Bibliotecário
  try {
    const bibSnap = await get(ref(rtdb, `diario-classe/bibliotecarios/${uid}`));
    if (bibSnap.val() === true) {
      return { isAuthorized: true, isAdmin: false, isLibrarian: true, hasAssignments: true, reason: 'ok' };
    }
    const profSnap = await get(ref(rtdb, `diario-classe/professores/${uid}`));
    if (profSnap.val()?.canManageLibrary === true) {
      return { isAuthorized: true, isAdmin: false, isLibrarian: true, hasAssignments: true, reason: 'ok' };
    }
  } catch {
    // ignore
  }

  // 3. Ler atribuicoes/{uid} (permitido a qualquer autenticado)
  try {
    const atribSnap = await get(ref(rtdb, `diario-classe/atribuicoes/${uid}`));
    if (atribSnap.exists()) {
      const val = atribSnap.val() || {};
      const hasTrue = Object.values(val).some((v) => v === true);
      if (hasTrue) {
        return { isAuthorized: true, isAdmin: false, isLibrarian: false, hasAssignments: true, reason: 'ok' };
      }
    }
  } catch {
    // ignore
  }

  // 4. Checar se o professor possui registro no corpo docente com atribuição sob alias
  try {
    const profsSnap = await get(ref(rtdb, 'diario-classe/professores'));
    if (profsSnap.exists()) {
      const profsVal = profsSnap.val() || {};
      const currentUser = auth.currentUser;
      const currentEmail = (currentUser?.email || '').toLowerCase().trim();
      const currentName = (currentUser?.displayName || localStorage.getItem('dc_teacher_name') || '').toLowerCase().trim();

      for (const key of Object.keys(profsVal)) {
        const p = profsVal[key] || {};
        const pEmail = (p.email || '').toLowerCase().trim();
        const pAuthEmail = (p.authEmail || '').toLowerCase().trim();
        const pName = (p.name || '').toLowerCase().trim();
        const pAuthUid = p.authUid;

        if (
          key === uid ||
          pAuthUid === uid ||
          (currentEmail && pAuthEmail && pAuthEmail === currentEmail) ||
          (currentEmail && pEmail && pEmail === currentEmail) ||
          (currentName && pName && pName === currentName)
        ) {
          if (p.canManageLibrary === true) {
            try {
              const bibUpdates: Record<string, any> = {};
              bibUpdates[`diario-classe/bibliotecarios/${uid}`] = true;
              if (key !== uid) {
                bibUpdates[`diario-classe/professores/${uid}/canManageLibrary`] = true;
                if (!p.authUid) bibUpdates[`diario-classe/professores/${key}/authUid`] = uid;
              }
              await update(ref(rtdb), bibUpdates);
            } catch {
              // ignore
            }
            return { isAuthorized: true, isAdmin: false, isLibrarian: true, hasAssignments: true, reason: 'ok' };
          }
          if (key !== uid) {
            try {
              const aliasAtribSnap = await get(ref(rtdb, `diario-classe/atribuicoes/${key}`));
              if (aliasAtribSnap.exists()) {
                const val = aliasAtribSnap.val() || {};
                const hasTrue = Object.values(val).some((v) => v === true);
                if (hasTrue) {
                  // Sincroniza silenciosamente a atribuição para o auth.uid
                  try {
                    const syncUpdates: Record<string, any> = {};
                    Object.keys(val).forEach((cid) => {
                      if (val[cid]) syncUpdates[`diario-classe/atribuicoes/${uid}/${cid}`] = true;
                    });
                    if (!p.authUid) syncUpdates[`diario-classe/professores/${key}/authUid`] = uid;
                    await update(ref(rtdb), syncUpdates);
                  } catch {
                    // ignore
                  }
                  return { isAuthorized: true, isAdmin: false, isLibrarian: false, hasAssignments: true, reason: 'ok' };
                }
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return { isAuthorized: false, isAdmin: false, isLibrarian: false, hasAssignments: false, reason: 'no_assignments' };
}

// Helpers for Classes & Students
export async function carregarMinhasTurmas(): Promise<{ id: string; val: ClassRoom }[]> {
  const uid = getCurrentAuthUid();
  if (!uid) return [];

  const currentUser = auth.currentUser;
  const currentEmail = currentUser?.email?.toLowerCase().trim();
  const currentDisplayName = (currentUser?.displayName || localStorage.getItem('dc_teacher_name') || '').toLowerCase().trim();

  // 1. Carrega todas as turmas cadastradas na base compartilhada de forma resiliente
  let allTurmasSnap;
  try {
    allTurmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
  } catch (err: any) {
    // Se não tiver permissão de leitura, trata como sem turmas disponíveis graciosamente
    return [];
  }

  if (!allTurmasSnap || !allTurmasSnap.exists()) {
    return [];
  }

  const allTurmasVal = allTurmasSnap.val() as Record<string, ClassRoom>;
  const allTurmasList = Object.keys(allTurmasVal).map((id) => ({ id, val: allTurmasVal[id] }));

  // 2. Se for admin, carrega todas as turmas
  try {
    const adminSnap = await get(ref(rtdb, `diario-classe/admins/${uid}`));
    if (adminSnap.val() === true) {
      return allTurmasList;
    }
  } catch {
    // ignore
  }

  let hasAdminsConfigured = true;
  try {
    const allAdminsSnap = await get(ref(rtdb, 'diario-classe/admins'));
    hasAdminsConfigured = allAdminsSnap.exists() && Object.keys(allAdminsSnap.val() || {}).length > 0;
  } catch {
    // ignore
  }

  // 3. Mapear todas as chaves associadas a este usuário/docente
  let profsVal: Record<string, any> = {};
  try {
    const profsSnap = await get(ref(rtdb, 'diario-classe/professores'));
    profsVal = profsSnap.val() || {};
  } catch {
    // ignore
  }

  const relevantTeacherKeys = new Set<string>([uid]);
  let matchedTeacherRecordKey: string | null = null;

  Object.keys(profsVal).forEach((key) => {
    const p = profsVal[key] || {};
    const pEmail = (p.email || '').toLowerCase().trim();
    const pAuthEmail = (p.authEmail || '').toLowerCase().trim();
    const pName = (p.name || '').toLowerCase().trim();
    const pAuthUid = p.authUid;

    if (
      key === uid ||
      pAuthUid === uid ||
      (currentEmail && pAuthEmail && pAuthEmail === currentEmail) ||
      (currentEmail && pEmail && pEmail === currentEmail) ||
      (currentDisplayName && pName && pName === currentDisplayName)
    ) {
      relevantTeacherKeys.add(key);
      if (pAuthUid) relevantTeacherKeys.add(pAuthUid);
      matchedTeacherRecordKey = key;
    }
  });

  // 4. Carregar mapa de atribuições
  let atribsVal: Record<string, Record<string, boolean>> = {};
  try {
    const atribsSnap = await get(ref(rtdb, 'diario-classe/atribuicoes'));
    atribsVal = (atribsSnap.val() || {}) as Record<string, Record<string, boolean>>;
  } catch {
    // Se a leitura ampla não for permitida, tenta a própria chave atribuicoes/{uid}
    try {
      const selfAtribSnap = await get(ref(rtdb, `diario-classe/atribuicoes/${uid}`));
      if (selfAtribSnap.exists()) {
        atribsVal[uid] = selfAtribSnap.val() || {};
      }
    } catch {
      // ignore
    }
  }

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

// Cria ou sincroniza conta no Firebase Authentication para o docente sem deslogar o Admin atual
export async function sincronizarOuCriarContaAuth(
  email: string,
  newPass: string,
  displayName?: string,
  currentStoredPass?: string,
  existingAuthEmail?: string
): Promise<{ uid?: string; authEmail?: string; authUpdated: boolean; error?: any }> {
  const secondaryAppName = `SecondaryApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  const cleanEmail = email.trim().toLowerCase();
  const targetEmail = (existingAuthEmail && existingAuthEmail.trim().toLowerCase()) || cleanEmail;

  try {
    // 1. Se informou uma senha anterior salva no cadastro do banco, tenta atualizar a senha diretamente
    if (currentStoredPass && currentStoredPass !== newPass) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, targetEmail, currentStoredPass);
        await updatePassword(cred.user, newPass);
        if (displayName && cred.user.displayName !== displayName) {
          await updateProfile(cred.user, { displayName });
        }
        const uid = cred.user.uid;
        await signOut(secondaryAuth);
        return { uid, authEmail: targetEmail, authUpdated: true };
      } catch {
        // Se a senha armazenada no banco falhou, tenta com a senha nova ou criação
      }
    }

    // 2. Se a senha nova já for a cadastrada no Firebase Auth
    try {
      const cred = await signInWithEmailAndPassword(secondaryAuth, targetEmail, newPass);
      if (displayName && cred.user.displayName !== displayName) {
        await updateProfile(cred.user, { displayName });
      }
      const uid = cred.user.uid;
      await signOut(secondaryAuth);
      return { uid, authEmail: targetEmail, authUpdated: true };
    } catch {
      // Continua para criação de conta
    }

    // 3. Tentar criar conta diretamente com o e-mail solicitado
    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, newPass);
      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }
      const uid = userCredential.user.uid;
      await signOut(secondaryAuth);
      return { uid, authEmail: cleanEmail, authUpdated: true };
    } catch (createErr: any) {
      if (createErr?.code !== 'auth/email-already-in-use') {
        throw createErr;
      }
    }

    // 4. Se o e-mail já existe no Firebase Auth com senha anterior desconhecida:
    // Provisiona de forma limpa e transparente uma credencial do portal de acesso,
    // garantindo 100% de sucesso sem força bruta e sem bloqueios de taxa (auth/too-many-requests).
    const sanitizedPrefix = cleanEmail.split('@')[0].replace(/[^a-z0-9]/g, '.');
    const portalEmail = targetEmail.endsWith('@escola-diario.internal.net')
      ? targetEmail
      : `${sanitizedPrefix}.portal@escola-diario.internal.net`;

    try {
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, portalEmail, newPass);
      if (displayName) {
        await updateProfile(userCred.user, { displayName });
      }
      const uid = userCred.user.uid;
      await signOut(secondaryAuth);
      return { uid, authEmail: portalEmail, authUpdated: true };
    } catch (portalCreateErr: any) {
      if (portalCreateErr?.code === 'auth/email-already-in-use') {
        // Se a credencial do portal já existia, atualiza sua senha
        if (currentStoredPass) {
          try {
            const cred = await signInWithEmailAndPassword(secondaryAuth, portalEmail, currentStoredPass);
            await updatePassword(cred.user, newPass);
            if (displayName && cred.user.displayName !== displayName) {
              await updateProfile(cred.user, { displayName });
            }
            const uid = cred.user.uid;
            await signOut(secondaryAuth);
            return { uid, authEmail: portalEmail, authUpdated: true };
          } catch {
            // ignore
          }
        }
      }
    }

    await signOut(secondaryAuth);
    return { authUpdated: false };
  } catch (err: any) {
    try {
      await signOut(secondaryAuth);
    } catch {
      // ignore
    }
    return { authUpdated: false, error: err };
  }
}

// Mantém compatibilidade com chamadas diretas
export async function cadastrarContaProfessorAuth(email: string, pass: string, displayName: string): Promise<{ uid: string }> {
  const res = await sincronizarOuCriarContaAuth(email, pass, displayName);
  if (res.uid) return { uid: res.uid };
  throw new Error('Não foi possível registrar a conta no Firebase Auth');
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

  const updates: Record<string, any> = {};
  let targetId = id;

  if (targetId) {
    updates[`diario-classe/professores/${targetId}`] = {
      ...data,
      updatedAt: Date.now()
    };
  } else {
    const newRef = push(ref(rtdb, 'diario-classe/professores'));
    targetId = newRef.key;
    updates[`diario-classe/professores/${targetId}`] = {
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // Sincronizar nó dedicado de bibliotecários para as regras de segurança v4
  const canManageLibrary = !!data.canManageLibrary;
  const authUid = data.authUid || (targetId && targetId.length === 28 ? targetId : null);

  if (authUid) {
    updates[`diario-classe/bibliotecarios/${authUid}`] = canManageLibrary ? true : null;
    if (authUid !== targetId) {
      updates[`diario-classe/professores/${authUid}/canManageLibrary`] = canManageLibrary ? true : null;
    }
  }

  if (targetId) {
    updates[`diario-classe/bibliotecarios/${targetId}`] = canManageLibrary ? true : null;
  }

  // Se o authUid for diferente do targetId, espelha as atribuições de turmas
  if (authUid && targetId && authUid !== targetId) {
    try {
      const atribSnap = await get(ref(rtdb, `diario-classe/atribuicoes/${targetId}`));
      if (atribSnap.exists()) {
        const atribs = atribSnap.val() || {};
        Object.keys(atribs).forEach((cid) => {
          if (atribs[cid]) {
            updates[`diario-classe/atribuicoes/${authUid}/${cid}`] = true;
          }
        });
      }
    } catch {
      // ignore
    }
  }

  await update(ref(rtdb), updates);
  return targetId;
}

export async function excluirProfessor(id: string) {
  const updates: Record<string, any> = {};
  updates[`diario-classe/professores/${id}`] = null;
  updates[`diario-classe/atribuicoes/${id}`] = null;
  updates[`diario-classe/bibliotecarios/${id}`] = null;

  try {
    const snap = await get(ref(rtdb, `diario-classe/professores/${id}`));
    if (snap.exists()) {
      const val = snap.val();
      if (val?.authUid && val.authUid !== id) {
        updates[`diario-classe/professores/${val.authUid}`] = null;
        updates[`diario-classe/atribuicoes/${val.authUid}`] = null;
        updates[`diario-classe/bibliotecarios/${val.authUid}`] = null;
      }
    }
  } catch (e) {
    console.warn('Erro ao verificar authUid para exclusão:', e);
  }

  await update(ref(rtdb), updates);
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
    // 0. Validação de segurança estrita por escola: verificar a disponibilidade real contábil (Ledger)
    const [bookSnap, loansSnap, cantinhosSnap] = await Promise.all([
      get(ref(rtdb, `diario-classe/biblioteca/livros/${emprestimo.bookId}`)),
      get(ref(rtdb, 'diario-classe/biblioteca/emprestimos')),
      get(ref(rtdb, 'diario-classe/biblioteca/cantinhos'))
    ]);

    if (!bookSnap.exists()) {
      throw new Error('Obra não encontrada no catálogo da biblioteca.');
    }

    const bookData = bookSnap.val() as Book;
    const allLoans = loansSnap.exists() ? Object.values(loansSnap.val() as Record<string, BookLoan>) : [];
    const allCantinhos = cantinhosSnap.exists() ? Object.values(cantinhosSnap.val() as Record<string, ReadingCornerBook>) : [];

    // Contabiliza empréstimos centrais ativos para esta obra
    const activeCentralLoans = allLoans.filter(
      (l) => l.bookId === emprestimo.bookId && l.status !== 'devolvido' && !l.isReadingCorner
    );

    // Contabiliza alocações ativas no cantinho da leitura para esta obra
    const activeCantinhoAllocations = allCantinhos.filter(
      (c) => c.bookId === emprestimo.bookId
    );

    // Se o livro tiver distribuição por escola e a escola estiver informada
    if (schoolId && schoolId !== 'rede-geral' && bookData.copiesBySchool) {
      const schoolHolding = bookData.copiesBySchool[schoolId];
      const schoolTotal = schoolHolding ? Number(schoolHolding.totalCopies ?? 0) : 0;
      const schoolActiveLoans = activeCentralLoans.filter((l) => l.schoolId === schoolId).length;
      const schoolCornerCopies = activeCantinhoAllocations
        .filter((c) => c.schoolId === schoolId)
        .reduce((acc, c) => acc + (Number(c.totalCopies) || 0), 0);

      const realSchoolAvail = Math.max(0, schoolTotal - schoolActiveLoans - schoolCornerCopies);

      if (realSchoolAvail <= 0) {
        const schoolName = schoolHolding?.schoolName || emprestimo.schoolName || 'esta escola';
        throw new Error(
          `Exemplar indisponível na unidade ${schoolName}. Não há exemplares físicos disponíveis em estoque nesta escola para realizar o empréstimo.`
        );
      }
    } else {
      // Validação geral de segurança da rede
      const networkTotal = Number(bookData.totalCopies ?? 0);
      const networkActiveLoans = activeCentralLoans.length;
      const networkCornerCopies = activeCantinhoAllocations.reduce((acc, c) => acc + (Number(c.totalCopies) || 0), 0);
      const realNetworkAvail = Math.max(0, networkTotal - networkActiveLoans - networkCornerCopies);

      if (realNetworkAvail <= 0) {
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
 * Carrega a lista de escolas cadastradas de forma robusta e resiliente.
 * Lê o cadastro oficial em diario-classe/escolas (suportando 'name' e 'nome')
 * e complementa automaticamente com as escolas associadas às turmas em diario-classe/turmas.
 */
export async function carregarEscolas(): Promise<School[]> {
  const map: Record<string, School> = {};

  // 1. Lê de diario-classe/escolas
  try {
    const snap = await get(ref(rtdb, 'diario-classe/escolas'));
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((k) => {
        const item = val[k] || {};
        const name = (item.name || item.nome || '').trim();
        map[k] = {
          id: k,
          name: name || 'Escola sem Nome',
          address: item.address || item.endereco || '',
          createdAt: item.createdAt
        };
      });
    }
  } catch (err) {
    console.warn('Aviso ao carregar diario-classe/escolas:', err);
  }

  // 2. Complementa / descobre escolas a partir das turmas cadastradas
  try {
    const turmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
    if (turmasSnap.exists()) {
      const turmasVal = turmasSnap.val() || {};
      Object.keys(turmasVal).forEach((tid) => {
        const t = turmasVal[tid] as ClassRoom;
        if (t && t.schoolId) {
          const sId = t.schoolId;
          const sName = (t.schoolName || '').trim();
          if (!map[sId]) {
            map[sId] = {
              id: sId,
              name: sName || 'Escola sem Nome'
            };
          } else if (!map[sId].name || map[sId].name === 'Escola sem Nome') {
            if (sName) map[sId].name = sName;
          }
        }
      });
    }
  } catch {
    // Se a leitura ampla de turmas falhar, tenta com carregarMinhasTurmas
    try {
      const minhasTurmas = await carregarMinhasTurmas();
      minhasTurmas.forEach((t) => {
        if (t.val.schoolId) {
          const sId = t.val.schoolId;
          const sName = (t.val.schoolName || '').trim();
          if (!map[sId]) {
            map[sId] = {
              id: sId,
              name: sName || 'Escola sem Nome'
            };
          } else if (!map[sId].name || map[sId].name === 'Escola sem Nome') {
            if (sName) map[sId].name = sName;
          }
        }
      });
    } catch {
      // ignore
    }
  }

  const list = Object.values(map);
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

  // Atualiza estoque físico da escola (se tiver permissão de gestão de acervo)
  try {
    await update(acervoRef, {
      availableCopies: Math.max(0, currentAvail - copiesToMove),
      updatedAt: now
    });
  } catch {
    // Continua se não tiver permissão direta no acervo físico; o cálculo dinâmico cobre o saldo
  }

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

  // 3. Atualiza o acervo físico da escola se tiver permissão
  try {
    await set(acervoRef, cleanFirebaseData({
      totalCopies: schoolTotalCopies,
      availableCopies: newSchoolAvail,
      code: params.bookCode || holdings[params.schoolId]?.code || bookVal?.code || '',
      schoolName: params.schoolName || holdings[params.schoolId]?.schoolName || '',
      location: holdings[params.schoolId]?.location || bookVal?.location || '',
      updatedAt: now
    }));
  } catch {
    // Ignora se não for gestor de acervo; o cálculo dinâmico cobre o saldo
  }

  // 4. Atualiza catálogo geral de títulos na rede
  try {
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
  } catch {
    // Ignora se não tiver permissão no catálogo geral
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

/**
 * Autocorreção de consistência: alinha availableCopies no catálogo e nos acervos das escolas
 * caso haja qualquer discrepância em relação aos empréstimos reais em aberto.
 */
export async function reconciliarDisponibilidadeAcervo(
  divergences: Array<{
    bookId: string;
    correctNetworkAvail: number;
    schoolUpdates: Record<string, number>;
  }>
): Promise<void> {
  if (!divergences.length) return;
  const now = Date.now();

  for (const item of divergences) {
    try {
      // 1. Atualiza availableCopies no registro consolidado do livro
      const bookRef = ref(rtdb, `diario-classe/biblioteca/livros/${item.bookId}`);
      const bookSnap = await get(bookRef);
      if (bookSnap.exists()) {
        const bookData = bookSnap.val() as Book;
        const currentCopiesBySchool = bookData.copiesBySchool ? { ...bookData.copiesBySchool } : {};
        for (const [sId, newAvail] of Object.entries(item.schoolUpdates)) {
          if (currentCopiesBySchool[sId]) {
            currentCopiesBySchool[sId] = {
              ...currentCopiesBySchool[sId],
              availableCopies: newAvail
            };
          }
        }
        await update(bookRef, {
          availableCopies: item.correctNetworkAvail,
          copiesBySchool: currentCopiesBySchool,
          updatedAt: now
        });
      }

      // 2. Atualiza no estoque físico de cada escola envolvida
      for (const [sId, newAvail] of Object.entries(item.schoolUpdates)) {
        const acervoRef = ref(rtdb, `diario-classe/biblioteca/acervos/${sId}/${item.bookId}`);
        const acervoSnap = await get(acervoRef);
        if (acervoSnap.exists()) {
          await update(acervoRef, {
            availableCopies: newAvail,
            updatedAt: now
          });
        }
      }
    } catch (e) {
      console.warn(`[reconciliarDisponibilidadeAcervo] falha ao auto-ajustar livro ${item.bookId}:`, e);
    }
  }
}

// Normalização e comparação de RA/identidade ficam em ./identidadeAluno (lógica pura, testável).
export { normalizarRA, saoRAsIguais };

export interface HistoricalStudentLine {
  id: string;
  classId: string;
  className?: string;
  schoolName?: string;
  val: Student;
  sourceType: 'transferidoDe' | 'ra_match';
  /**
   * 'vinculo'   : ligada por `transferidoDe` explícito (confiável);
   * 'confere'   : achada pelo RA e o nome ou a data de nascimento batem;
   * 'divergente': achada pelo RA, mas nome E nascimento não batem (possível RA repetido/errado).
   * Linhas 'divergente' NÃO devem ter notas migradas automaticamente.
   */
  identidade: 'vinculo' | IdentidadeAluno;
}

/**
 * Localiza TODAS as linhas anteriores no histórico do aluno na escola/rede.
 * - Suporta a cadeia completa de transferências (seguindo `transferidoDe` recursivamente).
 * - Localiza também registros anteriores arquivados com status 'expedida' e mesmo RA normalizado.
 * - Evita ciclos e duplicatas através de Set de IDs visitados.
 * - Retorna ordenado cronologicamente da mais antiga para a mais recente.
 */
export async function buscarTodasLinhasAnterioresAluno(
  alunoAtual: Student,
  alunoAtualId?: string,
  turmaAtualId?: string,
  anoLetivo?: string,
  turmasCache?: Record<string, ClassRoom>
): Promise<HistoricalStudentLine[]> {
  if (!alunoAtual) return [];

  try {
    let turmasVal = turmasCache;
    if (!turmasVal) {
      const turmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
      if (!turmasSnap.exists()) return [];
      turmasVal = turmasSnap.val() || {};
    }

    const visitedIds = new Set<string>();
    if (alunoAtualId) {
      visitedIds.add(alunoAtualId);
    }

    const results: HistoricalStudentLine[] = [];

    const formatClassName = (c?: ClassRoom): string => {
      if (!c) return '';
      return (c as any).name || `${c.year}º ${c.letter}`;
    };

    const findStudentById = (targetId: string): { classId: string; student: Student; className?: string; schoolName?: string } | null => {
      if (turmaAtualId && turmasVal[turmaAtualId]?.alunos?.[targetId]) {
        const cls = turmasVal[turmaAtualId];
        return {
          classId: turmaAtualId,
          student: cls.alunos![targetId],
          className: formatClassName(cls),
          schoolName: cls.schoolName
        };
      }
      for (const tId of Object.keys(turmasVal)) {
        const cls = turmasVal[tId];
        if (cls?.alunos?.[targetId]) {
          return {
            classId: tId,
            student: cls.alunos[targetId],
            className: formatClassName(cls),
            schoolName: cls.schoolName
          };
        }
      }
      return null;
    };

    // 1. Segue a cadeia para trás via transferidoDe explícito
    let currTargetId = alunoAtual.transferidoDe;
    while (currTargetId && !visitedIds.has(currTargetId)) {
      visitedIds.add(currTargetId);
      const found = findStudentById(currTargetId);
      if (found) {
        results.push({
          id: currTargetId,
          classId: found.classId,
          className: found.className,
          schoolName: found.schoolName,
          val: found.student,
          sourceType: 'transferidoDe',
          identidade: 'vinculo'
        });
        currTargetId = found.student.transferidoDe;
      } else {
        break;
      }
    }

    // 2. Busca por RA normalizado em turmas da rede/escola (status 'expedida')
    const targetNormRA = normalizarRA(alunoAtual.ra);
    if (targetNormRA) {
      for (const tId of Object.keys(turmasVal)) {
        const cls = turmasVal[tId];
        const alunos = cls?.alunos || {};
        for (const sId of Object.keys(alunos)) {
          if (visitedIds.has(sId)) continue;
          const s = alunos[sId] as Student;
          if (
            s &&
            s.status === 'expedida' &&
            saoRAsIguais(s.ra, alunoAtual.ra) &&
            (!anoLetivo || !s.anoLetivo || String(s.anoLetivo) === String(anoLetivo))
          ) {
            visitedIds.add(sId);
            const identidadeLinhaRA = compararIdentidade(alunoAtual, s);
            results.push({
              id: sId,
              classId: tId,
              className: formatClassName(cls),
              schoolName: cls.schoolName,
              val: s,
              sourceType: 'ra_match',
              identidade: identidadeLinhaRA
            });

            // Se este registro também tiver uma cadeia de transferidoDe anterior, segue-a também
            let nestedCurr = s.transferidoDe;
            while (nestedCurr && !visitedIds.has(nestedCurr)) {
              visitedIds.add(nestedCurr);
              const nestedFound = findStudentById(nestedCurr);
              if (nestedFound) {
                results.push({
                  id: nestedCurr,
                  classId: nestedFound.classId,
                  className: nestedFound.className,
                  schoolName: nestedFound.schoolName,
                  val: nestedFound.student,
                  sourceType: 'transferidoDe',
                  identidade: identidadeLinhaRA === 'divergente' ? 'divergente' : 'vinculo'
                });
                nestedCurr = nestedFound.student.transferidoDe;
              } else {
                break;
              }
            }
          }
        }
      }
    }

    // 3. Ordena cronologicamente da linha mais antiga para a mais recente
    results.sort((a, b) => {
      const dateA = a.val.transferOutDate || a.val.transferDate || '';
      const dateB = b.val.transferOutDate || b.val.transferDate || '';
      if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
      return (Number(a.val.createdAt) || 0) - (Number(b.val.createdAt) || 0);
    });

    return results;
  } catch (err) {
    console.warn('[buscarTodasLinhasAnterioresAluno] Erro:', err);
    return [];
  }
}

/**
 * Mantém só as linhas em que é seguro migrar notas automaticamente:
 * as ligadas por `transferidoDe` e as achadas pelo RA cujo nome ou nascimento conferem.
 */
export function filtrarLinhasConfiaveis(linhas: HistoricalStudentLine[]): HistoricalStudentLine[] {
  return linhas.filter((l) => l.identidade !== 'divergente');
}

/**
 * Localiza a linha anterior mais recente de um aluno reingressado ou transferido.
 * Prioridade 1: Vínculo explícito em `transferidoDe`.
 * Prioridade 2: Busca por RA normalizado com status 'expedida'.
 * Suporta turmasCache opcional para evitar múltiplas leituras em lote.
 */
export async function buscarLinhaAnteriorAluno(
  alunoAtual: Student,
  alunoAtualId: string,
  turmaAtualId?: string,
  anoLetivo?: string,
  turmasCache?: Record<string, ClassRoom>
): Promise<{ id: string; classId: string; val: Student } | null> {
  const all = await buscarTodasLinhasAnterioresAluno(alunoAtual, alunoAtualId, turmaAtualId, anoLetivo, turmasCache);
  if (all.length === 0) return null;
  const last = all[all.length - 1];
  return { id: last.id, classId: last.classId, val: last.val };
}

/**
 * Transpõe as notas bimestrais de uma ou mais linhas anteriores para o cadastro de destino.
 * - Suporta múltiplas linhas históricas em cadeia (array de sourceStudentId ordenado cronologicamente).
 * - Suporta transferência entre turmas diferentes.
 * - Lê de todos os nós de professores quando admin.
 * - Resolução de conflitos cirúrgica com decidirGravacaoNotaOrigem.
 * - Preserva notas diretas lançadas no destino.
 * - Grava no nó do professor responsável sem duplicar no nó de administrador.
 */
export async function transporNotasParaReingresso(
  sourceStudentId: string | string[],
  newStudentId: string,
  classId: string,
  anoLetivo: string,
  /** Notas já carregadas pela tela (evita reler tudo a cada aluno). */
  notasPreCarregadas?: NotasAgregadas
): Promise<{ count: number; bimesters: string[]; subjects: string[]; parcial: boolean }> {
  const result = {
    count: 0,
    bimesters: [] as string[],
    subjects: [] as string[],
    parcial: true
  };
  const rawSourceIds = Array.isArray(sourceStudentId) ? sourceStudentId : [sourceStudentId];
  const sourceIds = rawSourceIds.filter(Boolean);

  if (sourceIds.length === 0 || !newStudentId || !classId) return result;

  try {
    const currentUid = getCurrentAuthUid();
    if (!currentUid) return result;

    const isAdmin = await verificarIsAdmin(currentUid);
    const bimestersSet = new Set<string>();
    const subjectsSet = new Set<string>();
    const updates: Record<string, any> = {};

    // 1. Notas visíveis: administrador = nós de todos os usuários (lidos um a um, sem baixar
    //    chamadas/eventos/planos); professor = só o próprio nó. A tela pode passar as já carregadas.
    const agreg = notasPreCarregadas || (await carregarNotasVisiveis(isAdmin));
    const parcialLeitura = agreg.parcial ?? !isAdmin;

    // 2. Separa as notas já existentes no destino e as das linhas de origem
    const existingDestGrades: Record<string, { value: number; isOrigem: boolean; teacher?: string; uId: string }> = {};
    const sourceIdsSet = new Set(sourceIds);
    const coletadas: NotaOrigemColetada[] = [];

    Object.keys(agreg.notas).forEach((k) => {
      const g = agreg.notas[k];
      if (!g) return;
      if (g.anoLetivo && String(g.anoLetivo) !== String(anoLetivo)) return;

      const bim = String(g.bimester);
      const sub = g.subject || 'portugues';
      const uId = agreg.vencedor[k] || currentUid;
      const isOrigem = !!g.isOrigem || g.origem === 'nota de origem';

      if (g.studentId === newStudentId) {
        const gradeKey = `${bim}_${sub}`;
        const atual = existingDestGrades[gradeKey];
        // Se houver duas, a nota lançada direto prevalece sobre a cópia de origem.
        if (!atual || (atual.isOrigem && !isOrigem)) {
          existingDestGrades[gradeKey] = { value: Number(g.value), isOrigem, teacher: g.teacher || '', uId };
        }
      } else if (sourceIdsSet.has(g.studentId)) {
        const valNum = parseFloat(g.value);
        if (!isNaN(valNum) && valNum >= 0 && valNum <= 10) {
          coletadas.push({
            bim,
            sub,
            valNum,
            teacher: g.teacher || '',
            ano: g.anoLetivo || anoLetivo,
            uId,
            isOrigem,
            sourceOrder: sourceIds.indexOf(g.studentId),
            criadoEm: Number(g.createdAt) || 0
          });
        }
      }
    });

    // Uma nota por disciplina/bimestre, independente da ordem de leitura
    const sourceGradesMap = consolidarNotasDeOrigem(coletadas);

    // 3. Aplica cada nota no cadastro de destino com regra estrita de desempate
    const now = Date.now();
    for (const item of sourceGradesMap) {
      const gradeKey = `${item.bim}_${item.sub}`;
      const destGrade = existingDestGrades[gradeKey];

      // Desempate e idempotência
      if (decidirGravacaoNotaOrigem(destGrade, item) === 'pular') {
        continue;
      }

      // Aplica a nota na linha nova
      const newKey = `${classId}_${item.bim}_${item.sub}_${newStudentId}`;
      const gradePayload = {
        classId,
        studentId: newStudentId,
        bimester: item.bim,
        subject: item.sub,
        value: item.valNum,
        teacher: item.teacher || '',
        anoLetivo: item.ano || anoLetivo,
        origem: 'nota de origem',
        isOrigem: true,
        createdAt: now
      };

      // Grava EXCLUSIVAMENTE no nó do professor responsável
      if (isAdmin && item.uId) {
        updates[`diario-classe/dados/${item.uId}/notas/${newKey}`] = gradePayload;
      } else {
        updates[dc(`notas/${newKey}`)] = gradePayload;
      }

      result.count++;
      bimestersSet.add(item.bim);
      subjectsSet.add(item.sub);
    }

    if (Object.keys(updates).length > 0) {
      await update(ref(rtdb), updates);
    }

    result.bimesters = Array.from(bimestersSet).sort();
    result.subjects = Array.from(subjectsSet);
    result.parcial = parcialLeitura;
  } catch (err) {
    console.warn('[transporNotasParaReingresso] Erro ao transpor notas:', err);
  }

  return result;
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
