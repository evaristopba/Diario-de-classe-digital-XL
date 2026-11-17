import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LessonPlan, ClassRoom, Category, BNCCSkill, ModalConfig, Teacher } from '../types';
import {
  get,
  ref,
  push,
  update,
  remove,
  rtdb,
  dc,
  carregarMinhasTurmas,
  getTodayDateString,
  getCurrentAuthUid
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import { isSkillApplicableToYear, formatSkillYearsLabel, getSkillApplicableYears } from '../lib/bnccHelper';
import {
  buildTeacherAliasSet,
  formatDiasGradeResumo,
  getDiasAulaDocenteNaTurma,
  getWeekdayLabelPt,
  isTurmaCompativelComPlano,
  normSeriePlano,
  sugerirDataTurmaPelaGrade
} from '../lib/lessonPlanHelper';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  X,
  Search,
  CheckCircle2,
  Filter,
  Calendar,
  RotateCcw,
  Copy,
  ClipboardCopy,
  Layers
} from 'lucide-react';

interface LessonPlanScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

export const LessonPlanScreen: React.FC<LessonPlanScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; val: Teacher }[]>([]);
  const [categories, setCategories] = useState<{ id: string; val: Category }[]>([]);
  const [bnccList, setBnccList] = useState<{ id: string; val: BNCCSkill }[]>([]);

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateString());
  const [categoryId, setCategoryId] = useState('');
  const [selectedBnccIds, setSelectedBnccIds] = useState<string[]>([]);
  const [planned, setPlanned] = useState('');
  const [given, setGiven] = useState('');
  const [obs, setObs] = useState('');

  // Lançamento multi-turma no próprio formulário de criação
  interface TargetReplicaInfo {
    date: string;
    manual: boolean;
    fromSchedule: boolean;
    diasGrade: number[];
  }
  const [showMultiClassPanel, setShowMultiClassPanel] = useState(false);
  const [extraTargets, setExtraTargets] = useState<Record<string, TargetReplicaInfo>>({});

  // Modal de duplicação para plano já salvo
  const [duplicateSource, setDuplicateSource] = useState<{ id: string; val: LessonPlan } | null>(null);
  const [duplicateRefDate, setDuplicateRefDate] = useState<string>(() => getTodayDateString());
  const [duplicateTargets, setDuplicateTargets] = useState<Record<string, TargetReplicaInfo>>({});
  const [duplicating, setDuplicating] = useState(false);

  const [filterClassId, setFilterClassId] = useState('');
  const [filterBimester, setFilterBimester] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [lessonPlans, setLessonPlans] = useState<{ id: string; val: LessonPlan }[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showBnccCards, setShowBnccCards] = useState(true);
  const [bnccSearch, setBnccSearch] = useState('');
  const [filterBnccByYear, setFilterBnccByYear] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const turmas = await carregarMinhasTurmas();
      const filtered = turmas.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
      if (filtered.length > 0 && !selectedClassId) {
        setSelectedClassId(filtered[0].id);
      }

      const [catSnap, bnccSnap, profSnap] = await Promise.all([
        get(ref(rtdb, 'diario-classe/categorias')),
        get(ref(rtdb, 'diario-classe/bncc')),
        get(ref(rtdb, 'diario-classe/professores')).catch(() => null)
      ]);

      const catVal = catSnap.val() || {};
      const catArr: { id: string; val: Category }[] = [];
      Object.keys(catVal).forEach((k) => catArr.push({ id: k, val: catVal[k] }));
      catArr.sort((a, b) => a.val.name.localeCompare(b.val.name));
      setCategories(catArr);

      const bnccVal = bnccSnap.val() || {};
      const bnccArr: { id: string; val: BNCCSkill }[] = [];
      Object.keys(bnccVal).forEach((k) => bnccArr.push({ id: k, val: bnccVal[k] }));
      setBnccList(bnccArr);

      const profVal = profSnap?.val() || {};
      const profArr: { id: string; val: Teacher }[] = [];
      Object.keys(profVal).forEach((k) => profArr.push({ id: k, val: profVal[k] }));
      setTeachers(profArr);
    } catch (err) {
      console.error(err);
    }
  };

  const loadLessonPlans = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, dc('planos-aula')));
      const val = snap.val() || {};
      const list: { id: string; val: LessonPlan }[] = [];
      Object.keys(val).forEach((k) => {
        const p = val[k];
        if (!p.anoLetivo || p.anoLetivo === currentYear) {
          if (!filterClassId || p.classId === filterClassId) {
            if (!filterBimester || String(p.bimester) === String(filterBimester)) {
              // Filtro por período (de/até)
              if (filterStartDate && p.date && p.date < filterStartDate) {
                return;
              }
              if (filterEndDate && p.date && p.date > filterEndDate) {
                return;
              }
              list.push({ id: k, val: p });
            }
          }
        }
      });
      // Ordena mostrando os planos mais novos primeiro (data decrescente e timestamp de criação/atualização decrescente)
      list.sort((a, b) => {
        const dateCmp = (b.val.date || '').localeCompare(a.val.date || '');
        if (dateCmp !== 0) return dateCmp;
        const bTime = b.val.createdAt || b.val.ratifiedAt || 0;
        const aTime = a.val.createdAt || a.val.ratifiedAt || 0;
        return bTime - aTime;
      });
      setLessonPlans(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentYear]);

  useEffect(() => {
    loadLessonPlans();
  }, [filterClassId, filterBimester, filterStartDate, filterEndDate, currentYear]);

  const teacherIdentity = useMemo(
    () => buildTeacherAliasSet(getCurrentAuthUid(), currentTeacher, teachers),
    [currentTeacher, teachers]
  );

  // Remove turma principal da lista de réplicas caso o usuário altere a turma principal
  useEffect(() => {
    if (!selectedClassId) return;
    setExtraTargets((prev) => {
      if (!prev[selectedClassId]) return prev;
      const next = { ...prev };
      delete next[selectedClassId];
      return next;
    });
  }, [selectedClassId]);

  // Atualiza datas sugeridas automaticamente quando a data principal muda (preservando edições manuais)
  useEffect(() => {
    if (editingId || !selectedDate) return;
    setExtraTargets((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next: Record<string, TargetReplicaInfo> = {};
      ids.forEach((cid) => {
        const entry = prev[cid];
        const turma = classes.find((c) => c.id === cid)?.val;
        if (!entry.manual && turma) {
          const sug = sugerirDataTurmaPelaGrade(
            turma,
            selectedDate,
            teacherIdentity.aliases,
            teacherIdentity.nameNorm
          );
          if (sug.date !== entry.date || sug.fromSchedule !== entry.fromSchedule) {
            changed = true;
          }
          next[cid] = {
            date: sug.date,
            manual: false,
            fromSchedule: sug.fromSchedule,
            diasGrade: sug.diasGrade
          };
        } else {
          next[cid] = entry;
        }
      });
      return changed ? next : prev;
    });
  }, [selectedDate, editingId, classes, teacherIdentity]);

  // Fechar modal de duplicação com Esc
  useEffect(() => {
    if (!duplicateSource) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !duplicating) {
        setDuplicateSource(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duplicateSource, duplicating]);

  const currentClass = classes.find((c) => c.id === selectedClassId)?.val;
  const currentClassYear = currentClass ? currentClass.year : '';
  const currentSerieNorm = normSeriePlano(currentClassYear);

  const otherClassesSorted = useMemo(() => {
    const others = classes.filter(
      (c) =>
        c.id !== selectedClassId &&
        isTurmaCompativelComPlano({
          targetYear: c.val.year,
          sourceYear: currentClassYear,
          selectedBnccIds,
          bnccList
        })
    );
    return others.sort((a, b) => {
      const aSame = currentSerieNorm && normSeriePlano(a.val.year) === currentSerieNorm ? 0 : 1;
      const bSame = currentSerieNorm && normSeriePlano(b.val.year) === currentSerieNorm ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      const yCmp = String(a.val.year || '').localeCompare(String(b.val.year || ''), 'pt-BR', { numeric: true });
      if (yCmp !== 0) return yCmp;
      return String(a.val.letter || '').localeCompare(String(b.val.letter || ''), 'pt-BR');
    });
  }, [classes, selectedClassId, currentClassYear, currentSerieNorm, selectedBnccIds, bnccList]);

  // Remove automaticamente turmas extras que ficarem incompatíveis ao trocar série ou habilidade BNCC
  useEffect(() => {
    const allowedIds = new Set(otherClassesSorted.map((c) => c.id));
    setExtraTargets((prev) => {
      const prevIds = Object.keys(prev);
      if (prevIds.every((id) => allowedIds.has(id))) return prev;
      const next: Record<string, TargetReplicaInfo> = {};
      prevIds.forEach((id) => {
        if (allowedIds.has(id)) next[id] = prev[id];
      });
      return next;
    });
  }, [otherClassesSorted]);

  const sameSeriesOtherClasses = useMemo(
    () =>
      currentSerieNorm
        ? otherClassesSorted.filter((c) => normSeriePlano(c.val.year) === currentSerieNorm)
        : [],
    [otherClassesSorted, currentSerieNorm]
  );

  const extraTargetsCount = Object.keys(extraTargets).length;

  const toggleExtraTarget = (classItem: { id: string; val: ClassRoom }) => {
    setExtraTargets((prev) => {
      const next = { ...prev };
      if (next[classItem.id]) {
        delete next[classItem.id];
      } else {
        const sug = sugerirDataTurmaPelaGrade(
          classItem.val,
          selectedDate || getTodayDateString(),
          teacherIdentity.aliases,
          teacherIdentity.nameNorm
        );
        next[classItem.id] = {
          date: sug.date,
          manual: false,
          fromSchedule: sug.fromSchedule,
          diasGrade: sug.diasGrade
        };
      }
      return next;
    });
  };

  const selectSameSeriesExtraTargets = () => {
    if (sameSeriesOtherClasses.length === 0) return;
    const base = selectedDate || getTodayDateString();
    setExtraTargets((prev) => {
      const next = { ...prev };
      sameSeriesOtherClasses.forEach((c) => {
        if (!next[c.id]) {
          const sug = sugerirDataTurmaPelaGrade(
            c.val,
            base,
            teacherIdentity.aliases,
            teacherIdentity.nameNorm
          );
          next[c.id] = {
            date: sug.date,
            manual: false,
            fromSchedule: sug.fromSchedule,
            diasGrade: sug.diasGrade
          };
        }
      });
      return next;
    });
    setShowMultiClassPanel(true);
  };

  const applySameDateToAllExtraTargets = () => {
    const base = selectedDate || getTodayDateString();
    setExtraTargets((prev) => {
      const next: Record<string, TargetReplicaInfo> = {};
      Object.entries(prev).forEach(([cid, info]) => {
        next[cid] = { ...info, date: base, manual: true, fromSchedule: false };
      });
      return next;
    });
  };

  const reapplyScheduleDatesToExtraTargets = () => {
    const base = selectedDate || getTodayDateString();
    setExtraTargets((prev) => {
      const next: Record<string, TargetReplicaInfo> = {};
      Object.entries(prev).forEach(([cid]) => {
        const turma = classes.find((c) => c.id === cid)?.val;
        if (turma) {
          const sug = sugerirDataTurmaPelaGrade(
            turma,
            base,
            teacherIdentity.aliases,
            teacherIdentity.nameNorm
          );
          next[cid] = {
            date: sug.date,
            manual: false,
            fromSchedule: sug.fromSchedule,
            diasGrade: sug.diasGrade
          };
        }
      });
      return next;
    });
  };

  const filteredBncc = bnccList
    .filter(
      (b) => !filterBnccByYear || !currentClassYear || isSkillApplicableToYear(b.val, currentClassYear)
    )
    .filter(
      (b) =>
        !bnccSearch ||
        b.val.code.toLowerCase().includes(bnccSearch.toLowerCase()) ||
        (b.val.desc || b.val.description || '').toLowerCase().includes(bnccSearch.toLowerCase())
    )
    .sort((a, b) => a.val.code.localeCompare(b.val.code));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !selectedBimester || !selectedDate || !planned.trim() || !categoryId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos obrigatórios (Turma, Bimestre, Data, Categoria e Conteúdo Programado)!',
        icon: '⚠️'
      });
    }

    // Mapear códigos das habilidades selecionadas para busca e relatórios
    const selectedCodes = selectedBnccIds
      .map((id) => bnccList.find((b) => b.id === id)?.val?.code)
      .filter(Boolean) as string[];

    const baseData: any = {
      bimester: selectedBimester,
      categoryId,
      bnccId: selectedBnccIds[0] || '', // retrocompatibilidade com nós antigos
      bnccIds: selectedBnccIds,
      bnccCodes: selectedCodes,
      planned: planned.trim(),
      given: given.trim(),
      obs: obs.trim(),
      teacher: currentTeacher,
      anoLetivo: currentYear
    };

    try {
      if (editingId) {
        const updateData = {
          ...baseData,
          classId: selectedClassId,
          date: selectedDate,
          ratifiedAt: Date.now()
        };
        await update(ref(rtdb, dc(`planos-aula/${editingId}`)), updateData);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Plano de aula atualizado com sucesso!',
          icon: '✅'
        });
      } else {
        const extraEntries = Object.entries(extraTargets).filter(([cid]) => cid !== selectedClassId);
        const missingExtraDate = extraEntries.find(([, info]) => !info.date);
        if (missingExtraDate) {
          return setModal({
            isOpen: true,
            type: 'alert',
            title: 'Data Obrigatória',
            message: 'Informe a data de todas as turmas adicionais selecionadas antes de salvar.',
            icon: '⚠️'
          });
        }

        const targets = [
          { classId: selectedClassId, date: selectedDate },
          ...extraEntries.map(([cid, info]) => ({ classId: cid, date: info.date }))
        ];

        const now = Date.now();
        if (targets.length === 1) {
          await push(ref(rtdb, dc('planos-aula')), {
            ...baseData,
            classId: targets[0].classId,
            date: targets[0].date,
            createdAt: now
          });
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Plano de aula salvo com sucesso!',
            icon: '✅'
          });
        } else {
          const batchUpdates: Record<string, any> = {};
          const listRef = ref(rtdb, dc('planos-aula'));
          targets.forEach((t, idx) => {
            const newKey = push(listRef).key;
            if (!newKey) throw new Error('Não foi possível gerar chave para o plano de aula.');
            batchUpdates[newKey] = {
              ...baseData,
              classId: t.classId,
              date: t.date,
              createdAt: now + idx
            };
          });
          await update(listRef, batchUpdates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: `Planos de aula salvos para ${targets.length} turmas com sucesso!`,
            icon: '✅'
          });
        }
      }

      setPlanned('');
      setGiven('');
      setObs('');
      setSelectedBnccIds([]);
      setSelectedDate(getTodayDateString());
      setShowMultiClassPanel(false);
      setExtraTargets({});
      setEditingId(null);
      loadLessonPlans();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Plano',
        message: formatFriendlyError(err, 'Não foi possível salvar o plano de aula'),
        icon: '❌'
      });
    }
  };

  const resolveBnccIdsFromPlan = (plan: LessonPlan): string[] => {
    if (Array.isArray(plan.bnccIds) && plan.bnccIds.length > 0) {
      return plan.bnccIds;
    }
    if (plan.bnccId) {
      return [plan.bnccId];
    }
    if (Array.isArray(plan.bnccCodes) && plan.bnccCodes.length > 0) {
      return bnccList
        .filter((b) => plan.bnccCodes?.includes(b.val.code))
        .map((b) => b.id);
    }
    return [];
  };

  const handleEdit = (item: { id: string; val: LessonPlan }) => {
    setSelectedClassId(item.val.classId);
    setSelectedBimester(item.val.bimester || '1');
    setSelectedDate(item.val.date);
    setCategoryId(item.val.categoryId || '');
    setSelectedBnccIds(resolveBnccIdsFromPlan(item.val));

    setPlanned(item.val.planned || '');
    setGiven(item.val.given || '');
    setObs(item.val.obs || '');
    setShowMultiClassPanel(false);
    setExtraTargets({});
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUseAsTemplate = (item: { id: string; val: LessonPlan }) => {
    const initialIds = resolveBnccIdsFromPlan(item.val);
    setEditingId(null);
    setSelectedBimester(item.val.bimester || '1');
    setSelectedDate(getTodayDateString());
    setCategoryId(item.val.categoryId || '');
    setSelectedBnccIds(initialIds);
    setPlanned(item.val.planned || '');
    setGiven(item.val.given || '');
    setObs(item.val.obs || '');
    setShowMultiClassPanel(false);
    setExtraTargets({});

    // Sugere outra turma apenas se for compatível com a série e habilidades BNCC do plano
    const srcTurma = classes.find((c) => c.id === item.val.classId)?.val;
    const srcSerie = normSeriePlano(srcTurma?.year);
    const compatibleOthers = classes.filter(
      (c) =>
        c.id !== item.val.classId &&
        isTurmaCompativelComPlano({
          targetYear: c.val.year,
          sourceYear: srcTurma?.year,
          selectedBnccIds: initialIds,
          selectedBnccCodes: item.val.bnccCodes,
          bnccList
        })
    );
    const nextCandidate =
      (srcSerie && compatibleOthers.find((c) => normSeriePlano(c.val.year) === srcSerie)) ||
      compatibleOthers[0];
    setSelectedClassId(nextCandidate ? nextCandidate.id : item.val.classId);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenDuplicateModal = (item: { id: string; val: LessonPlan }) => {
    const baseRef = item.val.date || getTodayDateString();
    setDuplicateSource(item);
    setDuplicateRefDate(baseRef);
    setDuplicateTargets({});
  };

  const updateDuplicateRefDate = (newRefDate: string) => {
    setDuplicateRefDate(newRefDate);
    if (!newRefDate) return;
    setDuplicateTargets((prev) => {
      const next: Record<string, TargetReplicaInfo> = {};
      Object.entries(prev).forEach(([cid, info]) => {
        const turma = classes.find((c) => c.id === cid)?.val;
        if (!info.manual && turma) {
          const sug = sugerirDataTurmaPelaGrade(
            turma,
            newRefDate,
            teacherIdentity.aliases,
            teacherIdentity.nameNorm
          );
          next[cid] = {
            date: sug.date,
            manual: false,
            fromSchedule: sug.fromSchedule,
            diasGrade: sug.diasGrade
          };
        } else {
          next[cid] = info;
        }
      });
      return next;
    });
  };

  const handleConfirmDuplicate = async () => {
    if (!duplicateSource) return;
    const entries = Object.entries(duplicateTargets);
    if (entries.length === 0) return;

    const missingDate = entries.find(([, info]) => !info.date);
    if (missingDate) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Data Obrigatória',
        message: 'Informe a data de todas as turmas selecionadas para duplicar.',
        icon: '⚠️'
      });
    }

    const src = duplicateSource.val;
    const bnccIds = resolveBnccIdsFromPlan(src);
    const bnccCodes =
      Array.isArray(src.bnccCodes) && src.bnccCodes.length > 0
        ? src.bnccCodes
        : (bnccIds
            .map((id) => bnccList.find((b) => b.id === id)?.val?.code)
            .filter(Boolean) as string[]);

    const baseCopy = {
      bimester: src.bimester || '1',
      categoryId: src.categoryId || '',
      bnccId: bnccIds[0] || src.bnccId || '',
      bnccIds,
      bnccCodes,
      planned: src.planned || '',
      given: src.given || '',
      obs: src.obs || '',
      teacher: currentTeacher,
      anoLetivo: src.anoLetivo || currentYear
    };

    try {
      setDuplicating(true);
      const listRef = ref(rtdb, dc('planos-aula'));
      const batchUpdates: Record<string, any> = {};
      const now = Date.now();
      entries.forEach(([cid, info], idx) => {
        const newKey = push(listRef).key;
        if (!newKey) throw new Error('Não foi possível gerar chave para a cópia do plano.');
        batchUpdates[newKey] = {
          ...baseCopy,
          classId: cid,
          date: info.date,
          createdAt: now + idx
        };
      });

      await update(listRef, batchUpdates);
      setDuplicateSource(null);
      setDuplicateTargets({});
      loadLessonPlans();
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Cópias Criadas',
        message: `Plano duplicado com sucesso para ${entries.length} turma(s)! Cada cópia pode ser editada ou excluída individualmente.`,
        icon: '✅'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Duplicar Plano',
        message: formatFriendlyError(err, 'Não foi possível duplicar o plano de aula'),
        icon: '❌'
      });
    } finally {
      setDuplicating(false);
    }
  };

  const handleCancelEdit = () => {
    setPlanned('');
    setGiven('');
    setObs('');
    setSelectedBnccIds([]);
    setSelectedDate(getTodayDateString());
    setShowMultiClassPanel(false);
    setExtraTargets({});
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir este plano de aula?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, dc(`planos-aula/${id}`)));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Plano de aula excluído com sucesso!',
            icon: '✅'
          });
          loadLessonPlans();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Plano',
            message: formatFriendlyError(err, 'Não foi possível excluir o plano de aula'),
            icon: '❌'
          });
        }
      }
    });
  };

  const handleCheckOrphans = async () => {
    try {
      const snap = await get(ref(rtdb, dc('planos-aula')));
      const val = snap.val() || {};
      const orphans: Record<string, string[]> = {};
      let total = 0;

      Object.keys(val).forEach((k) => {
        const p = val[k];
        if (p) {
          const noBimester = !p.bimester || String(p.bimester).trim() === '';
          const noYear = !p.anoLetivo || String(p.anoLetivo).trim() === '';
          if (noBimester || noYear) {
            const cId = p.classId || 'sem_turma';
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
          message: 'Nenhum plano de aula incompleto encontrado!',
          icon: '✅'
        });
      }

      setModal({
        isOpen: true,
        type: 'custom',
        title: '🧹 Limpeza de Planos Incompletos',
        icon: '🧹',
        children: (
          <div className="text-left space-y-3">
            <p className="text-xs text-slate-600">
              Foram encontrados <strong>{total}</strong> planos de aula sem bimestre ou sem ano letivo.
            </p>
            <button
              onClick={async () => {
                const updates: Record<string, any> = {};
                Object.keys(orphans).forEach((cId) => {
                  orphans[cId].forEach((k) => (updates[dc(`planos-aula/${k}`)] = null));
                });
                await update(ref(rtdb), updates);
                loadLessonPlans();
                setModal({
                  isOpen: true,
                  type: 'alert',
                  title: 'Concluído',
                  message: 'Todos os planos incompletos foram removidos!',
                  icon: '✅'
                });
              }}
              className="w-full py-2 bg-rose-600 text-white text-xs font-bold rounded-lg"
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
        message: formatFriendlyError(err, 'Não foi possível verificar os planos de aula'),
        icon: '❌'
      });
    }
  };

  const selectedBnccObjs = bnccList
    .filter((b) => selectedBnccIds.includes(b.id))
    .map((b) => ({ id: b.id, val: b.val }));

  const toggleBnccSelection = (id: string) => {
    setSelectedBnccIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-indigo-600" />
            Plano de Aula
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Registro detalhado de aulas ministradas, categorias pedagógicas e habilidades BNCC
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="lesson-check-orphans-btn"
            onClick={handleCheckOrphans}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Verificar Incompletos</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Plano de Aula' : 'Novo Plano de Aula'}
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
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Turma *
              </label>
              <select
                id="lesson-class-select"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
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
                Bimestre *
              </label>
              <select
                id="lesson-bimester-select"
                value={selectedBimester}
                onChange={(e) => setSelectedBimester(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="1">1º Bimestre</option>
                <option value="2">2º Bimestre</option>
                <option value="3">3º Bimestre</option>
                <option value="4">4º Bimestre</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data *
              </label>
              <input
                id="lesson-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Categoria de Atividade *
              </label>
              <select
                id="lesson-category-select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione a Categoria</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.val.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Replicação multi-turma na criação (poupa redigitar conteúdo igual em outras turmas/dias) */}
          {!editingId && otherClassesSorted.length > 0 && (
            <div className="border border-indigo-200/80 rounded-2xl bg-indigo-50/40 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    id="lesson-toggle-multiclass-btn"
                    type="button"
                    onClick={() => setShowMultiClassPanel((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      showMultiClassPanel || extraTargetsCount > 0
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      {extraTargetsCount > 0
                        ? `Replicando para +${extraTargetsCount} turma(s)`
                        : 'Também lançar em outras turmas'}
                    </span>
                  </button>

                  {sameSeriesOtherClasses.length > 0 && (
                    <button
                      id="lesson-select-same-series-btn"
                      type="button"
                      onClick={selectSameSeriesExtraTargets}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 transition-colors cursor-pointer"
                      title="Marca automaticamente as demais turmas da mesma série e sugere o dia pela sua grade de horários"
                    >
                      <Copy className="w-3 h-3" />
                      <span>
                        + Todo o {currentClassYear}º ano ({sameSeriesOtherClasses.length})
                      </span>
                    </button>
                  )}
                </div>

                {extraTargetsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setExtraTargets({})}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 px-2 py-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    Limpar extras ({extraTargetsCount})
                  </button>
                )}
              </div>

              {showMultiClassPanel && (
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-slate-600">
                    <span>
                      Exibindo somente turmas compatíveis com {currentClassYear ? `${currentClassYear}º ano` : 'a série'} e habilidades BNCC selecionadas (edição/exclusão continuam 1 a 1).
                    </span>
                    {extraTargetsCount > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={reapplyScheduleDatesToExtraTargets}
                          className="px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                          title="Recalcula as datas usando os dias em que você tem aula na grade de cada turma nesta semana"
                        >
                          Sugerir datas pela grade
                        </button>
                        <button
                          type="button"
                          onClick={applySameDateToAllExtraTargets}
                          className="px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                        >
                          Usar {formatDate(selectedDate)} em todas
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                    {otherClassesSorted.map((c) => {
                      const targetInfo = extraTargets[c.id];
                      const isChecked = Boolean(targetInfo);
                      const isSameSerie =
                        Boolean(currentSerieNorm) && normSeriePlano(c.val.year) === currentSerieNorm;
                      const diasGrade = getDiasAulaDocenteNaTurma(
                        c.val,
                        teacherIdentity.aliases,
                        teacherIdentity.nameNorm
                      );
                      const diasLabel = formatDiasGradeResumo(diasGrade);
                      const weekday = targetInfo ? getWeekdayLabelPt(targetInfo.date) : '';

                      return (
                        <div
                          key={c.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl border text-xs transition-all ${
                            isChecked
                              ? 'bg-white border-indigo-400 ring-1 ring-indigo-400/30 shadow-xs'
                              : 'bg-white/75 border-slate-200 hover:bg-white'
                          }`}
                        >
                          <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleExtraTarget(c)}
                              className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-800">
                                  {c.val.year}º {c.val.letter}
                                </span>
                                <span className="text-[11px] text-slate-500">({c.val.shift})</span>
                                {isSameSerie ? (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    Mesma série
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                                    Compatível BNCC
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 truncate">
                                {c.val.schoolName}
                                {diasLabel ? ` • Grade: ${diasLabel}` : ''}
                              </p>
                            </div>
                          </label>

                          {isChecked && targetInfo && (
                            <div className="flex items-center gap-1.5 shrink-0 pl-6 sm:pl-0">
                              <input
                                type="date"
                                value={targetInfo.date}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setExtraTargets((prev) => ({
                                    ...prev,
                                    [c.id]: {
                                      ...prev[c.id],
                                      date: val,
                                      manual: true,
                                      fromSchedule: false
                                    }
                                  }));
                                }}
                                className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                required
                              />
                              {weekday && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    targetInfo.fromSchedule && !targetInfo.manual
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                  title={
                                    targetInfo.fromSchedule && !targetInfo.manual
                                      ? 'Dia sugerido automaticamente pelo seu horário na turma'
                                      : 'Dia da semana selecionado'
                                  }
                                >
                                  {weekday}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* BNCC Visual Cards Section */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div>
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Habilidade BNCC</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    {filterBnccByYear && currentClassYear
                      ? `(Filtrado para ${currentClassYear}º ano + habilidades plurianuais)`
                      : '(Todas as habilidades da BNCC)'}
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {currentClassYear && (
                  <button
                    type="button"
                    onClick={() => setFilterBnccByYear(!filterBnccByYear)}
                    className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${
                      filterBnccByYear
                        ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                    }`}
                    title="Alternar entre ver apenas habilidades deste ano/plurianuais ou todas"
                  >
                    {filterBnccByYear ? `✓ Apenas ${currentClassYear}º ano/Plurianual` : 'Exibindo Todas'}
                  </button>
                )}
                <input
                  type="text"
                  value={bnccSearch}
                  onChange={(e) => setBnccSearch(e.target.value)}
                  placeholder="Filtrar por código ou texto..."
                  className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowBnccCards(!showBnccCards)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-md"
                >
                  {showBnccCards ? 'Ocultar Lista' : 'Expandir Habilidades'}
                </button>
              </div>
            </div>

            {selectedBnccObjs.length > 0 && (
              <div className="mb-3 p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <span>Habilidades Selecionadas ({selectedBnccObjs.length}):</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedBnccIds([])}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-semibold px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors"
                  >
                    Desmarcar Todas
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedBnccObjs.map((b) => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-emerald-300 text-emerald-900 shadow-xs"
                    >
                      <strong className="font-mono">{b.val.code}</strong>
                      <span className="text-[10px] text-emerald-700 max-w-[200px] truncate hidden sm:inline">
                        - {b.val.desc || b.val.description}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleBnccSelection(b.id)}
                        className="ml-1 text-slate-400 hover:text-rose-600 font-bold"
                        title="Remover habilidade"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {showBnccCards && (
              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                <button
                  type="button"
                  onClick={() => setSelectedBnccIds([])}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${
                    selectedBnccIds.length === 0
                      ? 'border-emerald-500 bg-emerald-50/80 font-semibold text-emerald-900'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${selectedBnccIds.length === 0 ? 'text-emerald-600' : 'text-slate-300'}`}
                    />
                    <span>Nenhum código BNCC associado (Apenas conteúdo e categoria)</span>
                  </span>
                </button>

                {filteredBncc.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                    <p className="font-medium text-slate-700">Nenhuma habilidade encontrada para o filtro atual.</p>
                    {currentClassYear && filterBnccByYear && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Clique no botão acima "Exibindo Todas" ou ajuste a busca para visualizar outros códigos.
                      </p>
                    )}
                  </div>
                ) : (
                  filteredBncc.map((item) => {
                    const isSelected = selectedBnccIds.includes(item.id);
                    const yearsLabel = formatSkillYearsLabel(item.val);
                    const isPluriannual = getSkillApplicableYears(item.val).length > 1;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleBnccSelection(item.id)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50/90 text-emerald-950 font-medium ring-1 ring-emerald-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // controlado pelo onClick do container
                            className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <strong className="font-bold text-slate-900 font-mono">{item.val.code}</strong>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  isPluriannual
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {yearsLabel}
                              </span>
                              {isSelected && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-200 text-emerald-800">
                                  ✓ Selecionada
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                              {item.val.desc || item.val.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Conteúdo Programado *
            </label>
            <textarea
              id="lesson-planned-input"
              rows={2}
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              placeholder="Descreva o conteúdo planejado para a aula..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Conteúdo Ministrado / Desenvolvido
            </label>
            <textarea
              id="lesson-given-input"
              rows={2}
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              placeholder="Descreva o que foi efetivamente trabalhado com os alunos..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observações Pedagógicas
            </label>
            <textarea
              id="lesson-obs-input"
              rows={2}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Anotações gerais, dificuldades observadas ou próximos passos..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="lesson-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {editingId
                ? 'Atualizar Plano'
                : extraTargetsCount > 0
                ? `Salvar para ${1 + extraTargetsCount} Turmas`
                : 'Salvar Plano de Aula'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-800">
            Planos Registrados ({lessonPlans.length})
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              id="filter-lesson-class"
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todas as Turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.val.year}º {c.val.letter} — {c.val.shift}
                </option>
              ))}
            </select>
            <select
              id="filter-lesson-bimester"
              value={filterBimester}
              onChange={(e) => setFilterBimester(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todos os Bimestres</option>
              <option value="1">1º Bimestre</option>
              <option value="2">2º Bimestre</option>
              <option value="3">3º Bimestre</option>
              <option value="4">4º Bimestre</option>
            </select>

            {/* Filtro por Período */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-500">De:</span>
              <input
                id="filter-lesson-start-date"
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="bg-transparent text-slate-700 text-xs focus:outline-none"
              />
              <span className="text-[11px] font-medium text-slate-500">Até:</span>
              <input
                id="filter-lesson-end-date"
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="bg-transparent text-slate-700 text-xs focus:outline-none"
              />
              {(filterStartDate || filterEndDate) && (
                <button
                  id="filter-lesson-clear-period"
                  type="button"
                  title="Limpar filtro de período"
                  onClick={() => {
                    setFilterStartDate('');
                    setFilterEndDate('');
                  }}
                  className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {(filterClassId || filterBimester || filterStartDate || filterEndDate) && (
              <button
                id="filter-lesson-reset-all"
                type="button"
                onClick={() => {
                  setFilterClassId('');
                  setFilterBimester('');
                  setFilterStartDate('');
                  setFilterEndDate('');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpar Filtros</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando planos de aula...</div>
        ) : lessonPlans.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum plano de aula encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="space-y-3">
            {lessonPlans.map((item) => {
              const plan = item.val;
              const turma = classes.find((c) => c.id === plan.classId)?.val;
              const turmaStr = turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : 'Turma';
              const cat = categories.find((c) => c.id === plan.categoryId)?.val;
              const bncc = bnccList.find((b) => b.id === plan.bnccId)?.val;

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-800">
                          📅 {formatDate(plan.date)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-700">
                          {turmaStr}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700">
                          {plan.bimester ? `${plan.bimester}º Bimestre` : 'Sem Bimestre'}
                        </span>
                        {cat && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                            style={{ backgroundColor: cat.color || '#667eea' }}
                          >
                            {cat.name}
                          </span>
                        )}
                      </div>

                      {/* Exibição das Habilidades BNCC (Múltiplas ou Única) */}
                      {(() => {
                        // Coleta todas as habilidades associadas a este plano
                        const matchedSkills: BNCCSkill[] = [];
                        const seenCodes = new Set<string>();

                        if (Array.isArray(plan.bnccIds)) {
                          plan.bnccIds.forEach((id) => {
                            const b = bnccList.find((x) => x.id === id)?.val;
                            if (b && !seenCodes.has(b.code)) {
                              matchedSkills.push(b);
                              seenCodes.add(b.code);
                            }
                          });
                        }

                        if (Array.isArray(plan.bnccCodes)) {
                          plan.bnccCodes.forEach((c) => {
                            if (!seenCodes.has(c)) {
                              const b = bnccList.find((x) => x.val.code === c)?.val;
                              matchedSkills.push(b || { code: c, desc: '', year: '1' });
                              seenCodes.add(c);
                            }
                          });
                        }

                        if (plan.bnccId && !seenCodes.has(plan.bnccId)) {
                          const b = bnccList.find((x) => x.id === plan.bnccId)?.val;
                          if (b && !seenCodes.has(b.code)) {
                            matchedSkills.push(b);
                            seenCodes.add(b.code);
                          }
                        }

                        if (matchedSkills.length === 0) return null;

                        return (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {matchedSkills.map((b) => (
                              <span
                                key={b.code}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                                title={b.desc || b.description || ''}
                              >
                                <strong className="font-mono">{b.code}</strong>
                                {b.desc && (
                                  <span className="text-[11px] text-emerald-700 max-w-[240px] truncate hidden md:inline">
                                    - {b.desc}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        );
                      })()}

                      <div className="text-xs text-slate-700 mt-2 space-y-1">
                        <p>
                          <strong>Programado:</strong> {plan.planned}
                        </p>
                        {plan.given && (
                          <p className="text-slate-600">
                            <strong>Ministrado:</strong> {plan.given}
                          </p>
                        )}
                        {plan.obs && (
                          <p className="text-slate-500 italic">
                            <strong>Obs:</strong> {plan.obs}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        id={`lesson-duplicate-${item.id}`}
                        type="button"
                        onClick={() => handleOpenDuplicateModal(item)}
                        className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        title="Duplicar para outra(s) turma(s) em dias diferentes"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        id={`lesson-template-${item.id}`}
                        type="button"
                        onClick={() => handleUseAsTemplate(item)}
                        className="p-1.5 text-slate-600 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors cursor-pointer"
                        title="Usar como modelo no formulário de Novo Plano"
                      >
                        <ClipboardCopy className="w-4 h-4" />
                      </button>
                      <button
                        id={`lesson-edit-${item.id}`}
                        type="button"
                        onClick={() => handleEdit(item)}
                        className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        title="Editar este plano"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        id={`lesson-delete-${item.id}`}
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Excluir este plano"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Duplicação de Plano Salvo para Outras Turmas */}
      {duplicateSource &&
        (() => {
          const srcPlan = duplicateSource.val;
          const srcTurma = classes.find((c) => c.id === srcPlan.classId)?.val;
          const srcSerieNorm = normSeriePlano(srcTurma?.year);
          const srcBnccIds = resolveBnccIdsFromPlan(srcPlan);
          const compatibleClasses = classes.filter(
            (c) =>
              c.id === srcPlan.classId ||
              isTurmaCompativelComPlano({
                targetYear: c.val.year,
                sourceYear: srcTurma?.year,
                selectedBnccIds: srcBnccIds,
                selectedBnccCodes: srcPlan.bnccCodes,
                bnccList
              })
          );
          const sortedForDuplicate = [...compatibleClasses].sort((a, b) => {
            const aIsSrc = a.id === srcPlan.classId ? 1 : 0;
            const bIsSrc = b.id === srcPlan.classId ? 1 : 0;
            if (aIsSrc !== bIsSrc) return aIsSrc - bIsSrc;
            const aSame = srcSerieNorm && normSeriePlano(a.val.year) === srcSerieNorm ? 0 : 1;
            const bSame = srcSerieNorm && normSeriePlano(b.val.year) === srcSerieNorm ? 0 : 1;
            if (aSame !== bSame) return aSame - bSame;
            const yCmp = String(a.val.year || '').localeCompare(String(b.val.year || ''), 'pt-BR', { numeric: true });
            if (yCmp !== 0) return yCmp;
            return String(a.val.letter || '').localeCompare(String(b.val.letter || ''), 'pt-BR');
          });
          const sameSeriesTargets = srcSerieNorm
            ? sortedForDuplicate.filter(
                (c) => c.id !== srcPlan.classId && normSeriePlano(c.val.year) === srcSerieNorm
              )
            : [];
          const hasCompatibleOtherClasses = sortedForDuplicate.some((c) => c.id !== srcPlan.classId);
          const hiddenIncompatibleCount = classes.length - compatibleClasses.length;
          const selectedCount = Object.keys(duplicateTargets).length;

          return createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
              onClick={() => {
                if (!duplicating) setDuplicateSource(null);
              }}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 p-4 sm:p-5 bg-gradient-to-r from-indigo-600 to-emerald-600 text-white flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                      <Copy className="w-5 h-5" />
                      Duplicar Plano de Aula para Outras Turmas
                    </h3>
                    <p className="text-xs text-indigo-100 mt-0.5">
                      Exibindo somente turmas compatíveis com a série e habilidades BNCC deste plano. Cada cópia é independente.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={duplicating}
                    onClick={() => setDuplicateSource(null)}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer shrink-0"
                    title="Fechar"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
                  {/* Resumo do plano de origem */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">
                        Origem: {srcTurma ? `${srcTurma.year}º ${srcTurma.letter} (${srcTurma.shift})` : 'Turma'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold">
                        📅 {formatDate(srcPlan.date)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                        {srcPlan.bimester}º Bimestre
                      </span>
                    </div>
                    <p className="text-slate-600 line-clamp-2">
                      <strong>Conteúdo Programado:</strong> {srcPlan.planned}
                    </p>
                  </div>

                  {/* Controles rápidos de semana e seleção */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-indigo-50/60 border border-indigo-200/80 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-700">Semana base p/ sugestão:</span>
                      <input
                        type="date"
                        value={duplicateRefDate}
                        onChange={(e) => updateDuplicateRefDate(e.target.value)}
                        className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                      <button
                        type="button"
                        onClick={() => updateDuplicateRefDate(getTodayDateString())}
                        className="px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
                      >
                        Semana de hoje
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDuplicateRefDate(srcPlan.date || getTodayDateString())}
                        className="px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
                      >
                        Semana do plano
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {sameSeriesTargets.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const base = duplicateRefDate || srcPlan.date || getTodayDateString();
                            setDuplicateTargets((prev) => {
                              const next = { ...prev };
                              sameSeriesTargets.forEach((c) => {
                                if (!next[c.id]) {
                                  const sug = sugerirDataTurmaPelaGrade(
                                    c.val,
                                    base,
                                    teacherIdentity.aliases,
                                    teacherIdentity.nameNorm
                                  );
                                  next[c.id] = {
                                    date: sug.date,
                                    manual: false,
                                    fromSchedule: sug.fromSchedule,
                                    diasGrade: sug.diasGrade
                                  };
                                }
                              });
                              return next;
                            });
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-bold cursor-pointer"
                        >
                          + Todo o {srcTurma?.year}º ano ({sameSeriesTargets.length})
                        </button>
                      )}
                      {selectedCount > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const base = duplicateRefDate || srcPlan.date || getTodayDateString();
                              setDuplicateTargets((prev) => {
                                const next: Record<string, TargetReplicaInfo> = {};
                                Object.entries(prev).forEach(([cid, info]) => {
                                  next[cid] = { ...info, date: base, manual: true, fromSchedule: false };
                                });
                                return next;
                              });
                            }}
                            className="px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
                          >
                            Mesma data em todas
                          </button>
                          <button
                            type="button"
                            onClick={() => setDuplicateTargets({})}
                            className="px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50 font-semibold cursor-pointer"
                          >
                            Limpar
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Lista de turmas de destino */}
                  <div className="space-y-2">
                    {!hasCompatibleOtherClasses && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        Nenhuma outra turma compatível com {srcTurma ? `o ${srcTurma.year}º ano` : 'esta série'} e as habilidades BNCC deste plano foi encontrada
                        {hiddenIncompatibleCount > 0 ? ` (${hiddenIncompatibleCount} turma(s) de outra série ocultadas para evitar conflito de BNCC)` : ''}.
                        Você ainda pode replicar para outra data da turma original abaixo.
                      </div>
                    )}
                    {sortedForDuplicate.map((c) => {
                      const isOriginal = c.id === srcPlan.classId;
                      const isSameSerie =
                        !isOriginal && Boolean(srcSerieNorm) && normSeriePlano(c.val.year) === srcSerieNorm;
                      const info = duplicateTargets[c.id];
                      const isChecked = Boolean(info);
                      const diasGrade = getDiasAulaDocenteNaTurma(
                        c.val,
                        teacherIdentity.aliases,
                        teacherIdentity.nameNorm
                      );
                      const diasLabel = formatDiasGradeResumo(diasGrade);
                      const weekday = info ? getWeekdayLabelPt(info.date) : '';

                      return (
                        <div
                          key={c.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border text-xs transition-all ${
                            isChecked
                              ? 'bg-emerald-50/40 border-emerald-400 ring-1 ring-emerald-400/20'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <label className="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const base = duplicateRefDate || srcPlan.date || getTodayDateString();
                                setDuplicateTargets((prev) => {
                                  const next = { ...prev };
                                  if (next[c.id]) {
                                    delete next[c.id];
                                  } else {
                                    const sug = sugerirDataTurmaPelaGrade(
                                      c.val,
                                      base,
                                      teacherIdentity.aliases,
                                      teacherIdentity.nameNorm
                                    );
                                    next[c.id] = {
                                      date: sug.date,
                                      manual: false,
                                      fromSchedule: sug.fromSchedule,
                                      diasGrade: sug.diasGrade
                                    };
                                  }
                                  return next;
                                });
                              }}
                              className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-800">
                                  {c.val.year}º {c.val.letter} — {c.val.shift}
                                </span>
                                {isSameSerie && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    Mesma série
                                  </span>
                                )}
                                {!isSameSerie && !isOriginal && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                                    Compatível BNCC
                                  </span>
                                )}
                                {isOriginal && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                                    Turma original
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {c.val.schoolName}
                                {diasLabel ? ` • Seu horário na grade: ${diasLabel}` : ''}
                              </p>
                            </div>
                          </label>

                          {isChecked && info && (
                            <div className="flex items-center gap-1.5 shrink-0 pl-6 sm:pl-0">
                              <input
                                type="date"
                                value={info.date}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDuplicateTargets((prev) => ({
                                    ...prev,
                                    [c.id]: {
                                      ...prev[c.id],
                                      date: val,
                                      manual: true,
                                      fromSchedule: false
                                    }
                                  }));
                                }}
                                className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                required
                              />
                              {weekday && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    info.fromSchedule && !info.manual
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {weekday}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="shrink-0 p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-600 font-medium">
                    {selectedCount === 0
                      ? 'Selecione pelo menos 1 turma de destino'
                      : `${selectedCount} cópia(s) pronta(s) para criação`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={duplicating}
                      onClick={() => setDuplicateSource(null)}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      id="confirm-duplicate-lesson-btn"
                      type="button"
                      disabled={selectedCount === 0 || duplicating}
                      onClick={handleConfirmDuplicate}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>
                        {duplicating
                          ? 'Criando cópias...'
                          : `Criar ${selectedCount} Cópia${selectedCount === 1 ? '' : 's'}`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          );
        })()}
    </div>
  );
};
