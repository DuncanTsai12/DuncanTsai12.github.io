export const STORAGE_KEY = 'sakuragi-financial-planning:v1';
export const DATA_VERSION = 2;

const today = () => new Date().toISOString().slice(0, 10);

const detailRows = (prefix, labels) => labels.map((label, index) => ({
  id: `${prefix}-${index + 1}`,
  label,
  amount: 0,
}));

const detailDefaults = () => ({
  balanceSheet: {
    assets: {
      cash: detailRows('asset-cash', ['現金', '活期存款', '支票存款']),
      otherLiquidFunds: detailRows('asset-liquid', ['定期存款', '外幣存款', '儲蓄險現金價值', '儲蓄險（外幣）現金價值']),
      reserveLiquidInvestments: detailRows('asset-reserve', ['貨幣市場基金', '上市股票', '債券', '共同基金／ETF']),
      otherInvestmentAssets: detailRows('asset-investment', ['非上市股權', '投資型保單', '投資性不動產', '退休金帳戶']),
      personalUseAssets: detailRows('asset-personal', ['自用住宅', '汽車／機車', '家具', '有價收藏', '珠寶收藏', '其他個人資產']),
    },
    liabilities: {
      mortgage: detailRows('liability-mortgage', ['房屋貸款']),
      carLoan: detailRows('liability-car', ['汽車／機車貸款']),
      personalLoan: detailRows('liability-personal', ['信用貸款', '學貸', '保單貸款']),
      creditCard: detailRows('liability-card', ['信用卡未清償']),
      otherLiabilities: detailRows('liability-other', ['個人負債', '其他短期負債', '其他長期負債']),
    },
  },
  cashFlow: {
    income: {
      salary: detailRows('income-salary', ['工作／薪資收入', '佣金收入']),
      bonus: detailRows('income-bonus', ['年終獎金', '績效／其他獎金']),
      businessIncome: detailRows('income-business', ['自營／執業收入']),
      investmentIncome: detailRows('income-investment', ['利息收入', '股利／配息', '租金收入']),
      otherIncome: detailRows('income-other', ['年金收入', '資產變現收入', '業外收入', '其他收入']),
    },
    deductions: {
      incomeTax: detailRows('deduction-tax', ['所得稅']),
      retirementContribution: detailRows('deduction-retirement', ['薪資扣繳退休金提撥']),
      otherDeductions: detailRows('deduction-other', ['其他薪資扣繳']),
    },
    expenses: {
      livingExpenses: detailRows('expense-living', [
        '飲食',
        '房租',
        '管理費',
        '水費',
        '電費',
        '瓦斯費',
        '交通費',
        '娛樂費',
        '電話／網路費',
        '孝親費',
        '紅包',
        '治裝／化妝品',
        '會員費',
        '捐獻',
        '出國／旅遊',
        '其他生活支出',
      ]),
      insuranceExpenses: detailRows('expense-insurance', ['勞保費', '健保費', '醫療險保費', '產物保險', '汽機車保險', '其他保險支出']),
      educationExpenses: detailRows('expense-education', ['學費', '補習／才藝費', '其他教育支出']),
      savingsInvestment: detailRows('expense-savings', ['儲蓄', '投資']),
      mortgagePayment: detailRows('expense-mortgage', ['房貸還款']),
      nonMortgagePayment: detailRows('expense-non-mortgage', ['車貸還款', '信貸還款', '學貸還款', '信用卡還款', '其他非房貸還款']),
      otherExpenses: detailRows('expense-other', ['汽機車稅金', '其他稅金', '其他支出']),
    },
  },
});

export const defaultData = () => {
  const details = detailDefaults();
  return {
    version: DATA_VERSION,
    updatedAt: null,
    balanceSheet: {
      asOfDate: today(),
      assets: details.balanceSheet.assets,
      liabilities: details.balanceSheet.liabilities,
    },
    cashFlow: {
      period: 'monthly',
      income: details.cashFlow.income,
      deductions: details.cashFlow.deductions,
      expenses: details.cashFlow.expenses,
    },
    mortgage: {
      principal: 8000000,
      annualRate: 2.2,
      termYears: 30,
      paymentsPerYear: 12,
      paymentTiming: 'end',
      precision: 2,
    },
    carLoan: {
      method: 'equal-payment',
      principal: 800000,
      annualRate: 3.5,
      termYears: 5,
      paymentsPerYear: 12,
      fees: 0,
      includeFees: false,
      paymentTiming: 'end',
      precision: 2,
    },
    education: {
      annualTuitionToday: 150000,
      tuitionGrowthRate: 5,
      yearsUntilEnrollment: 15,
      studyYears: 4,
      investmentAnnualRate: 8,
      existingFund: 0,
      paymentsPerYear: 12,
      paymentTiming: 'beginning',
      precision: 2,
    },
    creditCardPlan: {
      balance: 20000,
      nominalAnnualRate: 18,
      paymentsPerYear: 12,
      repaymentMode: 'fixed',
      fixedPayment: 1000,
      minimumPaymentPercent: 5,
      minimumPaymentFloor: 50,
      precision: 2,
    },
    retirement: {
      existingAssets: 0,
      periodicContribution: 30000,
      years: 35,
      paymentsPerYear: 1,
      paymentTiming: 'beginning',
      nominalAnnualRate: 8.175,
      taxRate: 28,
      inflationRate: 4,
      precision: 2,
    },
  };
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const mergeKnown = (defaults, stored) => {
  if (Array.isArray(defaults)) {
    return Array.isArray(stored) ? structuredClone(stored) : structuredClone(defaults);
  }
  if (!isPlainObject(stored)) return structuredClone(defaults);
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const incoming = stored[key];
    if (Array.isArray(fallback)) {
      return [key, Array.isArray(incoming) ? structuredClone(incoming) : structuredClone(fallback)];
    }
    if (isPlainObject(fallback)) return [key, mergeKnown(fallback, incoming)];
    return [key, incoming ?? fallback];
  }));
};

const detailGroups = [
  ['balanceSheet.assets.cash', '現金及約當現金'],
  ['balanceSheet.assets.otherLiquidFunds', '其他流動資金'],
  ['balanceSheet.assets.reserveLiquidInvestments', '備用流動投資'],
  ['balanceSheet.assets.otherInvestmentAssets', '其他投資資產'],
  ['balanceSheet.assets.personalUseAssets', '個人使用資產'],
  ['balanceSheet.liabilities.mortgage', '房貸'],
  ['balanceSheet.liabilities.carLoan', '車貸'],
  ['balanceSheet.liabilities.personalLoan', '信貸'],
  ['balanceSheet.liabilities.creditCard', '信用卡未清償餘額'],
  ['balanceSheet.liabilities.otherLiabilities', '其他負債'],
  ['cashFlow.income.salary', '工作／薪資收入'],
  ['cashFlow.income.bonus', '獎金收入'],
  ['cashFlow.income.businessIncome', '自營／執業收入'],
  ['cashFlow.income.investmentIncome', '投資收入'],
  ['cashFlow.income.otherIncome', '其他收入'],
  ['cashFlow.deductions.incomeTax', '所得稅'],
  ['cashFlow.deductions.retirementContribution', '退休金提撥'],
  ['cashFlow.deductions.otherDeductions', '其他薪資扣繳'],
  ['cashFlow.expenses.livingExpenses', '生活支出'],
  ['cashFlow.expenses.insuranceExpenses', '保險支出'],
  ['cashFlow.expenses.educationExpenses', '教育支出'],
  ['cashFlow.expenses.savingsInvestment', '儲蓄及投資提撥'],
  ['cashFlow.expenses.mortgagePayment', '房貸還款'],
  ['cashFlow.expenses.nonMortgagePayment', '非房貸還款'],
  ['cashFlow.expenses.otherExpenses', '其他支出'],
];

const getPath = (source, path) => path.split('.').reduce((value, key) => value?.[key], source);

const setPath = (target, path, value) => {
  const keys = path.split('.');
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys.at(-1)] = value;
};

const amount = (value) => {
  const parsed = Number(typeof value === 'string' ? value.replaceAll(',', '').trim() : value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const legacyAmount = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' || typeof value === 'string') return amount(value);
  if (!isPlainObject(value)) return 0;
  if ('amount' in value) return amount(value.amount);
  return Object.values(value).reduce((total, item) => total + (
    typeof item === 'number' || typeof item === 'string' ? amount(item) : 0
  ), 0);
};

const sanitizeRows = (rows, path) => rows.map((row, index) => ({
  id: String(row?.id || `${path.replaceAll('.', '-')}-custom-${index + 1}`),
  label: String(row?.label || '未命名項目'),
  amount: amount(row?.amount),
}));

const normalizeDetailGroup = (incoming, fallback, path, groupLabel) => {
  if (Array.isArray(incoming)) return sanitizeRows(incoming, path);
  const carriedAmount = legacyAmount(incoming);
  if (!carriedAmount) return structuredClone(fallback);
  return [{
    id: `${path.replaceAll('.', '-')}-legacy`,
    label: `舊版${groupLabel}合計（請拆分）`,
    amount: carriedAmount,
  }, ...structuredClone(fallback)];
};

const normalizeData = (stored) => {
  const defaults = defaultData();
  const source = isPlainObject(stored) ? stored : {};
  const normalized = mergeKnown(defaults, source);
  detailGroups.forEach(([path, groupLabel]) => {
    setPath(
      normalized,
      path,
      normalizeDetailGroup(getPath(source, path), getPath(defaults, path), path, groupLabel),
    );
  });
  normalized.version = DATA_VERSION;
  return normalized;
};

export const loadData = () => {
  const defaults = defaultData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : defaults;
  } catch (error) {
    console.warn('無法讀取本機資料，改用預設值。', error);
    return defaults;
  }
};

export const saveData = (data) => {
  const next = { ...normalizeData(data), version: DATA_VERSION, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('sakuragi:data-changed', { detail: next }));
  return next;
};

export const clearData = () => {
  window.localStorage.removeItem(STORAGE_KEY);
  const next = defaultData();
  window.dispatchEvent(new CustomEvent('sakuragi:data-changed', { detail: next }));
  return next;
};

export const updateSection = (data, section, patch) => saveData({
  ...data,
  [section]: { ...data[section], ...patch },
});

export const DATA_RETENTION_TEXT = '資料只保存在這個瀏覽器的本機儲存空間，關閉或重新開啟瀏覽器後仍會保留，直到你按下「清除本機資料」、清除瀏覽器網站資料，或使用隱私模式結束工作階段。資料不會上傳到伺服器。';
