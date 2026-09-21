import React, { useState, useEffect } from 'react';
import { Student, ClassRoom, ModalConfig } from '../types';
import {
  get,
  ref,
  push,
  update,
  remove,
  set,
  rtdb,
  carregarMinhasTurmas,
  alunosDasMinhasTurmas,
  verificarIsAdmin
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkStudentDeleteIntegrity } from '../lib/referentialIntegrity';
import { formatDate } from '../lib/reports';
import { UserCheck, Plus, Edit2, Trash2, Download, Upload, X, Filter, ArrowRightLeft } from 'lucide-react';
import { TransferStudentModal } from './TransferStudentModal';

interface StudentsScreenProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  initialClassId?: string;
}

export const StudentsScreen: React.FC<StudentsScreenProps> = ({ currentYear, setModal, initialClassId }) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId || '');
  const [filterClassId, setFilterClassId] = useState(initialClassId || '');
  const [students, setStudents] = useState<{ id: string; classId: string; val: Student }[]>([]);

  const [number, setNumber] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [ra, setRa] = useState('');
  const [rm, setRm] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [status, setStatus] = useState<'ativo' | 'recebida' | 'expedida'>('ativo');
  const [transferDate, setTransferDate] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalClassId, setEditingOriginalClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Estado para Transferência de Aluno
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [studentToTransfer, setStudentToTransfer] = useState<{ id: string; classId: string; val: Student } | null>(null);

  const loadClasses = async () => {
    try {
      const results = await carregarMinhasTurmas();
      const filtered = results.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
      const targetClassId = initialClassId || selectedClassId || (filtered.length > 0 ? filtered[0].id : '');
      if (targetClassId) {
        setSelectedClassId(targetClassId);
        if (initialClassId) {
          setFilterClassId(initialClassId);
        }
        calculateNextNumber(targetClassId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const calculateNextNumber = async (classId: string) => {
    if (!classId) return;
    try {
      const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
      let maxNum = 0;
      let count = 0;
      const val = snap.val() || {};
      Object.keys(val).forEach((k) => {
        const s = val[k];
        if (!s.anoLetivo || s.anoLetivo === currentYear) {
          count++;
          const n = parseInt(s.number);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      });
      const next = maxNum > 0 ? maxNum + 1 : count + 1;
      setNumber(next);
    } catch (err) {
      console.error(err);
    }
  };

  const loadStudents = async () => {
    try {
      setLoading(true);
      const list = await alunosDasMinhasTurmas(filterClassId || null);
      list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
      const filtered = list.filter((s) => !s.val.anoLetivo || s.val.anoLetivo === currentYear);
      setStudents(filtered);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Alunos',
        message: formatFriendlyError(err, 'Não foi possível carregar a lista de alunos'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, [currentYear]);

  useEffect(() => {
    loadStudents();
  }, [filterClassId, currentYear]);

  const handleClassChange = (newClassId: string) => {
    setSelectedClassId(newClassId);
    if (!editingId) {
      calculateNextNumber(newClassId);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || number === '' || !name.trim() || !ra.trim() || !birthdate) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos obrigatórios (Turma, Nº, Nome, RA e Data de Nascimento)!',
        icon: '⚠️'
      });
    }

    if ((status === 'recebida' || status === 'expedida') && !transferDate) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe a data da transferência!',
        icon: '⚠️'
      });
    }

    const data: any = {
      classId: selectedClassId,
      number: Number(number),
      name: name.trim(),
      ra: ra.trim(),
      rm: rm.trim() || '',
      birthdate,
      status,
      anoLetivo: currentYear
    };

    if (status === 'recebida' || status === 'expedida') {
      data.transferDate = transferDate;
    }

    try {
      if (editingId) {
        data.updatedAt = Date.now();
        if (editingOriginalClassId && editingOriginalClassId !== selectedClassId) {
          await set(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos/${editingId}`), data);
          await remove(ref(rtdb, `diario-classe/turmas/${editingOriginalClassId}/alunos/${editingId}`));
        } else {
          await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos/${editingId}`), data);
        }
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Aluno atualizado com sucesso!',
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        await push(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Aluno adicionado com sucesso!',
          icon: '✅'
        });
      }

      setName('');
      setRa('');
      setRm('');
      setBirthdate('');
      setStatus('ativo');
      setTransferDate('');
      setEditingId(null);
      setEditingOriginalClassId(null);
      calculateNextNumber(selectedClassId);
      loadStudents();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Aluno',
        message: formatFriendlyError(err, 'Não foi possível salvar os dados do aluno'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (item: { id: string; classId: string; val: Student }) => {
    setSelectedClassId(item.classId);
    setEditingOriginalClassId(item.classId);
    setNumber(item.val.number);
    setName(item.val.name);
    setRa(item.val.ra);
    setRm(item.val.rm || '');
    setBirthdate(item.val.birthdate);
    setStatus(item.val.status || 'ativo');
    setTransferDate(item.val.transferDate || '');
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setName('');
    setRa('');
    setRm('');
    setBirthdate('');
    setStatus('ativo');
    setTransferDate('');
    setEditingId(null);
    setEditingOriginalClassId(null);
    calculateNextNumber(selectedClassId);
  };

  const handleDelete = async (classId: string, id: string, studentName?: string) => {
    // 1. Validar Integridade Referencial: não excluir se o aluno tiver notas, faltas ou ocorrências
    const integrity = await checkStudentDeleteIntegrity(classId, id);
    if (!integrity.canDelete) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exclusão Bloqueada',
        message: `⛔ ${integrity.reason}`,
        icon: '⛔'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: `Tem certeza que deseja excluir o cadastro do(a) aluno(a) ${studentName ? `"${studentName}"` : ''}? Como este aluno não possui notas nem faltas registradas, ele pode ser removido.`,
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, `diario-classe/turmas/${classId}/alunos/${id}`));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Aluno excluído com sucesso!',
            icon: '✅'
          });
          loadStudents();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Aluno',
            message: formatFriendlyError(err, 'Não foi possível excluir o aluno'),
            icon: '❌'
          });
        }
      }
    });
  };

  const exportStudentsJSON = async () => {
    try {
      const list = await alunosDasMinhasTurmas(filterClassId || null);
      if (list.length === 0) return;
      const data: Record<string, Student> = {};
      list.forEach((s) => (data[s.id] = s.val));

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alunos_${currentYear}_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Exportação',
        message: formatFriendlyError(err, 'Não foi possível exportar os alunos'),
        icon: '❌'
      });
    }
  };

  const importStudentsJSON = () => {
    if (!isAdmin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para importar dados no sistema.',
        icon: '⛔'
      });
    }

    if (!selectedClassId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Selecione uma turma no formulário para importar os alunos para ela!',
        icon: '⚠️'
      });
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event: any) => {
        try {
          const data = JSON.parse(event.target.result);
          const updates: Record<string, any> = {};
          Object.keys(data).forEach((key) => {
            const student = { ...data[key], classId: selectedClassId, anoLetivo: currentYear };
            updates[`diario-classe/turmas/${selectedClassId}/alunos/${key}`] = student;
          });
          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Alunos importados com sucesso!',
            icon: '✅'
          });
          loadStudents();
        } catch {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro',
            message: 'Arquivo JSON inválido!',
            icon: '❌'
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-indigo-600" />
            Alunos
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Cadastro de estudantes, controle de número de chamada, transferências e histórico
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button
              id="transfer-student-btn"
              onClick={() => {
                setStudentToTransfer(null);
                setIsTransferModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors"
              title="Assistente de Transferência Administrativa"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transferir Aluno</span>
            </button>
          )}
          <button
            id="export-students-btn"
            onClick={exportStudentsJSON}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar JSON</span>
          </button>
          {isAdmin && (
            <button
              id="import-students-btn"
              onClick={importStudentsJSON}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar JSON</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Aluno' : 'Novo Aluno'}
          </h3>
          {editingId && (
            <button
              onClick={handleCancelEdit}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md"
            >
              <X className="w-3 h-3" /> Cancelar Edição
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Turma de Destino *
              </label>
              <select
                id="student-class-select"
                value={selectedClassId}
                onChange={(e) => handleClassChange(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
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
                Número da Chamada *
              </label>
              <input
                id="student-number-input"
                type="number"
                min="1"
                value={number}
                onChange={(e) => setNumber(e.target.value === '' ? '' : parseInt(e.target.value))}
                placeholder="Ex: 1"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data de Nascimento *
              </label>
              <input
                id="student-birthdate-input"
                type="date"
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome Completo do Aluno *
              </label>
              <input
                id="student-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Maria Eduarda Silva"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                RA (Registro do Aluno) *
              </label>
              <input
                id="student-ra-input"
                type="text"
                value={ra}
                onChange={(e) => setRa(e.target.value)}
                placeholder="Ex: 123456789-0"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                RM (Registro de Matrícula)
              </label>
              <input
                id="student-rm-input"
                type="text"
                value={rm}
                onChange={(e) => setRm(e.target.value)}
                placeholder="Opcional"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Status de Matrícula
              </label>
              <select
                id="student-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="ativo">Ativo</option>
                <option value="recebida">Transferência Recebida (Entrada)</option>
                <option value="expedida">Transferência Expedida (Saída)</option>
              </select>
            </div>

            {(status === 'recebida' || status === 'expedida') && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data da Transferência *
                </label>
                <input
                  id="student-transfer-date-input"
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="student-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Aluno' : 'Adicionar Aluno'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-800">
            Alunos Cadastrados ({students.length})
          </h3>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              id="filter-students-class"
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="">Todas as Turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.val.year}º {c.val.letter} — {c.val.shift}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando alunos...</div>
        ) : students.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum aluno encontrado para os filtros selecionados.
          </div>
        ) : (
          <div className="space-y-3">
            {students.map((item) => {
              const student = item.val;
              const turma = classes.find((c) => c.id === item.classId)?.val;
              const turmaStr = turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : 'Turma';

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors flex-wrap gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold">
                        {student.number}
                      </span>
                      <h4 className="text-sm font-bold text-slate-800 truncate">
                        {student.name}
                      </h4>
                      {student.status === 'ativo' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          Ativo
                        </span>
                      )}
                      {student.status === 'recebida' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                          TR. REC. {student.transferDate ? `(${formatDate(student.transferDate)})` : ''}
                        </span>
                      )}
                      {student.status === 'expedida' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                          TR. EXP. {student.transferDate ? `(${formatDate(student.transferDate)})` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      RA: {student.ra} {student.rm ? `| RM: ${student.rm}` : ''} | Nasc:{' '}
                      {formatDate(student.birthdate)} | Turma: {turmaStr}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {isAdmin && (
                      <button
                        id={`student-transfer-${item.id}`}
                        onClick={() => {
                          setStudentToTransfer(item);
                          setIsTransferModalOpen(true);
                        }}
                        className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold"
                        title="Transferir este aluno para outra turma/escola"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        <span className="hidden sm:inline">Transferir</span>
                      </button>
                    )}
                    <button
                      id={`student-edit-${item.id}`}
                      onClick={() => handleEdit(item)}
                      className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      id={`student-delete-${item.id}`}
                      onClick={() => handleDelete(item.classId, item.id, item.val.name)}
                      className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Transferência Automatizada de Alunos */}
      <TransferStudentModal
        isOpen={isTransferModalOpen}
        onClose={() => {
          setIsTransferModalOpen(false);
          setStudentToTransfer(null);
        }}
        currentYear={currentYear}
        initialStudent={studentToTransfer}
        onSuccess={() => {
          loadStudents();
          loadClasses();
        }}
        setModal={setModal}
      />
    </div>
  );
};
