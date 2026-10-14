import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  X,
  Search,
  Trash2,
  Calendar,
  CheckCircle2,
  FileSpreadsheet,
  CheckSquare,
  Square,
  ArrowRight,
  Filter,
  RefreshCw
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDate } from '../lib/reports';
import { ref, update, rtdb, dc } from '../lib/firebase';
import { ModalConfig } from '../types';

export interface ImproperAttendanceRecord {
  key: string;
  studentId: string;
  studentName: string;
  studentNumber: number;
  date: string;
  bimester: string;
  status: 'P' | 'F' | string;
  reason: string;
  enrollmentDate?: string;
  transferOutDate?: string;
  studentStatus?: string;
}

interface ImproperAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: ImproperAttendanceRecord[];
  className: string;
  currentYear: string;
  onRefresh: () => void;
  onNavigateToDate?: (date: string, bimester: string) => void;
  setModal: (config: ModalConfig) => void;
}

export const ImproperAttendanceModal: React.FC<ImproperAttendanceModalProps> = ({
  isOpen,
  onClose,
  records,
  className,
  currentYear,
  onRefresh,
  onNavigateToDate,
  setModal
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'P' | 'F'>('todos');
  const [bimesterFilter, setBimesterFilter] = useState<string>('todos');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Filtragem dos registros
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Filtro de status
      if (statusFilter !== 'todos' && rec.status !== statusFilter) return false;

      // Filtro de bimestre
      if (bimesterFilter !== 'todos' && String(rec.bimester) !== String(bimesterFilter)) return false;

      // Filtro de busca textual
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const formattedDate = formatDate(rec.date).toLowerCase();
        const matchesName = rec.studentName.toLowerCase().includes(term);
        const matchesNumber = String(rec.studentNumber).includes(term);
        const matchesDate = rec.date.toLowerCase().includes(term) || formattedDate.includes(term);
        const matchesReason = rec.reason.toLowerCase().includes(term);

        if (!matchesName && !matchesNumber && !matchesDate && !matchesReason) {
          return false;
        }
      }

      return true;
    });
  }, [records, statusFilter, bimesterFilter, searchTerm]);

  // Contadores
  const countP = useMemo(() => records.filter((r) => r.status === 'P').length, [records]);
  const countF = useMemo(() => records.filter((r) => r.status === 'F').length, [records]);

  // Seleção em massa
  const handleToggleSelectAll = () => {
    if (selectedKeys.size === filteredRecords.length && filteredRecords.length > 0) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredRecords.map((r) => r.key)));
    }
  };

  const handleToggleSelectOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Excluir registro individual
  const handleDeleteSingle = (record: ImproperAttendanceRecord) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Presença Indevida',
      message: `Tem certeza que deseja excluir o registro de chamada do estudante "${record.studentName}" na data ${formatDate(record.date)} (${record.status === 'P' ? 'Presente' : 'Ausente'})?\n\nMotivo: ${record.reason}`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          await update(ref(rtdb), {
            [dc(`chamada/${record.key}`)]: null
          });

          setSelectedKeys((prev) => {
            const next = new Set(prev);
            next.delete(record.key);
            return next;
          });

          onRefresh();
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Registro Excluído',
            message: `O registro indevido de ${record.studentName} na data ${formatDate(record.date)} foi removido com sucesso!`,
            icon: '✅'
          });
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir',
            message: err?.message || 'Falha ao remover o registro de chamada.',
            icon: '❌'
          });
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  // Excluir registros selecionados
  const handleDeleteSelected = () => {
    const keysToDelete = Array.from(selectedKeys);
    if (keysToDelete.length === 0) return;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Presenças Selecionadas',
      message: `Confirma a exclusão de ${keysToDelete.length} registro(s) de chamada selecionado(s)?\n\nEssa ação regularizará o histórico dos alunos transferidos no banco de dados.`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          const updates: Record<string, any> = {};
          keysToDelete.forEach((key) => {
            updates[dc(`chamada/${key}`)] = null;
          });

          await update(ref(rtdb), updates);
          setSelectedKeys(new Set());
          onRefresh();

          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Registros Excluídos',
            message: `${keysToDelete.length} presença(s) indevida(s) foram excluídas com sucesso!`,
            icon: '✅'
          });
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir',
            message: err?.message || 'Falha ao remover os registros de chamada selecionados.',
            icon: '❌'
          });
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  // Excluir todas as presenças indevidas detectadas
  const handleDeleteAll = () => {
    if (records.length === 0) return;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Regularizar Todas as Presenças Indevidas',
      message: `Tem certeza que deseja excluir TODOS os ${records.length} registro(s) indevidos detectados nesta turma?\n\nEsta operação removerá todas as presenças/faltas gravadas fora das datas oficiais de matrícula dos alunos transferidos (TR. REC e TR. EXP).`,
      icon: '🧹',
      danger: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          const updates: Record<string, any> = {};
          records.forEach((rec) => {
            updates[dc(`chamada/${rec.key}`)] = null;
          });

          await update(ref(rtdb), updates);
          setSelectedKeys(new Set());
          onRefresh();

          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Frequência 100% Regularizada',
            message: `Todos os ${records.length} registro(s) indevidos foram excluídos com sucesso!\nOs relatórios e estatísticas da turma agora estão rigorosamente alinhados com as datas oficiais de transferência.`,
            icon: '✅'
          });
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Limpar Registros',
            message: err?.message || 'Falha ao limpar os registros de chamada indevidos.',
            icon: '❌'
          });
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  // Exportar para Excel para auditoria antes de excluir
  const handleExportXLSX = () => {
    if (records.length === 0) return;

    const data = records.map((r, idx) => ({
      '#': idx + 1,
      'Nº Aluno': r.studentNumber || '',
      'Nome do Aluno': r.studentName,
      'Data da Chamada': formatDate(r.date),
      'Bimestre': `${r.bimester}º Bimestre`,
      'Status Gravado': r.status === 'P' ? 'Presente (P)' : 'Ausente (F)',
      'Data de Entrada (TR. REC)': r.enrollmentDate ? formatDate(r.enrollmentDate) : '-',
      'Data de Saída (TR. EXP)': r.transferOutDate ? formatDate(r.transferOutDate) : '-',
      'Motivo da Irregularidade': r.reason,
      'Chave do Registro': r.key
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Presencas_Indevidas_TR_REC');
    XLSX.writeFile(wb, `presencas_indevidas_${className.replace(/[^a-zA-Z0-9]/g, '_')}_${currentYear}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* CABEÇALHO */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-rose-50/80 via-white to-amber-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>Presenças Indevidas Detectadas (TR. REC / TR. EXP)</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">
                  {records.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Turma: <strong className="text-slate-700">{className}</strong> • Ano Letivo: <strong className="text-slate-700">{currentYear}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BANNER INFORMATIVO */}
        <div className="px-4 py-3 bg-rose-50/70 border-b border-rose-100 flex items-start gap-2.5 text-xs text-rose-900">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">
              Por que esses registros foram listados?
            </p>
            <p className="text-rose-800/90 text-[11px] leading-relaxed mt-0.5">
              Estes registros de chamada foram encontrados gravados no banco de dados para datas em que o estudante ainda não havia ingressado oficialmente na turma (Transferência Recebida posterior à chamada) ou após sua saída (Transferência Expedida). Abaixo você pode inspecionar cada presença/falta, abrir a data no diário ou excluir os registros para manter as estatísticas e relatórios 100% exatos.
            </p>
          </div>
        </div>

        {/* BARRA DE FILTROS E AÇÕES */}
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 flex-wrap">
            {/* Campo de Busca */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por aluno, data (ex: 15/03) ou motivo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>

            {/* Filtro de Status */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('todos')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'todos' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos ({records.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('P')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'P' ? 'bg-[#1b4332] text-white' : 'text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                Presente P ({countP})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('F')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'F' ? 'bg-rose-700 text-white' : 'text-rose-700 hover:bg-rose-50'
                }`}
              >
                Falta A ({countF})
              </button>
            </div>

            {/* Filtro de Bimestre */}
            <select
              value={bimesterFilter}
              onChange={(e) => setBimesterFilter(e.target.value)}
              className="text-xs bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            >
              <option value="todos">Todos os Bimestres</option>
              <option value="1">1º Bimestre</option>
              <option value="2">2º Bimestre</option>
              <option value="3">3º Bimestre</option>
              <option value="4">4º Bimestre</option>
            </select>
          </div>

          {/* Botões de Ação no Topo */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportXLSX}
              disabled={records.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-200 transition-colors disabled:opacity-50 cursor-pointer"
              title="Exportar planilha Excel para conferência"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Exportar Excel</span>
            </button>

            {records.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                title="Excluir todos os registros indevidos de uma só vez"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Todos ({records.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* BARRA DE SELEÇÃO EM MASSA (quando houver itens selecionados) */}
        {selectedKeys.size > 0 && (
          <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between text-xs text-rose-900 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 font-bold">
              <span>{selectedKeys.size} de {filteredRecords.length} registro(s) selecionado(s)</span>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="text-[11px] underline text-rose-700 hover:text-rose-900 cursor-pointer ml-2"
              >
                Limpar seleção
              </button>
            </div>

            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs cursor-pointer transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Excluir Selecionadas ({selectedKeys.size})</span>
            </button>
          </div>
        )}

        {/* LISTAGEM DE REGISTROS */}
        <div className="flex-1 overflow-y-auto">
          {records.length === 0 ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center p-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800">
                Tudo Regularizado!
              </h3>
              <p className="text-xs text-slate-500 max-w-md mt-1">
                Não há registros de presença fora do período de matrícula para esta turma. A frequência de todos os alunos transferidos está 100% compatível com suas datas oficiais.
              </p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Nenhum registro encontrado para os filtros e busca aplicados.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              <div className="sticky top-0 bg-slate-100/95 backdrop-blur-xs px-4 sm:px-6 py-2.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider grid grid-cols-12 gap-2 items-center border-b border-slate-200 z-10">
                <div className="col-span-1 flex items-center">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="p-1 text-slate-500 hover:text-slate-800 rounded transition-colors cursor-pointer"
                    title={selectedKeys.size === filteredRecords.length ? 'Desmarcar todos' : 'Selecionar todos os visíveis'}
                  >
                    {selectedKeys.size === filteredRecords.length && filteredRecords.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-rose-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
                <div className="col-span-4 sm:col-span-4">Aluno</div>
                <div className="col-span-3 sm:col-span-2 text-center">Data Chamada</div>
                <div className="hidden sm:block sm:col-span-1 text-center">Bimestre</div>
                <div className="col-span-2 sm:col-span-1 text-center">Status</div>
                <div className="hidden sm:block sm:col-span-3">Motivo da Irregularidade</div>
                <div className="col-span-2 sm:col-span-1 text-right">Ação</div>
              </div>

              {filteredRecords.map((item) => {
                const isSelected = selectedKeys.has(item.key);
                const isPresent = item.status === 'P';

                return (
                  <div
                    key={item.key}
                    className={`px-4 sm:px-6 py-3 text-xs grid grid-cols-12 gap-2 items-center transition-colors ${
                      isSelected ? 'bg-rose-50/50' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Checkbox de seleção */}
                    <div className="col-span-1 flex items-center">
                      <button
                        type="button"
                        onClick={() => handleToggleSelectOne(item.key)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-rose-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300" />
                        )}
                      </button>
                    </div>

                    {/* Aluno */}
                    <div className="col-span-4 sm:col-span-4 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        {item.studentNumber > 0 && (
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {item.studentNumber}
                          </span>
                        )}
                        <span className="font-bold text-slate-800 truncate" title={item.studentName}>
                          {item.studentName}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {item.enrollmentDate && (
                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                            Entrada: {formatDate(item.enrollmentDate)}
                          </span>
                        )}
                        {item.transferOutDate && (
                          <span className="text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                            Saída: {formatDate(item.transferOutDate)}
                          </span>
                        )}
                        <span className="block sm:hidden text-rose-700 font-medium">
                          {item.reason}
                        </span>
                      </div>
                    </div>

                    {/* Data da Chamada */}
                    <div className="col-span-3 sm:col-span-2 text-center">
                      <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md inline-block">
                        {formatDate(item.date)}
                      </span>
                    </div>

                    {/* Bimestre */}
                    <div className="hidden sm:block sm:col-span-1 text-center font-medium text-slate-600">
                      {item.bimester}º Bim
                    </div>

                    {/* Status Gravado */}
                    <div className="col-span-2 sm:col-span-1 text-center">
                      {isPresent ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                          Pres. (P)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                          Falta (A)
                        </span>
                      )}
                    </div>

                    {/* Motivo detalhado */}
                    <div className="hidden sm:block sm:col-span-3 pr-2">
                      <span className="text-[11px] text-rose-700 bg-rose-50/80 px-2 py-1 rounded-lg border border-rose-200/60 inline-flex items-center gap-1 font-medium leading-tight">
                        <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                        <span>{item.reason}</span>
                      </span>
                    </div>

                    {/* Ações */}
                    <div className="col-span-2 sm:col-span-1 text-right flex items-center justify-end gap-1">
                      {onNavigateToDate && (
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateToDate(item.date, item.bimester);
                            onClose();
                          }}
                          className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          title="Abrir esta chamada no diário de classe"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeleteSingle(item)}
                        disabled={isDeleting}
                        className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Excluir este registro indevido"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RODAPÉ */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Exibindo <strong className="text-slate-700">{filteredRecords.length}</strong> de <strong className="text-slate-700">{records.length}</strong> registro(s) indevido(s)
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
