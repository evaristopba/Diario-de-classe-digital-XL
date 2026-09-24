import ExcelJS from 'exceljs';
import { ClassRoom, DEFAULT_SUBJECTS } from '../types';

export interface ExcelColumnDef {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  wrapText?: boolean;
  numFmt?: string;
}

export interface ExcelReportOptions {
  title: string;
  turma?: ClassRoom | null;
  teacher?: string;
  year?: string;
  subject?: string;
  sheetName?: string;
  columns: ExcelColumnDef[];
  rows: Record<string, any>[];
  filename: string;
  emptyMessage?: string;
  footerNotes?: string[];
}

function applyHeaderMetadataStyle(
  worksheet: ExcelJS.Worksheet,
  rowIdx: number,
  numCols: number,
  text: string,
  font: Partial<ExcelJS.Font>
) {
  worksheet.mergeCells(rowIdx, 1, rowIdx, numCols);
  for (let c = 1; c <= numCols; c++) {
    const cell = worksheet.getCell(rowIdx, c);
    cell.font = font;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {};
  }
  worksheet.getCell(rowIdx, 1).value = text;
}

export async function exportToExcelJS(options: ExcelReportOptions) {
  const {
    title,
    turma,
    teacher,
    year,
    subject,
    sheetName = 'Relatório',
    columns,
    rows,
    filename
  } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diário de Classe';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const numCols = Math.max(columns.length, 4);

  // 1. Linha 1: Título Principal Centralizado (Layout idêntico ao PDF)
  worksheet.mergeCells(1, 1, 1, numCols);
  for (let c = 1; c <= numCols; c++) {
    const cell = worksheet.getCell(1, c);
    cell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {};
  }
  worksheet.getRow(1).height = 32;
  worksheet.getCell(1, 1).value = title.toUpperCase();

  // 2. Metadados limpos sobre fundo branco
  const escolaStr = `Escola: ${turma ? turma.schoolName : 'Não informada'}`;
  applyHeaderMetadataStyle(
    worksheet,
    2,
    numCols,
    escolaStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(2).height = 20;

  const turmaStr = `Turma: ${turma ? `${turma.year}º Ano ${turma.letter} - ${turma.shift}` : 'Não informada'}`;
  applyHeaderMetadataStyle(
    worksheet,
    3,
    numCols,
    turmaStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(3).height = 20;

  let subName = '';
  if (subject && subject !== 'todas') {
    const found = DEFAULT_SUBJECTS.find((s) => s.id === subject);
    subName = found ? `   |   Disciplina: ${found.name}` : `   |   Disciplina: ${subject}`;
  }
  const profStr = `Professor(a): ${teacher || 'Não informado'}   |   Ano Letivo: ${year || ''}${subName}`;
  applyHeaderMetadataStyle(
    worksheet,
    4,
    numCols,
    profStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(4).height = 20;

  // 5. Linha 5: Espaço em branco antes da tabela
  const emptyRow = worksheet.addRow([]);
  emptyRow.height = 12;

  // 6. Linha 6: Cabeçalho da Tabela (Verde Esmeralda / Teal igual ao PDF)
  const headerValues = columns.map((c) => c.header);
  const headerRow = worksheet.addRow(headerValues);
  headerRow.height = 28;

  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF10B981' } // Emerald Green igual ao PDF
    };
    const colDef = columns[colNumber - 1];
    cell.alignment = {
      vertical: 'middle',
      horizontal: colDef?.align || (colDef?.key === 'number' || colDef?.key === 'data' || colDef?.key === 'date' ? 'center' : 'left'),
      wrapText: true
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF059669' } },
      left: { style: 'thin', color: { argb: 'FF059669' } },
      bottom: { style: 'medium', color: { argb: 'FF059669' } },
      right: { style: 'thin', color: { argb: 'FF059669' } }
    };
  });

  // 7. Linhas de Dados com fundo limpo, bordas sutis e alinhamento vertical no topo
  if (rows.length === 0) {
    const emptyRow = worksheet.addRow([options.emptyMessage || 'Nenhum registro encontrado no período/bimestre.']);
    const rowNum = emptyRow.number;
    if (columns.length > 1) {
      worksheet.mergeCells(rowNum, 1, rowNum, columns.length);
    }
    for (let c = 1; c <= columns.length; c++) {
      const cell = worksheet.getCell(rowNum, c);
      cell.font = { name: 'Calibri', size: 10.5, italic: true, color: { argb: 'FF64748B' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    }
    emptyRow.height = 26;
  } else {
    rows.forEach((rowData, rIdx) => {
      const rowValues = columns.map((col) => {
        const val = rowData[col.key];
        return val !== undefined && val !== null ? val : '';
      });

      const dataRow = worksheet.addRow(rowValues);
      const isEven = rIdx % 2 === 1;
      const bgArgb = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colDef = columns[colNumber - 1];
        cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF1E293B' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgArgb }
        };

        cell.alignment = {
          vertical: 'top',
          horizontal: colDef?.align || (typeof cell.value === 'number' ? 'center' : 'left'),
          wrapText: colDef?.wrapText ?? true
        };

        if (colDef?.numFmt && typeof cell.value === 'number') {
          cell.numFmt = colDef.numFmt;
        }

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });
  }

  // 7.1 Linhas de rodapé/conteúdo sintetizado mesclado nas colunas da tabela
  if (options.footerNotes && options.footerNotes.length > 0) {
    const numCols = columns.length;
    options.footerNotes.forEach((noteText) => {
      const addedRow = worksheet.addRow([noteText]);
      const rNum = addedRow.number;
      if (numCols > 1) {
        worksheet.mergeCells(rNum, 1, rNum, numCols);
      }
      addedRow.height = 28;
      for (let c = 1; c <= numCols; c++) {
        const cell = worksheet.getCell(rNum, c);
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }
    });
  }

  // 8. Cálculo dinâmico das Larguras das Colunas
  columns.forEach((colDef, colIdx) => {
    const colNumber = colIdx + 1;
    let maxContentLen = colDef.header.length;

    rows.forEach((r) => {
      const val = r[colDef.key];
      if (val !== undefined && val !== null) {
        const lines = String(val).split('\n');
        lines.forEach((l) => {
          if (l.length > maxContentLen) {
            maxContentLen = l.length;
          }
        });
      }
    });

    let finalWidth = colDef.width;
    if (!finalWidth) {
      finalWidth = Math.min(Math.max(maxContentLen + 4, 12), 70);
    }

    worksheet.getColumn(colNumber).width = finalWidth;
  });

  // 9. Download direto no navegador
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface CustomTableBlock {
  title?: string;
  columns: ExcelColumnDef[];
  rows: Record<string, any>[];
  emptyMessage?: string;
}

export interface ExcelMultiBlockReportOptions {
  title: string;
  turma?: ClassRoom | null;
  teacher?: string;
  year?: string;
  subject?: string;
  sheetName?: string;
  blocks: CustomTableBlock[];
  filename: string;
  emptyMessage?: string;
}

export async function exportMultiBlockToExcelJS(options: ExcelMultiBlockReportOptions) {
  const {
    title,
    turma,
    teacher,
    year,
    subject,
    sheetName = 'Relatório',
    blocks,
    filename
  } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diário de Classe';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const blocksToRender = blocks.length > 0
    ? blocks
    : [
        {
          columns: [{ header: 'Informação', key: 'info', width: 50 }],
          rows: [],
          emptyMessage: options.emptyMessage || 'Nenhum registro encontrado no período/bimestre.'
        }
      ];

  const maxCols = Math.max(...blocksToRender.map((b) => b.columns.length), 4);

  // 1. Linha 1: Título Principal Centralizado (Layout idêntico ao PDF)
  worksheet.mergeCells(1, 1, 1, maxCols);
  for (let c = 1; c <= maxCols; c++) {
    const cell = worksheet.getCell(1, c);
    cell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {};
  }
  worksheet.getRow(1).height = 32;
  worksheet.getCell(1, 1).value = title.toUpperCase();

  // 2. Metadados limpos sobre fundo branco
  const escolaStr = `Escola: ${turma ? turma.schoolName : 'Não informada'}`;
  applyHeaderMetadataStyle(
    worksheet,
    2,
    maxCols,
    escolaStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(2).height = 20;

  const turmaStr = `Turma: ${turma ? `${turma.year}º Ano ${turma.letter} - ${turma.shift}` : 'Não informada'}`;
  applyHeaderMetadataStyle(
    worksheet,
    3,
    maxCols,
    turmaStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(3).height = 20;

  let subName = '';
  if (subject && subject !== 'todas') {
    const found = DEFAULT_SUBJECTS.find((s) => s.id === subject);
    subName = found ? `   |   Disciplina: ${found.name}` : `   |   Disciplina: ${subject}`;
  }
  const profStr = `Professor(a): ${teacher || 'Não informado'}   |   Ano Letivo: ${year || ''}${subName}`;
  applyHeaderMetadataStyle(
    worksheet,
    4,
    maxCols,
    profStr,
    { name: 'Calibri', size: 11, bold: false, color: { argb: 'FF000000' } }
  );
  worksheet.getRow(4).height = 20;

  // Render each block
  for (const block of blocksToRender) {
    const space = worksheet.addRow([]);
    space.height = 12;

    if (block.title) {
      const blockTitleRowIdx = worksheet.rowCount + 1;
      worksheet.mergeCells(blockTitleRowIdx, 1, blockTitleRowIdx, block.columns.length);
      for (let c = 1; c <= block.columns.length; c++) {
        const cell = worksheet.getCell(blockTitleRowIdx, c);
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF065F46' } }; // Dark Emerald
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Emerald 50
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFA7F3D0' } },
          bottom: { style: 'thin', color: { argb: 'FFA7F3D0' } }
        };
      }
      worksheet.getRow(blockTitleRowIdx).height = 24;
      worksheet.getCell(blockTitleRowIdx, 1).value = block.title;
    }

    const headerValues = block.columns.map((c) => c.header);
    const headerRow = worksheet.addRow(headerValues);
    headerRow.height = 26;

    headerRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF10B981' } // Emerald Green
      };
      const colDef = block.columns[colNumber - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: colDef?.align || (colDef?.key === 'number' || colDef?.key === 'data' || colDef?.key === 'date' ? 'center' : 'left'),
        wrapText: true
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF059669' } },
        left: { style: 'thin', color: { argb: 'FF059669' } },
        bottom: { style: 'medium', color: { argb: 'FF059669' } },
        right: { style: 'thin', color: { argb: 'FF059669' } }
      };
    });

    if (block.rows.length === 0) {
      const emptyRow = worksheet.addRow([block.emptyMessage || options.emptyMessage || 'Nenhum registro encontrado no período/bimestre.']);
      const rowNum = emptyRow.number;
      if (block.columns.length > 1) {
        worksheet.mergeCells(rowNum, 1, rowNum, block.columns.length);
      }
      for (let c = 1; c <= block.columns.length; c++) {
        const cell = worksheet.getCell(rowNum, c);
        cell.font = { name: 'Calibri', size: 10.5, italic: true, color: { argb: 'FF64748B' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      }
      emptyRow.height = 26;
    } else {
      block.rows.forEach((rowData, rIdx) => {
        const rowValues = block.columns.map((col) => {
          const val = rowData[col.key];
          return val !== undefined && val !== null ? val : '';
        });

        const dataRow = worksheet.addRow(rowValues);
        const isEven = rIdx % 2 === 1;
        const bgArgb = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

        dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const colDef = block.columns[colNumber - 1];
          cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF1E293B' } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgArgb }
          };

          cell.alignment = {
            vertical: 'top',
            horizontal: colDef?.align || (typeof cell.value === 'number' ? 'center' : 'left'),
            wrapText: colDef?.wrapText ?? true
          };

          if (colDef?.numFmt && typeof cell.value === 'number') {
            cell.numFmt = colDef.numFmt;
          }

          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });
      });
    }
  }

  // Auto-width across all columns
  for (let c = 1; c <= maxCols; c++) {
    let maxLen = 12;
    blocksToRender.forEach((b) => {
      const colDef = b.columns[c - 1];
      if (colDef) {
        if (colDef.width) {
          maxLen = Math.max(maxLen, colDef.width);
        } else {
          maxLen = Math.max(maxLen, colDef.header.length);
          b.rows.forEach((r) => {
            const val = r[colDef.key];
            if (val !== undefined && val !== null) {
              const lines = String(val).split('\n');
              lines.forEach((l) => {
                if (l.length > maxLen) maxLen = l.length;
              });
            }
          });
        }
      }
    });
    worksheet.getColumn(c).width = Math.min(Math.max(maxLen + 4, 12), 70);
  }

  // Download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
