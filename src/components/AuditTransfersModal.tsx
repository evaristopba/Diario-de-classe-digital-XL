import React, { useState, useEffect, useMemo } from 'react';
import { ClassRoom, Student, ModalConfig } from '../types';
import { get, ref, update, rtdb } from '../lib/firebase';
import { formatDate } from '../lib/reports';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  X,
  Search,
  AlertTriangle,
  Check,
  Save,
  Filter,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Info
} from 'lucide-react';

interface AuditTransfersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentYear: string;
  classes: { id: string; val: ClassRoom }[];
  onSaved: () => void;
  setModal: (config: ModalConfig) => void;
}

interface EditableStudentTransfer {
  studentId: string;
  classId: string;
  className: string;
  number: number;
  name: string;
  ra: string;
  rm?: string;
  birthdate: string;
  status: 'ativo' | 'recebida' | 'expedida';
  originalStatus: 'ativo' | 'recebida' | 'expedida';
  transferInDate: string;
  originalInDate: string;
  transferOutDate: string;
  originalOutDate: string;
  transferDate?: string;
  isSaving?: boolean;
  savedSuccess?: boolean;
}

export const AuditTransfersModal: React.FC<AuditTransfersModalProps> = ({
  isOpen,
  onClose,
  currentYear,
  classes,
  onSaved,
  setModal
}) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<EditableStudentTransfer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'alertas' | 'recebida' | 'expedida'>('todos');
  const [savingAll, setSavingAll] = useState(false);

  const loadData = async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      const list: EditableStudentTransfer[] = [];

      for (const c of classes) {
        const snap = await get(ref(rtdb, `diario-classe/turmas/${c.id}/alunos`));
        if (!snap.exists()) continue;
        const val = snap.val() || {};

        Object.keys(val).forEach((k) => {
          const s: Student = val[k];
          if (!s.anoLetivo || s.anoLetivo === currentYear) {
            const hasTransfer =
              s.status === 'recebida' ||
              s.status === 'expedida' ||
              Boolean(s.transferInDate) ||
              Boolean(s.transferOutDate) ||
              Boolean(s.transferDate);

            if (hasTransfer) {
              const inDate = s.transferInDate || (s.status === 'recebida' ? s.transferDate : '') || '';
              const outDate = s.transferOutDate || (s.status === 'expedida' ? s.transferDate : '') || '';
              const cName = `${c.val.year}º ${c.val.letter} (${c.val.shift})`;

              list.push({
                studentId: k,
                classId: c.id,
                className: cName,
                number: s.number,
                name: s.name,
                ra: s.ra || '',
                rm: s.rm || '',
                birthdate: s.birthdate || '',
                status: s.status,
                originalStatus: s.status,
                transferInDate: inDate,
                originalInDate: inDate,
                transferOutDate: outDate,
                originalOutDate: outDate,
                transferDate: s.transferDate || ''
              });
            }
          }
        });
      }

      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      setItems(list);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Auditoria',
        message: formatFriendlyError(err, 'Não foi possível carregar os registros de transferências'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, currentYear]);

  // Identificar potenciais pares de origem e destino pelo mesmo RA
  const raCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      const cleanRa = item.ra.trim();
      if (cleanRa) {
        counts[cleanRa] = (counts[cleanRa] || 0) + 1;
      }
    });
    return counts;
  }, [items]);

  const getItemWarnings = (item: EditableStudentTransfer) => {
    const warnings: string[] = [];
    if (item.status === 'recebida' && !item.transferInDate) {
      warnings.push('Falta data de entrada (TR. REC.)');
    }
    if (item.status === 'expedida' && !item.transferOutDate) {
      warnings.push('Falta data de saída (TR. EXP.)');
    }
    if (item.status === 'expedida' && item.transferInDate && item.transferOutDate && item.transferOutDate < item.transferInDate) {
      warnings.push('Data de saída anterior à de entrada!');
    }
    return warnings;
  };

  const isItemDirty = (item: EditableStudentTransfer) => {
    return (
      item.transferInDate !== item.originalInDate ||
      item.transferOutDate !== item.originalOutDate ||
      item.status !== item.originalStatus
    );
  };

  const handleFieldChange = (
    index: number,
    field: 'transferInDate' | 'transferOutDate' | 'status',
    val: any
  ) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val, savedSuccess: false };
      return copy;
    });
  };

  const handleSaveItem = async (index: number) => {
    const item = items[index];
    const warnings = getItemWarnings(item);
    if (warnings.some((w) => w.includes('anterior'))) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Data Inválida',
        message: 'A data de saída da transferência não pode ser anterior à data de entrada.',
        icon: '⚠️'
      });
    }

    try {
      setItems((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index], isSaving: true };
        return copy;
      });

      const updatesPayload: Record<string, any> = {
        status: item.status,
        updatedAt: Date.now()
      };

      if (item.status === 'recebida') {
        updatesPayload.transferInDate = item.transferInDate || null;
        updatesPayload.transferOutDate = null;
        updatesPayload.transferDate = item.transferInDate || null;
      } else if (item.status === 'expedida') {
        updatesPayload.transferOutDate = item.transferOutDate || null;
        updatesPayload.transferInDate = item.transferInDate || null;
        updatesPayload.transferDate = item.transferOutDate || null;
      } else {
        updatesPayload.transferInDate = item.transferInDate || null;
        updatesPayload.transferOutDate = null;
        updatesPayload.transferDate = item.transferInDate || null;
      }

      await update(ref(rtdb, `diario-classe/turmas/${item.classId}/alunos/${item.studentId}`), updatesPayload);

      setItems((prev) => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          isSaving: false,
          savedSuccess: true,
          originalInDate: item.transferInDate,
          originalOutDate: item.transferOutDate,
          originalStatus: item.status
        };
        return copy;
      });

      onSaved();
    } catch (err: any) {
      setItems((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index], isSaving: false };
        return copy;
      });
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar',
        message: formatFriendlyError(err, 'Não foi possível atualizar o aluno'),
        icon: '❌'
      });
    }
  };

  const handleSaveAll = async () => {
    const dirtyItems = items.filter(isItemDirty);
    if (dirtyItems.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Alteração',
        message: 'Nenhum registro foi modificado.',
        icon: 'ℹ️'
      });
    }

    // Validar se há datas de saída anteriores a datas de entrada para alunos transferidos para fora
    for (const item of dirtyItems) {
      if (item.status === 'expedida' && item.transferInDate && item.transferOutDate && item.transferOutDate < item.transferInDate) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Data Inválida',
          message: `O aluno ${item.name} possui data de saída anterior à data de entrada. Corrija antes de salvar.`,
          icon: '⚠️'
        });
      }
    }

    try {
      setSavingAll(true);
      const rootUpdates: Record<string, any> = {};
      const now = Date.now();

      dirtyItems.forEach((item) => {
        const path = `diario-classe/turmas/${item.classId}/alunos/${item.studentId}`;
        rootUpdates[`${path}/status`] = item.status;
        rootUpdates[`${path}/transferInDate`] = item.transferInDate || null;
        rootUpdates[`${path}/transferOutDate`] = item.status === 'expedida' ? (item.transferOutDate || null) : null;
        rootUpdates[`${path}/updatedAt`] = now;

        let legacyDate = null;
        if (item.status === 'expedida') {
          legacyDate = item.transferOutDate || item.transferInDate || null;
        } else if (item.status === 'recebida') {
          legacyDate = item.transferInDate || null;
        } else {
          legacyDate = item.transferInDate || null;
        }
        rootUpdates[`${path}/transferDate`] = legacyDate;
      });

      await update(ref(rtdb), rootUpdates);

      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          originalInDate: it.transferInDate,
          originalOutDate: it.transferOutDate,
          originalStatus: it.status,
          savedSuccess: true
        }))
      );

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: `${dirtyItems.length} registro(s) de transferência atualizado(s) com sucesso!`,
        icon: '✅'
      });

      onSaved();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar em Lote',
        message: formatFriendlyError(err, 'Falha ao salvar as transferências'),
        icon: '❌'
      });
    } finally {
      setSavingAll(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchTerm.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.ra.toLowerCase().includes(q) ||
        item.className.toLowerCase().includes(q);

      if (!matchSearch) return false;

      const warnings = getItemWarnings(item);
      if (statusFilter === 'alertas') return warnings.length > 0;
      if (statusFilter === 'recebida') return item.status === 'recebida';
      if (statusFilter === 'expedida') return item.status === 'expedida';

      return true;
    });
  }, [items, searchTerm, statusFilter]);

  const totalWarnings = useMemo(() => {
    return items.reduce((acc, it) => acc + getItemWarnings(it).length, 0);
  }, [items]);

  const totalDirty = useMemo(() => {
    return items.filter(isItemDirty).length;
  }, [items]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* CABEÇALHO */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50/70 via-white to-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800">
                Auditoria e Correção de Transferências
              </h2>
              <p className="text-xs text-slate-500">
                Visualize, confira e corrija as datas de entrada e saída de todos os alunos transferidos no Ano Letivo {currentYear}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BARRA DE FILTROS E AÇÕES */}
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por nome, RA ou turma..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('todos')}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  statusFilter === 'todos' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                Todos ({items.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('alertas')}
                className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1 transition-colors ${
                  statusFilter === 'alertas' ? 'bg-amber-500 text-white' : 'text-amber-700 hover:bg-amber-50'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Pendências ({totalWarnings})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('recebida')}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  statusFilter === 'recebida' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:text-amber-700'
                }`}
              >
                Recebidas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('expedida')}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  statusFilter === 'expedida' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-rose-700'
                }`}
              >
                Expedidas
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 bg-white border border-slate-200 rounded-xl inline-flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
              title="Recarregar dados"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Recarregar
            </button>
            {totalDirty > 0 && (
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={savingAll}
                className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs inline-flex items-center gap-1.5 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {savingAll ? 'Salvando...' : `Salvar Todos Alterados (${totalDirty})`}
              </button>
            )}
          </div>
        </div>

        {/* TABELA DE ALUNOS COM TRANSFERÊNCIA */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
              Carregando registros de transferências...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              Nenhum aluno encontrado para os critérios de pesquisa.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="py-3 px-3 w-12 text-center">Nº</th>
                    <th className="py-3 px-3 min-w-[200px]">Aluno / RA</th>
                    <th className="py-3 px-3 min-w-[140px]">Turma</th>
                    <th className="py-3 px-3 min-w-[150px]">Status</th>
                    <th className="py-3 px-3 min-w-[170px]">
                      <span className="flex items-center gap-1 text-amber-800">
                        <Calendar className="w-3.5 h-3.5 text-amber-600" />
                        Data Entrada (TR. REC.)
                      </span>
                    </th>
                    <th className="py-3 px-3 min-w-[170px]">
                      <span className="flex items-center gap-1 text-rose-800">
                        <Calendar className="w-3.5 h-3.5 text-rose-600" />
                        Data Saída (TR. EXP.)
                      </span>
                    </th>
                    <th className="py-3 px-3 min-w-[140px]">Diagnóstico</th>
                    <th className="py-3 px-3 w-24 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredItems.map((item) => {
                    const originalIdx = items.findIndex(
                      (it) => it.studentId === item.studentId && it.classId === item.classId
                    );
                    const warnings = getItemWarnings(item);
                    const dirty = isItemDirty(item);
                    const hasPairedClass = item.ra.trim() && (raCounts[item.ra.trim()] || 0) > 1;

                    return (
                      <tr
                        key={`${item.classId}_${item.studentId}`}
                        className={`transition-colors hover:bg-indigo-50/30 ${
                          dirty ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600">
                          {item.number}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-800">{item.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            RA: {item.ra || 'Não informado'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
                            {item.className}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={item.status}
                            onChange={(e) =>
                              handleFieldChange(
                                originalIdx,
                                'status',
                                e.target.value as 'ativo' | 'recebida' | 'expedida'
                              )
                            }
                            className="w-full text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
                          >
                            <option value="ativo">Ativo</option>
                            <option value="recebida">Tr. Recebida (Entrada)</option>
                            <option value="expedida">Tr. Expedida (Saída)</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="date"
                            value={item.transferInDate}
                            onChange={(e) =>
                              handleFieldChange(originalIdx, 'transferInDate', e.target.value)
                            }
                            placeholder="Data de Entrada"
                            className={`w-full text-xs py-1.5 px-2 bg-slate-50 border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                              item.status === 'recebida' && !item.transferInDate
                                ? 'border-amber-400 bg-amber-50/40'
                                : 'border-slate-200'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="date"
                            value={item.transferOutDate}
                            onChange={(e) =>
                              handleFieldChange(originalIdx, 'transferOutDate', e.target.value)
                            }
                            placeholder="Data de Saída"
                            className={`w-full text-xs py-1.5 px-2 bg-slate-50 border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                              item.status === 'expedida' && !item.transferOutDate
                                ? 'border-rose-400 bg-rose-50/40'
                                : 'border-slate-200'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="space-y-1">
                            {warnings.length === 0 && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Regular
                              </span>
                            )}
                            {warnings.map((w, wi) => (
                              <div
                                key={wi}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-md"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                                {w}
                              </div>
                            ))}
                            {hasPairedClass && (
                              <div className="text-[10px] text-indigo-600 font-medium flex items-center gap-1 mt-0.5">
                                <Info className="w-3 h-3" />
                                Consta em outra turma
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleSaveItem(originalIdx)}
                            disabled={item.isSaving || !dirty}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1 transition-colors ${
                              item.savedSuccess
                                ? 'bg-emerald-600 text-white'
                                : dirty
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                            title="Salvar alterações deste aluno"
                          >
                            {item.isSaving ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : item.savedSuccess ? (
                              <>
                                <Check className="w-3 h-3" />
                                Salvo
                              </>
                            ) : (
                              <>
                                <Save className="w-3 h-3" />
                                Salvar
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RODAPÉ INFORMATIVO */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Dica:</span>
            <span>
              Alunos que vieram transferidos e depois saíram transferidos devem ter tanto a <strong>Data de Entrada</strong> quanto a <strong>Data de Saída</strong> preenchidas.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200/80 bg-slate-200/60 rounded-xl transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
