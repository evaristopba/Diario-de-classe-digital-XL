import React from 'react';
import { ScreenType } from '../types';
import { ArrowLeft, LogOut, User, Calendar, GraduationCap } from 'lucide-react';

interface NavbarProps {
  currentScreen: ScreenType;
  title?: string;
  teacherName: string;
  currentYear: string;
  onNavigate: (screen: ScreenType) => void;
  onLogout: () => void;
  extraActions?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentScreen,
  title,
  teacherName,
  currentYear,
  onNavigate,
  onLogout,
  extraActions
}) => {
  const isDashboard = currentScreen === 'dashboard';

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-indigo-100/60 shadow-xs sticky top-0 z-40 px-4 py-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
          {!isDashboard && (
            <button
              id="nav-back-btn"
              onClick={() => onNavigate('dashboard')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-100 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">
                {title || 'Diário de Classe Digital'}
              </h1>
              {!isDashboard && (
                <span className="text-xs text-indigo-600 font-medium">
                  {currentScreen === 'schools-screen' && 'Gerenciamento de Escolas'}
                  {currentScreen === 'classes-screen' && 'Gerenciamento de Turmas'}
                  {currentScreen === 'students-screen' && 'Cadastro de Alunos'}
                  {currentScreen === 'teachers-screen' && 'Corpo Docente e Professores'}
                  {currentScreen === 'assignments-screen' && 'Atribuição de Turmas aos Professores'}
                  {currentScreen === 'attendance-screen' && 'Chamada Diária'}
                  {currentScreen === 'lesson-plan-screen' && 'Registro de Planos de Aula'}
                  {currentScreen === 'events-screen' && 'Ocorrências & Eventos'}
                  {currentScreen === 'bncc-screen' && 'Habilidades BNCC'}
                  {currentScreen === 'grades-screen' && 'Lançamento de Notas'}
                  {currentScreen === 'subjects-screen' && 'Disciplinas & Matérias Curriculares'}
                  {currentScreen === 'reports-screen' && 'Relatórios em PDF & Excel'}
                  {currentScreen === 'categories-screen' && 'Categorias Pedagógicas'}
                  {currentScreen === 'event-types-screen' && 'Tipos de Ocorrência'}
                  {(currentScreen === 'library-screen' || currentScreen === 'library') && 'Biblioteca Escolar & Empréstimos'}
                  {(currentScreen === 'backup-screen' || currentScreen === 'backup') && 'Rotina de Backup & Restauração'}
                </span>
              )}
            </div>
          </div>
        </div>

        {extraActions && (
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
            {extraActions}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
            <User className="w-3.5 h-3.5 text-slate-500" />
            <span className="max-w-[140px] truncate">{teacherName}</span>
          </div>

          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-100/70 text-indigo-800 text-xs font-semibold border border-indigo-200">
            <Calendar className="w-3.5 h-3.5 text-indigo-600" />
            <span>Ano: {currentYear}</span>
          </div>

          <button
            id="nav-logout-btn"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors border border-red-200 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};
