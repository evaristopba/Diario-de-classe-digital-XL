import React, { useState, useEffect, useRef } from 'react';
import { ModalConfig, ScreenType } from '../types';
import {
  generateFullBackup,
  validateBackupFile,
  restoreBackup,
  getBackupRoutineStatus,
  setBackupReminderFrequency,
  getBackupHistory,
  clearBackupHistory,
  BackupPackage,
  BackupHistoryItem,
  RestoreOptions
} from '../lib/backupService';
import { formatFriendlyError } from '../lib/errorHandler';
import { verificarIsAdmin } from '../lib/firebase';
import {
  ShieldCheck,
  Download,
  Upload,
  Clock,
  History,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Database,
  Building2,
  Users,
  GraduationCap,
  UserCheck,
  CheckSquare,
  Award,
  BookOpen,
  Layers,
  Bookmark,
  BookMarked,
  Tag,
  RefreshCw,
  FileJson,
  Calendar,
  Sparkles,
  Info,
  Trash2
} from 'lucide-react';

interface BackupScreenProps {
  setModal: (config: ModalConfig) => void;
  onNavigate?: (screen: ScreenType) => void;
}

type TabType = 'export' | 'import' | 'history_settings';

export const BackupScreen: React.FC<BackupScreenProps> = ({ setModal, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<TabType>('export');
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Status da rotina
  const [routineStatus, setRoutineStatus] = useState(getBackupRoutineStatus());
  const [historyList, setHistoryList] = useState<BackupHistoryItem[]>(getBackupHistory());
  const [reminderDays, setReminderDays] = useState<number>(routineStatus.reminderFrequencyDays);

  useEffect(() => {
    verificarIsAdmin().then((admin) => {
      setIsAdmin(admin);
      if (!admin && activeTab === 'import') {
        setActiveTab('export');
      }
    });
  }, [activeTab]);

  // Estados de exportação
  const [isExporting, setIsExporting] = useState(false);
  const [exportStats, setExportStats] = useState<{
    schools: number;
    classes: number;
    students: number;
    teachers: number;
    assignments: number;
    attendances: number;
    grades: number;
    lessonPlans: number;
    events: number;
    subjects: number;
    bncc: number;
    categories: number;
    eventTypes: number;
    total: number;
  } | null>(null);

  // Estados de importação / restauração
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupPackage | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{ msg: string; percent: number }>({
    msg: '',
    percent: 0
  });
  const [restoreOptions, setRestoreOptions] = useState<RestoreOptions>({
    includeSchools: true,
    includeClassesAndStudents: true,
    includeTeachers: true,
    includeAssignments: true,
    includeSubjects: true,
    includeBNCC: true,
    includeCategories: true,
    includeEventTypes: true,
    includeAttendance: true,
    includeGrades: true,
    includeLessonPlans: true,
    includeEvents: true,
    mode: 'merge'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStatus = () => {
    setRoutineStatus(getBackupRoutineStatus());
    setHistoryList(getBackupHistory());
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  // Handler para geração do backup
  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const result = await generateFullBackup();
      
      // Cria link para download
      const url = window.URL.createObjectURL(result.jsonBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      refreshStatus();

      setExportStats({
        schools: result.backupPkg.metadata.recordCounts.schools,
        classes: result.backupPkg.metadata.recordCounts.classes,
        students: result.backupPkg.metadata.recordCounts.students,
        teachers: result.backupPkg.metadata.recordCounts.teachers,
        assignments: result.backupPkg.metadata.recordCounts.assignments,
        attendances: result.backupPkg.metadata.recordCounts.attendances,
        grades: result.backupPkg.metadata.recordCounts.grades,
        lessonPlans: result.backupPkg.metadata.recordCounts.lessonPlans,
        events: result.backupPkg.metadata.recordCounts.events,
        subjects: result.backupPkg.metadata.recordCounts.subjects,
        bncc: result.backupPkg.metadata.recordCounts.bncc,
        categories: result.backupPkg.metadata.recordCounts.categories,
        eventTypes: result.backupPkg.metadata.recordCounts.eventTypes,
        total: result.backupPkg.metadata.recordCounts.totalRecords
      });

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Backup Gerado com Sucesso!',
        message: `O arquivo "${result.filename}" com ${result.backupPkg.metadata.recordCounts.totalRecords} registros foi baixado com sucesso. Guarde este arquivo em local seguro (ex: Google Drive, OneDrive ou Pendrive).`,
        icon: '🛡️'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar Backup',
        message: formatFriendlyError(err, 'Não foi possível extrair os dados do banco de dados.'),
        icon: '❌'
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Handler para processar arquivo de backup carregado
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setImportError('Por favor, selecione um arquivo no formato JSON (.json).');
      setParsedBackup(null);
      setImportFile(null);
      return;
    }

    setImportFile(file);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const validation = validateBackupFile(content);
      if (validation.isValid && validation.backup) {
        setParsedBackup(validation.backup);
        setImportError(null);
      } else {
        setImportError(validation.error || 'Arquivo de backup inválido.');
        setParsedBackup(null);
      }
    };
    reader.onerror = () => {
      setImportError('Falha ao ler o arquivo selecionado.');
      setParsedBackup(null);
    };
    reader.readAsText(file);
  };

  // Handler para executar a restauração com confirmação dupla
  const handleConfirmRestore = () => {
    if (!parsedBackup) return;

    const totalToImport = parsedBackup.metadata.recordCounts.totalRecords;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Restauração de Dados',
      message: `Você está prestes a restaurar os dados do arquivo "${importFile?.name}". O modo selecionado é "${restoreOptions.mode === 'merge' ? 'Mesclar e Atualizar (Recomendado)' : 'Substituição Controlada'}". Deseja prosseguir com a restauração de ${totalToImport} registros?`,
      icon: '⚠️',
      confirmText: 'Sim, Restaurar Agora',
      cancelText: 'Cancelar',
      onConfirm: () => executeRestore()
    });
  };

  const executeRestore = async () => {
    if (!parsedBackup) return;

    const admin = await verificarIsAdmin();
    if (!admin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para restaurar backups ou importar dados no sistema.',
        icon: '⛔'
      });
    }

    setIsRestoring(true);
    setRestoreProgress({ msg: 'Iniciando restauração...', percent: 5 });

    try {
      const result = await restoreBackup(
        parsedBackup,
        restoreOptions,
        (msg, percent) => {
          setRestoreProgress({ msg, percent });
        }
      );

      refreshStatus();

      if (result.success) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Restauração Concluída!',
          message: `Dados restaurados com sucesso! ${Object.values(result.importedCounts).reduce((a, b) => a + b, 0)} registros foram gravados e sincronizados no banco de dados.`,
          icon: '✅'
        });
        setParsedBackup(null);
        setImportFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Restauração Finalizada com Avisos',
          message: `A restauração foi processada com alguns avisos: ${result.errors.join('; ')}`,
          icon: '⚠️'
        });
      }
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro Crítico na Restauração',
        message: formatFriendlyError(err, 'Falha ao gravar os dados no banco de dados.'),
        icon: '❌'
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleSaveReminderFrequency = (days: number) => {
    setReminderDays(days);
    setBackupReminderFrequency(days);
    refreshStatus();
  };

  const handleClearHistory = () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Limpar Histórico Local de Backups',
      message: 'Deseja limpar o histórico local de registros de backup deste navegador? Seus dados salvos no banco não serão afetados.',
      icon: '🗑️',
      confirmText: 'Limpar Histórico',
      cancelText: 'Cancelar',
      onConfirm: () => {
        clearBackupHistory();
        refreshStatus();
      }
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 1. Cabeçalho Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-2xl border border-indigo-100 shadow-xs">
        <div className="flex items-start sm:items-center gap-4">
          <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-md">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight">
                Rotina de Backup & Restauração
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                Segurança dos Dados
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Gere cópias de segurança integrais de todas as escolas, turmas, alunos, notas e chamadas em formato JSON.
            </p>
          </div>
        </div>

        {/* Botão de Ação Rápida */}
        <button
          id="btn-quick-full-backup"
          onClick={handleExportBackup}
          disabled={isExporting}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all transform active:scale-95 cursor-pointer shrink-0"
        >
          {isExporting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Gerando Cópia...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Fazer Backup Agora (.JSON)</span>
            </>
          )}
        </button>
      </div>

      {/* 2. Card de Status da Rotina Automática */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border transition-all ${
          routineStatus.statusColor === 'emerald'
            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            : routineStatus.statusColor === 'amber'
            ? 'bg-amber-50/80 border-amber-200 text-amber-950'
            : 'bg-red-50/80 border-red-200 text-red-950'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {routineStatus.statusColor === 'emerald' ? (
              <div className="p-2 bg-emerald-600 text-white rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            ) : routineStatus.statusColor === 'amber' ? (
              <div className="p-2 bg-amber-600 text-white rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-2 bg-red-600 text-white rounded-lg">
                <AlertCircle className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
                <span>Status da Rotina:</span>
                <span>{routineStatus.statusText}</span>
              </div>
              <div className="text-xs opacity-90 mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <strong>Último Backup:</strong> {routineStatus.lastBackupDateStr}
                </span>
                <span>
                  <strong>Frequência Recomendada:</strong> A cada {routineStatus.reminderFrequencyDays} dias
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              onClick={refreshStatus}
              className="p-2 rounded-lg bg-white/80 hover:bg-white text-slate-700 text-xs font-semibold border border-slate-200/80 transition-colors cursor-pointer"
              title="Atualizar status"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Navegação por Abas */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1">
        <button
          id="tab-export-backup"
          onClick={() => setActiveTab('export')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'export'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Fazer Backup (Exportar Dados)</span>
        </button>

        {isAdmin && (
          <button
            id="tab-import-backup"
            onClick={() => setActiveTab('import')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'import'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Restaurar Backup (Importar Arquivo)</span>
          </button>
        )}

        <button
          id="tab-history-settings"
          onClick={() => setActiveTab('history_settings')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'history_settings'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Histórico & Configuração da Rotina</span>
        </button>
      </div>

      {/* 4. CONTEÚDO DAS ABAS */}

      {/* ABA 1: EXPORTAR BACKUP */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">
                  Exportação Integral do Banco de Dados
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  O arquivo JSON gerado contém toda a estrutura e registros do Diário de Classe em formato universal.
                </p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-200">
                <Sparkles className="w-3.5 h-3.5" />
                Compatibilidade 100%
              </span>
            </div>

            {/* Módulos incluídos no Backup */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Módulos e Dados Contemplados na Cópia de Segurança
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Escolas</div>
                    <div className="text-[11px] text-slate-500">Unidades e endereços</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Turmas</div>
                    <div className="text-[11px] text-slate-500">Séries, turnos e letras</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-orange-100 text-orange-700 rounded-lg">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Alunos</div>
                    <div className="text-[11px] text-slate-500">RA, nº de chamada, datas</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Professores</div>
                    <div className="text-[11px] text-slate-500">Docentes e Atribuições</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                    <CheckSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Chamadas & Frequência</div>
                    <div className="text-[11px] text-slate-500">Presenças e faltas diárias</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-purple-100 text-purple-700 rounded-lg">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Avaliações & Notas</div>
                    <div className="text-[11px] text-slate-500">Notas bimestrais por matéria</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-teal-100 text-teal-700 rounded-lg">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Planos de Aula</div>
                    <div className="text-[11px] text-slate-500">Planejamentos e execuções</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Ocorrências</div>
                    <div className="text-[11px] text-slate-500">Eventos disciplinares</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-fuchsia-100 text-fuchsia-700 rounded-lg">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Disciplinas</div>
                    <div className="text-[11px] text-slate-500">Grade curricular cadastrada</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-sky-100 text-sky-700 rounded-lg">
                    <Bookmark className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Habilidades BNCC</div>
                    <div className="text-[11px] text-slate-500">Matriz de códigos BNCC</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-cyan-100 text-cyan-700 rounded-lg">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Categorias & Tipos</div>
                    <div className="text-[11px] text-slate-500">Classificações pedagógicas</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-teal-100 text-teal-700 rounded-lg">
                    <BookMarked className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Biblioteca Escolar</div>
                    <div className="text-[11px] text-slate-500">Livros, acervo e empréstimos</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                  <div className="p-2 bg-slate-200 text-slate-800 rounded-lg">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Metadados & Índices</div>
                    <div className="text-[11px] text-slate-500">Assinatura e integridade</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ação de Download */}
            <div className="p-5 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-slate-50 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center sm:text-left">
                <div className="text-sm font-bold text-slate-800">
                  Pronto para gerar a cópia de segurança?
                </div>
                <div className="text-xs text-slate-500">
                  O download iniciará imediatamente no seu navegador em arquivo com extensão <code className="text-indigo-600 font-semibold">.json</code>.
                </div>
              </div>

              <button
                id="btn-export-full-backup-cta"
                onClick={handleExportBackup}
                disabled={isExporting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition transform active:scale-95 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Banco de Dados...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Baixar Backup Completo (.JSON)</span>
                  </>
                )}
              </button>
            </div>

            {/* Resumo do Último Export Realizado na Sessão */}
            {exportStats && (
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-950 space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Resumo do Backup Gerado com Sucesso:</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Escolas:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.schools}</strong>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Turmas:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.classes}</strong>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Alunos:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.students}</strong>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Professores:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.teachers}</strong>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Chamadas:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.attendances}</strong>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                    <span className="text-slate-500 block">Notas:</span>
                    <strong className="text-slate-800 text-sm">{exportStats.grades}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: RESTAURAR BACKUP (IMPORTAR) */}
      {activeTab === 'import' && isAdmin && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">
                  Restauração de Dados & Importação de Cópia
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Carregue um arquivo de backup (.JSON) gerado anteriormente para restaurar os registros no sistema.
                </p>
              </div>
            </div>

            {/* Caixa de Upload Drag and Drop */}
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                importFile
                  ? 'border-indigo-400 bg-indigo-50/40'
                  : 'border-slate-300 hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="p-4 bg-indigo-100 text-indigo-600 rounded-full shadow-inner">
                  <FileJson className="w-8 h-8" />
                </div>

                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {importFile ? importFile.name : 'Clique para selecionar o arquivo de backup (.JSON)'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {importFile
                      ? `Tamanho: ${(importFile.size / 1024).toFixed(1)} KB`
                      : 'ou arraste e solte o arquivo aqui'}
                  </p>
                </div>

                {importFile && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Arquivo carregado com sucesso
                  </span>
                )}
              </div>
            </div>

            {/* Erro de validação */}
            {importError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs sm:text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <div>
                  <strong className="block font-bold">Erro ao validar arquivo de backup:</strong>
                  <span>{importError}</span>
                </div>
              </div>
            )}

            {/* Visualização Prévia dos Dados Encontrados no Arquivo */}
            {parsedBackup && (
              <div className="space-y-5 border-t border-slate-100 pt-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>Conteúdo Identificado no Arquivo:</span>
                  </h4>
                  <div className="text-xs text-slate-500">
                    Exportado em: <strong>{new Date(parsedBackup.metadata.timestamp).toLocaleString('pt-BR')}</strong>
                    {parsedBackup.metadata.exportedByName && ` por ${parsedBackup.metadata.exportedByName}`}
                  </div>
                </div>

                {/* Resumo em Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Escolas:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.schools}
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Turmas:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.classes}
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Alunos:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.students}
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Professores:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.teachers}
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Chamadas:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.attendances}
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Notas:</span>
                    <strong className="text-base text-slate-800">
                      {parsedBackup.metadata.recordCounts.grades}
                    </strong>
                  </div>
                </div>

                {/* Opções de Seleção de Módulos para Restaurar */}
                <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Selecione o que deseja restaurar:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRestoreOptions((prev) => ({
                            ...prev,
                            includeSchools: true,
                            includeClassesAndStudents: true,
                            includeTeachers: true,
                            includeAssignments: true,
                            includeSubjects: true,
                            includeBNCC: true,
                            includeCategories: true,
                            includeEventTypes: true,
                            includeAttendance: true,
                            includeGrades: true,
                            includeLessonPlans: true,
                            includeEvents: true,
                            includeLibrary: true
                          }))
                        }
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        Marcar Tudo
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() =>
                          setRestoreOptions((prev) => ({
                            ...prev,
                            includeSchools: false,
                            includeClassesAndStudents: false,
                            includeTeachers: false,
                            includeAssignments: false,
                            includeSubjects: false,
                            includeBNCC: false,
                            includeCategories: false,
                            includeEventTypes: false,
                            includeAttendance: false,
                            includeGrades: false,
                            includeLessonPlans: false,
                            includeEvents: false,
                            includeLibrary: false
                          }))
                        }
                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                      >
                        Desmarcar Tudo
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs text-slate-700">
                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeSchools}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeSchools: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Escolas ({parsedBackup.metadata.recordCounts.schools})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeClassesAndStudents}
                        onChange={(e) =>
                          setRestoreOptions({
                            ...restoreOptions,
                            includeClassesAndStudents: e.target.checked
                          })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Turmas & Alunos ({parsedBackup.metadata.recordCounts.students} alunos)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeTeachers}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeTeachers: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Professores ({parsedBackup.metadata.recordCounts.teachers})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeAttendance}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeAttendance: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Chamadas / Frequência ({parsedBackup.metadata.recordCounts.attendances})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeGrades}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeGrades: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Avaliações & Notas ({parsedBackup.metadata.recordCounts.grades})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeLessonPlans}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeLessonPlans: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Planos de Aula ({parsedBackup.metadata.recordCounts.lessonPlans})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeEvents}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeEvents: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Ocorrências ({parsedBackup.metadata.recordCounts.events})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeSubjects}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeSubjects: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Disciplinas ({parsedBackup.metadata.recordCounts.subjects})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeBNCC}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeBNCC: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>BNCC ({parsedBackup.metadata.recordCounts.bncc})</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={restoreOptions.includeLibrary !== false}
                        onChange={(e) =>
                          setRestoreOptions({ ...restoreOptions, includeLibrary: e.target.checked })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Biblioteca Escolar ({(parsedBackup.metadata.recordCounts.books || 0) + (parsedBackup.metadata.recordCounts.loans || 0)} itens)</span>
                    </label>
                  </div>
                </div>

                {/* Modo de Restauração */}
                <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900 uppercase tracking-wider">
                    <Info className="w-4 h-4 text-amber-700" />
                    <span>Modo de Aplicação da Restauração</span>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-lg border border-amber-200">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="merge"
                        checked={restoreOptions.mode === 'merge'}
                        onChange={() => setRestoreOptions({ ...restoreOptions, mode: 'merge' })}
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="text-xs">
                        <strong className="text-slate-800 block">
                          Mesclar e Atualizar (Recomendado & Seguro)
                        </strong>
                        <span className="text-slate-500">
                          Preserva todos os dados existentes no banco e atualiza/adiciona os registros presentes no backup. Não apaga dados prévios.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-lg border border-amber-200">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="overwrite_selected"
                        checked={restoreOptions.mode === 'overwrite_selected'}
                        onChange={() =>
                          setRestoreOptions({ ...restoreOptions, mode: 'overwrite_selected' })
                        }
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="text-xs">
                        <strong className="text-slate-800 block">Substituição dos Módulos Selecionados</strong>
                        <span className="text-slate-500">
                          Aplica os nós selecionados sobrescrevendo as tabelas equivalentes.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Barra de Progresso durante Restauração */}
                {isRestoring && (
                  <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-200 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
                      <span>{restoreProgress.msg}</span>
                      <span>{restoreProgress.percent}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-indigo-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
                        style={{ width: `${restoreProgress.percent}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {/* Botão de Restauração */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParsedBackup(null);
                      setImportFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    disabled={isRestoring}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    id="btn-run-restore"
                    onClick={handleConfirmRestore}
                    disabled={isRestoring}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md transition transform active:scale-95 cursor-pointer"
                  >
                    {isRestoring ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Gravando Dados...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span>Restaurar Dados Agora</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 3: HISTÓRICO & CONFIGURAÇÃO DA ROTINA */}
      {activeTab === 'history_settings' && (
        <div className="space-y-6">
          {/* Configuração da Frequência de Lembrete */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">
                  Configuração da Rotina Periódica de Backup
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Defina o intervalo em que o sistema deve alertá-lo para realizar novas cópias de segurança.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => handleSaveReminderFrequency(3)}
                className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                  reminderDays === 3
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-indigo-200 bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-indigo-700">Frequente</div>
                <div className="text-sm font-bold text-slate-800 mt-1">A cada 3 dias</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Ideal para semanas de fechamento de notas</div>
              </button>

              <button
                type="button"
                onClick={() => handleSaveReminderFrequency(7)}
                className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                  reminderDays === 7
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-indigo-200 bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-emerald-700">Recomendado</div>
                <div className="text-sm font-bold text-slate-800 mt-1">Semanal (7 dias)</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Equilíbrio perfeito para rotinas escolares</div>
              </button>

              <button
                type="button"
                onClick={() => handleSaveReminderFrequency(15)}
                className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                  reminderDays === 15
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-indigo-200 bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-amber-700">Quinzenal</div>
                <div className="text-sm font-bold text-slate-800 mt-1">A cada 15 dias</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Para uso com volume moderado</div>
              </button>

              <button
                type="button"
                onClick={() => handleSaveReminderFrequency(30)}
                className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                  reminderDays === 30
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-indigo-200 bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-slate-700">Mensal</div>
                <div className="text-sm font-bold text-slate-800 mt-1">A cada 30 dias</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Lembrete mensal de segurança</div>
              </button>
            </div>
          </div>

          {/* Histórico Local de Backups Gerados */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">
                  Histórico de Backups Gerados Neste Navegador
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Registro cronológico dos downloads de segurança realizados.
                </p>
              </div>

              {historyList.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpar Histórico</span>
                </button>
              )}
            </div>

            {historyList.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200/60">
                <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">Nenhum backup registrado ainda</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ao gerar seu primeiro arquivo de backup, ele aparecerá listado aqui.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="pb-3">Data e Hora</th>
                      <th className="pb-3">Nome do Arquivo</th>
                      <th className="pb-3">Registros</th>
                      <th className="pb-3">Tamanho</th>
                      <th className="pb-3">Responsável</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyList.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="py-3 font-semibold text-slate-800 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>{item.dateStr}</span>
                        </td>
                        <td className="py-3 text-slate-600 font-mono text-[11px]">{item.filename}</td>
                        <td className="py-3 text-slate-700 font-semibold">{item.totalRecords} itens</td>
                        <td className="py-3 text-slate-500">
                          {item.sizeBytes ? `${(item.sizeBytes / 1024).toFixed(1)} KB` : '-'}
                        </td>
                        <td className="py-3 text-slate-600">{item.exportedBy || 'Usuário'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
