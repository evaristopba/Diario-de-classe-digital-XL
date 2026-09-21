import React, { useState, useEffect } from 'react';
import { Book, BookLoan, ClassRoom, Student, ModalConfig, School, BookMovement, SchoolCopyHolding } from '../types';
import {
  carregarLivros,
  salvarLivro,
  excluirLivro,
  carregarEmprestimos,
  registrarEmprestimo,
  devolverEmprestimo,
  renovarEmprestimo,
  carregarMinhasTurmas,
  verificarPodeGerenciarBiblioteca,
  verificarIsAdmin,
  getCurrentAuthUid,
  carregarEscolas,
  carregarMovimentacoesLivros,
  registrarMovimentacaoLivro
} from '../lib/firebase';
import { checkBookDeleteIntegrity } from '../lib/referentialIntegrity';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportToExcelJS, ExcelColumnDef } from '../lib/excelExport';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Edit2,
  Calendar,
  User,
  GraduationCap,
  Filter,
  FileSpreadsheet,
  Download,
  BookMarked,
  ShieldCheck,
  Bookmark,
  Layers,
  Sparkles,
  RefreshCw,
  Hash,
  Camera,
  Barcode,
  UploadCloud,
  Image as ImageIcon,
  Loader2,
  Wand2,
  Check,
  X,
  Building2,
  ArrowRightLeft,
  HelpCircle
} from 'lucide-react';
import {
  scanBookWithAI,
  searchBookByISBN,
  detectISBNFromImage,
  fileToBase64Optimized,
  makeCoverThumbnail
} from '../lib/bookLookupService';
import { ReadingCornerTab } from './ReadingCornerTab';
import { LibraryManualModal } from './LibraryManualModal';

interface LibraryScreenProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

type TabMode = 'circulacao' | 'acervo' | 'cantinho' | 'historico';

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  currentYear,
  setModal
}) => {
  // Navigation & Permissions
  const [activeTab, setActiveTab] = useState<TabMode>('circulacao');
  const [canManage, setCanManage] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [preselectedBookForCorner, setPreselectedBookForCorner] = useState<{ id: string; val: Book } | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);

  // Core Data
  const [books, setBooks] = useState<Array<{ id: string; val: Book }>>([]);
  const [loans, setLoans] = useState<Array<{ id: string; val: BookLoan }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; val: ClassRoom }>>([]);

  // Permissão de circulação de empréstimo: Administradores, Bibliotecários ou Professores com turmas atribuídas
  const canLoan = canManage || classes.length > 0;
  const [schools, setSchools] = useState<School[]>([]);
  const [movements, setMovements] = useState<Array<{ id: string; val: BookMovement }>>([]);
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState<string>('todas');
  const [historySubTab, setHistorySubTab] = useState<'devolucoes' | 'remanejamentos'>('devolucoes');

  // Search & Filter
  const [bookSearch, setBookSearch] = useState<string>('');
  const [loanSearch, setLoanSearch] = useState<string>('');
  const [loanStatusFilter, setLoanStatusFilter] = useState<'todos' | 'ativo' | 'atrasado' | 'devolvido'>('ativo');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('todas');

  // Book Modal State (Cadastro / Edição de Livro)
  const [isBookModalOpen, setIsBookModalOpen] = useState<boolean>(false);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookSchoolId, setBookSchoolId] = useState<string>('');
  const [bookCode, setBookCode] = useState<string>('');
  const [bookTitle, setBookTitle] = useState<string>('');
  const [bookAuthor, setBookAuthor] = useState<string>('');
  const [bookGenre, setBookGenre] = useState<string>('Literatura Infantil');
  const [bookPublisher, setBookPublisher] = useState<string>('');
  const [bookYear, setBookYear] = useState<string>('');
  const [bookTotalCopies, setBookTotalCopies] = useState<number>(1);
  const [bookLocation, setBookLocation] = useState<string>('');
  const [bookSynopsis, setBookSynopsis] = useState<string>('');
  const [bookCoverUrl, setBookCoverUrl] = useState<string>('');
  const [savingBook, setSavingBook] = useState<boolean>(false);

  // Remanejamento / Transferência Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [transferBook, setTransferBook] = useState<{ id: string; val: Book } | null>(null);
  const [transferSourceSchoolId, setTransferSourceSchoolId] = useState<string>('');
  const [transferTargetSchoolId, setTransferTargetSchoolId] = useState<string>('');
  const [transferCopies, setTransferCopies] = useState<number>(1);
  const [transferReason, setTransferReason] = useState<string>('Remanejamento de acervo entre escolas');
  const [transferLocation, setTransferLocation] = useState<string>('');
  const [processingTransfer, setProcessingTransfer] = useState<boolean>(false);

  // Estados do Assistente Rápido de Inclusão (Fotos / IA e ISBN)
  const [frontCoverImg, setFrontCoverImg] = useState<string | null>(null);
  const [backCoverImg, setBackCoverImg] = useState<string | null>(null);
  const [isAnalyzingPhotos, setIsAnalyzingPhotos] = useState<boolean>(false);
  const [isSearchingIsbn, setIsSearchingIsbn] = useState<boolean>(false);
  const [quickIsbnInput, setQuickIsbnInput] = useState<string>('');
  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null);
  const [assistantTab, setAssistantTab] = useState<'photo' | 'isbn'>('photo');
  const [quickFillSuccessMsg, setQuickFillSuccessMsg] = useState<string | null>(null);
  const [quickFillWarnings, setQuickFillWarnings] = useState<string[]>([]);
  const [showAssistant, setShowAssistant] = useState<boolean>(true);

  // Loan Modal State (Novo Empréstimo)
  const [isLoanModalOpen, setIsLoanModalOpen] = useState<boolean>(false);
  const [loanSelectedBookId, setLoanSelectedBookId] = useState<string>('');
  const [loanSelectedClassId, setLoanSelectedClassId] = useState<string>('');
  const [loanSelectedStudentId, setLoanSelectedStudentId] = useState<string>('');
  const [loanDate, setLoanDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [loanDaysDuration, setLoanDaysDuration] = useState<number>(7);
  const [loanNotes, setLoanNotes] = useState<string>('');
  const [savingLoan, setSavingLoan] = useState<boolean>(false);

  // Return & Renewal Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [selectedLoanForReturn, setSelectedLoanForReturn] = useState<{ id: string; val: BookLoan } | null>(null);
  const [returnDate, setReturnDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [processingAction, setProcessingAction] = useState<boolean>(false);

  // Carregamento de Permissões e Dados Iniciais
  const checkPermissions = async () => {
    try {
      const admin = await verificarIsAdmin();
      setIsAdmin(admin);
      const manage = await verificarPodeGerenciarBiblioteca();
      setCanManage(manage || admin);
    } catch {
      setCanManage(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [booksList, loansList, classesList, schoolsList, movementsList] = await Promise.all([
        carregarLivros(),
        carregarEmprestimos(),
        carregarMinhasTurmas(),
        carregarEscolas(),
        carregarMovimentacoesLivros()
      ]);

      booksList.sort((a, b) => (a.val.title || '').localeCompare(b.val.title || ''));
      loansList.sort((a, b) => (b.val.createdAt || 0) - (a.val.createdAt || 0));

      // Filtrar turmas pelo ano letivo atual se informado
      const filteredClasses = classesList.filter(
        (c) => !c.val.anoLetivo || !currentYear || String(c.val.anoLetivo).trim() === String(currentYear).trim()
      );

      setBooks(booksList);
      setLoans(loansList);
      setClasses(filteredClasses);
      setSchools(schoolsList);
      setMovements(movementsList.sort((a, b) => (b.val.createdAt || 0) - (a.val.createdAt || 0)));
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Biblioteca',
        message: formatFriendlyError(err),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkPermissions();
    loadData();
  }, [currentYear]);

  // Lista de Alunos da Turma Selecionada no Empréstimo
  const selectedClassObj = classes.find((c) => c.id === loanSelectedClassId);
  const studentsInSelectedClass: Student[] = selectedClassObj?.val?.alunos
    ? Object.keys(selectedClassObj.val.alunos)
        .map((k) => ({
          ...selectedClassObj.val.alunos![k],
          id: k
        }))
        .filter((s) => s.status !== 'expedida')
        .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
    : [];

  // Data prevista calculada para o modal de empréstimo
  const calculateDueDate = (startDate: string, days: number): string => {
    try {
      const d = new Date(startDate);
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    } catch {
      return startDate;
    }
  };

  // Helper para verificar se um empréstimo está atrasado
  const isLoanOverdue = (loan: BookLoan): boolean => {
    if (loan.status === 'devolvido') return false;
    const today = new Date().toISOString().split('T')[0];
    return loan.dueDate < today;
  };

  // 1. Handlers de Livro (Acervo)
  const handleOpenBookModal = (
    b?: { id: string; val: Book },
    initialMode: 'photo' | 'isbn' | 'manual' = 'manual'
  ) => {
    setFrontCoverImg(null);
    setBackCoverImg(null);
    setQuickIsbnInput('');
    setQuickFillSuccessMsg(null);
    setQuickFillWarnings([]);
    setIsAnalyzingPhotos(false);
    setIsSearchingIsbn(false);

    if (b) {
      setEditingBookId(b.id);
      setBookSchoolId(b.val.schoolId || (selectedSchoolFilter !== 'todas' ? selectedSchoolFilter : (schools[0]?.id || '')));
      setBookCode(b.val.code || '');
      setBookTitle(b.val.title || '');
      setBookAuthor(b.val.author || '');
      setBookGenre(b.val.genre || 'Literatura Infantil');
      setBookPublisher(b.val.publisher || '');
      setBookYear(b.val.year || '');
      setBookTotalCopies(b.val.totalCopies || 1);
      setBookLocation(b.val.location || '');
      setBookSynopsis(b.val.synopsis || '');
      setBookCoverUrl(b.val.coverUrl || '');
      setShowAssistant(false);
    } else {
      setEditingBookId(null);
      setBookSchoolId(selectedSchoolFilter !== 'todas' ? selectedSchoolFilter : (schools[0]?.id || ''));
      setBookCode('');
      setBookTitle('');
      setBookAuthor('');
      setBookGenre('Literatura Infantil');
      setBookPublisher('');
      setBookYear('');
      setBookTotalCopies(1);
      setBookLocation('');
      setBookSynopsis('');
      setBookCoverUrl('');
      setShowAssistant(initialMode !== 'manual');
      setAssistantTab(initialMode === 'isbn' ? 'isbn' : 'photo');
    }
    setIsBookModalOpen(true);
  };

  const handleClearOCRAndFields = () => {
    setFrontCoverImg(null);
    setBackCoverImg(null);
    setQuickIsbnInput('');
    setQuickFillSuccessMsg(null);
    setQuickFillWarnings([]);
    setBookTitle('');
    setBookAuthor('');
    setBookCode('');
    setBookPublisher('');
    setBookYear('');
    setBookGenre('Literatura Infantil');
    setBookSynopsis('');
    setBookCoverUrl('');
    setBookTotalCopies(1);
    setBookLocation('');
  };

  const handleFrontImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64 } = await fileToBase64Optimized(file);
      setFrontCoverImg(base64);
      setQuickFillSuccessMsg(null);
      setQuickFillWarnings([]);
      // Ao carregar nova imagem, limpa campos anteriores de leituras passadas caso não seja edição de livro existente
      if (!editingBookId) {
        setBookTitle('');
        setBookAuthor('');
        setBookCode('');
        setBookPublisher('');
        setBookYear('');
        setBookSynopsis('');
        setBookCoverUrl('');
      }
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Foto não carregada',
        message: err?.message || 'Não foi possível abrir esta imagem. Tente outra foto (JPEG, PNG ou WebP).',
        icon: '📷'
      });
    }
  };

  const handleBackImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64 } = await fileToBase64Optimized(file);
      setBackCoverImg(base64);
      setQuickFillSuccessMsg(null);
      setQuickFillWarnings([]);

      // Tenta leitura instantânea de código de barras no navegador
      try {
        const foundIsbn = await detectISBNFromImage(base64);
        if (foundIsbn) {
          setDetectedBarcode(foundIsbn);
          setQuickIsbnInput(foundIsbn);
        } else {
          setDetectedBarcode(null);
        }
      } catch {
        setDetectedBarcode(null);
      }
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Foto não carregada',
        message: err?.message || 'Não foi possível abrir esta imagem. Tente outra foto (JPEG, PNG ou WebP).',
        icon: '📷'
      });
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (!frontCoverImg && !backCoverImg) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Fotos Necessárias',
        message: 'Por favor, carregue ou fotografe ao menos a capa frontal do livro.',
        icon: '📷'
      });
      return;
    }

    setIsAnalyzingPhotos(true);
    setQuickFillSuccessMsg(null);
    setQuickFillWarnings([]);
    // Limpa os campos preenchidos de leituras anteriores para garantir que não haja dados residuais
    setBookTitle('');
    setBookAuthor('');
    setBookCode('');
    setBookPublisher('');
    setBookYear('');
    setBookGenre('Literatura Infantil');
    setBookSynopsis('');
    setBookCoverUrl('');

    try {
      const scanned = await scanBookWithAI(
        frontCoverImg || '',
        backCoverImg || '',
        detectedBarcode || undefined
      );

      setBookTitle(scanned.title || '');
      
      let authorString = scanned.author || '';
      if (scanned.illustrator && !authorString.includes(scanned.illustrator)) {
        authorString = authorString ? `${authorString} (Ilustrações: ${scanned.illustrator})` : `Ilustrações: ${scanned.illustrator}`;
      }
      setBookAuthor(authorString || 'Autor Desconhecido');

      if (scanned.isbn) {
        setBookCode(scanned.isbn);
        setQuickIsbnInput(scanned.isbn);
      } else {
        setBookCode('');
      }
      
      let pubText = scanned.publisher || '';
      if (scanned.year) {
        pubText = pubText ? `${pubText} (${scanned.year})` : `Ano ${scanned.year}`;
      }
      if (scanned.collection) {
        pubText = pubText ? `${pubText} • Coleção: ${scanned.collection}` : `Coleção: ${scanned.collection}`;
      }
      setBookPublisher(pubText || '');
      setBookYear(scanned.year ? String(scanned.year) : '');

      setBookGenre(scanned.genre || 'Literatura Infantil');
      setBookSynopsis(scanned.synopsis || '');
      if (scanned.coverUrl) {
        setBookCoverUrl(scanned.coverUrl);
      } else if (frontCoverImg) {
        // Usa a própria foto frontal como capa da obra (em miniatura leve, para não pesar o banco de dados)
        setBookCoverUrl(await makeCoverThumbnail(frontCoverImg));
      } else {
        setBookCoverUrl('');
      }

      setQuickFillWarnings(scanned.warnings || []);
      setQuickFillSuccessMsg(
        `✨ Leitura concluída! Título: "${scanned.title || 'Identificado'}" ${scanned.isbn ? `• ISBN: ${scanned.isbn}` : ''}`
      );
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Leitura Inteligente',
        message:
          err.message ||
          'Não foi possível ler as fotos com nitidez. Verifique a iluminação ou use o código ISBN.',
        icon: '⚠️'
      });
    } finally {
      setIsAnalyzingPhotos(false);
    }
  };

  const handleScanBarcodeImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsSearchingIsbn(true);
      const { base64 } = await fileToBase64Optimized(file);
      const isbn = await detectISBNFromImage(base64);
      if (isbn) {
        setQuickIsbnInput(isbn);
        await handleSearchISBN(isbn);
      } else {
        setIsSearchingIsbn(false);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Código Não Detectado',
          message:
            'Não foi possível identificar um código de barras de ISBN nesta imagem. Você pode digitar os dígitos do ISBN no campo ou tentar uma foto mais nítida e iluminada.',
          icon: '🔍'
        });
      }
    } catch (err: any) {
      setIsSearchingIsbn(false);
      console.error(err);
    }
  };

  const handleSearchISBN = async (targetIsbn?: string) => {
    const isbn = (targetIsbn || quickIsbnInput).trim();
    if (!isbn) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Informe o ISBN',
        message: 'Digite ou cole o código ISBN (10 ou 13 dígitos) para consulta.',
        icon: '🔍'
      });
      return;
    }

    setIsSearchingIsbn(true);
    setQuickFillSuccessMsg(null);
    setQuickFillWarnings([]);
    // Limpa campos anteriores antes da nova consulta
    setBookTitle('');
    setBookAuthor('');
    setBookCode('');
    setBookPublisher('');
    setBookYear('');
    setBookGenre('Literatura Infantil');
    setBookSynopsis('');
    setBookCoverUrl('');

    try {
      const data = await searchBookByISBN(isbn);
      if (!data) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Obra Não Encontrada',
          message: `Nenhum registro localizado na Câmara Brasileira do Livro (CBL) ou Google Books para o ISBN "${isbn}". Você pode preencher manualmente ou usar as fotos da capa.`,
          icon: '🔎'
        });
        return;
      }

      setBookTitle(data.title || '');
      setBookAuthor(data.author || 'Autor Desconhecido');
      setBookCode(data.isbn || isbn);
      if (data.publisher) {
        const pub = data.year ? `${data.publisher} (${data.year})` : data.publisher;
        setBookPublisher(pub);
      } else if (data.year) {
        setBookPublisher(`Ano ${data.year}`);
      } else {
        setBookPublisher('');
      }
      setBookYear(data.year ? String(data.year) : '');
      setBookGenre(data.genre || 'Literatura Infantil');
      setBookSynopsis(data.synopsis || '');
      setBookCoverUrl(data.coverUrl || '');

      setQuickFillSuccessMsg(`📚 Obra "${data.title}" localizada com sucesso! Todos os dados foram preenchidos.`);
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Consulta de ISBN',
        message: err.message || 'Falha ao buscar dados do ISBN.',
        icon: '⚠️'
      });
    } finally {
      setIsSearchingIsbn(false);
    }
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookTitle.trim()) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Campo Obrigatório',
        message: 'Por favor, informe o título da obra.',
        icon: '⚠️'
      });
      return;
    }

    const codeToUse = bookCode.trim() || `LIV-${Date.now().toString().slice(-6)}`;
    const totalCopiesNum = Math.max(1, Number(bookTotalCopies) || 1);

    // Se estiver editando, recalcular disponíveis proporcionalmente
    let availableNum = totalCopiesNum;
    if (editingBookId) {
      const existing = books.find((b) => b.id === editingBookId);
      if (existing) {
        const emprestados = Math.max(0, (existing.val.totalCopies || 1) - (existing.val.availableCopies || 0));
        availableNum = Math.max(0, totalCopiesNum - emprestados);
      }
    }

    // Ao CADASTRAR (não editar), avisa se já existe um título correspondente no catálogo
    // (por ISBN/código ou por título+autor) em vez de mesclar silenciosamente.
    if (!editingBookId) {
      const codeClean = codeToUse.replace(/[^0-9X]/gi, '').toLowerCase();
      const titleClean = bookTitle.trim().toLowerCase();
      const authorClean = bookAuthor.trim().toLowerCase();

      const existingMatch = books.find((b) => {
        const bCodeClean = (b.val.code || '').replace(/[^0-9X]/gi, '').toLowerCase();
        const bTitleClean = (b.val.title || '').trim().toLowerCase();
        const bAuthorClean = (b.val.author || '').trim().toLowerCase();
        const matchIsbn = codeClean.length >= 9 && bCodeClean.length >= 9 && codeClean === bCodeClean;
        const matchTitleAuthor = titleClean.length > 2 && bTitleClean === titleClean && (bAuthorClean === authorClean || !authorClean || !bAuthorClean);
        return matchIsbn || matchTitleAuthor;
      });

      if (existingMatch) {
        setModal({
          isOpen: true,
          type: 'confirm',
          title: 'Este Título Já Está Cadastrado',
          message: `"${existingMatch.val.title}" já existe no catálogo da rede (${existingMatch.val.totalCopies || 0} exemplar(es) no total). Deseja adicionar ${totalCopiesNum} exemplar(es) a este cadastro existente em vez de criar um título duplicado?`,
          icon: '📚',
          onConfirm: () => proceedSaveBook(codeToUse, totalCopiesNum, availableNum)
        });
        return;
      }
    }

    await proceedSaveBook(codeToUse, totalCopiesNum, availableNum);
  };

  const proceedSaveBook = async (codeToUse: string, totalCopiesNum: number, availableNum: number) => {
    setSavingBook(true);
    try {
      const selectedSchoolObj = schools.find((s) => s.id === bookSchoolId);
      // Nunca grava a foto original (pesada) no banco: usa miniatura leve quando só existe a foto
      let coverToSave = bookCoverUrl.trim();
      if (!coverToSave && frontCoverImg) {
        coverToSave = await makeCoverThumbnail(frontCoverImg);
      }
      const bookData: Omit<Book, 'id'> = {
        schoolId: bookSchoolId || undefined,
        schoolName: selectedSchoolObj?.name || undefined,
        code: codeToUse,
        title: bookTitle.trim(),
        author: bookAuthor.trim() || 'Autor Desconhecido',
        genre: bookGenre,
        publisher: bookPublisher.trim() || undefined,
        year: bookYear.trim() || undefined,
        totalCopies: totalCopiesNum,
        availableCopies: availableNum,
        location: bookLocation.trim() || undefined,
        synopsis: bookSynopsis.trim() || undefined,
        coverUrl: coverToSave || undefined
      };

      await salvarLivro(bookData, editingBookId || undefined);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: editingBookId
          ? `Obra "${bookTitle.trim()}" atualizada no acervo com sucesso!`
          : `Obra "${bookTitle.trim()}" cadastrada com sucesso!`,
        icon: '✅'
      });

      setIsBookModalOpen(false);
      loadData();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Obra',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    } finally {
      setSavingBook(false);
    }
  };

  const handleDeleteBook = async (book: { id: string; val: Book }) => {
    const integrity = await checkBookDeleteIntegrity(book.id, book.val.title);
    if (!integrity.canDelete) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exclusão Bloqueada',
        message: `⛔ ${integrity.reason}`,
        icon: '⛔'
      });
      return;
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Livro do Acervo',
      message: `Tem certeza que deseja remover o livro "${book.val.title}" do acervo da biblioteca?`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          await excluirLivro(book.id);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Obra Excluída',
            message: 'O livro foi removido do acervo.',
            icon: '✅'
          });
          loadData();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir',
            message: formatFriendlyError(err),
            icon: '❌'
          });
        }
      }
    });
  };

  // Handlers de Remanejamento e Transferência entre Escolas
  const handleOpenTransferModal = (book: { id: string; val: Book }) => {
    setTransferBook(book);
    
    // Define a escola de origem padrão (respeitando o filtro atual ou onde há exemplares disponíveis)
    let initialSource = '';
    if (selectedSchoolFilter !== 'todas') {
      initialSource = selectedSchoolFilter;
    } else if (book.val.copiesBySchool && Object.keys(book.val.copiesBySchool).length > 0) {
      const withAvail = Object.entries(book.val.copiesBySchool).find(([_, h]) => (h.availableCopies || 0) > 0);
      initialSource = withAvail ? withAvail[0] : Object.keys(book.val.copiesBySchool)[0];
    } else {
      initialSource = book.val.schoolId || (schools[0]?.id || '');
    }

    setTransferSourceSchoolId(initialSource);
    const otherSchools = schools.filter((s) => s.id !== initialSource);
    setTransferTargetSchoolId(otherSchools.length > 0 ? otherSchools[0].id : '');
    setTransferCopies(1);
    setTransferReason('Remanejamento de acervo entre bibliotecas escolares');
    setTransferLocation('');
    setIsTransferModalOpen(true);
  };

  const handleRegisterTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferBook) return;

    if (!transferSourceSchoolId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione a Escola de Origem',
        message: 'É necessário selecionar de qual escola sairão os exemplares transferidos.',
        icon: '⚠️'
      });
      return;
    }

    if (!transferTargetSchoolId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione a Escola de Destino',
        message: 'É necessário selecionar qual escola receberá os exemplares transferidos.',
        icon: '⚠️'
      });
      return;
    }

    if (transferTargetSchoolId === transferSourceSchoolId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Escola Inválida',
        message: 'A escola de destino deve ser diferente da escola onde os exemplares estão alocados.',
        icon: '⚠️'
      });
      return;
    }

    // Calcula disponíveis na unidade de origem
    let available = Number(transferBook.val.availableCopies ?? transferBook.val.totalCopies ?? 1);
    if (transferBook.val.copiesBySchool && transferBook.val.copiesBySchool[transferSourceSchoolId]) {
      available = Number(transferBook.val.copiesBySchool[transferSourceSchoolId].availableCopies ?? 0);
    }

    const copiesNum = Math.max(1, Number(transferCopies) || 1);
    if (copiesNum <= 0 || copiesNum > available) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Quantidade Inválida',
        message: `A unidade de origem possui apenas ${available} exemplar(es) livre(s) de empréstimo para remanejamento no momento.`,
        icon: '⚠️'
      });
      return;
    }

    const sourceSchool = schools.find((s) => s.id === transferSourceSchoolId);
    const targetSchool = schools.find((s) => s.id === transferTargetSchoolId);
    const sourceName = sourceSchool?.name || transferBook.val.copiesBySchool?.[transferSourceSchoolId]?.schoolName || transferBook.val.schoolName || 'Escola de Origem';
    const targetName = targetSchool?.name || 'Escola de Destino';

    setProcessingTransfer(true);
    try {
      await registrarMovimentacaoLivro({
        bookId: transferBook.id,
        bookData: transferBook.val,
        sourceSchoolId: transferSourceSchoolId,
        sourceSchoolName: sourceName,
        targetSchoolId: transferTargetSchoolId,
        targetSchoolName: targetName,
        copies: copiesNum,
        reason: transferReason.trim() || 'Remanejamento de acervo entre escolas',
        targetLocation: transferLocation.trim() || undefined
      });

      setIsTransferModalOpen(false);
      setTransferBook(null);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Remanejamento Concluído!',
        message: `${copiesNum} exemplar(es) de "${transferBook.val.title}" remanejado(s) com sucesso de "${sourceName}" para "${targetName}". O acervo de ambas as unidades foi sincronizado.`,
        icon: '✅'
      });
      loadData();
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Transferência',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    } finally {
      setProcessingTransfer(false);
    }
  };

  // 2. Handlers de Empréstimo
  const handleOpenLoanModal = (preselectedBookId?: string) => {
    setLoanSelectedBookId(preselectedBookId || (books.length > 0 ? books[0].id : ''));
    setLoanSelectedClassId(classes.length > 0 ? classes[0].id : '');
    setLoanSelectedStudentId('');
    setLoanDate(new Date().toISOString().split('T')[0]);
    setLoanDaysDuration(7);
    setLoanNotes('');
    setIsLoanModalOpen(true);
  };

  const handleRegisterLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanSelectedBookId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione um Livro',
        message: 'É necessário selecionar uma obra do acervo para o empréstimo.',
        icon: '⚠️'
      });
      return;
    }

    if (!loanSelectedClassId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione uma Turma',
        message: 'Selecione a turma do aluno retirante.',
        icon: '⚠️'
      });
      return;
    }

    if (!loanSelectedStudentId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione um Aluno',
        message: 'Selecione o aluno que está retirando o livro.',
        icon: '⚠️'
      });
      return;
    }

    const selectedBook = books.find((b) => b.id === loanSelectedBookId);
    if (!selectedBook) return;

    if (selectedBook.val.availableCopies <= 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exemplares Indisponíveis',
        message: `Todos os exemplares do livro "${selectedBook.val.title}" estão emprestados no momento.`,
        icon: '⚠️'
      });
      return;
    }

    const selectedStudent = studentsInSelectedClass.find((s) => s.id === loanSelectedStudentId);
    if (!selectedStudent) return;

    const calculatedDueDate = calculateDueDate(loanDate, loanDaysDuration);

    setSavingLoan(true);
    try {
      const newLoan: Omit<BookLoan, 'id'> = {
        bookId: selectedBook.id,
        bookTitle: selectedBook.val.title,
        bookCode: selectedBook.val.code,
        studentId: selectedStudent.id!,
        studentName: selectedStudent.name,
        studentNumber: selectedStudent.number,
        studentRa: selectedStudent.ra,
        classId: selectedClassObj?.id || loanSelectedClassId,
        className: selectedClassObj ? `${selectedClassObj.val.year}º ${selectedClassObj.val.letter}` : 'Turma',
        schoolId: selectedClassObj?.val?.schoolId || undefined,
        schoolName: selectedClassObj?.val?.schoolName || undefined,
        loanDate,
        dueDate: calculatedDueDate,
        status: 'ativo',
        notes: loanNotes.trim() || undefined
      };

      await registrarEmprestimo(newLoan);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Empréstimo Registrado!',
        message: `O livro "${selectedBook.val.title}" foi emprestado para "${selectedStudent.name}". Previsão de devolução: ${formatDate(calculatedDueDate)}.`,
        icon: '🎉'
      });

      setIsLoanModalOpen(false);
      loadData();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Registrar Empréstimo',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    } finally {
      setSavingLoan(false);
    }
  };

  // 3. Devolução & Renovação
  const handleOpenReturnModal = (loan: { id: string; val: BookLoan }) => {
    setSelectedLoanForReturn(loan);
    setReturnDate(new Date().toISOString().split('T')[0]);
    setReturnNotes(loan.val.notes || '');
    setIsReturnModalOpen(true);
  };

  const handleConfirmReturn = async () => {
    if (!selectedLoanForReturn) return;
    setProcessingAction(true);
    try {
      await devolverEmprestimo(
        selectedLoanForReturn.id,
        selectedLoanForReturn.val.bookId,
        returnDate,
        returnNotes.trim() || undefined
      );

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Devolução Concluída!',
        message: `O livro "${selectedLoanForReturn.val.bookTitle}" foi devolvido ao acervo com sucesso.`,
        icon: '✅'
      });

      setIsReturnModalOpen(false);
      setSelectedLoanForReturn(null);
      loadData();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Devolver Livro',
        message: formatFriendlyError(err),
        icon: '❌'
      });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleQuickRenew = (loan: { id: string; val: BookLoan }) => {
    const currentDue = loan.val.dueDate || new Date().toISOString().split('T')[0];
    const newDue = calculateDueDate(currentDue, 7);

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Renovar Empréstimo',
      message: `Deseja prorrogar o empréstimo do livro "${loan.val.bookTitle}" para o aluno "${loan.val.studentName}" por mais 7 dias (até ${formatDate(newDue)})?`,
      icon: '🔄',
      confirmText: 'Confirmar Renovação',
      onConfirm: async () => {
        try {
          await renovarEmprestimo(loan.id, newDue, loan.val.renewalsCount || 0);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Empréstimo Renovado!',
            message: `Novo prazo de devolução: ${formatDate(newDue)}.`,
            icon: '✅'
          });
          loadData();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Renovar',
            message: formatFriendlyError(err),
            icon: '❌'
          });
        }
      }
    });
  };

  // 4. Exportação de Relatórios da Biblioteca (PDF e Excel)
  const handleExportPendingLoansPDF = () => {
    const pendentes = loans.filter((l) => l.val.status !== 'devolvido');
    if (pendentes.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sem Empréstimos Pendentes',
        message: 'Não existem empréstimos ativos ou atrasados para exportar.',
        icon: 'ℹ️'
      });
      return;
    }

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('BIBLIOTECA ESCOLAR - CONTROLE DE EMPRÉSTIMOS', 105, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Ano Letivo: ${currentYear}   |   Data de Emissão: ${formatDate(new Date().toISOString().split('T')[0])}`, 14, 25);

    const tableData = pendentes.map((l) => {
      const isOverdue = isLoanOverdue(l.val);
      return [
        l.val.className || '-',
        l.val.studentName,
        l.val.bookTitle,
        l.val.bookCode || '-',
        formatDate(l.val.loanDate),
        formatDate(l.val.dueDate),
        isOverdue ? 'ATRASADO' : 'No Prazo'
      ];
    });

    autoTable(doc, {
      startY: 32,
      head: [['Turma', 'Aluno(a)', 'Livro', 'Cód.', 'Retirada', 'Devolução Prev.', 'Situação']],
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
      headStyles: {
        fillColor: [16, 185, 129],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 42, halign: 'left' },
        2: { cellWidth: 50, halign: 'left' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 20, halign: 'center' },
        5: { cellWidth: 20, halign: 'center' },
        6: { cellWidth: 20, halign: 'center' }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          if (data.cell.raw === 'ATRASADO') {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [5, 150, 105];
          }
        }
      }
    });

    doc.save(`emprestimos_biblioteca_${currentYear}.pdf`);
  };

  const handleExportPendingLoansExcel = async () => {
    const pendentes = loans.filter((l) => l.val.status !== 'devolvido');
    if (pendentes.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sem Empréstimos Pendentes',
        message: 'Não existem empréstimos ativos para exportar em planilha.',
        icon: 'ℹ️'
      });
      return;
    }

    const columns: ExcelColumnDef[] = [
      { header: 'Turma', key: 'turma', width: 14, align: 'center' },
      { header: 'Aluno(a)', key: 'aluno', width: 28, align: 'left' },
      { header: 'Livro', key: 'livro', width: 32, align: 'left' },
      { header: 'Código', key: 'codigo', width: 14, align: 'center' },
      { header: 'Data Retirada', key: 'retirada', width: 16, align: 'center' },
      { header: 'Devolução Prevista', key: 'devolucao', width: 18, align: 'center' },
      { header: 'Situação', key: 'situacao', width: 16, align: 'center' },
      { header: 'Renovações', key: 'renovacoes', width: 14, align: 'center' },
      { header: 'Observações', key: 'obs', width: 24, align: 'left' }
    ];

    const rows = pendentes.map((l) => {
      const isOverdue = isLoanOverdue(l.val);
      return {
        turma: l.val.className || '-',
        aluno: l.val.studentName,
        livro: l.val.bookTitle,
        codigo: l.val.bookCode || '-',
        retirada: formatDate(l.val.loanDate),
        devolucao: formatDate(l.val.dueDate),
        situacao: isOverdue ? 'ATRASADO' : 'Em dia',
        renovacoes: l.val.renewalsCount || 0,
        obs: l.val.notes || ''
      };
    });

    await exportToExcelJS({
      title: 'Biblioteca Escolar - Empréstimos em Aberto',
      year: currentYear,
      columns,
      rows,
      filename: `emprestimos_biblioteca_${currentYear}.xlsx`
    });
  };

  const handleExportBooksCatalogExcel = async () => {
    if (books.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acervo Vazio',
        message: 'Nenhuma obra cadastrada para exportação do catálogo.',
        icon: 'ℹ️'
      });
      return;
    }

    const columns: ExcelColumnDef[] = [
      { header: 'Código / Tombamento', key: 'code', width: 18, align: 'center' },
      { header: 'Título da Obra', key: 'title', width: 35, align: 'left' },
      { header: 'Autor(a)', key: 'author', width: 26, align: 'left' },
      { header: 'Gênero Literário', key: 'genre', width: 20, align: 'left' },
      { header: 'Total Exemplares', key: 'total', width: 16, align: 'center' },
      { header: 'Disponíveis', key: 'available', width: 14, align: 'center' },
      { header: 'Localização', key: 'location', width: 18, align: 'left' },
      { header: 'Ano Edição', key: 'year', width: 14, align: 'center' }
    ];

    const rows = books.map((b) => ({
      code: b.val.code,
      title: b.val.title,
      author: b.val.author,
      genre: b.val.genre || '-',
      total: b.val.totalCopies,
      available: b.val.availableCopies,
      location: b.val.location || '-',
      year: b.val.year || '-'
    }));

    await exportToExcelJS({
      title: 'Catálogo do Acervo da Biblioteca Escolar',
      year: currentYear,
      columns,
      rows,
      filename: `catalogo_acervo_biblioteca_${currentYear}.xlsx`
    });
  };

  const handleExportMovementsExcel = async () => {
    if (movements.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Movimentação',
        message: 'Não há registros de remanejamento entre escolas para exportar.',
        icon: 'ℹ️'
      });
      return;
    }

    const columns: ExcelColumnDef[] = [
      { header: 'Data do Remanejamento', key: 'date', width: 22, align: 'center' },
      { header: 'Código / Tombamento', key: 'code', width: 18, align: 'center' },
      { header: 'Título da Obra', key: 'title', width: 35, align: 'left' },
      { header: 'Escola de Origem', key: 'source', width: 28, align: 'left' },
      { header: 'Escola de Destino', key: 'target', width: 28, align: 'left' },
      { header: 'Qtd Exemplares', key: 'copies', width: 16, align: 'center' },
      { header: 'Motivo / Justificativa', key: 'reason', width: 35, align: 'left' },
      { header: 'Responsável', key: 'userName', width: 22, align: 'left' }
    ];

    const rows = movements.map((m) => ({
      date: new Date(m.val.createdAt).toLocaleString('pt-BR'),
      code: m.val.bookCode || '-',
      title: m.val.bookTitle,
      source: m.val.sourceSchoolName,
      target: m.val.targetSchoolName,
      copies: m.val.copies,
      reason: m.val.reason || '-',
      userName: m.val.userName || 'Sistema'
    }));

    await exportToExcelJS({
      title: 'Histórico de Remanejamento de Acervo entre Escolas',
      year: currentYear,
      columns,
      rows,
      filename: `remanejamentos_acervo_${currentYear}.xlsx`
    });
  };

  // Filtragem de Empréstimos para exibição
  const filteredLoans = loans.filter((l) => {
    const isOverdue = isLoanOverdue(l.val);

    // Filtro por escola
    if (selectedSchoolFilter !== 'todas') {
      const loanClass = classes.find((c) => c.id === l.val.classId);
      if (loanClass?.val?.schoolId && loanClass.val.schoolId !== selectedSchoolFilter) {
        return false;
      }
    }

    // Filtro por status
    if (loanStatusFilter === 'ativo' && (l.val.status !== 'ativo' || isOverdue)) return false;
    if (loanStatusFilter === 'atrasado' && (l.val.status === 'devolvido' || !isOverdue)) return false;
    if (loanStatusFilter === 'devolvido' && l.val.status !== 'devolvido') return false;

    // Filtro por turma
    if (selectedClassFilter !== 'todas' && l.val.classId !== selectedClassFilter) return false;

    // Filtro por termo de busca (aluno, livro ou código)
    if (loanSearch.trim()) {
      const q = loanSearch.toLowerCase();
      const matchStudent = l.val.studentName.toLowerCase().includes(q);
      const matchBook = l.val.bookTitle.toLowerCase().includes(q);
      const matchCode = (l.val.bookCode || '').toLowerCase().includes(q);
      if (!matchStudent && !matchBook && !matchCode) return false;
    }

    return true;
  });

  // Filtragem de Livros do Acervo
  const filteredBooks = books.filter((b) => {
    // Filtro por escola
    if (selectedSchoolFilter !== 'todas') {
      if (b.val.copiesBySchool) {
        const holding = b.val.copiesBySchool[selectedSchoolFilter];
        if (!holding || (holding.totalCopies || 0) <= 0) {
          return false;
        }
      } else if (b.val.schoolId && b.val.schoolId !== selectedSchoolFilter) {
        return false;
      }
    }

    if (!bookSearch.trim()) return true;
    const q = bookSearch.toLowerCase();
    return (
      b.val.title.toLowerCase().includes(q) ||
      b.val.author.toLowerCase().includes(q) ||
      (b.val.code || '').toLowerCase().includes(q) ||
      (b.val.genre || '').toLowerCase().includes(q)
    );
  });

  // Filtragem de Histórico de Remanejamentos
  const filteredMovements = movements.filter((m) => {
    if (selectedSchoolFilter !== 'todas') {
      if (m.val.sourceSchoolId !== selectedSchoolFilter && m.val.targetSchoolId !== selectedSchoolFilter) {
        return false;
      }
    }
    return true;
  });

  // Indicadores Numéricos de Gestão (adaptados à escola selecionada)
  const baseBooksForStats = selectedSchoolFilter === 'todas'
    ? books
    : books.filter((b) => {
        if (b.val.copiesBySchool) {
          return (b.val.copiesBySchool[selectedSchoolFilter]?.totalCopies || 0) > 0;
        }
        return !b.val.schoolId || b.val.schoolId === selectedSchoolFilter;
      });

  const baseLoansForStats = selectedSchoolFilter === 'todas'
    ? loans
    : loans.filter((l) => {
        if (l.val.schoolId) return l.val.schoolId === selectedSchoolFilter;
        const c = classes.find((cls) => cls.id === l.val.classId);
        return !c?.val?.schoolId || c.val.schoolId === selectedSchoolFilter;
      });

  const totalBooksInCollection = baseBooksForStats.reduce((acc, b) => {
    if (selectedSchoolFilter !== 'todas' && b.val.copiesBySchool && b.val.copiesBySchool[selectedSchoolFilter]) {
      return acc + (b.val.copiesBySchool[selectedSchoolFilter].totalCopies || 0);
    }
    return acc + (b.val.totalCopies || 1);
  }, 0);

  const totalAvailableCopies = baseBooksForStats.reduce((acc, b) => {
    if (selectedSchoolFilter !== 'todas' && b.val.copiesBySchool && b.val.copiesBySchool[selectedSchoolFilter]) {
      return acc + (b.val.copiesBySchool[selectedSchoolFilter].availableCopies || 0);
    }
    return acc + (b.val.availableCopies || 0);
  }, 0);
  const activeLoansCount = baseLoansForStats.filter((l) => l.val.status !== 'devolvido' && !isLoanOverdue(l.val)).length;
  const overdueLoansCount = baseLoansForStats.filter((l) => isLoanOverdue(l.val)).length;
  const returnedLoansCount = baseLoansForStats.filter((l) => l.val.status === 'devolvido').length;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 overflow-x-clip">
      {/* Cabeçalho Principal com Banner Pedagógico */}
      <div className="bg-gradient-to-r from-teal-900 via-emerald-900 to-indigo-950 text-white rounded-3xl p-6 sm:p-8 shadow-sm border border-emerald-800/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-semibold text-emerald-200 border border-white/10 mb-3">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Biblioteca Escolar & Sala de Leitura</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Controle de Acervo & Empréstimos
          </h1>
          <p className="text-emerald-100/90 text-sm mt-1 max-w-xl">
            Gestão simplificada de livros, empréstimos para alunos com prazos automáticos, devoluções e incentivo à leitura.
          </p>
        </div>

        {/* Botões de Ação Superior */}
        <div className="flex flex-wrap items-center gap-2.5">
          {(canManage || canLoan) && (
            <button
              id="btn-novo-emprestimo"
              onClick={() => handleOpenLoanModal()}
              disabled={books.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded-xl text-sm font-bold shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Empréstimo</span>
            </button>
          )}

          {canManage && (
            <button
              id="btn-cadastrar-livro"
              onClick={() => handleOpenBookModal()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl text-sm font-bold backdrop-blur-sm transition cursor-pointer"
            >
              <BookMarked className="w-4 h-4" />
              <span>Cadastrar Livro</span>
            </button>
          )}

          <button
            id="btn-help-library"
            onClick={() => setIsHelpModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl text-sm font-bold backdrop-blur-sm transition cursor-pointer"
            title="Abrir Guia e Manual da Biblioteca"
          >
            <HelpCircle className="w-4 h-4 text-emerald-300" />
            <span className="hidden sm:inline">Manual & Dúvidas</span>
            <span className="sm:hidden">Ajuda</span>
          </button>

          <button
            id="btn-refresh-library"
            onClick={loadData}
            className="p-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl transition cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Seletor de Unidade Escolar (Filtro Integrado de Bibliotecas) */}
      {schools.length > 0 && (
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Rede Municipal de Bibliotecas</span>
              <p className="text-xs sm:text-sm font-bold text-slate-800">
                {selectedSchoolFilter === 'todas'
                  ? `Acervo Integrado (${schools.length} Escolas Municipais)`
                  : `Biblioteca da Escola: ${schools.find((s) => s.id === selectedSchoolFilter)?.name || ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="select-school-filter" className="text-xs font-semibold text-slate-600 hidden sm:inline">
              Filtrar por Unidade:
            </label>
            <select
              id="select-school-filter"
              value={selectedSchoolFilter}
              onChange={(e) => setSelectedSchoolFilter(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-slate-50 cursor-pointer"
            >
              <option value="todas">🏫 Todas as Escolas (Rede Completa)</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  🏫 {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Cartões Rápidos de Indicadores (KPIs) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Acervo Total</span>
            <span className="text-xl sm:text-2xl font-black text-slate-800">{totalBooksInCollection}</span>
            <span className="text-[10px] text-slate-500 block">{baseBooksForStats.length} títulos</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Disponíveis</span>
            <span className="text-xl sm:text-2xl font-black text-indigo-900">{totalAvailableCopies}</span>
            <span className="text-[10px] text-slate-500 block">exemplares livres</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Empréstimos</span>
            <span className="text-xl sm:text-2xl font-black text-amber-700">{activeLoansCount}</span>
            <span className="text-[10px] text-slate-500 block">em dia com alunos</span>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3.5 min-w-0">
          <div className={`p-3 rounded-xl ${overdueLoansCount > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Atrasados</span>
            <span className={`text-xl sm:text-2xl font-black ${overdueLoansCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
              {overdueLoansCount}
            </span>
            <span className="text-[10px] text-slate-500 block">prazo vencido</span>
          </div>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="grid grid-cols-2 gap-1 sm:flex sm:items-center sm:gap-2 p-1 bg-slate-100 rounded-2xl w-full sm:w-fit">
          <button
            id="tab-circulacao"
            onClick={() => setActiveTab('circulacao')}
            className={`px-2 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 min-w-0 ${
              activeTab === 'circulacao'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span className="lg:hidden">Circulação</span>
            <span className="hidden lg:inline">Circulação (Empréstimos)</span>
            {(activeLoansCount + overdueLoansCount) > 0 && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                overdueLoansCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {activeLoansCount + overdueLoansCount}
              </span>
            )}
          </button>

          <button
            id="tab-acervo"
            onClick={() => setActiveTab('acervo')}
            className={`px-2 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 min-w-0 ${
              activeTab === 'acervo'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookMarked className="w-4 h-4" />
            <span className="lg:hidden">Acervo</span>
            <span className="hidden lg:inline">Acervo de Livros</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-700">
              {filteredBooks.length}
            </span>
          </button>

          <button
            id="tab-cantinho"
            onClick={() => setActiveTab('cantinho')}
            className={`px-2 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 min-w-0 ${
              activeTab === 'cantinho'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4 text-emerald-600" />
            <span className="lg:hidden">Cantinho</span>
            <span className="hidden lg:inline">Cantinho da Leitura</span>
          </button>

          <button
            id="tab-historico"
            onClick={() => setActiveTab('historico')}
            className={`px-2 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 min-w-0 ${
              activeTab === 'historico'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="lg:hidden">Histórico</span>
            <span className="hidden lg:inline">Histórico & Remanejamento</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-700">
              {returnedLoansCount + filteredMovements.length}
            </span>
          </button>
        </div>

        {/* Botões de Exportação Rápida */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === 'circulacao' && (
            <>
              <button
                id="btn-export-pdf-loans"
                onClick={handleExportPendingLoansPDF}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                title="Exportar lista de empréstimos em PDF"
              >
                <Download className="w-3.5 h-3.5 text-rose-600" />
                <span>PDF Empréstimos</span>
              </button>

              <button
                id="btn-export-xlsx-loans"
                onClick={handleExportPendingLoansExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                title="Exportar planilha Excel (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel (.xlsx)</span>
              </button>
            </>
          )}

          {activeTab === 'acervo' && (
            <button
              id="btn-export-catalog-xlsx"
              onClick={handleExportBooksCatalogExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
              title="Exportar catálogo completo em Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Exportar Catálogo (.xlsx)</span>
            </button>
          )}
        </div>
      </div>

      {/* CONTEÚDO DA ABA: CIRCULAÇÃO (EMPRÉSTIMOS ATIVOS & ATRASADOS) */}
      {activeTab === 'circulacao' && (
        <div className="space-y-4">
          {/* Barra de Filtros de Empréstimos */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="search-loan-input"
                type="text"
                placeholder="Buscar por aluno, título do livro ou código..."
                value={loanSearch}
                onChange={(e) => setLoanSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {/* Filtro de Status */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  id="filter-loan-ativo"
                  onClick={() => setLoanStatusFilter('ativo')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                    loanStatusFilter === 'ativo' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Em Dia ({activeLoansCount})
                </button>
                <button
                  id="filter-loan-atrasado"
                  onClick={() => setLoanStatusFilter('atrasado')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                    loanStatusFilter === 'atrasado' ? 'bg-white text-red-600 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Atrasados ({overdueLoansCount})
                </button>
                <button
                  id="filter-loan-todos"
                  onClick={() => setLoanStatusFilter('todos')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                    loanStatusFilter === 'todos' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Todos
                </button>
              </div>

              {/* Filtro por Turma */}
              <select
                id="filter-loan-class-select"
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="w-full sm:w-auto max-w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value="todas">Todas as Turmas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.val.year}º {c.val.letter} - {c.val.shift}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Lista de Empréstimos */}
          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 shadow-xs">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mb-3"></div>
              <p>Carregando movimentações da biblioteca...</p>
            </div>
          ) : filteredLoans.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
              <RotateCcw className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-700">Nenhum empréstimo encontrado</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
                {loanStatusFilter === 'atrasado'
                  ? 'Excelente! Não há nenhum empréstimo com devolução em atraso no momento.'
                  : 'Nenhum registro com os filtros selecionados. Clique em "Novo Empréstimo" para registrar a retirada de um livro.'}
              </p>
              {(canManage || canLoan) && books.length > 0 && (
                <button
                  onClick={() => handleOpenLoanModal()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Registrar Novo Empréstimo</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLoans.map((l) => {
                const isOverdue = isLoanOverdue(l.val);
                const isReturned = l.val.status === 'devolvido';

                return (
                  <div
                    key={l.id}
                    id={`card-loan-${l.id}`}
                    className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition flex flex-col justify-between min-w-0 ${
                      isReturned
                        ? 'border-slate-200 opacity-80'
                        : isOverdue
                        ? 'border-red-300 bg-red-50/20 shadow-red-100/50'
                        : 'border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div>
                      {/* Topo do Card */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                          {l.val.className || 'Turma'}
                        </span>

                        <span
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                            isReturned
                              ? 'bg-slate-100 text-slate-600'
                              : isOverdue
                              ? 'bg-red-100 text-red-700 font-black'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isReturned ? 'Devolvido' : isOverdue ? 'Atrasado' : 'No Prazo'}
                        </span>
                      </div>

                      {/* Nome do Aluno e Livro */}
                      <h4 className="text-base font-bold text-slate-800 leading-tight break-words">
                        {l.val.studentName}
                      </h4>
                      {l.val.studentRa && (
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          RA: {l.val.studentRa} {l.val.studentNumber ? `• Nº ${l.val.studentNumber}` : ''}
                        </p>
                      )}

                      <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                        <div className="flex items-start gap-2">
                          <BookOpen className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate" title={l.val.bookTitle}>
                              {l.val.bookTitle}
                            </p>
                            {l.val.bookCode && (
                              <p className="text-[11px] text-slate-500 font-mono">
                                Cód: {l.val.bookCode}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Datas de Empréstimo */}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-slate-50 rounded-lg">
                          <span className="text-[10px] text-slate-400 uppercase font-semibold block">Retirada</span>
                          <span className="font-semibold text-slate-700">{formatDate(l.val.loanDate)}</span>
                        </div>

                        <div className={`p-2 rounded-lg ${isOverdue && !isReturned ? 'bg-red-50 text-red-800' : 'bg-slate-50'}`}>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                            {isReturned ? 'Devolvido em' : 'Devolução Prevista'}
                          </span>
                          <span className={`font-bold ${isOverdue && !isReturned ? 'text-red-700' : 'text-slate-700'}`}>
                            {formatDate(isReturned && l.val.returnDate ? l.val.returnDate : l.val.dueDate)}
                          </span>
                        </div>
                      </div>

                      {l.val.renewalsCount && l.val.renewalsCount > 0 ? (
                        <p className="text-[11px] text-indigo-600 mt-2 font-medium">
                          🔄 Renovado {l.val.renewalsCount} vez(es)
                        </p>
                      ) : null}

                      {l.val.notes && (
                        <p className="text-xs text-slate-500 italic mt-2 line-clamp-2">
                          "{l.val.notes}"
                        </p>
                      )}
                    </div>

                    {/* Ações do Empréstimo */}
                    {!isReturned && (canManage || canLoan) && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                          id={`btn-renovar-${l.id}`}
                          onClick={() => handleQuickRenew(l)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition cursor-pointer"
                          title="Estender o prazo por mais 7 dias"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Renovar</span>
                        </button>

                        <button
                          id={`btn-devolver-${l.id}`}
                          onClick={() => handleOpenReturnModal(l)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl transition shadow-xs cursor-pointer ml-auto"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Devolver</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CONTEÚDO DA ABA: ACERVO DE LIVROS */}
      {activeTab === 'acervo' && (
        <div className="space-y-4">
          {/* Barra de Busca de Livros */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="search-book-input"
                type="text"
                placeholder="Buscar obra por título, autor, código ou gênero..."
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                <button
                  id="btn-cadastrar-por-foto"
                  onClick={() => handleOpenBookModal(undefined, 'photo')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-teal-600 to-emerald-700 hover:from-teal-700 hover:to-emerald-800 text-white rounded-xl text-sm font-semibold shadow-xs transition cursor-pointer"
                  title="Capturar foto da capa frontal e contracapa para leitura inteligente com IA"
                >
                  <Sparkles className="w-4 h-4 text-teal-200" />
                  <span>Cadastrar por Foto (IA)</span>
                </button>

                <button
                  id="btn-cadastrar-livro"
                  onClick={() => handleOpenBookModal(undefined, 'manual')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Novo Livro</span>
                </button>
              </div>
            )}
          </div>

          {/* Grid de Livros */}
          {filteredBooks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
              <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-700">Nenhum livro cadastrado</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
                {bookSearch
                  ? 'Nenhuma obra corresponde aos termos pesquisados.'
                  : 'Comece cadastrando os livros do acervo para permitir empréstimos aos alunos.'}
              </p>
              {canManage && !bookSearch && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => handleOpenBookModal(undefined, 'photo')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-700 hover:from-teal-700 hover:to-emerald-800 text-white rounded-xl text-sm font-semibold transition shadow-xs cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Ler Capa por Foto (IA)</span>
                  </button>
                  <button
                    onClick={() => handleOpenBookModal(undefined, 'manual')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar Manualmente</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBooks.map((b) => {
                const holdingInSelectedSchool = selectedSchoolFilter !== 'todas' && b.val.copiesBySchool
                  ? b.val.copiesBySchool[selectedSchoolFilter]
                  : null;
                const cardAvailableCopies = holdingInSelectedSchool
                  ? (holdingInSelectedSchool.availableCopies ?? 0)
                  : (b.val.availableCopies ?? 0);
                const cardTotalCopies = holdingInSelectedSchool
                  ? (holdingInSelectedSchool.totalCopies ?? 0)
                  : (b.val.totalCopies ?? 1);
                const hasAvailable = cardAvailableCopies > 0;

                return (
                  <div
                    key={b.id}
                    id={`card-book-${b.id}`}
                    className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-300 p-5 shadow-xs transition flex flex-col justify-between group overflow-hidden"
                  >
                    <div>
                      {/* Topo do Livro */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-0.5 rounded-md">
                          {b.val.code}
                        </span>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            hasAvailable
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {hasAvailable
                            ? `${cardAvailableCopies} disponível(is)${selectedSchoolFilter !== 'todas' ? ' nesta unidade' : ''}`
                            : 'Esgotado / Emprestado'}
                        </span>
                      </div>

                      <div className="flex items-start gap-3 mt-1">
                        {b.val.coverUrl ? (
                          <img
                            src={b.val.coverUrl}
                            alt={b.val.title}
                            referrerPolicy="no-referrer"
                            className="w-14 h-20 object-cover rounded-lg shadow-xs border border-slate-200 shrink-0 bg-slate-100"
                          />
                        ) : (
                          <div className="w-11 h-14 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-center shrink-0 text-emerald-600">
                            <BookOpen className="w-5 h-5" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold text-slate-800 leading-tight group-hover:text-emerald-900 transition line-clamp-2">
                            {b.val.title}
                          </h3>
                          <p className="text-xs text-slate-500 font-medium mt-1 truncate">
                            por {b.val.author}
                          </p>
                          {b.val.publisher && (
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {b.val.publisher}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        {/* Identificação e Distribuição da Escola no Card */}
                        {b.val.copiesBySchool && Object.keys(b.val.copiesBySchool).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 w-full">
                            {(Object.entries(b.val.copiesBySchool) as [string, SchoolCopyHolding][])
                              .filter(([_, h]) => (h.totalCopies || 0) > 0)
                              .map(([sId, h]) => (
                                <span
                                  key={sId}
                                  className={`px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 font-medium transition ${
                                    selectedSchoolFilter === sId
                                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold'
                                      : 'bg-slate-50 text-slate-700 border border-slate-200'
                                  }`}
                                  title={`${h.availableCopies} disponíveis de ${h.totalCopies} exemplares em ${h.schoolName || schools.find((s) => s.id === sId)?.name || 'Escola'}`}
                                >
                                  <Building2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                  <span className="truncate max-w-[120px]">
                                    {h.schoolName || schools.find((s) => s.id === sId)?.name || 'Escola'}:
                                  </span>
                                  <strong className="text-emerald-700 font-bold">{h.availableCopies}/{h.totalCopies}</strong>
                                </span>
                              ))}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-bold rounded-md text-[10px] flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span className="truncate max-w-[140px]">
                              {b.val.schoolName || schools.find((s) => s.id === b.val.schoolId)?.name || 'Biblioteca Central'}
                            </span>
                          </span>
                        )}

                        {b.val.genre && (
                          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold rounded-md text-[10px]">
                            {b.val.genre}
                          </span>
                        )}
                        {(holdingInSelectedSchool?.location || b.val.location) && (
                          <span className="text-slate-500 text-[11px]">
                            📍 {holdingInSelectedSchool?.location || b.val.location}
                          </span>
                        )}
                      </div>

                      {b.val.synopsis && (
                        <p className="text-xs text-slate-500 mt-2 line-clamp-2 italic">
                          {b.val.synopsis}
                        </p>
                      )}
                    </div>

                    {/* Rodapé do Card */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-500">
                        {selectedSchoolFilter !== 'todas' ? (
                          <>Nesta unidade: <span className="font-bold text-slate-700">{cardTotalCopies}</span> ex.</>
                        ) : (
                          <>Rede municipal: <span className="font-bold text-slate-700">{b.val.totalCopies}</span> ex.</>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {(canManage || canLoan) && hasAvailable && (
                          <button
                            onClick={() => handleOpenLoanModal(b.id)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                            title="Emprestar este livro"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Emprestar</span>
                          </button>
                        )}

                        {(canManage || canLoan) && hasAvailable && (
                          <button
                            onClick={() => {
                              setPreselectedBookForCorner(b);
                              setActiveTab('cantinho');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                            title="Disponibilizar exemplares desta obra no Cantinho da Leitura em sala de aula"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Cantinho</span>
                          </button>
                        )}

                        {canManage && hasAvailable && schools.length > 1 && (
                          <button
                            onClick={() => handleOpenTransferModal(b)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                            title="Remanejar / transferir exemplares para outra escola da rede"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Remanejar</span>
                          </button>
                        )}

                        {canManage && (
                          <>
                            <button
                              onClick={() => handleOpenBookModal(b)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                              title="Editar livro"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteBook(b)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                              title="Excluir livro"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CONTEÚDO DA ABA: CANTINHO DA LEITURA */}
      {activeTab === 'cantinho' && (
        <ReadingCornerTab
          books={books}
          classes={classes}
          schools={schools}
          loans={loans}
          canManage={canManage}
          canLoan={canLoan}
          isAdmin={isAdmin}
          selectedSchoolFilter={selectedSchoolFilter}
          currentYear={currentYear}
          preselectedBookForAllocation={preselectedBookForCorner}
          onClearPreselectedBook={() => setPreselectedBookForCorner(null)}
          onDataChanged={loadData}
          setModal={setModal}
        />
      )}

      {/* CONTEÚDO DA ABA: HISTÓRICO DE LEITURAS E REMANEJAMENTOS */}
      {activeTab === 'historico' && (
        <div className="space-y-4">
          {/* Sub-abas de Histórico */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
            <div className="grid grid-cols-2 gap-1 sm:flex sm:items-center sm:gap-2 p-1 bg-slate-100 rounded-xl w-full sm:w-fit">
              <button
                type="button"
                id="btn-subtab-devolucoes"
                onClick={() => setHistorySubTab('devolucoes')}
                className={`px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 min-w-0 ${
                  historySubTab === 'devolucoes'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="sm:hidden">Devoluções</span>
                <span className="hidden sm:inline">Devoluções de Alunos</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-slate-200 text-slate-700">
                  {returnedLoansCount}
                </span>
              </button>

              <button
                type="button"
                id="btn-subtab-remanejamentos"
                onClick={() => setHistorySubTab('remanejamentos')}
                className={`px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center sm:justify-start gap-1.5 min-w-0 ${
                  historySubTab === 'remanejamentos'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span className="sm:hidden">Remanejamentos</span>
                <span className="hidden sm:inline">Remanejamentos entre Escolas</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-slate-200 text-slate-700">
                  {filteredMovements.length}
                </span>
              </button>
            </div>

            {historySubTab === 'remanejamentos' && (
              <button
                type="button"
                id="btn-export-movements-excel"
                onClick={handleExportMovementsExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer self-end sm:self-auto"
                title="Exportar planilha Excel das movimentações entre escolas"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar Excel</span>
              </button>
            )}
          </div>

          {/* SUB-ABA 1: DEVOLUÇÕES DE ALUNOS */}
          {historySubTab === 'devolucoes' && (
            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs min-w-0">
              <h3 className="text-base font-bold text-slate-800 mb-1 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Livros Devolvidos & Histórico de Leitura
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Registro das obras já lidas pelos alunos durante o ano letivo.
              </p>

              {returnedLoansCount === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-700">Nenhuma devolução concluída ainda</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Assim que os alunos devolverem os livros na aba de Circulação, o histórico ficará registrado aqui.
                  </p>
                </div>
              ) : (
                <>
                  {/* Celular: cartões (tabela de 6 colunas não cabe na tela) */}
                  <div className="md:hidden space-y-3">
                    {loans
                      .filter((l) => l.val.status === 'devolvido')
                      .map((l) => (
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
                      {loans
                        .filter((l) => l.val.status === 'devolvido')
                        .map((l) => (
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

          {/* SUB-ABA 2: REMANEJAMENTOS ENTRE ESCOLAS */}
          {historySubTab === 'remanejamentos' && (
            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <ArrowRightLeft className="w-5 h-5 text-teal-600" />
                    Movimentações & Remanejamentos do Acervo Escolar
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Histórico completo de transferências de livros físicos entre as bibliotecas das escolas da rede municipal.
                  </p>
                </div>
              </div>

              {filteredMovements.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <ArrowRightLeft className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-700">Nenhum remanejamento registrado</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    Quando um livro for transferido de uma escola para outra na aba "Acervo de Livros" clicando no botão "Remanejar", o comprovante e rastreabilidade aparecerão aqui.
                  </p>
                </div>
              ) : (
                <>
                  {/* Celular: cartões (tabela de 7 colunas não cabe na tela) */}
                  <div className="md:hidden space-y-3">
                    {filteredMovements.map((m) => (
                      <div key={m.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-bold text-slate-900 break-words min-w-0">{m.val.bookTitle}</p>
                          <span className="text-xs font-bold text-emerald-700 shrink-0">{m.val.copies} ex.</span>
                        </div>
                        {m.val.bookCode && (
                          <p className="text-[10px] text-slate-400 font-mono">Cód: {m.val.bookCode}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md max-w-full">
                            <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="break-words min-w-0">{m.val.sourceSchoolName}</span>
                          </span>
                          <ArrowRightLeft className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md max-w-full">
                            <Building2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span className="break-words min-w-0">{m.val.targetSchoolName}</span>
                          </span>
                        </div>
                        {m.val.reason && (
                          <p className="text-xs text-slate-600 break-words">{m.val.reason}</p>
                        )}
                        <p className="text-[11px] text-slate-500 font-mono">
                          {new Date(m.val.createdAt).toLocaleString('pt-BR')} · {m.val.userName || 'Sistema'}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Tablet / computador: tabela */}
                  <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Data/Hora</th>
                        <th className="py-2.5 px-3">Obra / Livro</th>
                        <th className="py-2.5 px-3">Escola de Origem</th>
                        <th className="py-2.5 px-3">Escola de Destino</th>
                        <th className="py-2.5 px-3 text-center">Exemplares</th>
                        <th className="py-2.5 px-3">Motivo / Justificativa</th>
                        <th className="py-2.5 px-3">Responsável</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/80 transition">
                          <td className="py-2.5 px-3 text-slate-600 font-mono whitespace-nowrap">
                            {new Date(m.val.createdAt).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-bold text-slate-900 block">{m.val.bookTitle}</span>
                            {m.val.bookCode && (
                              <span className="text-[10px] text-slate-400 font-mono">Cód: {m.val.bookCode}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                              <Building2 className="w-3 h-3 text-slate-500" />
                              {m.val.sourceSchoolName}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
                              <Building2 className="w-3 h-3 text-emerald-600" />
                              {m.val.targetSchoolName}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-emerald-700">
                            {m.val.copies} ex.
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate" title={m.val.reason}>
                            {m.val.reason}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                            {m.val.userName || 'Sistema'}
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
        </div>
      )}

      {/* MODAL 1: CADASTRO / EDIÇÃO DE LIVRO */}
      {isBookModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <BookMarked className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-bold text-slate-800">
                  {editingBookId ? 'Editar Livro' : 'Cadastrar Livro no Acervo'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {!editingBookId && (
                  <button
                    type="button"
                    onClick={() => setShowAssistant(!showAssistant)}
                    className="text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{showAssistant ? 'Ocultar Assistente' : 'Assistente IA / ISBN'}</span>
                  </button>
                )}
                <button
                  onClick={() => setIsBookModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* ASSISTENTE DE CADASTRO INTELIGENTE (FOTO / IA OU ISBN) */}
            {showAssistant && !editingBookId && (
              <div className="mb-5 bg-gradient-to-br from-teal-50/70 via-emerald-50/40 to-slate-50 border border-emerald-200/80 rounded-2xl p-4 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-emerald-100">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-emerald-600 text-white rounded-lg">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        Assistente de Preenchimento Rápido
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Capture as fotos da obra ou busque por ISBN para preencher tudo em segundos.
                      </p>
                    </div>
                  </div>

                  {/* Alternador de Abas do Assistente */}
                  <div className="flex items-center bg-white/90 p-0.5 rounded-xl border border-emerald-200 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setAssistantTab('photo')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                        assistantTab === 'photo'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Fotos (IA)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssistantTab('isbn')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                        assistantTab === 'isbn'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      <Barcode className="w-3.5 h-3.5" />
                      <span>Buscar ISBN</span>
                    </button>
                  </div>
                </div>

                {/* ABA 1: FOTOS DA CAPA E CONTRACAPA */}
                {assistantTab === 'photo' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* CAPA FRONTAL */}
                      <div className="border border-dashed border-emerald-300 rounded-xl p-3 bg-white/80 flex flex-col items-center justify-center text-center relative hover:bg-white transition min-h-[140px]">
                        {frontCoverImg ? (
                          <div className="relative w-full flex flex-col items-center">
                            <img
                              src={frontCoverImg}
                              alt="Capa Frontal"
                              className="h-28 w-20 object-cover rounded-lg shadow-xs border border-slate-200"
                            />
                            <button
                              type="button"
                              onClick={() => setFrontCoverImg(null)}
                              className="absolute -top-1 -right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-xs cursor-pointer"
                              title="Remover foto da capa"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[11px] font-bold text-emerald-700 mt-1 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Capa frontal pronta
                            </span>
                          </div>
                        ) : (
                          <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-2">
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleFrontImageChange}
                              className="hidden"
                            />
                            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-1.5">
                              <Camera className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-bold text-slate-800">
                              Foto da Capa (Frente)
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5">
                              Identifica título, autor e ilustrações
                            </span>
                            <span className="text-[10px] font-semibold text-emerald-700 mt-1 bg-emerald-50 px-2 py-0.5 rounded-md">
                              Tirar foto ou carregar
                            </span>
                          </label>
                        )}
                      </div>

                      {/* CONTRACAPA / VERSO */}
                      <div className="border border-dashed border-emerald-300 rounded-xl p-3 bg-white/80 flex flex-col items-center justify-center text-center relative hover:bg-white transition min-h-[140px]">
                        {backCoverImg ? (
                          <div className="relative w-full flex flex-col items-center">
                            <img
                              src={backCoverImg}
                              alt="Contracapa"
                              className="h-28 w-20 object-cover rounded-lg shadow-xs border border-slate-200"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setBackCoverImg(null);
                                setDetectedBarcode(null);
                              }}
                              className="absolute -top-1 -right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-xs cursor-pointer"
                              title="Remover foto da contracapa"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[11px] font-bold text-emerald-700 mt-1 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Contracapa pronta
                            </span>
                            {detectedBarcode && (
                              <span className="text-[10px] font-bold text-teal-800 bg-teal-100 border border-teal-200 px-2 py-0.5 rounded-full mt-1 flex items-center gap-1">
                                <Barcode className="w-3 h-3 text-teal-600" />
                                ISBN {detectedBarcode}
                              </span>
                            )}
                          </div>
                        ) : (
                          <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-2">
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleBackImageChange}
                              className="hidden"
                            />
                            <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center mb-1.5">
                              <Camera className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-bold text-slate-800">
                              Foto da Contracapa (Verso)
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5">
                              Identifica sinopse, editora, ano e ISBN
                            </span>
                            <span className="text-[10px] font-semibold text-teal-700 mt-1 bg-teal-50 px-2 py-0.5 rounded-md">
                              Tirar foto ou carregar
                            </span>
                          </label>
                        )}
                      </div>
                    </div>

                    {/* BOTÃO DE AÇÃO DA IA */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                      <p className="text-[11px] text-slate-500 italic">
                        💡 Dica: A contracapa é opcional, mas ajuda a extrair a sinopse e o código ISBN.
                      </p>
                      <button
                        type="button"
                        id="btn-scan-ai-action"
                        onClick={handleAnalyzeWithAI}
                        disabled={isAnalyzingPhotos || (!frontCoverImg && !backCoverImg)}
                        className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer shrink-0"
                      >
                        {isAnalyzingPhotos ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-200" />
                            <span>Lendo fotos com IA...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 text-emerald-200" />
                            <span>Ler Fotos com IA e Preencher</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* ABA 2: BUSCA POR CÓDIGO ISBN */}
                {assistantTab === 'isbn' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Código ISBN da Obra (10 ou 13 dígitos)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <div className="relative flex-1 min-w-[12rem]">
                        <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Ex: 9788535902778 ou 8535902775"
                          value={quickIsbnInput}
                          onChange={(e) => setQuickIsbnInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSearchISBN();
                            }
                          }}
                          className="w-full pl-10 pr-4 py-2 bg-white border border-emerald-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <label
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition cursor-pointer shrink-0"
                        title="Tirar foto ou carregar imagem do código de barras para leitura automática"
                      >
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleScanBarcodeImage}
                          className="hidden"
                        />
                        <Camera className="w-4 h-4 text-emerald-600" />
                        <span className="hidden sm:inline">Fotografar Código</span>
                      </label>

                      <button
                        type="button"
                        id="btn-search-isbn-action"
                        onClick={() => handleSearchISBN()}
                        disabled={isSearchingIsbn || !quickIsbnInput.trim()}
                        className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer shrink-0"
                      >
                        {isSearchingIsbn ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Consultando acervos...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-4 h-4" />
                            <span>Buscar Obra por ISBN</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Consulta integrada na <strong>CBL (Câmara Brasileira do Livro)</strong>, <strong>Google Books</strong> e <strong>OpenLibrary</strong>.
                    </p>
                  </div>
                )}

                {/* MENSAGEM DE SUCESSO DO ASSISTENTE */}
                {quickFillSuccessMsg && (
                  <div className="mt-3 p-3 bg-emerald-100/90 border border-emerald-300 rounded-xl text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2 animate-in fade-in">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      {quickFillSuccessMsg}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuickFillSuccessMsg(null)}
                      className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-0.5"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* AVISOS DA LEITURA (ISBN descartado, campos incertos, fotos de obras diferentes...) */}
                {quickFillWarnings.length > 0 && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 space-y-1">
                    {quickFillWarnings.map((w, i) => (
                      <p key={i} className="flex items-start gap-1.5">
                        <span className="shrink-0">⚠️</span>
                        <span>{w}</span>
                      </p>
                    ))}
                  </div>
                )}

                {/* BOTÃO LIMPAR LEITURA / RECOMEÇAR */}
                {(frontCoverImg || backCoverImg || quickIsbnInput || quickFillSuccessMsg || bookTitle) && (
                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-emerald-200/60">
                    <span className="text-[11px] text-slate-500">
                      Deseja limpar as fotos ou os dados lidos para recomeçar?
                    </span>
                    <button
                      type="button"
                      id="btn-clear-ocr-fields"
                      onClick={handleClearOCRAndFields}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition cursor-pointer"
                      title="Limpar fotos e campos preenchidos"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                      <span>Limpar Dados da Leitura</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSaveBook} className="space-y-4">
              {/* Se tiver coverUrl preenchida pela busca do ISBN, exibe miniatura */}
              {bookCoverUrl && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <img
                    src={bookCoverUrl}
                    alt="Capa identificada"
                    referrerPolicy="no-referrer"
                    className="w-12 h-16 object-cover rounded-lg shadow-xs border border-slate-200"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-slate-800">Capa Oficial Identificada</span>
                    <p className="text-[11px] text-slate-500 truncate">
                      A miniatura da capa será exibida nos cartões do acervo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBookCoverUrl('')}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 p-1 cursor-pointer"
                    title="Remover capa"
                  >
                    Remover
                  </button>
                </div>
              )}

              {schools.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Unidade Escolar / Biblioteca Destino *
                  </label>
                  <select
                    id="input-book-school"
                    value={bookSchoolId}
                    onChange={(e) => setBookSchoolId(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-800 bg-slate-50 cursor-pointer"
                  >
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        🏫 {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Título da Obra *
                </label>
                <input
                  id="input-book-title"
                  type="text"
                  required
                  placeholder="Ex: O Menino Maluquinho"
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Autor(a)
                  </label>
                  <input
                    id="input-book-author"
                    type="text"
                    placeholder="Ex: Ziraldo"
                    value={bookAuthor}
                    onChange={(e) => setBookAuthor(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Código / Tombamento
                  </label>
                  <input
                    id="input-book-code"
                    type="text"
                    placeholder="Ex: LIV-00124"
                    value={bookCode}
                    onChange={(e) => setBookCode(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Gênero / Categoria
                  </label>
                  <select
                    id="select-book-genre"
                    value={bookGenre}
                    onChange={(e) => setBookGenre(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium"
                  >
                    <option value="Literatura Infantil">Literatura Infantil</option>
                    <option value="Contos & Fábulas">Contos & Fábulas</option>
                    <option value="Poesia">Poesia</option>
                    <option value="Gibis & Quadrinhos">Gibis & Quadrinhos</option>
                    <option value="Didático & Apoio">Didático & Apoio</option>
                    <option value="Juvenil">Juvenil</option>
                    <option value="Enciclopédia & Ciências">Enciclopédia & Ciências</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Quantidade de Exemplares *
                  </label>
                  <input
                    id="input-book-copies"
                    type="number"
                    min="1"
                    required
                    value={bookTotalCopies}
                    onChange={(e) => setBookTotalCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-emerald-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Localização (Estante/Prateleira)
                  </label>
                  <input
                    id="input-book-location"
                    type="text"
                    placeholder="Ex: Estante 2 - Prateleira B"
                    value={bookLocation}
                    onChange={(e) => setBookLocation(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Editora / Ano (Opcional)
                  </label>
                  <input
                    id="input-book-publisher"
                    type="text"
                    placeholder="Ex: Melhoramentos (2018)"
                    value={bookPublisher}
                    onChange={(e) => setBookPublisher(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Sinopse / Observações
                </label>
                <textarea
                  id="input-book-synopsis"
                  rows={2}
                  placeholder="Breve descrição da obra ou estado de conservação..."
                  value={bookSynopsis}
                  onChange={(e) => setBookSynopsis(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBookModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-save-book-submit"
                  type="submit"
                  disabled={savingBook}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl text-sm font-semibold shadow-xs transition cursor-pointer"
                >
                  {savingBook ? 'Salvando...' : editingBookId ? 'Atualizar Livro' : 'Salvar no Acervo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: NOVO EMPRÉSTIMO */}
      {isLoanModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-emerald-600" />
                Registrar Novo Empréstimo
              </h3>
              <button
                onClick={() => setIsLoanModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterLoan} className="space-y-4">
              {/* Seleção do Livro */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Selecione a Obra *
                </label>
                <select
                  id="loan-select-book"
                  required
                  value={loanSelectedBookId}
                  onChange={(e) => setLoanSelectedBookId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium"
                >
                  <option value="">-- Escolha um livro do acervo --</option>
                  {books.map((b) => (
                    <option
                      key={b.id}
                      value={b.id}
                      disabled={b.val.availableCopies <= 0}
                    >
                      {b.val.title} ({b.val.code}) — {b.val.availableCopies > 0 ? `${b.val.availableCopies} disp.` : 'ESGOTADO'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seleção da Turma */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Turma do Aluno *
                </label>
                <select
                  id="loan-select-class"
                  required
                  value={loanSelectedClassId}
                  onChange={(e) => {
                    setLoanSelectedClassId(e.target.value);
                    setLoanSelectedStudentId('');
                  }}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium"
                >
                  <option value="">-- Escolha a turma --</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.val.year}º Ano {c.val.letter} - {c.val.shift} ({c.val.schoolName || 'Escola'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Seleção do Aluno */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Aluno(a) Retirante *
                </label>
                <select
                  id="loan-select-student"
                  required
                  disabled={!loanSelectedClassId || studentsInSelectedClass.length === 0}
                  value={loanSelectedStudentId}
                  onChange={(e) => setLoanSelectedStudentId(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium disabled:bg-slate-50"
                >
                  <option value="">
                    {!loanSelectedClassId
                      ? 'Selecione primeiro a turma acima'
                      : studentsInSelectedClass.length === 0
                      ? 'Nenhum aluno cadastrado nesta turma'
                      : '-- Selecione o aluno --'}
                  </option>
                  {studentsInSelectedClass.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.number ? `Nº ${s.number} - ` : ''}{s.name} {s.ra ? `(RA: ${s.ra})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Prazos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Data de Retirada
                  </label>
                  <input
                    id="loan-date-input"
                    type="date"
                    required
                    value={loanDate}
                    onChange={(e) => setLoanDate(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-semibold text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Prazo de Devolução
                  </label>
                  <select
                    id="loan-duration-select"
                    value={loanDaysDuration}
                    onChange={(e) => setLoanDaysDuration(parseInt(e.target.value, 10))}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-semibold text-emerald-800"
                  >
                    <option value={7}>7 dias (1 semana)</option>
                    <option value={14}>14 dias (2 semanas)</option>
                    <option value={21}>21 dias (3 semanas)</option>
                    <option value={30}>30 dias (1 mês)</option>
                  </select>
                </div>
              </div>

              {/* Data prevista calculada */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl flex items-center justify-between">
                <span className="text-xs text-emerald-900 font-semibold">Devolução Prevista:</span>
                <span className="text-sm font-black text-emerald-800">
                  {formatDate(calculateDueDate(loanDate, loanDaysDuration))}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Observações (Opcional)
                </label>
                <input
                  id="loan-notes-input"
                  type="text"
                  placeholder="Ex: Leitura para projeto de Língua Portuguesa"
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLoanModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-confirm-loan-submit"
                  type="submit"
                  disabled={savingLoan || !loanSelectedBookId || !loanSelectedStudentId}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-semibold shadow-xs transition cursor-pointer"
                >
                  {savingLoan ? 'Registrando...' : 'Confirmar Empréstimo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: REGISTRO DE DEVOLUÇÃO */}
      {isReturnModalOpen && selectedLoanForReturn && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Confirmar Devolução
              </h3>
              <button
                onClick={() => setIsReturnModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1.5 mb-4">
              <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Obra devolvida</p>
              <h4 className="text-base font-bold text-slate-900">{selectedLoanForReturn.val.bookTitle}</h4>
              <p className="text-xs text-slate-600">
                Aluno(a): <strong className="text-slate-800">{selectedLoanForReturn.val.studentName}</strong> ({selectedLoanForReturn.val.className || 'Turma'})
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Data Efetiva da Devolução
                </label>
                <input
                  id="return-date-input"
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-semibold text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Estado do Livro / Observações
                </label>
                <input
                  id="return-notes-input"
                  type="text"
                  placeholder="Ex: Livro devolvido em excelente estado"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
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
                  id="btn-confirm-return-submit"
                  type="button"
                  disabled={processingAction}
                  onClick={handleConfirmReturn}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl text-sm font-semibold shadow-xs transition cursor-pointer"
                >
                  {processingAction ? 'Processando...' : 'Dar Baixa e Retornar ao Acervo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: REMANEJAMENTO / TRANSFERÊNCIA DE LIVROS ENTRE ESCOLAS */}
      {isTransferModalOpen && transferBook && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-teal-50 text-teal-700 rounded-xl">
                  <ArrowRightLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    Remanejar Exemplares entre Bibliotecas
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Transfira o acervo físico mantendo a rastreabilidade da rede municipal.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Informações da Obra e Formulário */}
            {(() => {
              const transferSourceHolding = transferBook.val.copiesBySchool && transferSourceSchoolId
                ? transferBook.val.copiesBySchool[transferSourceSchoolId]
                : null;
              const availableForTransfer = transferSourceHolding
                ? Number(transferSourceHolding.availableCopies ?? 0)
                : Number(transferBook.val.availableCopies ?? 0);
              const hasMultiSchool = Boolean(
                transferBook.val.copiesBySchool &&
                Object.keys(transferBook.val.copiesBySchool).filter(
                  (k) => (transferBook.val.copiesBySchool![k].totalCopies || 0) > 0
                ).length > 1
              );

              return (
                <>
                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 mb-4 flex items-start gap-3">
                    <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-slate-800 truncate">
                        {transferBook.val.title}
                      </h4>
                      <p className="text-xs text-slate-500">
                        por {transferBook.val.author || 'Autor não informado'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-slate-600">
                          Disponíveis na unidade selecionada:{' '}
                          <strong className="text-emerald-700 font-bold">
                            {availableForTransfer} exemplares
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleRegisterTransfer} className="space-y-4">
                    {/* Escola de Origem */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Biblioteca de Origem (Onde estão os exemplares) *
                      </label>
                      {hasMultiSchool ? (
                        <select
                          id="select-transfer-source-school"
                          value={transferSourceSchoolId}
                          onChange={(e) => {
                            const newSource = e.target.value;
                            setTransferSourceSchoolId(newSource);
                            if (transferTargetSchoolId === newSource) {
                              const alt = schools.find((s) => s.id !== newSource);
                              setTransferTargetSchoolId(alt?.id || '');
                            }
                          }}
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white cursor-pointer"
                        >
                          {(Object.entries(transferBook.val.copiesBySchool!) as [string, SchoolCopyHolding][])
                            .filter(([_, h]) => (h.availableCopies || 0) > 0)
                            .map(([sId, h]) => (
                              <option key={sId} value={sId}>
                                🏫 {h.schoolName || schools.find((s) => s.id === sId)?.name || 'Escola'} — {h.availableCopies} disp. (de {h.totalCopies} ex.)
                              </option>
                            ))}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2 p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                          <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>
                            {schools.find((s) => s.id === transferSourceSchoolId)?.name ||
                              transferBook.val.copiesBySchool?.[transferSourceSchoolId]?.schoolName ||
                              transferBook.val.schoolName ||
                              'Biblioteca Central'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Escola de Destino */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Escola / Biblioteca de Destino *
                      </label>
                      <select
                        id="select-transfer-target-school"
                        required
                        value={transferTargetSchoolId}
                        onChange={(e) => setTransferTargetSchoolId(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white cursor-pointer"
                      >
                        <option value="">Selecione a escola que receberá os livros...</option>
                        {schools
                          .filter((s) => s.id !== transferSourceSchoolId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              🏫 {s.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Quantidade de Exemplares */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Quantidade de Exemplares a Transferir *
                      </label>
                      <input
                        id="input-transfer-copies"
                        type="number"
                        min="1"
                        max={availableForTransfer}
                        required
                        value={transferCopies}
                        onChange={(e) => setTransferCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        Máximo permitido: {availableForTransfer} ex. disponíveis neste momento nesta escola.
                      </span>
                    </div>

                    {/* Motivo ou Justificativa */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Motivo / Justificativa do Remanejamento
                      </label>
                      <input
                        id="input-transfer-reason"
                        type="text"
                        placeholder="Ex: Demanda pedagógica para projeto de leitura do 4º ano"
                        value={transferReason}
                        onChange={(e) => setTransferReason(e.target.value)}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>

                    {/* Ações */}
                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setIsTransferModalOpen(false)}
                        className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        id="btn-confirm-transfer-submit"
                        type="submit"
                        disabled={processingTransfer || !transferTargetSchoolId || availableForTransfer <= 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-xs transition cursor-pointer"
                      >
                        {processingTransfer ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-teal-200" />
                            <span>Remanejando...</span>
                          </>
                        ) : (
                          <>
                            <ArrowRightLeft className="w-4 h-4" />
                            <span>Confirmar Remanejamento</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal Interativo de Manual e Dúvidas da Biblioteca */}
      <LibraryManualModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />
    </div>
  );
};
