import React, { useState, useEffect } from 'react';
import { ClassRoom, Student, ModalConfig, DEFAULT_SUBJECTS, SubjectItem, School, sortSubjectsByOrder } from '../types';
import { carregarMinhasTurmas, carregarEscolas, get, ref, rtdb } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  generateBimesterReport,
  generateBimesterReportXLSX,
  generateAnnualReport,
  generateAnnualReportXLSX,
  generateClassPerformanceReport,
  generateClassPerformanceReportXLSX,
  generateStudentEvolutionReport,
  generateStudentEvolutionReportXLSX,
  generateClassesComparisonReport,
  generateClassesComparisonReportXLSX,
  generateAttendanceReport,
  generateAttendanceReportXLSX,
  generateDailyAttendanceReport,
  generateDailyAttendanceReportXLSX,
  generateAbsenceReport,
  generateAbsenceReportXLSX,
  calculateClassesAbsenceStats,
  generateClassesAbsenceRankingReport,
  generateClassesAbsenceRankingReportXLSX,
  ClassAbsenceStats,
  ClassesAbsenceRankingSummary,
  generateIndividualStudentReport,
  generateIndividualStudentReportXLSX,
  generateAtRiskStudentsReport,
  generateAtRiskStudentsReportXLSX,
  generateTransfersReport,
  generateTransfersReportXLSX,
  generateLessonPlanReport,
  generateLessonPlanReportXLSX,
  generateCategoryReport,
  generateCategoryReportXLSX,
  generateBNCCPerformanceReport,
  generateBNCCPerformanceReportXLSX,
  generateBNCCCoverageReport,
  generateBNCCCoverageReportXLSX,
  generateLessonsPeriodReport,
  generateLessonsPeriodReportXLSX,
  generateEventsReport,
  generateEventsReportXLSX,
  generateEventsByTypeReport,
  generateEventsByTypeReportXLSX,
  generateConsolidatedReport,
  generateConsolidatedReportXLSX,
  formatDate
} from '../lib/reports';
import {
  FileSpreadsheet,
  FileText,
  BarChart3,
  CheckSquare,
  UserCheck,
  BookOpen,
  AlertTriangle,
  Building2,
  TrendingUp,
  Award,
  CalendarDays,
  Flame,
  AlertCircle,
  Users,
  ArrowDownNarrowWide,
  Eye,
  X,
  Filter
} from 'lucide-react';
import { StudentEvolutionChartModal } from './StudentEvolutionChartModal';

interface ReportsScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

type ReportTab =
  | 'desempenho'
  | 'frequencia'
  | 'individual'
  | 'pedagogico'
  | 'eventos'
  | 'geral';

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<SubjectItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedSubject, setSelectedSubject] = useState('todas');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [students, setStudents] = useState<{ id: string; val: Student }[]>([]);
  const [showTransferAnnual, setShowTransferAnnual] = useState(true);
  const [showLessonContentBimester, setShowLessonContentBimester] = useState(false);
  const [showRABimester, setShowRABimester] = useState(true);
  const [showRAAttendance, setShowRAAttendance] = useState(true);
  const [showAbsencePctAttendance, setShowAbsencePctAttendance] = useState(true);
  const [showStatusAttendance, setShowStatusAttendance] = useState(true);
  const [includeTransfersAttendance, setIncludeTransfersAttendance] = useState(false);
  const [showRARanking, setShowRARanking] = useState(true);
  const [showAbsencePctRanking, setShowAbsencePctRanking] = useState(true);
  const [showStatusRanking, setShowStatusRanking] = useState(true);
  const [includeTransfersRanking, setIncludeTransfersRanking] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>('desempenho');
  const [generating, setGenerating] = useState(false);
  const [isEvolutionChartOpen, setIsEvolutionChartOpen] = useState(false);
  const [evolutionChartInitialTab, setEvolutionChartInitialTab] = useState<'coletivo' | 'panorama'>('coletivo');

  // Estados específicos para o Relatório / Ranking de Turmas Mais Faltantes
  const [schoolsList, setSchoolsList] = useState<School[]>([]);
  const [rankingSchoolId, setRankingSchoolId] = useState('todas');
  const [rankingYear, setRankingYear] = useState(currentYear || new Date().getFullYear().toString());
  const [rankingBimester, setRankingBimester] = useState('todas');
  const [isAbsenceRankingModalOpen, setIsAbsenceRankingModalOpen] = useState(false);
  const [rankingStats, setRankingStats] = useState<ClassAbsenceStats[]>([]);
  const [rankingSummary, setRankingSummary] = useState<ClassesAbsenceRankingSummary | null>(null);
  const [loadingRankingModal, setLoadingRankingModal] = useState(false);

  const loadSubjectsList = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: SubjectItem[] = Object.keys(val).map((k) => {
          const item = val[k];
          return typeof item === 'object' && item !== null
            ? {
                id: item.id || k,
                name: item.name || k,
                shortName: item.shortName || item.name || k,
                category: item.category === 'diversificada' ? 'diversificada' : 'regente',
                order: typeof item.order === 'number' && !isNaN(item.order) ? item.order : undefined
              }
            : { id: k, name: String(item), shortName: String(item), category: 'regente' };
        });
        setAvailableSubjects(sortSubjectsByOrder(list));
      } else {
        setAvailableSubjects(sortSubjectsByOrder([...DEFAULT_SUBJECTS]));
      }
    } catch (e) {
      console.warn('Erro ao carregar disciplinas cadastradas:', e);
      setAvailableSubjects(sortSubjectsByOrder([...DEFAULT_SUBJECTS]));
    }
  };

  const loadClasses = async () => {
    try {
      const results = await carregarMinhasTurmas();
      const filtered = results.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
      if (filtered.length > 0 && !selectedClassId) {
        setSelectedClassId(filtered[0].id);
      }
      loadSchoolsList(filtered);
    } catch (err) {
      console.error(err);
    }
  };

  const loadStudents = async (classId: string) => {
    if (!classId) return setStudents([]);
    try {
      const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
      const val = snap.exists() ? snap.val() || {} : {};
      const list: { id: string; val: Student }[] = [];
      Object.keys(val).forEach((k) => {
        const s = val[k];
        if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
          list.push({ id: k, val: s });
        }
      });
      // Fallback para os alunos do objeto da turma em classes
      if (list.length === 0) {
        const t = classes.find((c) => c.id === classId)?.val;
        if (t && t.alunos) {
          Object.keys(t.alunos).forEach((k) => {
            const s = t.alunos![k];
            if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
              list.push({ id: k, val: s });
            }
          });
        }
      }
      list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
      setStudents(list);
    } catch (err) {
      console.error('Erro ao carregar alunos:', err);
      const t = classes.find((c) => c.id === classId)?.val;
      if (t && t.alunos) {
        const list: { id: string; val: Student }[] = [];
        Object.keys(t.alunos).forEach((k) => {
          const s = t.alunos![k];
          if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
            list.push({ id: k, val: s });
          }
        });
        list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
        setStudents(list);
      }
    }
  };

  const loadSchoolsList = async (turmas?: { id: string; val: ClassRoom }[]) => {
    try {
      const list = await carregarEscolas();
      const currentClasses = turmas || classes;
      const map: Record<string, School> = {};

      list.forEach((s) => {
        const sName = (s.name || (s as any).nome || '').trim();
        if (s.id) {
          map[s.id] = { ...s, name: sName || 'Escola sem Nome' };
        }
      });

      currentClasses.forEach((t) => {
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

      const finalList = Object.values(map);
      finalList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setSchoolsList(finalList);
    } catch (e) {
      console.warn('Erro ao carregar escolas:', e);
      const map: Record<string, School> = {};
      (turmas || classes).forEach((t) => {
        if (t.val.schoolId) {
          map[t.val.schoolId] = {
            id: t.val.schoolId,
            name: (t.val.schoolName || '').trim() || 'Escola sem Nome'
          };
        }
      });
      const finalList = Object.values(map);
      finalList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setSchoolsList(finalList);
    }
  };

  useEffect(() => {
    loadClasses();
    loadSubjectsList();
    loadSchoolsList();
  }, [currentYear]);

  useEffect(() => {
    if (currentYear) {
      setRankingYear(currentYear);
    }
  }, [currentYear]);

  useEffect(() => {
    if (selectedClassId) {
      loadStudents(selectedClassId);
    }
  }, [selectedClassId, currentYear]);

  const selectedTurma = classes.find((c) => c.id === selectedClassId)?.val;

  const runReport = async (fn: () => Promise<any>, successMsg = 'Relatório gerado com sucesso!') => {
    if (!selectedClassId && activeTab !== 'geral' && activeTab !== 'desempenho') {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Por favor, selecione uma turma primeiro.',
        icon: '⚠️'
      });
      return;
    }
    setGenerating(true);
    try {
      await fn();
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: successMsg,
        icon: '✅'
      });
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar Relatório',
        message: formatFriendlyError(err, 'Não foi possível gerar o relatório selecionado'),
        icon: '❌'
      });
    } finally {
      setGenerating(false);
    }
  };

  const runRankingReport = async (
    fn: () => Promise<any>,
    successMsg = 'Relatório de turmas mais faltantes gerado com sucesso!'
  ) => {
    setGenerating(true);
    try {
      await fn();
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: successMsg,
        icon: '✅'
      });
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar Relatório de Absenteísmo',
        message: formatFriendlyError(err, 'Não foi possível gerar as estatísticas de turmas mais faltantes'),
        icon: '❌'
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenRankingModal = async () => {
    setLoadingRankingModal(true);
    setIsAbsenceRankingModalOpen(true);
    try {
      const res = await calculateClassesAbsenceStats({
        schoolId: rankingSchoolId,
        currentYear: rankingYear,
        bimester: rankingBimester
      });
      setRankingStats(res.stats);
      setRankingSummary(res.summary);
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Dados',
        message: formatFriendlyError(err, 'Não foi possível calcular o ranking das turmas mais faltantes'),
        icon: '❌'
      });
      setIsAbsenceRankingModalOpen(false);
    } finally {
      setLoadingRankingModal(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
          <FileText className="w-7 h-7 text-indigo-600" />
          <span>Central de Relatórios & Estatísticas</span>
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Emita boletins por matéria ou gerais, atas de frequência e dossiês completos em PDF e XLSX
        </p>
      </div>

      {/* Barra de Filtros Globais */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Turma Selecionada *
            </label>
            <select
              id="report-class-select"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            >
              <option value="">Selecione a Turma</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.val.year}º {c.val.letter} — {c.val.shift} ({c.val.schoolName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Bimestre de Referência *
            </label>
            <select
              id="report-bimester-select"
              value={selectedBimester}
              onChange={(e) => setSelectedBimester(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            >
              <option value="1">1º Bimestre</option>
              <option value="2">2º Bimestre</option>
              <option value="3">3º Bimestre</option>
              <option value="4">4º Bimestre</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
              <span>Disciplina / Matéria</span>
              <span className="text-[10px] text-indigo-600 font-normal">Grade Dinâmica</span>
            </label>
            <select
              id="report-subject-select"
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-indigo-50/50 border border-indigo-200 text-indigo-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold"
            >
              <option value="todas">⭐ Todas as Matérias (Geral)</option>
              {availableSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  📖 {s.name} {s.shortName ? `(${s.shortName})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Aluno (Ficha Individual / Evolução)
            </label>
            <select
              id="report-student-select"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="">Todos os Alunos da Turma</option>
              {students.map((s) => {
                const isExpedido = s.val.status === 'expedida';
                const isRecebida = s.val.status === 'recebida';
                const inDate = s.val.transferInDate || (isRecebida ? s.val.transferDate : '');
                const outDate = s.val.transferOutDate || (isExpedido ? s.val.transferDate : '');
                let tag = '';
                if (isExpedido) {
                  if (inDate && outDate) {
                    tag = `(TR. REC. ${formatDate(inDate)} | TR. EXP. ${formatDate(outDate)})`;
                  } else {
                    tag = `(TR. EXP. ${formatDate(outDate)})`;
                  }
                } else if (isRecebida) {
                  tag = `(TR. REC. ${formatDate(inDate)})`;
                } else if (inDate) {
                  tag = `(TR. REC. ${formatDate(inDate)})`;
                }
                return (
                  <option key={s.id} value={s.id}>
                    Nº {s.val.number} - {s.val.name} {tag}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3 mb-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('desempenho')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'desempenho'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Desempenho & Notas</span>
        </button>

        <button
          onClick={() => setActiveTab('frequencia')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'frequencia'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Frequência</span>
        </button>

        <button
          onClick={() => setActiveTab('individual')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'individual'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Individual & Secretaria</span>
        </button>

        <button
          onClick={() => setActiveTab('pedagogico')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'pedagogico'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Pedagógico & BNCC</span>
        </button>

        <button
          onClick={() => setActiveTab('eventos')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'eventos'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Ocorrências</span>
        </button>

        <button
          onClick={() => setActiveTab('geral')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            activeTab === 'geral'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Visão Geral Consolidada</span>
        </button>
      </div>

      {/* TAB 1: DESEMPENHO & NOTAS */}
      {activeTab === 'desempenho' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. Boletim por Bimestre */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 mb-2">
                <BarChart3 className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Boletim por Bimestre</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Notas individuais por aluno no {selectedBimester}º bimestre (Geral ou por Matéria Selecionada)
              </p>
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showRABimester}
                    onChange={(e) => setShowRABimester(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Exibir coluna de R.A. do aluno</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showLessonContentBimester}
                    onChange={(e) => setShowLessonContentBimester(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Incluir categorias trabalhadas após as notas</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBimesterReport(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentTeacher,
                      currentYear,
                      selectedSubject,
                      showLessonContentBimester,
                      showRABimester
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBimesterReportXLSX(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentYear,
                      selectedSubject,
                      currentTeacher,
                      showLessonContentBimester,
                      showRABimester
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* 2. Boletim Anual */}
          <div className="bg-white rounded-2xl border border-emerald-200/80 p-5 shadow-xs flex flex-col justify-between border-l-4 border-l-emerald-500">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Award className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Boletim Anual Consolidado</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Notas do 1º ao 4º bimestre com fórmulas automáticas de média anual
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showTransferAnnual}
                  onChange={(e) => setShowTransferAnnual(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Indicar alunos transferidos (TR. REC / EXP)</span>
              </label>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAnnualReport(selectedClassId, selectedTurma!, currentTeacher, currentYear, showTransferAnnual, selectedSubject)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAnnualReportXLSX(selectedClassId, selectedTurma!, currentYear, showTransferAnnual, selectedSubject, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* 3. Desempenho da Turma */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-teal-600 mb-2">
                <TrendingUp className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Desempenho da Turma</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Média geral, faixas de nota, percentuais de aprovação e indicadores
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateClassPerformanceReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear, selectedSubject)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateClassPerformanceReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, selectedSubject, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* 4. Evolução Individual do Aluno */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <BarChart3 className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Evolução do Aluno (1º ao 4º)</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Trajetória e tendência de notas e evolução de aprendizagem anual
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!selectedClassId) {
                    setModal({
                      isOpen: true,
                      type: 'alert',
                      title: 'Atenção',
                      message: 'Por favor, selecione uma turma primeiro no topo da página de relatórios.',
                      icon: '⚠️'
                    });
                    return;
                  }
                  setEvolutionChartInitialTab('coletivo');
                  setIsEvolutionChartOpen(true);
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                title="Abrir gráfico já montado com todos os alunos da turma sobrepostos"
              >
                <TrendingUp className="w-4 h-4 text-indigo-200" />
                <span>Gráfico de Todos os Alunos (Turma Completa)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedClassId) {
                    setModal({
                      isOpen: true,
                      type: 'alert',
                      title: 'Atenção',
                      message: 'Por favor, selecione uma turma primeiro no topo da página de relatórios.',
                      icon: '⚠️'
                    });
                    return;
                  }
                  setEvolutionChartInitialTab('panorama');
                  setIsEvolutionChartOpen(true);
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                title="Abrir listagem da turma com trajetória escolar e gráfico individual"
              >
                <Users className="w-3.5 h-3.5 text-slate-500" />
                <span>Listagem com Gráfico Individual</span>
              </button>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    disabled={generating}
                    onClick={() =>
                      runReport(() =>
                        generateStudentEvolutionReport(selectedClassId, null, selectedTurma!, currentTeacher, currentYear)
                      )
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                    title="Gerar relatório completo da turma com todos os alunos e gráficos em PDF"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>PDF (Turma Toda)</span>
                  </button>
                  <button
                    disabled={generating}
                    onClick={() =>
                      runReport(() =>
                        generateStudentEvolutionReportXLSX(selectedClassId, null, selectedTurma!, currentYear, currentTeacher)
                      )
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                    title="Baixar planilha Excel com fórmulas dinâmicas e gráfico da turma embutido"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Exportar XLSX</span>
                  </button>
                </div>
                {selectedStudentId && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      disabled={generating}
                      onClick={() =>
                        runReport(() =>
                          generateStudentEvolutionReport(selectedClassId, selectedStudentId, selectedTurma!, currentTeacher, currentYear)
                        )
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition-colors"
                      title="Gerar relatório de evolução individual do aluno filtrado"
                    >
                      <FileText className="w-3 h-3 text-slate-500" />
                      <span>PDF (Aluno Filtrado)</span>
                    </button>
                    <button
                      disabled={generating}
                      onClick={() =>
                        runReport(() =>
                          generateStudentEvolutionReportXLSX(selectedClassId, selectedStudentId, selectedTurma!, currentYear, currentTeacher)
                        )
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition-colors"
                      title="Gerar planilha de evolução individual do aluno filtrado"
                    >
                      <FileSpreadsheet className="w-3 h-3 text-slate-500" />
                      <span>XLSX (Aluno Filtrado)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5. Comparativo entre Turmas */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-purple-600 mb-2">
                <Building2 className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Comparativo entre Turmas</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Quadro comparativo de desempenho médio e frequência entre todas as turmas
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() => generateClassesComparisonReport(currentYear))
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() => generateClassesComparisonReportXLSX(currentYear))
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FREQUÊNCIA */}
      {activeTab === 'frequencia' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Frequência Bimestral */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-sky-600 mb-2">
                <CheckSquare className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Frequência Bimestral</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Presenças, faltas e percentual de frequência calculado de cada aluno no {selectedBimester}º bimestre
              </p>
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showRAAttendance}
                    onChange={(e) => setShowRAAttendance(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span>Exibir coluna de R.A.</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showAbsencePctAttendance}
                    onChange={(e) => setShowAbsencePctAttendance(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span>Exibir % de Ausência</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showStatusAttendance}
                    onChange={(e) => setShowStatusAttendance(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span>Exibir Situação / Status</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none font-medium">
                  <input
                    type="checkbox"
                    checked={includeTransfersAttendance}
                    onChange={(e) => setIncludeTransfersAttendance(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span>Incluir Transferências de Saída</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAttendanceReport(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentTeacher,
                      currentYear,
                      showRAAttendance,
                      showAbsencePctAttendance,
                      showStatusAttendance,
                      includeTransfersAttendance
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAttendanceReportXLSX(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentYear,
                      currentTeacher,
                      showRAAttendance,
                      showAbsencePctAttendance,
                      showStatusAttendance,
                      includeTransfersAttendance
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Ranking de Faltas */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-rose-600 mb-2">
                <Flame className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Ranking de Faltas / Absenteísmo</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Lista ordenada com destaque para alunos que atingiram status crítico de faltas
              </p>
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showRARanking}
                    onChange={(e) => setShowRARanking(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Exibir coluna de R.A.</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showAbsencePctRanking}
                    onChange={(e) => setShowAbsencePctRanking(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Exibir % de Ausência</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showStatusRanking}
                    onChange={(e) => setShowStatusRanking(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Exibir Situação / Status</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none font-medium">
                  <input
                    type="checkbox"
                    checked={includeTransfersRanking}
                    onChange={(e) => setIncludeTransfersRanking(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Incluir Transferências de Saída</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAbsenceReport(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentTeacher,
                      currentYear,
                      showRARanking,
                      showAbsencePctRanking,
                      showStatusRanking,
                      includeTransfersRanking
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAbsenceReportXLSX(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentYear,
                      currentTeacher,
                      showRARanking,
                      showAbsencePctRanking,
                      showStatusRanking,
                      includeTransfersRanking
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* 3. Mapa de Frequência Diária (Grade Dia a Dia / Diário de Classe) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between md:col-span-2">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 mb-2">
                <CalendarDays className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Mapa de Frequência Diária (Grade Dia a Dia / Diário de Classe)</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-1">
                Visualização detalhada de todas as chamadas realizadas dia a dia no {selectedBimester}º bimestre. Apresenta uma coluna para cada data com a indicação de presença (P), falta (F) ou ausência de matrícula (-) de cada estudante.
              </p>
              <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2 mt-2">
                💡 <strong>Ideal para Encontrar Chamadas e Auditoria:</strong> Permite consultar o histórico diário exato de presenças e faltas da turma inteira, com totais por dia e por estudante em formato paisagem (PDF) ou planilha (Excel).
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 flex-wrap sm:flex-nowrap">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateDailyAttendanceReport(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentTeacher,
                      currentYear
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Exportar Mapa Dia a Dia (PDF Paisagem)</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateDailyAttendanceReportXLSX(
                      selectedClassId,
                      selectedBimester,
                      selectedTurma!,
                      currentYear,
                      currentTeacher
                    )
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Exportar Mapa Dia a Dia (Planilha Excel)</span>
              </button>
            </div>
          </div>

          {/* NOVO: Ranking de Turmas Mais Faltantes (Ano Letivo / Escola) */}
          <div className="bg-gradient-to-br from-amber-50/60 via-white to-orange-50/40 rounded-2xl border-2 border-amber-300/80 p-5 shadow-sm flex flex-col justify-between col-span-1 md:col-span-2">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2 text-amber-700">
                  <div className="p-1.5 bg-amber-100 rounded-lg">
                    <ArrowDownNarrowWide className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      Ranking de Turmas Mais Faltantes (Absenteísmo Escolar)
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                        Novo
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-500 font-normal">
                      Classificação comparativa das turmas em ordem decrescente de ausências (% e volume total de faltas)
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleOpenRankingModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Visualizar Ranking na Tela</span>
                </button>
              </div>

              {/* Filtros Contextuais Específicos do Ranking */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3 p-3 bg-white/80 rounded-xl border border-amber-200/70 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-amber-600" />
                    Escola
                  </label>
                  <select
                    value={rankingSchoolId}
                    onChange={(e) => setRankingSchoolId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:ring-2 focus:ring-amber-500 text-xs"
                  >
                    <option value="todas">Todas as Escolas</option>
                    {schoolsList.map((sch) => {
                      const label = sch.name || (sch as any).nome || 'Escola sem Nome';
                      return (
                        <option key={sch.id} value={sch.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5 text-amber-600" />
                    Ano Letivo
                  </label>
                  <input
                    type="text"
                    value={rankingYear}
                    onChange={(e) => setRankingYear(e.target.value)}
                    placeholder="Ex: 2026"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:ring-2 focus:ring-amber-500 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5 text-amber-600" />
                    Bimestre
                  </label>
                  <select
                    value={rankingBimester}
                    onChange={(e) => setRankingBimester(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:ring-2 focus:ring-amber-500 text-xs"
                  >
                    <option value="todas">Todos os Bimestres (Ano Todo)</option>
                    <option value="1">1º Bimestre</option>
                    <option value="2">2º Bimestre</option>
                    <option value="3">3º Bimestre</option>
                    <option value="4">4º Bimestre</option>
                  </select>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Relatório executivo para gestão escolar e coordenação pedagógica. Cruza todas as chamadas lançadas, apontando as turmas mais faltosas da escola/rede, taxas percentuais de ausência, média de faltas por aluno e níveis de risco (Crítico, Alerta, Atenção e Adequado).
              </p>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-amber-200/80 flex-wrap sm:flex-nowrap">
              <button
                disabled={generating}
                onClick={() => {
                  const selectedSchoolObj = schoolsList.find((s) => s.id === rankingSchoolId);
                  const schoolName = selectedSchoolObj ? (selectedSchoolObj.name || (selectedSchoolObj as any).nome) : undefined;
                  runRankingReport(() =>
                    generateClassesAbsenceRankingReport({
                      schoolId: rankingSchoolId,
                      schoolName,
                      currentYear: rankingYear,
                      bimester: rankingBimester,
                      teacherName: currentTeacher
                    })
                  );
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Exportar Relatório e Ranking (PDF Paisagem)</span>
              </button>
              <button
                disabled={generating}
                onClick={() => {
                  const selectedSchoolObj = schoolsList.find((s) => s.id === rankingSchoolId);
                  const schoolName = selectedSchoolObj ? (selectedSchoolObj.name || (selectedSchoolObj as any).nome) : undefined;
                  runRankingReport(() =>
                    generateClassesAbsenceRankingReportXLSX({
                      schoolId: rankingSchoolId,
                      schoolName,
                      currentYear: rankingYear,
                      bimester: rankingBimester,
                      teacherName: currentTeacher
                    })
                  );
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Exportar Planilha Completa (Excel XLSX)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: INDIVIDUAL & SECRETARIA */}
      {activeTab === 'individual' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Ficha Individual do Aluno */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 mb-2">
                <UserCheck className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Ficha Individual do Aluno</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Dossiê completo com notas discriminadas em todas as matérias nos 4 bimestres e faltas
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateIndividualStudentReport(selectedClassId, selectedStudentId || null, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateIndividualStudentReportXLSX(selectedClassId, selectedStudentId || null, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Alunos em Risco Pedagógico */}
          <div className="bg-white rounded-2xl border border-rose-200/80 p-5 shadow-xs flex flex-col justify-between border-l-4 border-l-rose-500">
            <div>
              <div className="flex items-center gap-2 text-rose-600 mb-2">
                <AlertCircle className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Alunos em Risco Pedagógico</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Frequência abaixo de 75% e/ou média abaixo de 5.0 com ações e intervenções recomendadas
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAtRiskStudentsReport(selectedClassId, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateAtRiskStudentsReportXLSX(selectedClassId, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Relatório de Transferências */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <CalendarDays className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Relatório de Transferências</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Histórico de entradas (TR. REC) e saídas (TR. EXP) com datas, RAs e status
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() => generateTransfersReport(selectedClassId || null, currentYear))
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() => generateTransfersReportXLSX(selectedClassId || null, currentYear, currentTeacher))
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PEDAGÓGICO & BNCC */}
      {activeTab === 'pedagogico' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Diário de Conteúdo */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <BookOpen className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Diário de Conteúdo</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Aulas ministradas, códigos BNCC, conteúdos planejados e ministrados
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateLessonPlanReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateLessonPlanReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Relatório por Categoria */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <BarChart3 className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Relatório por Categoria</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Total de aulas ministradas sintetizadas e agrupadas por categorias de ensino
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateCategoryReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateCategoryReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Desempenho por Habilidade (BNCC) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-blue-600 mb-2">
                <BookOpen className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Desempenho por Habilidade (BNCC)</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Aulas ministradas mapeadas e agrupadas por cada código de habilidade BNCC
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBNCCPerformanceReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBNCCPerformanceReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Cobertura Curricular BNCC */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Award className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Cobertura Curricular BNCC</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Habilidades já trabalhadas versus pendentes e percentual de cobertura curricular
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBNCCCoverageReport(selectedClassId, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateBNCCCoverageReportXLSX(selectedClassId, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Aulas por Período / Carga Horária */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-600 mb-2">
                <CalendarDays className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Aulas por Período / Carga</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Detalhamento cronológico de aulas ministradas e horas lecionadas
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateLessonsPeriodReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateLessonsPeriodReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: OCORRÊNCIAS */}
      {activeTab === 'eventos' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Relatório de Eventos */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-rose-600 mb-2">
                <AlertTriangle className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Relatório Geral de Ocorrências</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Listagem detalhada das ocorrências disciplinares e pedagógicas do {selectedBimester}º bimestre
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateEventsReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateEventsReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>

          {/* Ocorrências por Tipo */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-purple-600 mb-2">
                <BarChart3 className="w-5 h-5" />
                <h4 className="font-bold text-slate-800 text-sm">Ocorrências por Tipo / Categoria</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Agrupamento estatístico por tipos de evento e identificação de padrões
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateEventsByTypeReport(selectedClassId, selectedBimester, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateEventsByTypeReportXLSX(selectedClassId, selectedBimester, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: VISÃO GERAL CONSOLIDADA */}
      {activeTab === 'geral' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-800 mb-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                <h4 className="font-bold text-slate-800 text-sm">Relatório Geral Consolidado da Turma</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Visão panorâmica e consolidada: dados cadastrais, média geral de notas, presenças, faltas, percentual de frequência e contagem de ocorrências
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateConsolidatedReport(selectedClassId, selectedTurma!, currentTeacher, currentYear)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  runReport(() =>
                    generateConsolidatedReportXLSX(selectedClassId, selectedTurma!, currentYear, currentTeacher)
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL: GRÁFICO DE EVOLUÇÃO E TRAJETÓRIA */}
      <StudentEvolutionChartModal
        isOpen={isEvolutionChartOpen}
        onClose={() => setIsEvolutionChartOpen(false)}
        classId={selectedClassId}
        turma={selectedTurma || null}
        initialStudentId={selectedStudentId || null}
        initialTab={evolutionChartInitialTab}
        initialSubject={selectedSubject}
        currentYear={currentYear}
        teacherName={currentTeacher}
        studentsList={students.map((s) => ({ id: s.id, ...s.val }))}
        subjectsList={availableSubjects}
      />

      {/* MODAL: RANKING INTERATIVO DAS TURMAS MAIS FALTANTES */}
      {isAbsenceRankingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
            {/* Header do Modal */}
            <div className="px-6 py-4 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/15 rounded-xl backdrop-blur-xs">
                  <ArrowDownNarrowWide className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                    Ranking de Turmas Mais Faltantes
                    <span className="text-[11px] font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                      Absenteísmo
                    </span>
                  </h3>
                  <p className="text-xs text-amber-100">
                    Ano Letivo {rankingYear} • {rankingBimester === 'todas' ? 'Todos os Bimestres' : `${rankingBimester}º Bimestre`} • {rankingSchoolId === 'todas' ? 'Todas as Escolas' : schoolsList.find((s) => s.id === rankingSchoolId)?.name || (schoolsList.find((s) => s.id === rankingSchoolId) as any)?.nome || 'Escola Selecionada'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAbsenceRankingModalOpen(false)}
                className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de Filtros Rápida dentro do Modal */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-600">Escola:</label>
                  <select
                    value={rankingSchoolId}
                    onChange={(e) => setRankingSchoolId(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs font-medium"
                  >
                    <option value="todas">Todas as Escolas</option>
                    {schoolsList.map((sch) => {
                      const label = sch.name || (sch as any).nome || 'Escola sem Nome';
                      return (
                        <option key={sch.id} value={sch.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-600">Ano:</label>
                  <input
                    type="text"
                    value={rankingYear}
                    onChange={(e) => setRankingYear(e.target.value)}
                    className="w-20 px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs font-medium"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-600">Bimestre:</label>
                  <select
                    value={rankingBimester}
                    onChange={(e) => setRankingBimester(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs font-medium"
                  >
                    <option value="todas">Ano Todo</option>
                    <option value="1">1º Bimestre</option>
                    <option value="2">2º Bimestre</option>
                    <option value="3">3º Bimestre</option>
                    <option value="4">4º Bimestre</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleOpenRankingModal}
                  disabled={loadingRankingModal}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-medium cursor-pointer transition-colors shadow-2xs"
                >
                  {loadingRankingModal ? 'Atualizando...' : 'Recalcular'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generating || rankingStats.length === 0}
                  onClick={() => {
                    const selectedSchoolObj = schoolsList.find((s) => s.id === rankingSchoolId);
                    const schoolName = selectedSchoolObj ? (selectedSchoolObj.name || (selectedSchoolObj as any).nome) : undefined;
                    runRankingReport(() =>
                      generateClassesAbsenceRankingReport({
                        schoolId: rankingSchoolId,
                        schoolName,
                        currentYear: rankingYear,
                        bimester: rankingBimester,
                        teacherName: currentTeacher
                      })
                    );
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>PDF Paisagem</span>
                </button>
                <button
                  type="button"
                  disabled={generating || rankingStats.length === 0}
                  onClick={() => {
                    const selectedSchoolObj = schoolsList.find((s) => s.id === rankingSchoolId);
                    const schoolName = selectedSchoolObj ? (selectedSchoolObj.name || (selectedSchoolObj as any).nome) : undefined;
                    runRankingReport(() =>
                      generateClassesAbsenceRankingReportXLSX({
                        schoolId: rankingSchoolId,
                        schoolName,
                        currentYear: rankingYear,
                        bimester: rankingBimester,
                        teacherName: currentTeacher
                      })
                    );
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel XLSX</span>
                </button>
              </div>
            </div>

            {/* Corpo do Modal: KPIs e Tabela */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {loadingRankingModal ? (
                <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-3 border-amber-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium">Cruzando chamadas e consolidando absenteísmo das turmas...</p>
                </div>
              ) : rankingStats.length === 0 ? (
                <div className="py-16 text-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <ArrowDownNarrowWide className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-semibold text-slate-700">Nenhuma turma com chamadas registradas encontrada</p>
                  <p className="text-xs text-slate-400 mt-1">Verifique o ano letivo e os filtros selecionados.</p>
                </div>
              ) : (
                <>
                  {/* Cards de Resumo Executivo */}
                  {rankingSummary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">
                          Turmas Analisadas
                        </span>
                        <div className="text-xl font-black text-amber-900 mt-0.5">
                          {rankingSummary.totalClasses ?? rankingSummary.totalTurmas ?? 0}
                        </div>
                        <span className="text-[11px] text-amber-600">
                          {rankingSummary.totalStudents ?? rankingSummary.totalAlunos ?? 0} alunos ativos
                        </span>
                      </div>

                      <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-rose-700 tracking-wider">
                          Total de Faltas
                        </span>
                        <div className="text-xl font-black text-rose-900 mt-0.5">
                          {(rankingSummary.totalAbsences ?? 0).toLocaleString('pt-BR')}
                        </div>
                        <span className="text-[11px] text-rose-600">
                          em {(rankingSummary.totalCalls ?? rankingSummary.totalRecords ?? 0).toLocaleString('pt-BR')} registros
                        </span>
                      </div>

                      <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider">
                          Taxa Média de Ausência
                        </span>
                        <div className="text-xl font-black text-indigo-900 mt-0.5">
                          {Number(rankingSummary.overallAbsenceRate ?? rankingSummary.avgAbsenceRate ?? 0).toFixed(1)}%
                        </div>
                        <span className="text-[11px] text-indigo-600">
                          Frequência: {Number(rankingSummary.overallAttendanceRate ?? rankingSummary.avgAttendanceRate ?? 100).toFixed(1)}%
                        </span>
                      </div>

                      <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-purple-700 tracking-wider">
                          Turmas em Risco Crítico
                        </span>
                        <div className="text-xl font-black text-purple-900 mt-0.5">
                          {rankingSummary.criticalCount ?? rankingSummary.criticalClassesCount ?? 0}
                        </div>
                        <span className="text-[11px] text-purple-600">
                          ausência superior a 20%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Tabela de Classificação Ordenada */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                    <div className="overflow-x-auto max-h-[50vh]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200 text-[11px]">
                          <tr>
                            <th className="py-2.5 px-3 font-bold text-center w-12">Pos.</th>
                            <th className="py-2.5 px-3 font-bold">Turma</th>
                            <th className="py-2.5 px-3 font-bold">Escola</th>
                            <th className="py-2.5 px-3 font-bold text-center">Alunos</th>
                            <th className="py-2.5 px-3 font-bold text-center">Chamadas</th>
                            <th className="py-2.5 px-3 font-bold text-center text-emerald-700">Presenças</th>
                            <th className="py-2.5 px-3 font-bold text-center text-rose-700">Faltas</th>
                            <th className="py-2.5 px-3 font-bold text-center bg-amber-100/60 text-amber-900">
                              % Ausência
                            </th>
                            <th className="py-2.5 px-3 font-bold text-center">Freq. %</th>
                            <th className="py-2.5 px-3 font-bold text-center">Média Faltas/Al.</th>
                            <th className="py-2.5 px-3 font-bold text-center">Risco</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {rankingStats.map((item) => {
                            const isFirst = item.rank === 1;
                            const currentRisk = item.riskLevel || item.status || 'Adequado';
                            return (
                              <tr
                                key={item.classId}
                                className={`hover:bg-slate-50 transition-colors ${
                                  isFirst ? 'bg-amber-50/30' : ''
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center font-bold">
                                  <span
                                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${
                                      item.rank === 1
                                        ? 'bg-amber-400 text-amber-950 shadow-xs'
                                        : item.rank === 2
                                        ? 'bg-slate-300 text-slate-800'
                                        : item.rank === 3
                                        ? 'bg-amber-600/30 text-amber-900'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {item.rank}º
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-bold text-slate-800">
                                  <div className="flex items-center gap-1.5">
                                    <span>{item.className}</span>
                                    {item.shift && (
                                      <span className="text-[10px] font-normal text-slate-400">
                                        ({item.shift})
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 text-[11px] truncate max-w-[180px]" title={item.schoolName}>
                                  {item.schoolName}
                                </td>
                                <td className="py-2.5 px-3 text-center text-slate-700 font-medium">
                                  {item.activeStudents ?? item.studentCount ?? 0}
                                </td>
                                <td className="py-2.5 px-3 text-center text-slate-600">
                                  {item.totalCalls ?? item.callDatesCount ?? 0}
                                </td>
                                <td className="py-2.5 px-3 text-center text-emerald-700 font-semibold">
                                  {(item.totalPresences ?? 0).toLocaleString('pt-BR')}
                                </td>
                                <td className="py-2.5 px-3 text-center text-rose-700 font-bold">
                                  {(item.totalAbsences ?? 0).toLocaleString('pt-BR')}
                                </td>
                                <td className="py-2.5 px-3 text-center font-black bg-amber-50/50">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-black ${
                                      currentRisk === 'Crítico'
                                        ? 'bg-rose-100 text-rose-800'
                                        : currentRisk === 'Alerta'
                                        ? 'bg-orange-100 text-orange-800'
                                        : currentRisk === 'Atenção'
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-emerald-100 text-emerald-800'
                                    }`}
                                  >
                                    {Number(item.absenceRate ?? 0).toFixed(1)}%
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-center font-semibold text-slate-700">
                                  {Number(item.attendanceRate ?? 100).toFixed(1)}%
                                </td>
                                <td className="py-2.5 px-3 text-center text-slate-600 font-medium">
                                  {Number(item.avgAbsencesPerStudent ?? 0).toFixed(1)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                      currentRisk === 'Crítico'
                                        ? 'bg-rose-600 text-white'
                                        : currentRisk === 'Alerta'
                                        ? 'bg-orange-500 text-white'
                                        : currentRisk === 'Atenção'
                                        ? 'bg-amber-500 text-slate-900'
                                        : 'bg-emerald-600 text-white'
                                    }`}
                                  >
                                    {currentRisk}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 border border-slate-200">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-slate-700">Critérios de Risco:</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
                        <strong>Crítico:</strong> Ausência &gt; 25% (Risco LDB)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                        <strong>Alerta:</strong> 15% - 25%
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <strong>Atenção:</strong> 10% - 15%
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                        <strong>Adequado:</strong> &lt; 10%
                      </span>
                    </div>
                    <span className="italic text-[10px]">
                      Ordenação: 1º maior taxa de ausência (%), 2º total absoluto de faltas.
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsAbsenceRankingModalOpen(false)}
                className="px-4 py-2 bg-white hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
