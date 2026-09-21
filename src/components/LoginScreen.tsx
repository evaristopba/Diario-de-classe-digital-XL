import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail, auth, rtdb } from '../lib/firebase';
import { ref, get } from 'firebase/database';
import { ModalConfig, Teacher } from '../types';
import { TurnstileWidget } from './TurnstileWidget';
import {
  GraduationCap,
  LogIn,
  Calendar,
  User,
  Mail,
  Lock,
  KeyRound,
  RefreshCw,
  Eye,
  EyeOff,
  Send,
  HelpCircle,
  ShieldCheck,
  ShieldAlert,
  Clock
} from 'lucide-react';

interface LoginScreenProps {
  currentYear: string;
  setCurrentYear: (year: string) => void;
  teacherName: string;
  setTeacherName: (name: string) => void;
  setModal: (config: ModalConfig) => void;
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 60;

export const LoginScreen: React.FC<LoginScreenProps> = ({
  currentYear,
  setCurrentYear,
  teacherName,
  setTeacherName,
  setModal
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [teachersList, setTeachersList] = useState<Array<{ id: string; val: Teacher }>>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');

  // Segurança: Proteção contra Força Bruta (Rate Limiting no Cliente)
  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem('dc_login_attempts');
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const [lockoutSeconds, setLockoutSeconds] = useState<number>(() => {
    try {
      const until = sessionStorage.getItem('dc_login_lockout_until');
      if (until) {
        const remaining = Math.ceil((parseInt(until, 10) - Date.now()) / 1000);
        return remaining > 0 ? remaining : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  });

  // Segurança: Cloudflare Turnstile anti-bot token
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  // Contador regressivo para o bloqueio de tentativas
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          try {
            sessionStorage.removeItem('dc_login_lockout_until');
            sessionStorage.removeItem('dc_login_attempts');
          } catch {
            // ignore
          }
          setFailedAttempts(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  // Modal / Fluxo de Recuperação de Senha
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [sendingForgot, setSendingForgot] = useState(false);

  const fetchTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const snap = await get(ref(rtdb, 'diario-classe/professores'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: Array<{ id: string; val: Teacher }> = [];
        Object.keys(val).forEach((k) => {
          if (val[k] && val[k].name) {
            list.push({ id: k, val: val[k] });
          }
        });
        list.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
        setTeachersList(list);
      } else {
        setTeachersList([]);
      }
    } catch (e) {
      console.log('Regra de leitura ou sem professores cadastrados:', e);
      setTeachersList([]);
    } finally {
      setLoadingTeachers(false);
    }
  };

  useEffect(() => {
    fetchTeachers();
  }, []);

  const handleTeacherSelect = (teacherId: string) => {
    setSelectedTeacherId(teacherId);
    if (!teacherId) {
      return;
    }
    const found = teachersList.find((t) => t.id === teacherId);
    if (found) {
      setTeacherName(found.val.name || '');
      if (found.val.email) {
        setEmail(found.val.email);
        setForgotEmail(found.val.email);
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockoutSeconds > 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Temporariamente Bloqueado',
        message: `Por motivo de segurança contra ataques de força bruta, aguarde ${lockoutSeconds} segundo(s) antes de tentar novamente.`,
        icon: '⏳'
      });
    }

    if (!email.trim() || !password) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha o e-mail e a senha de acesso!',
        icon: '⚠️'
      });
    }

    if (!currentYear || currentYear.length !== 4) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe um ano letivo válido (4 dígitos)!',
        icon: '⚠️'
      });
    }

    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);

      // Sucesso: limpa contadores de segurança
      try {
        sessionStorage.removeItem('dc_login_attempts');
        sessionStorage.removeItem('dc_login_lockout_until');
      } catch {
        // ignore
      }
      setFailedAttempts(0);
      setLockoutSeconds(0);
    } catch (err: any) {
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      try {
        sessionStorage.setItem('dc_login_attempts', String(nextFailed));
      } catch {
        // ignore
      }

      let isLocked = false;
      if (nextFailed >= MAX_LOGIN_ATTEMPTS) {
        isLocked = true;
        const lockUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
        try {
          sessionStorage.setItem('dc_login_lockout_until', String(lockUntil));
        } catch {
          // ignore
        }
        setLockoutSeconds(LOCKOUT_DURATION_SECONDS);
      }

      let msg = 'Erro ao realizar login: ' + err.message;
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/user-not-found'
      ) {
        msg = isLocked
          ? `⛔ Muitas tentativas incorretas (${nextFailed}/${MAX_LOGIN_ATTEMPTS}). Por segurança contra acessos automatizados, o login foi bloqueado por ${LOCKOUT_DURATION_SECONDS} segundos.`
          : `E-mail ou senha incorretos (${nextFailed}/${MAX_LOGIN_ATTEMPTS} tentativas). Caso tenha esquecido a senha, utilize a opção "Esqueci minha senha".`;
      }

      setModal({
        isOpen: true,
        type: 'alert',
        title: isLocked ? 'Proteção de Segurança Ativada' : 'Falha na Autenticação',
        message: msg,
        icon: isLocked ? '🛡️' : '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe o seu e-mail cadastrado!',
        icon: '⚠️'
      });
    }

    try {
      setSendingForgot(true);
      await sendPasswordResetEmail(auth, forgotEmail.trim());
      setIsForgotModalOpen(false);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'E-mail Enviado com Sucesso',
        message: `Um link seguro de redefinição de senha foi enviado para "${forgotEmail.trim()}". Verifique também sua caixa de spam/lixo eletrônico.`,
        icon: '📧'
      });
    } catch (err: any) {
      let msg = err.message;
      if (err.code === 'auth/user-not-found') {
        msg = 'Nenhum usuário encontrado com este e-mail no Firebase Auth. Entre em contato com a gestão escolar para cadastro.';
      }
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Recuperação',
        message: msg,
        icon: '❌'
      });
    } finally {
      setSendingForgot(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-indigo-100 animate-in fade-in zoom-in-95 duration-200">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-600/30 mb-3">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Diário de Classe Digital
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Gestão escolar completa, chamadas, notas e relatórios oficiais
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Dropdown de Seleção de Professor Cadastrado */}
          <div className="p-3.5 bg-indigo-50/70 rounded-2xl border border-indigo-100/80 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
              <label htmlFor="select-registered-teacher" className="flex items-center gap-1.5 cursor-pointer">
                <User className="w-3.5 h-3.5 text-indigo-600" />
                <span>Docente Cadastrado no Sistema</span>
              </label>
              <button
                type="button"
                onClick={fetchTeachers}
                title="Recarregar lista"
                className="text-[11px] font-normal text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${loadingTeachers ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>

            <div className="relative">
              <select
                id="select-registered-teacher"
                value={selectedTeacherId}
                onChange={(e) => handleTeacherSelect(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-indigo-200 text-indigo-950 font-semibold rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer shadow-2xs"
              >
                {teachersList.length === 0 ? (
                  <option value="">
                    {loadingTeachers ? 'Carregando lista de professores...' : 'Nenhum professor cadastrado (digite abaixo)'}
                  </option>
                ) : (
                  <>
                    <option value="">-- Selecione o Professor para preenchimento rápido --</option>
                    {teachersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        👨‍🏫 {t.val.name} {t.val.subject ? `(${t.val.subject})` : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <p className="text-[10px] text-indigo-600/80 leading-tight">
              {teachersList.length > 0
                ? 'Ao selecionar o professor, o e-mail e o nome são preenchidos automaticamente.'
                : 'Você também pode digitar o e-mail, senha e nome diretamente nos campos abaixo.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              E-mail de Acesso *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="login-email-input"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setForgotEmail(e.target.value);
                }}
                placeholder="seu.email@escola.gov.br"
                className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">
                Senha de Acesso *
              </label>
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email);
                  setIsForgotModalOpen(true);
                }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <KeyRound className="w-3 h-3" />
                <span>Esqueceu a senha?</span>
              </button>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="login-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha segura"
                className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nome para Exibição / Relatórios
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-3.5 h-3.5" />
                </div>
                <input
                  id="login-name-input"
                  type="text"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="Prof. João Silva"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Ano Letivo *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
                <input
                  id="login-year-input"
                  type="number"
                  min="2020"
                  max="2100"
                  value={currentYear}
                  onChange={(e) => setCurrentYear(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-indigo-700"
                  required
                />
              </div>
            </div>
          </div>

          {/* Verificação Anti-Bot (Cloudflare Turnstile com fallback seguro) */}
          <TurnstileWidget
            onVerify={(token) => setTurnstileToken(token)}
            onExpire={() => setTurnstileToken('')}
          />

          {/* Banner de Bloqueio por Força Bruta */}
          {lockoutSeconds > 0 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2.5 animate-pulse">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <span className="font-bold block">Proteção anti-bot ativa</span>
                <span className="text-[11px] text-rose-700">
                  Muitas tentativas consecutivas. Aguarde <strong>{lockoutSeconds}s</strong> para tentar novamente.
                </span>
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading || lockoutSeconds > 0}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              {loading ? (
                <span>Autenticando...</span>
              ) : lockoutSeconds > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 animate-spin" />
                  <span>Aguarde {lockoutSeconds}s...</span>
                </div>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Acessar Diário de Classe</span>
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Ambiente seguro integrado ao Firebase. Usuários cadastrados como Administrador têm acesso irrestrito à gestão de escolas, turmas e professores.
          </p>
        </div>
      </div>

      {/* Modal de Recuperação de Senha Oficial */}
      {isForgotModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-indigo-50 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-indigo-700">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Recuperar Senha de Acesso</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsForgotModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Informe seu e-mail institucional abaixo. O Firebase enviará um link seguro para você redefinir sua senha diretamente na sua caixa postal.
            </p>

            <form onSubmit={handleSendForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  E-mail Cadastrado *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="seu.email@escola.gov.br"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsForgotModalOpen(false)}
                  disabled={sendingForgot}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sendingForgot}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sendingForgot ? 'Enviando link...' : 'Enviar Link de Redefinição'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
