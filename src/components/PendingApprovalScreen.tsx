import React, { useState } from 'react';
import { Clock, RefreshCw, LogOut, GraduationCap, ShieldAlert, AlertCircle } from 'lucide-react';

interface PendingApprovalScreenProps {
  userEmail?: string | null;
  teacherName?: string | null;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}

export const PendingApprovalScreen: React.FC<PendingApprovalScreenProps> = ({
  userEmail,
  teacherName,
  onRefresh,
  onLogout
}) => {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    setMessage(null);
    try {
      await onRefresh();
    } catch {
      setMessage('Ainda aguardando vinculação de turma pelo administrador.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100">
      <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
        
        {/* Header Icon */}
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
          <Clock className="w-8 h-8 animate-pulse" />
        </div>

        {/* Title & Badge */}
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <ShieldAlert className="w-3.5 h-3.5" />
            Conta Autenticada
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Aguardando Liberação
          </h2>
          <p className="text-sm text-slate-300">
            Sua conta está conectada com sucesso ao sistema.
          </p>
        </div>

        {/* User identification card */}
        <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/60 text-left space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Docente / Usuário:</span>
            <span className="font-semibold text-white truncate max-w-[200px]">
              {teacherName || 'Professor(a)'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">E-mail conectado:</span>
            <span className="font-mono text-indigo-300 truncate max-w-[200px]">
              {userEmail || '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Status atual:</span>
            <span className="font-semibold text-amber-400">Sem turmas atribuídas</span>
          </div>
        </div>

        {/* Explanatory banner */}
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl p-3 text-left flex gap-3 text-xs text-amber-200/90 leading-relaxed">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p>
            Por motivo de segurança pedagógica, os dados de alunos, notas e diários só ficam acessíveis após a equipe gestora atribuir uma ou mais turmas ao seu perfil na tela de <strong>Atribuições</strong>.
          </p>
        </div>

        {message && (
          <div className="p-2.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs border border-slate-600 animate-fade-in">
            {message}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3 pt-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Verificando...' : 'Verificar Liberação Agora'}</span>
          </button>

          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition-colors cursor-pointer border border-slate-600/60"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair / Entrar com outra conta</span>
          </button>
        </div>

        {/* School Footer */}
        <div className="pt-2 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <GraduationCap className="w-4 h-4 text-slate-500" />
          <span>Diário de Classe & Biblioteca Escolar</span>
        </div>
      </div>
    </div>
  );
};
