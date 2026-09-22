import React, { useState, useEffect } from 'react';
import { Book, BookLoan, ClassRoom, Student, ModalConfig, School, ReadingCornerBook } from '../types';
import {
  carregarCantinhos,
  alocarLivroCantinho,
  retornarLivroCantinho,
  emprestarLivroCantinho,
  devolverEmprestimoCantinho,
  reconciliarEstoqueCantinho,
  getCurrentAuthUid
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import { exportToExcelJS, ExcelColumnDef } from '../lib/excelExport';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  RotateCcw,
  ArrowRightLeft,
  GraduationCap,
  Layers,
  Sparkles,
  Calendar,
  User,
  Building2,
  FileSpreadsheet,
  BookMarked,
  Info,
  Loader2,
  Check,
  X,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

interface ReadingCornerTabProps {
  books: Array<{ id: string; val: Book }>;
  classes: Array<{ id: string; val: ClassRoom }>;
  schools: School[];
  loans: Array<{ id: string; val: BookLoan }>;
  canManage: boolean;
  canLoan: boolean;
  isAdmin: boolean;
  selectedSchoolFilter: string;
  currentYear: string;
  preselectedBookForAllocation?: { id: string; val: Book } | null;
  onClearPreselectedBook?: () => void;
  onDataChanged: () => Promise<void>;
  setModal: (config: ModalConfig) => void;
}

export const ReadingCornerTab: React.FC<ReadingCornerTabProps> = ({
  books,
  classes,
  schools,
  loans,
  canManage,
  canLoan,
  isAdmin,
  selectedSchoolFilter,
  currentYear,
  preselectedBookForAllocation,
  onClearPreselectedBook,
  onDataChanged,
  setModal
}) => {
  const [cornerBooks, setCornerBooks] = useState<Array<{ id: string; val: ReadingCornerBook }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTurmaFilter, setSelectedTurmaFilter] = useState<string>('todas');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<'estante' | 'emprestimos' | 'historico'>('estante');

  // Modal Alocação (Enviar livro do acervo para o cantinho)
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState<boolean>(false);
  const [allocTurmaId, setAllocTurmaId] = useState<string>('');
  const [allocBookId, setAllocBookId] = useState<string>('');
  const [allocCopies, setAllocCopies] = useState<number>(1);
  const [allocNotes, setAllocNotes] = useState<string>('');
  const [processingAlloc, setProcessingAlloc] = useState<boolean>(false);

  // Modal Empréstimo Rápido (aluno leva livro do cantinho)
  const [isCornerLoanModalOpen, setIsCornerLoanModalOpen] = useState<boolean>(false);
  const [loanCornerBook, setLoanCornerBook] = useState<{ id: string; val: ReadingCornerBook } | null>(null);
  const [cornerStudentId, setCornerStudentId] = useState<string>('');
  const [cornerDueDate, setCornerDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [cornerLoanNotes, setCornerLoanNotes] = useState<string>('');
  const [processingCornerLoan, setProcessingCornerLoan] = useState<boolean>(false);

  // Modal Retorno ao Acervo Central
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [returnCornerBook, setReturnCornerBook] = useState<{ id: string; val: ReadingCornerBook } | null>(null);
  const [returnCopies, setReturnCopies] = useState<number>(1);
  const [processingReturn, setProcessingReturn] = useState<boolean>(false);

  // Modal Devolução de Aluno (dar baixa de livro retirado do cantinho)
  const [isStudentReturnModalOpen, setIsStudentReturnModalOpen] = useState<boolean>(false);
  const [selectedLoanForReturn, setSelectedLoanForReturn] = useState<{ id: string; val: BookLoan } | null>(null);
  const [studentReturnNotes, setStudentReturnNotes] = useState<string>('');
  const [processingStudentReturn, setProcessingStudentReturn] = useState<boolean>(false);
  const [syncingStock, setSyncingStock] = useState<boolean>(false);

  // Carrega os livros do Cantinho da Leitura
  const loadCornerData = async () => {
    setLoading(true);
    try {
      const list = await carregarCantinhos();
      list.sort((a, b) => (a.val.bookTitle || '').localeCompare(b.val.bookTitle || ''));
      setCornerBooks(list);
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Cantinho da Leitura',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  // Sincronização e auditoria do estoque do Cantinho (repara contagens presas)
  const handleSyncStock = async () => {
    setSyncingStock(true);
    try {
      const turmaFiltro = selectedTurmaFilter !== 'todas' ? selectedTurmaFilter : undefined;
      const res = await reconciliarEstoqueCantinho(turmaFiltro);
      await loadCornerData();
      await onDataChanged();

      if (res.corrigidos > 0) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Estoque Sincronizado com Sucesso!',
          message: `${res.corrigidos} obra(s) tiveram sua contagem corrigida e seus exemplares foram devidamente liberados na estante da sala de aula.`,
          icon: '✅'
        });
      } else {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Estoque 100% Sincronizado',
          message: `Todos os ${res.totalVerificados} registros de livros analisados já estão perfeitamente alinhados com os empréstimos ativos da turma.`,
          icon: '✨'
        });
      }
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Sincronizar Estoque',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setSyncingStock(false);
    }
  };

  useEffect(() => {
    loadCornerData();
  }, [currentYear]);

  // Se vier um livro pré-selecionado para alocação a partir do Acervo
  useEffect(() => {
    if (preselectedBookForAllocation) {
      setAllocBookId(preselectedBookForAllocation.id);
      setAllocCopies(1);
      setAllocNotes('Alocado a partir do acervo central');
      if (classes.length > 0) {
        setAllocTurmaId(classes[0].id);
      }
      setIsAllocateModalOpen(true);
      if (onClearPreselectedBook) {
        onClearPreselectedBook();
      }
    }
  }, [preselectedBookForAllocation]);

  // Filtragem das turmas válidas de acordo com o filtro de escola
  const availableClasses = classes.filter((c) => {
    if (selectedSchoolFilter !== 'todas') {
      return c.val?.schoolId === selectedSchoolFilter;
    }
    return true;
  });

  // Filtragem dos livros do cantinho
  const filteredCornerBooks = cornerBooks.filter((item) => {
    // Filtro de Escola
    if (selectedSchoolFilter !== 'todas') {
      const cls = classes.find((c) => c.id === item.val.turmaId);
      if (cls?.val?.schoolId && cls.val.schoolId !== selectedSchoolFilter) {
        return false;
      }
    }

    // Filtro de Turma
    if (selectedTurmaFilter !== 'todas' && item.val.turmaId !== selectedTurmaFilter) {
      return false;
    }

    // Busca textual
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchTitle = (item.val.bookTitle || '').toLowerCase().includes(q);
      const matchAuthor = (item.val.bookAuthor || '').toLowerCase().includes(q);
      const matchCode = (item.val.bookCode || '').toLowerCase().includes(q);
      const matchTurma = (item.val.turmaName || '').toLowerCase().includes(q);
      return matchTitle || matchAuthor || matchCode || matchTurma;
    }

    return true;
  });

  // Empréstimos ativos e concluídos vinculados ao cantinho da leitura
  const cornerLoans = loans.filter((l) => {
    const isFromCorner = l.val.isReadingCorner === true || Boolean(l.val.readingCornerTurmaId);
    if (!isFromCorner) return false;

    if (selectedTurmaFilter !== 'todas') {
      if (l.val.readingCornerTurmaId !== selectedTurmaFilter && l.val.classId !== selectedTurmaFilter) {
        return false;
      }
    }

    if (selectedSchoolFilter !== 'todas') {
      const cls = classes.find((c) => c.id === (l.val.readingCornerTurmaId || l.val.classId));
      if (cls?.val?.schoolId && cls.val.schoolId !== selectedSchoolFilter) {
        return false;
      }
    }

    return true;
  });

  const activeCornerLoans = cornerLoans.filter((l) => l.val.status !== 'devolvido');
  const completedCornerLoans = cornerLoans.filter((l) => l.val.status === 'devolvido');

  // Indicadores de resumo
  const totalCornerCopies = filteredCornerBooks.reduce((acc, b) => acc + (b.val.totalCopies || 0), 0);
  const totalAvailableInShelf = filteredCornerBooks.reduce((acc, b) => acc + (b.val.availableCopies || 0), 0);
  const totalLoanedToStudents = Math.max(0, totalCornerCopies - totalAvailableInShelf);

  // Abertura do Modal de Alocação
  const handleOpenAllocateModal = (bookId?: string) => {
    setAllocBookId(bookId || '');
    setAllocCopies(1);
    setAllocNotes('');
    if (availableClasses.length > 0 && !allocTurmaId) {
      setAllocTurmaId(availableClasses[0].id);
    }
    setIsAllocateModalOpen(true);
  };

  // Submissão da Alocação para o Cantinho
  const handleSubmitAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocTurmaId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione a Turma',
        message: 'Por favor, selecione para qual sala de aula os livros serão disponibilizados.',
        icon: '⚠️'
      });
      return;
    }

    if (!allocBookId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione a Obra',
        message: 'Por favor, escolha o livro do acervo que irá para o cantinho da leitura.',
        icon: '⚠️'
      });
      return;
    }

    const selectedClass = classes.find((c) => c.id === allocTurmaId);
    const selectedBook = books.find((b) => b.id === allocBookId);
    if (!selectedClass || !selectedBook) return;

    const classSchoolId = selectedClass.val.schoolId || selectedBook.val.schoolId || (schools[0]?.id || '');
    const classSchoolObj = schools.find((s) => s.id === classSchoolId);
    const schoolName = classSchoolObj?.name || selectedClass.val.schoolName || 'Escola Municipal';

    // Validação de exemplares disponíveis na escola correspondente
    let availableInAcervo = selectedBook.val.availableCopies || 0;
    if (selectedBook.val.copiesBySchool && selectedBook.val.copiesBySchool[classSchoolId]) {
      availableInAcervo = selectedBook.val.copiesBySchool[classSchoolId].availableCopies || 0;
    }

    if (availableInAcervo < allocCopies) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exemplares Insuficientes no Acervo',
        message: `Existem apenas ${availableInAcervo} exemplar(es) disponível(is) no acervo central desta escola. Não é possível alocar ${allocCopies}.`,
        icon: '⚠️'
      });
      return;
    }

    const turmaDisplayName = `${selectedClass.val.year}º ${selectedClass.val.letter} (${selectedClass.val.shift || 'Sala'})`;

    setProcessingAlloc(true);
    try {
      await alocarLivroCantinho({
        turmaId: allocTurmaId,
        turmaName: turmaDisplayName,
        schoolId: classSchoolId,
        schoolName,
        bookId: selectedBook.id,
        bookTitle: selectedBook.val.title,
        bookAuthor: selectedBook.val.author,
        bookCode: selectedBook.val.code,
        coverUrl: selectedBook.val.coverUrl,
        genre: selectedBook.val.genre,
        copiesToAllocate: allocCopies,
        notes: allocNotes.trim() || undefined
      });

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Livro Disponibilizado!',
        message: `${allocCopies} exemplar(es) de "${selectedBook.val.title}" agora estão disponíveis no Cantinho da Leitura da turma ${turmaDisplayName}.`,
        icon: '📚'
      });

      setIsAllocateModalOpen(false);
      await loadCornerData();
      await onDataChanged();
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Disponibilizar Livro',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setProcessingAlloc(false);
    }
  };

  // Abertura do Modal de Empréstimo do Cantinho
  const handleOpenCornerLoan = (item: { id: string; val: ReadingCornerBook }) => {
    setLoanCornerBook(item);
    setCornerStudentId('');
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setCornerDueDate(d.toISOString().split('T')[0]);
    setCornerLoanNotes('');
    setIsCornerLoanModalOpen(true);
  };

  // Submissão de Empréstimo em Sala de Aula
  const handleSubmitCornerLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanCornerBook) return;

    if (!cornerStudentId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione o Aluno',
        message: 'Por favor, selecione qual aluno da turma está levando o livro do cantinho.',
        icon: '⚠️'
      });
      return;
    }

    const targetClass = classes.find((c) => c.id === loanCornerBook.val.turmaId);
    const studentsList: Student[] = targetClass?.val?.alunos
      ? Object.keys(targetClass.val.alunos).map((k) => ({
          ...targetClass.val.alunos![k],
          id: k
        }))
      : [];

    const selectedStudent = studentsList.find((s) => s.id === cornerStudentId);
    if (!selectedStudent) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Aluno Não Encontrado',
        message: 'Registro do aluno não encontrado na turma.',
        icon: '⚠️'
      });
      return;
    }

    setProcessingCornerLoan(true);
    try {
      await emprestarLivroCantinho({
        turmaId: loanCornerBook.val.turmaId,
        turmaName: loanCornerBook.val.turmaName,
        schoolId: loanCornerBook.val.schoolId,
        schoolName: loanCornerBook.val.schoolName,
        bookId: loanCornerBook.val.bookId,
        bookTitle: loanCornerBook.val.bookTitle,
        bookCode: loanCornerBook.val.bookCode,
        studentId: selectedStudent.id!,
        studentName: selectedStudent.name,
        studentNumber: selectedStudent.number,
        studentRa: selectedStudent.ra,
        dueDate: cornerDueDate,
        notes: cornerLoanNotes.trim() || undefined
      });

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Retirada Registrada!',
        message: `O exemplar de "${loanCornerBook.val.bookTitle}" foi retirado do cantinho por "${selectedStudent.name}". Previsão de devolução: ${formatDate(cornerDueDate)}.`,
        icon: '🎉'
      });

      setIsCornerLoanModalOpen(false);
      await loadCornerData();
      await onDataChanged();
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Registrar Retirada',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setProcessingCornerLoan(false);
    }
  };

  // Abertura do Modal de Retorno ao Acervo Central
  const handleOpenReturnToCentral = (item: { id: string; val: ReadingCornerBook }) => {
    setReturnCornerBook(item);
    setReturnCopies(Math.min(1, item.val.availableCopies || 1));
    setIsReturnModalOpen(true);
  };

  // Submissão do Retorno ao Acervo Central
  const handleSubmitReturnToCentral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnCornerBook) return;

    const avail = returnCornerBook.val.availableCopies || 0;
    if (avail < returnCopies) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exemplares Indisponíveis na Sala',
        message: `Apenas ${avail} exemplar(es) estão na estante da sala no momento (outros podem estar emprestados a alunos).`,
        icon: '⚠️'
      });
      return;
    }

    setProcessingReturn(true);
    try {
      await retornarLivroCantinho({
        turmaId: returnCornerBook.val.turmaId,
        turmaName: returnCornerBook.val.turmaName,
        schoolId: returnCornerBook.val.schoolId,
        schoolName: returnCornerBook.val.schoolName,
        bookId: returnCornerBook.val.bookId,
        bookTitle: returnCornerBook.val.bookTitle,
        bookCode: returnCornerBook.val.bookCode,
        copiesToReturn: returnCopies
      });

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exemplares Retornados!',
        message: `${returnCopies} exemplar(es) de "${returnCornerBook.val.bookTitle}" voltaram ao acervo central da biblioteca com sucesso.`,
        icon: '🔄'
      });

      setIsReturnModalOpen(false);
      await loadCornerData();
      await onDataChanged();
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Retornar Livro',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setProcessingReturn(false);
    }
  };

  // Abertura do Modal de Devolução de Aluno para o Cantinho
  const handleOpenStudentReturn = (loan: { id: string; val: BookLoan }) => {
    setSelectedLoanForReturn(loan);
    setStudentReturnNotes('');
    setIsStudentReturnModalOpen(true);
  };

  // Submissão de Devolução de Aluno ao Cantinho
  const handleSubmitStudentReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoanForReturn) return;

    setProcessingStudentReturn(true);
    try {
      await devolverEmprestimoCantinho(selectedLoanForReturn.id, studentReturnNotes.trim() || undefined);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Livro Devolvido ao Cantinho!',
        message: `O livro "${selectedLoanForReturn.val.bookTitle}" foi devolvido por "${selectedLoanForReturn.val.studentName}" e já está novamente disponível na estante da sala de aula.`,
        icon: '✅'
      });

      setIsStudentReturnModalOpen(false);
      await loadCornerData();
      await onDataChanged();
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Devolução',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setProcessingStudentReturn(false);
    }
  };

  // Exportação em Excel do Cantinho da Leitura
  const handleExportCornerExcel = async () => {
    if (filteredCornerBooks.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Cantinho Vazio',
        message: 'Nenhuma obra alocada para exportação.',
        icon: 'ℹ️'
      });
      return;
    }

    const columns: ExcelColumnDef[] = [
      { header: 'Turma / Sala', key: 'turma', width: 22, align: 'left' },
      { header: 'Título da Obra', key: 'title', width: 35, align: 'left' },
      { header: 'Autor(a)', key: 'author', width: 25, align: 'left' },
      { header: 'Código / ISBN', key: 'code', width: 18, align: 'center' },
      { header: 'Gênero', key: 'genre', width: 18, align: 'left' },
      { header: 'Total na Sala', key: 'total', width: 16, align: 'center' },
      { header: 'Na Estante (Livres)', key: 'available', width: 18, align: 'center' },
      { header: 'Com Alunos', key: 'loaned', width: 16, align: 'center' },
      { header: 'Data Alocação', key: 'date', width: 18, align: 'center' },
      { header: 'Observações / Projeto', key: 'notes', width: 30, align: 'left' }
    ];

    const rows = filteredCornerBooks.map((item) => ({
      turma: item.val.turmaName,
      title: item.val.bookTitle,
      author: item.val.bookAuthor || '-',
      code: item.val.bookCode || '-',
      genre: item.val.genre || '-',
      total: item.val.totalCopies,
      available: item.val.availableCopies,
      loaned: Math.max(0, (item.val.totalCopies || 0) - (item.val.availableCopies || 0)),
      date: new Date(item.val.allocatedAt).toLocaleDateString('pt-BR'),
      notes: item.val.notes || '-'
    }));

    await exportToExcelJS({
      title: 'Cantinho da Leitura em Sala de Aula - Inventário',
      year: currentYear,
      columns,
      rows,
      filename: `cantinho_leitura_${currentYear}.xlsx`
    });
  };

  // Alunos da turma selecionada no empréstimo
  const currentLoanClass = loanCornerBook ? classes.find((c) => c.id === loanCornerBook.val.turmaId) : null;
  const studentsOfCurrentClass: Student[] = currentLoanClass?.val?.alunos
    ? Object.keys(currentLoanClass.val.alunos)
        .map((k) => ({
          ...currentLoanClass.val.alunos![k],
          id: k
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Livros disponíveis do acervo para disponibilizar no modal de alocação
  const availableAcervoBooks = books.filter((b) => {
    if (!allocTurmaId) return (b.val.availableCopies || 0) > 0;
    const targetClass = classes.find((c) => c.id === allocTurmaId);
    const targetSchoolId = targetClass?.val?.schoolId;
    if (targetSchoolId && b.val.copiesBySchool && b.val.copiesBySchool[targetSchoolId]) {
      return (b.val.copiesBySchool[targetSchoolId].availableCopies || 0) > 0;
    }
    return (b.val.availableCopies || 0) > 0;
  });

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      {/* Banner Explicativo do Cantinho da Leitura */}
      <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-cyan-900 text-white rounded-3xl p-4 sm:p-6 shadow-sm border border-emerald-700/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-semibold text-emerald-200 border border-white/10">
            <Layers className="w-3.5 h-3.5" />
            <span>Biblioteca em Sala de Aula</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Cantinho da Leitura
          </h2>
          <p className="text-emerald-100/90 text-xs sm:text-sm leading-relaxed">
            Espaço pedagógico na sala de aula com livros selecionados diretamente do acervo da biblioteca escolar.
            Ao disponibilizar obras aqui, elas saem temporariamente do acervo central e ficam ao alcance imediato dos alunos para folhear, ler em sala ou levar para casa.
          </p>
        </div>

        {/* Ações do Banner */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {(canManage || canLoan) && (
            <button
              id="btn-disponibilizar-cantinho"
              onClick={() => handleOpenAllocateModal()}
              disabled={books.length === 0 || availableClasses.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded-xl text-sm font-bold shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Disponibilizar Obras no Cantinho</span>
            </button>
          )}

          <button
            id="btn-sync-corner-stock"
            onClick={handleSyncStock}
            disabled={syncingStock || cornerBooks.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl text-xs sm:text-sm font-bold backdrop-blur-sm transition cursor-pointer disabled:opacity-50"
            title="Sincronizar e auditar estoque do Cantinho (corrige contagens presas)"
          >
            <RefreshCw className={`w-4 h-4 text-cyan-300 ${syncingStock ? 'animate-spin' : ''}`} />
            <span>{syncingStock ? 'Sincronizando...' : 'Sincronizar Estoque'}</span>
          </button>

          <button
            id="btn-export-corner-xlsx"
            onClick={handleExportCornerExcel}
            disabled={filteredCornerBooks.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl text-xs sm:text-sm font-bold backdrop-blur-sm transition cursor-pointer disabled:opacity-50"
            title="Exportar inventário do Cantinho da Leitura em Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
            <span>Exportar (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Cartões Rápidos de Métricas do Cantinho */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <BookMarked className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Obras em Salas</span>
            <span className="text-xl sm:text-2xl font-black text-slate-800">{filteredCornerBooks.length}</span>
            <span className="text-[10px] text-slate-500 block">{totalCornerCopies} exemplares</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-teal-50 text-teal-600 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Na Estante (Livres)</span>
            <span className="text-xl sm:text-2xl font-black text-teal-800">{totalAvailableInShelf}</span>
            <span className="text-[10px] text-slate-500 block">prontos para leitura</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Com Alunos</span>
            <span className="text-xl sm:text-2xl font-black text-indigo-800">{totalLoanedToStudents}</span>
            <span className="text-[10px] text-slate-500 block">retirados para casa</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Empréstimos Ativos</span>
            <span className="text-xl sm:text-2xl font-black text-amber-700">{activeCornerLoans.length}</span>
            <span className="text-[10px] text-slate-500 block">circulação em sala</span>
          </div>
        </div>
      </div>

      {/* Sub-Navegação e Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Abas internas */}
        <div className="grid grid-cols-3 gap-1 sm:flex sm:items-center sm:gap-1.5 p-1 bg-slate-100 rounded-xl w-full sm:w-fit">
          <button
            onClick={() => setActiveSubTab('estante')}
            className={`px-1.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 min-w-0 ${
              activeSubTab === 'estante'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
            <span className="sm:hidden">Estante ({filteredCornerBooks.length})</span>
            <span className="hidden sm:inline">Estante da Sala ({filteredCornerBooks.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('emprestimos')}
            className={`px-1.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 min-w-0 ${
              activeSubTab === 'emprestimos'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
            <span className="sm:hidden">Ativos ({activeCornerLoans.length})</span>
            <span className="hidden sm:inline">Empréstimos Ativos ({activeCornerLoans.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('historico')}
            className={`px-1.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 min-w-0 ${
              activeSubTab === 'historico'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Histórico ({completedCornerLoans.length})</span>
          </button>
        </div>

        {/* Controles de Busca e Filtro de Turma */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 min-w-0">
          {/* Seletor de Turma */}
          <div className="flex items-center gap-2 min-w-0">
            <GraduationCap className="w-4 h-4 text-slate-400 hidden sm:inline" />
            <select
              id="select-corner-turma-filter"
              value={selectedTurmaFilter}
              onChange={(e) => setSelectedTurmaFilter(e.target.value)}
              className="w-full sm:w-auto min-w-0 max-w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="todas">🏫 Todas as Turmas / Salas</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.val.year}º {c.val.letter} ({c.val.shift || 'Sala'})
                </option>
              ))}
            </select>
          </div>

          {/* Campo de Busca */}
          <div className="relative w-full sm:w-auto sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar livro ou autor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* CONTEÚDO 1: ESTANTE DA SALA DE AULA */}
      {activeSubTab === 'estante' && (
        <>
          {loading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
              <p className="text-sm font-semibold">Carregando cantinho da leitura...</p>
            </div>
          ) : filteredCornerBooks.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">
                Nenhum livro disponibilizado no cantinho ainda
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md mx-auto">
                O professor ou o bibliotecário podem selecionar títulos do acervo central da escola e colocá-los à disposição da turma diretamente em sala de aula.
              </p>
              {(canManage || canLoan) && (
                <button
                  onClick={() => handleOpenAllocateModal()}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Selecionar Livros do Acervo para o Cantinho</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredCornerBooks.map((item) => {
                const isFullyLoaned = (item.val.availableCopies || 0) === 0;
                const loanedCount = Math.max(0, (item.val.totalCopies || 0) - (item.val.availableCopies || 0));

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:shadow-md transition flex flex-col justify-between min-w-0"
                  >
                    <div>
                      {/* Topo do Card: Badge da Turma e Disponibilidade */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg text-[11px] font-bold">
                          <GraduationCap className="w-3 h-3 text-emerald-600" />
                          <span className="truncate max-w-[150px]">{item.val.turmaName}</span>
                        </span>

                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                            isFullyLoaned
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          {isFullyLoaned ? 'Todos em Uso' : `${item.val.availableCopies} na Estante`}
                        </span>
                      </div>

                      {/* Capa e Dados da Obra */}
                      <div className="flex gap-3">
                        {item.val.coverUrl ? (
                          <img
                            src={item.val.coverUrl}
                            alt={item.val.bookTitle}
                            className="w-16 h-24 object-cover rounded-xl shadow-xs border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-16 h-24 bg-gradient-to-br from-emerald-100 to-teal-50 rounded-xl flex items-center justify-center text-emerald-700 shrink-0 border border-emerald-200">
                            <BookOpen className="w-6 h-6 opacity-70" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
                            {item.val.bookTitle}
                          </h4>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {item.val.bookAuthor || 'Autor Desconhecido'}
                          </p>
                          {item.val.bookCode && (
                            <span className="text-[10px] font-mono text-slate-400 block mt-1">
                              Tombamento: {item.val.bookCode}
                            </span>
                          )}
                          {item.val.genre && (
                            <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium mt-1.5">
                              {item.val.genre}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Resumo de Exemplares da Sala */}
                      <div className="mt-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 block uppercase">Na Sala</span>
                          <strong className="text-slate-800">{item.val.totalCopies} ex.</strong>
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] font-bold text-emerald-600 block uppercase">Livres</span>
                          <strong className="text-emerald-700 font-bold">{item.val.availableCopies} ex.</strong>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-bold text-indigo-600 block uppercase">Com Alunos</span>
                          <strong className="text-indigo-700 font-bold">{loanedCount} ex.</strong>
                        </div>
                      </div>

                      {item.val.notes && (
                        <p className="text-[11px] text-slate-500 italic mt-2 line-clamp-2">
                          "{item.val.notes}"
                        </p>
                      )}
                    </div>

                    {/* Botões de Ação do Cantinho */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      {/* Botão Emprestar para Aluno */}
                      <button
                        onClick={() => handleOpenCornerLoan(item)}
                        disabled={(item.val.availableCopies || 0) <= 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer flex-1 justify-center"
                        title={
                          (item.val.availableCopies || 0) <= 0
                            ? 'Todos os exemplares do cantinho já foram retirados'
                            : 'Registrar retirada de aluno em sala'
                        }
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>Emprestar</span>
                      </button>

                      {/* Botão Devolver ao Acervo Central */}
                      {(canManage || canLoan) && (
                        <button
                          onClick={() => handleOpenReturnToCentral(item)}
                          disabled={(item.val.availableCopies || 0) <= 0}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                          title="Devolver exemplar ao acervo central da biblioteca"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                          <span className="hidden sm:inline">Acervo</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* CONTEÚDO 2: EMPRÉSTIMOS ATIVOS DO CANTINHO */}
      {activeSubTab === 'emprestimos' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800">
                Alunos com Livros do Cantinho em Mãos
              </h3>
              <p className="text-xs text-slate-500">
                Obras retiradas diretamente da sala de aula para leitura dos estudantes.
              </p>
            </div>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-800 font-bold rounded-lg text-xs">
              {activeCornerLoans.length} empréstimo(s) em aberto
            </span>
          </div>

          {activeCornerLoans.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Todos os livros estão na estante da sala</p>
              <p className="text-xs text-slate-500 mt-1">Nenhum aluno está com empréstimo pendente do Cantinho da Leitura.</p>
            </div>
          ) : (
            <>
              {/* Celular: cartões */}
              <div className="md:hidden p-3 space-y-3">
                {activeCornerLoans.map((l) => (
                  <div key={l.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        {l.val.className || '-'}
                      </span>
                      <span className="text-[11px] text-amber-700 font-bold font-mono shrink-0">
                        até {formatDate(l.val.dueDate)}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 break-words">{l.val.studentName}</p>
                    <p className="text-xs font-medium text-emerald-800 break-words">📖 {l.val.bookTitle}</p>
                    <p className="text-[11px] text-slate-500 font-mono">Retirada: {formatDate(l.val.loanDate)}</p>
                    <button
                      onClick={() => handleOpenStudentReturn(l)}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Receber na Sala</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* Tablet / computador: tabela */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Turma</th>
                    <th className="py-2.5 px-3">Aluno(a)</th>
                    <th className="py-2.5 px-3">Livro Retirado</th>
                    <th className="py-2.5 px-3 text-center">Retirada</th>
                    <th className="py-2.5 px-3 text-center">Devolução Prevista</th>
                    <th className="py-2.5 px-3 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeCornerLoans.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {l.val.className || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        {l.val.studentName}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-emerald-800">
                        {l.val.bookTitle}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-600 font-mono">
                        {formatDate(l.val.loanDate)}
                      </td>
                      <td className="py-2.5 px-3 text-center text-amber-700 font-bold font-mono">
                        {formatDate(l.val.dueDate)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => handleOpenStudentReturn(l)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold rounded-lg transition cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Receber na Sala</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* CONTEÚDO 3: HISTÓRICO DE LEITURAS CONCLUÍDAS DO CANTINHO */}
      {activeSubTab === 'historico' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800">
              Histórico de Devoluções do Cantinho da Leitura
            </h3>
            <p className="text-xs text-slate-500">
              Obras que já foram lidas e devolvidas à estante da sala de aula.
            </p>
          </div>

          {completedCornerLoans.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Nenhuma leitura concluída ainda</p>
              <p className="text-xs text-slate-500 mt-1">Conforme os alunos devolverem os livros ao cantinho, o histórico aparecerá aqui.</p>
            </div>
          ) : (
            <>
              {/* Celular: cartões */}
              <div className="md:hidden p-3 space-y-3">
                {completedCornerLoans.map((l) => (
                  <div key={l.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        {l.val.className || '-'}
                      </span>
                      <span className="text-[11px] text-emerald-700 font-bold font-mono shrink-0">
                        {formatDate(l.val.returnDate)}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 break-words">{l.val.studentName}</p>
                    <p className="text-xs font-medium text-emerald-800 break-words">📖 {l.val.bookTitle}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      Retirada: {formatDate(l.val.loanDate)} · Devolução: {formatDate(l.val.returnDate)}
                    </p>
                    {l.val.notes && (
                      <p className="text-xs text-slate-500 italic break-words">"{l.val.notes}"</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Tablet / computador: tabela */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Turma</th>
                    <th className="py-2.5 px-3">Aluno(a)</th>
                    <th className="py-2.5 px-3">Obra Lida</th>
                    <th className="py-2.5 px-3 text-center">Retirada</th>
                    <th className="py-2.5 px-3 text-center">Devolução</th>
                    <th className="py-2.5 px-3">Observações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completedCornerLoans.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {l.val.className || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        {l.val.studentName}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-emerald-800">
                        {l.val.bookTitle}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-600 font-mono">
                        {formatDate(l.val.loanDate)}
                      </td>
                      <td className="py-2.5 px-3 text-center text-emerald-700 font-bold font-mono">
                        {formatDate(l.val.returnDate)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 italic max-w-xs truncate">
                        {l.val.notes || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* MODAL: DISPONIBILIZAR LIVRO NO CANTINHO (ALOCAÇÃO DO ACERVO) */}
      {isAllocateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-bold text-slate-800">
                  Disponibilizar no Cantinho da Leitura
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAllocateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Os exemplares selecionados sairão da disponibilidade do acervo central e passarão a compor a biblioteca da sala de aula indicada.
            </p>

            <form onSubmit={handleSubmitAllocation} className="space-y-4">
              {/* Seleção da Turma / Sala de Aula */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Turma / Sala de Aula de Destino *
                </label>
                <select
                  id="select-alloc-turma"
                  value={allocTurmaId}
                  onChange={(e) => setAllocTurmaId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white cursor-pointer"
                >
                  <option value="">Selecione a turma...</option>
                  {availableClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      🏫 {c.val.schoolName ? `${c.val.schoolName} • ` : ''}{c.val.year}º {c.val.letter} ({c.val.shift || 'Sala'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Seleção do Livro do Acervo */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Obra do Acervo Central *
                </label>
                <select
                  id="select-alloc-book"
                  value={allocBookId}
                  onChange={(e) => setAllocBookId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white cursor-pointer"
                >
                  <option value="">Selecione o livro...</option>
                  {availableAcervoBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      📖 {b.val.title} — {b.val.author || 'Autor'} ({b.val.availableCopies} ex. disponíveis no acervo)
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantidade de Exemplares a Disponibilizar */}
              {(() => {
                const selBook = books.find((b) => b.id === allocBookId);
                const maxAvailable = selBook?.val?.availableCopies || 1;

                return (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Quantidade de Exemplares a Disponibilizar na Sala *
                    </label>
                    <input
                      id="input-alloc-copies"
                      type="number"
                      min="1"
                      max={maxAvailable}
                      value={allocCopies}
                      onChange={(e) => setAllocCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      required
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      Máximo permitido: {maxAvailable} exemplar(es) livres no acervo central neste momento.
                    </span>
                  </div>
                );
              })()}

              {/* Observações / Projeto Pedagógico */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Projeto Pedagógico / Observações
                </label>
                <input
                  id="input-alloc-notes"
                  type="text"
                  placeholder="Ex: Projeto Leitura e Escrita do 2º Bimestre"
                  value={allocNotes}
                  onChange={(e) => setAllocNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* Botões do Modal */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAllocateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingAlloc || !allocTurmaId || !allocBookId}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-xs transition cursor-pointer"
                >
                  {processingAlloc ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-200" />
                      <span>Disponibilizando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Envio para Sala</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EMPRÉSTIMO RÁPIDO EM SALA DE AULA (ALUNO LEVA LIVRO DO CANTINHO) */}
      {isCornerLoanModalOpen && loanCornerBook && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-800">
                  Retirada do Cantinho da Leitura
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCornerLoanModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Informações da Obra */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl mb-4 flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-emerald-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-950 truncate">
                  {loanCornerBook.val.bookTitle}
                </p>
                <p className="text-[11px] text-emerald-700">
                  Turma: {loanCornerBook.val.turmaName}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitCornerLoan} className="space-y-4">
              {/* Seleção do Aluno da Turma */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Aluno(a) que está retirando o livro *
                </label>
                <select
                  id="select-corner-student"
                  value={cornerStudentId}
                  onChange={(e) => setCornerStudentId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white cursor-pointer"
                >
                  <option value="">Selecione o(a) aluno(a)...</option>
                  {studentsOfCurrentClass.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.number ? `Nº ${st.number} • ` : ''}{st.name} {st.ra ? `(RA: ${st.ra})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Data de Devolução Prevista */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data Prevista para Devolução *
                </label>
                <input
                  type="date"
                  required
                  value={cornerDueDate}
                  onChange={(e) => setCornerDueDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                />
              </div>

              {/* Observações */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  placeholder="Ex: Leitura de fim de semana"
                  value={cornerLoanNotes}
                  onChange={(e) => setCornerLoanNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* Botões do Modal */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCornerLoanModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingCornerLoan || !cornerStudentId}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-xs transition cursor-pointer"
                >
                  {processingCornerLoan ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-200" />
                      <span>Registrando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Retirada</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DEVOLVER EXEMPLARES AO ACERVO CENTRAL */}
      {isReturnModalOpen && returnCornerBook && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-slate-700" />
                <h3 className="text-base font-bold text-slate-800">
                  Retornar ao Acervo Central
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsReturnModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Os exemplares selecionados sairão da estante do cantinho da sala e voltarão a ficar disponíveis para empréstimo geral no acervo da biblioteca.
            </p>

            <form onSubmit={handleSubmitReturnToCentral} className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <strong className="block text-slate-800 font-bold mb-0.5">
                  {returnCornerBook.val.bookTitle}
                </strong>
                <span className="text-slate-500 block">
                  Turma: {returnCornerBook.val.turmaName}
                </span>
                <span className="text-emerald-700 font-semibold block mt-1">
                  Exemplares na estante da sala: {returnCornerBook.val.availableCopies}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantidade a Devolver ao Acervo Central *
                </label>
                <input
                  type="number"
                  min="1"
                  max={returnCornerBook.val.availableCopies || 1}
                  required
                  value={returnCopies}
                  onChange={(e) => setReturnCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReturnModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingReturn || returnCopies <= 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-xs transition cursor-pointer"
                >
                  {processingReturn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                      <span>Retornando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Retorno ao Acervo</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECEBER DEVOLUÇÃO DE ALUNO NO CANTINHO */}
      {isStudentReturnModalOpen && selectedLoanForReturn && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-800">
                  Receber Livro no Cantinho
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStudentReturnModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              O aluno está devolvendo o livro. O exemplar retornará à estante do Cantinho da Leitura da sala de aula.
            </p>

            <form onSubmit={handleSubmitStudentReturn} className="space-y-4">
              <div className="p-3 bg-teal-50 border border-teal-100 rounded-xl text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Aluno:</span>
                  <strong className="text-slate-800">{selectedLoanForReturn.val.studentName}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Livro:</span>
                  <strong className="text-teal-900">{selectedLoanForReturn.val.bookTitle}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Data de Retirada:</span>
                  <span className="text-slate-700 font-mono">{formatDate(selectedLoanForReturn.val.loanDate)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações sobre a Leitura / Estado de Conservação
                </label>
                <input
                  type="text"
                  placeholder="Ex: Livro devolvido em perfeito estado"
                  value={studentReturnNotes}
                  onChange={(e) => setStudentReturnNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsStudentReturnModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingStudentReturn}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-xs transition cursor-pointer"
                >
                  {processingStudentReturn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-teal-200" />
                      <span>Registrando baixa...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Devolução à Estante</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
