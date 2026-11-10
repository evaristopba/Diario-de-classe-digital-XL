import React, { useState, useEffect, useMemo } from 'react';
import { Student, ClassRoom, ModalConfig } from '../types';
import { compararIdentidade, raValidoParaVinculo, type IdentidadeAluno } from '../lib/identidadeAluno';
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
  verificarIsAdmin,
  transporNotasParaReingresso,
  buscarLinhaAnteriorAluno,
  buscarTodasLinhasAnterioresAluno,
  filtrarLinhasConfiaveis,
  saoRAsIguais
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkStudentDeleteIntegrity } from '../lib/referentialIntegrity';
import { formatDate } from '../lib/reports';
import { UserCheck, Plus, Edit2, Trash2, Download, Upload, X, Filter, ArrowRightLeft, Search, Copy, ClipboardPaste, Sparkles, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import { TransferStudentModal } from './TransferStudentModal';
import { AuditTransfersModal } from './AuditTransfersModal';
import { StudentEvolutionChartModal } from './StudentEvolutionChartModal';

export interface StudentClipboardData {
  id?: string;
  classId: string;
  name: string;
  ra: string;
  rm: string;
  birthdate: string;
  originalNumber: number;
  originalStatus: string;
  originalTransferOutDate?: string;
  copiedAt: number;
}

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
  const [transferInDate, setTransferInDate] = useState('');
  const [transferOutDate, setTransferOutDate] = useState('');
  const [hasTransferIn, setHasTransferIn] = useState(false);
  const [studentClipboard, setStudentClipboard] = useState<StudentClipboardData | null>(() => {
    try {
      const saved = sessionStorage.getItem('dc_student_clipboard');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalClassId, setEditingOriginalClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Estado para Transferência de Aluno
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [studentToTransfer, setStudentToTransfer] = useState<{ id: string; classId: string; val: Student } | null>(null);
  const [reingressoComparison, setReingressoComparison] = useState<{
    sourceStudent: { id: string; val: Student };
    targetStudent: { id: string; val: Student };
    divergences: { field: string; origVal: string; recVal: string }[];
  } | null>(null);
  const [evolutionChartStudent, setEvolutionChartStudent] = useState<{
    studentId: string;
    classId: string;
    turma: ClassRoom | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'transferencia' | 'recebida' | 'expedida'>('todos');

  const displayedStudents = useMemo(() => {
    return students.filter((item) => {
      const s = item.val;
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const matchName = s.name.toLowerCase().includes(q);
        const matchRa = (s.ra || '').toLowerCase().includes(q);
        const matchRm = (s.rm || '').toLowerCase().includes(q);
        if (!matchName && !matchRa && !matchRm) return false;
      }

      if (statusFilter === 'ativo') return s.status === 'ativo';
      if (statusFilter === 'recebida') return s.status === 'recebida';
      if (statusFilter === 'expedida') return s.status === 'expedida';
      if (statusFilter === 'transferencia') {
        return (
          s.status === 'recebida' ||
          s.status === 'expedida' ||
          Boolean(s.transferInDate) ||
          Boolean(s.transferOutDate)
        );
      }

      return true;
    });
  }, [students, searchQuery, statusFilter]);

  // PONTO 1 & 2: Identifica se o RA digitado no formulário já existe em uma linha arquivada (status 'expedida')
  // em qualquer turma da escola/rede, com comparação normalizada de RA.
  const matchingExpedidaHistory = useMemo(() => {
    if (!raValidoParaVinculo(ra)) return [];
    const matches: {
      classId: string;
      className: string;
      studentId: string;
      student: Student;
      identidade: IdentidadeAluno;
    }[] = [];
    classes.forEach((cls) => {
      const alunos = cls.val.alunos || {};
      Object.keys(alunos).forEach((sId) => {
        if (editingId && sId === editingId) return;
        const s = alunos[sId];
        if (s && s.status === 'expedida' && saoRAsIguais(s.ra, ra)) {
          matches.push({
            classId: cls.id,
            className: (cls.val as any).name || `${cls.val.year}º ${cls.val.letter}`,
            studentId: sId,
            student: s,
            // Nome E nascimento diferentes: possível RA repetido/errado. Não migra notas sozinho.
            identidade: compararIdentidade({ name, birthdate }, s)
          });
        }
      });
    });
    return matches;
  }, [ra, name, birthdate, classes, editingId]);

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

  const calculateNextNumber = async (classId: string): Promise<number> => {
    if (!classId) return 1;
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
      return next;
    } catch (err) {
      console.error(err);
      return 1;
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

    const effectiveInDate = transferInDate || (status === 'recebida' ? transferDate : '');
    const effectiveOutDate = status === 'expedida' ? (transferOutDate || transferDate) : '';

    if (status === 'recebida') {
      if (!effectiveInDate) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Atenção',
          message: 'Informe a data da transferência recebida (entrada)!',
          icon: '⚠️'
        });
      }
    }

    if (status === 'expedida') {
      if (!effectiveOutDate) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Atenção',
          message: 'Informe a data da transferência expedida (saída)!',
          icon: '⚠️'
        });
      }

      if (effectiveInDate && effectiveOutDate && effectiveOutDate < effectiveInDate) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Data Inválida',
          message: 'A data da transferência expedida (saída) não pode ser anterior à data da transferência recebida (entrada)!',
          icon: '⚠️'
        });
      }
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

    if (status === 'recebida') {
      data.transferInDate = effectiveInDate;
      data.transferDate = effectiveInDate;
      data.transferOutDate = null;
    } else if (status === 'expedida') {
      data.transferOutDate = effectiveOutDate;
      data.transferDate = effectiveOutDate;
      if (effectiveInDate) {
        data.transferInDate = effectiveInDate;
      }
    } else {
      if (effectiveInDate) {
        data.transferInDate = effectiveInDate;
        data.transferDate = effectiveInDate;
      }
      data.transferOutDate = null;
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

        // PONTO 1: Ao editar uma linha existente (seja alterada para 'recebida' ou 'ativo'),
        // dispara a busca no histórico escolar de saídas e transpõe as notas de toda a cadeia anterior!
        let notasTranspostasMsg = '';
        if (status !== 'expedida') {
          // `data` vem do formulário e não traz o vínculo já gravado: junta com o cadastro atual
          const atual = students.find((s) => s.id === editingId);
          const alunoParaBusca = { ...(atual?.val || {}), ...data } as Student;
          const todasLinhas = await buscarTodasLinhasAnterioresAluno(alunoParaBusca, editingId, selectedClassId, currentYear);
          const history = filtrarLinhasConfiaveis(todasLinhas);
          const ignoradas = todasLinhas.length - history.length;
          if (history.length > 0) {
            const mostRecent = history[history.length - 1];
            if (!alunoParaBusca.transferidoDe) {
              await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos/${editingId}`), {
                transferidoDe: mostRecent.id
              });
            }

            const allSourceIds = history.map((h) => h.id);
            const transResult = await transporNotasParaReingresso(
              allSourceIds,
              editingId,
              selectedClassId,
              currentYear
            );
            const avisoParcial = transResult.parcial
              ? '\n\n⚠️ Atenção: Só as notas do seu próprio perfil foram verificadas. Notas lançadas por outros professores não foram consideradas; peça a um administrador para conferir.'
              : '';
            if (transResult.count > 0) {
              notasTranspostasMsg = `\n\n✨ Aproveitamento Automático de Notas:\nForam sincronizadas ${transResult.count} nota(s) do(s) ${transResult.bimesters.map((b) => `${b}º`).join(', ')} Bimestre(s) a partir de ${allSourceIds.length} linha(s) anterior(es) do histórico escolar!${avisoParcial}`;
            } else if (avisoParcial) {
              notasTranspostasMsg = avisoParcial;
            }
          }
          if (ignoradas > 0) {
            notasTranspostasMsg += `\n\n⚠️ Há ${ignoradas} cadastro(s) arquivado(s) com o mesmo RA, mas nome e data de nascimento diferentes: as notas NÃO foram migradas automaticamente. Se for o mesmo aluno, use "Puxar Notas" após conferir.`;
          }
        }

        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: `Aluno atualizado com sucesso!${notasTranspostasMsg}`,
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        const newRef = await push(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos`), data);
        const newStudentId = newRef.key;
        const isReingressoOuAtivo = status !== 'expedida';

        let notasTranspostasMsg = '';
        let divergenciasMsg = '';
        let avisoDivergentesMsg = '';
        let matchedHistoryCount = 0;

        if (isReingressoOuAtivo && newStudentId) {
          // PONTO 1 & 3: Busca TODAS as linhas da cadeia histórica (via transferidoDe e RA normalizado)
          const todasLinhas = await buscarTodasLinhasAnterioresAluno(data as Student, newStudentId, selectedClassId, currentYear);
          // Linhas achadas só pelo RA, com nome E nascimento diferentes, não migram notas sozinhas
          const history = filtrarLinhasConfiaveis(todasLinhas);
          matchedHistoryCount = history.length;
          const ignoradas = todasLinhas.length - history.length;
          if (ignoradas > 0) {
            avisoDivergentesMsg = `\n\n⚠️ Há ${ignoradas} cadastro(s) arquivado(s) com o mesmo RA, mas nome e data de nascimento diferentes: as notas NÃO foram migradas automaticamente. Se for o mesmo aluno, use "Puxar Notas" após conferir.`;
          }

          let sourceItem = studentClipboard?.id ? students.find((s) => s.id === studentClipboard.id) : null;
          if (!sourceItem && history.length > 0) {
            const mostRecent = history[history.length - 1];
            sourceItem = {
              id: mostRecent.id,
              classId: mostRecent.classId,
              val: mostRecent.val
            };
          }

          if (history.length > 0 || sourceItem) {
            const primarySourceId = sourceItem ? sourceItem.id : history[history.length - 1].id;
            // Salva vínculo transferidoDe no cadastro de destino
            await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}/alunos/${newStudentId}`), {
              transferidoDe: primarySourceId
            });

            // Auditoria ativa de divergências entre histórico de saída e o novo cadastro
            const compareVal = sourceItem ? sourceItem.val : history[history.length - 1].val;
            const diffs: { field: string; origVal: string; recVal: string }[] = [];
            if (compareVal.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
              diffs.push({ field: 'Nome Completo', origVal: compareVal.name, recVal: name.trim() });
            }
            if ((compareVal.birthdate || '') !== (birthdate || '')) {
              diffs.push({ field: 'Data de Nascimento', origVal: formatDate(compareVal.birthdate), recVal: formatDate(birthdate) });
            }
            if ((compareVal.rm || '').trim() !== (rm || '').trim()) {
              diffs.push({ field: 'RM', origVal: compareVal.rm || 'Não informado', recVal: rm.trim() || 'Não informado' });
            }

            if (diffs.length > 0) {
              divergenciasMsg = `\n\n⚠️ Divergências Cadastrais Detectadas (Histórico Anterior x Novo Cadastro):\n` +
                diffs.map((d) => `• ${d.field}: "${d.origVal}" (Anterior) ➔ "${d.recVal}" (Novo)`).join('\n') +
                `\nVerifique se os dados estão corretos ou se houve erro de digitação.`;
            } else {
              divergenciasMsg = `\n\n✅ Auditoria Cadastral: Nenhum conflito detectado. Todos os dados cadastrais conferem 100% com o registro histórico.`;
            }

            // PONTO 3: Transpõe notas de TODAS as linhas da cadeia histórica (não apenas da última)
            const allSourceIds = Array.from(new Set([
              ...history.map((h) => h.id),
              ...(sourceItem ? [sourceItem.id] : [])
            ]));

            const transResult = await transporNotasParaReingresso(
              allSourceIds,
              newStudentId,
              selectedClassId,
              currentYear
            );
            const avisoParcial = transResult.parcial
              ? '\n\n⚠️ Atenção: Só as notas do seu próprio perfil foram verificadas. Notas lançadas por outros professores não foram consideradas; peça a um administrador para conferir.'
              : '';
            if (transResult.count > 0) {
              notasTranspostasMsg = `\n\n✨ Aproveitamento Automático de Notas:\nForam migradas com sucesso ${transResult.count} nota(s) do(s) ${transResult.bimesters.map((b) => `${b}º`).join(', ')} Bimestre(s) de todas as disciplinas já cursadas nesta escola (${allSourceIds.length} linha(s) anterior(es))!\nO histórico original continua 100% arquivado e preservado.${avisoParcial}`;
            } else if (avisoParcial) {
              notasTranspostasMsg = avisoParcial;
            }
          }
        }

        const isReingressoDetectado = status === 'recebida' || matchedHistoryCount > 0 || avisoDivergentesMsg !== '';
        setModal({
          isOpen: true,
          type: 'alert',
          title: isReingressoDetectado ? 'Aluno Adicionado (Reingresso / Histórico Integrado)' : 'Sucesso',
          message: isReingressoDetectado
            ? `Aluno(a) "${name.trim()}" cadastrado(a) com sucesso!${divergenciasMsg}${notasTranspostasMsg}${avisoDivergentesMsg}\n\n📝 Próximo Passo:\nAcesse o menu "Notas" caso precise complementar avaliações do período em que o aluno esteve fora (da guia de transferência trazida da outra escola).`
            : 'Aluno adicionado com sucesso!',
          icon: isReingressoDetectado ? '📝' : '✅'
        });
      }

      setName('');
      setRa('');
      setRm('');
      setBirthdate('');
      setStatus('ativo');
      setTransferDate('');
      setTransferInDate('');
      setTransferOutDate('');
      setHasTransferIn(false);
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
    const inDate = item.val.transferInDate || (item.val.status === 'recebida' ? item.val.transferDate : '') || '';
    const outDate = item.val.transferOutDate || (item.val.status === 'expedida' ? item.val.transferDate : '') || '';
    setTransferInDate(inDate);
    setTransferOutDate(outDate);
    setTransferDate(item.val.transferDate || (item.val.status === 'expedida' ? outDate : inDate) || '');
    setHasTransferIn(Boolean(inDate));
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
    setTransferInDate('');
    setTransferOutDate('');
    setHasTransferIn(false);
    setEditingId(null);
    setEditingOriginalClassId(null);
    calculateNextNumber(selectedClassId);
  };

  const handleCopyStudentToMemory = (item: { id: string; classId: string; val: Student }) => {
    const data: StudentClipboardData = {
      id: item.id,
      classId: item.classId,
      name: item.val.name,
      ra: item.val.ra,
      rm: item.val.rm || '',
      birthdate: item.val.birthdate,
      originalNumber: item.val.number,
      originalStatus: item.val.status,
      originalTransferOutDate: item.val.transferOutDate || (item.val.status === 'expedida' ? item.val.transferDate : '') || '',
      copiedAt: Date.now()
    };
    setStudentClipboard(data);
    try {
      sessionStorage.setItem('dc_student_clipboard', JSON.stringify(data));
    } catch {}
    setModal({
      isOpen: true,
      type: 'alert',
      title: 'Dados Gravados em Memória',
      message: `Os dados de "${item.val.name}" (RA: ${item.val.ra}) foram gravados em memória!\n\nAgora você pode clicar no botão "Colar Dados de Reingresso" na seção Novo Aluno para cadastrá-lo com o próximo número de chamada da turma.`,
      icon: '📋'
    });
  };

  const handleCopyCurrentFormToMemory = () => {
    if (!name.trim() || !ra.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Dados Incompletos',
        message: 'Nome e RA são obrigatórios para gravar o aluno em memória.',
        icon: '⚠️'
      });
    }
    const data: StudentClipboardData = {
      id: editingId || undefined,
      classId: selectedClassId,
      name: name.trim(),
      ra: ra.trim(),
      rm: rm.trim(),
      birthdate,
      originalNumber: Number(number) || 0,
      originalStatus: status,
      originalTransferOutDate: transferOutDate || (status === 'expedida' ? transferDate : '') || '',
      copiedAt: Date.now()
    };
    setStudentClipboard(data);
    try {
      sessionStorage.setItem('dc_student_clipboard', JSON.stringify(data));
    } catch {}
    setModal({
      isOpen: true,
      type: 'alert',
      title: 'Dados Gravados em Memória',
      message: `Os dados de "${data.name}" foram gravados em memória!\n\nVocê pode cancelar esta edição ou clicar em Novo Aluno para colar os dados com a numeração de chamada atualizada.`,
      icon: '📋'
    });
  };

  const handleClearClipboard = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setStudentClipboard(null);
    try {
      sessionStorage.removeItem('dc_student_clipboard');
    } catch {}
  };

  const handlePasteStudentFromMemory = async () => {
    if (!studentClipboard) return;

    // 1. Garante que sai do modo de edição para não sobrescrever o registro antigo
    setEditingId(null);
    setEditingOriginalClassId(null);

    // 2. Define a turma (mantém a selecionada ou adota a do aluno copiado)
    const targetClassId = selectedClassId || studentClipboard.classId;
    if (targetClassId && targetClassId !== selectedClassId) {
      setSelectedClassId(targetClassId);
    }

    // 3. Preenche os dados cadastrais copiados
    setName(studentClipboard.name);
    setRa(studentClipboard.ra);
    setRm(studentClipboard.rm || '');
    setBirthdate(studentClipboard.birthdate);

    // 4. Configura como Reingresso / Transferência Recebida (Entrada)
    setStatus('recebida');
    const today = new Date().toISOString().split('T')[0];
    setTransferInDate(today);
    setTransferDate(today);
    setTransferOutDate(studentClipboard.originalTransferOutDate || '');

    // 5. Calcula automaticamente o próximo número de chamada
    const nextNum = await calculateNextNumber(targetClassId);

    window.scrollTo({ top: 0, behavior: 'smooth' });

    setModal({
      isOpen: true,
      type: 'alert',
      title: 'Dados Colados com Sucesso',
      message: `Os dados de "${studentClipboard.name}" foram preenchidos para reingresso!\n\n• Nº de Chamada Atualizado: ${nextNum}\n• Status: Transferência Recebida (Entrada)\n• Data de Retorno: preenchida com a data de hoje (${formatDate(today)}), ajuste se necessário.\n\n📌 Lembrete Importante de Notas:\nApós salvar, acesse o menu "Notas" para transcrever as notas dos bimestres anteriores (aproveitamento de estudos). Assim, o Boletim Anual deste novo número terá a média anual completa dos 4 bimestres!\n\nConfira as informações e clique em "Adicionar Aluno" para salvar.`,
      icon: '✅'
    });
  };

  const handleQuickReingresso = async (item: { id: string; classId: string; val: Student }) => {
    // 1. Salva na memória
    const data: StudentClipboardData = {
      id: item.id,
      classId: item.classId,
      name: item.val.name,
      ra: item.val.ra,
      rm: item.val.rm || '',
      birthdate: item.val.birthdate,
      originalNumber: item.val.number,
      originalStatus: item.val.status,
      originalTransferOutDate: item.val.transferOutDate || (item.val.status === 'expedida' ? item.val.transferDate : '') || '',
      copiedAt: Date.now()
    };
    setStudentClipboard(data);
    try {
      sessionStorage.setItem('dc_student_clipboard', JSON.stringify(data));
    } catch {}

    // 2. Preenche imediatamente o formulário em modo Novo Aluno
    setEditingId(null);
    setEditingOriginalClassId(null);
    setSelectedClassId(item.classId);
    setName(item.val.name);
    setRa(item.val.ra);
    setRm(item.val.rm || '');
    setBirthdate(item.val.birthdate);
    setStatus('recebida');
    const today = new Date().toISOString().split('T')[0];
    setTransferInDate(today);
    setTransferDate(today);
    setTransferOutDate(data.originalTransferOutDate || '');

    const nextNum = await calculateNextNumber(item.classId);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setModal({
      isOpen: true,
      type: 'alert',
      title: 'Reingresso Preparado',
      message: `Dados de "${item.val.name}" carregados para novo cadastro!\n\n• Nº de Chamada Atribuído: ${nextNum} (final da turma)\n• Status: Transferência Recebida (Entrada)\n• Data de Retorno: ${formatDate(today)}\n\n📌 Lembrete de Escrituração (Notas Anteriores):\nO cadastro original com TR. EXP. continuará formalmente arquivado. Ao salvar, as notas dos bimestres anteriores já cursados nesta escola serão migradas automaticamente para este novo número!\n\nBasta clicar em "Adicionar Aluno" para concluir.`,
      icon: '🚀'
    });
  };

  const handleOpenComparisonModal = async (item: { id: string; classId: string; val: Student }) => {
    let matchedSource = students.find(
      (s) => s.id !== item.id && s.val.status === 'expedida' && saoRAsIguais(s.val.ra, item.val.ra)
    );
    if (!matchedSource) {
      const found = await buscarLinhaAnteriorAluno(item.val, item.id, item.classId, currentYear);
      if (found) {
        matchedSource = {
          id: found.id,
          classId: found.classId,
          val: found.val
        };
      }
    }
    if (!matchedSource) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Cadastro Anterior Não Localizado',
        message: `Não foi encontrado nenhum cadastro arquivado com status TR. EXP. e mesmo RA (${item.val.ra || 'Não informado'}) na escola para comparar.`,
        icon: 'ℹ️'
      });
    }

    const diffs: { field: string; origVal: string; recVal: string }[] = [];
    if (matchedSource.val.name.trim().toLowerCase() !== item.val.name.trim().toLowerCase()) {
      diffs.push({ field: 'Nome Completo', origVal: matchedSource.val.name, recVal: item.val.name });
    }
    if ((matchedSource.val.birthdate || '') !== (item.val.birthdate || '')) {
      diffs.push({ field: 'Data de Nascimento', origVal: formatDate(matchedSource.val.birthdate), recVal: formatDate(item.val.birthdate) });
    }
    if ((matchedSource.val.rm || '').trim() !== (item.val.rm || '').trim()) {
      diffs.push({ field: 'RM', origVal: matchedSource.val.rm || 'Não informado', recVal: item.val.rm || 'Não informado' });
    }

    setReingressoComparison({
      sourceStudent: matchedSource,
      targetStudent: item,
      divergences: diffs
    });
  };

  const handleTransporNotasManualmente = async (item: { id: string; classId?: string; val: Student }) => {
    const classIdToUse = item.classId || selectedClassId;
    const allHistory = await buscarTodasLinhasAnterioresAluno(item.val, item.id, classIdToUse, currentYear);

    if (allHistory.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Histórico Anterior Não Localizado',
        message: `Não foi encontrado nenhum cadastro arquivado com status TR. EXP. e mesmo RA (${item.val.ra || 'Não informado'}) na escola para transpor notas.`,
        icon: 'ℹ️'
      });
    }

    const matchedSource = allHistory[allHistory.length - 1];
    const allSourceIds = allHistory.map((h) => h.id);

    // Auditoria de divergências cadastrais
    const diffs: string[] = [];
    if (matchedSource.val.name.trim().toLowerCase() !== item.val.name.trim().toLowerCase()) {
      diffs.push(`• Nome: "${matchedSource.val.name}" ➔ "${item.val.name}"`);
    }
    if ((matchedSource.val.birthdate || '') !== (item.val.birthdate || '')) {
      diffs.push(`• Data Nasc: "${formatDate(matchedSource.val.birthdate)}" ➔ "${formatDate(item.val.birthdate)}"`);
    }
    if ((matchedSource.val.rm || '').trim() !== (item.val.rm || '').trim()) {
      diffs.push(`• RM: "${matchedSource.val.rm || 'Não informado'}" ➔ "${item.val.rm || 'Não informado'}"`);
    }

    const diffsMsg = diffs.length > 0
      ? `\n\n⚠️ Divergências Cadastrais Detectadas:\n${diffs.join('\n')}\n`
      : '\n\n✅ Dados cadastrais idênticos entre a saída e o retorno.\n';

    const multiInfo = allHistory.length > 1
      ? `\n• O histórico escolar possui ${allHistory.length} registros anteriores que serão consolidados cronologicamente.`
      : '';
    const qtdDivergentes = allHistory.filter((h) => h.identidade === 'divergente').length;
    const divergentesInfo = qtdDivergentes > 0
      ? `\n• ⚠️ ${qtdDivergentes} registro(s) têm nome e data de nascimento diferentes deste aluno. Confirme só se for a mesma pessoa.`
      : '';

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Aproveitamento de Estudos',
      message: `Deseja transpor automaticamente as notas de todas as disciplinas cursadas no histórico escolar deste aluno para este cadastro (Nº ${item.val.number})?${diffsMsg}${multiInfo}${divergentesInfo}\n• O cadastro original arquivado permanecerá 100% inalterado.\n• As notas serão replicadas para composição da Média Anual no novo número.`,
      icon: '✨',
      onConfirm: async () => {
        try {
          setLoading(true);

          if (!item.val.transferidoDe) {
            await update(ref(rtdb, `diario-classe/turmas/${classIdToUse}/alunos/${item.id}`), {
              transferidoDe: matchedSource.id
            });
          }

          const trans = await transporNotasParaReingresso(
            allSourceIds,
            item.id,
            classIdToUse,
            currentYear
          );

          if (trans.count > 0) {
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Notas Transpostas com Sucesso',
              message: `Foram migradas com sucesso ${trans.count} nota(s) do(s) ${trans.bimesters.map((b) => `${b}º`).join(', ')} Bimestre(s) para o aluno Nº ${item.val.number} (${allHistory.length} linha(s) anterior(es))!\n\nDisciplinas: ${trans.subjects.join(', ')}.\nO Boletim Anual agora possui o aproveitamento de estudos integrado!${trans.parcial ? '\n\n⚠️ Atenção: Só as notas do seu próprio perfil foram verificadas. Notas lançadas por outros professores não foram consideradas; peça a um administrador para conferir.' : ''}`,
              icon: '✅'
            });
          } else {
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Nenhuma Nota Encontrada',
              message: `Os cadastros anteriores arquivados ainda não possuem notas lançadas registradas nesta escola para o ano letivo ${currentYear}.${trans.parcial ? '\n\n⚠️ Atenção: Só as notas do seu próprio perfil foram verificadas. Notas lançadas por outros professores não foram consideradas; peça a um administrador para conferir.' : ''}`,
              icon: 'ℹ️'
            });
          }
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro na Transposição',
            message: formatFriendlyError(err, 'Não foi possível transpor as notas'),
            icon: '❌'
          });
        } finally {
          setLoading(false);
        }
      }
    });
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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-800">
              {editingId ? 'Editar Aluno' : 'Novo Aluno'}
            </h3>
            {!editingId && studentClipboard && (
              <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-xl shadow-2xs">
                <button
                  type="button"
                  id="btn-paste-student-clipboard"
                  onClick={handlePasteStudentFromMemory}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 hover:text-amber-950 transition cursor-pointer"
                  title={`Colar dados de ${studentClipboard.name} (Nº original: ${studentClipboard.originalNumber}) com nova numeração`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-amber-600" />
                  <span>Colar Dados Reingresso ({studentClipboard.name.split(' ')[0]})</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearClipboard}
                  className="p-0.5 text-slate-400 hover:text-slate-600 rounded-md text-xs cursor-pointer ml-1"
                  title="Limpar aluno da memória"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {editingId && status === 'expedida' && !students.some(s => s.id !== editingId && s.classId === selectedClassId && s.val.ra === ra.trim() && s.val.status !== 'expedida') && (
              <button
                type="button"
                id="btn-copy-form-student"
                onClick={handleCopyCurrentFormToMemory}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-xl transition cursor-pointer shadow-2xs"
                title="Gravar dados deste aluno com Transferência Expedida em memória para reingressar posteriormente com nova numeração"
              >
                <Copy className="w-3.5 h-3.5 text-indigo-600" />
                <span>Gravar em Memória (TR. EXP.)</span>
              </button>
            )}

            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
              >
                <X className="w-3 h-3" /> Cancelar Edição
              </button>
            )}
          </div>
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
                onChange={(e) => {
                  const newStatus = e.target.value as 'ativo' | 'recebida' | 'expedida';
                  setStatus(newStatus);
                  if (newStatus === 'recebida') {
                    setTransferOutDate('');
                    if (!transferInDate && transferDate) {
                      setTransferInDate(transferDate);
                    }
                  } else if (newStatus === 'expedida') {
                    if (!transferOutDate && transferDate) {
                      setTransferOutDate(transferDate);
                    }
                  } else {
                    setTransferOutDate('');
                  }
                }}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="ativo">Ativo</option>
                <option value="recebida">Transferência Recebida (Entrada)</option>
                <option value="expedida">Transferência Expedida (Saída)</option>
              </select>
            </div>

            {status === 'recebida' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data de Entrada (TR. REC.) *
                </label>
                <input
                  id="student-transfer-in-date-input"
                  type="date"
                  value={transferInDate}
                  onChange={(e) => {
                    setTransferInDate(e.target.value);
                    setTransferDate(e.target.value);
                  }}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>
            )}

            {status === 'expedida' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data de Saída (TR. EXP.) *
                </label>
                <input
                  id="student-transfer-out-date-input"
                  type="date"
                  value={transferOutDate}
                  onChange={(e) => {
                    setTransferOutDate(e.target.value);
                    setTransferDate(e.target.value);
                  }}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>
            )}

            {status === 'expedida' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data de Entrada Anterior (TR. REC.)
                  <span className="text-[10px] text-slate-400 font-normal ml-1">(Opcional)</span>
                </label>
                <input
                  id="student-transfer-in-prev-input"
                  type="date"
                  value={transferInDate}
                  onChange={(e) => setTransferInDate(e.target.value)}
                  placeholder="Se o aluno também ingressou por transferência"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            )}

            {status === 'ativo' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data de Entrada por Transferência
                  <span className="text-[10px] text-slate-400 font-normal ml-1">(Se houver)</span>
                </label>
                <input
                  id="student-transfer-in-active-input"
                  type="date"
                  value={transferInDate}
                  onChange={(e) => setTransferInDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          {matchingExpedidaHistory.length > 0 && (
            <div className="p-3.5 bg-blue-50/90 border border-blue-200/90 rounded-xl text-xs text-blue-950 flex items-start gap-2.5">
              <span className="text-lg leading-none shrink-0 mt-0.5">ℹ️</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <strong className="font-bold text-blue-900">Histórico de Transferência Expedida (Saída) Localizado</strong>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-200/70 text-blue-800 rounded-full">
                    {matchingExpedidaHistory.length} registro(s)
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-blue-800 leading-relaxed">
                  Existe cadastro arquivado com status <strong>Transferência Expedida</strong> e mesmo RA nesta escola:
                </p>
                <ul className="mt-1.5 space-y-1 text-[11px] text-blue-950 font-medium">
                  {matchingExpedidaHistory.map((m) => (
                    <li key={m.studentId} className="flex items-center gap-1.5">
                      <span className="text-blue-500">•</span>
                      <strong className="font-semibold">{m.student.name}</strong>
                      <span className="text-blue-700 font-normal">({m.className} - Nº {m.student.number})</span>
                      {m.student.transferOutDate && (
                        <span className="text-slate-500 font-normal text-[10px]">Saída em {formatDate(m.student.transferOutDate)}</span>
                      )}
                      {m.identidade === 'divergente' && (
                        <span className="text-amber-700 font-semibold text-[10px]">⚠️ nome e nascimento diferentes: não migra notas sozinho</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-blue-700 leading-tight">
                  {matchingExpedidaHistory.every((m) => m.identidade === 'divergente') ? (
                    <>Nome e data de nascimento <strong>não conferem</strong> com o cadastro arquivado: nenhuma nota será migrada automaticamente. Se for o mesmo aluno, use <strong>Puxar Notas</strong> depois de conferir.</>
                  ) : (
                    <>Ao salvar como <strong>{status === 'recebida' ? 'Transferência Recebida' : 'Ativo'}</strong>, o histórico será vinculado e as notas dos bimestres anteriores serão migradas automaticamente!</>
                  )}
                </p>
                {editingId && (
                  <button
                    type="button"
                    id="btn-form-transpor-notas"
                    onClick={() => {
                      const cur = students.find((s) => s.id === editingId);
                      if (cur) handleTransporNotasManualmente(cur);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Puxar Notas do Histórico Escolar ({matchingExpedidaHistory.length} registro(s))</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {status === 'recebida' && matchingExpedidaHistory.length === 0 && (
            <div className="p-3 bg-amber-50/80 border border-amber-200/90 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <span className="text-base leading-none shrink-0 mt-0.5">💡</span>
              <div className="flex-1">
                <strong className="font-bold">Lembrete de Escrituração (Aproveitamento de Estudos & Média Anual):</strong>
                <p className="mt-0.5 text-[11px] text-amber-800 leading-relaxed">
                  Para alunos com Transferência Recebida ou Reingresso, acesse o menu <strong>Notas</strong> para lançar as notas dos bimestres anteriores (transpondo do cadastro anterior arquivado ou da guia de transferência). Isso garante o cálculo completo da <strong>Média Anual</strong> nos Boletins.
                </p>
              </div>
            </div>
          )}

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
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-800">
              Alunos Cadastrados ({displayedStudents.length}
              {displayedStudents.length !== students.length ? ` de ${students.length}` : ''})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="btn-open-audit-transfers"
              onClick={() => setIsAuditModalOpen(true)}
              className="px-3.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl inline-flex items-center gap-1.5 transition-colors shadow-2xs"
              title="Auditar e corrigir datas de transferências (entrada e saída)"
            >
              <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
              Auditoria de Transferências
            </button>

            <div className="relative min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nome, RA..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <select
                id="filter-students-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
              >
                <option value="todos">Todos os Status</option>
                <option value="ativo">Apenas Ativos</option>
                <option value="transferencia">Com Transferência</option>
                <option value="recebida">Tr. Recebida</option>
                <option value="expedida">Tr. Expedida</option>
              </select>

              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  id="filter-students-class"
                  value={filterClassId}
                  onChange={(e) => setFilterClassId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
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
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando alunos...</div>
        ) : displayedStudents.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum aluno encontrado para os filtros selecionados.
          </div>
        ) : (
          <div className="space-y-3">
            {displayedStudents.map((item) => {
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
                          Ativo {student.transferInDate ? `(TR. REC. ${formatDate(student.transferInDate)})` : ''}
                        </span>
                      )}
                      {student.status === 'recebida' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                          TR. REC. {formatDate(student.transferInDate || student.transferDate)}
                        </span>
                      )}
                      {student.status === 'expedida' && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                            TR. EXP. {formatDate(student.transferOutDate || student.transferDate)}
                          </span>
                          {student.transferInDate && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                              Entrada: {formatDate(student.transferInDate)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      RA: {student.ra} {student.rm ? `| RM: ${student.rm}` : ''} | Nasc:{' '}
                      {formatDate(student.birthdate)} | Turma: {turmaStr}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {student.status === 'expedida' && (
                      (() => {
                        const hasActiveReingresso = students.some(
                          (other) =>
                            other.classId === item.classId &&
                            other.id !== item.id &&
                            other.val.ra === student.ra &&
                            other.val.status !== 'expedida'
                        );
                        if (hasActiveReingresso) {
                          return (
                            <span
                              className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1"
                              title="Este aluno já possui matrícula ativa de reingresso nesta turma"
                            >
                              <UserCheck className="w-3 h-3 text-emerald-600" />
                              <span>Reingressado</span>
                            </span>
                          );
                        }
                        return (
                          <>
                            <button
                              id={`student-reingresso-fast-${item.id}`}
                              onClick={() => handleQuickReingresso(item)}
                              className="p-1.5 text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-bold cursor-pointer"
                              title="Reingressar este aluno: copia os dados cadastrais e preenche Novo Aluno com a próxima numeração da turma"
                            >
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="hidden md:inline">Reingressar</span>
                            </button>
                            <button
                              id={`student-copy-${item.id}`}
                              onClick={() => handleCopyStudentToMemory(item)}
                              className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-50 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="Gravar dados deste aluno em memória para reingresso com nova numeração"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span className="hidden lg:inline">Gravar</span>
                            </button>
                          </>
                        );
                      })()
                    )}
                    {student.status !== 'expedida' && (
                      student.status === 'recebida' ||
                      Boolean(student.transferidoDe) ||
                      students.some(
                        (other) =>
                          other.id !== item.id &&
                          other.val.status === 'expedida' &&
                          saoRAsIguais(other.val.ra, student.ra)
                      )
                    ) && (
                      <>
                        <button
                          id={`student-compare-reingresso-${item.id}`}
                          onClick={() => handleOpenComparisonModal(item)}
                          className="p-1.5 text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-bold cursor-pointer"
                          title="Auditar e comparar dados cadastrais com o histórico de saída original (TR. EXP)"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
                          <span className="hidden lg:inline">Auditar / Comparar</span>
                        </button>
                        <button
                          id={`student-transpor-notas-${item.id}`}
                          onClick={() => handleTransporNotasManualmente(item)}
                          className="p-1.5 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-bold cursor-pointer"
                          title="Puxar notas de todas as matérias cursadas no histórico escolar deste aluno arquivado"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          <span className="hidden md:inline">Puxar Notas</span>
                        </button>
                      </>
                    )}
                    <button
                      id={`student-evolution-${item.id}`}
                      onClick={() =>
                        setEvolutionChartStudent({
                          studentId: item.id,
                          classId: item.classId,
                          turma: classes.find((c) => c.id === item.classId)?.val || null
                        })
                      }
                      className="p-1.5 text-indigo-700 hover:text-indigo-900 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200/60 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                      title="Ver Gráfico de Evolução e Trajetória de Desempenho deste aluno"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="hidden xl:inline">Trajetória</span>
                    </button>
                    {isAdmin && (
                      <button
                        id={`student-transfer-${item.id}`}
                        onClick={() => {
                          setStudentToTransfer(item);
                          setIsTransferModalOpen(true);
                        }}
                        className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                        title="Transferir este aluno para outra turma/escola"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Transferir</span>
                      </button>
                    )}
                    <button
                      id={`student-edit-${item.id}`}
                      onClick={() => handleEdit(item)}
                      className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="Editar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      id={`student-delete-${item.id}`}
                      onClick={() => handleDelete(item.classId, item.id, item.val.name)}
                      className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Excluir"
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

      {/* Modal de Auditoria e Correção Rápida de Transferências */}
      <AuditTransfersModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        currentYear={currentYear}
        classes={classes}
        onSaved={() => {
          loadStudents();
          loadClasses();
        }}
        setModal={setModal}
      />

      {/* Modal de Auditoria e Comparativo de Reingresso (TR EXP vs TR REC) */}
      {reingressoComparison && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-slate-800 text-base">
                  Auditoria de Reingresso: Comparativo Cadastral
                </h3>
              </div>
              <button
                onClick={() => setReingressoComparison(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Cadastro Original de Saída */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-slate-800 text-sm">
                      1. Cadastro Original (Saída)
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                      TR. EXPEDIDA
                    </span>
                  </div>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-slate-400 font-medium">Nº de Chamada Antigo:</dt>
                      <dd className="font-bold text-slate-900">Nº {reingressoComparison.sourceStudent.val.number}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Nome Completo:</dt>
                      <dd className="font-bold text-slate-900">{reingressoComparison.sourceStudent.val.name}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">R.A.:</dt>
                      <dd className="font-mono text-slate-800">{reingressoComparison.sourceStudent.val.ra}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">R.M.:</dt>
                      <dd className="font-mono text-slate-800">{reingressoComparison.sourceStudent.val.rm || 'Não informado'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Data de Nascimento:</dt>
                      <dd className="font-medium text-slate-800">{formatDate(reingressoComparison.sourceStudent.val.birthdate)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Data de Saída:</dt>
                      <dd className="font-medium text-rose-700">
                        {formatDate(reingressoComparison.sourceStudent.val.transferOutDate || reingressoComparison.sourceStudent.val.transferDate)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Cadastro Atual de Reingresso */}
                <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-indigo-950 text-sm">
                      2. Cadastro Atual (Retorno)
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      TR. RECEBIDA
                    </span>
                  </div>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-slate-400 font-medium">Nº de Chamada Atual:</dt>
                      <dd className="font-bold text-indigo-700">Nº {reingressoComparison.targetStudent.val.number}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Nome Completo:</dt>
                      <dd className="font-bold text-slate-900">{reingressoComparison.targetStudent.val.name}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">R.A.:</dt>
                      <dd className="font-mono text-slate-800">{reingressoComparison.targetStudent.val.ra}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">R.M.:</dt>
                      <dd className="font-mono text-slate-800">{reingressoComparison.targetStudent.val.rm || 'Não informado'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Data de Nascimento:</dt>
                      <dd className="font-medium text-slate-800">{formatDate(reingressoComparison.targetStudent.val.birthdate)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-medium">Data de Retorno:</dt>
                      <dd className="font-medium text-emerald-700">
                        {formatDate(reingressoComparison.targetStudent.val.transferInDate || reingressoComparison.targetStudent.val.transferDate)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Status de Divergências */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <h4 className="font-bold text-slate-800 mb-2">
                  Divergências Cadastrais Detectadas:
                </h4>
                {reingressoComparison.divergences.length === 0 ? (
                  <div className="flex items-center gap-2 text-emerald-700 font-medium text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Nenhuma divergência encontrada! Todos os dados (Nome, RA, RM, Nascimento) conferem 100%.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reingressoComparison.divergences.map((div, dIdx) => (
                      <div key={dIdx} className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between">
                        <span className="font-bold text-amber-900">{div.field}</span>
                        <div className="flex items-center gap-2">
                          <span className="line-through text-slate-400">{div.origVal}</span>
                          <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
                          <span className="font-bold text-slate-800">{div.recVal}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ações Rápidas */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 gap-3">
                <span className="text-[11px] text-indigo-900">
                  Deseja transpor as notas cursadas pelo aluno no cadastro original para o número atual?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const tgt = reingressoComparison.targetStudent;
                    setReingressoComparison(null);
                    handleTransporNotasManualmente(tgt);
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition shrink-0 cursor-pointer"
                >
                  Puxar Notas Agora
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setReingressoComparison(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL: GRÁFICO DE EVOLUÇÃO E TRAJETÓRIA */}
      {evolutionChartStudent && (
        <StudentEvolutionChartModal
          isOpen={true}
          onClose={() => setEvolutionChartStudent(null)}
          classId={evolutionChartStudent.classId}
          turma={evolutionChartStudent.turma}
          initialStudentId={evolutionChartStudent.studentId}
          currentYear={currentYear}
          teacherName=""
        />
      )}
    </div>
  );
};
