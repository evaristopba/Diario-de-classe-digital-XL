import React, { useState, useEffect } from 'react';
import { Student, ClassRoom, School, ModalConfig } from '../types';
import {
  get,
  ref,
  push,
  update,
  rtdb,
  dc,
  carregarMinhasTurmas,
  verificarIsAdmin
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import {
  ArrowRightLeft,
  GraduationCap,
  Building2,
  Users,
  Calendar,
  Hash,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  X,
  BookOpen
} from 'lucide-react';

interface TransferStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentYear: string;
  initialStudent?: { id: string; classId: string; val: Student } | null;
  onSuccess: () => void;
  setModal: (config: ModalConfig) => void;
}

export const TransferStudentModal: React.FC<TransferStudentModalProps> = ({
  isOpen,
  onClose,
  currentYear,
  initialStudent,
  onSuccess,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [schools, setSchools] = useState<School[]>([]);

  // Origem
  const [sourceClassId, setSourceClassId] = useState('');
  const [studentsInSource, setStudentsInSource] = useState<{ id: string; val: Student }[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedStudentData, setSelectedStudentData] = useState<Student | null>(null);

  // Destino
  const [destSchoolId, setDestSchoolId] = useState('');
  const [destClassId, setDestClassId] = useState('');
  const [destCallNumber, setDestCallNumber] = useState<number | ''>('');
  
  // Opções
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [copyGrades, setCopyGrades] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);

  // Carrega turmas e escolas
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoadingInitial(true);
      try {
        // Carrega turmas
        const turmasList = await carregarMinhasTurmas();
        const filteredTurmas = turmasList.filter(
          (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
        );
        setClasses(filteredTurmas);

        // Carrega escolas compartilhadas de diario-classe/escolas
        const escolasMap: Record<string, School> = {};
        try {
          const escolasSnap = await get(ref(rtdb, 'diario-classe/escolas'));
          if (escolasSnap.exists()) {
            const escolasVal = (escolasSnap.val() || {}) as Record<string, School>;
            Object.keys(escolasVal).forEach((k) => {
              escolasMap[k] = { id: k, ...escolasVal[k] };
            });
          }
        } catch (e) {
          console.error('Erro ao ler diario-classe/escolas:', e);
        }

        // Garante que todas as escolas das turmas existentes também estejam na lista
        filteredTurmas.forEach((t) => {
          if (t.val.schoolId && !escolasMap[t.val.schoolId]) {
            escolasMap[t.val.schoolId] = {
              id: t.val.schoolId,
              name: t.val.schoolName || 'Escola'
            };
          } else if (t.val.schoolId && escolasMap[t.val.schoolId] && !escolasMap[t.val.schoolId].name && t.val.schoolName) {
            escolasMap[t.val.schoolId].name = t.val.schoolName;
          }
        });

        const listEscolas = Object.values(escolasMap);
        listEscolas.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setSchools(listEscolas);

        // Se veio com aluno pré-selecionado
        if (initialStudent) {
          setSourceClassId(initialStudent.classId);
          setSelectedStudentId(initialStudent.id);
          setSelectedStudentData(initialStudent.val);

          // Pré-seleciona escola de destino com a mesma da turma de origem
          const currentClass = filteredTurmas.find((c) => c.id === initialStudent.classId)?.val;
          if (currentClass?.schoolId) {
            setDestSchoolId(currentClass.schoolId);
          }

          // Pré-seleciona a primeira turma de destino viável
          const firstViableDest = filteredTurmas.find((c) => c.id !== initialStudent.classId);
          if (firstViableDest) {
            setDestClassId(firstViableDest.id);
          }
        } else if (filteredTurmas.length > 0) {
          setSourceClassId(filteredTurmas[0].id);
          const firstViableDest = filteredTurmas.find((c) => c.id !== filteredTurmas[0].id);
          if (firstViableDest) {
            setDestClassId(firstViableDest.id);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar dados para transferência:', err);
      } finally {
        setLoadingInitial(false);
      }
    };

    loadData();
  }, [isOpen, currentYear, initialStudent]);

  // Carrega alunos da turma de origem quando a turma de origem mudar
  useEffect(() => {
    if (!sourceClassId) {
      setStudentsInSource([]);
      return;
    }

    const loadSourceStudents = async () => {
      try {
        const snap = await get(ref(rtdb, `diario-classe/turmas/${sourceClassId}/alunos`));
        const val = (snap.val() || {}) as Record<string, Student>;
        const list: { id: string; val: Student }[] = [];
        Object.keys(val).forEach((k) => {
          const s = val[k];
          if (!s.anoLetivo || s.anoLetivo === currentYear) {
            list.push({ id: k, val: s });
          }
        });
        list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
        setStudentsInSource(list);

        // Se o aluno selecionado não estiver na nova turma de origem, seleciona o primeiro
        if (initialStudent && initialStudent.classId === sourceClassId) {
          setSelectedStudentId(initialStudent.id);
          setSelectedStudentData(initialStudent.val);
        } else if (list.length > 0) {
          setSelectedStudentId(list[0].id);
          setSelectedStudentData(list[0].val);
        } else {
          setSelectedStudentId('');
          setSelectedStudentData(null);
        }
      } catch (err) {
        console.error('Erro ao carregar alunos da turma de origem:', err);
      }
    };

    loadSourceStudents();
  }, [sourceClassId, currentYear]);

  // Atualiza dados do aluno quando o ID muda
  const handleStudentSelect = (studentId: string) => {
    setSelectedStudentId(studentId);
    const found = studentsInSource.find((s) => s.id === studentId);
    setSelectedStudentData(found ? found.val : null);
  };

  // Calcula próximo número de chamada quando a turma de destino mudar
  useEffect(() => {
    if (!destClassId) {
      setDestCallNumber('');
      return;
    }

    const calcNextNumber = async () => {
      try {
        const snap = await get(ref(rtdb, `diario-classe/turmas/${destClassId}/alunos`));
        let maxNum = 0;
        let count = 0;
        const val = (snap.val() || {}) as Record<string, Student>;
        Object.keys(val).forEach((k) => {
          const s = val[k];
          if (!s.anoLetivo || s.anoLetivo === currentYear) {
            count++;
            const n = typeof s.number === 'number' ? s.number : parseInt(String(s.number), 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        });
        const next = maxNum > 0 ? maxNum + 1 : count + 1;
        setDestCallNumber(next);
      } catch (err) {
        console.error('Erro ao calcular número de chamada de destino:', err);
      }
    };

    calcNextNumber();
  }, [destClassId, currentYear]);

  // Filtra turmas de destino (mesma escola ou escola selecionada, excluindo a de origem)
  const availableDestClasses = classes.filter((c) => {
    if (c.id === sourceClassId) return false;
    if (destSchoolId && c.val.schoolId && c.val.schoolId !== destSchoolId) return false;
    return true;
  });

  const sourceTurma = classes.find((c) => c.id === sourceClassId)?.val;
  const destTurma = classes.find((c) => c.id === destClassId)?.val;

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedStudentId || !selectedStudentData) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Selecione o aluno que será transferido!',
        icon: '⚠️'
      });
    }

    if (!destClassId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Selecione a turma de destino do aluno!',
        icon: '⚠️'
      });
    }

    if (destClassId === sourceClassId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'A turma de destino deve ser diferente da turma de origem!',
        icon: '⚠️'
      });
    }

    if (!transferDate) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe a data oficial da transferência!',
        icon: '⚠️'
      });
    }

    if (destCallNumber === '' || Number(destCallNumber) < 1) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe um número de chamada válido para a turma de destino!',
        icon: '⚠️'
      });
    }

    setIsProcessing(true);

    try {
      const isAdmin = await verificarIsAdmin();
      if (!isAdmin) {
        setIsProcessing(false);
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Acesso Restrito',
          message: '⛔ Apenas Administradores e a Secretaria Escolar têm permissão para realizar transferências de alunos.',
          icon: '⛔'
        });
      }

      const updatesPayload: Record<string, any> = {};
      const now = Date.now();

      // 1. Atualiza Aluno na Turma de Origem -> status "expedida"
      updatesPayload[`diario-classe/turmas/${sourceClassId}/alunos/${selectedStudentId}/status`] = 'expedida';
      updatesPayload[`diario-classe/turmas/${sourceClassId}/alunos/${selectedStudentId}/transferDate`] = transferDate;
      updatesPayload[`diario-classe/turmas/${sourceClassId}/alunos/${selectedStudentId}/updatedAt`] = now;

      // 2. Cria novo registro do Aluno na Turma de Destino -> status "recebida"
      const newStudentKey = push(ref(rtdb, `diario-classe/turmas/${destClassId}/alunos`)).key;
      if (!newStudentKey) throw new Error('Não foi possível gerar a chave para o novo registro.');

      const newStudentData: Student = {
        classId: destClassId,
        number: Number(destCallNumber),
        name: selectedStudentData.name.trim(),
        ra: selectedStudentData.ra.trim(),
        rm: selectedStudentData.rm?.trim() || '',
        birthdate: selectedStudentData.birthdate,
        status: 'recebida',
        transferDate: transferDate,
        anoLetivo: selectedStudentData.anoLetivo || currentYear,
        createdAt: now,
        updatedAt: now
      };

      updatesPayload[`diario-classe/turmas/${destClassId}/alunos/${newStudentKey}`] = newStudentData;

      // 3. Se solicitado, copia notas bimestrais dos bimestres anteriores
      let notasCopiadasCount = 0;
      if (copyGrades) {
        const notasSnap = await get(ref(rtdb, dc('notas')));
        if (notasSnap.exists()) {
          const notasVal = notasSnap.val() || {};
          Object.keys(notasVal).forEach((key) => {
            const g = notasVal[key];
            if (
              g &&
              g.classId === sourceClassId &&
              g.studentId === selectedStudentId &&
              (!g.anoLetivo || g.anoLetivo === currentYear)
            ) {
              const subject = g.subject || 'portugues';
              const bimester = g.bimester;
              const newGradeKey = `${destClassId}_${bimester}_${subject}_${newStudentKey}`;
              updatesPayload[dc(`notas/${newGradeKey}`)] = {
                classId: destClassId,
                studentId: newStudentKey,
                bimester: String(bimester),
                subject: subject,
                value: Number(g.value),
                teacher: g.teacher || 'Transferência Escolar',
                anoLetivo: g.anoLetivo || currentYear,
                createdAt: now
              };
              notasCopiadasCount++;
            }
          });
        }
      }

      // Executa todas as atualizações de forma atômica
      await update(ref(rtdb), updatesPayload);

      // Fecha modal e notifica
      onClose();
      onSuccess();

      const sourceDesc = sourceTurma ? `${sourceTurma.year}º ${sourceTurma.letter} (${sourceTurma.shift})` : 'Turma de Origem';
      const destDesc = destTurma ? `${destTurma.year}º ${destTurma.letter} (${destTurma.shift})` : 'Turma de Destino';

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Transferência Concluída com Sucesso! 🎓',
        icon: '✅',
        message: `O aluno ${selectedStudentData.name} foi transferido com sucesso!\n\n• Origem: ${sourceDesc} → Marcado como Transferência Expedida (${formatDate(transferDate)})\n• Destino: ${destDesc} → Ingressou como Nº ${destCallNumber} (Transferência Recebida)\n• Histórico: ${notasCopiadasCount > 0 ? `${notasCopiadasCount} nota(s) bimestral(is) replicada(s).` : 'Sem notas para replicar.'}`
      });
    } catch (err: any) {
      console.error('Erro ao executar transferência:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Transferência',
        message: formatFriendlyError(err, 'Não foi possível processar a transferência do aluno.'),
        icon: '❌'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="transfer-student-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        id="transfer-student-modal-card"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 transition-all"
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-purple-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shadow-inner">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Transferência de Aluno</h3>
              <p className="text-xs text-indigo-100">
                Processamento administrativo automatizado com preservação de histórico
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {loadingInitial ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            Carregando dados escolares...
          </div>
        ) : (
          <form onSubmit={handleExecuteTransfer} className="p-6 space-y-6">
            {/* ETAPA 1: ORIGEM */}
            <div className="bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-slate-200/80 space-y-3">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs sm:text-sm uppercase tracking-wider">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center text-xs">
                  1
                </span>
                <span>Aluno e Turma de Origem</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Turma de Origem *
                  </label>
                  <select
                    id="transfer-source-class"
                    value={sourceClassId}
                    onChange={(e) => setSourceClassId(e.target.value)}
                    disabled={isProcessing}
                    className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    required
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
                    Aluno a Transferir *
                  </label>
                  <select
                    id="transfer-source-student"
                    value={selectedStudentId}
                    onChange={(e) => handleStudentSelect(e.target.value)}
                    disabled={isProcessing || studentsInSource.length === 0}
                    className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                    required
                  >
                    <option value="">
                      {studentsInSource.length === 0 ? 'Nenhum aluno nesta turma' : 'Selecione o Aluno'}
                    </option>
                    {studentsInSource.map((s) => (
                      <option key={s.id} value={s.id}>
                        Nº {s.val.number} - {s.val.name} ({s.val.status === 'expedida' ? 'Já Expedido' : s.val.status === 'recebida' ? 'Tr. Recebida' : 'Ativo'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedStudentData && (
                <div className="bg-white p-3 rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="font-bold text-slate-800">{selectedStudentData.name}</span>
                      <span className="text-slate-500 ml-2">RA: {selectedStudentData.ra}</span>
                      {selectedStudentData.birthdate && (
                        <span className="text-slate-500 ml-2">| Nasc: {formatDate(selectedStudentData.birthdate)}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    {selectedStudentData.status === 'ativo' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Ativo
                      </span>
                    )}
                    {selectedStudentData.status === 'recebida' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        Tr. Recebida
                      </span>
                    )}
                    {selectedStudentData.status === 'expedida' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                        Tr. Expedida
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ETAPA 2: DESTINO */}
            <div className="bg-indigo-50/40 rounded-2xl p-4 sm:p-5 border border-indigo-100 space-y-3">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs sm:text-sm uppercase tracking-wider">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white inline-flex items-center justify-center text-xs">
                  2
                </span>
                <span>Escola e Turma de Destino</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Escola de Destino
                  </label>
                  <select
                    id="transfer-dest-school"
                    value={destSchoolId}
                    onChange={(e) => {
                      const newSchoolId = e.target.value;
                      setDestSchoolId(newSchoolId);
                      const matching = classes.filter(
                        (c) => c.id !== sourceClassId && (!newSchoolId || c.val.schoolId === newSchoolId)
                      );
                      if (matching.length > 0) {
                        setDestClassId(matching[0].id);
                      } else {
                        setDestClassId('');
                      }
                    }}
                    disabled={isProcessing}
                    className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  >
                    <option value="">Todas as Escolas</option>
                    {schools.map((sch) => (
                      <option key={sch.id || sch.name} value={sch.id || ''}>
                        {sch.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Turma de Destino *
                  </label>
                  <select
                    id="transfer-dest-class"
                    value={destClassId}
                    onChange={(e) => setDestClassId(e.target.value)}
                    disabled={isProcessing}
                    className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold text-indigo-900"
                    required
                  >
                    <option value="">
                      {availableDestClasses.length === 0
                        ? 'Nenhuma turma disponível nesta escola'
                        : 'Selecione a Turma de Destino'}
                    </option>
                    {availableDestClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.val.year}º {c.val.letter} — {c.val.shift} ({c.val.schoolName})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ETAPA 3: PARÂMETROS DA TRANSFERÊNCIA */}
            <div className="bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs sm:text-sm uppercase tracking-wider">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 inline-flex items-center justify-center text-xs">
                  3
                </span>
                <span>Configurações & Histórico</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Data Oficial da Transferência *
                  </label>
                  <div className="relative">
                    <input
                      id="transfer-date-input"
                      type="date"
                      value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                      disabled={isProcessing}
                      className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Número de Chamada no Destino *
                  </label>
                  <input
                    id="transfer-dest-number"
                    type="number"
                    min="1"
                    value={destCallNumber}
                    onChange={(e) => setDestCallNumber(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    disabled={isProcessing}
                    placeholder="Ex: 28"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-indigo-700"
                    required
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Calculado automaticamente como o próximo número vago.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    id="transfer-copy-grades-checkbox"
                    type="checkbox"
                    checked={copyGrades}
                    onChange={(e) => setCopyGrades(e.target.checked)}
                    disabled={isProcessing}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                  />
                  <span className="text-xs text-slate-700">
                    <strong>Replicar notas dos bimestres anteriores</strong>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Copia automaticamente as avaliações já lançadas na origem para a nova turma de destino.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* PREVIEW DO RESUMO ANTES DE CONFIRMAR */}
            {selectedStudentData && destTurma && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-4 rounded-2xl text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Resumo da Operação Automatizada</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                  <div className="bg-white/70 p-2.5 rounded-lg border border-amber-100">
                    <span className="font-semibold text-rose-700">Origem:</span> {sourceTurma ? `${sourceTurma.year}º ${sourceTurma.letter}` : ''}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Status passará para <strong className="text-rose-700">Transferência Expedida (Saída)</strong>
                    </p>
                  </div>
                  <div className="bg-white/70 p-2.5 rounded-lg border border-amber-100">
                    <span className="font-semibold text-indigo-700">Destino:</span> {destTurma.year}º {destTurma.letter} (Nº {destCallNumber})
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Status passará para <strong className="text-indigo-700">Transferência Recebida (Entrada)</strong>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                id="transfer-cancel-btn"
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                id="transfer-confirm-btn"
                type="submit"
                disabled={isProcessing || !selectedStudentId || !destClassId}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-md transition-colors"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Transferência...</span>
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    <span>Confirmar Transferência</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
