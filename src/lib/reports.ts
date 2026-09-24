import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { get, ref, rtdb, dc, carregarMinhasTurmas } from './firebase';
import { ClassRoom, DEFAULT_SUBJECTS } from '../types';
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

export function getSubjectName(subId?: string): string {
  if (!subId || subId === 'todas') return 'Todas as Matérias';
  const found = DEFAULT_SUBJECTS.find((s) => s.id === subId);
  return found ? found.name : subId;
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
  const notasSnap = await get(ref(rtdb, dc('notas')));

  const tableData: any[] = [];
  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  if (isAllSubjects) {
    // Matérias em colunas: Nº, Aluno, (RA opcional), LP, MAT, CIE, HIST, GEO, ART, EF, ING, ER, Média
    const head = [
      'Nº',
      'Aluno',
      ...(showRA ? ['RA'] : []),
      ...DEFAULT_SUBJECTS.map((s) => s.shortName),
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

      DEFAULT_SUBJECTS.forEach((sub) => {
        let nota = '-';
        if (student.status !== 'expedida') {
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
    DEFAULT_SUBJECTS.forEach(() => {
      columnStyles[colIdx] = { halign: 'center' };
      colIdx++;
    });

    // Média
    columnStyles[colIdx] = { halign: 'center' };

    autoTable(doc, {
      startY,
      head: [head],
      body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', ...(showRA ? ['-'] : []), ...DEFAULT_SUBJECTS.map(() => '-'), '-']],
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { halign: 'center' },
      columnStyles
    });
  } else {
    // Matéria única selecionada
    sortedStudents.forEach((student: any) => {
      let studentName = student.name;
      if (student.status === 'expedida') {
        studentName += `\n(TR. EXP.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      } else if (student.status === 'recebida') {
        studentName += `\n(TR. REC.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      }

      let nota = '-';
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

      if (student.status === 'expedida' && nota === '-') nota = 'TR. EXP.';
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
  const notasSnap = await get(ref(rtdb, dc('notas')));

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
    columns = [
      { header: 'Nº', key: 'number', width: 8, align: 'center' },
      { header: 'Aluno', key: 'name', width: 38 },
      ...(showRA ? [{ header: 'RA', key: 'ra', width: 16, align: 'center' as const }] : []),
      ...DEFAULT_SUBJECTS.map((s) => ({
        header: s.shortName,
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

      DEFAULT_SUBJECTS.forEach((sub) => {
        let notaVal: any = '-';
        if (student.status !== 'expedida') {
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
        } else {
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

      let notaVal: any = '-';
      if (student.status !== 'expedida') {
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
      } else {
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
  const notasSnap = await get(ref(rtdb, dc('notas')));

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
      if (isExpedido) {
        studentName += `\n(TR. EXP.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      } else if (student.status === 'recebida') {
        studentName += `\n(TR. REC.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      }
    }

    const row: any[] = [student.number, studentName, student.ra];
    let total = 0;
    let count = 0;

    for (let b = 1; b <= 4; b++) {
      let nota = '-';
      if (!isExpedido) {
        let bSum = 0;
        let bCnt = 0;

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

        if (bCnt > 0) {
          const bAvg = bSum / bCnt;
          nota = bAvg.toFixed(1);
          total += bAvg;
          count++;
        }
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
  const notasSnap = await get(ref(rtdb, dc('notas')));

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
      if (isExpedido) {
        studentName += ` (TR. EXP.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      } else if (student.status === 'recebida') {
        studentName += ` (TR. REC.${student.transferDate ? ` em ${formatDate(student.transferDate)}` : ''})`;
      }
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
      if (!isExpedido) {
        let bSum = 0;
        let bCnt = 0;
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
        if (bCnt > 0) {
          const avg = bSum / bCnt;
          notaVal = parseFloat(avg.toFixed(1));
          total += avg;
          count++;
        }
      } else {
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
  const notasSnap = await get(ref(rtdb, dc('notas')));

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
  const notasSnap = await get(ref(rtdb, dc('notas')));

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
  const notasSnap = await get(ref(rtdb, dc('notas')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  const tableData: any[] = [];

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

  doc.save(`evolucao_alunos_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

// 1.4 Evolução Individual XLSX
export async function generateStudentEvolutionReportXLSX(
  classId: string,
  studentId: string | null,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const notasSnap = await get(ref(rtdb, dc('notas')));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: '1º Bim', key: 'b1', width: 12, align: 'center', numFmt: '0.0' },
    { header: '2º Bim', key: 'b2', width: 12, align: 'center', numFmt: '0.0' },
    { header: '3º Bim', key: 'b3', width: 12, align: 'center', numFmt: '0.0' },
    { header: '4º Bim', key: 'b4', width: 12, align: 'center', numFmt: '0.0' },
    { header: 'Tendência Anual', key: 'evolucao', width: 24, align: 'center' }
  ];

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};

  let targetStudents = Object.keys(studentsVal).map((k) => ({ id: k, ...studentsVal[k] }));
  if (studentId) targetStudents = targetStudents.filter((s) => s.id === studentId);
  targetStudents.sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows: any[] = [];

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
      if (bCnt > 0) grades[b - 1] = parseFloat((bSum / bCnt).toFixed(1));
    }

    let evolucao = 'Sem dados';
    const validGrades = grades.filter((g) => g !== null) as number[];
    if (validGrades.length >= 2) {
      const first = validGrades[0];
      const last = validGrades[validGrades.length - 1];
      const diff = last - first;
      if (diff > 0.5) evolucao = `Evolutivo (+${diff.toFixed(1)})`;
      else if (diff < -0.5) evolucao = `Em Queda (${diff.toFixed(1)})`;
      else evolucao = `Estável (${diff.toFixed(1)})`;
    }

    rows.push({
      number: student.number,
      name: student.name,
      ra: student.ra || '-',
      b1: grades[0] !== null ? grades[0] : '-',
      b2: grades[1] !== null ? grades[1] : '-',
      b3: grades[2] !== null ? grades[2] : '-',
      b4: grades[3] !== null ? grades[3] : '-',
      evolucao
    });
  });

  await exportToExcelJS({
    title: `EVOLUÇÃO E TRAJETÓRIA DE APRENDIZAGEM - ${currentYear}`,
    turma,
    teacher,
    year: currentYear,
    sheetName: 'Evolução',
    columns,
    rows,
    emptyMessage: 'Nenhum dado de evolução registrado no período.',
    filename: `evolucao_alunos_${turma ? `${turma.year}_${turma.letter}` : ''}.xlsx`
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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

export async function generateAttendanceReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
  const doc = new jsPDF();
  const startY = addPDFHeader(doc, `ATA DE FREQUÊNCIA - ${bimester}º BIMESTRE`, turma, teacher, currentYear);

  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const tableData: any[] = [];

  sortedStudents.forEach((student: any) => {
    let p = 0, f = 0;
    Object.keys(attVal).forEach((k) => {
      const a = attVal[k];
      if (
        a.classId === classId &&
        String(a.bimester) === String(bimester) &&
        a.studentId === student.id &&
        (!a.anoLetivo || a.anoLetivo === currentYear)
      ) {
        if (a.status === 'P') p++;
        else if (a.status === 'F') f++;
      }
    });

    const total = p + f;
    const pct = total > 0 ? `${((p / total) * 100).toFixed(1)}%` : '-';
    let situacao = 'Regular';
    if (student.status === 'expedida') situacao = 'TR. EXP.';
    else if (total > 0 && (p / total) < 0.75) situacao = 'Risco (<75%)';

    tableData.push([student.number, student.name, student.ra, p, f, total, pct, situacao]);
  });

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [['Nº', 'Aluno', 'RA', 'Presenças', 'Faltas', 'Total Aulas', '% Freq', 'Situação']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhum aluno cadastrado na turma.', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 56, halign: 'left' },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 18, halign: 'center' },
      7: { cellWidth: 20, halign: 'center' }
    }
  });

  doc.save(`frequencia_${bimester}bim_${turma ? `${turma.year}_${turma.letter}` : ''}.pdf`);
}

export async function generateAttendanceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const columns: ExcelColumnDef[] = [
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Presenças', key: 'p', width: 14, align: 'center' },
    { header: 'Faltas', key: 'f', width: 12, align: 'center' },
    { header: 'Total Aulas', key: 'total', width: 14, align: 'center' },
    { header: '% Frequência', key: 'pct', width: 16, align: 'center' },
    { header: 'Situação', key: 'sit', width: 18, align: 'center' }
  ];

  const studentsVal = snap.val() || {};
  const attVal = attSnap.val() || {};

  const sortedStudents = Object.keys(studentsVal)
    .map((k) => ({ id: k, ...studentsVal[k] }))
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows: any[] = [];

  sortedStudents.forEach((student: any) => {
    let p = 0, f = 0;
    Object.keys(attVal).forEach((k) => {
      const a = attVal[k];
      if (
        a.classId === classId &&
        String(a.bimester) === String(bimester) &&
        a.studentId === student.id &&
        (!a.anoLetivo || a.anoLetivo === currentYear)
      ) {
        if (a.status === 'P') p++;
        else if (a.status === 'F') f++;
      }
    });

    const total = p + f;
    const pct = total > 0 ? `${((p / total) * 100).toFixed(1)}%` : '-';
    const sit = student.status === 'expedida' ? 'TR. EXP.' : (total > 0 && (p / total) < 0.75 ? 'Risco (<75%)' : 'Regular');

    rows.push({
      number: student.number,
      name: student.name,
      ra: student.ra || '-',
      p,
      f,
      total,
      pct,
      sit
    });
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

export async function generateAbsenceReport(classId: string, bimester: string, turma: ClassRoom, teacher: string, currentYear: string) {
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
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => b.f - a.f);

  const tableData = list.map((s, idx) => [
    idx + 1,
    s.name,
    s.ra || '-',
    s.f,
    `${s.pct.toFixed(1)}%`,
    s.status === 'expedida' ? 'TR. EXP.' : (s.pct > 25 ? 'CRÍTICO' : 'NORMAL')
  ]);

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: 182,
    head: [['Posição', 'Aluno', 'RA', 'Total Faltas', '% de Ausência', 'Status']],
    body: tableData.length > 0 ? tableData : [['-', 'Nenhum registro de falta no período.', '-', '-', '-', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 64, halign: 'left' },
      2: { cellWidth: 28, halign: 'center' },
      3: { cellWidth: 24, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 24, halign: 'center' }
    }
  });

  doc.save(`ranking_faltas_${bimester}bim.pdf`);
}

export async function generateAbsenceReportXLSX(
  classId: string,
  bimester: string,
  turma: ClassRoom,
  currentYear: string,
  teacher?: string
) {
  const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
  const attSnap = await get(ref(rtdb, dc('chamada')));

  const columns: ExcelColumnDef[] = [
    { header: 'Posição', key: 'pos', width: 10, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Faltas', key: 'f', width: 12, align: 'center' },
    { header: '% Ausência', key: 'pct', width: 16, align: 'center' },
    { header: 'Status', key: 'status', width: 18, align: 'center' }
  ];

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
    .filter((s) => !s.anoLetivo || s.anoLetivo === currentYear)
    .sort((a, b) => b.f - a.f);

  const rows = list.map((s, idx) => ({
    pos: idx + 1,
    name: s.name,
    ra: s.ra || '-',
    f: s.f,
    pct: `${s.pct.toFixed(1)}%`,
    status: s.status === 'expedida' ? 'TR. EXP.' : (s.pct > 25 ? 'CRÍTICO' : 'NORMAL')
  }));

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
  const notasSnap = await get(ref(rtdb, dc('notas')));
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));
  const eventosSnap = await get(ref(rtdb, dc('eventos')));

  const studentsVal = snap.val() || {};
  const notasVal = notasSnap.val() || {};
  const chamadaVal = chamadaSnap.val() || {};
  const eventosVal = eventosSnap.val() || {};

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
    DEFAULT_SUBJECTS.forEach((sub) => {
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
  const chamadaSnap = await get(ref(rtdb, dc('chamada')));

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
        if (att.status === 'P') p++;
        else if (att.status === 'F') f++;
      }
    });
    const totalAtt = p + f;
    const freqPct = totalAtt > 0 ? `${((p / totalAtt) * 100).toFixed(1)}%` : '-';

    const gradeRows: any[] = [];
    DEFAULT_SUBJECTS.forEach((sub) => {
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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
      if ((s.status === 'expedida' || s.status === 'recebida') && (!s.anoLetivo || s.anoLetivo === currentYear)) {
        tableData.push([
          `${t.val.year}º ${t.val.letter}`,
          s.number,
          s.name,
          s.ra,
          s.status === 'expedida' ? 'Expedida (Saída)' : 'Recebida (Entrada)',
          formatDate(s.transferDate) || '-'
        ]);
      }
    });
  }

  autoTable(doc, {
    startY: 32,
    head: [['Turma', 'Nº', 'Aluno', 'RA', 'Tipo de Transferência', 'Data']],
    body: tableData.length > 0 ? tableData : [['-', '-', 'Nenhuma transferência registrada no período.', '-', '-', '-']],
    theme: 'grid'
  });

  doc.save(`transferencias_${currentYear}.pdf`);
}

export async function generateTransfersReportXLSX(classId: string | null, currentYear: string, teacher?: string) {
  const turmasList = await carregarMinhasTurmas();
  const columns: ExcelColumnDef[] = [
    { header: 'Turma', key: 'turma', width: 14, align: 'center' },
    { header: 'Nº', key: 'number', width: 8, align: 'center' },
    { header: 'Aluno', key: 'name', width: 38 },
    { header: 'RA', key: 'ra', width: 16, align: 'center' },
    { header: 'Tipo de Transferência', key: 'tipo', width: 24, align: 'center' },
    { header: 'Data Transferência', key: 'data', width: 18, align: 'center' }
  ];

  const rows: any[] = [];

  for (const t of turmasList) {
    if (classId && t.id !== classId) continue;
    const snap = await get(ref(rtdb, `diario-classe/turmas/${t.id}/alunos`));
    const studentsVal = snap.val() || {};

    Object.keys(studentsVal).forEach((sid) => {
      const s = studentsVal[sid];
      if ((s.status === 'expedida' || s.status === 'recebida') && (!s.anoLetivo || s.anoLetivo === currentYear)) {
        rows.push({
          turma: `${t.val.year}º ${t.val.letter}`,
          number: s.number,
          name: s.name,
          ra: s.ra || '-',
          tipo: s.status === 'expedida' ? 'Expedida (Saída)' : 'Recebida (Entrada)',
          data: formatDate(s.transferDate) || '-'
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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
  const notasSnap = await get(ref(rtdb, dc('notas')));
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
