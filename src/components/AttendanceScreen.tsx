import React, { useState, useEffect } from 'react';
import { ClassRoom, Student, ModalConfig } from '../types';
import {
  get,
  ref,
  update,
  remove,
  rtdb,
  dc,
  carregarMinhasTurmas,
  getTodayDateString
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  formatDate,
  isStudentEnrolledOnDate,
  isStudentTransferredInAfterBimester,
  generateDailyAttendanceReport,
  generateDailyAttendanceReportXLSX
} from '../lib/reports';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CheckSquare,
  Save,
  Trash2,
  Search,
  Download,
  Upload,
  Cake,
  Sparkles,
  CalendarDays,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  History,
  Info,
  CheckCircle2,
  Calendar
} from 'lucide-react';
import { ImproperAttendanceModal, ImproperAttendanceRecord } from './ImproperAttendanceModal';

interface AttendanceScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

export const AttendanceScreen: React.FC<AttendanceScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateString());

  const [students, setStudents] = useState<{ id: string; val: Student }[]>([]);
  const [attendanceState, setAttendanceState] = useState<Record<string, 'P' | 'F'>>({});
  const [loading, setLoading] = useState(false);
  const [recordedDates, setRecordedDates] = useState<
    { date: string; presentCount: number; absentCount: number; totalCount: number }[]
  >([]);
  const [improperRecords, setImproperRecords] = useState<ImproperAttendanceRecord[]>([]);
  const [showImproperModal, setShowImproperModal] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

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

  useEffect(() => {
    loadClasses();
  }, [currentYear]);

  const checkBirthdays = async (classId: string, studentsList: { id: string; val: Student }[]) => {
    const today = new Date();
    const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;

    const birthdays = studentsList.filter((s) => {
      if (s.val.status === 'expedida') return false;
      if (!s.val.birthdate) return false;
      const parts = s.val.birthdate.split('-');
      if (parts.length < 3) return false;
      const studentMonthDay = `${parts[1]}-${parts[2]}`;
      return studentMonthDay === todayStr;
    });

    if (birthdays.length > 0) {
      const turma = classes.find((c) => c.id === classId)?.val;
      const turmaStr = turma ? `${turma.year}º ${turma.letter}` : 'Turma';

      setModal({
        isOpen: true,
        type: 'custom',
        title: '🎉 Aniversariante(s) de Hoje!',
        icon: '🎂',
        children: (
          <div className="text-left space-y-4 my-2">
            <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-sm mb-2">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <span>Hoje tem festa na turma {turmaStr}!</span>
              </div>
              <ul className="space-y-2">
                {birthdays.map((b) => {
                  const birthYear = parseInt(b.val.birthdate.split('-')[0]);
                  const age = new Date().getFullYear() - birthYear;
                  return (
                    <li
                      key={b.id}
                      className="flex items-center justify-between text-xs sm:text-sm bg-white/80 p-2.5 rounded-lg border border-amber-100 font-medium text-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <Cake className="w-4 h-4 text-amber-600" />
                        <strong>{b.val.name}</strong> (Nº {b.val.number})
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                        {age} anos
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => exportBirthdayPDF(birthdays, turma)}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
              >
                📄 Exportar PDF
              </button>
            </div>
          </div>
        )
      });
    }
  };

  const exportBirthdayPDF = (birthdays: { id: string; val: Student }[], turma?: ClassRoom) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('ANIVERSARIANTES DO DIA 🎂', 105, 15, { align: 'center' });

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Escola: ${turma ? turma.schoolName : '-'} | Turma: ${turma ? `${turma.year}º ${turma.letter}` : '-'}`, 14, 25);
      doc.text(`Data: ${formatDate(selectedDate)} | Professor(a): ${currentTeacher}`, 14, 31);

      const tableData = birthdays.map((b, idx) => {
        const birthYear = parseInt(b.val.birthdate.split('-')[0]);
        const age = new Date().getFullYear() - birthYear;
        return [idx + 1, b.val.number, b.val.name, formatDate(b.val.birthdate), `${age} anos`];
      });

      autoTable(doc, {
        startY: 37,
        head: [['#', 'Nº', 'Aluno', 'Data de Nasc.', 'Idade']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [246, 224, 94], textColor: [116, 66, 16] }
      });

      doc.save('aniversariantes_hoje.pdf');
    } catch (e: any) {
      console.error(e);
    }
  };

  const loadAttendance = async () => {
    if (!selectedClassId || !selectedBimester || !selectedDate) return;

    try {
      setLoading(true);
      const snap = await get(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos`));
      const val = snap.val() || {};
      const list: { id: string; val: Student }[] = [];
      Object.keys(val).forEach((k) => {
        const s = val[k];
        if (!s.anoLetivo || s.anoLetivo === currentYear) {
          list.push({ id: k, val: s });
        }
      });
      list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
      setStudents(list);

      const attSnap = await get(ref(rtdb, dc('chamada')));
      const attVal = attSnap.val() || {};

      // 1. Mapear todas as datas com chamada realizada neste bimestre e turma
      const compositeDatesMap: Record<string, { presentCount: number; absentCount: number }> = {};
      const detectedImproper: ImproperAttendanceRecord[] = [];

      Object.keys(attVal).forEach((k) => {
        const rec = attVal[k];
        if (
          rec.classId === selectedClassId &&
          (!rec.anoLetivo || rec.anoLetivo === currentYear)
        ) {
          if (String(rec.bimester) === String(selectedBimester) && rec.date) {
            if (!compositeDatesMap[rec.date]) {
              compositeDatesMap[rec.date] = { presentCount: 0, absentCount: 0 };
            }
            if (rec.status === 'P') compositeDatesMap[rec.date].presentCount++;
            else if (rec.status === 'F') compositeDatesMap[rec.date].absentCount++;
          }

          // Checar se o aluno possui presença/falta fora do período oficial de matrícula
          const stu = list.find((s) => s.id === rec.studentId);
          if (stu) {
            const enrollCheck = isStudentEnrolledOnDate(stu.val, rec.date);
            const afterBim = isStudentTransferredInAfterBimester(stu.val, rec.bimester);
            if (!enrollCheck.enrolled || afterBim) {
              const inDate = stu.val.transferInDate || (stu.val.status === 'recebida' ? stu.val.transferDate : '');
              const outDate = stu.val.transferOutDate || (stu.val.status === 'expedida' ? stu.val.transferDate : '');

              let reasonText = '';
              if (!enrollCheck.enrolled) {
                reasonText = enrollCheck.reason || 'Fora do período de matrícula';
              } else if (afterBim) {
                reasonText = `Ingresso em ${formatDate(inDate)} (posterior ao encerramento do ${rec.bimester}º Bimestre)`;
              }

              detectedImproper.push({
                key: k,
                studentId: stu.id,
                studentName: stu.val.name,
                studentNumber: stu.val.number || 0,
                date: rec.date,
                bimester: String(rec.bimester),
                status: rec.status || 'P',
                reason: reasonText,
                enrollmentDate: inDate,
                transferOutDate: outDate,
                studentStatus: stu.val.status
              });
            }
          } else if (rec.studentId) {
            detectedImproper.push({
              key: k,
              studentId: rec.studentId,
              studentName: rec.studentName || `Estudante ID: ${rec.studentId}`,
              studentNumber: 0,
              date: rec.date || 'Data não informada',
              bimester: String(rec.bimester || selectedBimester),
              status: rec.status || 'P',
              reason: 'Aluno não encontrado no cadastro desta turma'
            });
          }
        }
      });

      const datesList = Object.keys(compositeDatesMap)
        .sort()
        .map((d) => ({
          date: d,
          presentCount: compositeDatesMap[d].presentCount,
          absentCount: compositeDatesMap[d].absentCount,
          totalCount: compositeDatesMap[d].presentCount + compositeDatesMap[d].absentCount
        }));
      setRecordedDates(datesList);
      setImproperRecords(detectedImproper);

      const newStates: Record<string, 'P' | 'F'> = {};
      Object.keys(attVal).forEach((k) => {
        const rec = attVal[k];
        if (
          rec.classId === selectedClassId &&
          (!rec.anoLetivo || rec.anoLetivo === currentYear) &&
          String(rec.bimester) === String(selectedBimester) &&
          rec.date === selectedDate
        ) {
          newStates[rec.studentId] = rec.status;
        }
      });

      // Padrão Presente (P) SOMENTE para alunos efetivamente matriculados nesta data e bimestre!
      // Alunos com TR REC cuja entrada seja posterior à data selecionada NÃO recebem presença!
      list.forEach((s) => {
        const enrollCheck = isStudentEnrolledOnDate(s.val, selectedDate);
        const afterBim = isStudentTransferredInAfterBimester(s.val, selectedBimester);
        const isNotEnrolled = !enrollCheck.enrolled || afterBim || s.val.status === 'expedida';

        if (isNotEnrolled) {
          delete newStates[s.id];
        } else if (!newStates[s.id]) {
          newStates[s.id] = 'P';
        }
      });

      setAttendanceState(newStates);

      const isToday = selectedDate === getTodayDateString();
      if (isToday) {
        checkBirthdays(selectedClassId, list);
      }
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Chamada',
        message: formatFriendlyError(err, 'Não foi possível carregar a lista de presença'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, [selectedClassId, selectedBimester, selectedDate, currentYear]);

  const toggleStudent = (studentId: string) => {
    setAttendanceState((prev) => ({
      ...prev,
      [studentId]: prev[studentId] === 'P' ? 'F' : 'P'
    }));
  };

  const handleSaveAttendance = async () => {
    if (!selectedClassId || !selectedBimester || !selectedDate) return;

    try {
      const updates: Record<string, any> = {};
      let count = 0;

      students.forEach((s) => {
        if (s.val.status === 'expedida') return;

        const enrollCheck = isStudentEnrolledOnDate(s.val, selectedDate);
        const afterBim = isStudentTransferredInAfterBimester(s.val, selectedBimester);
        const key = `${selectedClassId}_${selectedBimester}_${selectedDate}_${s.id}`;

        // Aluno que NÃO estava matriculado nesta data não pode ter presença nem falta salva!
        if (!enrollCheck.enrolled || afterBim) {
          // Se havia algum registro gravado indevidamente no banco, remove-o
          updates[dc(`chamada/${key}`)] = null;
          return;
        }

        const status = attendanceState[s.id] || 'P';
        updates[dc(`chamada/${key}`)] = {
          classId: selectedClassId,
          bimester: selectedBimester,
          date: selectedDate,
          studentId: s.id,
          status,
          teacher: currentTeacher,
          anoLetivo: currentYear,
          classId_bimester_date: `${selectedClassId}_${selectedBimester}_${selectedDate}`,
          classId_date: `${selectedClassId}_${selectedDate}`
        };
        count++;
      });

      await update(ref(rtdb), updates);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: `Chamada salva com sucesso! (${count} registros)`,
        icon: '✅'
      });
      loadAttendance();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Chamada',
        message: formatFriendlyError(err, 'Não foi possível salvar a chamada'),
        icon: '❌'
      });
    }
  };

  const handleDeleteAttendance = () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Chamada',
      message: `Tem certeza que deseja excluir toda a chamada do ${selectedBimester}º bimestre na data ${formatDate(selectedDate)}?`,
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          const snap = await get(ref(rtdb, dc('chamada')));
          const val = snap.val() || {};
          const updates: Record<string, any> = {};
          let deletedCount = 0;

          Object.keys(val).forEach((k) => {
            const rec = val[k];
            if (
              rec.classId === selectedClassId &&
              String(rec.bimester) === String(selectedBimester) &&
              rec.date === selectedDate &&
              (!rec.anoLetivo || rec.anoLetivo === currentYear)
            ) {
              updates[dc(`chamada/${k}`)] = null;
              deletedCount++;
            }
          });

          if (deletedCount === 0) {
            return setModal({
              isOpen: true,
              type: 'alert',
              title: 'Aviso',
              message: 'Nenhum registro de chamada encontrado para esta data!',
              icon: 'ℹ️'
            });
          }

          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Chamada excluída com sucesso!',
            icon: '✅'
          });
          loadAttendance();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Chamada',
            message: formatFriendlyError(err, 'Não foi possível excluir a chamada'),
            icon: '❌'
          });
        }
      }
    });
  };

  const handleCleanImproperRecords = () => {
    if (improperRecords.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Frequência Regularizada',
        message: 'Nenhum registro indevido encontrado! Todos os alunos com TR. REC / TR. EXP possuem chamadas perfeitamente compatíveis com suas datas oficiais.',
        icon: '✅'
      });
    }

    setShowImproperModal(true);
  };

  const handleExportDailyPDF = async () => {
    if (!selectedClassId || !selectedTurma) return;
    try {
      setGeneratingReport(true);
      await generateDailyAttendanceReport(
        selectedClassId,
        selectedBimester,
        selectedTurma,
        currentTeacher,
        currentYear
      );
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar Relatório',
        message: formatFriendlyError(err, 'Não foi possível exportar o Mapa Dia a Dia'),
        icon: '❌'
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleExportDailyExcel = async () => {
    if (!selectedClassId || !selectedTurma) return;
    try {
      setGeneratingReport(true);
      await generateDailyAttendanceReportXLSX(
        selectedClassId,
        selectedBimester,
        selectedTurma,
        currentYear,
        currentTeacher
      );
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar Planilha',
        message: formatFriendlyError(err, 'Não foi possível exportar a planilha'),
        icon: '❌'
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleCheckOrphans = async () => {
    try {
      const snap = await get(ref(rtdb, dc('chamada')));
      const val = snap.val() || {};
      const orphans: Record<string, string[]> = {};
      let total = 0;

      Object.keys(val).forEach((k) => {
        const c = val[k];
        if (c) {
          const noBimester = !c.bimester || String(c.bimester).trim() === '';
          const noYear = !c.anoLetivo || String(c.anoLetivo).trim() === '';
          if (noBimester || noYear) {
            const cId = c.classId || 'sem_turma';
            if (!orphans[cId]) orphans[cId] = [];
            orphans[cId].push(k);
            total++;
          }
        }
      });

      if (total === 0) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Tudo Limpo',
          message: 'Nenhum registro de chamada incompleto encontrado!',
          icon: '✅'
        });
      }

      setModal({
        isOpen: true,
        type: 'custom',
        title: '🧹 Limpeza de Chamadas Incompletas',
        icon: '🧹',
        children: (
          <div className="text-left space-y-3">
            <p className="text-xs text-slate-600">
              Foram encontrados <strong>{total}</strong> registros de chamada sem bimestre ou sem ano letivo.
            </p>
            <div className="max-h-48 overflow-y-auto space-y-2 border border-slate-200 rounded-lg p-2 bg-slate-50">
              {Object.keys(orphans).map((cId) => {
                const turma = classes.find((c) => c.id === cId)?.val;
                const name = turma ? `${turma.year}º ${turma.letter}` : 'Turma Não Identificada';
                return (
                  <div key={cId} className="flex justify-between items-center bg-white p-2 rounded border text-xs">
                    <div>
                      <strong className="text-slate-800">{name}</strong>
                      <span className="text-rose-600 block">{orphans[cId].length} registros</span>
                    </div>
                    <button
                      onClick={async () => {
                        const updates: Record<string, any> = {};
                        orphans[cId].forEach((k) => (updates[dc(`chamada/${k}`)] = null));
                        await update(ref(rtdb), updates);
                        loadAttendance();
                        setModal({ isOpen: false });
                      }}
                      className="px-2.5 py-1 text-xs bg-rose-600 text-white rounded font-medium"
                    >
                      Excluir Desta Turma
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={async () => {
                const updates: Record<string, any> = {};
                Object.keys(orphans).forEach((cId) => {
                  orphans[cId].forEach((k) => (updates[dc(`chamada/${k}`)] = null));
                });
                await update(ref(rtdb), updates);
                loadAttendance();
                setModal({
                  isOpen: true,
                  type: 'alert',
                  title: 'Concluído',
                  message: 'Todos os registros incompletos foram removidos!',
                  icon: '✅'
                });
              }}
              className="w-full py-2 bg-rose-600 text-white text-xs font-bold rounded-lg mt-2"
            >
              Excluir Todos ({total})
            </button>
          </div>
        )
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Verificação',
        message: formatFriendlyError(err, 'Não foi possível verificar os registros de chamada'),
        icon: '❌'
      });
    }
  };

  const selectedTurma = classes.find((c) => c.id === selectedClassId)?.val;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-indigo-600" />
            Chamada Online
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Controle diário de presença e faltas com cálculo automático de frequência
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="attendance-check-orphans-btn"
            onClick={handleCheckOrphans}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Verificar Incompletos</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Turma *
            </label>
            <select
              id="attendance-class-select"
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
              Bimestre *
            </label>
            <select
              id="attendance-bimester-select"
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Data da Chamada *
            </label>
            <input
              id="attendance-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            />
          </div>
        </div>

        {selectedTurma && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 gap-2">
            <div>
              <strong className="text-slate-900">{selectedTurma.schoolName.toUpperCase()}</strong> |{' '}
              {selectedTurma.year}º ANO {selectedTurma.letter.toUpperCase()} ({selectedTurma.shift}) —{' '}
              <span className="font-semibold text-indigo-700">{selectedBimester}º BIMESTRE</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-semibold text-[#1b4332]">
                <span className="w-3.5 h-3.5 rounded-full bg-[#1b4332] inline-block shadow-xs"></span> Presente (P)
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-rose-700">
                <span className="w-3.5 h-3.5 rounded-full bg-rose-700 inline-block shadow-xs"></span> Ausente (A)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Barra de Localização e Histórico de Chamadas Dia a Dia */}
      {selectedClassId && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 flex-wrap">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Chamadas Realizadas no {selectedBimester}º Bimestre ({recordedDates.length} {recordedDates.length === 1 ? 'dia' : 'dias'} com chamada)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Clique em qualquer data para abrir e consultar o diário daquele dia, ou exporte o mapa consolidado
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {improperRecords.length > 0 && (
                <button
                  type="button"
                  id="attendance-clean-improper-btn"
                  onClick={handleCleanImproperRecords}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-300 transition-colors shadow-2xs animate-pulse cursor-pointer"
                  title="Detectados registros de presença gravados para alunos antes da sua data de matrícula/reingresso ou após saída. Clique para ver a lista detalhada e excluir."
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Regularizar Presenças TR. REC ({improperRecords.length})</span>
                </button>
              )}

              <button
                type="button"
                id="attendance-export-daily-pdf-btn"
                disabled={generatingReport || recordedDates.length === 0}
                onClick={handleExportDailyPDF}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-200 transition-colors disabled:opacity-50"
                title="Exportar mapa de frequência diária com todas as colunas de datas em formato paisagem"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Mapa Dia a Dia (PDF)</span>
              </button>

              <button
                type="button"
                id="attendance-export-daily-excel-btn"
                disabled={generatingReport || recordedDates.length === 0}
                onClick={handleExportDailyExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-200 transition-colors disabled:opacity-50"
                title="Exportar planilha Excel com grade diária completa do bimestre"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Planilha Excel</span>
              </button>
            </div>
          </div>

          {recordedDates.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400">
              Nenhuma chamada registrada no {selectedBimester}º bimestre para esta turma até o momento.
            </div>
          ) : (
            <div className="pt-3">
              <span className="text-[11px] font-semibold text-slate-600 block mb-2">
                Navegar pelas datas registradas (clique para carregar):
              </span>
              <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {recordedDates.map((item) => {
                  const isSelected = item.date === selectedDate;
                  const parts = item.date.split('-');
                  const displayDate = `${parts[2]}/${parts[1]}`;

                  return (
                    <button
                      key={item.date}
                      type="button"
                      onClick={() => setSelectedDate(item.date)}
                      className={`shrink-0 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all inline-flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-2 ring-indigo-300'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:border-indigo-300'
                      }`}
                      title={`${formatDate(item.date)}: ${item.presentCount} presentes, ${item.absentCount} ausentes`}
                    >
                      <Calendar className="w-3 h-3" />
                      <span>{displayDate}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          isSelected
                            ? 'bg-indigo-700 text-indigo-100'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {item.presentCount}P / {item.absentCount}F
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden mb-6">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-bold text-slate-800">
              Lista de Alunos ({students.length})
            </span>
            {students.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  id="attendance-all-present-btn"
                  onClick={() => {
                    const nextState: Record<string, 'P' | 'F'> = {};
                    students.forEach((s) => {
                      const enrollCheck = isStudentEnrolledOnDate(s.val, selectedDate);
                      const afterBim = isStudentTransferredInAfterBimester(s.val, selectedBimester);
                      if (s.val.status !== 'expedida' && enrollCheck.enrolled && !afterBim) {
                        nextState[s.id] = 'P';
                      }
                    });
                    setAttendanceState(nextState);
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
                  title="Marcar todos os alunos matriculados como Presentes"
                >
                  Todos Presentes (P)
                </button>
                <button
                  type="button"
                  id="attendance-all-absent-btn"
                  onClick={() => {
                    const nextState: Record<string, 'P' | 'F'> = {};
                    students.forEach((s) => {
                      const enrollCheck = isStudentEnrolledOnDate(s.val, selectedDate);
                      const afterBim = isStudentTransferredInAfterBimester(s.val, selectedBimester);
                      if (s.val.status !== 'expedida' && enrollCheck.enrolled && !afterBim) {
                        nextState[s.id] = 'F';
                      }
                    });
                    setAttendanceState(nextState);
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
                  title="Marcar todos os alunos matriculados como Ausentes"
                >
                  Todos Ausentes (A)
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              id="attendance-delete-btn"
              onClick={handleDeleteAttendance}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Excluir Chamada</span>
            </button>
            <button
              id="attendance-save-btn"
              onClick={handleSaveAttendance}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>Salvar Chamada</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Carregando lista de chamada...</div>
        ) : students.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Selecione uma turma para realizar a chamada.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
            {students.map((item) => {
              const student = item.val;
              const isExpedido = student.status === 'expedida';
              const enrollCheck = isStudentEnrolledOnDate(student, selectedDate);
              const afterBim = isStudentTransferredInAfterBimester(student, selectedBimester);
              const isNotEnrolledOnDate = !enrollCheck.enrolled || afterBim;
              const isPresent = attendanceState[item.id] === 'P';

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between px-4 sm:px-6 py-3.5 transition-colors ${
                    isExpedido || isNotEnrolledOnDate ? 'bg-slate-50/60 opacity-75' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-4">
                    <span className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
                      {student.number}
                    </span>
                    <div className="truncate">
                      <h4 className="text-sm font-medium text-slate-800 truncate">
                        {student.name}
                      </h4>
                      {isExpedido ? (
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[10px] uppercase font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100 inline-block">
                            Transferência Expedida {student.transferOutDate || student.transferDate ? `(${formatDate(student.transferOutDate || student.transferDate)})` : ''}
                          </span>
                        </div>
                      ) : isNotEnrolledOnDate ? (
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[10px] uppercase font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                            Não Matriculado nesta data ({enrollCheck.reason || `Entrada no ${student.transferInDate ? formatDate(student.transferInDate) : 'bimestre posterior'}`})
                          </span>
                        </div>
                      ) : student.status === 'recebida' ? (
                        <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100 inline-block mt-0.5">
                          Transferência Recebida {student.transferInDate || student.transferDate ? `(${formatDate(student.transferInDate || student.transferDate)})` : ''}
                        </span>
                      ) : student.transferInDate ? (
                        <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100 inline-block mt-0.5">
                          TR. REC. ({formatDate(student.transferInDate)})
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center">
                    {isExpedido ? (
                      <span className="text-xs text-slate-400 italic">Não aplicável (TR. EXP)</span>
                    ) : isNotEnrolledOnDate ? (
                      <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 inline-flex items-center gap-1">
                        Sem Frequência (Fora do Período)
                      </span>
                    ) : (
                      <button
                        id={`attendance-toggle-${item.id}`}
                        type="button"
                        role="switch"
                        aria-checked={isPresent}
                        onClick={() => toggleStudent(item.id)}
                        className={`relative inline-flex items-center h-7 w-14 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-600 select-none ${
                          isPresent
                            ? 'bg-[#1b4332] hover:bg-[#143326]'
                            : 'bg-rose-700 hover:bg-rose-800'
                        }`}
                        title={isPresent ? 'Presente (clique para marcar Falta)' : 'Ausente (clique para marcar Presença)'}
                      >
                        {/* Indicador P interno à esquerda quando ligado */}
                        <span
                          className={`absolute left-2 text-[11px] font-bold text-white tracking-wider pointer-events-none transition-opacity duration-150 ${
                            isPresent ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          P
                        </span>
                        {/* Indicador A interno à direita quando desligado */}
                        <span
                          className={`absolute right-2 text-[11px] font-bold text-white tracking-wider pointer-events-none transition-opacity duration-150 ${
                            !isPresent ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          A
                        </span>
                        {/* Botão circular branco deslizante */}
                        <span
                          className={`inline-block w-5 h-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out pointer-events-none ${
                            isPresent ? 'translate-x-8' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ImproperAttendanceModal
        isOpen={showImproperModal}
        onClose={() => setShowImproperModal(false)}
        records={improperRecords}
        className={
          selectedTurma
            ? `${selectedTurma.year}º ANO ${selectedTurma.letter.toUpperCase()} (${selectedTurma.shift})`
            : 'Turma'
        }
        currentYear={currentYear}
        onRefresh={loadAttendance}
        onNavigateToDate={(date, bimester) => {
          if (bimester) setSelectedBimester(bimester);
          if (date) setSelectedDate(date);
        }}
        setModal={setModal}
      />
    </div>
  );
};
