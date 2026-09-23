import React, { useState, useEffect, useMemo } from 'react';
import { ClassRoom, Student, ModalConfig, DEFAULT_SUBJECTS, SubjectItem } from '../types';
import {
  get,
  ref,
  update,
  rtdb,
  dc,
  carregarMinhasTurmas,
  verificarIsAdmin
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  Award,
  Save,
  Trash2,
  AlertCircle,
  Sparkles,
  Search,
  CheckSquare,
  Square,
  Table,
  SlidersHorizontal,
  X,
  History,
  Eye,
  EyeOff
} from 'lucide-react';

interface GradesScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

interface AuditItem {
  key: string;
  studentId: string;
  studentName: string;
  studentRa?: string;
  classId: string;
  className: string;
  bimester: string;
  subject: string;
  subjectName: string;
  value: number | string;
  anoLetivo?: string;
  reason: string;
  type: 'orphan_student' | 'orphan_class' | 'duplicate_key';
}

export const GradesScreen: React.FC<GradesScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedSubject, setSelectedSubject] = useState('portugues');
  const [availableSubjects, setAvailableSubjects] = useState<SubjectItem[]>(DEFAULT_SUBJECTS);
  const [isAdmin, setIsAdmin] = useState(false);

  // Modo de visualização: 'single' (uma matéria) ou 'matrix' (todas as matérias consolidadas da turma)
  const [viewMode, setViewMode] = useState<'single' | 'matrix'>('single');

  const [students, setStudents] = useState<{ id: string; val: Student }[]>([]);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [gradeKeysMap, setGradeKeysMap] = useState<Record<string, string[]>>({});
  
  // Mapa de todas as notas da turma no bimestre atual: [studentId][subject] = { value, keys }
  const [classMatrixGrades, setClassMatrixGrades] = useState<Record<string, Record<string, { value: string; keys: string[] }>>>({});
  // Contadores de notas por matéria na turma/bimestre
  const [subjectCounts, setSubjectCounts] = useState<Record<string, number>>({});
  // Todas as matérias presentes no banco para a turma selecionada
  const [detectedSubjectIds, setDetectedSubjectIds] = useState<string[]>([]);

  // Exibição das notas dos bimestres anteriores (somente leitura)
  const [showPreviousBimesters, setShowPreviousBimesters] = useState<boolean>(() => {
    return localStorage.getItem('dc_show_prev_bimesters') === 'true';
  });
  // Mapa de notas de bimestres anteriores: [studentId][bimesterNumber] = string
  const [previousBimesterGrades, setPreviousBimesterGrades] = useState<Record<string, Record<number, string>>>({});

  const [loading, setLoading] = useState(false);

  // Estados do Modal de Auditoria e Visualização Prévia (Admin)
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [selectedAuditKeys, setSelectedAuditKeys] = useState<Set<string>>(new Set());
  const [auditFilter, setAuditFilter] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  useEffect(() => {
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, []);

  const loadSubjectsList = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: SubjectItem[] = Object.keys(val).map((k) => val[k]);
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (list.length > 0) {
          setAvailableSubjects(list);
          if (!list.some((s) => s.id === selectedSubject)) {
            setSelectedSubject(list[0].id);
          }
        }
      }
    } catch (e) {
      console.log('Usando disciplinas padrão:', e);
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

  const getSubjectName = (subId: string) => {
    const found = availableSubjects.find((s) => s.id === subId);
    if (found) return found.name;
    const defaultFound = DEFAULT_SUBJECTS.find((s) => s.id === subId);
    if (defaultFound) return defaultFound.name;
    if (subId === 'portugues') return 'Língua Portuguesa';
    if (subId === 'matematica') return 'Matemática';
    if (subId === 'ciencias') return 'Ciências';
    if (subId === 'historia') return 'História';
    if (subId === 'geografia') return 'Geografia';
    if (subId === 'arte') return 'Arte';
    if (subId === 'ed_fisica') return 'Educação Física';
    if (subId === 'ingles') return 'Língua Inglesa';
    if (subId === 'ens_religioso') return 'Ensino Religioso';
    return subId;
  };

  const loadGrades = async () => {
    if (!selectedClassId || !selectedBimester) return;

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

      const notasSnap = await get(ref(rtdb, dc('notas')));
      const notasVal = notasSnap.val() || {};
      const newGrades: Record<string, string> = {};
      const newGradeKeysMap: Record<string, string[]> = {};
      
      const matrixMap: Record<string, Record<string, { value: string; keys: string[] }>> = {};
      const counts: Record<string, number> = {};
      const detectedSubs = new Set<string>();
      const prevGradesMap: Record<string, Record<number, string>> = {};

      const currentBimNum = parseInt(selectedBimester, 10) || 1;

      Object.keys(notasVal).forEach((k) => {
        const g = notasVal[k];
        if (!g || g.classId !== selectedClassId) {
          return;
        }

        if (g.anoLetivo && currentYear && String(g.anoLetivo) !== String(currentYear)) {
          return;
        }

        const gSubject = g.subject || 'portugues';
        const gBimNum = parseInt(String(g.bimester), 10);

        // Se for a mesma matéria mas de um bimestre anterior, armazenar para visualização de histórico
        if (gSubject === selectedSubject && gBimNum < currentBimNum && g.studentId && g.value !== undefined && g.value !== null && g.value !== '') {
          if (!prevGradesMap[g.studentId]) {
            prevGradesMap[g.studentId] = {};
          }
          prevGradesMap[g.studentId][gBimNum] = String(g.value);
        }

        if (String(g.bimester) !== String(selectedBimester)) {
          return;
        }

        detectedSubs.add(gSubject);

        if (g.value !== undefined && g.value !== null && g.value !== '') {
          counts[gSubject] = (counts[gSubject] || 0) + 1;

          // Matriz de todas as notas
          if (!matrixMap[g.studentId]) {
            matrixMap[g.studentId] = {};
          }
          if (!matrixMap[g.studentId][gSubject]) {
            matrixMap[g.studentId][gSubject] = { value: String(g.value), keys: [] };
          }
          matrixMap[g.studentId][gSubject].keys.push(k);
          matrixMap[g.studentId][gSubject].value = String(g.value);

          // Matéria selecionada atualmente
          if (gSubject === selectedSubject) {
            newGrades[g.studentId] = String(g.value);
            if (!newGradeKeysMap[g.studentId]) {
              newGradeKeysMap[g.studentId] = [];
            }
            newGradeKeysMap[g.studentId].push(k);
          }
        }
      });

      setGrades(newGrades);
      setGradeKeysMap(newGradeKeysMap);
      setClassMatrixGrades(matrixMap);
      setSubjectCounts(counts);
      setDetectedSubjectIds(Array.from(detectedSubs));
      setPreviousBimesterGrades(prevGradesMap);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Notas',
        message: formatFriendlyError(err, 'Não foi possível carregar as notas'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
    loadSubjectsList();
  }, [currentYear]);

  useEffect(() => {
    loadGrades();
  }, [selectedClassId, selectedBimester, selectedSubject, currentYear]);

  const handleGradeChange = (studentId: string, valStr: string) => {
    let formatted = valStr.replace(',', '.');
    if (formatted === '' || formatted === '-') {
      setGrades((prev) => ({ ...prev, [studentId]: formatted }));
      return;
    }

    const num = parseFloat(formatted);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      setGrades((prev) => ({ ...prev, [studentId]: formatted }));
    }
  };

  const handleSaveAll = async () => {
    if (!selectedClassId || !selectedBimester) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Selecione a turma e o bimestre!',
        icon: '⚠️'
      });
    }

    try {
      setLoading(true);
      const updates: Record<string, any> = {};

      students.forEach((s) => {
        if (s.val.status === 'expedida') return;
        const valStr = grades[s.id];
        const canonicalKey = `${selectedClassId}_${selectedBimester}_${selectedSubject}_${s.id}`;

        const existingKeys = gradeKeysMap[s.id] || [];
        existingKeys.forEach((oldKey) => {
          if (oldKey !== canonicalKey) {
            updates[dc(`notas/${oldKey}`)] = null;
          }
        });
        if (selectedSubject === 'portugues') {
          updates[dc(`notas/${selectedClassId}_${selectedBimester}_${s.id}`)] = null;
        }

        if (valStr !== undefined && valStr !== '' && !isNaN(parseFloat(valStr))) {
          const numVal = parseFloat(valStr);
          updates[dc(`notas/${canonicalKey}`)] = {
            classId: selectedClassId,
            studentId: s.id,
            bimester: selectedBimester,
            subject: selectedSubject,
            value: numVal,
            teacher: currentTeacher,
            anoLetivo: currentYear,
            createdAt: Date.now()
          };
        } else {
          updates[dc(`notas/${canonicalKey}`)] = null;
        }
      });

      await update(ref(rtdb), updates);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: `Notas de ${getSubjectName(selectedSubject)} salvas com sucesso!`,
        icon: '✅'
      });
      loadGrades();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Notas',
        message: formatFriendlyError(err, 'Não foi possível salvar as notas'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSingle = async (studentId: string) => {
    const targetStudent = students.find((s) => s.id === studentId);
    if (targetStudent?.val.status === 'expedida') {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Operação Não Permitida',
        message: '⛔ Não é possível lançar ou salvar notas para alunos com transferência expedida.',
        icon: '⛔'
      });
    }

    const valStr = grades[studentId];
    if (valStr === undefined || valStr === '' || isNaN(parseFloat(valStr))) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Informe uma nota válida (0 a 10)!',
        icon: '⚠️'
      });
    }

    try {
      const numVal = parseFloat(valStr);
      const canonicalKey = `${selectedClassId}_${selectedBimester}_${selectedSubject}_${studentId}`;
      const updates: Record<string, any> = {};

      const existingKeys = gradeKeysMap[studentId] || [];
      existingKeys.forEach((oldKey) => {
        if (oldKey !== canonicalKey) {
          updates[dc(`notas/${oldKey}`)] = null;
        }
      });
      if (selectedSubject === 'portugues') {
        updates[dc(`notas/${selectedClassId}_${selectedBimester}_${studentId}`)] = null;
      }

      updates[dc(`notas/${canonicalKey}`)] = {
        classId: selectedClassId,
        studentId: studentId,
        bimester: selectedBimester,
        subject: selectedSubject,
        value: numVal,
        teacher: currentTeacher,
        anoLetivo: currentYear,
        createdAt: Date.now()
      };

      await update(ref(rtdb), updates);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Sucesso',
        message: 'Nota do aluno salva!',
        icon: '✅'
      });
      loadGrades();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Nota',
        message: formatFriendlyError(err, 'Não foi possível salvar a nota do aluno'),
        icon: '❌'
      });
    }
  };

  const handleDeleteSingle = async (studentId: string, subjectToDelete?: string) => {
    const subId = subjectToDelete || selectedSubject;
    const subName = getSubjectName(subId);

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Nota',
      message: `Tem certeza que deseja excluir a nota de ${subName} deste aluno no ${selectedBimester}º bimestre?`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          const canonicalKey = `${selectedClassId}_${selectedBimester}_${subId}_${studentId}`;
          const keyLegacy = `${selectedClassId}_${selectedBimester}_${studentId}`;
          const updates: Record<string, any> = {};

          updates[dc(`notas/${canonicalKey}`)] = null;
          if (subId === 'portugues') {
            updates[dc(`notas/${keyLegacy}`)] = null;
          }

          // Se tiver chaves mapeadas da matriz ou do mapa atual
          const existingKeys =
            classMatrixGrades[studentId]?.[subId]?.keys ||
            (subId === selectedSubject ? gradeKeysMap[studentId] : []) ||
            [];

          existingKeys.forEach((k) => {
            updates[dc(`notas/${k}`)] = null;
          });

          await update(ref(rtdb), updates);

          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: `Nota de ${subName} excluída com sucesso!`,
            icon: '✅'
          });
          loadGrades();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir',
            message: formatFriendlyError(err, 'Não foi possível excluir a nota'),
            icon: '❌'
          });
        }
      }
    });
  };

  const handleDeleteAll = async () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Todas as Notas',
      message: `Atenção: Você tem certeza que deseja excluir TODAS as notas de ${getSubjectName(
        selectedSubject
      )} do ${selectedBimester}º bimestre desta turma? Esta ação não pode ser desfeita.`,
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          setLoading(true);
          const updates: Record<string, any> = {};

          students.forEach((s) => {
            const canonicalKey = `${selectedClassId}_${selectedBimester}_${selectedSubject}_${s.id}`;
            updates[dc(`notas/${canonicalKey}`)] = null;
            if (selectedSubject === 'portugues') {
              updates[dc(`notas/${selectedClassId}_${selectedBimester}_${s.id}`)] = null;
            }
          });

          Object.values(gradeKeysMap).forEach((keys: string[]) => {
            keys.forEach((k: string) => {
              updates[dc(`notas/${k}`)] = null;
            });
          });

          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: `Todas as notas de ${getSubjectName(selectedSubject)} foram excluídas!`,
            icon: '✅'
          });
          loadGrades();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Notas',
            message: formatFriendlyError(err, 'Não foi possível excluir as notas'),
            icon: '❌'
          });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // Rotina de Auditoria detalhada com Preview item por item (Exclusivo Admin)
  const handleOpenAuditModal = async () => {
    try {
      setLoading(true);
      const [turmasSnap, notasSnap] = await Promise.all([
        get(ref(rtdb, 'diario-classe/turmas')),
        get(ref(rtdb, dc('notas')))
      ]);

      const turmasData = turmasSnap.val() || {};
      const notasData = notasSnap.val() || {};

      const detectedItems: AuditItem[] = [];
      const seenTuples = new Set<string>();

      Object.keys(notasData).forEach((key) => {
        const g = notasData[key];
        if (!g) {
          detectedItems.push({
            key,
            studentId: 'desconhecido',
            studentName: 'Registro Inválido/Vazio',
            classId: 'desconhecido',
            className: 'Turma Não Identificada',
            bimester: '-',
            subject: 'desconhecido',
            subjectName: 'Não Identificada',
            value: '-',
            reason: 'Registro nulo ou corrompido no banco de dados',
            type: 'orphan_student'
          });
          return;
        }

        const turma = turmasData[g.classId];
        const gSub = g.subject || 'portugues';
        const subName = getSubjectName(gSub);

        if (!turma) {
          // Turma excluída
          detectedItems.push({
            key,
            studentId: g.studentId || 'desconhecido',
            studentName: 'Aluno de Turma Excluída',
            classId: g.classId || 'desconhecido',
            className: `Turma Excluída (ID: ${g.classId})`,
            bimester: String(g.bimester || '-'),
            subject: gSub,
            subjectName: subName,
            value: g.value ?? '-',
            anoLetivo: g.anoLetivo,
            reason: 'A turma deste lançamento não existe mais no sistema',
            type: 'orphan_class'
          });
          return;
        }

        const className = `${turma.year || ''}º ${turma.letter || ''} — ${turma.shift || ''} (${turma.schoolName || ''})`;
        const aluno = turma.alunos?.[g.studentId];

        if (!aluno) {
          // Aluno não existe na turma
          detectedItems.push({
            key,
            studentId: g.studentId || 'desconhecido',
            studentName: `Aluno Excluído da Turma (ID: ${g.studentId})`,
            studentRa: '-',
            classId: g.classId,
            className,
            bimester: String(g.bimester || '-'),
            subject: gSub,
            subjectName: subName,
            value: g.value ?? '-',
            anoLetivo: g.anoLetivo,
            reason: 'O aluno não se encontra mais cadastrado nesta turma',
            type: 'orphan_student'
          });
          return;
        }

        // Se o aluno existe, verificar se é uma chave duplicada / legada
        const tuple = `${g.classId}_${g.bimester}_${gSub}_${g.studentId}`;
        const canonicalKey = tuple;

        if (seenTuples.has(tuple)) {
          detectedItems.push({
            key,
            studentId: g.studentId,
            studentName: aluno.name || 'Aluno',
            studentRa: aluno.ra,
            classId: g.classId,
            className,
            bimester: String(g.bimester || '-'),
            subject: gSub,
            subjectName: subName,
            value: g.value ?? '-',
            anoLetivo: g.anoLetivo,
            reason: 'Registro duplicado para o mesmo aluno/bimestre/matéria',
            type: 'duplicate_key'
          });
        } else {
          seenTuples.add(tuple);
          if (key !== canonicalKey) {
            detectedItems.push({
              key,
              studentId: g.studentId,
              studentName: aluno.name || 'Aluno',
              studentRa: aluno.ra,
              classId: g.classId,
              className,
              bimester: String(g.bimester || '-'),
              subject: gSub,
              subjectName: subName,
              value: g.value ?? '-',
              anoLetivo: g.anoLetivo,
              reason: 'Chave com formato legado ou gerada automaticamente',
              type: 'duplicate_key'
            });
          }
        }
      });

      if (detectedItems.length === 0) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Banco de Notas 100% Íntegro',
          message: 'Excelente! Não foi encontrada nenhuma nota órfã, duplicada ou com turma/aluno excluído no banco de dados.',
          icon: '✅'
        });
        return;
      }

      setAuditItems(detectedItems);
      // Seleciona todos por padrão
      setSelectedAuditKeys(new Set(detectedItems.map((i) => i.key)));
      setIsAuditModalOpen(true);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Auditoria',
        message: formatFriendlyError(err, 'Não foi possível auditar as notas'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAuditKey = (key: string) => {
    setSelectedAuditKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleToggleSelectAllAudit = () => {
    if (selectedAuditKeys.size === filteredAuditItems.length) {
      setSelectedAuditKeys(new Set());
    } else {
      setSelectedAuditKeys(new Set(filteredAuditItems.map((i) => i.key)));
    }
  };

  const handleExecuteAuditDelete = async () => {
    if (selectedAuditKeys.size === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Nenhum registro foi selecionado para exclusão.',
        icon: '⚠️'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão de Registros',
      message: `Tem certeza que deseja excluir em definitivo os ${selectedAuditKeys.size} registros de notas selecionados do banco de dados?`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          setLoading(true);
          const updates: Record<string, any> = {};

          selectedAuditKeys.forEach((key) => {
            updates[dc(`notas/${key}`)] = null;
          });

          await update(ref(rtdb), updates);

          setIsAuditModalOpen(false);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Limpeza Realizada com Sucesso',
            message: `Foram removidos ${selectedAuditKeys.size} registros órfãos/duplicados com sucesso!`,
            icon: '✅'
          });
          loadGrades();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro na Exclusão',
            message: formatFriendlyError(err, 'Não foi possível remover os registros selecionados'),
            icon: '❌'
          });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const filteredAuditItems = useMemo(() => {
    return auditItems.filter((item) => {
      if (auditFilter && item.type !== auditFilter) return false;
      if (auditSearch) {
        const query = auditSearch.toLowerCase();
        const matchStudent = item.studentName.toLowerCase().includes(query);
        const matchClass = item.className.toLowerCase().includes(query);
        const matchSub = item.subjectName.toLowerCase().includes(query);
        const matchRa = item.studentRa?.toLowerCase().includes(query);
        if (!matchStudent && !matchClass && !matchSub && !matchRa) return false;
      }
      return true;
    });
  }, [auditItems, auditFilter, auditSearch]);

  const selectedTurma = classes.find((c) => c.id === selectedClassId)?.val;

  // Lista unificada de matérias para a tabela matriz (grade cadastrada + matérias detectadas com nota)
  const matrixSubjects = useMemo(() => {
    const map = new Map<string, SubjectItem>();
    availableSubjects.forEach((s) => map.set(s.id, s));
    detectedSubjectIds.forEach((id) => {
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: getSubjectName(id),
          shortName: id.slice(0, 4).toUpperCase(),
          category: 'regente'
        });
      }
    });
    return Array.from(map.values());
  }, [availableSubjects, detectedSubjectIds]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
            <Award className="w-7 h-7 text-indigo-600" />
            <span>Lançamento de Notas por Matéria</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Regentes e Professores Especialistas podem lançar e consolidar notas por componente curricular da grade
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Alternador de Visão */}
          <div className="inline-flex p-1 bg-slate-100 border border-slate-200 rounded-xl">
            <button
              onClick={() => setViewMode('single')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'single'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Por Matéria</span>
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Visão Geral da Turma</span>
            </button>
          </div>

          {/* Botão de Auditoria — Exclusivo Administradores */}
          {isAdmin && (
            <button
              id="btn-audit-orphan-grades"
              onClick={handleOpenAuditModal}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition shadow-2xs cursor-pointer"
              title="Auditar e pré-visualizar notas órfãs, legadas ou duplicadas (Apenas Admin)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Auditar e Limpar Órfãs</span>
            </button>
          )}
        </div>
      </div>

      {/* Controles Principais */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Turma *
            </label>
            <select
              id="grades-class"
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
              id="grades-bimester"
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

          {viewMode === 'single' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span>Matéria / Disciplina *</span>
                <span className="text-[10px] text-indigo-600 font-bold">
                  {subjectCounts[selectedSubject] || 0} nota(s) lançada(s)
                </span>
              </label>
              <select
                id="grades-subject"
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-indigo-50/50 border border-indigo-200 text-indigo-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold"
              >
                {matrixSubjects.map((s) => {
                  const count = subjectCounts[s.id] || 0;
                  const isDetected = !availableSubjects.some((as) => as.id === s.id);
                  return (
                    <option key={s.id} value={s.id}>
                      📖 {s.name} {count > 0 ? `(${count} notas)` : '(vazio)'}{' '}
                      {isDetected ? '[Detectada no Banco]' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div className="flex flex-col justify-end">
              <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
                <span className="font-semibold">Modo: Visão Consolidada</span>
                <span className="font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full text-[10px]">
                  {matrixSubjects.length} Matérias
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODO 1: Lançamento Por Matéria */}
      {viewMode === 'single' && selectedClassId && selectedBimester && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:px-6 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2 flex-wrap">
                <span>Alunos da Turma:</span>
                <span className="text-indigo-600">
                  {selectedTurma?.year}º {selectedTurma?.letter}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-semibold">
                  {getSubjectName(selectedSubject)} — {selectedBimester}º Bimestre
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Digite as notas de 0 a 10 para cada estudante (ex: 8.5 ou 9,0)
              </p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap sm:flex-nowrap">
              {/* Checkbox para exibir notas de bimestres anteriores (disponível a partir do 2º bimestre) */}
              {parseInt(selectedBimester, 10) > 1 && (
                <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100/90 hover:bg-slate-200/70 text-slate-700 border border-slate-200 rounded-xl cursor-pointer text-xs font-semibold transition select-none">
                  <input
                    type="checkbox"
                    checked={showPreviousBimesters}
                    onChange={(e) => {
                      setShowPreviousBimesters(e.target.checked);
                      localStorage.setItem('dc_show_prev_bimesters', String(e.target.checked));
                    }}
                    className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <History className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Ver bimestres anteriores</span>
                </label>
              )}

              <button
                id="btn-save-all-grades"
                onClick={handleSaveAll}
                disabled={loading}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Salvar Todas</span>
              </button>

              <button
                id="btn-delete-all-grades"
                onClick={handleDeleteAll}
                disabled={loading}
                className="inline-flex items-center justify-center p-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition border border-rose-200 cursor-pointer"
                title="Excluir todas as notas deste bimestre"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 text-sm">Carregando notas...</div>
          ) : students.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <AlertCircle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
              <p className="font-semibold text-sm">Nenhum aluno ativo encontrado nesta turma.</p>
              <p className="text-xs text-slate-400 mt-1">
                Cadastre os estudantes no módulo de Alunos para realizar os lançamentos.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 w-14 text-center">Nº</th>
                    <th className="px-5 py-3">Nome do Aluno</th>
                    <th className="px-5 py-3">RA</th>
                    {/* Colunas dos Bimestres Anteriores (se ativado e bimester > 1) */}
                    {showPreviousBimesters && parseInt(selectedBimester, 10) > 1 && (
                      Array.from({ length: parseInt(selectedBimester, 10) - 1 }, (_, i) => i + 1).map((b) => (
                        <th
                          key={`th-prev-bim-${b}`}
                          className="px-3 py-3 w-24 text-center bg-slate-100/70 border-x border-slate-200/70 text-slate-600 font-bold"
                          title={`Nota lançada no ${b}º Bimestre (Somente leitura)`}
                        >
                          <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                            <span>{b}º Bim</span>
                            <span className="text-[9px] px-1 bg-slate-200/80 text-slate-600 rounded">Histórico</span>
                          </div>
                        </th>
                      ))
                    )}
                    <th className="px-5 py-3 w-40 text-center bg-indigo-50/40 border-indigo-100 border-x">
                      <div className="flex items-center justify-center gap-1 text-indigo-900 font-bold">
                        <span>{selectedBimester}º Bim (Atual)</span>
                      </div>
                    </th>
                    <th className="px-5 py-3 w-32 text-center">Desempenho</th>
                    <th className="px-5 py-3 w-28 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((s) => {
                    const isExpedido = s.val.status === 'expedida';
                    const isRecebida = s.val.status === 'recebida';
                    const gradeVal = grades[s.id] || '';
                    const num = parseFloat(gradeVal.replace(',', '.'));
                    const hasValidGrade = !isNaN(num);
                    const currentBimNumber = parseInt(selectedBimester, 10) || 1;

                    return (
                      <tr
                        key={s.id}
                        className={`transition-colors ${
                          isExpedido ? 'bg-slate-50/50 opacity-60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="px-5 py-3.5 text-center font-bold text-slate-700">
                          {s.val.number}
                        </td>
                        <td className="px-5 py-3.5 font-semibold text-slate-900">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{s.val.name}</span>
                            {isExpedido && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 uppercase tracking-wider">
                                Transferência Expedida
                              </span>
                            )}
                            {isRecebida && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 uppercase tracking-wider">
                                Transferência Recebida
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                          {s.val.ra || '-'}
                        </td>

                        {/* Notas dos Bimestres Anteriores */}
                        {showPreviousBimesters && currentBimNumber > 1 && (
                          Array.from({ length: currentBimNumber - 1 }, (_, i) => i + 1).map((b) => {
                            const prevVal = previousBimesterGrades[s.id]?.[b];
                            const prevNum = prevVal !== undefined ? parseFloat(String(prevVal).replace(',', '.')) : NaN;
                            const hasPrevGrade = !isNaN(prevNum);

                            return (
                              <td
                                key={`td-prev-${s.id}-${b}`}
                                className="px-3 py-3.5 text-center bg-slate-50/60 border-x border-slate-100 font-medium"
                              >
                                {isExpedido ? (
                                  <span className="text-xs text-slate-300">-</span>
                                ) : hasPrevGrade ? (
                                  <span
                                    className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold border ${
                                      prevNum >= 6
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                                        : 'bg-rose-50 text-rose-700 border-rose-200/60'
                                    }`}
                                    title={`${b}º Bimestre: ${prevNum.toFixed(1)}`}
                                  >
                                    {prevNum.toFixed(1)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-300 italic">-</span>
                                )}
                              </td>
                            );
                          })
                        )}

                        <td className="px-5 py-3.5 text-center bg-indigo-50/20 border-x border-indigo-100/50">
                          {isExpedido ? (
                            <span className="inline-block w-24 px-3 py-1.5 text-center text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded-lg italic select-none">
                              Não aplicável
                            </span>
                          ) : (
                            <input
                              type="text"
                              placeholder="-"
                              value={gradeVal}
                              onChange={(e) => handleGradeChange(s.id, e.target.value)}
                              className="w-24 px-3 py-1.5 text-center font-bold text-sm bg-white border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 shadow-2xs"
                            />
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {isExpedido ? (
                            <span className="text-xs text-slate-400 italic">Não aplicável</span>
                          ) : hasValidGrade ? (
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                num >= 6
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {num >= 6 ? 'Aprovado' : 'Atenção'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">Sem nota</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isExpedido && (
                              <button
                                onClick={() => handleSaveSingle(s.id)}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                                title="Salvar nota deste aluno"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteSingle(s.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Excluir nota"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODO 2: Visão Geral e Matriz de Todas as Matérias da Turma */}
      {viewMode === 'matrix' && selectedClassId && selectedBimester && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:px-6 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-indigo-50/30">
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
                <span>Matriz Completa de Notas:</span>
                <span className="text-indigo-600">
                  {selectedTurma?.year}º {selectedTurma?.letter}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-semibold">
                  {selectedBimester}º Bimestre
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Visão consolidada de todas as disciplinas para identificação rápida e remoção direta de lançamentos
              </p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left text-xs text-slate-600 border-collapse">
              <thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700 sticky top-0 z-10 shadow-2xs">
                <tr>
                  <th className="px-3 py-3 w-12 text-center border-b border-r border-slate-200 bg-slate-100">Nº</th>
                  <th className="px-4 py-3 min-w-[200px] border-b border-r border-slate-200 bg-slate-100">Aluno</th>
                  {matrixSubjects.map((sub) => (
                    <th
                      key={sub.id}
                      className="px-3 py-3 text-center border-b border-r border-slate-200 min-w-[100px] bg-slate-100"
                      title={sub.name}
                    >
                      <div className="font-extrabold text-slate-800">{sub.shortName || sub.name}</div>
                      <div className="text-[9px] text-indigo-600 font-medium lowercase truncate max-w-[90px] mx-auto">
                        {subjectCounts[sub.id] || 0} lançada(s)
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s) => {
                  const isExpedido = s.val.status === 'expedida';
                  return (
                    <tr
                      key={s.id}
                      className={`hover:bg-slate-50 transition ${isExpedido ? 'bg-slate-50/50 opacity-60' : ''}`}
                    >
                      <td className="px-3 py-2.5 text-center font-bold text-slate-700 border-r border-slate-100">
                        {s.val.number}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 border-r border-slate-100">
                        <div className="truncate max-w-[220px]" title={s.val.name}>
                          {s.val.name}
                        </div>
                        {isExpedido && (
                          <span className="text-[9px] text-rose-600 font-bold uppercase tracking-wider">
                            TR. EXPEDIDA
                          </span>
                        )}
                      </td>
                      {matrixSubjects.map((sub) => {
                        const cellData = classMatrixGrades[s.id]?.[sub.id];
                        const val = cellData?.value;
                        const hasVal = val !== undefined && val !== null && val !== '';

                        return (
                          <td
                            key={sub.id}
                            className={`px-3 py-2 text-center border-r border-slate-100 ${
                              hasVal ? 'bg-indigo-50/30' : ''
                            }`}
                          >
                            {hasVal ? (
                              <div className="inline-flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-indigo-200 shadow-2xs">
                                <span className="font-extrabold text-indigo-950 text-xs">{val}</span>
                                <button
                                  onClick={() => handleDeleteSingle(s.id, sub.id)}
                                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer transition"
                                  title={`Excluir nota de ${sub.name}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL DE AUDITORIA E VISUALIZAÇÃO PRÉVIA (ADMIN ONLY) */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header do Modal */}
            <div className="px-6 py-4 border-b border-slate-100 bg-amber-50/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-2xl">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">
                    Auditoria e Limpeza de Notas Órfãs e Duplicadas
                  </h3>
                  <p className="text-xs text-slate-500">
                    Identificação de resíduos cadastrais para auditoria pedagógica e limpeza seletiva
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAuditModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de Filtros e Busca */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Buscar aluno, turma ou matéria..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                <select
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 font-medium text-slate-700"
                >
                  <option value="">Todos os Diagnósticos</option>
                  <option value="orphan_student">Aluno Excluído da Turma</option>
                  <option value="orphan_class">Turma Inexistente</option>
                  <option value="duplicate_key">Chave Duplicada / Legada</option>
                </select>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                <button
                  onClick={handleToggleSelectAllAudit}
                  className="text-xs font-bold text-slate-700 hover:text-indigo-600 flex items-center gap-1.5 cursor-pointer"
                >
                  {selectedAuditKeys.size === filteredAuditItems.length && filteredAuditItems.length > 0 ? (
                    <>
                      <CheckSquare className="w-4 h-4 text-indigo-600" />
                      <span>Desmarcar Todos</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4 text-slate-400" />
                      <span>Marcar Todos</span>
                    </>
                  )}
                </button>

                <span className="text-xs font-bold px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full">
                  {selectedAuditKeys.size} de {auditItems.length} selecionado(s)
                </span>
              </div>
            </div>

            {/* Tabela de Preview */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredAuditItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">
                  Nenhum registro encontrado para os filtros selecionados.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-100 font-bold text-slate-700 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 w-12 text-center">Sel.</th>
                        <th className="px-4 py-3">Aluno / Identificador</th>
                        <th className="px-4 py-3">Turma</th>
                        <th className="px-3 py-3 text-center">Bim.</th>
                        <th className="px-4 py-3">Matéria</th>
                        <th className="px-3 py-3 text-center">Nota</th>
                        <th className="px-4 py-3">Diagnóstico / Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAuditItems.map((item) => {
                        const isSelected = selectedAuditKeys.has(item.key);
                        return (
                          <tr
                            key={item.key}
                            onClick={() => handleToggleAuditKey(item.key)}
                            className={`cursor-pointer transition ${
                              isSelected ? 'bg-amber-50/40 hover:bg-amber-50/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAuditKey(item.key)}
                                className="rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                              />
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-900">
                              <div>{item.studentName}</div>
                              {item.studentRa && item.studentRa !== '-' && (
                                <div className="text-[10px] text-slate-400 font-mono">RA: {item.studentRa}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {item.className}
                            </td>
                            <td className="px-3 py-3 text-center font-bold text-slate-800">
                              {item.bimester}º
                            </td>
                            <td className="px-4 py-3 font-semibold text-indigo-700">
                              {item.subjectName}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className="font-extrabold text-xs px-2 py-0.5 rounded bg-white border border-slate-200 shadow-2xs">
                                {item.value}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  item.type === 'orphan_student'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : item.type === 'orphan_class'
                                    ? 'bg-red-100 text-red-800 border border-red-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {item.reason}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                Esta ação remove somente os registros selecionados no Firebase.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAuditModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  onClick={handleExecuteAuditDelete}
                  disabled={selectedAuditKeys.size === 0 || loading}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 rounded-xl shadow-xs transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir {selectedAuditKeys.size} Selecionados</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
