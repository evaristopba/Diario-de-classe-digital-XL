import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { get, ref, rtdb, dc, carregarMinhasTurmas, carregarEscolas, verificarIsAdmin, getCurrentAuthUid, lerNotasDoPerfil } from './firebase';
import { ClassRoom, DEFAULT_SUBJECTS, SubjectItem, sortSubjectsByOrder } from '../types';
import { isSkillApplicableToYear, formatSkillYearsLabel } from './bnccHelper';
import {
  exportToExcelJS,
  exportMultiBlockToExcelJS,
  ExcelColumnDef,
  CustomTableBlock
} from './excelExport';

export function formatDate(dateString?: string): string {
  if (!dateString) return '';
  const parts = dateString.split('T')[0].split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatStudentTransferTag(student: any, multiLine: boolean = false): string {
  if (!student) return '';
  const inDate = student.transferInDate || (student.status === 'recebida' ? student.transferDate : '');
  const outDate = student.transferOutDate || (student.status === 'expedida' ? student.transferDate : '');
  const sep = multiLine ? '\n' : ' ';

  if (student.status === 'expedida') {
    if (inDate && outDate) {
      return `${sep}(TR. REC. em ${formatDate(inDate)} | TR. EXP. em ${formatDate(outDate)})`;
    }
    return `${sep}(TR. EXP.${outDate ? ` em ${formatDate(outDate)}` : ''})`;
  } else if (student.status === 'recebida') {
    return `${sep}(TR. REC.${inDate ? ` em ${formatDate(inDate)}` : ''})`;
  } else if (inDate) {
    return `${sep}(TR. REC. em ${formatDate(inDate)})`;
  }
  return '';
}

export function isStudentTransferredOutBeforeBimester(student: any, bimester: string | number): boolean {
  if (!student || student.status !== 'expedida') return false;
  const outDate = student.transferOutDate || student.transferDate;
  const bimNum = typeof bimester === 'number' ? bimester : parseInt(String(bimester), 10);
  if (isNaN(bimNum)) return false;

  // Se não tem data informada, o status expedida aplica-se aos bimestres futuros/atuais
  if (!outDate) return true;

  const parts = outDate.split('T')[0].split('-');
  if (parts.length < 3) return true;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  // Cortes do calendário escolar padrão:
  // 1º Bimestre: Fev a Abr
  if (bimNum === 1) {
    return month === 1 || (month === 2 && day < 15);
  }
  // 2º Bimestre: Mai a Jul (saiu até 30 de Abril)
  if (bimNum === 2) {
    return month < 4 || (month === 4 && day <= 30);
  }
  // 3º Bimestre: Ago a Set (saiu até 31 de Julho)
  if (bimNum === 3) {
    return month < 7 || (month === 7 && day <= 31);
  }
  // 4º Bimestre: Out a Dez (saiu até 30 de Setembro)
  if (bimNum === 4) {
    return month < 9 || (month === 9 && day <= 30);
  }

  return false;
}

export function isStudentTransferredInAfterBimester(student: any, bimester: string | number): boolean {
  if (!student) return false;
  const inDate = student.transferInDate || (student.status === 'recebida' ? student.transferDate : '');
  if (!inDate) return false;
  const bimNum = typeof bimester === 'number' ? bimester : parseInt(String(bimester), 10);
  if (isNaN(bimNum)) return false;

  const parts = inDate.split('T')[0].split('-');
  if (parts.length < 3) return false;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  // Cortes do calendário escolar padrão:
  // 1º Bimestre: Fev a Abr. Se entrou após 30 de Abril:
  if (bimNum === 1) {
    return month > 4 || (month === 4 && day > 30);
  }
  // 2º Bimestre: Mai a Jul. Se entrou após 31 de Julho:
  if (bimNum === 2) {
    return month > 7 || (month === 7 && day > 31);
  }
  // 3º Bimestre: Ago a Set. Se entrou após 30 de Setembro:
  if (bimNum === 3) {
    return month > 9 || (month === 9 && day > 30);
  }
  return false;
}

export function isStudentEnrolledOnDate(student: any, date: string): { enrolled: boolean; reason?: string } {
  if (!student || !date) return { enrolled: true };

  // 1. Data de entrada (TR. REC.)
  const inDate = student.transferInDate || (student.status === 'recebida' ? student.transferDate : '');
  if (inDate && date < inDate) {
    return {
      enrolled: false,
      reason: `Não Matriculado (Entrada em ${formatDate(inDate)})`
    };
  }

  // 2. Data de saída (TR. EXP.)
  const outDate = student.transferOutDate || (student.status === 'expedida' ? student.transferDate : '');
  if (outDate && date > outDate) {
    return {
      enrolled: false,
      reason: `Transferência Expedida em ${formatDate(outDate)}`
    };
  }

  if (student.status === 'expedida' && !outDate) {
    return {
      enrolled: false,
      reason: 'Transferência Expedida'
    };
  }

  return { enrolled: true };
}

let _cachedCurricularSubjects: SubjectItem[] | null = null;
let _cachedSubjectsTime = 0;

export async function getCurricularSubjects(): Promise<SubjectItem[]> {
  const now = Date.now();
  if (_cachedCurricularSubjects && now - _cachedSubjectsTime < 10000) {
    return _cachedCurricularSubjects;
  }
  try {
    const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
    if (snap.exists()) {
      const val = snap.val() || {};
      const list: SubjectItem[] = Object.keys(val).map((k) => {
        const item = val[k];
        return typeof item === 'object' && item !== null
          ? {
              id: item.id || k,
              name: item.name || k,
              shortName: item.shortName || item.name || k,
              category: item.category === 'diversificada' ? 'diversificada' : 'regente',
              order: typeof item.order === 'number' && !isNaN(item.order) ? item.order : undefined
            }
          : { id: k, name: String(item), shortName: String(item), category: 'regente' };
      });
      _cachedCurricularSubjects = sortSubjectsByOrder(list);
      _cachedSubjectsTime = now;
      return _cachedCurricularSubjects;
    }
  } catch (e) {
    console.warn('Erro ao carregar disciplinas ordenadas no relatório:', e);
  }
  _cachedCurricularSubjects = sortSubjectsByOrder([...DEFAULT_SUBJECTS]);
  _cachedSubjectsTime = now;
  return _cachedCurricularSubjects;
}

export function getSubjectName(subId?: string): string {
  if (!subId || subId === 'todas') return 'Todas as Matérias';
  if (_cachedCurricularSubjects) {
    const found = _cachedCurricularSubjects.find((s) => s.id === subId);
    if (found) return found.name;
  }
  const foundDef = DEFAULT_SUBJECTS.find((s) => s.id === subId);
  return foundDef ? foundDef.name : subId;
}

export function addPDFHeader(
  doc: jsPDF,
  title: string,
  turma?: ClassRoom,
  teacher?: string,
  year?: string,
  subject?: string
): number {
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 105, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const escolaStr = `Escola: ${turma ? turma.schoolName : 'Não informada'}`;
  const turmaStr = `Turma: ${turma ? `${turma.year}º Ano ${turma.letter} - ${turma.shift}` : 'Não informada'}`;
  const profAnoStr = `Professor(a): ${teacher || 'Não informado'}   |   Ano Letivo: ${year || ''}${
    subject && subject !== 'todas' ? `   |   Disciplina: ${getSubjectName(subject)}` : ''
  }`;

  doc.text(escolaStr, 14, 25);
  doc.text(turmaStr, 14, 31);
  doc.text(profAnoStr, 14, 37);

  return 43;
}

export function addXLSXHeader(
  title: string,
  turma?: ClassRoom,
  teacher?: string,
  year?: string,
  subject?: string
): any[][] {
  const header: any[][] = [];
  header.push([title]);
  header.push([`Escola: ${turma ? turma.schoolName : 'Não informada'}`]);
  header.push([`Turma: ${turma ? `${turma.year}º Ano ${turma.letter} - ${turma.shift}` : 'Não informada'}`]);
  header.push([
    `Professor(a): ${teacher || 'Não informado'}   |   Ano Letivo: ${year || ''}${
      subject && subject !== 'todas' ? `   |   Disciplina: ${getSubjectName(subject)}` : ''
    }`
  ]);
  header.push([]);
  return header;
}

export function createFormattedWorksheet(
  data: any[][],
  colWidths?: number[]
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(data);
  if (colWidths && colWidths.length > 0) {
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  } else {
    const maxCols = Math.max(...data.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
    const calculatedWidths: number[] = [];
    for (let c = 0; c < maxCols; c++) {
      let maxLen = 10;
      data.forEach((row) => {
        const cellVal = row[c];
        if (cellVal !== undefined && cellVal !== null) {
          const strLen = String(cellVal).split('\n')[0].length;
          if (strLen > maxLen) maxLen = strLen;
        }
      });
      calculatedWidths.push(Math.min(Math.max(maxLen + 3, 10), 65));
    }
    ws['!cols'] = calculatedWidths.map((w) => ({ wch: w }));
  }
  return ws;
}

// ----------------------------------------------------
// TAB 1: DESEMPENHO & NOTAS (COM SUPORTE A MATÉRIAS)
// ----------------------------------------------------

// 1.1 Boletim Bimestral PDF (Filtrado por Matéria ou Geral)
export async function generateBimesterReport(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  teacher: string,
  currentYear: string,
  subject = 'todas',
  includeContent = false,
  showRA = true
) {
  const isAllSubjects = subject === 'todas';
  const doc = new jsPDF(isAllSubjects ? 'landscape' : 'portrait');
  const title = `BOLETIM ESCOLAR - ${bimester}º BIMESTRE${!isAllSubjects ? ` (${getSubjectName(subject).toUpperCase()})` : ''}`;
  const startY = addPDFHeader(doc, title, turma, teacher, currentYear, subject);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const tableData: any[] = [];
  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  if (isAllSubjects) {
    const subjectsList = await getCurricularSubjects();
    // Matérias em colunas ordenadas (1º, 2º, 3º...): Nº, Aluno, (RA opcional), Matérias..., Média
    const head = [
      'Nº',
      'Aluno',
      ...(showRA ? ['RA'] : []),
      ...subjectsList.map((s) => s.shortName || s.name),
      'Média'
    ];

    sortedStudents.forEach((student: any) => {
      let studentName = student.name;
      if (student.status === 'expedida') {
        studentName += ` (TR. EXP.)`;
      } else if (student.status === 'recebida') {
        studentName += ` (TR. REC.)`;
      }

      const row: any[] = [student.number, studentName];
      if (showRA) {
        row.push(student.ra || '-');
      }
      let sum = 0;
      let cnt = 0;
      const isTransferredOut = isStudentTransferredOutBeforeBimester(student, bimester);

      subjectsList.forEach((sub) => {
        let nota = '-';
        if (!isTransferredOut) {
          Object.keys(notasVal).forEach((k) => {
            const g = notasVal[k];
            const gSub = g.subject || 'portugues';
            if (
              g.classId === classId &&
              (!g.anoLetivo || g.anoLetivo === currentYear) &&
              String(g.bimester) === String(bimester) &&
              g.studentId === student.id &&
              gSub === sub.id
            ) {
              const val = parseFloat(g.value);
              if (!isNaN(val)) {
                nota = val.toFixed(1);
                sum += val;
                cnt++;
              }
            }
          });
        }
        if (isTransferredOut || (student.status === 'expedida' && nota === '-')) {
          nota = 'TR. EXP.';
        }
        row.push(nota);
      });

      row.push(cnt > 0 ? (sum / cnt).toFixed(1) : '-');
      tableData.push(row);
    });

    const columnStyles: Record<number, any> = {
      0: { halign: 'center' } // Nº
    };
    let colIdx = 1;
    columnStyles[colIdx] = { halign: 'left' }; // Aluno
    colIdx++;

    if (showRA) {
      columnStyles[colIdx] = { halign: 'center' }; // RA
      colIdx++;
    }

    // Disciplinas
    subjectsList.forEach(() => {
      columnStyles[colIdx] = { halign: 'center' };
      colIdx++;
    });

    // Média
    columnStyles[colIdx] = { halign: 'center' };

    autoTable(doc, {
      startY,
      head: [head],
      body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', ...(showRA ? ['-'] : []), ...subjectsList.map(() => '-'), '-']],
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { halign: 'center' },
      columnStyles
    });
  } else {
    // Matéria única selecionada
    sortedStudents.forEach((student: any) => {
      let studentName = student.name + formatStudentTransferTag(student, true);
      const isTransferredOut = isStudentTransferredOutBeforeBimester(student, bimester);

      let nota = '-';
      if (!isTransferredOut) {
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            (!g.anoLetivo || g.anoLetivo === currentYear) &&
            String(g.bimester) === String(bimester) &&
            g.studentId === student.id &&
            gSub === subject
          ) {
            const val = parseFloat(g.value);
            if (!isNaN(val)) nota = val.toFixed(1);
          }
        });
      }

      if (isTransferredOut || (student.status === 'expedida' && nota === '-')) {
        nota = 'TR. EXP.';
      }
      const singleRow = [student.number, studentName];
      if (showRA) {
        singleRow.push(student.ra || '-');
      }
      singleRow.push(nota);
      tableData.push(singleRow);
    });

    const singleHead = ['Nº', 'Aluno'];
    if (showRA) {
      singleHead.push('RA');
    }
    singleHead.push(`Nota (${getSubjectName(subject)})`);

    const singleColumnStyles: Record<number, any> = {
      0: { halign: 'center' }, // Nº
      1: { halign: 'left' }    // Aluno
    };
    if (showRA) {
      singleColumnStyles[2] = { halign: 'center' }; // RA
      singleColumnStyles[3] = { halign: 'center' }; // Nota
    } else {
      singleColumnStyles[2] = { halign: 'center' }; // Nota
    }

    autoTable(doc, {
      startY,
      head: [singleHead],
      body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', ...(showRA ? ['-'] : []), '-']],
      theme: 'grid',
      headStyles: { halign: 'center' },
      columnStyles: singleColumnStyles
    });
  }

  // Se solicitado, incluir a lista das categorias trabalhadas após as notas
  if (includeContent) {
    try {
      const plansSnap = await get(ref(rtdb, dc('planos-aula')));
      const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));
      const catVal = catSnap.val() || {};
      const catMap: Record<string, string> = {};
      Object.keys(catVal).forEach((k) => {
        catMap[k] = catVal[k].name;
      });

      const plansVal = plansSnap.val() || {};
      const categoryNamesSet = new Set<string>();

      Object.keys(plansVal).forEach((k) => {
        const p = plansVal[k];
        if (
          p.classId === classId &&
          String(p.bimester) === String(bimester) &&
          (!p.anoLetivo || p.anoLetivo === currentYear)
        ) {
          if (!isAllSubjects && p.subject && p.subject !== subject) {
            return;
          }

          if (p.categoryId && catMap[p.categoryId]) {
            categoryNamesSet.add(catMap[p.categoryId]);
          } else if (p.category) {
            categoryNamesSet.add(p.category);
          }
        }
      });

      const categoryList = Array.from(categoryNamesSet);
      if (categoryList.length > 0) {
        const joinedCategories = categoryList.join('; ');
        const finalY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 200;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);

        const marginX = 14;
        const maxTextWidth = (isAllSubjects ? 297 : 210) - marginX * 2;
        const splitText = doc.splitTextToSize(joinedCategories, maxTextWidth);

        if (finalY + splitText.length * 4.5 > (isAllSubjects ? 190 : 275)) {
          doc.addPage();
          doc.text(splitText, marginX, 20);
        } else {
          doc.text(splitText, marginX, finalY);
        }
      }
    } catch (e) {
      console.error('Erro ao incluir categorias no relatório PDF:', e);
    }
  }

  doc.save(`boletim_${bimester}bim_${subject}_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

// 1.1 Boletim Bimestral XLSX
export async function generateBimesterReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  subject = 'todas',
  teacher?: string,
  includeContent = false,
  showRA = true
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const isAllSubjects = subject === 'todas';
  const title = `BOLETIM ESCOLAR - ${bimester}º BIMESTRE${!isAllSubjects ? ` (${getSubjectName(subject).toUpperCase()})` : ''}`;

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  let columns: ExcelColumnDef[] = [];
  const rows: any[] = [];

  if (isAllSubjects) {
    const subjectsList = await getCurricularSubjects();
    columns = [
      { header: 'Nº', key: 'number', width: 8, align: 'center' },
      { header: 'Aluno', key: 'name', width: 38 },
      ...(showRA ? [{ header: 'RA', key: 'ra', width: 16, align: 'center' as const }] : []),
      ...subjectsList.map((s) => ({
        header: s.shortName || s.name,
        key: s.id,
        width: 10,
        align: 'center' as const,
        numFmt: '0.0'
      })),
      { header: 'Média', key: 'media', width: 12, align: 'center', numFmt: '0.0' }
    ];

    sortedStudents.forEach((student: any) => {
      let studentName = student.name;
      if (student.status === 'expedida') studentName += ' (TR. EXP.)';
      else if (student.status === 'recebida') studentName += ' (TR. REC.)';

      const rowObj: any = {
        number: student.number,
        name: studentName
      };
      if (showRA) {
        rowObj.ra = student.ra || '-';
      }
      let sum = 0;
      let cnt = 0;
      const isTransferredOut = isStudentTransferredOutBeforeBimester(student, bimester);

      subjectsList.forEach((sub) => {
        let notaVal: any = '-';
        if (!isTransferredOut) {
          Object.keys(notasVal).forEach((k) => {
            const g = notasVal[k];
            const gSub = g.subject || 'portugues';
            if (
              g.classId === classId &&
              (!g.anoLetivo || g.anoLetivo === currentYear) &&
              String(g.bimester) === String(bimester) &&
              g.studentId === student.id &&
              gSub === sub.id
            ) {
              const num = parseFloat(g.value);
              if (!isNaN(num)) {
                notaVal = num;
                sum += num;
                cnt++;
              }
            }
          });
        }
        if (isTransferredOut || (student.status === 'expedida' && notaVal === '-')) {
          notaVal = 'TR. EXP.';
        }
        rowObj[sub.id] = notaVal;
      });

      rowObj.media = cnt > 0 ? parseFloat((sum / cnt).toFixed(1)) : '-';
      rows.push(rowObj);
    });
  } else {
    columns = [
      { header: 'Nº', key: 'number', width: 8, align: 'center' },
      { header: 'Aluno', key: 'name', width: 38 },
      ...(showRA ? [{ header: 'RA', key: 'ra', width: 16, align: 'center' as const }] : []),
      { header: `Nota (${getSubjectName(subject)})`, key: 'nota', width: 22, align: 'center', numFmt: '0.0' }
    ];

    sortedStudents.forEach((student: any) => {
      let studentName = student.name;
      if (student.status === 'expedida') studentName += ' (TR. EXP.)';
      else if (student.status === 'recebida') studentName += ' (TR. REC.)';
      const isTransferredOut = isStudentTransferredOutBeforeBimester(student, bimester);

      let notaVal: any = '-';
      if (!isTransferredOut) {
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            (!g.anoLetivo || g.anoLetivo === currentYear) &&
            String(g.bimester) === String(bimester) &&
            g.studentId === student.id &&
            gSub === subject
          ) {
            const num = parseFloat(g.value);
            if (!isNaN(num)) {
              notaVal = num;
            }
          }
        });
      }

      if (isTransferredOut || (student.status === 'expedida' && notaVal === '-')) {
        notaVal = 'TR. EXP.';
      }
      const rowObj: any = {
        number: student.number,
        name: studentName,
        nota: notaVal
      };
      if (showRA) {
        rowObj.ra = student.ra || '-';
      }
      rows.push(rowObj);
    });
  }

  let footerNotes: string[] | undefined = undefined;

  if (includeContent) {
    try {
      const plansSnap = await get(ref(rtdb, dc('planos-aula')));
      const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));
      const catVal = catSnap.val() || {};
      const catMap: Record<string, string> = {};
      Object.keys(catVal).forEach((k) => {
        catMap[k] = catVal[k].name;
      });

      const plansVal = plansSnap.val() || {};
      const categoryNamesSet = new Set<string>();

      Object.keys(plansVal).forEach((k) => {
        const p = plansVal[k];
        if (
          p.classId === classId &&
          String(p.bimester) === String(bimester) &&
          (!p.anoLetivo || p.anoLetivo === currentYear)
        ) {
          if (!isAllSubjects && p.subject && p.subject !== subject) {
            return;
          }

          if (p.categoryId && catMap[p.categoryId]) {
            categoryNamesSet.add(catMap[p.categoryId]);
          } else if (p.category) {
            categoryNamesSet.add(p.category);
          }
        }
      });

      const categoryList = Array.from(categoryNamesSet);
      if (categoryList.length > 0) {
        footerNotes = [categoryList.join('; ')];
      }
    } catch (e) {
      console.error('Erro ao incluir categorias no relatório XLSX:', e);
    }
  }

  await exportToExcelJS({
    title,
    turma,
    teacher,
    year: currentYear,
    subject,
    sheetName: 'Boletim',
    columns,
    rows,
    emptyMessage: 'Nenhum aluno cadastrado na turma.',
    footerNotes,
    filename: `boletim_${bimester}bim_${subject}_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

// 1.2 Boletim Anual PDF
export async function generateAnnualReport(
  classId: string,
  turma: ClassRoom,
  teacher: string,
  currentYear: string,
  showTransfer = true,
  subject = 'todas'
) {
  const doc = new jsPDF();
  const startY = addPDFHeader(
    doc,
    `BOLETIM ANUAL${subject !== 'todas' ? ` - ${getSubjectName(subject).toUpperCase()}` : ' GERAL'}`,
    turma,
    teacher,
    currentYear,
    subject
  );

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const tableData: any[] = [];
  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  sortedStudents.forEach((student: any) => {
    let studentName = student.name;
    const isExpedido = student.status === 'expedida';
    if (showTransfer) {
      studentName += formatStudentTransferTag(student, true);
    }

    const row: any[] = [student.number, studentName, student.ra];
    let total = 0;
    let count = 0;

    for (let b = 1; b <= 4; b++) {
      let nota = '-';
      let bSum = 0;
      let bCnt = 0;
      const isTransferredOutInBim = isStudentTransferredOutBeforeBimester(student, b);

      if (!isTransferredOutInBim) {
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            (!g.anoLetivo || g.anoLetivo === currentYear) &&
            String(g.bimester) === String(b) &&
            g.studentId === student.id &&
            (subject === 'todas' || gSub === subject)
          ) {
            const val = parseFloat(g.value);
            if (!isNaN(val)) {
              bSum += val;
              bCnt++;
            }
          }
        });

        if (bCnt === 0 && student.status === 'recebida' && student.ra) {
          const origStudent = sortedStudents.find(
            (o: any) => o.id !== student.id && o.status === 'expedida' && o.ra === student.ra
          );
          if (origStudent) {
            Object.keys(notasVal).forEach((k) => {
              const g = notasVal[k];
              const gSub = g.subject || 'portugues';
              if (
                g.classId === classId &&
                (!g.anoLetivo || g.anoLetivo === currentYear) &&
                String(g.bimester) === String(b) &&
                g.studentId === origStudent.id &&
                (subject === 'todas' || gSub === subject)
              ) {
                const val = parseFloat(g.value);
                if (!isNaN(val)) {
                  bSum += val;
                  bCnt++;
                }
              }
            });
          }
        }

        if (bCnt > 0) {
          const bAvg = bSum / bCnt;
          nota = bAvg.toFixed(1);
          total += bAvg;
          count++;
        }
      }

      if (isTransferredOutInBim || (isExpedido && nota === '-')) {
        nota = 'TR. EXP.';
      }
      row.push(nota);
    }

    if (isExpedido) {
      row.push('TR. EXP.');
    } else {
      row.push(count > 0 ? (total / count).toFixed(1) : '-');
    }
    tableData.push(row);
  });

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [['Nº', 'Aluno', 'RA', '1º', '2º', '3º', '4º', 'Média Anual']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 64, halign: 'left' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 16, halign: 'center' },
      7: { cellWidth: 20, halign: 'center' }
    }
  });

  doc.save(`boletim_anual_${subject}_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

// 1.2 Boletim Anual XLSX
export async function generateAnnualReportXLSX(
  classId: string,
  turma: ClassRoom,
  currentYear: string,
  showTransfer = true,
  subject = 'todas',
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const isAllSubjects = subject === 'todas';
  const title = `BOLETIM ANUAL${!isAllSubjects ? ` - ${getSubjectName(subject).toUpperCase()}` : ' GERAL'}`;

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: '1º Bim', key: 'b1', width: 12, align: 'center', numFmt: '0.0' },
    { header: '2º Bim', key: 'b2', width: 12, align: 'center', numFmt: '0.0' },
    { header: '3º Bim', key: 'b3', width: 12, align: 'center', numFmt: '0.0' },
    { header: '4º Bim', key: 'b4', width: 12, align: 'center', numFmt: '0.0' },
    { header: 'Média Anual', key: 'media', width: 14, align: 'center', numFmt: '0.0' },
    { header: 'Situação', key: 'situacao', width: 16, align: 'center' }
  ];

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows: any[] = [];

  sortedStudents.forEach((student: any) => {
    let studentName = student.name;
    const isExpedido = student.status === 'expedida';
    if (showTransfer) {
      studentName += formatStudentTransferTag(student, false);
    }

    const rowObj: any = {
      number: student.number,
      name: studentName,
      ra: student.ra || '-'
    };
    let total = 0;
    let count = 0;

    for (let b = 1; b <= 4; b++) {
      let notaVal: any = '-';
      let bSum = 0;
      let bCnt = 0;
      const isTransferredOutInBim = isStudentTransferredOutBeforeBimester(student, b);

      if (!isTransferredOutInBim) {
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            (!g.anoLetivo || g.anoLetivo === currentYear) &&
            String(g.bimester) === String(b) &&
            g.studentId === student.id &&
            (subject === 'todas' || gSub === subject)
          ) {
            const num = parseFloat(g.value);
            if (!isNaN(num)) {
              bSum += num;
              bCnt++;
            }
          }
        });

        if (bCnt === 0 && student.status === 'recebida' && student.ra) {
          const origStudent = sortedStudents.find(
            (o: any) => o.id !== student.id && o.status === 'expedida' && o.ra === student.ra
          );
          if (origStudent) {
            Object.keys(notasVal).forEach((k) => {
              const g = notasVal[k];
              const gSub = g.subject || 'portugues';
              if (
                g.classId === classId &&
                (!g.anoLetivo || g.anoLetivo === currentYear) &&
                String(g.bimester) === String(b) &&
                g.studentId === origStudent.id &&
                (subject === 'todas' || gSub === subject)
              ) {
                const num = parseFloat(g.value);
                if (!isNaN(num)) {
                  bSum += num;
                  bCnt++;
                }
              }
            });
          }
        }

        if (bCnt > 0) {
          const avg = bSum / bCnt;
          notaVal = parseFloat(avg.toFixed(1));
          total += avg;
          count++;
        }
      }

      if (isTransferredOutInBim || (isExpedido && notaVal === '-')) {
        notaVal = 'TR. EXP.';
      }
      rowObj[`b${b}`] = notaVal;
    }

    const finalAvg = count > 0 ? parseFloat((total / count).toFixed(1)) : '-';
    rowObj.media = finalAvg;

    let situacao = 'Em Curso';
    if (isExpedido) situacao = 'TR. EXP.';
    else if (count === 4) {
      situacao = typeof finalAvg === 'number' && finalAvg >= 5.0 ? 'Aprovado' : 'Retido';
    }
    rowObj.situacao = situacao;
    rows.push(rowObj);
  });

  await exportToExcelJS({
    title,
    turma,
    teacher,
    year: currentYear,
    subject,
    sheetName: 'Boletim Anual',
    columns,
    rows,
    emptyMessage: 'Nenhum aluno cadastrado na turma.',
    filename: `boletim_anual_${subject}_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

// 1.3 Desempenho da Turma PDF
export async function generateClassPerformanceReport(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  teacher: string,
  currentYear: string,
  subject = 'todas'
) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `RELATÓRIO DE DESEMPENHO DA TURMA - ${bimester}º BIMESTRE`, turma, teacher, currentYear, subject);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const gradesList: number[] = [];

  Object.keys(studentsVal).forEach((sid) => {
    const student = studentsVal[sid];
    if (student.status !== 'expedida' && (!student.anoLetivo || student.anoLetivo === currentYear)) {
      Object.keys(notasVal).forEach((k) => {
        const g = notasVal[k];
        const gSub = g.subject || 'portugues';
        if (
          g.classId === classId &&
          (!g.anoLetivo || g.anoLetivo === currentYear) &&
          String(g.bimester) === String(bimester) &&
          g.studentId === sid &&
          (subject === 'todas' || gSub === subject)
        ) {
          const val = parseFloat(g.value);
          if (!isNaN(val)) gradesList.push(val);
        }
      });
    }
  });

  const totalAlunos = gradesList.length;
  let mediaGeral = 0;
  let maiorNota = 0;
  let menorNota = 10;
  let acimaMedia = 0;
  let abaixoMedia = 0;

  const faixas = {
    insuficiente: 0, // 0 - 4.9
    regular: 0,      // 5.0 - 6.9
    bom: 0,          // 7.0 - 8.4
    excelente: 0     // 8.5 - 10
  };

  if (totalAlunos > 0) {
    let sum = 0;
    gradesList.forEach((n) => {
      sum += n;
      if (n > maiorNota) maiorNota = n;
      if (n < menorNota) menorNota = n;
      if (n >= 5.0) acimaMedia++;
      else abaixoMedia++;

      if (n < 5.0) faixas.insuficiente++;
      else if (n < 7.0) faixas.regular++;
      else if (n < 8.5) faixas.bom++;
      else faixas.excelente++;
    });
    mediaGeral = sum / totalAlunos;
  } else {
    menorNota = 0;
  }

  const kpiData = [
    ['Total de Notas Lançadas', totalAlunos.toString()],
    ['Média Geral da Turma', mediaGeral.toFixed(1)],
    ['Maior Nota', maiorNota.toFixed(1)],
    ['Menor Nota', menorNota.toFixed(1)],
    ['Aproveitamento (>= 5.0)', `${acimaMedia} (${totalAlunos ? ((acimaMedia / totalAlunos) * 100).toFixed(0) : 0}%)`],
    ['Abaixo da Média (< 5.0)', `${abaixoMedia} (${totalAlunos ? ((abaixoMedia / totalAlunos) * 100).toFixed(0) : 0}%)`]
  ];

  autoTable(doc, {
    startY,
    head: [['Indicador de Desempenho', 'Resultado']],
    body: kpiData,
    theme: 'striped',
    headStyles: { fillColor: [41, 128, 185] }
  });

  const finalY = (doc as any).lastAutoTable.finalY || startY + 40;

  const faixasData = [
    ['Insuficiente (0.0 a 4.9)', faixas.insuficiente.toString(), `${totalAlunos ? ((faixas.insuficiente / totalAlunos) * 100).toFixed(1) : 0}%`],
    ['Regular (5.0 a 6.9)', faixas.regular.toString(), `${totalAlunos ? ((faixas.regular / totalAlunos) * 100).toFixed(1) : 0}%`],
    ['Bom (7.0 a 8.4)', faixas.bom.toString(), `${totalAlunos ? ((faixas.bom / totalAlunos) * 100).toFixed(1) : 0}%`],
    ['Excelente (8.5 a 10.0)', faixas.excelente.toString(), `${totalAlunos ? ((faixas.excelente / totalAlunos) * 100).toFixed(1) : 0}%`]
  ];

  autoTable(doc, {
    startY: finalY + 10,
    head: [['Faixa de Notas', 'Qtd Alunos', 'Percentual']],
    body: faixasData,
    theme: 'grid'
  });

  doc.save(`desempenho_turma_${bimester}bim_${subject}_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

// 1.3 Desempenho da Turma XLSX
export async function generateClassPerformanceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  subject = 'todas',
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const gradesList: number[] = [];

  Object.keys(studentsVal).forEach((sid) => {
    const student = studentsVal[sid];
    if (student.status !== 'expedida' && (!student.anoLetivo || student.anoLetivo === currentYear)) {
      Object.keys(notasVal).forEach((k) => {
        const g = notasVal[k];
        const gSub = g.subject || 'portugues';
        if (
          g.classId === classId &&
          (!g.anoLetivo || g.anoLetivo === currentYear) &&
          String(g.bimester) === String(bimester) &&
          g.studentId === sid &&
          (subject === 'todas' || gSub === subject)
        ) {
          const val = parseFloat(g.value);
          if (!isNaN(val)) gradesList.push(val);
        }
      });
    }
  });

  const total = gradesList.length;
  let sum = 0, maior = 0, menor = 10, acima = 0, abaixo = 0;
  let f1 = 0, f2 = 0, f3 = 0, f4 = 0;

  if (total > 0) {
    gradesList.forEach((n) => {
      sum += n;
      if (n > maior) maior = n;
      if (n < menor) menor = n;
      if (n >= 5) acima++; else abaixo++;
      if (n < 5) f1++; else if (n < 7) f2++; else if (n < 8.5) f3++; else f4++;
    });
  } else menor = 0;

  const blocks: CustomTableBlock[] = [
    {
      title: '1. INDICADORES GERAIS DE DESEMPENHO',
      columns: [
        { header: 'Indicador de Desempenho', key: 'indicador', width: 35 },
        { header: 'Resultado', key: 'resultado', width: 25, align: 'center' }
      ],
      rows: [
        { indicador: 'Total de Notas Lançadas', resultado: total },
        { indicador: 'Média Geral da Turma', resultado: total ? parseFloat((sum / total).toFixed(1)) : 0 },
        { indicador: 'Maior Nota', resultado: maior },
        { indicador: 'Menor Nota', resultado: menor },
        { indicador: 'Aproveitamento (>= 5.0)', resultado: `${acima} (${total ? ((acima / total) * 100).toFixed(0) : 0}%)` },
        { indicador: 'Abaixo da Média (< 5.0)', resultado: `${abaixo} (${total ? ((abaixo / total) * 100).toFixed(0) : 0}%)` }
      ]
    },
    {
      title: '2. DISTRIBUIÇÃO POR FAIXA DE NOTAS',
      columns: [
        { header: 'Faixa de Notas', key: 'faixa', width: 35 },
        { header: 'Quantidade de Alunos', key: 'qtd', width: 22, align: 'center' },
        { header: 'Percentual', key: 'pct', width: 18, align: 'center' }
      ],
      rows: [
        { faixa: 'Insuficiente (0.0 a 4.9)', qtd: f1, pct: total ? `${((f1 / total) * 100).toFixed(1)}%` : '0%' },
        { faixa: 'Regular (5.0 a 6.9)', qtd: f2, pct: total ? `${((f2 / total) * 100).toFixed(1)}%` : '0%' },
        { faixa: 'Bom (7.0 a 8.4)', qtd: f3, pct: total ? `${((f3 / total) * 100).toFixed(1)}%` : '0%' },
        { faixa: 'Excelente (8.5 a 10.0)', qtd: f4, pct: total ? `${((f4 / total) * 100).toFixed(1)}%` : '0%' }
      ]
    }
  ];

  await exportMultiBlockToExcelJS({
    title: `RELATÓRIO DE DESEMPENHO DA TURMA - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    subject,
    sheetName: 'Desempenho Turma',
    blocks,
    filename: `desempenho_turma_${bimester}bim_${subject}.xlsx`
  });
}

// 1.4 Evolução Individual do Aluno (1º ao 4º) PDF
export async function generateStudentEvolutionReport(
  classId: string,
  studentId: string | null,
  turma: ClassRoom,
  teacher: string,
  currentYear: string
) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, 'EVOLUÇÃO E TRAJETÓRIA DE APRENDIZAGEM', turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  const tableData: any[] = [];
  const studentGradesMap: Record<string, (number | null)[]> = {};

  // Média da turma por bimestre para comparação
  const classBimAverages: (number | null)[] = [null, null, null, null];
  for (let b = 1; b <= 4; b++) {
    let cSum = 0, cCnt = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (
        g.classId === classId &&
        (!g.anoLetivo || g.anoLetivo === currentYear) &&
        String(g.bimester) === String(b)
      ) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          cSum += val;
          cCnt++;
        }
      }
    });
    if (cCnt > 0) classBimAverages[b - 1] = cSum / cCnt;
  }

  targetStudents.forEach((student: any) => {
    const grades: (number | null)[] = [null, null, null, null];
    for (let b = 1; b <= 4; b++) {
      let bSum = 0, bCnt = 0;
      Object.keys(notasVal).forEach((k) => {
        const g = notasVal[k];
        if (
          g.classId === classId &&
          (!g.anoLetivo || g.anoLetivo === currentYear) &&
          String(g.bimester) === String(b) &&
          g.studentId === student.id
        ) {
          const val = parseFloat(g.value);
          if (!isNaN(val)) {
            bSum += val;
            bCnt++;
          }
        }
      });
      if (bCnt > 0) grades[b - 1] = bSum / bCnt;
    }

    studentGradesMap[student.id] = grades;

    let evolucao = 'Sem dados suficientes';
    const validGrades = grades.filter((g) => g !== null) as number[];
    if (validGrades.length >= 2) {
      const first = validGrades[0];
      const last = validGrades[validGrades.length - 1];
      const diff = last - first;
      if (diff > 0.5) evolucao = `Evolutivo (+${diff.toFixed(1)})`;
      else if (diff < -0.5) evolucao = `Em Queda (${diff.toFixed(1)})`;
      else evolucao = `Estável (${diff.toFixed(1)})`;
    }

    tableData.push([
      student.number,
      student.name,
      grades[0] !== null ? grades[0]!.toFixed(1) : '-',
      grades[1] !== null ? grades[1]!.toFixed(1) : '-',
      grades[2] !== null ? grades[2]!.toFixed(1) : '-',
      grades[3] !== null ? grades[3]!.toFixed(1) : '-',
      evolucao
    ]);
  });

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [['Nº', 'Aluno', '1º Bim', '2º Bim', '3º Bim', '4º Bim', 'Tendência Anual']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhum dado de evolução registrado no período.', '-', '-', '-', '-', '-']],
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [16, 185, 129],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 70, halign: 'left' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 38, halign: 'center' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const text = String(data.cell.raw || '');
        if (text.startsWith('Evolutivo')) {
          data.cell.styles.textColor = [16, 149, 106];
          data.cell.styles.fontStyle = 'bold';
        } else if (text.startsWith('Em Queda')) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (text.startsWith('Estável')) {
          data.cell.styles.textColor = [55, 65, 81];
        } else {
          data.cell.styles.textColor = [156, 163, 175];
        }
      }
    }
  });

  // DESENHO DO GRÁFICO VETORIAL DE EVOLUÇÃO
  const finalY = (doc as any).lastAutoTable?.finalY || startY + 40;

  // Gráfico para Aluno Individual
  if (targetStudents.length === 1) {
    const student = targetStudents[0];
    const sGrades = studentGradesMap[student.id] || [null, null, null, null];

    let chartY = finalY + 10;
    if (chartY + 75 > 280) {
      doc.addPage();
      chartY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`GRÁFICO DE TRAJETÓRIA E DESEMPENHO — Nº ${student.number} ${student.name}`, 14, chartY);

    const boxX = 14;
    const boxY = chartY + 3;
    const boxW = 182;
    const boxH = 62;

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, 'FD');

    const gX = boxX + 22;
    const gY = boxY + 8;
    const gW = boxW - 35;
    const gH = boxH - 20;

    // Linhas horizontais (0, 2.5, 5.0, 7.5, 10.0)
    [0, 2.5, 5.0, 7.5, 10.0].forEach((v) => {
      const lineY = gY + gH - (v / 10.0) * gH;
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.3);
      doc.line(gX, lineY, gX + gW, lineY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(v.toFixed(1), gX - 3, lineY + 1.5, { align: 'right' });
    });

    // Linha de corte 5.0 destacada
    const passY = gY + gH - (5.0 / 10.0) * gH;
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(gX, passY, gX + gW, passY);
    doc.setLineDashPattern([], 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(217, 119, 6);
    doc.text('Corte (5.0)', gX + gW, passY - 1.5, { align: 'right' });

    // Coordenadas X dos bimestres
    const bXs = [0, 1, 2, 3].map((i) => gX + (i * gW) / 3);

    ['1º Bimestre', '2º Bimestre', '3º Bimestre', '4º Bimestre'].forEach((lbl, i) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(lbl, bXs[i], gY + gH + 5, { align: 'center' });
    });

    // Média da Turma (Linha tracejada)
    const validClassPts = bXs
      .map((x, i) => ({ x, y: classBimAverages[i] !== null ? gY + gH - (classBimAverages[i]! / 10.0) * gH : null }))
      .filter((pt) => pt.y !== null) as { x: number; y: number }[];

    if (validClassPts.length > 1) {
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.6);
      doc.setLineDashPattern([2, 2], 0);
      for (let i = 0; i < validClassPts.length - 1; i++) {
        doc.line(validClassPts[i].x, validClassPts[i].y, validClassPts[i + 1].x, validClassPts[i + 1].y);
      }
      doc.setLineDashPattern([], 0);
    }
    validClassPts.forEach((pt) => {
      doc.setFillColor(148, 163, 184);
      doc.circle(pt.x, pt.y, 1.2, 'F');
    });

    // Linha do Aluno
    const validStudentPts = bXs
      .map((x, i) => ({
        x,
        y: sGrades[i] !== null ? gY + gH - (sGrades[i]! / 10.0) * gH : null,
        val: sGrades[i]
      }))
      .filter((pt) => pt.y !== null && pt.val !== null) as { x: number; y: number; val: number }[];

    if (validStudentPts.length > 1) {
      doc.setDrawColor(79, 70, 229);
      doc.setLineWidth(1.2);
      for (let i = 0; i < validStudentPts.length - 1; i++) {
        doc.line(validStudentPts[i].x, validStudentPts[i].y, validStudentPts[i + 1].x, validStudentPts[i + 1].y);
      }
    }

    // Pontos do Aluno com etiquetas de nota
    validStudentPts.forEach((pt) => {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(79, 70, 229);
      doc.setLineWidth(0.8);
      doc.circle(pt.x, pt.y, 2.2, 'FD');

      const ptColor = pt.val >= 6.0 ? [16, 185, 129] : pt.val >= 5.0 ? [245, 158, 11] : [239, 68, 68];
      doc.setFillColor(ptColor[0], ptColor[1], ptColor[2]);
      doc.circle(pt.x, pt.y, 1.2, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 27, 75);
      doc.text(pt.val.toFixed(1), pt.x, pt.y - 3.5, { align: 'center' });
    });

    // Legenda
    const legY = boxY + boxH - 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);

    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(1.2);
    doc.line(boxX + 18, legY, boxX + 24, legY);
    doc.setTextColor(79, 70, 229);
    doc.text('Aluno', boxX + 26, legY + 0.8);

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.6);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(boxX + 50, legY, boxX + 56, legY);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(100, 116, 139);
    doc.text('Média da Turma', boxX + 58, legY + 0.8);

    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.6);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(boxX + 105, legY, boxX + 111, legY);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(217, 119, 6);
    doc.text('Corte Mínimo (5.0)', boxX + 113, legY + 0.8);
  } else {
    // Gráfico de Evolução Geral da Turma (sempre impresso, criando nova página caso necessário)
    let chartY = finalY + 8;
    if (chartY + 55 > 280) {
      doc.addPage();
      chartY = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('PANORAMA DE EVOLUÇÃO MÉDIA DA TURMA', 14, chartY);

    const boxX = 14;
    const boxY = chartY + 3;
    const boxW = 182;
    const boxH = 48;

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, 'FD');

    const gX = boxX + 22;
    const gY = boxY + 6;
    const gW = boxW - 35;
    const gH = boxH - 16;

    [0, 2.5, 5.0, 7.5, 10.0].forEach((v) => {
      const lineY = gY + gH - (v / 10.0) * gH;
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.3);
      doc.line(gX, lineY, gX + gW, lineY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(v.toFixed(1), gX - 3, lineY + 1.5, { align: 'right' });
    });

    const bXs = [0, 1, 2, 3].map((i) => gX + (i * gW) / 3);
    ['1º Bim', '2º Bim', '3º Bim', '4º Bim'].forEach((lbl, i) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(lbl, bXs[i], gY + gH + 4, { align: 'center' });
    });

    const validClassPts = bXs
      .map((x, i) => ({
        x,
        y: classBimAverages[i] !== null ? gY + gH - (classBimAverages[i]! / 10.0) * gH : null,
        val: classBimAverages[i]
      }))
      .filter((pt) => pt.y !== null && pt.val !== null) as { x: number; y: number; val: number }[];

    if (validClassPts.length > 1) {
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(1.2);
      for (let i = 0; i < validClassPts.length - 1; i++) {
        doc.line(validClassPts[i].x, validClassPts[i].y, validClassPts[i + 1].x, validClassPts[i + 1].y);
      }
    }
    validClassPts.forEach((pt) => {
      doc.setFillColor(16, 185, 129);
      doc.circle(pt.x, pt.y, 1.8, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(16, 149, 106);
      doc.text(pt.val.toFixed(1), pt.x, pt.y - 2.5, { align: 'center' });
    });
  }

  doc.save(`evolucao_alunos_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export interface TrajectoryReportStudentItem {
  student: {
    id?: string;
    name: string;
    number?: number;
    ra?: string;
    status?: string;
    transferInDate?: string;
    transferOutDate?: string;
    transferDate?: string;
  };
  grades: (number | null)[];
  annualAverage: number | null;
  trend: 'Evolutivo' | 'Em Queda' | 'Estável' | 'Sem dados' | string;
  diff: number;
  attendanceRate?: number | null;
  totalPresences?: number;
  totalAbsences?: number;
}

export const STUDENT_CHART_COLORS = [
  '#4f46e5', '#0284c7', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#2563eb',
  '#16a34a', '#9333ea', '#c026d3', '#0891b2', '#ca8a04',
  '#e11d48', '#4338ca', '#0891b2', '#65a30d', '#b45309'
];

/**
 * Renderiza o Gráfico Vetorial Completo da Turma diretamente em um HTML5 Canvas de alta resolução.
 * 100% síncrono, independente do DOM e confiável para PNG, Excel e PDF.
 */
export function renderClassChartToCanvas({
  turma,
  teacherName,
  currentYear,
  selectedSubjectName,
  studentsTrajectory,
  classOverallAverage,
  classBimAverages,
  width = 1100,
  height = 560
}: {
  turma?: ClassRoom | null;
  teacherName?: string;
  currentYear: string;
  selectedSubjectName?: string;
  studentsTrajectory: TrajectoryReportStudentItem[];
  classOverallAverage?: number | null;
  classBimAverages?: (number | null)[];
  width?: number;
  height?: number;
}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 1. Fundo Branco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 2. Banner Superior Institucional
  ctx.fillStyle = '#1e1b4b'; // indigo-950
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(14, 12, width - 28, 56, 10);
  } else {
    ctx.rect(14, 12, width - 28, 56);
  }
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('DIÁRIO DE CLASSE — EVOLUÇÃO E TRAJETÓRIA ESCOLAR DA TURMA', 28, 36);

  const turmaStr = turma ? `${turma.year}º Ano ${turma.letter} (${turma.schoolName || 'Escola'})` : 'Turma';
  const subStr = selectedSubjectName || 'Média Geral (Todas as Matérias)';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Turma: ${turmaStr}   |   Ano Letivo: ${currentYear}   |   Professor(a): ${teacherName || '-'}   |   ${subStr}`, 28, 55);

  // 3. Área Gráfica Principal
  const pLeft = 65;
  const pRight = 210; // espaço lateral para painel de legenda e métricas
  const pTop = 82;
  const pBottom = 65;
  const chartW = width - pLeft - pRight;
  const chartH = height - pTop - pBottom;

  // Fundo da área de plotagem
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(pLeft, pTop, chartW, chartH, 8);
  } else {
    ctx.rect(pLeft, pTop, chartW, chartH);
  }
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  const getY = (val: number) => pTop + chartH - (val / 10.0) * chartH;
  const getX = (b: number) => pLeft + ((b - 1) * chartW) / 3;

  // Grade horizontal (0, 2.5, 5.0, 7.5, 10.0)
  [0, 2.5, 5.0, 7.5, 10.0].forEach((v) => {
    const y = getY(v);
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pLeft, y);
    ctx.lineTo(pLeft + chartW, y);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(1), pLeft - 8, y + 4);
  });

  // Linha de Corte 5.0 em destaque (Tracejada âmbar)
  const yCorte = getY(5.0);
  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pLeft, yCorte);
  ctx.lineTo(pLeft + chartW, yCorte);
  ctx.stroke();
  ctx.restore();

  // Etiqueta Corte 5.0
  ctx.fillStyle = '#d97706';
  ctx.font = 'bold 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Corte (5.0)', pLeft + chartW - 6, yCorte - 5);

  // Colunas dos Bimestres (1º, 2º, 3º, 4º)
  [1, 2, 3, 4].forEach((b) => {
    const x = getX(b);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pTop);
    ctx.lineTo(x, pTop + chartH);
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${b}º Bimestre`, x, pTop + chartH + 22);
  });

  // 4. Linhas de Trajetória de TODOS os Alunos
  studentsTrajectory.forEach((st, idx) => {
    const validPts: { x: number; y: number; val: number; b: number }[] = [];
    st.grades.forEach((g, bIdx) => {
      if (g !== null) {
        validPts.push({ x: getX(bIdx + 1), y: getY(g), val: g, b: bIdx + 1 });
      }
    });

    if (validPts.length === 0) return;

    const color = STUDENT_CHART_COLORS[idx % STUDENT_CHART_COLORS.length];

    // Traçado da linha
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    validPts.forEach((pt, pIdx) => {
      if (pIdx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Círculos nos pontos
    validPts.forEach((pt) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
  });

  // 5. Linha Dourada Proeminente da MÉDIA DA TURMA
  const cBims = classBimAverages || [null, null, null, null];
  const validClassPts: { x: number; y: number; val: number; b: number }[] = [];
  cBims.forEach((g, bIdx) => {
    if (g !== null) {
      validClassPts.push({ x: getX(bIdx + 1), y: getY(g), val: g, b: bIdx + 1 });
    }
  });

  if (validClassPts.length > 0) {
    // Halo suave
    ctx.save();
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.85)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    validClassPts.forEach((pt, pIdx) => {
      if (pIdx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Linha principal da média
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    validClassPts.forEach((pt, pIdx) => {
      if (pIdx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    // Marcadores em Diamante com notas da média
    validClassPts.forEach((pt) => {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();

      // Rótulo da média
      ctx.fillStyle = '#78350f';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pt.val.toFixed(1), pt.x, pt.y - 10);
    });

    // Texto ao lado do último ponto
    const lastPt = validClassPts[validClassPts.length - 1];
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Média Turma', lastPt.x + 12, lastPt.y + 4);
  }

  // 6. Painel Lateral de Legenda & Indicadores (Direita)
  const legX = pLeft + chartW + 14;
  const legY = pTop;
  const legW = pRight - 28;
  const legH = chartH;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(legX, legY, legW, legH, 8);
  } else {
    ctx.rect(legX, legY, legW, legH);
  }
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cabeçalho Legenda
  ctx.fillStyle = '#1e1b4b';
  ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('INDICADORES DA TURMA', legX + 10, legY + 22);

  const totalAlunos = studentsTrajectory.length;
  const cOver = classOverallAverage !== undefined && classOverallAverage !== null ? classOverallAverage.toFixed(1) : '-';
  const evolutivos = studentsTrajectory.filter((s) => s.trend === 'Evolutivo').length;
  const queda = studentsTrajectory.filter((s) => s.trend === 'Em Queda').length;
  const estaveis = studentsTrajectory.filter((s) => s.trend === 'Estável').length;
  const abaixoCorte = studentsTrajectory.filter((s) => s.annualAverage !== null && s.annualAverage < 5.0).length;

  const kpisList = [
    { label: 'Total de Alunos:', val: `${totalAlunos}`, color: '#1e293b' },
    { label: 'Média Geral:', val: `${cOver}`, color: '#4338ca', bold: true },
    { label: '↗️ Evolutivos:', val: `${evolutivos} (${totalAlunos ? Math.round((evolutivos / totalAlunos) * 100) : 0}%)`, color: '#16a34a' },
    { label: '➡️ Estáveis:', val: `${estaveis} (${totalAlunos ? Math.round((estaveis / totalAlunos) * 100) : 0}%)`, color: '#475569' },
    { label: '↘️ Em Queda:', val: `${queda} (${totalAlunos ? Math.round((queda / totalAlunos) * 100) : 0}%)`, color: '#dc2626' },
    { label: '⚠️ Abaixo 5.0:', val: `${abaixoCorte} aluno(s)`, color: '#d97706' }
  ];

  kpisList.forEach((kpi, kIdx) => {
    const kY = legY + 44 + kIdx * 24;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(kpi.label, legX + 10, kY);

    ctx.fillStyle = kpi.color;
    ctx.font = kpi.bold ? 'bold 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : 'bold 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(kpi.val, legX + legW - 10, kY);
  });

  // Linha separadora na legenda
  const sepY = legY + 44 + kpisList.length * 24 + 4;
  ctx.strokeStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.moveTo(legX + 10, sepY);
  ctx.lineTo(legX + legW - 10, sepY);
  ctx.stroke();

  // Amostra de Alunos na Legenda
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ALUNOS (CURVAS):', legX + 10, sepY + 16);

  const sampleStudents = studentsTrajectory.slice(0, 7);
  sampleStudents.forEach((st, sIdx) => {
    const sY = sepY + 30 + sIdx * 17;
    const color = STUDENT_CHART_COLORS[sIdx % STUDENT_CHART_COLORS.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(legX + 14, sY - 3, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    let sName = st.student.name.split(' ').slice(0, 2).join(' ');
    if (sName.length > 16) sName = sName.slice(0, 15) + '..';
    ctx.fillText(`#${st.student.number || sIdx + 1} ${sName}`, legX + 24, sY);

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(st.annualAverage !== null ? st.annualAverage.toFixed(1) : '-', legX + legW - 10, sY);
    ctx.textAlign = 'left';
  });

  if (studentsTrajectory.length > 7) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'italic 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`+ ${studentsTrajectory.length - 7} alunos plotados`, legX + 24, sepY + 30 + 7 * 17);
  }

  // 7. Rodapé do Gráfico
  ctx.fillStyle = '#94a3b8';
  ctx.font = '9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  ctx.fillText(`Diário de Classe • Gráfico Oficial da Turma • Emitido em ${dataHoje}`, pLeft, height - 16);

  return canvas;
}

/**
 * Salva diretamente o Gráfico da Turma Completa em formato de imagem PNG em alta resolução.
 */
export function downloadClassChartPNG(options: Parameters<typeof renderClassChartToCanvas>[0]) {
  const canvas = renderClassChartToCanvas(options);
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  const turmaName = options.turma ? `${options.turma.year}${options.turma.letter}` : 'turma';
  a.download = `grafico_evolucao_turma_${turmaName}_${options.currentYear}.png`;
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Imprime o Gráfico da Turma Completa via diálogo do navegador em página limpa e isolada,
 * gerando e baixando concomitantemente o PDF oficial do gráfico em alta resolução como garantia.
 */
export function printClassChartDocument(options: Parameters<typeof renderClassChartToCanvas>[0]) {
  const canvas = renderClassChartToCanvas(options);
  const dataUrl = canvas.toDataURL('image/png');

  // 1. Gera e salva o PDF individual de 1 página do Gráfico da Turma (garantia contra bloqueio de popups)
  generateClassChartSinglePagePDF(options, dataUrl);

  // 2. Dispara diálogo nativo de impressão em elemento isolado
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      const turmaStr = options.turma ? `${options.turma.year}º Ano ${options.turma.letter} (${options.turma.schoolName || 'Escola'})` : 'Turma';
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Gráfico da Turma - ${turmaStr}</title>
          <style>
            @page { size: landscape; margin: 10mm; }
            body { font-family: system-ui, sans-serif; margin: 0; padding: 0; text-align: center; background: #ffffff; }
            img { width: 100%; max-height: 94vh; object-fit: contain; }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" alt="Gráfico da Turma" />
        </body>
        </html>
      `);
      doc.close();
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.warn('Erro ao chamar iframe.print():', e);
        }
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 3000);
      }, 500);
    }
  } catch (e) {
    console.warn('Impressão em iframe restrita pelo ambiente:', e);
  }
}

/**
 * Gera um PDF Paisagem (Landscape) de 1 página dedicado exclusivamente ao Gráfico da Turma Completa e suas métricas.
 */
export function generateClassChartSinglePagePDF(
  options: Parameters<typeof renderClassChartToCanvas>[0],
  existingDataUrl?: string
) {
  const dataUrl = existingDataUrl || renderClassChartToCanvas(options).toDataURL('image/png');
  const doc = new jsPDF('l', 'mm', 'a4'); // Paisagem 297mm x 210mm
  doc.addImage(dataUrl, 'PNG', 10, 10, 277, 142);

  // Rodapé informativo
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const dataStr = new Date().toLocaleDateString('pt-BR');
  doc.text(`Diário de Classe • Gráfico Oficial de Rendimento da Turma • Emitido em ${dataStr}`, 14, 202);
  doc.text(`Total de alunos plotados: ${options.studentsTrajectory.length}`, 283, 202, { align: 'right' });

  const turmaName = options.turma ? `${options.turma.year}${options.turma.letter}` : 'turma';
  doc.save(`grafico_turma_completa_${turmaName}_${options.currentYear}.pdf`);
  return doc;
}

export function generateClassFullTrajectoriesReportPDF({
  turma,
  teacherName,
  currentYear,
  selectedSubjectName,
  studentsTrajectory,
  classOverallAverage,
  classBimAverages
}: {
  turma?: ClassRoom | null;
  teacherName?: string;
  currentYear: string;
  selectedSubjectName?: string;
  studentsTrajectory: TrajectoryReportStudentItem[];
  classOverallAverage?: number | null;
  classBimAverages?: (number | null)[];
}) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const totalStudents = studentsTrajectory.length;
  const cardsPerPage = 4;
  const totalPages = Math.max(1, Math.ceil(totalStudents / cardsPerPage));

  const cBimAvgs = classBimAverages || [null, null, null, null];
  const cOverall = classOverallAverage ?? null;

  const turmaStr = turma ? `${turma.year}º Ano ${turma.letter} (${turma.schoolName || 'Escola'})` : 'Turma';
  const subStr = selectedSubjectName || 'Média Geral (Todas as Matérias)';

  // =========================================================================
  // RELATÓRIO OFICIAL: ALUNOS COM DADOS À ESQUERDA + LINHA DO GRÁFICO À FRENTE
  // =========================================================================
  for (let page = 0; page < totalPages; page++) {
    if (page > 0) {
      doc.addPage();
    }

    // Top Header com duas linhas bem definidas para nunca estourar a largura da página
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(12, 9, 186, 19, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 27, 75); // indigo-950
    doc.text('DIÁRIO DE CLASSE — EVOLUÇÃO E TRAJETÓRIA ESCOLAR DA TURMA', 16, 15);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Turma: ${turmaStr}   •   Ano Letivo: ${currentYear}   •   Professor(a): ${teacherName || '-'}`, 16, 20);
    doc.text(`Componente Curricular / Disciplina: ${subStr}`, 16, 24.5);

    // Students slice for current page
    const pageStudents = studentsTrajectory.slice(page * cardsPerPage, (page + 1) * cardsPerPage);

    pageStudents.forEach((row, idx) => {
      const cardX = 12;
      const cardY = 30 + idx * 60; // 30, 90, 150, 210
      const cardW = 186;
      const cardH = 57;

      // Card Container
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2, 'FD');

      // Left Column Background
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(cardX + 1, cardY + 1, 78, cardH - 2, 1.5, 1.5, 'F');

      // Divider line between columns
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.4);
      doc.line(cardX + 80, cardY + 2, cardX + 80, cardY + cardH - 2);

      // --- LEFT COLUMN: ALUNO COM SEUS DADOS ---
      // Number badge
      doc.setFillColor(79, 70, 229);
      doc.roundedRect(cardX + 3, cardY + 3, 9, 8, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`#${row.student.number ?? idx + 1}`, cardX + 7.5, cardY + 8.5, { align: 'center' });

      // Student name (truncated if long)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      let sName = row.student.name || 'Aluno';
      if (sName.length > 34) sName = sName.substring(0, 32) + '...';
      doc.text(sName, cardX + 14, cardY + 7.5);

      // RA and Status
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      const raText = row.student.ra ? `RA: ${row.student.ra}` : 'Matrícula ativa';
      const statusText = row.student.status === 'recebida' ? ' • (TR. REC)' : row.student.status === 'expedida' ? ' • (TR. EXP)' : '';
      doc.text(`${raText}${statusText}`, cardX + 14, cardY + 11);

      // 4 Bimestres boxes
      for (let b = 1; b <= 4; b++) {
        const bX = cardX + 3 + (b - 1) * 19;
        const bY = cardY + 14;
        const bW = 18;
        const bH = 15;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(bX, bY, bW, bH, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`${b}º Bim`, bX + bW / 2, bY + 4.5, { align: 'center' });

        const val = row.grades[b - 1];
        if (val !== null) {
          const gColor = val >= 6.0 ? [16, 185, 129] : val >= 5.0 ? [245, 158, 11] : [239, 68, 68];
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(gColor[0], gColor[1], gColor[2]);
          doc.text(val.toFixed(1), bX + bW / 2, bY + 11.5, { align: 'center' });
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text('-', bX + bW / 2, bY + 11, { align: 'center' });
        }
      }

      // Média Final Box
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cardX + 3, cardY + 31, 36, 13, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text('MÉDIA FINAL', cardX + 5, cardY + 35);

      const mVal = row.annualAverage;
      if (mVal !== null) {
        const mColor = mVal >= 6.0 ? [16, 185, 129] : mVal >= 5.0 ? [245, 158, 11] : [239, 68, 68];
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(mColor[0], mColor[1], mColor[2]);
        doc.text(mVal.toFixed(1), cardX + 5, cardY + 41.5);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.text('-', cardX + 5, cardY + 41.5);
      }

      // Tendência Box
      const trendBg = row.trend === 'Evolutivo' ? [220, 252, 231] : row.trend === 'Em Queda' ? [254, 226, 226] : [238, 242, 255];
      const trendFg = row.trend === 'Evolutivo' ? [22, 101, 52] : row.trend === 'Em Queda' ? [153, 27, 27] : [55, 48, 163];
      doc.setFillColor(trendBg[0], trendBg[1], trendBg[2]);
      doc.roundedRect(cardX + 41, cardY + 31, 38, 13, 1.5, 1.5, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(trendFg[0], trendFg[1], trendFg[2]);
      doc.text('TENDÊNCIA ANUAL', cardX + 43, cardY + 35);

      doc.setFontSize(7.5);
      const diffLabel = row.diff !== 0 ? (row.diff > 0 ? ` (+${row.diff.toFixed(1)})` : ` (${row.diff.toFixed(1)})`) : '';
      doc.text(`${row.trend}${diffLabel}`, cardX + 43, cardY + 41.5);

      // Frequência text on bottom
      if (row.attendanceRate !== null && row.attendanceRate !== undefined) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`Freq: ${row.attendanceRate.toFixed(0)}% (${row.totalAbsences || 0} faltas)`, cardX + 5, cardY + 50);
      }

      // --- RIGHT COLUMN: A LINHA DO GRÁFICO À FRENTE DO ALUNO ---
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text('Curva de Rendimento Escolar', cardX + 83, cardY + 6);

      // Mini legend
      doc.setFontSize(5.5);
      // Média Turma
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([1.5, 1.5], 0);
      doc.line(cardX + 130, cardY + 5, cardX + 135, cardY + 5);
      doc.setLineDashPattern([], 0);
      doc.setTextColor(100, 116, 139);
      doc.text(`Média Turma (${cOverall?.toFixed(1) || '-'})`, cardX + 137, cardY + 6);

      // Corte 5.0
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(cardX + 162, cardY + 5, cardX + 167, cardY + 5);
      doc.setLineDashPattern([], 0);
      doc.setTextColor(217, 119, 6);
      doc.text('Corte (5.0)', cardX + 169, cardY + 6);

      // Chart plotting area
      const gX = cardX + 89;
      const gY = cardY + 11;
      const gW = 92;
      const gH = 34;

      // Chart background
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(gX - 1, gY - 1, gW + 2, gH + 2, 1, 1, 'F');

      // Grid lines
      [0, 2.5, 5.0, 7.5, 10.0].forEach((v) => {
        const yLine = gY + gH - (v / 10.0) * gH;
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.2);
        doc.line(gX, yLine, gX + gW, yLine);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(148, 163, 184);
        doc.text(v.toFixed(1), gX - 1.5, yLine + 1, { align: 'right' });
      });

      // Cutoff 5.0 line
      const passY = gY + gH - (5.0 / 10.0) * gH;
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([1.5, 1.5], 0);
      doc.line(gX, passY, gX + gW, passY);
      doc.setLineDashPattern([], 0);

      // Bimester X coordinates: 1º to 4º
      const bXs = [0, 1, 2, 3].map((i) => gX + (i * gW) / 3);

      ['1º Bim', '2º Bim', '3º Bim', '4º Bim'].forEach((lbl, i) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(100, 116, 139);
        doc.text(lbl, bXs[i], gY + gH + 5, { align: 'center' });
      });

      // Class average trajectory dashed line
      const classPts = bXs
        .map((x, i) => {
          const avg = cBimAvgs[i];
          return avg !== null ? { x, y: gY + gH - (avg / 10.0) * gH, avg } : null;
        })
        .filter((pt): pt is { x: number; y: number; avg: number } => pt !== null);

      if (classPts.length > 1) {
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.4);
        doc.setLineDashPattern([1.5, 1.5], 0);
        for (let i = 0; i < classPts.length - 1; i++) {
          doc.line(classPts[i].x, classPts[i].y, classPts[i + 1].x, classPts[i + 1].y);
        }
        doc.setLineDashPattern([], 0);
      }

      // Student trajectory line
      const sPts = bXs
        .map((x, i) => {
          const g = row.grades[i];
          return g !== null ? { x, y: gY + gH - (g / 10.0) * gH, val: g } : null;
        })
        .filter((pt): pt is { x: number; y: number; val: number } => pt !== null);

      if (sPts.length > 1) {
        const strokeColor =
          row.trend === 'Evolutivo' ? [16, 185, 129] : row.trend === 'Em Queda' ? [239, 68, 68] : [99, 102, 241];
        doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
        doc.setLineWidth(1.1);
        for (let i = 0; i < sPts.length - 1; i++) {
          doc.line(sPts[i].x, sPts[i].y, sPts[i + 1].x, sPts[i + 1].y);
        }
      }

      // Student points and grade numbers
      sPts.forEach((pt) => {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(79, 70, 229);
        doc.setLineWidth(0.6);
        doc.circle(pt.x, pt.y, 1.8, 'FD');

        const ptColor = pt.val >= 6.0 ? [16, 185, 129] : pt.val >= 5.0 ? [245, 158, 11] : [239, 68, 68];
        doc.setFillColor(ptColor[0], ptColor[1], ptColor[2]);
        doc.circle(pt.x, pt.y, 1.0, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(30, 27, 75);
        doc.text(pt.val.toFixed(1), pt.x, pt.y - 2.5, { align: 'center' });
      });

      if (sPts.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text('Sem avaliações lançadas para este componente no ano letivo', gX + gW / 2, gY + gH / 2, { align: 'center' });
      }
    });

    // Page footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    doc.text(`Diário de Classe • Emitido em ${dateStr} às ${timeStr}`, 12, 290);
    doc.text(`Página ${page + 1} de ${totalPages} • Total: ${totalStudents} aluno(s)`, 198, 290, { align: 'right' });
  }

  const fileName = `evolucao_turma_${turma ? `${turma.year}${turma.letter}` : ''}_todos_alunos_graficos.pdf`;
  doc.save(fileName);
  return doc;
}

export async function generateClassTrajectoryXLSX({
  turma,
  teacherName,
  currentYear,
  selectedSubjectName,
  studentsTrajectory,
  classOverallAverage,
  classBimAverages,
  chartPngBase64
}: {
  turma?: ClassRoom | null;
  teacherName?: string;
  currentYear: string;
  selectedSubjectName?: string;
  studentsTrajectory: TrajectoryReportStudentItem[];
  classOverallAverage?: number | null;
  classBimAverages?: (number | null)[];
  chartPngBase64?: string;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diário de Classe';
  workbook.created = new Date();

  // Auto-gera miniatura do gráfico em alta resolução se não fornecido
  let effectiveChartPng = chartPngBase64;
  if (!effectiveChartPng) {
    try {
      const cCanvas = renderClassChartToCanvas({
        turma,
        teacherName,
        currentYear,
        selectedSubjectName,
        studentsTrajectory,
        classOverallAverage,
        classBimAverages,
        width: 1100,
        height: 560
      });
      effectiveChartPng = cCanvas.toDataURL('image/png').split(',')[1];
    } catch (err) {
      console.warn('Erro ao auto-gerar miniatura do gráfico para o Excel:', err);
    }
  }

  // --- ABA 1: Trajetória Escolar com Fórmulas ---
  const ws = workbook.addWorksheet('Trajetória & Fórmulas', {
    views: [{ showGridLines: true }]
  });

  // Título Principal
  ws.mergeCells(1, 1, 1, 14);
  const tCell = ws.getCell(1, 1);
  tCell.value = 'EVOLUÇÃO E TRAJETÓRIA DE APRENDIZAGEM - TURMA COMPLETA';
  tCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } }; // Indigo-950
  tCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 30;

  // Metadados
  const escolaStr = `Escola: ${turma?.schoolName || 'Não informada'}`;
  const turmaStr = `Turma: ${turma ? `${turma.year}º Ano ${turma.letter} - ${turma.shift || 'Manhã'}` : 'Turma'}`;
  const profStr = `Professor(a): ${teacherName || 'Não informado'}   |   Ano Letivo: ${currentYear}   |   Disciplina: ${selectedSubjectName || 'Média Geral'}`;

  [escolaStr, turmaStr, profStr].forEach((str, idx) => {
    const rowNum = idx + 2;
    ws.mergeCells(rowNum, 1, rowNum, 14);
    const c = ws.getCell(rowNum, 1);
    c.value = str;
    c.font = { name: 'Calibri', size: 10, bold: idx === 2 };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(rowNum).height = 18;
  });

  ws.getRow(5).height = 10;

  // Cabeçalhos das Colunas (Linha 6) - 14 Colunas
  const headers = [
    'Nº',
    'Aluno',
    'RA',
    '1º Bim',
    '2º Bim',
    '3º Bim',
    '4º Bim',
    'Média Final',
    'Variação (Delta)',
    'Tendência',
    'Diagnóstico Pedagógico',
    'Presenças',
    'Faltas',
    'Freq. (%)'
  ];

  const colWidths = [6, 36, 16, 11, 11, 11, 11, 14, 16, 18, 28, 12, 11, 13];

  const hRow = ws.getRow(6);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } }; // Teal-600
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0F766E' } },
      bottom: { style: 'medium', color: { argb: 'FF0F766E' } },
      left: { style: 'thin', color: { argb: 'FF0F766E' } },
      right: { style: 'thin', color: { argb: 'FF0F766E' } }
    };
    ws.getColumn(i + 1).width = colWidths[i];
  });

  // Linhas de Dados com Fórmulas (Linha 7 em diante)
  const startRow = 7;
  studentsTrajectory.forEach((st, idx) => {
    const r = startRow + idx;
    const row = ws.getRow(r);
    row.height = 22;

    const b1 = st.grades[0];
    const b2 = st.grades[1];
    const b3 = st.grades[2];
    const b4 = st.grades[3];

    row.getCell(1).value = st.student.number ?? idx + 1;
    row.getCell(2).value = st.student.name;
    row.getCell(3).value = st.student.ra || '-';
    row.getCell(4).value = b1 !== null ? b1 : '';
    row.getCell(5).value = b2 !== null ? b2 : '';
    row.getCell(6).value = b3 !== null ? b3 : '';
    row.getCell(7).value = b4 !== null ? b4 : '';

    // Média Final (Fórmula Real do Excel)
    row.getCell(8).value = {
      formula: `IF(COUNT(D${r}:G${r})>0, ROUND(AVERAGE(D${r}:G${r}), 1), "")`,
      result: st.annualAverage ?? undefined
    };

    // Variação / Delta (Fórmula Real do Excel)
    row.getCell(9).value = {
      formula: `IF(COUNT(D${r}:G${r})<2, 0, ROUND(LOOKUP(999, D${r}:G${r}) - D${r}, 1))`,
      result: st.diff
    };

    // Tendência Anual (Fórmula Real do Excel)
    row.getCell(10).value = {
      formula: `IF(COUNT(D${r}:G${r})<2, "Sem dados", IF(I${r}>0.5, "Evolutivo", IF(I${r}<-0.5, "Em Queda", "Estável")))`,
      result: st.trend
    };

    // Diagnóstico Pedagógico (Fórmula Real do Excel)
    row.getCell(11).value = {
      formula: `IF(COUNT(D${r}:G${r})=0, "Sem avaliações", IF(H${r}>=6, "Rendimento Adequado", IF(H${r}>=5, "Alerta / No Corte", "Abaixo do Corte")))`,
      result: (st.annualAverage ?? 0) >= 6 ? 'Rendimento Adequado' : (st.annualAverage ?? 0) >= 5 ? 'Alerta / No Corte' : 'Abaixo do Corte'
    };

    // Presenças e Faltas
    const pres = st.totalPresences ?? (st.attendanceRate !== null && st.attendanceRate !== undefined ? Math.round((st.attendanceRate / 100) * 80) : 80);
    const falt = st.totalAbsences ?? (st.attendanceRate !== null && st.attendanceRate !== undefined ? Math.round(((100 - st.attendanceRate) / 100) * 80) : 0);
    row.getCell(12).value = pres;
    row.getCell(13).value = falt;

    // Frequência % com FÓRMULA REAL DO EXCEL vinculada às células de Presenças (L) e Faltas (M)
    row.getCell(14).value = {
      formula: `IF((L${r}+M${r})>0, ROUND(L${r}/(L${r}+M${r}), 3), 1)`,
      result: (pres + falt) > 0 ? pres / (pres + falt) : 1
    };
    row.getCell(14).numFmt = '0.0%';

    // Estilos das Células
    const isEven = idx % 2 === 1;
    const bgArgb = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

    for (let c = 1; c <= 14; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (c === 1 || c === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c >= 4 && c <= 8) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (typeof cell.value === 'number' || (typeof cell.value === 'object' && cell.value !== null)) {
          cell.numFmt = '0.0';
        }
      } else if (c === 9) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '+0.0;-0.0;0.0';
      } else if (c >= 10 && c <= 11) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 12 || c === 13) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '#,##0';
      } else if (c === 14) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }
  });

  const lastDataRow = startRow + studentsTrajectory.length - 1;

  // Linha MÉDIA GERAL DA TURMA com Fórmulas
  const avgRowIdx = lastDataRow + 2;
  const avgRow = ws.getRow(avgRowIdx);
  avgRow.height = 24;
  ws.mergeCells(avgRowIdx, 1, avgRowIdx, 3);
  avgRow.getCell(1).value = 'MÉDIA GERAL DA TURMA:';
  avgRow.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF1E1B4B' } };
  avgRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };

  for (let b = 1; b <= 4; b++) {
    const colLetter = String.fromCharCode(67 + b); // D, E, F, G
    const cell = avgRow.getCell(3 + b);
    cell.value = {
      formula: `ROUND(AVERAGE(${colLetter}${startRow}:${colLetter}${lastDataRow}), 1)`,
      result: classBimAverages ? classBimAverages[b - 1] ?? undefined : undefined
    };
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F766E' } };
    cell.numFmt = '0.0';
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Média Geral da Turma (Coluna H)
  const cellH = avgRow.getCell(8);
  cellH.value = {
    formula: `ROUND(AVERAGE(H${startRow}:H${lastDataRow}), 1)`,
    result: classOverallAverage ?? undefined
  };
  cellH.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF4338CA' } };
  cellH.numFmt = '0.0';
  cellH.alignment = { vertical: 'middle', horizontal: 'center' };

  // Média de Presenças (Coluna L)
  const cellL = avgRow.getCell(12);
  cellL.value = {
    formula: `ROUND(AVERAGE(L${startRow}:L${lastDataRow}), 0)`,
    result: undefined
  };
  cellL.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };
  cellL.numFmt = '#,##0';
  cellL.alignment = { vertical: 'middle', horizontal: 'center' };

  // Total de Faltas (Coluna M)
  const cellM = avgRow.getCell(13);
  cellM.value = {
    formula: `SUM(M${startRow}:M${lastDataRow})`,
    result: undefined
  };
  cellM.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
  cellM.numFmt = '#,##0';
  cellM.alignment = { vertical: 'middle', horizontal: 'center' };

  // Média Geral de Frequência (Coluna N)
  const cellN = avgRow.getCell(14);
  cellN.value = {
    formula: `AVERAGE(N${startRow}:N${lastDataRow})`,
    result: undefined
  };
  cellN.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0D9488' } };
  cellN.numFmt = '0.0%';
  cellN.alignment = { vertical: 'middle', horizontal: 'center' };

  for (let c = 1; c <= 14; c++) {
    const cell = avgRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  }

  // Bloco de Resumo Pedagógico com Fórmulas (KPIs)
  const kpiStart = avgRowIdx + 2;
  ws.mergeCells(kpiStart, 2, kpiStart, 7);
  const kpiHeader = ws.getCell(kpiStart, 2);
  kpiHeader.value = 'RESUMO PEDAGÓGICO E INDICADORES DA TURMA';
  kpiHeader.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  kpiHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
  kpiHeader.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(kpiStart).height = 24;

  const kpis = [
    { label: 'Total de Alunos Matriculados:', formula: `COUNTA(B${startRow}:B${lastDataRow})`, result: studentsTrajectory.length, numFmt: '#,##0' },
    { label: 'Média Anual Geral da Turma:', formula: `ROUND(AVERAGE(H${startRow}:H${lastDataRow}), 1)`, result: classOverallAverage ?? 0, numFmt: '0.0' },
    { label: 'Alunos com Trajetória Evolutiva (↗️):', formula: `COUNTIF(J${startRow}:J${lastDataRow}, "Evolutivo*")`, result: studentsTrajectory.filter(s => s.trend === 'Evolutivo').length, numFmt: '#,##0' },
    { label: 'Alunos com Trajetória Estável (➡️):', formula: `COUNTIF(J${startRow}:J${lastDataRow}, "Estável*")`, result: studentsTrajectory.filter(s => s.trend === 'Estável').length, numFmt: '#,##0' },
    { label: 'Alunos com Trajetória Em Queda (↘️):', formula: `COUNTIF(J${startRow}:J${lastDataRow}, "Em Queda*")`, result: studentsTrajectory.filter(s => s.trend === 'Em Queda').length, numFmt: '#,##0' },
    { label: 'Alunos com Rendimento Adequado (≥ 6.0):', formula: `COUNTIF(H${startRow}:H${lastDataRow}, ">=6")`, result: studentsTrajectory.filter(s => (s.annualAverage || 0) >= 6.0).length, numFmt: '#,##0' },
    { label: 'Alunos com Média Abaixo do Corte (< 5.0) (⚠️):', formula: `COUNTIF(H${startRow}:H${lastDataRow}, "<5")`, result: studentsTrajectory.filter(s => (s.annualAverage || 0) < 5.0 && s.annualAverage !== null).length, numFmt: '#,##0' },
    { label: 'Taxa Média de Frequência Escolar (%):', formula: `AVERAGE(N${startRow}:N${lastDataRow})`, result: 0.95, numFmt: '0.0%' },
    { label: 'Total de Faltas Registradas na Turma:', formula: `SUM(M${startRow}:M${lastDataRow})`, result: 0, numFmt: '#,##0' }
  ];

  kpis.forEach((kpi, kIdx) => {
    const r = kpiStart + 1 + kIdx;
    ws.mergeCells(r, 2, r, 5);
    const lCell = ws.getCell(r, 2);
    lCell.value = kpi.label;
    lCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
    lCell.alignment = { vertical: 'middle', horizontal: 'left' };
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kIdx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
    lCell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    const vCell = ws.getCell(r, 6);
    vCell.value = { formula: kpi.formula, result: kpi.result };
    vCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF1E1B4B' } };
    vCell.alignment = { vertical: 'middle', horizontal: 'center' };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kIdx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
    if (kpi.numFmt) vCell.numFmt = kpi.numFmt;
    vCell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    ws.getRow(r).height = 20;
  });

  // --- GRÁFICO DA TURMA COMPLETA EMBUTIDO NO EXCEL ---
  const chartSectionRow = kpiStart + kpis.length + 3;
  ws.mergeCells(chartSectionRow, 2, chartSectionRow, 14);
  const chartTitleCell = ws.getCell(chartSectionRow, 2);
  chartTitleCell.value = 'GRÁFICO OFICIAL DE EVOLUÇÃO E TRAJETÓRIA ESCOLAR DA TURMA (1º AO 4º BIMESTRE)';
  chartTitleCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  chartTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
  chartTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(chartSectionRow).height = 26;

  if (effectiveChartPng) {
    const imgId = workbook.addImage({
      base64: effectiveChartPng,
      extension: 'png'
    });

    // 1. Embutir logo abaixo do resumo na aba principal (Visível imediatamente sem rolar tabs)
    ws.addImage(imgId, {
      tl: { col: 1, row: chartSectionRow },
      ext: { width: 920, height: 468 }
    });

    // 2. Aba dedicada: 📈 Gráfico da Turma (Formato paisagem completo)
    const wsChart = workbook.addWorksheet('📈 Gráfico da Turma', {
      views: [{ showGridLines: false }]
    });

    wsChart.mergeCells(1, 1, 1, 16);
    const cTitle = wsChart.getCell(1, 1);
    cTitle.value = `GRÁFICO DE EVOLUÇÃO E TRAJETÓRIA ESCOLAR - ${turma?.year || ''}º ${turma?.letter || ''} (${currentYear})`;
    cTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    cTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
    cTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    wsChart.getRow(1).height = 32;

    wsChart.addImage(imgId, {
      tl: { col: 1, row: 3 },
      ext: { width: 980, height: 498 }
    });
  }

  // Gravar buffer e acionar download direto
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = `trajetoria_evolucao_turma_${turma ? `${turma.year}${turma.letter}` : ''}_formulas_grafico.xlsx`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 1.4 Evolução Individual e da Turma XLSX (Com Fórmulas Dinâmicas e Gráficos)
export async function generateStudentEvolutionReportXLSX(
  classId: string,
  studentId: string | null,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  // Mapeia todas as notas por aluno e bimestre
  const trajectoryItems: TrajectoryReportStudentItem[] = targetStudents.map((student: any) => {
    const grades: (number | null)[] = [null, null, null, null];
    for (let b = 1; b <= 4; b++) {
      let bSum = 0, bCnt = 0;
      Object.keys(notasVal).forEach((k) => {
        const g = notasVal[k];
        if (
          g.classId === classId &&
          (!g.anoLetivo || g.anoLetivo === currentYear) &&
          String(g.bimester) === String(b) &&
          g.studentId === student.id
        ) {
          const val = parseFloat(g.value);
          if (!isNaN(val)) {
            bSum += val;
            bCnt++;
          }
        }
      });
      if (bCnt > 0) grades[b - 1] = parseFloat((bSum / bCnt).toFixed(1));
    }

    const validGrades = grades.filter((g) => g !== null) as number[];
    let diff = 0;
    let trend = 'Sem dados';
    let annualAverage: number | null = null;

    if (validGrades.length > 0) {
      annualAverage = parseFloat((validGrades.reduce((acc, v) => acc + v, 0) / validGrades.length).toFixed(1));
    }

    if (validGrades.length >= 2) {
      diff = parseFloat((validGrades[validGrades.length - 1] - validGrades[0]).toFixed(1));
      if (diff > 0.5) trend = 'Evolutivo';
      else if (diff < -0.5) trend = 'Em Queda';
      else trend = 'Estável';
    }

    // Frequência
    let presences = 0;
    let absences = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === student.id && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (att.present) presences++;
        else absences++;
      }
    });
    const totalAulas = presences + absences;
    const attRate = totalAulas > 0 ? (presences / totalAulas) * 100 : null;

    return {
      student: {
        id: student.id,
        name: student.name,
        number: student.number,
        ra: student.ra,
        status: student.status
      },
      grades,
      annualAverage,
      trend,
      diff,
      attendanceRate: attRate,
      totalPresences: presences,
      totalAbsences: absences
    };
  });

  // Médias da turma
  const classBimAverages: (number | null)[] = [null, null, null, null];
  for (let b = 1; b <= 4; b++) {
    const validBim = trajectoryItems.map((st) => st.grades[b - 1]).filter((g): g is number => g !== null);
    if (validBim.length > 0) {
      classBimAverages[b - 1] = parseFloat((validBim.reduce((a, c) => a + c, 0) / validBim.length).toFixed(1));
    }
  }
  const allAvgs = trajectoryItems.map((st) => st.annualAverage).filter((a): a is number => a !== null);
  const classOverallAverage = allAvgs.length > 0 ? parseFloat((allAvgs.reduce((a, c) => a + c, 0) / allAvgs.length).toFixed(1)) : null;

  await generateClassTrajectoryXLSX({
    turma,
    teacherName: teacher,
    currentYear,
    selectedSubjectName: 'Média Geral (Todas as Matérias)',
    studentsTrajectory: trajectoryItems,
    classOverallAverage,
    classBimAverages
  });
}

// 1.5 Comparativo entre Turmas PDF
export async function generateClassesComparisonReport(currentYear: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPARATIVO ENTRE TURMAS', 105, 15, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Ano Letivo: ${currentYear}`, 14, 25);

  const turmasList = await carregarMinhasTurmas();
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};

  const tableData: any[] = [];

  for (const t of turmasList) {
    const classId = t.id;
    const turma = t.val;
    if (turma.anoLetivo && turma.anoLetivo !== currentYear) continue;

    const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
    const studentsVal = snap.val() || {};
    const studentCount = Object.keys(studentsVal).length;

    let gradeSum = 0, gradeCount = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          gradeSum += val;
          gradeCount++;
        }
      }
    });

    let pCount = 0, fCount = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const c = chamadaVal[k];
      if (c.classId === classId && (!c.anoLetivo || c.anoLetivo === currentYear)) {
        if (c.status === 'P') pCount++;
        else if (c.status === 'F') fCount++;
      }
    });

    const avgGrade = gradeCount > 0 ? (gradeSum / gradeCount).toFixed(1) : '-';
    const totalAtt = pCount + fCount;
    const freqPct = totalAtt > 0 ? `${((pCount / totalAtt) * 100).toFixed(1)}%` : '-';

    tableData.push([
      turma.schoolName,
      `${turma.year}º ${turma.letter} (${turma.shift})`,
      studentCount,
      avgGrade,
      freqPct
    ]);
  }

  autoTable(doc, {
    startY: 32,
    head: [['Escola', 'Turma', 'Alunos', 'Média de Notas', '% Frequência']],
    body: tableData.length > 0 ? tableData : [['Nenhuma turma cadastrada no ano letivo.', '-', '-', '-', '-']],
    theme: 'grid'
  });

  doc.save(`comparativo_turmas_${currentYear}.pdf`);
}

// 1.5 Comparativo entre Turmas XLSX
export async function generateClassesComparisonReportXLSX(currentYear: string) {
  const turmasList = await carregarMinhasTurmas();
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};

  const columns: ExcelColumnDef[] = [
    { header: 'Escola', key: 'escola', width: 35 },
    { header: 'Turma', key: 'turma', width: 22, align: 'center' },
    { header: 'Qtd Alunos', key: 'alunos', width: 14, align: 'center' },
    { header: 'Média de Notas', key: 'media', width: 16, align: 'center', numFmt: '0.0' },
    { header: '% Frequência', key: 'freq', width: 16, align: 'center' }
  ];

  const rows: any[] = [];

  for (const t of turmasList) {
    const classId = t.id;
    const turma = t.val;
    if (turma.anoLetivo && turma.anoLetivo !== currentYear) continue;

    const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
    const studentsVal = snap.val() || {};
    const studentCount = Object.keys(studentsVal).length;

    let gradeSum = 0, gradeCount = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          gradeSum += val;
          gradeCount++;
        }
      }
    });

    let pCount = 0, fCount = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const c = chamadaVal[k];
      if (c.classId === classId && (!c.anoLetivo || c.anoLetivo === currentYear)) {
        if (c.status === 'P') pCount++;
        else if (c.status === 'F') fCount++;
      }
    });

    const avgGrade = gradeCount > 0 ? parseFloat((gradeSum / gradeCount).toFixed(1)) : '-';
    const totalAtt = pCount + fCount;
    const freqPct = totalAtt > 0 ? `${((pCount / totalAtt) * 100).toFixed(1)}%` : '-';

    rows.push({
      escola: turma.schoolName,
      turma: `${turma.year}º ${turma.letter} (${turma.shift})`,
      alunos: studentCount,
      media: avgGrade,
      freq: freqPct
    });
  }

  await exportToExcelJS({
    title: `QUADRO COMPARATIVO ENTRE TURMAS - ${currentYear}`,
    turma: null,
    year: currentYear,
    sheetName: 'Comparativo',
    columns,
    rows,
    emptyMessage: 'Nenhuma turma cadastrada no ano letivo.',
    filename: `comparativo_turmas_${currentYear}.xlsx`
  });
}

// ----------------------------------------------------
// TAB 2: FREQUÊNCIA
// ----------------------------------------------------

export async function generateAttendanceReport(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  teacher: string,
  currentYear: string,
  showRA = true,
  showAbsencePct = true,
  showStatus = true,
  includeTransfers = false
) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `ATA DE FREQUÊNCIA - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => (!s.anoLetivo || s.anoLetivo === currentYear) && (includeTransfers || (s.status !== 'expedida' && s.transferType !== 'saida')))
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const tableData: any[] = [];

  sortedStudents.forEach((student: any) => {
    const inDate = student.transferInDate || (student.status === 'recebida' ? student.transferDate : '');
    const outDate = student.transferOutDate || (student.status === 'expedida' ? student.transferDate : '');
    const isTransferredInAfter = isStudentTransferredInAfterBimester(student, bimester);
    const isTransferredOutBefore = isStudentTransferredOutBeforeBimester(student, bimester);

    let p = 0, f = 0;
    Object.keys(attVal).forEach((k) => {
      const a = attVal[k];
      if (
        a.classId === classId &&
        String(a.bimester) === String(bimester) &&
        a.studentId === student.id &&
        (!a.anoLetivo || a.anoLetivo === currentYear)
      ) {
        // Se a data da chamada for anterior ao ingresso do aluno, ignora
        if (inDate && a.date && a.date < inDate) return;
        // Se a data da chamada for posterior à saída do aluno, ignora
        if (outDate && a.date && a.date > outDate) return;

        if (a.status === 'P') p++;
        else if (a.status === 'F') f++;
      }
    });

    let total = p + f;
    let pct = total > 0 ? `${((p / total) * 100).toFixed(1)}%` : '-';
    let situacao = 'Regular';

    if (isTransferredInAfter) {
      situacao = inDate ? `Não Matriculado (Entrada: ${formatDate(inDate)})` : 'Não Matriculado';
      pct = '-';
      p = 0;
      f = 0;
      total = 0;
    } else if (isTransferredOutBefore || student.status === 'expedida') {
      situacao = 'TR. EXP.';
    } else if (student.status === 'recebida') {
      situacao = total > 0 && (p / total) < 0.75 ? 'Risco (<75%)' : 'Regular (TR. REC.)';
    } else if (total > 0 && (p / total) < 0.75) {
      situacao = 'Risco (<75%)';
    }

    const studentName = student.name + formatStudentTransferTag(student, true);
    const row: any[] = [
      student.number || '-',
      studentName
    ];
    if (showRA) {
      row.push(student.ra || '-');
    }
    row.push(
      isTransferredInAfter ? '-' : p,
      isTransferredInAfter ? '-' : f,
      isTransferredInAfter ? '-' : total,
      pct
    );
    if (showAbsencePct) {
      const absPct = total > 0 ? `${((f / total) * 100).toFixed(1)}%` : '-';
      row.push(absPct);
    }
    if (showStatus) {
      row.push(situacao);
    }
    tableData.push(row);
  });

  const head: string[] = ['Nº', 'Aluno'];
  if (showRA) head.push('RA');
  head.push('Presenças', 'Faltas', 'Total Aulas', '% Freq');
  if (showAbsencePct) head.push('% Ausência');
  if (showStatus) head.push('Situação');

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 10, halign: 'center' }, // Nº
    1: { halign: 'left' } // Aluno (dinâmico)
  };
  let colIdx = 2;
  if (showRA) {
    columnStyles[colIdx] = { cellWidth: 26, halign: 'center' };
    colIdx++;
  }
  columnStyles[colIdx] = { cellWidth: 18, halign: 'center' }; colIdx++; // Presenças
  columnStyles[colIdx] = { cellWidth: 16, halign: 'center' }; colIdx++; // Faltas
  columnStyles[colIdx] = { cellWidth: 18, halign: 'center' }; colIdx++; // Total Aulas
  columnStyles[colIdx] = { cellWidth: 18, halign: 'center' }; colIdx++; // % Freq
  if (showAbsencePct) {
    columnStyles[colIdx] = { cellWidth: 18, halign: 'center' }; colIdx++; // % Ausência
  }
  if (showStatus) {
    columnStyles[colIdx] = { cellWidth: 22, halign: 'center' }; colIdx++; // Situação
  }

  const emptyRow: any[] = ['-', 'Nenhum aluno cadastrado na turma.'];
  if (showRA) emptyRow.push('-');
  emptyRow.push('-', '-', '-', '-');
  if (showAbsencePct) emptyRow.push('-');
  if (showStatus) emptyRow.push('-');

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [head],
    body: tableData.length > 0 ? tableData : [emptyRow],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles
  });

  doc.save(`frequencia_${bimester}bim_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateAttendanceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string,
  showRA = true,
  showAbsencePct = true,
  showStatus = true,
  includeTransfers = false
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 }
  ];
  if (showRA) {
    columns.push({ header: 'RA', key: 'ra', width: 16, align: 'center' });
  }
  columns.push(
    { header: 'Presenças', key: 'p', width: 14, align: 'center' },
    { header: 'Faltas', key: 'f', width: 12, align: 'center' },
    { header: 'Total Aulas', key: 'total', width: 14, align: 'center' },
    { header: '% Frequência', key: 'pct', width: 16, align: 'center' }
  );
  if (showAbsencePct) {
    columns.push({ header: '% Ausência', key: 'absPct', width: 16, align: 'center' });
  }
  if (showStatus) {
    columns.push({ header: 'Situação', key: 'sit', width: 18, align: 'center' });
  }

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => (!s.anoLetivo || s.anoLetivo === currentYear) && (includeTransfers || (s.status !== 'expedida' && s.transferType !== 'saida')))
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows: any[] = [];

  sortedStudents.forEach((student: any) => {
    const inDate = student.transferInDate || (student.status === 'recebida' ? student.transferDate : '');
    const outDate = student.transferOutDate || (student.status === 'expedida' ? student.transferDate : '');
    const isTransferredInAfter = isStudentTransferredInAfterBimester(student, bimester);
    const isTransferredOutBefore = isStudentTransferredOutBeforeBimester(student, bimester);

    let p = 0, f = 0;
    Object.keys(attVal).forEach((k) => {
      const a = attVal[k];
      if (
        a.classId === classId &&
        String(a.bimester) === String(bimester) &&
        a.studentId === student.id &&
        (!a.anoLetivo || a.anoLetivo === currentYear)
      ) {
        // Se a data da chamada for anterior ao ingresso do aluno, ignora
        if (inDate && a.date && a.date < inDate) return;
        // Se a data da chamada for posterior à saída do aluno, ignora
        if (outDate && a.date && a.date > outDate) return;

        if (a.status === 'P') p++;
        else if (a.status === 'F') f++;
      }
    });

    let total = p + f;
    let pct: any = total > 0 ? `${((p / total) * 100).toFixed(1)}%` : '-';
    let sit = 'Regular';

    if (isTransferredInAfter) {
      sit = inDate ? `Não Matriculado (Entrada: ${formatDate(inDate)})` : 'Não Matriculado';
      pct = '-';
      p = 0;
      f = 0;
      total = 0;
    } else if (isTransferredOutBefore || student.status === 'expedida') {
      sit = 'TR. EXP.';
    } else if (student.status === 'recebida') {
      sit = total > 0 && (p / total) < 0.75 ? 'Risco (<75%)' : 'Regular (TR. REC.)';
    } else if (total > 0 && (p / total) < 0.75) {
      sit = 'Risco (<75%)';
    }

    const studentName = student.name + formatStudentTransferTag(student, false);
    const rowObj: any = {
      number: student.number || '-',
      name: studentName,
      p: isTransferredInAfter ? '-' : p,
      f: isTransferredInAfter ? '-' : f,
      total: isTransferredInAfter ? '-' : total,
      pct
    };
    if (showRA) {
      rowObj.ra = student.ra || '-';
    }
    if (showAbsencePct) {
      rowObj.absPct = total > 0 ? `${((f / total) * 100).toFixed(1)}%` : '-';
    }
    if (showStatus) {
      rowObj.sit = sit;
    }

    rows.push(rowObj);
  });

  await exportToExcelJS({
    title: `ATA DE FREQUÊNCIA ESCOLAR - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Frequência',
    columns,
    rows,
    emptyMessage: 'Nenhum aluno cadastrado na turma.',
    filename: `frequencia_${bimester}bim.xlsx`
  });
}

/**
 * Mapa de Frequência Diária (Grade Dia a Dia / Diário de Classe em PDF)
 * Apresenta a chamada diária detalhada com colunas para cada dia em que houve aula.
 */
export async function generateDailyAttendanceReport(
  classId: string,
  bimester: string | number,
  turma: ClassRoom,
  teacher: string,
  currentYear: string
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const startY = addPDFHeader(doc, `MAPA DE FREQUÊNCIA DIA A DIA - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  // 1. Extrair todas as datas distintas deste bimestre
  const datesSet = new Set<string>();
  Object.keys(attVal).forEach((k) => {
    const a = attVal[k];
    if (
      a.classId === classId &&
      String(a.bimester) === String(bimester) &&
      (!a.anoLetivo || a.anoLetivo === currentYear) &&
      a.date
    ) {
      datesSet.add(a.date);
    }
  });

  const sortedDates = Array.from(datesSet).sort();

  if (sortedDates.length === 0) {
    throw new Error(`Nenhuma chamada registrada no ${bimester}º bimestre para esta turma.`);
  }

  // 2. Montar cabeçalho
  const headRow: string[] = ['Nº', 'Aluno'];
  sortedDates.forEach((d) => {
    const parts = d.split('-');
    headRow.push(`${parts[2]}/${parts[1]}`);
  });
  headRow.push('P', 'F', '%');

  // 3. Montar linhas dos alunos
  const tableData: any[] = [];
  const dailyPresencesCount: Record<string, number> = {};
  sortedDates.forEach((d) => (dailyPresencesCount[d] = 0));

  sortedStudents.forEach((student: any) => {
    const row: any[] = [
      student.number || '-',
      student.name + formatStudentTransferTag(student, false)
    ];

    let p = 0;
    let f = 0;

    sortedDates.forEach((d) => {
      const enrollment = isStudentEnrolledOnDate(student, d);
      if (!enrollment.enrolled) {
        row.push('-');
        return;
      }

      let st: string = '-';
      Object.keys(attVal).forEach((k) => {
        const a = attVal[k];
        if (
          a.classId === classId &&
          a.date === d &&
          a.studentId === student.id &&
          String(a.bimester) === String(bimester) &&
          (!a.anoLetivo || a.anoLetivo === currentYear)
        ) {
          st = a.status || '-';
        }
      });

      if (st === 'P') {
        p++;
        dailyPresencesCount[d] = (dailyPresencesCount[d] || 0) + 1;
      } else if (st === 'F') {
        f++;
      }

      row.push(st);
    });

    const total = p + f;
    const pct = total > 0 ? `${((p / total) * 100).toFixed(0)}%` : '-';
    row.push(p, f, pct);
    tableData.push(row);
  });

  // Linha de total de presentes
  const footerRow: any[] = ['-', 'Total Presentes'];
  sortedDates.forEach((d) => {
    footerRow.push(dailyPresencesCount[d] || 0);
  });
  footerRow.push('-', '-', '-');
  tableData.push(footerRow);

  autoTable(doc, {
    startY,
    head: [headRow],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'center' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 42, halign: 'left' }
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index >= 2 && data.column.index < 2 + sortedDates.length) {
        if (data.cell.raw === 'P') {
          data.cell.styles.textColor = [16, 185, 129];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.cell.raw === 'F') {
          data.cell.styles.textColor = [239, 68, 68];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.cell.raw === '-') {
          data.cell.styles.textColor = [148, 163, 184];
        }
      }
    }
  });

  doc.save(`mapa_frequencia_dia_a_dia_${turma.year}${turma.letter}_bim${bimester}_${currentYear}.pdf`);
}

/**
 * Mapa de Frequência Diária (Grade Dia a Dia / Diário de Classe em Excel)
 */
export async function generateDailyAttendanceReportXLSX(
  classId: string,
  bimester: string | number,
  turma: ClassRoom,
  currentYear: string,
  teacher: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const datesSet = new Set<string>();
  Object.keys(attVal).forEach((k) => {
    const a = attVal[k];
    if (
      a.classId === classId &&
      String(a.bimester) === String(bimester) &&
      (!a.anoLetivo || a.anoLetivo === currentYear) &&
      a.date
    ) {
      datesSet.add(a.date);
    }
  });

  const sortedDates = Array.from(datesSet).sort();

  if (sortedDates.length === 0) {
    throw new Error(`Nenhuma chamada registrada no ${bimester}º bimestre para esta turma.`);
  }

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 6, align: 'center' },
    { header: 'Aluno', key: 'name', width: 32, align: 'left' }
  ];

  sortedDates.forEach((d) => {
    const parts = d.split('-');
    columns.push({
      header: `${parts[2]}/${parts[1]}`,
      key: `date_${d}`,
      width: 7,
      align: 'center'
    });
  });

  columns.push(
    { header: 'Presenças', key: 'p', width: 10, align: 'center' },
    { header: 'Faltas', key: 'f', width: 10, align: 'center' },
    { header: '% Freq', key: 'pct', width: 10, align: 'center' }
  );

  const rows: any[] = [];

  sortedStudents.forEach((student: any) => {
    const rowObj: any = {
      number: student.number || '-',
      name: student.name + formatStudentTransferTag(student, false)
    };

    let p = 0;
    let f = 0;

    sortedDates.forEach((d) => {
      const enrollment = isStudentEnrolledOnDate(student, d);
      if (!enrollment.enrolled) {
        rowObj[`date_${d}`] = '-';
        return;
      }

      let st: string = '-';
      Object.keys(attVal).forEach((k) => {
        const a = attVal[k];
        if (
          a.classId === classId &&
          a.date === d &&
          a.studentId === student.id &&
          String(a.bimester) === String(bimester) &&
          (!a.anoLetivo || a.anoLetivo === currentYear)
        ) {
          st = a.status || '-';
        }
      });

      if (st === 'P') p++;
      else if (st === 'F') f++;

      rowObj[`date_${d}`] = st;
    });

    const total = p + f;
    const pct = total > 0 ? `${((p / total) * 100).toFixed(0)}%` : '-';
    rowObj.p = p;
    rowObj.f = f;
    rowObj.pct = pct;

    rows.push(rowObj);
  });

  await exportToExcelJS({
    title: `MAPA DE FREQUÊNCIA DIA A DIA - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Frequência Diária',
    columns,
    rows,
    emptyMessage: 'Nenhuma chamada registrada no bimestre.',
    filename: `mapa_frequencia_dia_a_dia_${turma.year}${turma.letter}_bim${bimester}.xlsx`
  });
}

export async function generateAbsenceReport(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  teacher: string,
  currentYear: string,
  showRA = true,
  showAbsencePct = true,
  showStatus = true,
  includeTransfers = false
) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `RANKING DE FALTAS / ABSENTEÍSMO - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const list = Object.keys(studentsVal)
    .map((k) => {
      const s = studentsVal[k];
      let p = 0, f = 0;
      Object.keys(attVal).forEach((ak) => {
        const a = attVal[ak];
        if (
          a.classId === classId &&
          String(a.bimester) === String(bimester) &&
          a.studentId === k &&
          (!a.anoLetivo || a.anoLetivo === currentYear)
        ) {
          if (a.status === 'P') p++;
          else if (a.status === 'F') f++;
        }
      });
      const total = p + f;
      const pct = total > 0 ? (f / total) * 100 : 0;
      return { ...s, id: k, p, f, total, pct };
    })
    .filter((s) => (!s.anoLetivo || s.anoLetivo === currentYear) && (includeTransfers || (s.status !== 'expedida' && s.transferType !== 'saida')))
    .sort((a, b) => b.f - a.f);

  const tableData = list.map((s, idx) => {
    const studentName = s.name + formatStudentTransferTag(s, true);
    const row: any[] = [
      `${idx + 1}º`,
      s.number || '-',
      studentName
    ];
    if (showRA) {
      row.push(s.ra || '-');
    }
    row.push(s.f);
    if (showAbsencePct) {
      row.push(`${s.pct.toFixed(1)}%`);
    }
    if (showStatus) {
      row.push(s.status === 'expedida' ? 'TR. EXP.' : (s.pct > 25 ? 'CRÍTICO' : 'NORMAL'));
    }
    return row;
  });

  const head: string[] = ['Posição', 'Nº', 'Aluno'];
  if (showRA) head.push('RA');
  head.push('Total Faltas');
  if (showAbsencePct) head.push('% de Ausência');
  if (showStatus) head.push('Status');

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 16, halign: 'center' }, // Posição
    1: { cellWidth: 10, halign: 'center' }, // Nº (número da chamada)
    2: { halign: 'left' } // Aluno (dinâmico)
  };
  let colIdx = 3;
  if (showRA) {
    columnStyles[colIdx] = { cellWidth: 26, halign: 'center' };
    colIdx++;
  }
  columnStyles[colIdx] = { cellWidth: 24, halign: 'center' }; // Total Faltas
  colIdx++;
  if (showAbsencePct) {
    columnStyles[colIdx] = { cellWidth: 24, halign: 'center' }; // % Ausência
    colIdx++;
  }
  if (showStatus) {
    columnStyles[colIdx] = { cellWidth: 22, halign: 'center' }; // Status
    colIdx++;
  }

  const emptyRow: any[] = ['-', '-', 'Nenhum registro de falta no período.'];
  if (showRA) emptyRow.push('-');
  emptyRow.push('-');
  if (showAbsencePct) emptyRow.push('-');
  if (showStatus) emptyRow.push('-');

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [head],
    body: tableData.length > 0 ? tableData : [emptyRow],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles
  });

  doc.save(`ranking_faltas_${bimester}bim.pdf`);
}

export async function generateAbsenceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string,
  showRA = true,
  showAbsencePct = true,
  showStatus = true,
  includeTransfers = false
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const columns: ExcelColumnDef[] = [
    { header: 'Posição', key: 'pos', width: 10, align: 'center' },
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 }
  ];
  if (showRA) {
    columns.push({ header: 'RA', key: 'ra', width: 16, align: 'center' });
  }
  columns.push({ header: 'Total Faltas', key: 'f', width: 14, align: 'center' });
  if (showAbsencePct) {
    columns.push({ header: '% Ausência', key: 'pct', width: 16, align: 'center' });
  }
  if (showStatus) {
    columns.push({ header: 'Status', key: 'status', width: 18, align: 'center' });
  }

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const list = Object.keys(studentsVal)
    .map((k) => {
      const s = studentsVal[k];
      let p = 0, f = 0;
      Object.keys(attVal).forEach((ak) => {
        const a = attVal[ak];
        if (
          a.classId === classId &&
          String(a.bimester) === String(bimester) &&
          a.studentId === k &&
          (!a.anoLetivo || a.anoLetivo === currentYear)
        ) {
          if (a.status === 'P') p++;
          else if (a.status === 'F') f++;
        }
      });
      const total = p + f;
      const pct = total > 0 ? (f / total) * 100 : 0;
      return { ...s, id: k, p, f, total, pct };
    })
    .filter((s) => (!s.anoLetivo || s.anoLetivo === currentYear) && (includeTransfers || (s.status !== 'expedida' && s.transferType !== 'saida')))
    .sort((a, b) => b.f - a.f);

  const rows = list.map((s, idx) => {
    const studentName = s.name + formatStudentTransferTag(s, false);
    const rowObj: any = {
      pos: `${idx + 1}º`,
      number: s.number || '-',
      name: studentName,
      f: s.f
    };
    if (showRA) {
      rowObj.ra = s.ra || '-';
    }
    if (showAbsencePct) {
      rowObj.pct = `${s.pct.toFixed(1)}%`;
    }
    if (showStatus) {
      rowObj.status = s.status === 'expedida' ? 'TR. EXP.' : (s.pct > 25 ? 'CRÍTICO' : 'NORMAL');
    }
    return rowObj;
  });

  await exportToExcelJS({
    title: `RANKING DE ABSENTEÍSMO - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Ranking Faltas',
    columns,
    rows,
    emptyMessage: 'Nenhum registro de falta no período.',
    filename: `ranking_faltas_${bimester}bim.xlsx`
  });
}

// ----------------------------------------------------
// TAB 3: INDIVIDUAL & SECRETARIA
// ----------------------------------------------------

export async function generateIndividualStudentReport(
  classId: string,
  studentId: string | null,
  turma: ClassRoom,
  teacher: string,
  currentYear: string
) {
  const doc = new jsPDF();
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));
  const eventosSnap = await get(ref(rtdb, dc('eventos')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};
  const eventosVal = eventosSnap.val() || {};
  const subjectsList = await getCurricularSubjects();

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  if (targetStudents.length === 0) {
    const startY = addPDFHeader(doc, 'FICHA INDIVIDUAL DO ALUNO (DOSSIÊ)', turma, teacher, currentYear);
    autoTable(doc, {
      startY: startY + 8,
      body: [['Nenhum aluno selecionado ou cadastrado na turma.']],
      theme: 'plain',
      styles: { fontSize: 10, halign: 'center' }
    });
  }

  targetStudents.forEach((student: any, idx: number) => {
    if (idx > 0) doc.addPage();
    const startY = addPDFHeader(doc, 'FICHA INDIVIDUAL DO ALUNO (DOSSIÊ)', turma, teacher, currentYear);

    // Dados do Aluno
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('1. DADOS CADASTRAIS', 14, startY + 5);

    const cadData = [
      ['Nº de Chamada:', student.number, 'RA:', student.ra],
      ['Nome Completo:', student.name, 'Data Nasc.:', formatDate(student.birthdate)],
      ['Situação:', student.status.toUpperCase(), 'RM:', student.rm || '-']
    ];

    autoTable(doc, {
      startY: startY + 8,
      body: cadData,
      theme: 'plain',
      styles: { fontSize: 9 }
    });

    let y = (doc as any).lastAutoTable.finalY + 8;

    // 2. Notas por Matéria
    doc.text('2. NOTAS POR DISCIPLINA (1º AO 4º BIMESTRE)', 14, y);

    const gradesTable: any[] = [];
    subjectsList.forEach((sub) => {
      const row: any[] = [sub.name];
      let sum = 0, cnt = 0;
      for (let b = 1; b <= 4; b++) {
        let nota = '-';
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            g.studentId === student.id &&
            String(g.bimester) === String(b) &&
            gSub === sub.id &&
            (!g.anoLetivo || g.anoLetivo === currentYear)
          ) {
            const val = parseFloat(g.value);
            if (!isNaN(val)) {
              nota = val.toFixed(1);
              sum += val;
              cnt++;
            }
          }
        });
        row.push(nota);
      }
      row.push(cnt > 0 ? (sum / cnt).toFixed(1) : '-');
      gradesTable.push(row);
    });

    autoTable(doc, {
      startY: y + 4,
      head: [['Disciplina', '1º Bim', '2º Bim', '3º Bim', '4º Bim', 'Média Final']],
      body: gradesTable,
      theme: 'grid',
      styles: { fontSize: 8 }
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // 3. Frequência
    doc.text('3. FREQUÊNCIA ANUAL', 14, y);
    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === student.id && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });
    const total = p + f;
    const pct = total > 0 ? `${((p / total) * 100).toFixed(1)}%` : '-';

    autoTable(doc, {
      startY: y + 4,
      head: [['Total de Presenças', 'Total de Faltas', 'Total de Aulas', '% Frequência Global']],
      body: [[p, f, total, pct]],
      theme: 'grid'
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // 4. Parecer Pedagógico
    doc.text('4. PARECER DESCRITIVO & OBSERVAÇÕES PEDAGÓGICAS', 14, y);
    doc.rect(14, y + 4, 182, 35);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Espaço reservado para anotações do conselho de classe e observações do professor regente.', 16, y + 10);
  });

  doc.save(`ficha_individual_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateIndividualStudentReportXLSX(
  classId: string,
  studentId: string | null,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));
  const subjectsList = await getCurricularSubjects();

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  const blocks: CustomTableBlock[] = [];

  targetStudents.forEach((student: any) => {
    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === student.id && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });
    const totalAtt = p + f;
    const freqPct = totalAtt > 0 ? `${((p / totalAtt) * 100).toFixed(1)}%` : '-';

    const gradeRows: any[] = [];
    subjectsList.forEach((sub) => {
      let sum = 0;
      let cnt = 0;
      const rObj: any = { disciplina: sub.name };
      for (let b = 1; b <= 4; b++) {
        let notaVal: any = '-';
        Object.keys(notasVal).forEach((k) => {
          const g = notasVal[k];
          const gSub = g.subject || 'portugues';
          if (
            g.classId === classId &&
            g.studentId === student.id &&
            String(g.bimester) === String(b) &&
            gSub === sub.id &&
            (!g.anoLetivo || g.anoLetivo === currentYear)
          ) {
            const val = parseFloat(g.value);
            if (!isNaN(val)) {
              notaVal = val;
              sum += val;
              cnt++;
            }
          }
        });
        rObj[`b${b}`] = notaVal;
      }
      rObj.media = cnt > 0 ? parseFloat((sum / cnt).toFixed(1)) : '-';
      gradeRows.push(rObj);
    });

    blocks.push({
      title: `ALUNO: Nº ${student.number} - ${student.name} (RA: ${student.ra || '-'} | Situação: ${student.status.toUpperCase()} | Freq: ${freqPct})`,
      columns: [
        { header: 'Disciplina', key: 'disciplina', width: 28 },
        { header: '1º Bim', key: 'b1', width: 12, align: 'center', numFmt: '0.0' },
        { header: '2º Bim', key: 'b2', width: 12, align: 'center', numFmt: '0.0' },
        { header: '3º Bim', key: 'b3', width: 12, align: 'center', numFmt: '0.0' },
        { header: '4º Bim', key: 'b4', width: 12, align: 'center', numFmt: '0.0' },
        { header: 'Média Final', key: 'media', width: 14, align: 'center', numFmt: '0.0' }
      ],
      rows: gradeRows
    });
  });

  await exportMultiBlockToExcelJS({
    title: `FICHA INDIVIDUAL DO ALUNO (DOSSIÊ) - ${currentYear}`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Dossiê Individual',
    blocks,
    emptyMessage: 'Nenhum aluno selecionado ou cadastrado na turma.',
    filename: `dossie_individual_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

export async function generateAtRiskStudentsReport(classId: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, 'ALUNOS EM RISCO PEDAGÓGICO / BUSCA ATIVA', turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};

  const atRiskList: any[] = [];

  Object.keys(studentsVal).forEach((sid) => {
    const student = studentsVal[sid];
    if (student.status === 'expedida' || (student.anoLetivo && student.anoLetivo !== currentYear)) return;

    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === sid && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });
    const totalAtt = p + f;
    const freqPct = totalAtt > 0 ? (p / totalAtt) * 100 : 100;

    let sum = 0, count = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && g.studentId === sid && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
    });
    const avg = count > 0 ? sum / count : 10;

    if (freqPct < 75 || avg < 5.0) {
      const motivo: string[] = [];
      if (freqPct < 75) motivo.push(`Frequência Crítica (${freqPct.toFixed(1)}%)`);
      if (avg < 5.0) motivo.push(`Média Baixa (${avg.toFixed(1)})`);

      atRiskList.push([
        student.number,
        student.name,
        student.ra,
        motivo.join(' | '),
        freqPct < 75 ? 'Busca Ativa / Notificar Responsáveis' : 'Recuperação Paralela / Reforço'
      ]);
    }
  });

  autoTable(doc, {
    startY,
    head: [['Nº', 'Aluno', 'RA', 'Motivo do Risco', 'Ação Pedagógica Recomendada']],
    body: atRiskList.length > 0 ? atRiskList : [['-', 'Nenhum aluno em situação de risco identificada.', '-', '-', '-']],
    theme: 'grid'
  });

  doc.save(`alunos_em_risco_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateAtRiskStudentsReportXLSX(
  classId: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Motivo do Risco', key: 'motivo', width: 32 },
    { header: 'Ação Pedagógica Sugerida', key: 'acao', width: 38 }
  ];

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};
  const rows: any[] = [];

  Object.keys(studentsVal).forEach((sid) => {
    const student = studentsVal[sid];
    if (student.status === 'expedida' || (student.anoLetivo && student.anoLetivo !== currentYear)) return;

    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === sid && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });
    const totalAtt = p + f;
    const freqPct = totalAtt > 0 ? (p / totalAtt) * 100 : 100;

    let sum = 0, count = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && g.studentId === sid && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
    });
    const avg = count > 0 ? sum / count : 10;

    if (freqPct < 75 || avg < 5.0) {
      const motivo: string[] = [];
      if (freqPct < 75) motivo.push(`Frequência Crítica (${freqPct.toFixed(1)}%)`);
      if (avg < 5.0) motivo.push(`Média Baixa (${avg.toFixed(1)})`);

      rows.push({
        number: student.number,
        name: student.name,
        ra: student.ra || '-',
        motivo: motivo.join(' | '),
        acao: freqPct < 75 ? 'Busca Ativa / Notificar Responsáveis' : 'Recuperação Paralela / Reforço'
      });
    }
  });

  await exportToExcelJS({
    title: `ALUNOS EM RISCO PEDAGÓGICO / BUSCA ATIVA - ${currentYear}`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Risco Pedagógico',
    columns,
    rows,
    emptyMessage: 'Nenhum aluno em situação de risco identificada.',
    filename: `alunos_em_risco_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

export async function generateTransfersReport(classId: string | null, currentYear: string, teacher?: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('RELATÓRIO DE TRANSFERÊNCIAS (ENTRADAS E SAÍDAS)', 105, 15, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Ano Letivo: ${currentYear}${teacher ? ` | Professor(a): ${teacher}` : ''}`, 14, 25);

  const turmasList = await carregarMinhasTurmas();
  const tableData: any[] = [];

  for (const t of turmasList) {
    if (classId && t.id !== classId) continue;
    const snap = await get(ref(rtdb, `diario-classe/turmas/${t.id}/alunos`));
    const studentsVal = snap.val() || {};

    Object.keys(studentsVal).forEach((sid) => {
      const s = studentsVal[sid];
      if ((s.status === 'expedida' || s.status === 'recebida' || s.transferInDate || s.transferOutDate) && (!s.anoLetivo || s.anoLetivo === currentYear)) {
        const inDate = s.transferInDate || (s.status === 'recebida' ? s.transferDate : '');
        const outDate = s.transferOutDate || (s.status === 'expedida' ? s.transferDate : '');
        let tipo = '';
        if (s.status === 'expedida') {
          tipo = inDate ? 'Recebida e Expedida' : 'Expedida (Saída)';
        } else if (s.status === 'recebida') {
          tipo = 'Recebida (Entrada)';
        } else {
          tipo = 'Ativo (Ingresso Transferência)';
        }

        tableData.push([
          `${t.val.year}º ${t.val.letter}`,
          s.number,
          s.name,
          s.ra || '-',
          tipo,
          formatDate(inDate) || '-',
          formatDate(outDate) || '-'
        ]);
      }
    });
  }

  autoTable(doc, {
    startY: 32,
    head: [['Turma', 'Nº', 'Aluno', 'RA', 'Situação', 'Data Entrada (REC)', 'Data Saída (EXP)']],
    body: tableData.length > 0 ? tableData : [['-', '-', 'Nenhuma transferência registrada no período.', '-', '-', '-', '-']],
    theme: 'grid'
  });

  doc.save(`transferencias_${currentYear}.pdf`);
}

export async function generateTransfersReportXLSX(classId: string | null, currentYear: string, teacher?: string) {
  const turmasList = await carregarMinhasTurmas();
  const columns: ExcelColumnDef[] = [
    { header: 'Turma', key: 'turma', width: 14, align: 'center' },
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 36 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Situação / Tipo', key: 'tipo', width: 24, align: 'center' },
    { header: 'Data Entrada (TR. REC.)', key: 'dataEntrada', width: 22, align: 'center' },
    { header: 'Data Saída (TR. EXP.)', key: 'dataSaida', width: 22, align: 'center' }
  ];

  const rows: any[] = [];

  for (const t of turmasList) {
    if (classId && t.id !== classId) continue;
    const snap = await get(ref(rtdb, `diario-classe/turmas/${t.id}/alunos`));
    const studentsVal = snap.val() || {};

    Object.keys(studentsVal).forEach((sid) => {
      const s = studentsVal[sid];
      if ((s.status === 'expedida' || s.status === 'recebida' || s.transferInDate || s.transferOutDate) && (!s.anoLetivo || s.anoLetivo === currentYear)) {
        const inDate = s.transferInDate || (s.status === 'recebida' ? s.transferDate : '');
        const outDate = s.transferOutDate || (s.status === 'expedida' ? s.transferDate : '');
        let tipo = '';
        if (s.status === 'expedida') {
          tipo = inDate ? 'Recebida e Expedida' : 'Expedida (Saída)';
        } else if (s.status === 'recebida') {
          tipo = 'Recebida (Entrada)';
        } else {
          tipo = 'Ativo (Ingresso Transferência)';
        }

        rows.push({
          turma: `${t.val.year}º ${t.val.letter}`,
          number: s.number,
          name: s.name,
          ra: s.ra || '-',
          tipo,
          dataEntrada: formatDate(inDate) || '-',
          dataSaida: formatDate(outDate) || '-'
        });
      }
    });
  }

  await exportToExcelJS({
    title: `RELATÓRIO DE TRANSFERÊNCIAS - ${currentYear}`,
    turma: null,
    teacher,
    year: currentYear,
    sheetName: 'Transferências',
    columns,
    rows,
    emptyMessage: 'Nenhuma transferência registrada no período.',
    filename: `transferencias_${currentYear}.xlsx`
  });
}

// ----------------------------------------------------
// TAB 4: PEDAGÓGICO & BNCC
// ----------------------------------------------------

export async function generateLessonPlanReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF('landscape');
  const startY = addPDFHeader(doc, `DIÁRIO DE CONTEÚDO E AULAS MINISTRADAS - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));
  const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));

  const bnccMap: Record<string, string> = {};
  const bnccVal = bnccSnap.val() || {};
  Object.keys(bnccVal).forEach((k) => { bnccMap[k] = bnccVal[k].code; });

  const catMap: Record<string, string> = {};
  const catVal = catSnap.val() || {};
  Object.keys(catVal).forEach((k) => { catMap[k] = catVal[k].name; });

  const plansVal = plansSnap.val() || {};
  const list = Object.keys(plansVal)
    .map((k) => ({ id: k, ...plansVal[k] }))
    .filter((p) => p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const tableData = list.map((p) => {
    let bnccDisplay = '-';
    if (Array.isArray(p.bnccCodes) && p.bnccCodes.length > 0) {
      bnccDisplay = p.bnccCodes.join(', ');
    } else if (Array.isArray(p.bnccIds) && p.bnccIds.length > 0) {
      bnccDisplay = p.bnccIds.map((id: string) => bnccMap[id] || id).join(', ');
    } else if (p.bnccId) {
      bnccDisplay = bnccMap[p.bnccId] || '-';
    }

    return [
      formatDate(p.date),
      getSubjectName(p.subject),
      catMap[p.categoryId] || 'Geral',
      bnccDisplay,
      p.planned || '-',
      p.given || p.planned || '-',
      p.obs || '-'
    ];
  });

  autoTable(doc, {
    startY,
    head: [['Data', 'Disciplina', 'Categoria', 'BNCC', 'Conteúdo Previsto', 'Conteúdo Realizado', 'Observações']],
    body: tableData.length > 0 ? tableData : [['-', '-', '-', '-', 'Nenhum plano registrado no bimestre.', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8 }
  });

  doc.save(`diario_conteudo_${bimester}bim.pdf`);
}

export async function generateLessonPlanReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));
  const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));

  const bnccMap: Record<string, string> = {};
  const bnccVal = bnccSnap.val() || {};
  Object.keys(bnccVal).forEach((k) => { bnccMap[k] = bnccVal[k].code; });

  const catMap: Record<string, string> = {};
  const catVal = catSnap.val() || {};
  Object.keys(catVal).forEach((k) => { catMap[k] = catVal[k].name; });

  const columns: ExcelColumnDef[] = [
    { header: 'Data', key: 'data', width: 14, align: 'center' },
    { header: 'Disciplina', key: 'disciplina', width: 20 },
    { header: 'Categoria', key: 'categoria', width: 22 },
    { header: 'BNCC', key: 'bncc', width: 16, align: 'center' },
    { header: 'Conteúdo Planejado', key: 'planejado', width: 45 },
    { header: 'Conteúdo Ministrado', key: 'ministrado', width: 45 },
    { header: 'Observações', key: 'obs', width: 30 }
  ];

  const plansVal = plansSnap.val() || {};
  const list = Object.keys(plansVal)
    .map((k) => ({ id: k, ...plansVal[k] }))
    .filter((p) => p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const rows = list.map((p) => {
    let bnccDisplay = '-';
    if (Array.isArray(p.bnccCodes) && p.bnccCodes.length > 0) {
      bnccDisplay = p.bnccCodes.join(', ');
    } else if (Array.isArray(p.bnccIds) && p.bnccIds.length > 0) {
      bnccDisplay = p.bnccIds.map((id: string) => bnccMap[id] || id).join(', ');
    } else if (p.bnccId) {
      bnccDisplay = bnccMap[p.bnccId] || '-';
    }

    return {
      data: formatDate(p.date),
      disciplina: getSubjectName(p.subject),
      categoria: catMap[p.categoryId] || 'Geral',
      bncc: bnccDisplay,
      planejado: p.planned || '-',
      ministrado: p.given || p.planned || '-',
      obs: p.obs || '-'
    };
  });

  await exportToExcelJS({
    title: `DIÁRIO DE CONTEÚDO E AULAS MINISTRADAS - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Diário Conteúdo',
    columns,
    rows,
    emptyMessage: 'Nenhum plano registrado no bimestre.',
    filename: `diario_conteudo_${bimester}bim.xlsx`
  });
}

export async function generateCategoryReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `RELATÓRIO POR CATEGORIA DE ENSINO - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));

  const catMap: Record<string, string> = {};
  const catVal = catSnap.val() || {};
  Object.keys(catVal).forEach((k) => { catMap[k] = catVal[k].name; });

  const catCounts: Record<string, number> = {};
  let total = 0;

  const plansVal = plansSnap.val() || {};
  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      total++;
      const cid = p.categoryId || 'sem_categoria';
      catCounts[cid] = (catCounts[cid] || 0) + 1;
    }
  });

  const tableData: any[] = [];
  Object.keys(catCounts).forEach((cid) => {
    const name = catMap[cid] || (cid === 'sem_categoria' ? 'Sem Categoria' : cid);
    const count = catCounts[cid];
    const pct = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%';
    tableData.push([name, count, pct]);
  });

  autoTable(doc, {
    startY,
    head: [['Categoria de Ensino', 'Total de Aulas', '% do Total']],
    body: tableData.length > 0 ? tableData : [['Nenhuma aula registrada no bimestre.', '0', '0%']],
    theme: 'grid'
  });

  doc.save(`relatorio_categorias_${bimester}bim.pdf`);
}

export async function generateCategoryReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));

  const catMap: Record<string, string> = {};
  const catVal = catSnap.val() || {};
  Object.keys(catVal).forEach((k) => { catMap[k] = catVal[k].name; });

  const catCounts: Record<string, number> = {};
  let total = 0;

  const plansVal = plansSnap.val() || {};
  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      total++;
      const cid = p.categoryId || 'sem_categoria';
      catCounts[cid] = (catCounts[cid] || 0) + 1;
    }
  });

  const columns: ExcelColumnDef[] = [
    { header: 'Categoria de Ensino', key: 'name', width: 38 },
    { header: 'Total de Aulas', key: 'count', width: 18, align: 'center' },
    { header: '% do Total', key: 'pct', width: 18, align: 'center' }
  ];

  const rows = Object.keys(catCounts).map((cid) => {
    const name = catMap[cid] || (cid === 'sem_categoria' ? 'Sem Categoria' : cid);
    const count = catCounts[cid];
    const pct = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%';
    return { name, count, pct };
  });

  await exportToExcelJS({
    title: `AULAS POR CATEGORIA - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Categorias',
    columns,
    rows,
    emptyMessage: 'Nenhuma aula registrada no bimestre.',
    filename: `relatorio_categorias_${bimester}bim.xlsx`
  });
}

export async function generateBNCCPerformanceReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `DESEMPENHO POR HABILIDADE BNCC - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));

  const bnccVal = bnccSnap.val() || {};
  const bnccMap: Record<string, { code: string; desc: string }> = {};
  Object.keys(bnccVal).forEach((k) => {
    bnccMap[k] = { code: bnccVal[k].code, desc: bnccVal[k].desc || bnccVal[k].description || '' };
  });

  const skillCounts: Record<string, { dates: string[]; count: number }> = {};
  const plansVal = plansSnap.val() || {};

  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      const skillsInPlan = new Set<string>();
      if (Array.isArray(p.bnccIds)) {
        p.bnccIds.forEach((id: string) => { if (id) skillsInPlan.add(id); });
      }
      if (Array.isArray(p.bnccCodes)) {
        p.bnccCodes.forEach((code: string) => {
          const matchedId = Object.keys(bnccVal).find((bid) => bnccVal[bid].code === code);
          if (matchedId) skillsInPlan.add(matchedId);
        });
      }
      if (p.bnccId) {
        skillsInPlan.add(p.bnccId);
      }

      skillsInPlan.forEach((bid) => {
        if (!skillCounts[bid]) skillCounts[bid] = { dates: [], count: 0 };
        skillCounts[bid].count++;
        if (p.date) skillCounts[bid].dates.push(formatDate(p.date));
      });
    }
  });

  const tableData: any[] = [];
  Object.keys(skillCounts).forEach((bid) => {
    const skill = bnccMap[bid] || { code: bid, desc: '-' };
    tableData.push([
      skill.code,
      skill.desc,
      skillCounts[bid].count,
      skillCounts[bid].dates.join(', ')
    ]);
  });

  autoTable(doc, {
    startY,
    head: [['Código BNCC', 'Descrição da Habilidade', 'Qtd Aulas', 'Datas']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhuma habilidade vinculada no bimestre.', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8 }
  });

  doc.save(`bncc_habilidades_${bimester}bim.pdf`);
}

export async function generateBNCCPerformanceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));

  const bnccVal = bnccSnap.val() || {};
  const bnccMap: Record<string, { code: string; desc: string }> = {};
  Object.keys(bnccVal).forEach((k) => {
    bnccMap[k] = { code: bnccVal[k].code, desc: bnccVal[k].desc || bnccVal[k].description || '' };
  });

  const skillCounts: Record<string, { dates: string[]; count: number }> = {};
  const plansVal = plansSnap.val() || {};

  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      const skillsInPlan = new Set<string>();
      if (Array.isArray(p.bnccIds)) {
        p.bnccIds.forEach((id: string) => { if (id) skillsInPlan.add(id); });
      }
      if (Array.isArray(p.bnccCodes)) {
        p.bnccCodes.forEach((code: string) => {
          const matchedId = Object.keys(bnccVal).find((bid) => bnccVal[bid].code === code);
          if (matchedId) skillsInPlan.add(matchedId);
        });
      }
      if (p.bnccId) {
        skillsInPlan.add(p.bnccId);
      }

      skillsInPlan.forEach((bid) => {
        if (!skillCounts[bid]) skillCounts[bid] = { dates: [], count: 0 };
        skillCounts[bid].count++;
        if (p.date) skillCounts[bid].dates.push(formatDate(p.date));
      });
    }
  });

  const columns: ExcelColumnDef[] = [
    { header: 'Código BNCC', key: 'code', width: 16, align: 'center' },
    { header: 'Descrição da Habilidade', key: 'desc', width: 50 },
    { header: 'Qtd Aulas', key: 'count', width: 14, align: 'center' },
    { header: 'Datas das Aulas', key: 'dates', width: 35 }
  ];

  const rows = Object.keys(skillCounts).map((bid) => {
    const skill = bnccMap[bid] || { code: bid, desc: '-' };
    return {
      code: skill.code,
      desc: skill.desc,
      count: skillCounts[bid].count,
      dates: skillCounts[bid].dates.join(', ')
    };
  });

  await exportToExcelJS({
    title: `HABILIDADES BNCC TRABALHADAS - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'BNCC Habilidades',
    columns,
    rows,
    emptyMessage: 'Nenhuma habilidade vinculada no bimestre.',
    filename: `bncc_habilidades_${bimester}bim.xlsx`
  });
}

export async function generateBNCCCoverageReport(classId: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, 'COBERTURA CURRICULAR BNCC', turma, teacher, currentYear);

  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));

  const bnccVal = bnccSnap.val() || {};
  const plansVal = plansSnap.val() || {};

  const workedSkillIds = new Set<string>();
  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      if (Array.isArray(p.bnccIds)) {
        p.bnccIds.forEach((id: string) => { if (id) workedSkillIds.add(id); });
      }
      if (Array.isArray(p.bnccCodes)) {
        p.bnccCodes.forEach((code: string) => {
          const matchedId = Object.keys(bnccVal).find((bid) => bnccVal[bid].code === code);
          if (matchedId) workedSkillIds.add(matchedId);
        });
      }
      if (p.bnccId) {
        workedSkillIds.add(p.bnccId);
      }
    }
  });

  const turmaYear = turma ? turma.year : '';
  const relevantSkillIds = Object.keys(bnccVal).filter((bid) => {
    if (!turmaYear) return true;
    return isSkillApplicableToYear(bnccVal[bid], turmaYear);
  });

  const totalSkills = relevantSkillIds.length;
  const workedCount = relevantSkillIds.filter((bid) => workedSkillIds.has(bid)).length;
  const pct = totalSkills > 0 ? ((workedCount / totalSkills) * 100).toFixed(1) : '0';

  const tableData = relevantSkillIds.map((bid) => {
    const skill = bnccVal[bid];
    const isWorked = workedSkillIds.has(bid);
    const scopeLabel = formatSkillYearsLabel(skill);
    return [`${skill.code}\n(${scopeLabel})`, skill.desc || skill.description || '', isWorked ? 'Trabalhada' : 'Pendente'];
  });

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [['Código', 'Habilidade', `Status (Cobertura: ${pct}%)`]],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhuma habilidade cadastrada na base para esta série.', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 34, halign: 'center' },
      1: { cellWidth: 113, halign: 'left' },
      2: { cellWidth: 35, halign: 'center' }
    }
  });

  doc.save(`cobertura_bncc_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateBNCCCoverageReportXLSX(
  classId: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));

  const bnccVal = bnccSnap.val() || {};
  const plansVal = plansSnap.val() || {};

  const workedSkillIds = new Set<string>();
  Object.keys(plansVal).forEach((k) => {
    const p = plansVal[k];
    if (p.classId === classId && (!p.anoLetivo || p.anoLetivo === currentYear)) {
      if (Array.isArray(p.bnccIds)) {
        p.bnccIds.forEach((id: string) => { if (id) workedSkillIds.add(id); });
      }
      if (Array.isArray(p.bnccCodes)) {
        p.bnccCodes.forEach((code: string) => {
          const matchedId = Object.keys(bnccVal).find((bid) => bnccVal[bid].code === code);
          if (matchedId) workedSkillIds.add(matchedId);
        });
      }
      if (p.bnccId) {
        workedSkillIds.add(p.bnccId);
      }
    }
  });

  const turmaYear = turma ? turma.year : '';
  const relevantSkillIds = Object.keys(bnccVal).filter((bid) => {
    if (!turmaYear) return true;
    return isSkillApplicableToYear(bnccVal[bid], turmaYear);
  });

  const columns: ExcelColumnDef[] = [
    { header: 'Código BNCC', key: 'code', width: 16, align: 'center' },
    { header: 'Abrangência', key: 'scope', width: 18, align: 'center' },
    { header: 'Habilidade / Descrição', key: 'desc', width: 55 },
    { header: 'Status', key: 'status', width: 18, align: 'center' }
  ];

  const rows = relevantSkillIds.map((bid) => {
    const skill = bnccVal[bid];
    const isWorked = workedSkillIds.has(bid);
    return {
      code: skill.code,
      scope: formatSkillYearsLabel(skill),
      desc: skill.desc || skill.description || '',
      status: isWorked ? 'Trabalhada' : 'Pendente'
    };
  });

  await exportToExcelJS({
    title: `COBERTURA CURRICULAR BNCC - ${currentYear}`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Cobertura BNCC',
    columns,
    rows,
    emptyMessage: 'Nenhuma habilidade cadastrada para a série da turma.',
    filename: `cobertura_bncc_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

export async function generateLessonsPeriodReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `CARGA HORÁRIA E AULAS MINISTRADAS - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const plansVal = plansSnap.val() || {};

  const list = Object.keys(plansVal)
    .map((k) => ({ id: k, ...plansVal[k] }))
    .filter((p) => p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const tableData = list.map((p, idx) => [
    idx + 1,
    formatDate(p.date),
    getSubjectName(p.subject),
    p.planned || '-',
    p.given ? 'Ministrada' : 'Planejada'
  ]);

  autoTable(doc, {
    startY,
    head: [['Aula Nº', 'Data', 'Disciplina', 'Conteúdo / Tema', 'Status']],
    body: tableData.length > 0 ? tableData : [['-', '-', '-', 'Nenhuma aula registrada no bimestre.', '-']],
    theme: 'grid'
  });

  doc.save(`aulas_periodo_${bimester}bim.pdf`);
}

export async function generateLessonsPeriodReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const plansSnap = await get(ref(rtdb, dc('planos-aula')));
  const plansVal = plansSnap.val() || {};

  const list = Object.keys(plansVal)
    .map((k) => ({ id: k, ...plansVal[k] }))
    .filter((p) => p.classId === classId && String(p.bimester) === String(bimester) && (!p.anoLetivo || p.anoLetivo === currentYear))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº Aula', key: 'idx', width: 10, align: 'center' },
    { header: 'Data', key: 'data', width: 14, align: 'center' },
    { header: 'Disciplina', key: 'disciplina', width: 20 },
    { header: 'Conteúdo / Tema', key: 'conteudo', width: 45 },
    { header: 'Status', key: 'status', width: 16, align: 'center' }
  ];

  const rows = list.map((p, idx) => ({
    idx: idx + 1,
    data: formatDate(p.date),
    disciplina: getSubjectName(p.subject),
    conteudo: p.planned || '-',
    status: p.given ? 'Ministrada' : 'Planejada'
  }));

  await exportToExcelJS({
    title: `CARGA HORÁRIA E AULAS - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Aulas Período',
    columns,
    rows,
    emptyMessage: 'Nenhuma aula registrada no bimestre.',
    filename: `aulas_periodo_${bimester}bim.xlsx`
  });
}

// ----------------------------------------------------
// TAB 5: OCORRÊNCIAS
// ----------------------------------------------------

export async function generateEventsReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `RELATÓRIO DE OCORRÊNCIAS - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  let eventsVal: Record<string, any> = {};
  try {
    const eventsSnap = await get(ref(rtdb, dc('eventos')));
    eventsVal = eventsSnap.val() || {};
  } catch {}

  if (Object.keys(eventsVal).length === 0) {
    try {
      const sharedSnap = await get(ref(rtdb, 'diario-classe/eventos'));
      if (sharedSnap.exists()) {
        eventsVal = sharedSnap.val() || {};
      }
    } catch {}
  }

  let studentsVal: Record<string, any> = {};
  try {
    const studentsSnap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
    studentsVal = studentsSnap.val() || {};
  } catch {}

  let typesVal: Record<string, any> = {};
  try {
    const typesSnap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
    typesVal = typesSnap.val() || {};
  } catch {}

  const typesMap: Record<string, string> = {};
  Object.keys(typesVal).forEach((k) => { typesMap[k] = typesVal[k].name; });

  const list = Object.keys(eventsVal)
    .map((k) => ({ id: k, ...eventsVal[k] }))
    .filter((e) => {
      const matchClass = !classId || e.classId === classId;
      const matchBimester = !bimester || String(e.bimester).trim() === String(bimester).trim();
      const matchYear = !e.anoLetivo || !currentYear || String(e.anoLetivo).trim() === String(currentYear).trim();
      return matchClass && matchBimester && matchYear;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const tableData = list.map((e) => [
    formatDate(e.date),
    studentsVal[e.studentId]?.name || (e.studentId === 'geral' ? 'Geral / Turma' : studentsVal[e.studentId]?.name || 'Geral / Turma'),
    e.type || typesMap[e.typeId] || (e.typeId === 'geral' ? 'Geral' : e.typeId) || 'Geral',
    e.description || '-'
  ]);

  autoTable(doc, {
    startY,
    head: [['Data', 'Aluno Envolvido', 'Tipo de Ocorrência', 'Descrição do Fato']],
    body: tableData.length > 0 ? tableData : [['-', '-', '-', 'Nenhuma ocorrência registrada no bimestre.']],
    theme: 'grid'
  });

  doc.save(`ocorrencias_${bimester}bim.pdf`);
}

export async function generateEventsReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  let eventsVal: Record<string, any> = {};
  try {
    const eventsSnap = await get(ref(rtdb, dc('eventos')));
    eventsVal = eventsSnap.val() || {};
  } catch {}

  if (Object.keys(eventsVal).length === 0) {
    try {
      const sharedSnap = await get(ref(rtdb, 'diario-classe/eventos'));
      if (sharedSnap.exists()) {
        eventsVal = sharedSnap.val() || {};
      }
    } catch {}
  }

  let studentsVal: Record<string, any> = {};
  try {
    const studentsSnap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
    studentsVal = studentsSnap.val() || {};
  } catch {}

  let typesVal: Record<string, any> = {};
  try {
    const typesSnap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
    typesVal = typesSnap.val() || {};
  } catch {}

  const typesMap: Record<string, string> = {};
  Object.keys(typesVal).forEach((k) => { typesMap[k] = typesVal[k].name; });

  const columns: ExcelColumnDef[] = [
    { header: 'Data', key: 'data', width: 14, align: 'center' },
    { header: 'Aluno Envolvido', key: 'student', width: 35 },
    { header: 'Tipo de Ocorrência', key: 'type', width: 28 },
    { header: 'Descrição do Fato', key: 'desc', width: 70, wrapText: true }
  ];

  const list = Object.keys(eventsVal)
    .map((k) => ({ id: k, ...eventsVal[k] }))
    .filter((e) => {
      const matchClass = !classId || e.classId === classId;
      const matchBimester = !bimester || String(e.bimester).trim() === String(bimester).trim();
      const matchYear = !e.anoLetivo || !currentYear || String(e.anoLetivo).trim() === String(currentYear).trim();
      return matchClass && matchBimester && matchYear;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const rows = list.map((e) => ({
    data: formatDate(e.date),
    student: studentsVal[e.studentId]?.name || (e.studentId === 'geral' ? 'Geral / Turma' : studentsVal[e.studentId]?.name || 'Geral / Turma'),
    type: e.type || typesMap[e.typeId] || (e.typeId === 'geral' ? 'Geral' : e.typeId) || 'Geral',
    desc: e.description || '-'
  }));

  await exportToExcelJS({
    title: `RELATÓRIO DE OCORRÊNCIAS - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Ocorrências',
    columns,
    rows,
    emptyMessage: 'Nenhuma ocorrência registrada no bimestre.',
    filename: `ocorrencias_${bimester}bim.xlsx`
  });
}

export async function generateEventsByTypeReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `OCORRÊNCIAS POR TIPO - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  let eventsVal: Record<string, any> = {};
  try {
    const eventsSnap = await get(ref(rtdb, dc('eventos')));
    eventsVal = eventsSnap.val() || {};
  } catch {}

  if (Object.keys(eventsVal).length === 0) {
    try {
      const sharedSnap = await get(ref(rtdb, 'diario-classe/eventos'));
      if (sharedSnap.exists()) {
        eventsVal = sharedSnap.val() || {};
      }
    } catch {}
  }

  let typesVal: Record<string, any> = {};
  try {
    const typesSnap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
    typesVal = typesSnap.val() || {};
  } catch {}

  const typesMap: Record<string, string> = {};
  Object.keys(typesVal).forEach((k) => { typesMap[k] = typesVal[k].name; });

  const typeCounts: Record<string, number> = {};
  let total = 0;

  Object.keys(eventsVal).forEach((k) => {
    const e = eventsVal[k];
    const matchClass = !classId || e.classId === classId;
    const matchBimester = !bimester || String(e.bimester).trim() === String(bimester).trim();
    const matchYear = !e.anoLetivo || !currentYear || String(e.anoLetivo).trim() === String(currentYear).trim();

    if (matchClass && matchBimester && matchYear) {
      total++;
      const typeName = e.type || typesMap[e.typeId] || (e.typeId === 'geral' ? 'Geral' : e.typeId) || 'Geral';
      typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;
    }
  });

  const tableData: any[] = [];
  Object.keys(typeCounts).forEach((typeName) => {
    const count = typeCounts[typeName];
    const pct = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%';
    tableData.push([typeName, count, pct]);
  });

  autoTable(doc, {
    startY,
    head: [['Tipo de Ocorrência', 'Total de Casos', '% do Total']],
    body: tableData.length > 0 ? tableData : [['Nenhuma ocorrência registrada no bimestre.', '0', '0%']],
    theme: 'grid'
  });

  doc.save(`ocorrencias_por_tipo_${bimester}bim.pdf`);
}

export async function generateEventsByTypeReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  let eventsVal: Record<string, any> = {};
  try {
    const eventsSnap = await get(ref(rtdb, dc('eventos')));
    eventsVal = eventsSnap.val() || {};
  } catch {}

  if (Object.keys(eventsVal).length === 0) {
    try {
      const sharedSnap = await get(ref(rtdb, 'diario-classe/eventos'));
      if (sharedSnap.exists()) {
        eventsVal = sharedSnap.val() || {};
      }
    } catch {}
  }

  let typesVal: Record<string, any> = {};
  try {
    const typesSnap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
    typesVal = typesSnap.val() || {};
  } catch {}

  const typesMap: Record<string, string> = {};
  Object.keys(typesVal).forEach((k) => { typesMap[k] = typesVal[k].name; });

  const typeCounts: Record<string, number> = {};
  let total = 0;

  Object.keys(eventsVal).forEach((k) => {
    const e = eventsVal[k];
    const matchClass = !classId || e.classId === classId;
    const matchBimester = !bimester || String(e.bimester).trim() === String(bimester).trim();
    const matchYear = !e.anoLetivo || !currentYear || String(e.anoLetivo).trim() === String(currentYear).trim();

    if (matchClass && matchBimester && matchYear) {
      total++;
      const typeName = e.type || typesMap[e.typeId] || (e.typeId === 'geral' ? 'Geral' : e.typeId) || 'Geral';
      typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;
    }
  });

  const columns: ExcelColumnDef[] = [
    { header: 'Tipo de Ocorrência', key: 'name', width: 35 },
    { header: 'Total de Casos', key: 'count', width: 18, align: 'center' },
    { header: '% do Total', key: 'pct', width: 18, align: 'center' }
  ];

  const rows = Object.keys(typeCounts).map((typeName) => {
    const count = typeCounts[typeName];
    const pct = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%';
    return { name: typeName, count, pct };
  });

  await exportToExcelJS({
    title: `OCORRÊNCIAS POR TIPO - ${bimester}º BIMESTRE`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Ocorrências Tipo',
    columns,
    rows,
    emptyMessage: 'Nenhuma ocorrência registrada no bimestre.',
    filename: `ocorrencias_por_tipo_${bimester}bim.xlsx`
  });
}

// ----------------------------------------------------
// TAB 6: VISÃO GERAL CONSOLIDADA
// ----------------------------------------------------

export async function generateConsolidatedReport(classId: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF('landscape');
  const startY = addPDFHeader(doc, 'RELATÓRIO GERAL CONSOLIDADO DA TURMA', turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));
  const eventosSnap = await get(ref(rtdb, dc('eventos')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};
  const eventosVal = eventosSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const tableData = sortedStudents.map((student: any) => {
    let gradeSum = 0, gradeCnt = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && g.studentId === student.id && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          gradeSum += val;
          gradeCnt++;
        }
      }
    });

    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === student.id && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });

    let occCount = 0;
    Object.keys(eventosVal).forEach((k) => {
      const e = eventosVal[k];
      if (e.classId === classId && e.studentId === student.id && (!e.anoLetivo || e.anoLetivo === currentYear)) {
        occCount++;
      }
    });

    const totalAtt = p + f;
    const avgGrade = gradeCnt > 0 ? (gradeSum / gradeCnt).toFixed(1) : '-';
    const freqPct = totalAtt > 0 ? `${((p / totalAtt) * 100).toFixed(1)}%` : '-';

    return [
      student.number,
      student.name,
      student.ra,
      avgGrade,
      p,
      f,
      freqPct,
      occCount,
      student.status === 'expedida' ? 'TR. EXP.' : 'ATIVO'
    ];
  });

  autoTable(doc, {
    startY,
    head: [['Nº', 'Aluno', 'RA', 'Média Geral', 'Presenças', 'Faltas', '% Frequência', 'Ocorrências', 'Situação']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8 }
  });

  doc.save(`consolidado_turma_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateConsolidatedReportXLSX(
  classId: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await lerNotasDoPerfil();
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));
  const eventosSnap = await get(ref(rtdb, dc('eventos')));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Média Geral', key: 'avgGrade', width: 14, align: 'center', numFmt: '0.0' },
    { header: 'Presenças', key: 'p', width: 12, align: 'center' },
    { header: 'Faltas', key: 'f', width: 12, align: 'center' },
    { header: '% Frequência', key: 'freqPct', width: 16, align: 'center' },
    { header: 'Ocorrências', key: 'occCount', width: 14, align: 'center' },
    { header: 'Situação', key: 'status', width: 16, align: 'center' }
  ];

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};
  const eventosVal = eventosSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows = sortedStudents.map((student: any) => {
    let gradeSum = 0, gradeCnt = 0;
    Object.keys(notasVal).forEach((k) => {
      const g = notasVal[k];
      if (g.classId === classId && g.studentId === student.id && (!g.anoLetivo || g.anoLetivo === currentYear)) {
        const val = parseFloat(g.value);
        if (!isNaN(val)) {
          gradeSum += val;
          gradeCnt++;
        }
      }
    });

    let p = 0, f = 0;
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (att.classId === classId && att.studentId === student.id && (!att.anoLetivo || att.anoLetivo === currentYear)) {
        if (!isStudentEnrolledOnDate(student, att.date).enrolled) return;
        if (isStudentTransferredInAfterBimester(student, att.bimester)) return;
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });

    let occCount = 0;
    Object.keys(eventosVal).forEach((k) => {
      const e = eventosVal[k];
      if (e.classId === classId && e.studentId === student.id && (!e.anoLetivo || e.anoLetivo === currentYear)) {
        occCount++;
      }
    });

    const totalAtt = p + f;
    const avgGrade = gradeCnt > 0 ? parseFloat((gradeSum / gradeCnt).toFixed(1)) : '-';
    const freqPct = totalAtt > 0 ? `${((p / totalAtt) * 100).toFixed(1)}%` : '-';

    return {
      number: student.number,
      name: student.name,
      ra: student.ra || '-',
      avgGrade,
      p,
      f,
      freqPct,
      occCount,
      status: student.status === 'expedida' ? 'TR. EXP.' : 'ATIVO'
    };
  });

  await exportToExcelJS({
    title: `RELATÓRIO GERAL CONSOLIDADO DA TURMA - ${currentYear}`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Consolidado',
    columns,
    rows,
    emptyMessage: 'Nenhum aluno cadastrado na turma.',
    filename: `consolidado_turma_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
  });
}

// ---------------------------------------------------------------------------
// RANKING DE TURMAS MAIS FALTANTES (ABSENTEÍSMO POR ESCOLA / ANO LETIVO)
// ---------------------------------------------------------------------------

export interface ClassAbsenceStats {
  rank: number;
  classId: string;
  schoolId: string;
  schoolName: string;
  year: string;
  letter: string;
  shift: string;
  anoLetivo: string;
  className: string;
  studentCount: number;
  callDatesCount: number;
  totalPresences: number;
  totalAbsences: number;
  totalRecords: number;
  absenceRate: number; // 0 a 100
  attendanceRate: number; // 0 a 100
  avgAbsencesPerStudent: number;
  status: 'Crítico' | 'Alerta' | 'Atenção' | 'Adequado';

  // Propriedades compatíveis com o modal de visualização em tela
  activeStudents: number;
  totalCalls: number;
  riskLevel: 'Crítico' | 'Alerta' | 'Atenção' | 'Adequado';
}

export interface ClassesAbsenceRankingSummary {
  totalTurmas: number;
  totalAlunos: number;
  totalPresences: number;
  totalAbsences: number;
  totalRecords: number;
  avgAbsenceRate: number;
  avgAttendanceRate: number;
  mostAbsentClass: ClassAbsenceStats | null;
  leastAbsentClass: ClassAbsenceStats | null;
  criticalClassesCount: number;
  alertClassesCount: number;

  // Propriedades compatíveis com o modal de visualização em tela
  totalClasses: number;
  totalStudents: number;
  totalCalls: number;
  overallAbsenceRate: number;
  overallAttendanceRate: number;
  criticalCount: number;
}

/**
 * Função utilitária com timeout seguro para requisições Firebase RTDB,
 * evitando que qualquer consulta lenta ou sem resposta bloqueie a execução.
 */
function getWithTimeout<T>(promise: Promise<T>, timeoutMs = 4000): Promise<T | null> {
  let timer: any;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise
  ]).catch(() => {
    clearTimeout(timer);
    return null;
  });
}

/**
 * Calcula os índices de absenteísmo de todas as turmas filtradas por ano letivo e escola,
 * ordenadas da turma mais faltante para a de menor ausência.
 * Otimizado para não travar a UI (não faz queries massivas no nó raiz e não bloqueia a thread).
 */
export async function calculateClassesAbsenceStats(options: {
  schoolId?: string;
  currentYear: string;
  bimester?: string;
}): Promise<{
  stats: ClassAbsenceStats[];
  summary: ClassesAbsenceRankingSummary;
}> {
  const { schoolId, currentYear, bimester } = options;

  // Dá um respiro para a thread do navegador atualizar o estado de loading e spinners
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 1. Carrega todas as turmas disponíveis para o usuário
  const turmasList = await carregarMinhasTurmas();
  const filteredTurmas = turmasList.filter((t) => {
    const turma = t.val;
    if (turma.anoLetivo && String(turma.anoLetivo).trim() !== String(currentYear).trim()) {
      return false;
    }
    if (schoolId && schoolId !== 'todas' && turma.schoolId !== schoolId) {
      return false;
    }
    return true;
  });

  // 2. Carrega todos os registros de chamada da base com estratégia direcionada e rápida
  const allChamadas: any[] = [];
  const currentUid = getCurrentAuthUid();

  // 2.1 Carrega chamadas do usuário atual
  if (currentUid) {
    try {
      const selfSnap = await getWithTimeout(get(ref(rtdb, dc('chamada'))), 3500);
      if (selfSnap && selfSnap.exists()) {
        const sVal = selfSnap.val() || {};
        Object.keys(sVal).forEach((k) => {
          if (sVal[k]) allChamadas.push(sVal[k]);
        });
      }
    } catch (e) {
      console.warn('Aviso: erro ao carregar chamadas próprias:', e);
    }
  }

  // 2.2 Se for administrador, carrega chamadas dos demais docentes cadastrados
  try {
    const isAdmin = await verificarIsAdmin(currentUid);
    if (isAdmin) {
      const profsSnap = await getWithTimeout(get(ref(rtdb, 'diario-classe/professores')), 3000);
      if (profsSnap && profsSnap.exists()) {
        const profsVal = profsSnap.val() || {};
        const uidsToQuery = new Set<string>();
        Object.keys(profsVal).forEach((pk) => {
          const p = profsVal[pk];
          if (pk && pk !== currentUid) uidsToQuery.add(pk);
          if (p?.authUid && p.authUid !== currentUid) uidsToQuery.add(p.authUid);
        });

        // Limita e executa chamadas pontuais em paralelo
        const uidList = Array.from(uidsToQuery).slice(0, 30);
        await Promise.all(
          uidList.map(async (u) => {
            try {
              const snap = await getWithTimeout(get(ref(rtdb, `diario-classe/dados/${u}/chamada`)), 2500);
              if (snap && snap.exists()) {
                const val = snap.val() || {};
                Object.keys(val).forEach((k) => {
                  if (val[k]) allChamadas.push(val[k]);
                });
              }
            } catch {
              // Silencioso se um nó específico não puder ser lido
            }
          })
        );
      }
    }
  } catch (err) {
    console.warn('Aviso: verificação de admin para chamadas compartilhadas falhou:', err);
  }

  // 3. Processa estatísticas turma a turma de forma rápida (usando turma.alunos em memória)
  const statsList: ClassAbsenceStats[] = [];

  for (const t of filteredTurmas) {
    const classId = t.id;
    const turma = t.val;

    // Alunos matriculados ativos (aproveita dados já em memória)
    let studentCount = 0;
    const sVal = turma.alunos || {};
    const studentKeys = Object.keys(sVal);

    if (studentKeys.length > 0) {
      studentKeys.forEach((sid) => {
        const s = sVal[sid];
        if (s && s.status !== 'expedida' && (!s.anoLetivo || String(s.anoLetivo).trim() === String(currentYear).trim())) {
          studentCount++;
        }
      });
    }

    // Filtrar chamadas desta turma
    const classChamadas = allChamadas.filter((c) => {
      if (!c || c.classId !== classId) return false;
      if (c.anoLetivo && String(c.anoLetivo).trim() !== String(currentYear).trim()) return false;
      if (bimester && bimester !== 'todas' && String(c.bimester) !== String(bimester)) return false;
      return true;
    });

    const callDatesSet = new Set<string>();
    let p = 0;
    let f = 0;

    classChamadas.forEach((c) => {
      if (c.date) callDatesSet.add(c.date);
      if (c.status === 'P') p++;
      else if (c.status === 'F' || c.status === 'A') f++;
    });

    const totalRecs = p + f;
    const absenceRate = totalRecs > 0 ? (f / totalRecs) * 100 : 0;
    const attendanceRate = totalRecs > 0 ? (p / totalRecs) * 100 : 100;
    const avgAbsencesPerStudent = studentCount > 0 ? f / studentCount : 0;

    let status: 'Crítico' | 'Alerta' | 'Atenção' | 'Adequado' = 'Adequado';
    if (totalRecs > 0) {
      if (absenceRate >= 20) status = 'Crítico';
      else if (absenceRate >= 15) status = 'Alerta';
      else if (absenceRate >= 10) status = 'Atenção';
      else status = 'Adequado';
    }

    const roundedAbsenceRate = parseFloat(absenceRate.toFixed(1));
    const roundedAttendanceRate = parseFloat(attendanceRate.toFixed(1));
    const roundedAvgAbsences = parseFloat(avgAbsencesPerStudent.toFixed(1));

    statsList.push({
      rank: 0,
      classId,
      schoolId: turma.schoolId || '',
      schoolName: turma.schoolName || 'Não informada',
      year: turma.year || '',
      letter: turma.letter || '',
      shift: turma.shift || 'Geral',
      anoLetivo: turma.anoLetivo || currentYear,
      className: `${turma.year}º Ano ${turma.letter}`,
      studentCount,
      callDatesCount: callDatesSet.size,
      totalPresences: p,
      totalAbsences: f,
      totalRecords: totalRecs,
      absenceRate: roundedAbsenceRate,
      attendanceRate: roundedAttendanceRate,
      avgAbsencesPerStudent: roundedAvgAbsences,
      status,

      // Aliases para visualização direta na tela
      activeStudents: studentCount,
      totalCalls: callDatesSet.size,
      riskLevel: status
    });
  }

  // 4. Ordenação estrita da turma MAIS FALTANTE para a de menor ausência
  statsList.sort((a, b) => {
    // 1º critério: taxa de ausência (%) decrescente
    if (b.absenceRate !== a.absenceRate) return b.absenceRate - a.absenceRate;
    // 2º critério de desempate: total absoluto de faltas
    if (b.totalAbsences !== a.totalAbsences) return b.totalAbsences - a.totalAbsences;
    // 3º critério de desempate: média de faltas por aluno
    return b.avgAbsencesPerStudent - a.avgAbsencesPerStudent;
  });

  // Atribui posições de ranking oficiais
  statsList.forEach((st, idx) => {
    st.rank = idx + 1;
  });

  const totalTurmas = statsList.length;
  const totalAlunos = statsList.reduce((acc, s) => acc + s.studentCount, 0);
  const totalPresences = statsList.reduce((acc, s) => acc + s.totalPresences, 0);
  const totalAbsences = statsList.reduce((acc, s) => acc + s.totalAbsences, 0);
  const totalRecords = totalPresences + totalAbsences;
  const avgAbsenceRate = totalRecords > 0 ? parseFloat(((totalAbsences / totalRecords) * 100).toFixed(1)) : 0;
  const avgAttendanceRate = totalRecords > 0 ? parseFloat(((totalPresences / totalRecords) * 100).toFixed(1)) : 100;
  const criticalClassesCount = statsList.filter((s) => s.status === 'Crítico').length;
  const alertClassesCount = statsList.filter((s) => s.status === 'Alerta').length;

  const summary: ClassesAbsenceRankingSummary = {
    totalTurmas,
    totalAlunos,
    totalPresences,
    totalAbsences,
    totalRecords,
    avgAbsenceRate,
    avgAttendanceRate,
    mostAbsentClass: statsList.length > 0 && statsList[0].totalRecords > 0 ? statsList[0] : null,
    leastAbsentClass: statsList.length > 0 && statsList[statsList.length - 1].totalRecords > 0 ? statsList[statsList.length - 1] : null,
    criticalClassesCount,
    alertClassesCount,

    // Aliases completos para a UI
    totalClasses: totalTurmas,
    totalStudents: totalAlunos,
    totalCalls: totalRecords,
    overallAbsenceRate: avgAbsenceRate,
    overallAttendanceRate: avgAttendanceRate,
    criticalCount: criticalClassesCount
  };

  return { stats: statsList, summary };
}

/**
 * Gera o relatório estatístico oficial em PDF no formato Paisagem das turmas mais faltantes.
 */
export async function generateClassesAbsenceRankingReport(options: {
  schoolId?: string;
  schoolName?: string;
  currentYear: string;
  bimester?: string;
  teacherName?: string;
}): Promise<void> {
  const { schoolId, schoolName, currentYear, bimester, teacherName } = options;
  const { stats, summary } = await calculateClassesAbsenceStats({ schoolId, currentYear, bimester });

  if (stats.length === 0) {
    throw new Error('Nenhuma turma encontrada para o ano letivo e escola selecionados.');
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 14;

  const bimesterLabel =
    !bimester || bimester === 'todas'
      ? 'Ano Letivo Completo (Todos os Bimestres)'
      : `${bimester}º Bimestre`;
  const schoolLabel = schoolId && schoolId !== 'todas' && schoolName ? schoolName : 'Todas as Escolas da Rede';
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const horaHoje = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // 1. Faixa Superior (Header)
  doc.setFillColor(30, 27, 75); // Indigo 950
  doc.rect(0, 0, pageWidth, 20, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('RANKING DE ABSENTEÍSMO ESCOLAR - TURMAS MAIS FALTANTES', margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(199, 210, 254);
  doc.text('Estatísticas oficiais ordenadas da turma de maior ausência para a de menor ausência', margin, 17);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`Ano Letivo: ${currentYear}`, pageWidth - margin, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(224, 231, 255);
  doc.text(`Emitido em: ${dataHoje} às ${horaHoje}`, pageWidth - margin, 17, { align: 'right' });

  // 2. Barra de Metadados
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, 24, pageWidth - 2 * margin, 10, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(`Escola:`, margin + 4, 30.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(schoolLabel, margin + 17, 30.5);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Período de Análise:`, margin + 130, 30.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(bimesterLabel, margin + 162, 30.5);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Critério:`, margin + 220, 30.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(225, 29, 72);
  doc.text(`Ordem Decrescente de Faltas (%)`, margin + 233, 30.5);

  // 3. Cards de Resumo Executivo (KPIs)
  const cardY = 37;
  const cardH = 16;
  const cardW = (pageWidth - 2 * margin - 9) / 4;

  // KPI 1: Turmas Analisadas
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cardY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TURMAS ANALISADAS', margin + 4, cardY + 5);
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text(`${summary.totalTurmas} turmas`, margin + 4, cardY + 12);

  // KPI 2: Turma Mais Faltante (Destaque em Vermelho)
  const k2X = margin + cardW + 3;
  doc.setFillColor(254, 242, 242);
  doc.setDrawColor(254, 205, 211);
  doc.roundedRect(k2X, cardY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(190, 18, 60);
  doc.text('MAIOR TAXA DE AUSÊNCIA (1º LUGAR)', k2X + 4, cardY + 5);
  doc.setFontSize(11);
  doc.setTextColor(159, 18, 57);
  const mostText = summary.mostAbsentClass
    ? `${summary.mostAbsentClass.className} • ${summary.mostAbsentClass.absenceRate}%`
    : 'Sem registros';
  doc.text(mostText, k2X + 4, cardY + 12);

  // KPI 3: Taxa Média da Rede / Escola
  const k3X = margin + 2 * (cardW + 3);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(k3X, cardY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TAXA MÉDIA DE AUSÊNCIA', k3X + 4, cardY + 5);
  doc.setFontSize(13);
  doc.setTextColor(79, 70, 229);
  doc.text(`${summary.avgAbsenceRate}% faltas`, k3X + 4, cardY + 12);

  // KPI 4: Total de Faltas Acumuladas
  const k4X = margin + 3 * (cardW + 3);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(k4X, cardY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL DE FALTAS ACUMULADAS', k4X + 4, cardY + 5);
  doc.setFontSize(13);
  doc.setTextColor(220, 38, 38);
  doc.text(`${summary.totalAbsences.toLocaleString('pt-BR')} faltas`, k4X + 4, cardY + 12);

  // 4. Montagem da Tabela com AutoTable
  const isAllSchools = !schoolId || schoolId === 'todas';
  const headCols = isAllSchools
    ? [
        'Pos.',
        'Escola',
        'Turma',
        'Turno',
        'Alunos',
        'Dias',
        'Presenças (P)',
        'Faltas (F)',
        'Total Reg.',
        '% Ausência',
        '% Frequência',
        'Faltas/Aluno',
        'Classificação'
      ]
    : [
        'Pos.',
        'Turma',
        'Turno',
        'Alunos',
        'Dias',
        'Presenças (P)',
        'Faltas (F)',
        'Total Reg.',
        '% Ausência',
        '% Frequência',
        'Faltas/Aluno',
        'Classificação'
      ];

  const bodyRows = stats.map((st) => {
    const base = [
      `${st.rank}º`,
      ...(isAllSchools ? [st.schoolName] : []),
      st.className,
      st.shift,
      st.studentCount,
      st.callDatesCount,
      st.totalPresences.toLocaleString('pt-BR'),
      st.totalAbsences.toLocaleString('pt-BR'),
      st.totalRecords.toLocaleString('pt-BR'),
      `${st.absenceRate.toFixed(1)}%`,
      `${st.attendanceRate.toFixed(1)}%`,
      st.avgAbsencesPerStudent.toFixed(1),
      st.status
    ];
    return base;
  });

  const absColIdx = isAllSchools ? 9 : 8;
  const statusColIdx = isAllSchools ? 12 : 11;

  autoTable(doc, {
    startY: 57,
    head: [headCols],
    body: bodyRows,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      halign: 'center',
      valign: 'middle'
    },
    headStyles: {
      fillColor: [190, 18, 60], // Rose 700
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: isAllSchools
      ? {
          0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 54, halign: 'left' },
          2: { cellWidth: 26, halign: 'left', fontStyle: 'bold' },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 16, halign: 'center' },
          5: { cellWidth: 14, halign: 'center' },
          6: { cellWidth: 22, halign: 'center' },
          7: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
          8: { cellWidth: 20, halign: 'center' },
          9: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
          10: { cellWidth: 22, halign: 'center' },
          11: { cellWidth: 22, halign: 'center' },
          12: { cellWidth: 26, halign: 'center', fontStyle: 'bold' }
        }
      : {
          0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 40, halign: 'left', fontStyle: 'bold' },
          2: { cellWidth: 22, halign: 'center' },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 18, halign: 'center' },
          5: { cellWidth: 26, halign: 'center' },
          6: { cellWidth: 26, halign: 'center', fontStyle: 'bold' },
          7: { cellWidth: 26, halign: 'center' },
          8: { cellWidth: 26, halign: 'center', fontStyle: 'bold' },
          9: { cellWidth: 26, halign: 'center' },
          10: { cellWidth: 26, halign: 'center' },
          11: { cellWidth: 26, halign: 'center', fontStyle: 'bold' }
        },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        // Destaque de medalha para as 3 turmas mais faltantes
        if (data.column.index === 0) {
          const valStr = String(data.cell.raw);
          if (valStr === '1º') {
            data.cell.styles.fillColor = [254, 226, 226];
            data.cell.styles.textColor = [185, 28, 28];
          } else if (valStr === '2º') {
            data.cell.styles.fillColor = [254, 242, 242];
            data.cell.styles.textColor = [190, 24, 93];
          } else if (valStr === '3º') {
            data.cell.styles.fillColor = [255, 247, 237];
            data.cell.styles.textColor = [194, 65, 12];
          }
        }

        // Coluna % Ausência
        if (data.column.index === absColIdx) {
          const num = parseFloat(String(data.cell.raw).replace('%', ''));
          if (!isNaN(num)) {
            if (num >= 20.0) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fillColor = [254, 242, 242];
            } else if (num >= 15.0) {
              data.cell.styles.textColor = [217, 119, 6];
            } else if (num >= 10.0) {
              data.cell.styles.textColor = [202, 138, 4];
            } else {
              data.cell.styles.textColor = [16, 185, 129];
            }
          }
        }

        // Coluna Situação
        if (data.column.index === statusColIdx) {
          const statusText = String(data.cell.raw);
          if (statusText === 'Crítico') {
            data.cell.styles.fillColor = [254, 226, 226];
            data.cell.styles.textColor = [153, 27, 27];
          } else if (statusText === 'Alerta') {
            data.cell.styles.fillColor = [254, 237, 213];
            data.cell.styles.textColor = [154, 52, 18];
          } else if (statusText === 'Atenção') {
            data.cell.styles.fillColor = [254, 249, 195];
            data.cell.styles.textColor = [133, 77, 14];
          } else {
            data.cell.styles.fillColor = [220, 252, 231];
            data.cell.styles.textColor = [22, 101, 52];
          }
        }
      }
    }
  });

  // 5. Rodapé com Legenda de Criticidade
  const finalY = (doc as any).lastAutoTable?.finalY || 180;
  let legY = finalY + 7;
  if (legY > pageHeight - 18) {
    doc.addPage();
    legY = 20;
  }

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, legY, pageWidth - 2 * margin, 12, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(30, 41, 59);
  doc.text('ESCALA DE RISCO E CLASSIFICAÇÃO PEDAGÓGICA DO ABSENTEÍSMO:', margin + 4, legY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(185, 28, 28);
  doc.text('■ Crítico: Ausência ≥ 20.0% (Risco Iminente de Evasão / Infrequência Grave)', margin + 4, legY + 9);

  doc.setTextColor(194, 65, 12);
  doc.text('■ Alerta: Ausência de 15.0% a 19.9% (Acompanhamento Ativo)', margin + 98, legY + 9);

  doc.setTextColor(161, 98, 7);
  doc.text('■ Atenção: Ausência de 10.0% a 14.9% (Aviso Preventivo)', margin + 185, legY + 9);

  doc.setTextColor(21, 128, 61);
  doc.text('■ Adequado: Ausência < 10.0% (Regular)', margin + 252, legY + 9);

  const cleanSchool = (schoolName || 'todas_escolas').toLowerCase().replace(/[^a-z0-9]/g, '_');
  doc.save(`ranking_turmas_mais_faltantes_${currentYear}_${cleanSchool}.pdf`);
}

/**
 * Gera a planilha Excel (XLSX) formatada com fórmulas dinâmicas das turmas mais faltantes.
 */
export async function generateClassesAbsenceRankingReportXLSX(options: {
  schoolId?: string;
  schoolName?: string;
  currentYear: string;
  bimester?: string;
  teacherName?: string;
}): Promise<void> {
  const { schoolId, schoolName, currentYear, bimester, teacherName } = options;
  const { stats, summary } = await calculateClassesAbsenceStats({ schoolId, currentYear, bimester });

  if (stats.length === 0) {
    throw new Error('Nenhuma turma encontrada para o ano letivo e escola selecionados.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diário de Classe';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Turmas Mais Faltantes', {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const bimesterLabel =
    !bimester || bimester === 'todas'
      ? 'Ano Letivo Completo (Todos os Bimestres)'
      : `${bimester}º Bimestre`;
  const schoolLabel = schoolId && schoolId !== 'todas' && schoolName ? schoolName : 'Todas as Escolas da Rede';
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const horaHoje = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const numCols = 13;

  // 1. Título Principal
  worksheet.mergeCells(1, 1, 1, numCols);
  const tCell = worksheet.getCell(1, 1);
  tCell.value = 'RANKING DE ABSENTEÍSMO ESCOLAR - TURMAS MAIS FALTANTES';
  tCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9F1239' } }; // Rose 800
  tCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 32;

  // 2. Metadados
  const metaRows = [
    `Escola / Unidade: ${schoolLabel}`,
    `Ano Letivo: ${currentYear}   |   Período Analisado: ${bimesterLabel}`,
    `Critério de Ordenação: Taxa de Ausência / Faltas (%) Decrescente (Da Mais Faltante para a Menos Faltante)`,
    `Data de Emissão: ${dataHoje} às ${horaHoje}`
  ];

  metaRows.forEach((str, idx) => {
    const rowNum = idx + 2;
    worksheet.mergeCells(rowNum, 1, rowNum, numCols);
    const c = worksheet.getCell(rowNum, 1);
    c.value = str;
    c.font = { name: 'Calibri', size: 10, bold: idx === 1 || idx === 2, color: { argb: 'FF334155' } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(rowNum).height = 18;
  });

  worksheet.getRow(6).height = 10;

  // 3. Cabeçalhos de Colunas (Linha 7)
  const headers = [
    'Posição',
    'Escola',
    'Turma',
    'Turno',
    'Qtd Alunos',
    'Dias de Aula',
    'Presenças (P)',
    'Faltas (F)',
    'Total Registros',
    '% Ausência (Faltas)',
    '% Frequência',
    'Média Faltas/Aluno',
    'Situação / Grau'
  ];

  const colWidths = [12, 36, 18, 12, 13, 14, 16, 16, 16, 20, 18, 18, 20];

  const hRow = worksheet.getRow(7);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBE123C' } }; // Rose 700
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9F1239' } },
      bottom: { style: 'medium', color: { argb: 'FF9F1239' } },
      left: { style: 'thin', color: { argb: 'FF9F1239' } },
      right: { style: 'thin', color: { argb: 'FF9F1239' } }
    };
    worksheet.getColumn(i + 1).width = colWidths[i];
  });

  // 4. Linhas de Dados com Fórmulas Reais do Excel (Linha 8 em diante)
  const startRow = 8;
  stats.forEach((st, idx) => {
    const r = startRow + idx;
    const row = worksheet.getRow(r);
    row.height = 22;

    row.getCell(1).value = `${st.rank}º`;
    row.getCell(2).value = st.schoolName;
    row.getCell(3).value = st.className;
    row.getCell(4).value = st.shift;
    row.getCell(5).value = st.studentCount;
    row.getCell(6).value = st.callDatesCount;
    row.getCell(7).value = st.totalPresences;
    row.getCell(8).value = st.totalAbsences;
    row.getCell(9).value = {
      formula: `G${r}+H${r}`,
      result: st.totalRecords
    };

    // % Ausência (Fórmula Real do Excel)
    row.getCell(10).value = {
      formula: `IF(I${r}>0, ROUND(H${r}/I${r}, 3), 0)`,
      result: st.absenceRate / 100
    };
    row.getCell(10).numFmt = '0.0%';

    // % Frequência (Fórmula Real do Excel)
    row.getCell(11).value = {
      formula: `IF(I${r}>0, ROUND(G${r}/I${r}, 3), 1)`,
      result: st.attendanceRate / 100
    };
    row.getCell(11).numFmt = '0.0%';

    // Média Faltas/Aluno (Fórmula Real do Excel)
    row.getCell(12).value = {
      formula: `IF(E${r}>0, ROUND(H${r}/E${r}, 1), 0)`,
      result: st.avgAbsencesPerStudent
    };
    row.getCell(12).numFmt = '0.0';

    row.getCell(13).value = st.status;

    // Estilos visuais
    const isEven = idx % 2 === 1;
    let bgArgb = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
    if (idx === 0 && st.totalRecords > 0) {
      bgArgb = 'FFFFF1F2'; // Destaque na turma campeã de faltas
    }

    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (c === 1 || c === 3 || c === 4 || c === 13) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (c === 1 || c === 3) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      } else if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (c >= 5 && c <= 9) {
          cell.numFmt = '#,##0';
        }
      }

      // Destaque de cor no percentual de ausência
      if (c === 10) {
        if (st.absenceRate >= 20) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
        } else if (st.absenceRate >= 15) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFD97706' } };
        }
      }
    }
  });

  const lastDataRow = startRow + stats.length - 1;

  // 5. Linha Totalizadora e Média Geral da Rede
  const totalRowIdx = lastDataRow + 2;
  const totalRow = worksheet.getRow(totalRowIdx);
  totalRow.height = 24;

  worksheet.mergeCells(totalRowIdx, 1, totalRowIdx, 4);
  totalRow.getCell(1).value = 'TOTAL / MÉDIA GERAL:';
  totalRow.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF1E1B4B' } };
  totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };

  // Total Alunos
  totalRow.getCell(5).value = {
    formula: `SUM(E${startRow}:E${lastDataRow})`,
    result: summary.totalAlunos
  };
  totalRow.getCell(5).numFmt = '#,##0';

  // Total Presenças
  totalRow.getCell(7).value = {
    formula: `SUM(G${startRow}:G${lastDataRow})`,
    result: summary.totalPresences
  };
  totalRow.getCell(7).numFmt = '#,##0';

  // Total Faltas
  totalRow.getCell(8).value = {
    formula: `SUM(H${startRow}:H${lastDataRow})`,
    result: summary.totalAbsences
  };
  totalRow.getCell(8).numFmt = '#,##0';
  totalRow.getCell(8).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFDC2626' } };

  // Total Registros
  totalRow.getCell(9).value = {
    formula: `SUM(I${startRow}:I${lastDataRow})`,
    result: summary.totalRecords
  };
  totalRow.getCell(9).numFmt = '#,##0';

  // Média Geral de Ausência
  totalRow.getCell(10).value = {
    formula: `IF(I${totalRowIdx}>0, ROUND(H${totalRowIdx}/I${totalRowIdx}, 3), 0)`,
    result: summary.avgAbsenceRate / 100
  };
  totalRow.getCell(10).numFmt = '0.0%';
  totalRow.getCell(10).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFBE123C' } };

  // Média Geral de Frequência
  totalRow.getCell(11).value = {
    formula: `IF(I${totalRowIdx}>0, ROUND(G${totalRowIdx}/I${totalRowIdx}, 3), 1)`,
    result: summary.avgAttendanceRate / 100
  };
  totalRow.getCell(11).numFmt = '0.0%';
  totalRow.getCell(11).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0D9488' } };

  // Média Geral de Faltas/Aluno
  totalRow.getCell(12).value = {
    formula: `IF(E${totalRowIdx}>0, ROUND(H${totalRowIdx}/E${totalRowIdx}, 1), 0)`,
    result: summary.totalAlunos > 0 ? parseFloat((summary.totalAbsences / summary.totalAlunos).toFixed(1)) : 0
  };
  totalRow.getCell(12).numFmt = '0.0';
  totalRow.getCell(12).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF334155' } };

  totalRow.getCell(13).value =
    summary.avgAbsenceRate >= 20 ? 'Risco Crítico' : summary.avgAbsenceRate >= 15 ? 'Alerta' : summary.avgAbsenceRate >= 10 ? 'Atenção' : 'Adequado';

  for (let c = 1; c <= numCols; c++) {
    const cell = totalRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
    if (c >= 5) cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Download do arquivo XLSX no browser
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cleanSchool = (schoolName || 'todas_escolas').toLowerCase().replace(/[^a-z0-9]/g, '_');
  a.download = `ranking_turmas_mais_faltantes_${currentYear}_${cleanSchool}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
