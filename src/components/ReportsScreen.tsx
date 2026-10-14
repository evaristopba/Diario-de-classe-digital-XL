import React, { useState, useEffect } from 'react';
import { ClassRoom, Student, ModalConfig, DEFAULT_SUBJECTS, SubjectItem } from '../types';
import { carregarMinhasTurmas, get, ref, rtdb } from '../lib/firebase';
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
  Users
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
                category: item.category === 'diversificada' ? 'diversificada' : 'regente'
              }
            : { id: k, name: String(item), shortName: String(item), category: 'regente' };
        });
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAvailableSubjects(list);
      } else {
        setAvailableSubjects([]);
      }
    } catch (e) {
      console.warn('Erro ao carregar disciplinas cadastradas:', e);
      setAvailableSubjects([]);
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

  useEffect(() => {
    loadClasses();
    loadSubjectsList();
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
    </div>
  );
};
