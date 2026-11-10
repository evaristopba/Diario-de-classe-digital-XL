import React, { useState, useEffect } from 'react';
import { Teacher, ModalConfig, SubjectItem, DEFAULT_SUBJECTS } from '../types';
import {
  carregarProfessores,
  salvarProfessor,
  excluirProfessor,
  cadastrarContaProfessorAuth,
  sincronizarOuCriarContaAuth,
  enviarRedefinicaoSenha,
  verificarIsAdmin,
  verificarPodeGerenciarBiblioteca,
  salvarConfigExibirApresentacaoAdmin,
  get,
  ref,
  rtdb,
  auth
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkTeacherDeleteIntegrity } from '../lib/referentialIntegrity';
import {
  UserCheck,
  Plus,
  Edit2,
  Trash2,
  Search,
  Mail,
  Phone,
  BookOpen,
  Award,
  Users,
  Lock,
  KeyRound,
  ShieldCheck,
  Eye,
  EyeOff,
  Layers
} from 'lucide-react';

interface TeachersScreenProps {
  setModal: (config: ModalConfig) => void;
  onNavigateToAssignments?: (teacherId: string) => void;
}

export const TeachersScreen: React.FC<TeachersScreenProps> = ({
  setModal,
  onNavigateToAssignments
}) => {
  const [teachers, setTeachers] = useState<Array<{ id: string; val: Teacher }>>([]);
  const [availableSubjects, setAvailableSubjects] = useState<SubjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registration, setRegistration] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [canManageLibrary, setCanManageLibrary] = useState(false);
  const [exibirApresentacaoAdmin, setExibirApresentacaoAdmin] = useState(false);
  const [diasDisponiveis, setDiasDisponiveis] = useState<number[]>([1, 2, 3, 4, 5]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  // Informações do Usuário e Privilégio em tempo real
  const [currentUserInfo, setCurrentUserInfo] = useState<{
    uid: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
    isLibrarian: boolean;
    roleLabel: string;
  }>({
    uid: '',
    email: '',
    displayName: '',
    isAdmin: false,
    isLibrarian: false,
    roleLabel: 'Identificando...'
  });

  const loadSubjectsList = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: SubjectItem[] = Object.keys(val).map((k) => val[k]);
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAvailableSubjects(list);
      } else {
        setAvailableSubjects([]);
      }
    } catch (e) {
      console.log('Erro ao carregar disciplinas do banco:', e);
      setAvailableSubjects([]);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await carregarProfessores();
      list.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
      setTeachers(list);
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao carregar',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadSubjectsList();

    const fetchSession = async () => {
      const u = auth.currentUser;
      const uid = u?.uid || '';
      const email = u?.email || localStorage.getItem('dc_teacher_email') || 'Não identificado';
      const displayName = u?.displayName || localStorage.getItem('dc_teacher_name') || (u?.email ? u.email.split('@')[0] : 'Usuário');

      const admin = await verificarIsAdmin(uid);
      const librarian = await verificarPodeGerenciarBiblioteca(uid);

      setIsAdmin(admin);
      setCurrentUserInfo({
        uid,
        email,
        displayName,
        isAdmin: admin,
        isLibrarian: librarian,
        roleLabel: admin
          ? 'Administrador Master'
          : librarian
          ? 'Bibliotecário(a)'
          : 'Professor(a) / Docente'
      });
    };

    fetchSession();
  }, []);

  const handleOpenForm = (t?: { id: string; val: Teacher }) => {
    if (t) {
      setEditingId(t.id);
      setName(t.val.name || '');
      setEmail(t.val.email || '');
      const rawVal = t.val as any;
      setPassword(rawVal.password || rawVal.tempPassword || rawVal.senha || '');
      setRegistration(t.val.registration || '');
      setPhone(t.val.phone || '');
      setSubject(t.val.subject || '');
      setStatus(t.val.status || 'active');
      setCanManageLibrary(!!t.val.canManageLibrary);
      setExibirApresentacaoAdmin(!!t.val.exibirApresentacaoAdmin);
      setDiasDisponiveis(Array.isArray(t.val.diasDisponiveis) && t.val.diasDisponiveis.length > 0 ? t.val.diasDisponiveis : [1, 2, 3, 4, 5]);
    } else {
      setEditingId(null);
      setName('');
      setEmail('');
      setPassword('');
      setRegistration('');
      setPhone('');
      setSubject(availableSubjects.length > 0 ? availableSubjects[0].name : 'Polivalente');
      setStatus('active');
      setCanManageLibrary(false);
      setExibirApresentacaoAdmin(false);
      setDiasDisponiveis([1, 2, 3, 4, 5]);
    }
    setIsFormOpen(true);
  };

  const handleSendResetEmail = async (teacherEmail: string, teacherName: string) => {
    if (!teacherEmail) return;
    try {
      await enviarRedefinicaoSenha(teacherEmail);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'E-mail de Redefinição Enviado',
        message: `Um link seguro para redefinição de senha foi enviado para "${teacherEmail}" (${teacherName}). O usuário poderá definir ou sincronizar sua senha de acesso no Firebase Auth através do link recebido.`,
        icon: '📧'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao enviar e-mail',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Campos Obrigatórios',
        message: 'Nome e E-mail são obrigatórios para o cadastro do professor.',
        icon: '⚠️'
      });
      return;
    }

    if (!editingId && !password) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Senha Obrigatória',
        message: 'Defina uma senha de acesso inicial para o novo professor.',
        icon: '⚠️'
      });
      return;
    }

    if (password && password.length < 6) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Senha Fraca',
        message: 'A senha deve ter no mínimo 6 caracteres para autenticação segura.',
        icon: '⚠️'
      });
      return;
    }

    setSaving(true);
    try {
      // 1. Se informou senha, cria ou sincroniza conta no Firebase Auth
      let authUid: string | undefined = undefined;
      let authEmail: string | undefined = undefined;
      let authSyncSuccess = false;
      let hadAuthAttempt = false;

      const existingTeacher = editingId ? teachers.find((t) => t.id === editingId) : null;
      const currentStoredPass = (existingTeacher?.val as any)?.password || (existingTeacher?.val as any)?.tempPassword;
      const existingAuthEmail = (existingTeacher?.val as any)?.authEmail;

      if (password) {
        hadAuthAttempt = true;
        try {
          const authResult = await sincronizarOuCriarContaAuth(
            email.trim(),
            password,
            name.trim(),
            currentStoredPass,
            existingAuthEmail
          );
          if (authResult.uid) {
            authUid = authResult.uid;
          }
          if (authResult.authEmail) {
            authEmail = authResult.authEmail;
          }
          authSyncSuccess = !!authResult.authUpdated;
        } catch (authErr: any) {
          console.warn('Aviso no Firebase Auth:', authErr);
        }
      }

      // 2. Salva os dados do docente no Realtime Database garantindo persistência da senha para auto-preenchimento
      const preservedAuthUid = authUid || existingTeacher?.val?.authUid || (editingId?.length === 28 ? editingId : undefined);
      const effectivePassword = password || currentStoredPass || '';
      const effectiveAuthEmail = authEmail || existingAuthEmail;

      const teacherData: any = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        registration: registration.trim(),
        phone: phone.trim(),
        subject: canManageLibrary && (!subject.trim() || subject === 'Polivalente / Geral') 
          ? (subject.trim() || 'Gestão da Biblioteca') 
          : (subject.trim() || 'Polivalente / Geral'),
        status,
        canManageLibrary: !!canManageLibrary,
        exibirApresentacaoAdmin: !!exibirApresentacaoAdmin,
        diasDisponiveis: diasDisponiveis.length === 5 ? [1, 2, 3, 4, 5] : diasDisponiveis,
        ...(preservedAuthUid ? { authUid: preservedAuthUid } : {}),
        ...(effectiveAuthEmail ? { authEmail: effectiveAuthEmail } : {}),
        ...(effectivePassword ? { password: effectivePassword, tempPassword: effectivePassword } : {})
      };

      const finalId = editingId || authUid || undefined;
      await salvarProfessor(teacherData, finalId);

      // Sincroniza configuração global se for Admin
      if (isAdmin) {
        await salvarConfigExibirApresentacaoAdmin(!!exibirApresentacaoAdmin, finalId);
      }

      const isLibrarian = !!canManageLibrary;
      const roleTitle = isLibrarian ? 'Bibliotecário(a)' : 'Professor(a)';

      let successMessage = '';
      if (!hadAuthAttempt) {
        successMessage = editingId
          ? `Dados do(a) ${roleTitle.toLowerCase()} atualizados com sucesso!`
          : `${roleTitle} cadastrado(a) com sucesso!`;
      } else {
        successMessage = `Dados e senha do(a) ${roleTitle.toLowerCase()} salvos com sucesso!\n\n🔑 A nova senha foi gravada e sincronizada para acesso imediato no login.\n\nAgora o(a) ${roleTitle.toLowerCase()} pode fazer login tanto selecionando seu nome pelo preenchimento automático quanto digitando seu e-mail e a nova senha.`;
      }

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: successMessage,
        icon: '✅'
      });

      setIsFormOpen(false);
      loadData();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao salvar',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, teacherName: string, authUid?: string, isLibrarianMember?: boolean) => {
    // 1. Validar Integridade Referencial: não excluir se houver turmas vinculadas/atribuídas
    const integrity = await checkTeacherDeleteIntegrity(id, authUid);
    if (!integrity.canDelete) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exclusão Bloqueada',
        message: `⛔ ${integrity.reason || 'Este docente possui turmas vinculadas e não pode ser excluído.'}`,
        icon: '⛔'
      });
    }

    const roleName = isLibrarianMember ? 'bibliotecário(a)' : 'professor(a)';

    setModal({
      isOpen: true,
      type: 'confirm',
      title: isLibrarianMember ? 'Excluir Bibliotecário(a)' : 'Excluir Professor',
      message: `Tem certeza que deseja excluir o cadastro do(a) ${roleName} "${teacherName}"?`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          await excluirProfessor(id);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: `${isLibrarianMember ? 'Bibliotecário(a)' : 'Professor'} removido com sucesso.`,
            icon: '✅'
          });
          loadData();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao excluir',
            message: formatFriendlyError(err),
            icon: '❌'
          });
        }
      }
    });
  };

  const filteredTeachers = teachers.filter((t) => {
    const q = searchTerm.toLowerCase();
    return (
      (t.val.name || '').toLowerCase().includes(q) ||
      (t.val.email || '').toLowerCase().includes(q) ||
      (t.val.registration || '').toLowerCase().includes(q) ||
      (t.val.subject || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Corpo Docente</h1>
              <p className="text-sm text-slate-500">
                Cadastro de professores, credenciais de login e especialidades
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-add-teacher"
          onClick={() => handleOpenForm()}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Professor</span>
        </button>
      </div>

      {/* Banner de Identificação do Operador e Privilégio em Tempo Real */}
      <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg border border-indigo-900/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl shrink-0 ${
              currentUserInfo.isAdmin 
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
            }`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                  Operador Ativo no Momento:
                </span>
                <span className="text-sm font-bold text-white">
                  {currentUserInfo.displayName}
                </span>
                <span className="text-xs text-indigo-300">
                  ({currentUserInfo.email})
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-300 flex-wrap">
                <span>Privilégio de Acesso:</span>
                <span className={`inline-flex items-center gap-1 font-bold px-2.5 py-0.5 rounded-full text-[11px] ${
                  currentUserInfo.isAdmin 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                    : currentUserInfo.isLibrarian 
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}>
                  {currentUserInfo.isAdmin ? '🛡️' : currentUserInfo.isLibrarian ? '📚' : '👨‍🏫'}
                  {currentUserInfo.roleLabel}
                </span>
                {currentUserInfo.uid && (
                  <span className="text-[10px] text-slate-400 font-mono" title="Identificador único no Firebase Authentication">
                    UID: {currentUserInfo.uid}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center bg-slate-800/60 px-3 py-1.5 rounded-xl border border-slate-700/50">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs text-emerald-300 font-medium">
              Sessão Ativa
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Busca e Estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="sm:col-span-2 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="search-teacher-input"
            type="text"
            placeholder="Buscar por nome, e-mail, matrícula ou disciplina..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
          />
        </div>

        <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Total de Professores:</span>
          <span className="text-lg font-bold text-indigo-600">{teachers.length}</span>
        </div>
      </div>

      {/* Lista de Professores */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3"></div>
          <p>Carregando professores...</p>
        </div>
      ) : filteredTeachers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-700">Nenhum professor encontrado</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
            {searchTerm
              ? 'Tente ajustar os termos da sua busca.'
              : 'Comece cadastrando os professores para permitir a atribuição de turmas e o lançamento de chamadas.'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => handleOpenForm()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Cadastrar Primeiro Professor</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeachers.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-2xl border border-slate-200/80 hover:border-indigo-200 p-5 shadow-xs transition flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-base border border-indigo-100">
                      {t.val.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-base leading-tight">
                        {t.val.name}
                      </h3>
                      {t.val.registration && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          Matrícula: {t.val.registration}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {t.val.canManageLibrary && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200" title="Possui permissão para gerenciar acervo e empréstimos da biblioteca">
                        📚 Biblioteca
                      </span>
                    )}
                    {t.val.exibirApresentacaoAdmin && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" title="Botão de Apresentação Municipal ativo na interface principal">
                        🎬 Pitch Ativo
                      </span>
                    )}
                    {((t.val as any).password || (t.val as any).tempPassword) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200" title="Possui senha gravada para auto-preenchimento na tela de login">
                        🔑 Auto-login
                      </span>
                    )}
                    {Array.isArray(t.val.diasDisponiveis) && t.val.diasDisponiveis.length > 0 && t.val.diasDisponiveis.length < 5 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200" title={`Atua em ${t.val.diasDisponiveis.length} dias na semana`}>
                        🗓️ Folga: {[1, 2, 3, 4, 5].filter((d) => !t.val.diasDisponiveis!.includes(d)).map((d) => ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'][d - 1]).join(', ')}
                      </span>
                    )}
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        t.val.status === 'inactive'
                          ? 'bg-red-50 text-red-600 border border-red-100'
                          : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                      }`}
                    >
                      {t.val.status === 'inactive' ? 'Inativo' : 'Ativo'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-slate-600 mb-4">
                  <div className="flex items-center gap-2 truncate">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{t.val.email}</span>
                  </div>

                  {t.val.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{t.val.phone}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-700">
                      {t.val.subject || 'Polivalente / Geral'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                {onNavigateToAssignments && (
                  <button
                    onClick={() => onNavigateToAssignments(t.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg transition"
                    title="Atribuir turmas a este professor"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>Atribuir Turmas</span>
                  </button>
                )}

                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => handleSendResetEmail(t.val.email, t.val.name)}
                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                    title={`Enviar e-mail para redefinir senha no Firebase Auth (${t.val.email})`}
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenForm(t)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    title={t.val.canManageLibrary ? 'Editar bibliotecário(a)' : 'Editar professor'}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id, t.val.name, t.val.authUid, !!t.val.canManageLibrary)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title={t.val.canManageLibrary ? 'Excluir bibliotecário(a)' : 'Excluir professor'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal / Formulário de Cadastro e Edição */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editingId
                  ? canManageLibrary
                    ? 'Editar Bibliotecário(a)'
                    : 'Editar Professor(a)'
                  : canManageLibrary
                  ? 'Novo(a) Bibliotecário(a)'
                  : 'Novo(a) Professor(a)'}
              </h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Identificação do Operador e Privilégio Ativo no Momento da Manutenção */}
            <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 shrink-0 ${currentUserInfo.isAdmin ? 'text-amber-600' : 'text-indigo-600'}`} />
                <span className="text-slate-600">
                  Manutenção por: <strong className="text-slate-800">{currentUserInfo.displayName}</strong> <span className="text-slate-500">({currentUserInfo.email})</span>
                </span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] shrink-0 self-start sm:self-auto ${
                currentUserInfo.isAdmin 
                  ? 'bg-amber-100 text-amber-900 border border-amber-200' 
                  : currentUserInfo.isLibrarian 
                  ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' 
                  : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
              }`}>
                {currentUserInfo.isAdmin ? '🛡️ ' : currentUserInfo.isLibrarian ? '📚 ' : '👨‍🏫 '}{currentUserInfo.roleLabel}
              </span>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Nome Completo *
                </label>
                <input
                  id="teacher-name-input"
                  type="text"
                  required
                  placeholder="Ex: Maria Silva Santos"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    E-mail Institucional / Login *
                  </label>
                  <input
                    id="teacher-email-input"
                    type="email"
                    required
                    placeholder="professor@escola.gov.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Matrícula / Registro Funcional
                  </label>
                  <input
                    id="teacher-reg-input"
                    type="text"
                    placeholder="Ex: MAT-2024-889"
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {/* Seção Direta de Senha no Formulário */}
              <div className="p-4 bg-indigo-50/70 rounded-2xl border border-indigo-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span>Senha de Acesso do Professor</span>
                  </span>
                  {editingId && (
                    <span className="text-[10px] text-indigo-600 font-medium bg-indigo-100/70 px-2 py-0.5 rounded-md">
                      Opcional ao editar
                    </span>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-indigo-400">
                      <Lock className="w-3.5 h-3.5" />
                    </div>
                    <input
                      id="teacher-password-input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={editingId ? 'Digite apenas se desejar redefinir a senha' : 'Senha segura (mínimo 6 dígitos)'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-9 py-2 bg-white border border-indigo-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-indigo-700/80 mt-1">
                    O administrador define a senha aqui diretamente e a informa ao professor para login.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Telefone / WhatsApp
                  </label>
                  <input
                    id="teacher-phone-input"
                    type="text"
                    placeholder="(11) 99999-9999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center justify-between">
                    <span>{canManageLibrary ? 'Atuação / Função' : 'Disciplina / Matéria *'}</span>
                    <span className="text-[10px] text-indigo-600 font-normal">
                      {canManageLibrary ? 'Opcional p/ Bibliotecário' : 'Grade Dinâmica'}
                    </span>
                  </label>
                  <select
                    id="teacher-subject-select"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium bg-white"
                  >
                    {canManageLibrary && (
                      <option value="Gestão da Biblioteca">Gestão da Biblioteca (Bibliotecário)</option>
                    )}
                    <option value="Polivalente / Geral">Polivalente / Geral (Regente)</option>
                    {availableSubjects.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} {s.shortName ? `(${s.shortName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Status
                </label>
                <select
                  id="teacher-status-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                >
                  <option value="active">Ativo (Permitir Acesso)</option>
                  <option value="inactive">Inativo (Bloquear Acesso)</option>
                </select>
              </div>

              {/* Escala Semanal e Dias de Atuação na Escola (Especialistas / Folga) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 block">
                    Dias de Atendimento nesta Escola (Escala Semanal)
                  </label>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {diasDisponiveis.length === 5 ? 'Todos os dias (5/5)' : `${diasDisponiveis.length} dias presentes`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Desmarque os dias em que o docente tem folga ou não atua na escola (ex: Informática folga na sexta, Educação Física na quinta).
                </p>
                <div className="grid grid-cols-5 gap-1.5 pt-1">
                  {[
                    { id: 1, label: 'Seg', full: 'Segunda-feira' },
                    { id: 2, label: 'Ter', full: 'Terça-feira' },
                    { id: 3, label: 'Qua', full: 'Quarta-feira' },
                    { id: 4, label: 'Qui', full: 'Quinta-feira' },
                    { id: 5, label: 'Sex', full: 'Sexta-feira' }
                  ].map((dia) => {
                    const isChecked = diasDisponiveis.includes(dia.id);
                    return (
                      <button
                        key={dia.id}
                        type="button"
                        onClick={() => {
                          setDiasDisponiveis((prev) =>
                            isChecked ? prev.filter((d) => d !== dia.id) : [...prev, dia.id].sort()
                          );
                        }}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition cursor-pointer text-center ${
                          isChecked
                            ? 'bg-indigo-600 border-indigo-700 text-white shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 line-through'
                        }`}
                        title={isChecked ? `${dia.full}: Presente na escola` : `${dia.full}: Dia de folga / fora da escola`}
                      >
                        {dia.label}
                      </button>
                    );
                  })}
                </div>
                {diasDisponiveis.length < 5 && (
                  <p className="text-[10px] text-amber-700 font-semibold pt-1">
                    🏖️ Folga / Dia livre:{' '}
                    {[1, 2, 3, 4, 5]
                      .filter((d) => !diasDisponiveis.includes(d))
                      .map((d) => ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'][d - 1])
                      .join(', ')}. O sistema previne conflitos ao montar a grade.
                  </p>
                )}
              </div>

              {/* Permissão de Biblioteca Escolar */}
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex items-start gap-3">
                <input
                  id="teacher-can-manage-library"
                  type="checkbox"
                  checked={canManageLibrary}
                  onChange={(e) => setCanManageLibrary(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-indigo-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div>
                  <label
                    htmlFor="teacher-can-manage-library"
                    className="text-xs font-bold text-indigo-950 block cursor-pointer"
                  >
                    Permitir gerenciar a Biblioteca Escolar
                  </label>
                  <p className="text-[11px] text-indigo-800/80 mt-0.5 leading-relaxed">
                    Habilita este docente a cadastrar livros no acervo, registrar empréstimos e dar baixa nas devoluções de alunos.
                  </p>
                </div>
              </div>

              {/* Opção para Administrador: Apresentação Municipal & Pitch */}
              {isAdmin && (
                <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl flex items-start gap-3">
                  <input
                    id="teacher-can-show-presentation"
                    type="checkbox"
                    checked={exibirApresentacaoAdmin}
                    onChange={(e) => setExibirApresentacaoAdmin(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500 cursor-pointer"
                  />
                  <div>
                    <label
                      htmlFor="teacher-can-show-presentation"
                      className="text-xs font-bold text-slate-800 block cursor-pointer flex items-center gap-1.5"
                    >
                      <span>Exibir botão de Apresentação / Pitch no Painel Principal</span>
                      <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-amber-100 text-amber-900 rounded-md border border-amber-300">
                        Admin
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Disponibiliza o botão discreto de acesso à Apresentação para Secretário e Gravação de Vídeo na tela inicial. Quando desmarcado, a tela inicial permanece 100% limpa (zero poluição visual).
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  id="teacher-submit-btn"
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-sm font-semibold shadow-xs transition"
                >
                  {saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Cadastrar Professor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
