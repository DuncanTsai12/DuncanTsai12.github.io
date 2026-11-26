import {
  calculateCarLoan,
  calculateFinancialRatios,
  calculateMortgage,
  formatMoney,
  normalizeCashFlow,
  summarizeBalanceSheet,
} from './calculations.js';
import {
  calculateCreditCardRepayment,
  calculateRetirementPlan,
} from './planning-calculations.js';
import { calculateEducationPlan } from './education-calculations.js';
import {
  DATA_RETENTION_TEXT,
  clearData,
  loadData,
  saveData,
} from './storage.js';
import { downloadCsvReport, printFinancialReport } from './export.js';

const financePages = [
  ['balance-sheet', '資產負債表', '/finance/balance-sheet'],
  ['cash-flow', '現金流量表', '/finance/cash-flow'],
  ['education', '子女教育規劃', '/finance/education'],
  ['mortgage', '房貸', '/finance/mortgage'],
  ['personal-loan', '信貸', '/finance/personal-loan'],
  ['car-loan', '車貸', '/finance/car-loan'],
  ['credit-card', '信用卡', '/finance/credit-card'],
  ['retirement', '退休規劃', '/finance/retirement'],
];

const labels = {
  cash: '現金及約當現金',
  otherLiquidFunds: '其他流動資金',
  reserveLiquidInvestments: '可作備用的流動投資',
  otherInvestmentAssets: '其他投資資產',
  personalUseAssets: '個人使用資產',
  mortgage: '房貸餘額',
  carLoan: '車貸餘額',
  personalLoan: '信貸、學貸及保單貸款',
  creditCard: '信用卡未清償餘額',
  otherLiabilities: '其他負債',
  salary: '工作／薪資收入',
  bonus: '獎金收入',
  businessIncome: '自營／執業收入',
  investmentIncome: '投資收入',
  otherIncome: '其他收入',
  incomeTax: '所得稅',
  retirementContribution: '薪資扣繳退休金提撥',
  otherDeductions: '其他薪資扣繳',
  livingExpenses: '生活支出',
  insuranceExpenses: '保險支出',
  educationExpenses: '教育支出',
  savingsInvestment: '儲蓄及投資提撥',
  mortgagePayment: '房貸還款',
  nonMortgagePayment: '非房貸還款',
  otherExpenses: '其他支出',
};

const ratioPurposes = {
  liquidity: '衡量收入中斷或遇到緊急狀況時，可動用資金能支應幾個月總流出；基本結果著重現金與流動資金，備用結果著重可快速變現的投資。',
  savings: '衡量收入中實際留下並投入儲蓄或投資的比例，用來觀察收支餘裕與累積資產的速度。',
  'liquid-assets-to-net-worth': '衡量淨值中可立即或短期動用資產的比例，反映流動性與應急彈性。',
  'debt-to-assets': '衡量資產由負債支撐的比例，反映財務槓桿與債務侵蝕程度。',
  'debt-service': '衡量講義定義的淨收入中，有多少比例用於房貸與其他債務還款，反映整體還債壓力。',
  'non-mortgage-debt-service': '衡量講義定義的淨收入中，有多少比例用於車貸、信貸、學貸、信用卡等非房貸債務，反映消費性負債壓力。',
  'net-investment-assets-to-net-worth': '衡量淨值中配置於能帶來報酬之投資資產的比例，反映資產配置是否偏向長期成長。',
  solvency: '衡量總資產扣除負債後真正屬於自己的資產比例，反映長期償債能力與財務安全程度。',
};

const htmlEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatNumber = (value, digits = 0) => new Intl.NumberFormat('zh-TW', {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits,
}).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const money = (value) => formatMoney(Number(value) || 0);

const getPath = (target, path) => path.split('.').reduce((cursor, part) => cursor?.[part], target);

const detailRows = (value, fallbackLabel = '項目') => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && 'amount' in value) return [value];
  return [{ id: 'legacy-item', label: fallbackLabel, amount: Number(value) || 0 }];
};

const detailTotal = (value) => detailRows(value).reduce(
  (total, item) => total + Math.max(0, Number(item?.amount) || 0),
  0,
);

const migrationNotice = (...categoryGroups) => {
  const legacyRows = categoryGroups
    .flatMap((group) => Object.values(group || {}))
    .flatMap((value) => detailRows(value))
    .filter((item) => String(item?.label || '').startsWith('舊版'));
  if (!legacyRows.length) return '';
  return `<aside class="notice notice--warning migration-notice">
    <strong>舊版總額已完整保留</strong>
    <p>目前有 ${legacyRows.length} 筆「舊版合計（請拆分）」已納入總計。若要把金額分填到新明細，完成後請刪除原本的舊版合計，避免重複計算。</p>
  </aside>`;
};

const newDetailId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const routePage = (pathname) => {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'home';
  if (clean === '/insurance') return 'insurance';
  if (clean === '/finance') return 'finance-overview';
  const slug = clean.match(/^\/finance\/([^/]+)$/)?.[1];
  return slug || 'home';
};

const canonicalPage = (value) => ({
  finance: 'finance-overview',
  overview: 'finance-overview',
  balance: 'balance-sheet',
  cashflow: 'cash-flow',
  car: 'car-loan',
}[value] || value);

const page = canonicalPage(document.body.dataset.page || routePage(window.location.pathname));
const root = page === 'finance-overview'
  ? document.querySelector('#overview-analysis')
  : document.querySelector('#page-content') || document.querySelector('#app');
let data = loadData();

const setPath = (target, path, value) => {
  const parts = path.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
};

const financeNav = (active = page) => `
  <nav class="finance-nav" aria-label="財務規劃功能">
    <a class="finance-nav__overview${active === 'finance-overview' ? ' is-active' : ''}" href="/finance">財務總覽</a>
    <div class="finance-nav__links">
      ${financePages.map(([id, name, href]) => `<a${id === active ? ' class="is-active" aria-current="page"' : ''} href="${href}">${name}</a>`).join('')}
    </div>
  </nav>`;

const pageHeading = (eyebrow, title, description, status = '') => `
  <header class="page-heading">
    <div>
      <p class="eyebrow">${htmlEscape(eyebrow)}</p>
      <h1>${htmlEscape(title)}</h1>
      <p class="page-lead">${htmlEscape(description)}</p>
    </div>
    ${status ? `<span class="status-badge">${htmlEscape(status)}</span>` : ''}
  </header>`;

const privacyNote = () => `
  <aside class="privacy-note" aria-label="資料保存說明">
    <strong>只存於這個瀏覽器</strong>
    <p>${htmlEscape(DATA_RETENTION_TEXT)}</p>
  </aside>`;

const moneyInput = (path, label, value, help = '') => `
  <label class="form-field">
    <span>${htmlEscape(label)}</span>
    <span class="input-with-unit"><span aria-hidden="true">NT$</span><input type="number" min="0" step="1" inputmode="decimal" data-model="${path}" value="${Number(value) || 0}" aria-label="${htmlEscape(label)}"></span>
    ${help ? `<small>${htmlEscape(help)}</small>` : ''}
  </label>`;

const detailGroup = ({ path, key, value, help = '' }) => {
  const rows = detailRows(value, labels[key] || '項目');
  return `
    <article class="detail-group" data-detail-group="${htmlEscape(path)}">
      <header class="detail-group__header">
        <div><h3>${htmlEscape(labels[key] || key)}</h3>${help ? `<p>${htmlEscape(help)}</p>` : ''}</div>
        <span class="detail-group__total"><small>分類小計</small><strong data-detail-total="${htmlEscape(path)}">${money(detailTotal(rows))}</strong></span>
      </header>
      <div class="detail-list">
        ${rows.length ? rows.map((item, index) => `
          <div class="detail-row">
            <label class="detail-row__name">
              <span>項目名稱</span>
              <input type="text" data-model="${htmlEscape(`${path}.${index}.label`)}" value="${htmlEscape(item?.label || '')}" aria-label="${htmlEscape(labels[key] || key)}第 ${index + 1} 筆項目名稱" placeholder="請輸入項目名稱">
            </label>
            <label class="detail-row__amount">
              <span>金額</span>
              <span class="input-with-unit"><span aria-hidden="true">NT$</span><input type="number" min="0" step="1" inputmode="decimal" data-model="${htmlEscape(`${path}.${index}.amount`)}" value="${Number(item?.amount) > 0 ? Number(item.amount) : ''}" aria-label="${htmlEscape(item?.label || labels[key] || key)}金額" placeholder="輸入金額"></span>
            </label>
            <button class="detail-row__remove" type="button" data-action="remove-detail" data-collection="${htmlEscape(path)}" data-index="${index}" aria-label="刪除${htmlEscape(item?.label || '這個項目')}">刪除</button>
          </div>`).join('') : '<p class="detail-list__empty">目前沒有項目，可使用下方按鈕新增。</p>'}
      </div>
      <button class="button detail-group__add" type="button" data-action="add-detail" data-collection="${htmlEscape(path)}">＋ 新增項目</button>
    </article>`;
};

const detailGroups = (basePath, categories, helps = {}) => `
  <div class="detail-groups">
    ${Object.entries(categories || {}).map(([key, value]) => detailGroup({
      path: `${basePath}.${key}`,
      key,
      value,
      help: helps[key] || '',
    })).join('')}
  </div>`;

const numberInput = (path, label, value, { min = 0, step = 'any', unit = '', help = '' } = {}) => `
  <label class="form-field">
    <span>${htmlEscape(label)}</span>
    <span class="input-with-unit"><input type="number" min="${min}" step="${step}" inputmode="decimal" data-model="${path}" value="${Number(value) || 0}" aria-label="${htmlEscape(label)}">${unit ? `<span>${htmlEscape(unit)}</span>` : ''}</span>
    ${help ? `<small>${htmlEscape(help)}</small>` : ''}
  </label>`;

const selectInput = (path, label, value, options, help = '') => `
  <label class="form-field">
    <span>${htmlEscape(label)}</span>
    <select data-model="${path}" aria-label="${htmlEscape(label)}">
      ${options.map(([optionValue, optionLabel]) => `<option value="${htmlEscape(optionValue)}"${String(value) === String(optionValue) ? ' selected' : ''}>${htmlEscape(optionLabel)}</option>`).join('')}
    </select>
    ${help ? `<small>${htmlEscape(help)}</small>` : ''}
  </label>`;

const summaryCards = (items) => `
  <div class="summary-grid">
    ${items.map(({ label, value, note = '', tone = '' }) => `
      <article class="summary-card${tone ? ` summary-card--${tone}` : ''}">
        <span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong>${note ? `<small>${htmlEscape(note)}</small>` : ''}
      </article>`).join('')}
  </div>`;

const reportExportControl = ({ report, label, compact = false }) => `
  <div class="report-export${compact ? ' report-export--compact' : ''} no-print" data-export-control>
    <label>
      <span>產出格式</span>
      <select data-export-format aria-label="${htmlEscape(label)}產出格式">
        <option value="pdf">PDF（列印／存成 PDF）</option>
        <option value="csv">CSV（試算表可開啟）</option>
      </select>
    </label>
    <button class="button ${compact ? 'button--secondary secondary' : 'button--primary'}" type="button" data-action="export-report" data-report="${htmlEscape(report)}">產出${htmlEscape(label)}</button>
  </div>`;

const analysisActions = (complete = false) => complete ? `
  <div class="complete-analysis-actions no-print">
    <div><strong>產出完整財務分析</strong><p>包含兩張財務表摘要及全部八項比率；上方也可分別產出單一報表。</p></div>
    <div class="action-row button-row">
      <button class="button button--primary" type="button" data-action="print">完整分析：列印／存成 PDF</button>
      <button class="button button--secondary secondary" type="button" data-action="csv">完整分析：下載 CSV</button>
      <button class="button button--quiet danger" type="button" data-action="clear">清除本機資料</button>
    </div>
  </div>` : `
  <div class="action-row button-row no-print">
    <button class="button button--primary" type="button" data-action="print">列印／存成 PDF</button>
    <button class="button button--secondary secondary" type="button" data-action="csv">下載 CSV（試算表可開啟）</button>
    <button class="button button--quiet danger" type="button" data-action="clear">清除本機資料</button>
  </div>`;

const formulaNotice = () => `
  <aside class="notice notice--confirmed">
    <strong>公式已依講義核對</strong>
    <p>八項比率已依《財務規劃資料part1》逐項核對。流動資金比率採每月總流出（扣繳＋支出）；儲蓄比率預設不含退休金；兩個償債比率的淨收入只扣所得稅與退休金。講義未另列的門檻仍明確標示「待確認」。</p>
  </aside>`;

const currentAnalysis = () => {
  const balance = summarizeBalanceSheet(data.balanceSheet);
  const cashFlow = normalizeCashFlow(data.cashFlow);
  const ratios = calculateFinancialRatios(balance, cashFlow, { formulaStatus: '已依講義確認' });
  return { balance, cashFlow, ratios };
};

const statementDetailRows = (categories) => Object.entries(categories || {}).flatMap(([key, value]) => {
  const categoryLabel = labels[key] || key;
  const rows = detailRows(value, categoryLabel);
  return [
    { label: categoryLabel, value: '', type: 'category' },
    ...rows.map((item) => ({
      label: String(item?.label || '').trim() || '未命名項目',
      value: money(item?.amount),
      type: 'detail',
    })),
    { label: `${categoryLabel}小計`, value: money(detailTotal(rows)), type: 'subtotal' },
  ];
});

const alignStatementTotals = (leftBody, rightBody, leftTotal, rightTotal) => {
  const bodyLength = Math.max(leftBody.length, rightBody.length);
  const spacer = () => ({ label: '', value: '', type: 'spacer' });
  return {
    leftRows: [
      ...leftBody,
      ...Array.from({ length: bodyLength - leftBody.length }, spacer),
      leftTotal,
    ],
    rightRows: [
      ...rightBody,
      ...Array.from({ length: bodyLength - rightBody.length }, spacer),
      rightTotal,
    ],
  };
};

const balanceStatementData = () => {
  const balance = summarizeBalanceSheet(data.balanceSheet);
  const leftBody = statementDetailRows(data.balanceSheet.assets);
  const rightBody = [
    ...statementDetailRows(data.balanceSheet.liabilities),
    { label: '權益', value: '', type: 'category' },
    { label: '個人淨值（權益）', value: money(balance.netWorth), type: 'equity' },
  ];
  const { leftRows, rightRows } = alignStatementTotals(
    leftBody,
    rightBody,
    { label: '總資產', value: money(balance.totalAssets), type: 'total' },
    { label: '負債及權益合計', value: money(balance.totalAssets), type: 'total' },
  );
  return {
    kind: 'balance-sheet',
    left: { title: '資產', rows: leftRows },
    right: { title: '負債及權益', rows: rightRows },
  };
};

const cashFlowStatementData = () => {
  const cashFlow = normalizeCashFlow(data.cashFlow);
  const current = cashFlow[cashFlow.period];
  const leftBody = statementDetailRows(data.cashFlow.income);
  const rightBody = [
    { label: '稅與薪資扣繳', value: '', type: 'section' },
    ...statementDetailRows(data.cashFlow.deductions),
    { label: '支出與提撥', value: '', type: 'section' },
    ...statementDetailRows(data.cashFlow.expenses),
  ];
  leftBody.push({ label: '總收入', value: money(current.grossIncome), type: 'subtotal' });
  rightBody.push({ label: '扣繳與支出合計', value: money(current.totalOutflows), type: 'subtotal' });
  if (current.cashBalance >= 0) {
    rightBody.push({ label: '本期現金結餘', value: money(current.cashBalance), type: 'balance' });
  } else {
    leftBody.push({ label: '本期現金短缺', value: money(Math.abs(current.cashBalance)), type: 'balance' });
  }
  const balancedTotal = Math.max(current.grossIncome, current.totalOutflows);
  const { leftRows, rightRows } = alignStatementTotals(
    leftBody,
    rightBody,
    { label: '收入及短缺合計', value: money(balancedTotal), type: 'total' },
    { label: '扣繳、支出及結餘合計', value: money(balancedTotal), type: 'total' },
  );
  return {
    kind: 'cash-flow',
    left: { title: `收入（${cashFlow.periodLabel}）`, rows: leftRows },
    right: { title: `扣繳與支出（${cashFlow.periodLabel}）`, rows: rightRows },
  };
};

const statementCellHtml = (row, cellTag) => {
  const type = row?.type || 'spacer';
  const label = row?.label || '';
  const value = row?.value || '';
  return `<${cellTag} class="statement-table__label" data-row-type="${htmlEscape(type)}"${cellTag === 'th' ? ' scope="row"' : ''}>${htmlEscape(label)}</${cellTag}><td class="statement-table__amount" data-row-type="${htmlEscape(type)}">${htmlEscape(value)}</td>`;
};

const statementPreviewHtml = (statement, label) => {
  const rowCount = Math.max(statement.left.rows.length, statement.right.rows.length);
  return `<div class="statement-preview" aria-label="${htmlEscape(label)}左右式報表預覽">
    <div class="statement-table-wrap" tabindex="0">
      <table class="statement-table">
        <caption>${htmlEscape(label)}｜左側為${htmlEscape(statement.left.title)}，右側為${htmlEscape(statement.right.title)}</caption>
        <thead><tr><th colspan="2" scope="colgroup">${htmlEscape(statement.left.title)}</th><th colspan="2" scope="colgroup">${htmlEscape(statement.right.title)}</th></tr></thead>
        <tbody>${Array.from({ length: rowCount }, (_, index) => {
          const leftRow = statement.left.rows[index] || { type: 'spacer' };
          const rightRow = statement.right.rows[index] || { type: 'spacer' };
          return `<tr>${statementCellHtml(leftRow, 'th')}${statementCellHtml(rightRow, 'th')}</tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>`;
};

const ratioHtml = () => {
  const { ratios } = currentAnalysis();
  return `<div class="ratio-grid metrics-grid">${ratios.map((ratio) => `
    <article class="ratio-card metric-card" id="ratio-${ratio.id}">
      <header><h3>${htmlEscape(ratio.name)}</h3><span class="status-badge ${String(ratio.formulaStatus).includes('待確認') ? 'status-badge--pending' : 'is-ready'}">${htmlEscape(ratio.formulaStatus)}</span></header>
      <p class="ratio-purpose"><strong>衡量用途：</strong>${htmlEscape(ratioPurposes[ratio.id] || ratio.description || '用來觀察這項財務結構及其可能帶來的風險。')}</p>
      <div class="ratio-card__results">
        ${ratio.results.map((result) => `
          <section class="ratio-result${result.status === 'ok' ? '' : ' ratio-result--missing'}">
            <div><span>${htmlEscape(result.label)}</span><strong>${htmlEscape(result.formattedValue)}</strong></div>
            <p class="formula"><span>公式</span>${htmlEscape(result.formula)}</p>
            ${result.status === 'ok'
              ? `<p class="substitution"><span>帶入</span>${htmlEscape(result.substitution)}</p>`
              : `<p class="reason"><span>原因</span>${htmlEscape(result.reason)}</p>`}
            ${result.benchmark ? `<p class="benchmark"><span>講義基準</span>${htmlEscape(result.benchmark)}</p>` : ''}
            ${result.assessment ? `<p class="assessment assessment--${htmlEscape(result.assessmentTone || 'neutral')}"><span>判讀</span>${htmlEscape(result.assessment)}</p>` : ''}
            ${result.warning ? `<p class="reason">${htmlEscape(result.warning)}</p>` : ''}
          </section>`).join('')}
      </div>
      ${ratio.netIncomeDefinition ? `<p class="ratio-note"><strong>講義淨收入：</strong>${htmlEscape(ratio.netIncomeDefinition)}</p>` : ''}
      ${ratio.assumption ? `<p class="ratio-note"><strong>資料欄位假設（待確認）：</strong>${htmlEscape(ratio.assumption)}</p>` : ''}
      ${reportExportControl({ report: `ratio:${ratio.id}`, label: `${ratio.name}報告`, compact: true })}
    </article>`).join('')}</div>`;
};

const ratioSection = () => `
  <section class="content-section panel" aria-labelledby="ratio-title">
    <div class="section-heading panel-header"><div><p class="eyebrow">共用分析資料</p><h2 id="ratio-title">八項個人財務比率</h2></div><span>金額已統一換算期間</span></div>
    ${formulaNotice()}
    <div id="ratio-output">${ratioHtml()}</div>
  </section>`;

const renderHome = () => `
  <div class="home-page">
    ${pageHeading('客戶面談工具', '櫻木財務規劃', '用清楚的資料、公式與假設，陪客戶看見下一步。')}
    <section class="portal-grid" aria-label="主功能入口">
      <a class="portal-card portal-card--finance" href="/finance">
        <span class="portal-card__index">01</span><div><p>本次已開放</p><h2>財務規劃</h2><span>資產、現金流、比率與貸款試算</span></div>
      </a>
      <a class="portal-card portal-card--insurance" href="/insurance">
        <span class="portal-card__index">02</span><div><p>獨立入口</p><h2>保單健診</h2><span>頁面已預留，需求確認後設計</span></div>
      </a>
    </section>
    ${privacyNote()}
  </div>`;

const featureNotes = {
  'balance-sheet': '已完成｜資產、負債與淨值',
  'cash-flow': '已完成｜月／年現金流',
  education: '已完成｜學費目標與反推投入',
  mortgage: '已完成｜本息平均攤還',
  'personal-loan': '待補試算規格',
  'car-loan': '已完成｜兩種計息方式',
  'credit-card': '已完成｜兩種清償方式',
  retirement: '已完成｜退休終值與今日購買力',
};

const overviewSnapshot = () => {
  const { balance, cashFlow } = currentAnalysis();
  return summaryCards([
    { label: '總資產', value: money(balance.totalAssets) },
    { label: '總負債', value: money(balance.totalLiabilities) },
    { label: '個人淨值', value: money(balance.netWorth), tone: balance.netWorth < 0 ? 'negative' : 'positive' },
    { label: `現金結餘（${cashFlow.periodLabel}）`, value: money(cashFlow[cashFlow.period].cashBalance), tone: cashFlow[cashFlow.period].cashBalance < 0 ? 'negative' : 'positive' },
  ]);
};

const renderFinanceOverview = () => `
  <section class="content-section panel">
    <div class="section-heading panel-header"><div><p class="eyebrow">目前快照</p><h2>財務全貌</h2></div></div>
    <div id="overview-output">${overviewSnapshot()}</div>
  </section>
  ${ratioSection()}
  ${analysisActions(true)}`;

const balanceSummary = () => {
  const result = summarizeBalanceSheet(data.balanceSheet);
  return summaryCards([
    { label: '總資產', value: money(result.totalAssets) },
    { label: '總負債', value: money(result.totalLiabilities) },
    { label: '個人淨值', value: money(result.netWorth), tone: result.netWorth < 0 ? 'negative' : 'positive' },
  ]);
};

const renderBalanceSheet = () => {
  const value = data.balanceSheet;
  return `
      <form class="calculator-form" id="balance-form">
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">盤點日期</p><h2>分析基準日</h2></div></div>
          <label class="form-field form-field--date"><span>基準日</span><input type="date" data-model="balanceSheet.asOfDate" value="${htmlEscape(value.asOfDate)}"></label>
        </section>
        ${migrationNotice(value.assets, value.liabilities)}
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">Assets</p><h2>資產</h2></div><span>金額｜新臺幣</span></div>
          <p class="definition-note">講義中的常用項目已全部展開。項目名稱可以直接修改，也可在每個分類中新增或刪除明細。</p>
          ${detailGroups('balanceSheet.assets', value.assets, {
            cash: '現金、活期與支票存款等，可立即動用的資金。',
            otherLiquidFunds: '定期存款、外幣存款與可較快取回的保單現金價值等。',
            reserveLiquidInvestments: '需要時可較快變現，且未重複列入基本流動資金的投資。',
            otherInvestmentAssets: '以累積報酬或增值為目的、流動性較低的投資資產。',
            personalUseAssets: '自用住宅、交通工具及個人收藏等非投資用途資產。',
          })}
        </section>
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">Liabilities</p><h2>負債</h2></div><span>未償還本金｜新臺幣</span></div>
          <p class="definition-note">請填目前尚未清償的餘額；同一類有多筆貸款時，可逐筆新增以保留完整明細。</p>
          ${detailGroups('balanceSheet.liabilities', value.liabilities)}
        </section>
      </form>
      <section class="content-section panel"><div class="section-heading panel-header"><div><p class="eyebrow">即時計算</p><h2>資產負債摘要</h2></div></div><div id="balance-output">${balanceSummary()}</div></section>
      <section class="content-section panel statement-panel" aria-labelledby="balance-statement-title">
        <div class="section-heading panel-header"><div><p class="eyebrow">Accounting format</p><h2 id="balance-statement-title">資產負債表</h2></div><span>左：資產｜右：負債＋權益</span></div>
        <p class="definition-note">個人淨值列為權益；負債及權益合計會與總資產相等。</p>
        <div id="balance-statement-output">${statementPreviewHtml(balanceStatementData(), '資產負債表')}</div>
        ${reportExportControl({ report: 'balance-sheet', label: '資產負債表' })}
      </section>
      ${ratioSection()}
      ${analysisActions(true)}`;
};

const cashFlowSummary = () => {
  const result = normalizeCashFlow(data.cashFlow);
  const current = result[result.period];
  const alternate = result.period === 'monthly' ? result.annual : result.monthly;
  const alternateLabel = result.period === 'monthly' ? '換算年額' : '換算月額';
  const debtNetIncomeDefinition = result.debtServiceNetIncomeDefinition
    || result.ratioNetIncomeDefinition
    || '總收入－所得稅－薪資扣繳退休金提撥';
  return `
    ${summaryCards([
      { label: `總收入（${result.periodLabel}）`, value: money(current.grossIncome) },
      { label: `淨收入（全部扣繳後／${result.periodLabel}）`, value: money(current.netIncome) },
      { label: `支出（${result.periodLabel}）`, value: money(current.totalExpenses) },
      { label: `總流出（含扣繳／${result.periodLabel}）`, value: money(current.totalOutflows ?? (current.totalDeductions + current.totalExpenses)) },
      { label: `現金結餘（${result.periodLabel}）`, value: money(current.cashBalance), tone: current.cashBalance < 0 ? 'negative' : 'positive' },
    ])}
    <div class="conversion-strip"><strong>${alternateLabel}</strong><span>收入 ${money(alternate.grossIncome)}</span><span>淨收入 ${money(alternate.netIncome)}</span><span>支出 ${money(alternate.totalExpenses)}</span><span>總流出 ${money(alternate.totalOutflows ?? (alternate.totalDeductions + alternate.totalExpenses))}</span><span>結餘 ${money(alternate.cashBalance)}</span></div>
    <p class="definition-note">一般現金流淨收入：${htmlEscape(result.netIncomeDefinition)}。兩個償債比率另依講義使用：${htmlEscape(debtNetIncomeDefinition)}。</p>`;
};

const renderCashFlow = () => {
  const value = data.cashFlow;
  return `
      <form class="calculator-form" id="cash-flow-form">
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">期間設定</p><h2>這批金額的期間</h2></div></div>
          ${selectInput('cashFlow.period', '輸入期間', value.period, [['monthly', '每月金額'], ['annual', '每年金額']], '切換期間不會自動改寫已輸入數字；請確認數字本身與所選期間一致。')}
        </section>
        ${migrationNotice(value.income, value.deductions, value.expenses)}
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">Income</p><h2>收入</h2></div><span class="period-token">${value.period === 'annual' ? '每年' : '每月'}｜新臺幣</span></div>
          <p class="definition-note">工作收入、年終獎金、投資與其他收入均可逐筆填寫；項目名稱可修改，也可自行新增。</p>
          ${detailGroups('cashFlow.income', value.income)}
        </section>
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">Deductions</p><h2>稅與薪資扣繳</h2></div><span class="period-token">${value.period === 'annual' ? '每年' : '每月'}｜新臺幣</span></div>
          ${detailGroups('cashFlow.deductions', value.deductions, {
            incomeTax: '會扣除於一般淨收入及講義償債比率的淨收入。',
            retirementContribution: '會扣除於兩種淨收入；儲蓄比率預設不納入此項。',
            otherDeductions: '會扣除於一般現金流淨收入，但講義的兩個償債比率不扣除此分類。',
          })}
        </section>
        <section class="content-section panel form-section">
          <div class="section-heading panel-header"><div><p class="eyebrow">Outflows</p><h2>支出與提撥</h2></div><span class="period-token">${value.period === 'annual' ? '每年' : '每月'}｜新臺幣</span></div>
          <p class="definition-note">講義的固定與非固定支出均已完整列入；房貸與非房貸還款另外分列，其餘依生活、保險、教育、儲蓄投資等用途歸類。可再新增個人專屬項目。</p>
          ${detailGroups('cashFlow.expenses', value.expenses)}
        </section>
      </form>
      <section class="content-section panel"><div class="section-heading panel-header"><div><p class="eyebrow">即時計算</p><h2>現金流摘要</h2></div></div><div id="cash-flow-output">${cashFlowSummary()}</div></section>
      <section class="content-section panel statement-panel" aria-labelledby="cash-flow-statement-title">
        <div class="section-heading panel-header"><div><p class="eyebrow">Accounting format</p><h2 id="cash-flow-statement-title">現金流量表</h2></div><span>左：收入｜右：扣繳＋支出</span></div>
        <p class="definition-note">現金結餘列在右側；若本期為現金短缺，則改列左側，讓左右合計相等。</p>
        <div id="cash-flow-statement-output">${statementPreviewHtml(cashFlowStatementData(), '現金流量表')}</div>
        ${reportExportControl({ report: 'cash-flow', label: '現金流量表' })}
      </section>
      ${ratioSection()}
      ${analysisActions(true)}`;
};

const loanSchedule = (result) => `
  <div class="table-wrap" tabindex="0" aria-label="逐期攤還明細，可橫向捲動">
    <table class="schedule-table">
      <thead><tr><th>期數</th><th>本期付款</th><th>償還本金</th><th>利息</th><th>剩餘本金</th></tr></thead>
      <tbody>${result.schedule.map((row) => `<tr><th scope="row">${row.period}</th><td>${money(row.payment)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.remainingPrincipal)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;

const loanResult = (kind) => {
  try {
    const source = kind === 'mortgage' ? data.mortgage : data.carLoan;
    const result = kind === 'mortgage'
      ? calculateMortgage({ ...source, precision: 2 })
      : calculateCarLoan({ ...source, precision: 2 });
    const feeNote = kind === 'car-loan'
      ? `<p class="definition-note">計息本金：${money(result.financedPrincipal)}；費用 ${result.includeFees ? '已納入融資本金' : `未納入本金，另計 ${money(result.excludedFees)}`}。</p>`
      : '';
    return `
      <div class="loan-method"><span>使用方式</span><strong>${htmlEscape(result.methodLabel)}</strong><span>${result.paymentsPerYear === 12 ? '每月' : `每年 ${result.paymentsPerYear} 次`}／${result.paymentTiming === 'beginning' ? '期初' : '期末'}繳款</span></div>
      ${summaryCards([
        { label: '每期付款', value: money(result.periodicPayment) },
        { label: '總利息', value: money(result.totalInterest) },
        { label: '總還款金額', value: money(result.totalPayments) },
        { label: kind === 'car-loan' ? '含未融資費用總成本' : '總期數', value: kind === 'car-loan' ? money(result.totalCostIncludingExcludedFees) : `${formatNumber(result.periods)} 期` },
      ])}
      ${feeNote}
      <div class="section-heading schedule-heading"><div><p class="eyebrow">Amortization</p><h2>逐期本金、利息與餘額</h2></div><span>共 ${result.schedule.length} 期</span></div>
      ${loanSchedule(result)}`;
  } catch (error) {
    return `<div class="empty-state empty-state--error"><strong>目前無法計算</strong><p>${htmlEscape(error.message)}</p></div>`;
  }
};

const frequencyOptions = [['12', '每月（每年 12 次）'], ['4', '每季（每年 4 次）'], ['2', '每半年（每年 2 次）'], ['1', '每年 1 次']];
const timingOptions = [['end', '期末繳款'], ['beginning', '期初繳款']];

const renderMortgage = () => {
  const value = data.mortgage;
  return `
    <form class="calculator-form" id="mortgage-form"><section class="content-section panel form-section">
      <div class="section-heading panel-header"><div><p class="eyebrow">求解設定</p><h2>先選要計算的結果</h2></div><span>反推功能待後續規格</span></div>
      <div class="form-grid">
        ${selectInput('', '想求的結果', 'payment', [['payment', '每期付款（目前已實作）']], '反推本金、利率或期數將在試算規格確認後加入。').replace(' data-model=""', ' disabled')}
        ${moneyInput('mortgage.principal', '貸款本金', value.principal)}
        ${numberInput('mortgage.annualRate', '名目年利率', value.annualRate, { step: '0.01', unit: '%' })}
        ${numberInput('mortgage.termYears', '貸款期間', value.termYears, { step: '0.5', unit: '年' })}
        ${selectInput('mortgage.paymentsPerYear', '繳款頻率', value.paymentsPerYear, frequencyOptions)}
        ${selectInput('mortgage.paymentTiming', '繳款時點', value.paymentTiming, timingOptions)}
      </div>
      <aside class="assumption-box"><strong>主要假設</strong><p>利率在全期固定、每期等額本息、未計入開辦費與提前清償；實際貸款仍以金融機構契約為準。</p></aside>
    </section></form>
    <section class="content-section panel"><div id="loan-output">${loanResult('mortgage')}</div></section>
    ${analysisActions()}`;
};

const renderCarLoan = () => {
  const value = data.carLoan;
  return `
    <form class="calculator-form" id="car-loan-form"><section class="content-section panel form-section">
      <div class="section-heading panel-header"><div><p class="eyebrow">求解設定</p><h2>試算條件</h2></div><span>反推功能待後續規格</span></div>
      <div class="form-grid">
        ${selectInput('', '想求的結果', 'payment', [['payment', '每期付款（目前已實作）']], '反推本金、利率或期數將在試算規格確認後加入。').replace(' data-model=""', ' disabled')}
        ${selectInput('carLoan.method', '計息方式', value.method, [['flat', '本金固定計息（原始本金計息）'], ['equal-payment', '本息平均攤還']])}
        ${moneyInput('carLoan.principal', '車價融資本金', value.principal)}
        ${numberInput('carLoan.annualRate', '名目年利率', value.annualRate, { step: '0.01', unit: '%' })}
        ${numberInput('carLoan.termYears', '貸款期間', value.termYears, { step: '0.5', unit: '年' })}
        ${selectInput('carLoan.paymentsPerYear', '繳款頻率', value.paymentsPerYear, frequencyOptions)}
        ${selectInput('carLoan.paymentTiming', '繳款時點', value.paymentTiming, timingOptions, '本金固定計息不因期初／期末改變；本息平均攤還才會使用此設定。')}
        ${moneyInput('carLoan.fees', '一次性費用', value.fees)}
        <label class="form-field form-field--checkbox"><input type="checkbox" data-model="carLoan.includeFees"${value.includeFees ? ' checked' : ''}><span>把一次性費用納入融資本金計息</span></label>
      </div>
      <aside class="assumption-box"><strong>兩種方式的差異</strong><p>本金固定計息按原始融資本金計算每期利息；本息平均攤還按每期剩餘本金計息。費用是否納入本金會直接影響總成本。</p></aside>
      <p class="definition-note">本金固定計息的總利息依「原始融資本金 × 年利率 × 年數」計算；逐期顯示取至小數兩位，最後一期會吸收分角尾差。</p>
    </section></form>
    <section class="content-section panel"><div id="loan-output">${loanResult('car-loan')}</div></section>
    ${analysisActions()}`;
};

const educationCalculation = () => calculateEducationPlan({ ...data.education, precision: 2 });

const educationSchedule = (result) => `
  <div class="table-wrap" tabindex="0" aria-label="各學年預估教育費，可橫向捲動">
    <table class="schedule-table">
      <thead><tr><th>學年</th><th>距現在付款年數</th><th>該年名目教育費</th></tr></thead>
      <tbody>${result.schedule.map((row) => `<tr><th scope="row">第 ${row.academicYear} 學年</th><td>${formatNumber(row.paymentYear, 1)} 年後</td><td>${money(row.tuition)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;

const educationResult = () => {
  try {
    const result = educationCalculation();
    const frequencyLabel = result.paymentsPerYear === 12
      ? '每月'
      : `每年 ${formatNumber(result.paymentsPerYear)} 次`;
    return `
      <div class="loan-method"><span>想求的結果</span><strong>反推每期投入</strong><span>${frequencyLabel}／${result.paymentTiming === 'beginning' ? '期初' : '期末'}投入</span></div>
      ${summaryCards([
        { label: `${frequencyLabel}所需投入`, value: money(result.requiredPeriodicContribution), tone: 'positive' },
        { label: '依講義保守名目總需求', value: money(result.inflatedTuitionTotal) },
        { label: '既有基金入學時終值', value: money(result.existingFundFutureValue) },
        { label: '尚需準備缺口', value: money(result.fundingGap), tone: result.fundingGap > 0 ? 'negative' : 'positive' },
        { label: '準備期數', value: `${formatNumber(result.periods)} 期` },
      ])}
      <div class="formula-panel">
        <p class="formula"><span>各學年教育費</span>今日每年教育費 ×（1＋教育費年成長率）^付款年數</p>
        <p class="substitution"><span>依講義保守名目總需求</span>${result.schedule.map((row) => money(row.tuition)).join(' ＋ ')} ＝ ${money(result.inflatedTuitionTotal)}</p>
        <p class="formula"><span>資金缺口</span>依講義保守名目總需求－既有教育基金入學時終值</p>
        <p class="formula"><span>反推每期投入</span>資金缺口 ÷ 年金終值因子${result.paymentTiming === 'beginning' ? '（含期初投入調整）' : ''} ＝ ${money(result.requiredPeriodicContribution)}</p>
      </div>
      <div class="section-heading schedule-heading"><div><p class="eyebrow">Tuition schedule</p><h2>各學年未來教育費</h2></div><span>共 ${result.schedule.length} 學年</span></div>
      ${educationSchedule(result)}
      <aside class="assumption-box"><strong>主要假設</strong><ul>${result.assumptions.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul></aside>`;
  } catch (error) {
    return `<div class="empty-state empty-state--error"><strong>目前無法計算</strong><p>${htmlEscape(error.message)}</p></div>`;
  }
};

const renderEducation = () => {
  const value = data.education;
  return `
    <form class="calculator-form" id="education-form"><section class="content-section panel form-section">
      <div class="section-heading panel-header"><div><p class="eyebrow">求解設定</p><h2>教育基金準備</h2></div><span>Part3 教育案例</span></div>
      <div class="form-grid">
        ${selectInput('', '想求的結果', 'required-contribution', [['required-contribution', '每期所需投入（目前已實作）']], '目標金額與準備期反推可在後續需求確認後加入。').replace(' data-model=""', ' disabled')}
        ${moneyInput('education.annualTuitionToday', '今日每年教育費', value.annualTuitionToday)}
        ${numberInput('education.tuitionGrowthRate', '教育費年成長率', value.tuitionGrowthRate, { step: '0.01', unit: '%' })}
        ${numberInput('education.yearsUntilEnrollment', '距離入學年數', value.yearsUntilEnrollment, { step: '1', unit: '年' })}
        ${numberInput('education.studyYears', '就學年數', value.studyYears, { min: 1, step: '1', unit: '年' })}
        ${numberInput('education.investmentAnnualRate', '準備資金名目年報酬率', value.investmentAnnualRate, { step: '0.01', unit: '%' })}
        ${moneyInput('education.existingFund', '既有教育基金', value.existingFund)}
        ${selectInput('education.paymentsPerYear', '投入頻率', value.paymentsPerYear, frequencyOptions)}
        ${selectInput('education.paymentTiming', '投入時點', value.paymentTiming, [['beginning', '期初投入'], ['end', '期末投入']])}
      </div>
      <aside class="assumption-box"><strong>講義計算邊界</strong><p>依 Part3 的保守作法，把所有學年的未來名目教育費合計視為入學時要備妥的目標；未計入就學期間尚未支用資金的報酬。</p></aside>
    </section></form>
    <section class="content-section panel"><div class="section-heading panel-header"><div><p class="eyebrow">即時計算</p><h2>教育基金結果</h2></div></div><div id="education-output">${educationResult()}</div></section>
    ${analysisActions()}`;
};

const creditCardCalculation = () => calculateCreditCardRepayment({ ...data.creditCardPlan, precision: 2 });

const creditCardSchedule = (result) => `
  <div class="table-wrap" tabindex="0" aria-label="信用卡逐期清償明細，可橫向捲動">
    <table class="schedule-table">
      <thead><tr><th>期數</th><th>期初餘額</th><th>本期付款</th><th>本金淨減少</th><th>利息</th><th>期末餘額</th></tr></thead>
      <tbody>${result.schedule.map((row) => `<tr><th scope="row">${row.period}</th><td>${money(row.openingBalance)}</td><td>${money(row.payment)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.closingBalance)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;

const creditCardResult = () => {
  try {
    const result = creditCardCalculation();
    const frequencyLabel = result.paymentsPerYear === 12
      ? '每月'
      : `每年 ${formatNumber(result.paymentsPerYear)} 次`;
    const methodFormula = result.repaymentMode === 'fixed'
      ? '每期先按期初未償餘額計息，再以固定付款償還利息及本金。'
      : '每期先支付「期初餘額 × 最低比例」與最低金額之較高者，再對付款後餘額計息。';
    return `
      <div class="loan-method"><span>使用方式</span><strong>${htmlEscape(result.methodLabel)}</strong><span>${frequencyLabel}還款</span></div>
      ${summaryCards([
        { label: '清償期數', value: `${formatNumber(result.periods)} 期` },
        { label: '總利息', value: money(result.totalInterest) },
        { label: '總付款', value: money(result.totalPayments) },
        { label: '輸入年率換算有效年率', value: `${formatNumber(result.effectiveAnnualRate * 100, 3)}%` },
      ])}
      <div class="formula-panel">
        <p class="formula"><span>本模式順序</span>${htmlEscape(methodFormula)}</p>
        <p class="formula"><span>每期利率</span>${formatNumber(result.nominalAnnualRate * 100, 3)}% ÷ ${formatNumber(result.paymentsPerYear)} ＝ ${formatNumber(result.periodicRate * 100, 4)}%</p>
        <p class="formula"><span>複利有效年率</span>（1＋每期利率）^每年付款次數－1 ＝ ${formatNumber(result.effectiveAnnualRate * 100, 3)}%</p>
      </div>
      <p class="definition-note">固定付款模式只使用「固定每期付款」；最低比例模式只使用「最低還款比例」與「最低還款金額」。未使用的欄位會保留，方便切換比較。講義的 18.157% 是把 24 期都視為完整 NT$1,000 後，反推月 IRR 再乘 12 的近似名目年化；本頁的有效年率則只依輸入名目年率按期複利換算。</p>
      <div class="section-heading schedule-heading"><div><p class="eyebrow">Repayment</p><h2>逐期清償明細</h2></div><span>共 ${result.schedule.length} 期</span></div>
      ${creditCardSchedule(result)}
      <aside class="assumption-box"><strong>主要假設</strong><ul>${result.assumptions.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul></aside>`;
  } catch (error) {
    return `<div class="empty-state empty-state--error"><strong>目前無法計算</strong><p>${htmlEscape(error.message)}</p></div>`;
  }
};

const renderCreditCard = () => {
  const value = data.creditCardPlan;
  return `
    <form class="calculator-form" id="credit-card-form"><section class="content-section panel form-section">
      <div class="section-heading panel-header"><div><p class="eyebrow">求解設定</p><h2>循環餘額清償</h2></div><span>Part3 信用卡案例</span></div>
      <div class="form-grid">
        ${selectInput('creditCardPlan.repaymentMode', '還款方式', value.repaymentMode, [['fixed', '固定每期付款'], ['percentage', '最低比例／最低金額']])}
        ${moneyInput('creditCardPlan.balance', '信用卡未清償餘額', value.balance)}
        ${numberInput('creditCardPlan.nominalAnnualRate', '名目年利率', value.nominalAnnualRate, { step: '0.01', unit: '%' })}
        ${selectInput('creditCardPlan.paymentsPerYear', '繳款頻率', value.paymentsPerYear, frequencyOptions)}
        ${moneyInput('creditCardPlan.fixedPayment', '固定每期付款', value.fixedPayment, '只供固定每期付款模式使用；必須高於首期利息。')}
        ${numberInput('creditCardPlan.minimumPaymentPercent', '最低還款比例', value.minimumPaymentPercent, { step: '0.01', unit: '%', help: '只供最低比例／最低金額模式使用。' })}
        ${moneyInput('creditCardPlan.minimumPaymentFloor', '最低還款金額', value.minimumPaymentFloor, '只供最低比例／最低金額模式使用。')}
      </div>
      <aside class="assumption-box"><strong>兩種模式</strong><p>固定付款採先計息再還款；最低比例模式依講義表格採先付款、再對付款後餘額計息。未計新增刷卡、手續費、違約金或年費。</p></aside>
    </section></form>
    <section class="content-section panel"><div class="section-heading panel-header"><div><p class="eyebrow">即時計算</p><h2>清償結果</h2></div></div><div id="credit-card-output">${creditCardResult()}</div></section>
    ${analysisActions()}`;
};

const retirementCalculation = () => {
  const result = calculateRetirementPlan({ ...data.retirement, precision: 2 });
  const realAfterTaxRate = ((1 + result.afterTaxAnnualRate) / (1 + result.inflationRate)) - 1;
  return { ...result, realAfterTaxRate };
};

const retirementResult = () => {
  try {
    const result = retirementCalculation();
    const frequencyLabel = result.paymentsPerYear === 1
      ? '每年 1 次'
      : `每年 ${formatNumber(result.paymentsPerYear)} 次`;
    return `
      <div class="loan-method"><span>使用方式</span><strong>稅後定期投入終值</strong><span>${frequencyLabel}／${result.paymentTiming === 'beginning' ? '期初' : '期末'}投入</span></div>
      ${summaryCards([
        { label: '退休時累積終值', value: money(result.futureValue), tone: 'positive' },
        { label: '折算今日購買力', value: money(result.presentPurchasingPower) },
        { label: '投入本金合計', value: money(result.contributions) },
        { label: '投資成長', value: money(result.investmentGrowth), tone: result.investmentGrowth < 0 ? 'negative' : 'positive' },
        { label: '稅後名目年報酬率', value: `${formatNumber(result.afterTaxAnnualRate * 100, 3)}%` },
        { label: '稅後實質年報酬率', value: `${formatNumber(result.realAfterTaxRate * 100, 3)}%` },
      ])}
      <div class="formula-panel">
        <p class="formula"><span>稅後報酬率</span>名目年報酬率 ×（1 − 稅率）＝ ${formatNumber(result.nominalAnnualRate * 100, 3)}% ×（1 − ${formatNumber(result.taxRate * 100, 2)}%）＝ ${formatNumber(result.afterTaxAnnualRate * 100, 3)}%</p>
        <p class="formula"><span>定期投入終值</span>每期投入 × [((1＋每期稅後報酬率)^總期數 − 1) ÷ 每期稅後報酬率]${result.paymentTiming === 'beginning' ? ' ×（1＋每期稅後報酬率）' : ''}</p>
        <p class="substitution"><span>今日購買力</span>${money(result.futureValue)} ÷（1＋${formatNumber(result.inflationRate * 100, 2)}%）^${formatNumber(result.years)} 年 ＝ ${money(result.presentPurchasingPower)}</p>
        <p class="substitution"><span>稅後實質報酬率</span>（1＋稅後名目報酬率）÷（1＋通膨率）− 1 ＝ ${formatNumber(result.realAfterTaxRate * 100, 3)}%</p>
      </div>
      <aside class="assumption-box"><strong>主要假設</strong><ul>${result.assumptions.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul></aside>`;
  } catch (error) {
    return `<div class="empty-state empty-state--error"><strong>目前無法計算</strong><p>${htmlEscape(error.message)}</p></div>`;
  }
};

const renderRetirement = () => {
  const value = data.retirement;
  return `
    <form class="calculator-form" id="retirement-form"><section class="content-section panel form-section">
      <div class="section-heading panel-header"><div><p class="eyebrow">求解設定</p><h2>退休準備累積</h2></div><span>Part4 p14–15</span></div>
      <div class="form-grid">
        ${selectInput('', '想求的結果', 'future-value', [['future-value', '退休終值與今日購買力（目前已實作）']], '反推每期投入或準備年數待後續規格。').replace(' data-model=""', ' disabled')}
        ${moneyInput('retirement.existingAssets', '既有退休資產', value.existingAssets)}
        ${moneyInput('retirement.periodicContribution', '每期投入', value.periodicContribution)}
        ${numberInput('retirement.years', '準備年數', value.years, { min: 0.01, step: '0.5', unit: '年' })}
        ${selectInput('retirement.paymentsPerYear', '投入頻率', value.paymentsPerYear, frequencyOptions)}
        ${selectInput('retirement.paymentTiming', '投入時點', value.paymentTiming, [['beginning', '期初投入'], ['end', '期末投入']])}
        ${numberInput('retirement.nominalAnnualRate', '名目年報酬率', value.nominalAnnualRate, { step: '0.001', unit: '%' })}
        ${numberInput('retirement.taxRate', '報酬適用稅率', value.taxRate, { step: '0.01', unit: '%', help: '依講義以同一稅率估算所有投資報酬；實際稅負依商品與個案而異。' })}
        ${numberInput('retirement.inflationRate', '預估年通膨率', value.inflationRate, { step: '0.01', unit: '%' })}
      </div>
      <aside class="assumption-box"><strong>計算邊界</strong><p>本頁先求既有資產與定期投入的退休終值，再用固定通膨率折算今日購買力；尚未納入退休後提領年數、退休生活費與社會保險給付。</p></aside>
    </section></form>
    <section class="content-section panel"><div class="section-heading panel-header"><div><p class="eyebrow">即時計算</p><h2>退休準備結果</h2></div></div><div id="retirement-output">${retirementResult()}</div></section>
    ${analysisActions()}`;
};

const placeholderContent = {
  'personal-loan': ['財務規劃 05', '信貸', '預計支援貸款本金、利率、期數、手續費與總費用年百分率，並依想求的結果反推。'],
};

const renderPlaceholder = (id) => {
  const [eyebrow, title, description] = placeholderContent[id];
  return `<section class="content-section placeholder-panel">
      <span class="placeholder-mark">規格待確認</span>
      <h2>專頁與網址已建立</h2>
      <p>這一頁已從財務總覽與導覽獨立開啟。為避免使用未確認的欄位或公式，本版先不產生試算數字。</p>
      <div class="next-spec"><strong>下一版會先確認</strong><ul><li>想求的結果與可反推項目</li><li>已知條件、利率與期數定義</li><li>繳款／投入頻率與期初或期末</li><li>費用、稅務與其他主要假設</li></ul></div>
      <a class="button button--secondary secondary" href="/finance">回財務總覽</a>
    </section>`;
};

const renderInsurance = () => `
  <section class="content-section placeholder-panel"><span class="placeholder-mark">Reserved</span><h2>保留乾淨邊界</h2><p>此頁不沿用財務規劃的未確認公式，也不會讀取或上傳客戶保單資料。</p><a class="button button--secondary secondary" href="/">回首頁</a></section>`;

const detailReportRows = (sectionLabel, categories) => Object.entries(categories || {}).flatMap(([key, value]) => {
  const rows = detailRows(value, labels[key] || key);
  return [
    ...rows.map((item) => ({
      label: `${sectionLabel}｜${labels[key] || key}｜${item?.label?.trim() || '未命名項目'}`,
      value: money(item?.amount),
      note: `歸類於「${labels[key] || key}」`,
    })),
    {
      label: `${sectionLabel}｜${labels[key] || key}小計`,
      value: money(detailTotal(rows)),
      note: '分類內所有明細合計',
    },
  ];
});

const detailedInputRows = () => [
  { label: '資產負債基準日', value: data.balanceSheet.asOfDate },
  ...detailReportRows('資產', data.balanceSheet.assets),
  ...detailReportRows('負債', data.balanceSheet.liabilities),
  { label: '現金流輸入期間', value: data.cashFlow.period === 'annual' ? '每年' : '每月' },
  ...detailReportRows('收入', data.cashFlow.income),
  ...detailReportRows('稅與薪資扣繳', data.cashFlow.deductions),
  ...detailReportRows('支出與提撥', data.cashFlow.expenses),
];

const buildBalanceStatementReport = () => ({
  title: '櫻木財務規劃｜資產負債表',
  meta: [
    { label: '分析基準日', value: data.balanceSheet.asOfDate || '未填寫' },
    { label: '金額單位', value: '新臺幣' },
  ],
  statement: balanceStatementData(),
  assumptions: [
    '個人淨值（權益）＝總資產－總負債；負債及權益合計＝總負債＋個人淨值；淨值為負時保留負號。',
    '所有金額均依目前輸入的明細與分類小計彙總。',
  ],
  notes: [DATA_RETENTION_TEXT, '本報表的試算結果不構成投資、稅務、法律或授信建議。'],
});

const buildCashFlowStatementReport = () => {
  const cashFlow = normalizeCashFlow(data.cashFlow);
  return {
    title: '櫻木財務規劃｜現金流量表',
    meta: [
      { label: '金額期間', value: cashFlow.periodLabel },
      { label: '金額單位', value: '新臺幣' },
    ],
    statement: cashFlowStatementData(),
    assumptions: [
      `一般現金流淨收入＝${cashFlow.netIncomeDefinition}。`,
      '現金結餘＝總收入－扣繳－支出；正數列於右側，短缺列於左側。',
      '跨頁財務比率計算時，系統會依所選期間統一換算為月額或年額。',
    ],
    notes: [DATA_RETENTION_TEXT, '本報表的試算結果不構成投資、稅務、法律或授信建議。'],
  };
};

const buildRatioReport = (ratioId) => {
  const { cashFlow, ratios } = currentAnalysis();
  const ratio = ratios.find((item) => item.id === ratioId);
  if (!ratio) throw new Error('找不到指定的財務比率。');
  const resultSections = ratio.results.map((result) => ({
    title: result.label,
    rows: [
      { label: '結果', value: result.formattedValue },
      { label: '公式', value: result.formula },
      result.status === 'ok'
        ? { label: '實際帶入', value: result.substitution }
        : { label: '資料不足原因', value: result.reason },
      { label: '基準', value: result.benchmark || '待確認' },
      { label: '判讀', value: result.assessment || '待確認' },
      ...(result.warning ? [{ label: '口徑提醒', value: result.warning }] : []),
    ],
  }));
  return {
    title: `櫻木財務規劃｜${ratio.name}`,
    sections: [
      {
        title: '衡量用途',
        rows: [{
          label: ratio.name,
          value: ratioPurposes[ratio.id] || ratio.description || '用來觀察這項財務結構及其可能帶來的風險。',
        }],
      },
      ...resultSections,
      {
        title: '口徑／假設',
        rows: [
          { label: '公式確認狀態', value: ratio.formulaStatus || '待確認' },
          ...(ratio.netIncomeDefinition ? [{ label: '淨收入定義', value: ratio.netIncomeDefinition }] : []),
          ...(ratio.assumption ? [{ label: '資料欄位假設', value: ratio.assumption }] : []),
          { label: '期間口徑', value: `現金流輸入為${cashFlow.periodLabel}金額；跨頁運算由系統統一換算。` },
        ],
      },
    ],
  };
};

const buildAnalysisReport = () => {
  const { balance, cashFlow, ratios } = currentAnalysis();
  const ratioRows = ratios.flatMap((ratio) => ratio.results.map((result) => ({
    label: result.label,
    value: result.formattedValue,
    note: [
      `衡量用途：${ratioPurposes[ratio.id] || ratio.description || '觀察此項財務結構'}`,
      result.formula,
      result.status === 'ok' ? result.substitution : result.reason,
      result.benchmark ? `講義基準：${result.benchmark}` : '',
      result.assessment ? `判讀：${result.assessment}` : '',
      ratio.formulaStatus,
    ].filter(Boolean).join('｜'),
  })));
  const debtNetIncomeDefinition = cashFlow.debtServiceNetIncomeDefinition
    || cashFlow.ratioNetIncomeDefinition
    || '總收入－所得稅－薪資扣繳退休金提撥';
  return {
    title: '櫻木財務規劃｜財務分析報告',
    meta: detailedInputRows(),
    sections: [
      { title: '資產負債摘要', rows: [
        { label: '總資產', value: money(balance.totalAssets) },
        { label: '總負債', value: money(balance.totalLiabilities) },
        { label: '個人淨值', value: money(balance.netWorth) },
      ] },
      { title: '現金流摘要', rows: [
        { label: '年度總收入', value: money(cashFlow.annual.grossIncome) },
        { label: '年度淨收入', value: money(cashFlow.annual.netIncome), note: cashFlow.netIncomeDefinition },
        { label: '年度支出', value: money(cashFlow.annual.totalExpenses) },
        { label: '年度總流出（含扣繳）', value: money(cashFlow.annual.totalOutflows ?? (cashFlow.annual.totalDeductions + cashFlow.annual.totalExpenses)) },
        { label: '年度現金結餘', value: money(cashFlow.annual.cashBalance) },
      ] },
      { title: '八項個人財務比率', rows: ratioRows },
    ],
    assumptions: [
      '所有現金流先統一換算成年額；流動資金比率以年度總流出（扣繳＋支出）除以 12 取得每月總流出。',
      `一般現金流淨收入為：${cashFlow.netIncomeDefinition}。`,
      `兩個償債比率的講義淨收入為：${debtNetIncomeDefinition}。`,
      '儲蓄比率分子為儲蓄及投資提撥加現金結餘，預設不含退休金提撥。',
      '淨投資資產目前未扣除投資性負債，因負債欄尚未另行區分；此資料欄位假設待確認。',
      '八項比率公式與已列門檻均已依《財務規劃資料part1》核對；講義未提供的獨立門檻會標示待確認。',
    ],
    notes: [DATA_RETENTION_TEXT, '本報告的試算結果不構成投資、稅務、法律或授信建議。'],
  };
};

const buildLoanReport = (kind) => {
  const source = kind === 'mortgage' ? data.mortgage : data.carLoan;
  const result = kind === 'mortgage'
    ? calculateMortgage({ ...source, precision: 2 })
    : calculateCarLoan({ ...source, precision: 2 });
  const title = kind === 'mortgage' ? '房貸' : '車貸';
  return {
    title: `櫻木財務規劃｜${title}試算報告`,
    meta: [
      { label: '想求的結果', value: '每期付款' },
      { label: '計算方式', value: result.methodLabel },
      { label: '貸款本金', value: money(source.principal) },
      { label: '計息本金', value: money(result.financedPrincipal) },
      { label: '名目年利率', value: `${formatNumber(source.annualRate, 2)}%` },
      { label: '貸款期間', value: `${formatNumber(source.termYears, 1)} 年` },
      { label: '繳款頻率', value: `每年 ${result.paymentsPerYear} 次` },
      { label: '繳款時點', value: result.paymentTiming === 'beginning' ? '期初' : '期末' },
      ...(kind === 'car-loan' ? [
        { label: '一次性費用', value: money(source.fees) },
        { label: '費用納入融資', value: source.includeFees ? '是' : '否' },
      ] : []),
    ],
    sections: [
      { title: '試算結果', rows: [
        { label: '每期付款', value: money(result.periodicPayment) },
        { label: '總利息', value: money(result.totalInterest) },
        { label: '總還款金額', value: money(result.totalPayments) },
        ...(kind === 'car-loan' ? [{ label: '含未融資費用總成本', value: money(result.totalCostIncludingExcludedFees) }] : []),
      ] },
      { title: '逐期攤還明細', rows: result.schedule.map((row) => ({
        label: `第 ${row.period} 期`, value: money(row.payment), note: `本金 ${money(row.principal)}｜利息 ${money(row.interest)}｜剩餘 ${money(row.remainingPrincipal)}`,
      })) },
    ],
    assumptions: [
      `採${result.methodLabel}。`,
      `名目年利率固定；每年繳款 ${result.paymentsPerYear} 次；${result.paymentTiming === 'beginning' ? '期初' : '期末'}繳款。`,
      kind === 'mortgage' ? '未計入開辦費、保險費與提前清償影響。' : `一次性費用${source.includeFees ? '已' : '未'}納入融資本金。`,
      ...(kind === 'car-loan' && result.method === 'flat-principal-interest'
        ? ['本金固定計息的總利息按原始融資本金計算；逐期金額取至小數兩位，最後一期吸收分角尾差。']
        : []),
    ],
    notes: [DATA_RETENTION_TEXT, '實際金額仍以金融機構契約、計息與四捨五入規則為準。'],
  };
};

const buildEducationReport = () => {
  const source = data.education;
  const result = educationCalculation();
  const frequency = result.paymentsPerYear === 12 ? '每月' : `每年 ${result.paymentsPerYear} 次`;
  return {
    title: '櫻木財務規劃｜子女教育規劃試算報告',
    meta: [
      { label: '想求的結果', value: '每期所需投入' },
      { label: '今日每年教育費', value: money(source.annualTuitionToday) },
      { label: '教育費年成長率', value: `${formatNumber(source.tuitionGrowthRate, 2)}%` },
      { label: '距離入學年數', value: `${formatNumber(source.yearsUntilEnrollment, 1)} 年` },
      { label: '就學年數', value: `${formatNumber(source.studyYears)} 年` },
      { label: '準備資金名目年報酬率', value: `${formatNumber(source.investmentAnnualRate, 2)}%` },
      { label: '既有教育基金', value: money(source.existingFund) },
      { label: '投入頻率', value: frequency },
      { label: '投入時點', value: result.paymentTiming === 'beginning' ? '期初' : '期末' },
    ],
    sections: [
      { title: '教育基金結果', rows: [
        { label: `${frequency}所需投入`, value: money(result.requiredPeriodicContribution), note: '資金缺口 ÷ 年金終值因子' },
        { label: '依講義保守名目總需求', value: money(result.inflatedTuitionTotal), note: '各學年未來名目教育費合計；不是折現現值' },
        { label: '既有基金入學時終值', value: money(result.existingFundFutureValue), note: '既有基金 ×（1＋每期報酬率）^準備期數' },
        { label: '尚需準備缺口', value: money(result.fundingGap), note: '依講義保守名目總需求－既有基金入學時終值' },
      ] },
      { title: '各學年未來教育費', rows: result.schedule.map((row) => ({
        label: `第 ${row.academicYear} 學年`,
        value: money(row.tuition),
        note: `於 ${formatNumber(row.paymentYear, 1)} 年後支付；今日每年教育費 ×（1＋成長率）^付款年數`,
      })) },
    ],
    assumptions: result.assumptions,
    notes: [
      DATA_RETENTION_TEXT,
      '公式依《財務計算概念part3》教育案例；未計入就學期間未支用資金報酬、稅負、獎學金與助學貸款。',
      '本報告的試算結果不構成投資、稅務、法律或授信建議。',
    ],
  };
};

const buildCreditCardReport = () => {
  const source = data.creditCardPlan;
  const result = creditCardCalculation();
  return {
    title: '櫻木財務規劃｜信用卡清償試算報告',
    meta: [
      { label: '還款方式', value: result.methodLabel },
      { label: '信用卡未清償餘額', value: money(source.balance) },
      { label: '名目年利率', value: `${formatNumber(source.nominalAnnualRate, 3)}%` },
      { label: '繳款頻率', value: `每年 ${result.paymentsPerYear} 次` },
      { label: '固定每期付款', value: money(source.fixedPayment), note: result.repaymentMode === 'fixed' ? '本模式使用' : '本模式不使用' },
      { label: '最低還款比例', value: `${formatNumber(source.minimumPaymentPercent, 2)}%`, note: result.repaymentMode === 'percentage' ? '本模式使用' : '本模式不使用' },
      { label: '最低還款金額', value: money(source.minimumPaymentFloor), note: result.repaymentMode === 'percentage' ? '本模式使用' : '本模式不使用' },
    ],
    sections: [
      { title: '清償結果', rows: [
        { label: '清償期數', value: `${result.periods} 期` },
        { label: '總利息', value: money(result.totalInterest) },
        { label: '總付款', value: money(result.totalPayments) },
        { label: '輸入年率換算有效年率', value: `${formatNumber(result.effectiveAnnualRate * 100, 3)}%`, note: '（1＋每期利率）^每年付款次數－1' },
      ] },
      { title: '逐期清償明細', rows: result.schedule.map((row) => ({
        label: `第 ${row.period} 期`,
        value: money(row.payment),
        note: `期初 ${money(row.openingBalance)}｜本金 ${money(row.principal)}｜利息 ${money(row.interest)}｜期末 ${money(row.closingBalance)}`,
      })) },
    ],
    assumptions: result.assumptions,
    notes: [
      DATA_RETENTION_TEXT,
      '公式依《財務計算概念part3》信用卡案例；固定付款最後一期按實際應付金額截短，最低比例模式採先付款後計息。',
      '講義的 18.157% 是將 24 期均視為完整 NT$1,000 後，反推月 IRR 再乘 12 的近似名目年化；報告列示的有效年率是依輸入名目年率按期複利換算。',
      '實際信用卡利息仍以發卡機構的入帳日、結帳日、日利率、最低應繳與費用規則為準。',
    ],
  };
};

const buildRetirementReport = () => {
  const source = data.retirement;
  const result = retirementCalculation();
  const timing = result.paymentTiming === 'beginning' ? '期初' : '期末';
  const frequency = result.paymentsPerYear === 1 ? '每年 1 次' : `每年 ${result.paymentsPerYear} 次`;
  return {
    title: '櫻木財務規劃｜退休規劃試算報告',
    meta: [
      { label: '想求的結果', value: '退休終值與今日購買力' },
      { label: '既有退休資產', value: money(source.existingAssets) },
      { label: '每期投入', value: money(source.periodicContribution) },
      { label: '準備年數', value: `${formatNumber(source.years, 1)} 年` },
      { label: '投入頻率', value: frequency },
      { label: '投入時點', value: `${timing}投入` },
      { label: '名目年報酬率', value: `${formatNumber(source.nominalAnnualRate, 3)}%` },
      { label: '報酬適用稅率', value: `${formatNumber(source.taxRate, 2)}%` },
      { label: '預估年通膨率', value: `${formatNumber(source.inflationRate, 2)}%` },
    ],
    sections: [
      { title: '退休準備結果', rows: [
        { label: '退休時累積終值', value: money(result.futureValue), note: '既有資產終值＋定期投入終值' },
        { label: '折算今日購買力', value: money(result.presentPurchasingPower), note: `退休終值 ÷（1＋${formatNumber(result.inflationRate * 100, 2)}%）^${formatNumber(result.years)} 年` },
        { label: '投入本金合計', value: money(result.contributions), note: `既有資產＋每期投入 × ${result.periods} 期` },
        { label: '投資成長', value: money(result.investmentGrowth), note: '退休終值－投入本金合計' },
        { label: '稅後名目年報酬率', value: `${formatNumber(result.afterTaxAnnualRate * 100, 3)}%`, note: '名目年報酬率 ×（1－稅率）' },
        { label: '稅後實質年報酬率', value: `${formatNumber(result.realAfterTaxRate * 100, 3)}%`, note: '（1＋稅後名目報酬率）÷（1＋通膨率）－1' },
      ] },
    ],
    assumptions: result.assumptions,
    notes: [
      DATA_RETENTION_TEXT,
      '公式依《財務規劃資料part4》p14–15；尚未納入退休後提領、生活費與社會保險給付。',
      '本報告的試算結果不構成投資、稅務、法律或授信建議。',
    ],
  };
};

const flash = (message, tone = 'info') => {
  let region = document.querySelector('#app-message');
  if (!region) {
    region = document.createElement('div');
    region.id = 'app-message';
    region.className = 'app-message';
    region.setAttribute('role', 'status');
    document.body.append(region);
  }
  region.className = `app-message app-message--${tone}`;
  region.textContent = message;
  window.clearTimeout(flash.timer);
  flash.timer = window.setTimeout(() => region.remove(), 4500);
};

const persistInputs = (onUpdate) => {
  root.querySelectorAll('[data-model]').forEach((control) => {
    const handler = () => {
      let value;
      if (control.type === 'checkbox') value = control.checked;
      else if (control.type === 'number') value = control.value === '' ? 0 : Number(control.value);
      else value = control.value;
      setPath(data, control.dataset.model, value);
      data = saveData(data);
      onUpdate?.();
    };
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', handler);
  });
};

const resolveSpecificReport = (reportKey) => {
  if (reportKey === 'balance-sheet') {
    return { report: buildBalanceStatementReport(), filename: '櫻木資產負債表' };
  }
  if (reportKey === 'cash-flow') {
    return { report: buildCashFlowStatementReport(), filename: '櫻木現金流量表' };
  }
  if (reportKey.startsWith('ratio:')) {
    const ratioId = reportKey.slice('ratio:'.length);
    const ratio = currentAnalysis().ratios.find((item) => item.id === ratioId);
    if (!ratio) throw new Error('找不到指定的財務比率。');
    return { report: buildRatioReport(ratioId), filename: `櫻木${ratio.name}報告` };
  }
  throw new Error('找不到指定的報表。');
};

const bindReportExports = (scope = root) => {
  scope?.querySelectorAll('[data-action="export-report"]').forEach((button) => {
    if (button.dataset.exportBound === 'true') return;
    button.dataset.exportBound = 'true';
    button.addEventListener('click', () => {
      try {
        const format = button.closest('[data-export-control]')?.querySelector('[data-export-format]')?.value || 'pdf';
        const { report, filename } = resolveSpecificReport(button.dataset.report || '');
        if (format === 'csv') {
          const finalName = downloadCsvReport(report, filename);
          flash(`已下載 ${finalName}`, 'success');
          return;
        }
        printFinancialReport(report);
      } catch (error) { flash(error.message, 'error'); }
    });
  });
};

const bindActions = (reportBuilder, filename) => {
  root.querySelector('[data-action="csv"]')?.addEventListener('click', () => {
    try {
      const finalName = downloadCsvReport(reportBuilder(), filename);
      flash(`已下載 ${finalName}`, 'success');
    } catch (error) { flash(error.message, 'error'); }
  });
  root.querySelector('[data-action="print"]')?.addEventListener('click', () => {
    try { printFinancialReport(reportBuilder()); }
    catch (error) { flash(error.message, 'error'); }
  });
  root.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
    if (!window.confirm('要清除這個瀏覽器內的所有財務規劃資料嗎？此動作無法復原。')) return;
    data = clearData();
    render();
    flash('已清除本機資料。', 'success');
  });
};

const updateRatios = () => {
  const output = root.querySelector('#ratio-output');
  if (output) {
    output.innerHTML = ratioHtml();
    bindReportExports(output);
  }
};

const updateDetailTotals = () => {
  root.querySelectorAll('[data-detail-total]').forEach((output) => {
    output.textContent = money(detailTotal(getPath(data, output.dataset.detailTotal)));
  });
};

const bindDetailActions = () => {
  root.querySelectorAll('[data-action="add-detail"]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.collection;
      const key = path.split('.').at(-1);
      const current = getPath(data, path);
      const rows = Array.isArray(current)
        ? [...current]
        : detailRows(current, labels[key] || '項目');
      rows.push({ id: newDetailId(), label: '自訂項目', amount: 0 });
      setPath(data, path, rows);
      data = saveData(data);
      render();
      const matchingInputs = root.querySelectorAll(`[data-model^="${path}."][data-model$=".label"]`);
      matchingInputs[matchingInputs.length - 1]?.focus();
      flash('已新增一筆明細，可直接修改名稱與金額。', 'success');
    });
  });

  root.querySelectorAll('[data-action="remove-detail"]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.collection;
      const index = Number(button.dataset.index);
      const current = getPath(data, path);
      if (!Array.isArray(current) || !Number.isInteger(index) || index < 0 || index >= current.length) return;
      const item = current[index];
      const itemName = String(item?.label || '這筆明細');
      const itemAmount = Math.max(0, Number(item?.amount) || 0);
      if (!window.confirm(`確定刪除「${itemName}」嗎？${itemAmount > 0 ? `目前金額為 ${money(itemAmount)}，` : ''}刪除後將立即更新並保存。`)) return;
      const rows = [...current];
      rows.splice(index, 1);
      setPath(data, path, rows);
      data = saveData(data);
      render();
      flash('已刪除這筆明細。', 'success');
    });
  });
};

const bindPage = () => {
  if (page === 'finance-overview') bindActions(buildAnalysisReport, '櫻木財務分析');
  if (page === 'balance-sheet') {
    persistInputs(() => {
      updateDetailTotals();
      root.querySelector('#balance-output').innerHTML = balanceSummary();
      root.querySelector('#balance-statement-output').innerHTML = statementPreviewHtml(balanceStatementData(), '資產負債表');
      updateRatios();
    });
    bindDetailActions();
    bindActions(buildAnalysisReport, '櫻木財務分析');
  }
  if (page === 'cash-flow') {
    persistInputs(() => {
      updateDetailTotals();
      const periodText = data.cashFlow.period === 'annual' ? '每年' : '每月';
      root.querySelectorAll('.period-token').forEach((element) => { element.textContent = `${periodText}｜新臺幣`; });
      root.querySelector('#cash-flow-output').innerHTML = cashFlowSummary();
      root.querySelector('#cash-flow-statement-output').innerHTML = statementPreviewHtml(cashFlowStatementData(), '現金流量表');
      updateRatios();
    });
    bindDetailActions();
    bindActions(buildAnalysisReport, '櫻木財務分析');
  }
  if (page === 'mortgage' || page === 'car-loan') {
    const kind = page;
    persistInputs(() => { root.querySelector('#loan-output').innerHTML = loanResult(kind); });
    bindActions(() => buildLoanReport(kind), `櫻木${kind === 'mortgage' ? '房貸' : '車貸'}試算`);
  }
  if (page === 'education') {
    persistInputs(() => { root.querySelector('#education-output').innerHTML = educationResult(); });
    bindActions(buildEducationReport, '櫻木子女教育規劃試算');
  }
  if (page === 'credit-card') {
    persistInputs(() => { root.querySelector('#credit-card-output').innerHTML = creditCardResult(); });
    bindActions(buildCreditCardReport, '櫻木信用卡清償試算');
  }
  if (page === 'retirement') {
    persistInputs(() => { root.querySelector('#retirement-output').innerHTML = retirementResult(); });
    bindActions(buildRetirementReport, '櫻木退休規劃試算');
  }
  bindReportExports(root);
};

const renderers = {
  home: renderHome,
  insurance: renderInsurance,
  'finance-overview': renderFinanceOverview,
  'balance-sheet': renderBalanceSheet,
  'cash-flow': renderCashFlow,
  mortgage: renderMortgage,
  'car-loan': renderCarLoan,
  education: renderEducation,
  'personal-loan': () => renderPlaceholder('personal-loan'),
  'credit-card': renderCreditCard,
  retirement: renderRetirement,
};

function render() {
  if (root) {
    root.innerHTML = (renderers[page] || renderHome)();
    bindPage();
  }
  if (page === 'finance-overview') {
    [
      ['/finance/education', '試算未來各學年教育費、資金缺口與每期所需投入。'],
      ['/finance/credit-card', '比較固定付款與最低比例還款的清償期、總利息及逐期餘額。'],
      ['/finance/retirement', '試算定期投入、稅後報酬、退休終值與折算今日購買力。'],
    ].forEach(([href, description]) => {
      const card = document.querySelector(`.feature-card[href="${href}"]`);
      const cardDescription = card?.querySelector('p');
      const tag = card?.querySelector('.tag');
      if (cardDescription) cardDescription.textContent = description;
      if (tag) {
        tag.textContent = '可使用';
        tag.classList.remove('is-pending');
        tag.classList.add('is-ready');
      }
    });
  }
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.site-nav a, [data-nav-page]').forEach((link) => {
    const linkPath = new URL(link.href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
    const isCurrent = link.dataset.navPage
      ? link.dataset.navPage === page
      : linkPath === currentPath;
    link.classList.toggle('is-active', isCurrent);
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

window.addEventListener('storage', () => {
  data = loadData();
  render();
});

render();
