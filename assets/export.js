const DEFAULT_TITLE = '櫻木財務規劃｜分析報告';

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value instanceof Date) return value.toLocaleString('zh-TW', { hour12: false });
  if (Array.isArray(value)) return value.map(text).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const escapeHtml = (value) => text(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const csvCell = (value) => {
  let output = text(value);
  // 防止將文字欄位當成試算表公式執行；數值型別不受影響。
  if (typeof value === 'string' && /^[=+@]/.test(output)) output = `'${output}`;
  return `"${output.replaceAll('"', '""')}"`;
};

const safeFilename = (value) => text(value)
  .trim()
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '') || '財務分析報告';

const normalizeRows = (rows = []) => rows.map((row) => {
  if (Array.isArray(row)) {
    const [label = '', value = '', unit = '', note = ''] = row;
    return { label, value, unit, note };
  }
  return {
    label: row?.label ?? row?.name ?? '',
    value: row?.value ?? row?.result ?? '',
    unit: row?.unit ?? '',
    note: row?.note ?? row?.formula ?? '',
    type: row?.type ?? '',
  };
});

const normalizeStatement = (statement) => {
  if (!statement || typeof statement !== 'object') return null;
  const normalizeSide = (side, fallbackTitle) => ({
    title: text(side?.title || fallbackTitle),
    rows: normalizeRows(side?.rows || side?.items || []),
  });
  const kind = text(statement.kind || 'statement')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'statement';
  return {
    kind,
    left: normalizeSide(statement.left, '左方'),
    right: normalizeSide(statement.right, '右方'),
  };
};

/**
 * 統一報告資料格式。
 * @param {object} report
 * @returns {{title:string, generatedAt:string, meta:Array, sections:Array, assumptions:Array, notes:Array, statement:object|null}}
 */
export function normalizeReport(report = {}) {
  const generatedAt = report.generatedAt
    ? text(report.generatedAt)
    : new Date().toLocaleString('zh-TW', { hour12: false });

  return {
    title: text(report.title || DEFAULT_TITLE),
    generatedAt,
    meta: normalizeRows(report.meta || report.conditions || []),
    sections: (report.sections || []).map((section) => ({
      title: text(section?.title || '未命名區段'),
      rows: normalizeRows(section?.rows || section?.items || []),
    })),
    statement: normalizeStatement(report.statement),
    assumptions: (report.assumptions || []).map(text).filter(Boolean),
    notes: (report.notes || []).map(text).filter(Boolean),
  };
}

/** 將報告轉成可由 Excel／Google 試算表開啟的 UTF-8 CSV 字串。 */
export function reportToCsv(report) {
  const normalized = normalizeReport(report);
  const lines = [];
  const push = (...cells) => lines.push(cells.map(csvCell).join(','));

  push(normalized.title);
  push('產生時間', normalized.generatedAt);
  push('格式', 'CSV（UTF-8；可由 Excel／Google 試算表開啟）');
  lines.push('');

  if (normalized.meta.length) {
    push('輸入條件');
    push('項目', '內容', '單位', '備註');
    normalized.meta.forEach((row) => push(row.label, row.value, row.unit, row.note));
    lines.push('');
  }

  if (normalized.statement) {
    const { left, right } = normalized.statement;
    push(left.title, '', right.title, '');
    push('項目', '金額', '項目', '金額');
    const rowCount = Math.max(left.rows.length, right.rows.length);
    for (let index = 0; index < rowCount; index += 1) {
      const leftRow = left.rows[index];
      const rightRow = right.rows[index];
      push(
        leftRow?.label || '',
        leftRow ? `${text(leftRow.value)}${leftRow.unit ? ` ${text(leftRow.unit)}` : ''}` : '',
        rightRow?.label || '',
        rightRow ? `${text(rightRow.value)}${rightRow.unit ? ` ${text(rightRow.unit)}` : ''}` : '',
      );
    }
    lines.push('');
  }

  normalized.sections.forEach((section) => {
    push(section.title);
    push('項目', '結果／金額', '單位', '公式／說明');
    section.rows.forEach((row) => push(row.label, row.value, row.unit, row.note));
    lines.push('');
  });

  if (normalized.assumptions.length) {
    push('主要假設');
    normalized.assumptions.forEach((item, index) => push(index + 1, item));
    lines.push('');
  }

  if (normalized.notes.length) {
    push('備註');
    normalized.notes.forEach((item, index) => push(index + 1, item));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

/** 下載 .csv；檔名會明確保留 CSV 副檔名，不冒充 Excel 檔。 */
export function downloadCsvReport(report, filename) {
  const normalized = normalizeReport(report);
  const date = new Date().toISOString().slice(0, 10);
  const finalName = `${safeFilename(filename || normalized.title)}-${date}.csv`;
  const blob = new Blob([reportToCsv(normalized)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = finalName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return finalName;
}

const rowsToHtml = (rows) => rows.map((row) => `
  <tr>
    <th scope="row">${escapeHtml(row.label)}</th>
    <td>${escapeHtml(row.value)}${row.unit ? ` <span class="unit">${escapeHtml(row.unit)}</span>` : ''}</td>
    <td>${escapeHtml(row.note)}</td>
  </tr>`).join('');

const statementToHtml = (statement) => {
  if (!statement) return '';
  const { left, right } = statement;
  const rowCount = Math.max(left.rows.length, right.rows.length);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const leftRow = left.rows[index];
    const rightRow = right.rows[index];
    const amountCell = (row) => row
      ? `${escapeHtml(row.value)}${row.unit ? ` <span class="unit">${escapeHtml(row.unit)}</span>` : ''}`
      : '';
    const rowTypes = [leftRow?.type, rightRow?.type]
      .filter(Boolean)
      .map((type) => `statement-row--${escapeHtml(type)}`)
      .join(' ');
    return `
      <tr${rowTypes ? ` class="${rowTypes}"` : ''}>
        <th scope="row">${leftRow ? escapeHtml(leftRow.label) : ''}</th>
        <td class="statement-amount">${amountCell(leftRow)}</td>
        <th scope="row">${rightRow ? escapeHtml(rightRow.label) : ''}</th>
        <td class="statement-amount">${amountCell(rightRow)}</td>
      </tr>`;
  }).join('');
  return `
    <section class="statement-section">
      <table class="paired-statement paired-statement--${escapeHtml(statement.kind)}">
        <colgroup><col class="statement-label"><col class="statement-value"><col class="statement-label"><col class="statement-value"></colgroup>
        <thead>
          <tr><th colspan="2">${escapeHtml(left.title)}</th><th colspan="2">${escapeHtml(right.title)}</th></tr>
          <tr><th>項目</th><th>金額</th><th>項目</th><th>金額</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
};

/** 產生適合 A4 列印／存成 PDF 的完整 HTML 文件。 */
export function reportToPrintHtml(report) {
  const normalized = normalizeReport(report);
  const meta = normalized.meta.length ? `
    <section>
      <h2>輸入條件</h2>
      <table><thead><tr><th>項目</th><th>內容</th><th>備註</th></tr></thead>
      <tbody>${rowsToHtml(normalized.meta)}</tbody></table>
    </section>` : '';
  const sections = normalized.sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.title)}</h2>
      <table><thead><tr><th>項目</th><th>結果／金額</th><th>公式／說明</th></tr></thead>
      <tbody>${rowsToHtml(section.rows)}</tbody></table>
    </section>`).join('');
  const statement = statementToHtml(normalized.statement);
  const assumptions = normalized.assumptions.length ? `
    <section><h2>主要假設</h2><ol>${normalized.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></section>` : '';
  const notes = normalized.notes.length ? `
    <section><h2>備註</h2><ul>${normalized.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';

  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(normalized.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #18201d; font: 14px/1.55 system-ui, -apple-system, "Noto Sans TC", sans-serif; }
  header { padding-bottom: 16px; border-bottom: 3px solid #9d2738; margin-bottom: 22px; }
  h1 { margin: 0 0 6px; color: #6f1625; font-size: 25px; }
  h2 { color: #6f1625; font-size: 17px; margin: 22px 0 8px; }
  p { margin: 0; color: #52605a; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cfd8d3; padding: 7px 9px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  thead th { background: #edf3f0; color: #25332d; }
  tbody th { width: 31%; font-weight: 600; }
  td:nth-child(2) { width: 26%; font-variant-numeric: tabular-nums; }
  .statement-section { margin-top: 20px; }
  .paired-statement { font-size: 12.5px; }
  .paired-statement col.statement-label { width: 31%; }
  .paired-statement col.statement-value { width: 19%; }
  .paired-statement thead tr:first-child th { padding: 9px; color: #6f1625; background: #fbeaf0; font-size: 15px; text-align: center; }
  .paired-statement thead tr:nth-child(2) th { font-size: 11px; }
  .paired-statement tbody th { width: auto; font-weight: 600; }
  .paired-statement .statement-amount { width: auto; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .paired-statement tbody tr:nth-child(even) { background: #fafcfa; }
  .paired-statement tr.statement-row--category,
  .paired-statement tr.statement-row--section { color: #176d69; background: #edf9f6; }
  .paired-statement tr.statement-row--subtotal { color: #176d69; background: #f4fbf9; font-weight: 700; }
  .paired-statement tr.statement-row--equity { color: #8b2445; background: #fbeaf0; font-weight: 700; }
  .paired-statement tr.statement-row--balance { color: #7a5313; background: #fff7df; font-weight: 700; }
  .paired-statement tr.statement-row--total { color: #fff; background: #6f1625; font-weight: 800; }
  .unit { color: #64736c; font-size: .9em; }
  ol, ul { padding-left: 1.45rem; }
  section, tr { break-inside: avoid; }
  footer { border-top: 1px solid #cfd8d3; margin-top: 26px; padding-top: 8px; color: #65736d; font-size: 11px; }
  @media screen { body { max-width: 900px; margin: 32px auto; padding: 0 22px; } }
</style></head><body>
<header><h1>${escapeHtml(normalized.title)}</h1><p>產生時間：${escapeHtml(normalized.generatedAt)}</p></header>
${meta}${statement}${sections}${assumptions}${notes}
<footer>本報告僅呈現輸入資料與試算結果，不構成投資、稅務、法律或授信建議。</footer>
</body></html>`;
}

/**
 * 在新視窗開啟排版報告並叫出列印對話框；使用者可選「另存為 PDF」。
 * 必須由使用者點擊事件直接呼叫，避免瀏覽器阻擋彈出視窗。
 */
export function printFinancialReport(report) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('瀏覽器已阻擋列印視窗，請允許此網站開啟彈出式視窗後再試一次。');
  }
  printWindow.document.open();
  printWindow.document.write(reportToPrintHtml(report));
  printWindow.document.close();
  printWindow.opener = null;
  const startPrint = () => {
    printWindow.focus();
    printWindow.print();
  };
  if (printWindow.document.readyState === 'complete') {
    setTimeout(startPrint, 0);
  } else {
    printWindow.addEventListener('load', startPrint, { once: true });
  }
  return printWindow;
}

