/**
 * 櫻木財務規劃 — 純前端計算核心
 *
 * 金額一律視為新臺幣；百分比輸入採「2 代表 2%」。此模組不存取 DOM、
 * localStorage 或網路，因此可同時供瀏覽器頁面與 Node 測試使用。
 */

export const BALANCE_ASSET_FIELDS = Object.freeze([
  "cash",
  "otherLiquidFunds",
  "reserveLiquidInvestments",
  "otherInvestmentAssets",
  "personalUseAssets",
]);

export const BALANCE_LIABILITY_FIELDS = Object.freeze([
  "mortgage",
  "carLoan",
  "personalLoan",
  "creditCard",
  "otherLiabilities",
]);

export const CASH_FLOW_INCOME_FIELDS = Object.freeze([
  "salary",
  "bonus",
  "businessIncome",
  "investmentIncome",
  "otherIncome",
]);

export const CASH_FLOW_DEDUCTION_FIELDS = Object.freeze([
  "incomeTax",
  "retirementContribution",
  "otherDeductions",
]);

export const CASH_FLOW_EXPENSE_FIELDS = Object.freeze([
  "livingExpenses",
  "insuranceExpenses",
  "educationExpenses",
  "savingsInvestment",
  "mortgagePayment",
  "nonMortgagePayment",
  "otherExpenses",
]);

const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 將表單值轉成有限數字；空白及非數字視為 0。 */
export function toNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = Number(
    typeof value === "string" ? value.replaceAll(",", "").trim() : value,
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 金額欄位不可為負；若表單輸入負值，以 0 計算。 */
export function toAmount(value) {
  return Math.max(0, toNumber(value));
}

/**
 * 加總一個語意分類下的明細金額。除了新版 [{id,label,amount}]，也保留
 * 舊版純數字與一般物件的相容性，讓既有瀏覽器資料不會因升級而遺失。
 */
export function sumDetailAmounts(value) {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + sumDetailAmounts(item), 0);
  }
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, "amount")) return toAmount(value.amount);
    return Object.values(value).reduce(
      (total, item) => total + sumDetailAmounts(item),
      0,
    );
  }
  return toAmount(value);
}

export function roundTo(value, precision = 0) {
  const factor = 10 ** Math.max(0, Math.trunc(precision));
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

export function formatMoney(value) {
  return `NT$${currencyFormatter.format(toNumber(value))}`;
}

export function formatPercent(decimalValue, digits = 1) {
  if (!Number.isFinite(decimalValue)) return "—";
  return `${(decimalValue * 100).toFixed(digits)}%`;
}

function normalizeKnownFields(source, knownFields) {
  const normalized = {};
  for (const field of knownFields) {
    normalized[field] = sumDetailAmounts(source?.[field]);
  }
  return normalized;
}

function sumValues(object) {
  return Object.values(object).reduce((total, value) => total + toAmount(value), 0);
}

/**
 * 資產負債表彙總。
 *
 * 基本流動資金／講義中的流動資產 = 現金及約當現金 + 其他流動資金
 * 備用流動資金 = 可作備用的流動投資（不重複加入基本流動資金）
 * 投資資產 = 可作備用的流動投資 + 其他投資資產
 */
export function summarizeBalanceSheet(balance = {}) {
  const assets = normalizeKnownFields(balance.assets, BALANCE_ASSET_FIELDS);
  const liabilities = normalizeKnownFields(
    balance.liabilities,
    BALANCE_LIABILITY_FIELDS,
  );

  const basicLiquidFunds = assets.cash + assets.otherLiquidFunds;
  const reserveLiquidFunds = assets.reserveLiquidInvestments;
  const investmentAssets =
    assets.reserveLiquidInvestments + assets.otherInvestmentAssets;
  const totalAssets = sumValues(assets);
  const totalLiabilities = sumValues(liabilities);
  const netWorth = totalAssets - totalLiabilities;

  return {
    asOfDate: balance.asOfDate || "",
    assets,
    liabilities,
    basicLiquidFunds,
    reserveLiquidFunds,
    liquidAssets: basicLiquidFunds,
    investmentAssets,
    totalAssets,
    totalLiabilities,
    netWorth,
  };
}

function scaleBreakdown(breakdown, factor) {
  return Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [key, value * factor]),
  );
}

function cashFlowSnapshot(income, deductions, expenses, factor) {
  const scaledIncome = scaleBreakdown(income, factor);
  const scaledDeductions = scaleBreakdown(deductions, factor);
  const scaledExpenses = scaleBreakdown(expenses, factor);
  const grossIncome = sumValues(scaledIncome);
  const totalDeductions = sumValues(scaledDeductions);
  const netIncome = grossIncome - totalDeductions;
  const totalExpenses = sumValues(scaledExpenses);
  const totalOutflows = totalDeductions + totalExpenses;
  const debtServiceNetIncome =
    grossIncome -
    scaledDeductions.incomeTax -
    scaledDeductions.retirementContribution;
  const cashBalance = netIncome - totalExpenses;
  const totalSavings = scaledExpenses.savingsInvestment + cashBalance;

  return {
    income: scaledIncome,
    deductions: scaledDeductions,
    expenses: scaledExpenses,
    grossIncome,
    totalDeductions,
    netIncome,
    ratioNetIncome: debtServiceNetIncome,
    debtServiceNetIncome,
    totalExpenses,
    totalOutflows,
    cashBalance,
    savingsInvestment: scaledExpenses.savingsInvestment,
    retirementContribution: scaledDeductions.retirementContribution,
    totalSavings,
    totalSavingsIncludingRetirement:
      totalSavings + scaledDeductions.retirementContribution,
    mortgagePayment: scaledExpenses.mortgagePayment,
    nonMortgagePayment: scaledExpenses.nonMortgagePayment,
    totalDebtPayment:
      scaledExpenses.mortgagePayment + scaledExpenses.nonMortgagePayment,
  };
}

/**
 * 將現金流統一同時換算成月資料與年資料。
 *
 * 現金流量表淨收入：總收入－所得稅－薪資扣繳退休金提撥－其他扣繳。
 * 兩個償債比率使用講義的淨收入：總收入－所得稅－退休金提撥。
 * 支出包含生活、保險、教育、儲蓄投資提撥、房貸、非房貸及其他支出。
 */
export function normalizeCashFlow(cashFlow = {}) {
  const period = cashFlow.period === "annual" ? "annual" : "monthly";
  const income = normalizeKnownFields(cashFlow.income, CASH_FLOW_INCOME_FIELDS);
  const deductions = normalizeKnownFields(
    cashFlow.deductions,
    CASH_FLOW_DEDUCTION_FIELDS,
  );
  const expenses = normalizeKnownFields(
    cashFlow.expenses,
    CASH_FLOW_EXPENSE_FIELDS,
  );
  const monthlyFactor = period === "monthly" ? 1 : 1 / 12;
  const annualFactor = period === "annual" ? 1 : 12;

  return {
    period,
    periodLabel: period === "annual" ? "每年" : "每月",
    input: { income, deductions, expenses },
    monthly: cashFlowSnapshot(income, deductions, expenses, monthlyFactor),
    annual: cashFlowSnapshot(income, deductions, expenses, annualFactor),
    netIncomeDefinition:
      "總收入－所得稅－薪資扣繳退休金提撥－其他扣繳",
    debtServiceNetIncomeDefinition:
      "總收入－所得稅－薪資扣繳退休金提撥",
    ratioNetIncomeDefinition:
      "總收入－所得稅－薪資扣繳退休金提撥",
  };
}

function assessValue(value, rule) {
  if (!rule || rule.type === "pending") {
    return {
      assessment: "講義未提供獨立判讀門檻",
      assessmentTone: "pending",
    };
  }

  if (rule.type === "range") {
    if (value < rule.min) {
      return { assessment: "低於講義建議範圍", assessmentTone: "caution" };
    }
    if (value > rule.max) {
      return { assessment: "高於講義建議範圍", assessmentTone: "caution" };
    }
    return { assessment: "符合講義建議範圍", assessmentTone: "good" };
  }

  if (rule.type === "min") {
    return value >= rule.value
      ? { assessment: "達到講義建議", assessmentTone: "good" }
      : { assessment: "低於講義建議", assessmentTone: "caution" };
  }

  if (rule.type === "max") {
    return value <= rule.value
      ? { assessment: "符合講義建議", assessmentTone: "good" }
      : { assessment: "高於講義建議", assessmentTone: "caution" };
  }

  if (rule.type === "nonMortgageDebt") {
    if (value < 0.15) {
      return { assessment: "講義視為健康比率", assessmentTone: "good" };
    }
    if (value > 0.2) {
      return { assessment: "講義顯示非房貸債務偏高", assessmentTone: "alert" };
    }
    return { assessment: "介於健康與偏高門檻之間", assessmentTone: "caution" };
  }

  return { assessment: "判讀規則待確認", assessmentTone: "pending" };
}

function makeCalculationResult({
  label,
  numerator,
  denominator,
  numeratorLabel,
  denominatorLabel,
  unit = "percent",
  denominatorRule = "nonZero",
  formula,
  formulaStatus,
  warning,
  benchmark = "判讀門檻：待確認",
  assessmentRule = { type: "pending" },
}) {
  const denominatorUsable =
    Number.isFinite(denominator) &&
    (denominatorRule === "positive" ? denominator > 0 : denominator !== 0);

  if (!denominatorUsable) {
    const expectation = denominatorRule === "positive" ? "大於 0" : "不為 0";
    return {
      label,
      status: "insufficient",
      value: null,
      formattedValue: "資料不足",
      unit,
      formula,
      formulaStatus,
      benchmark,
      assessment: "資料不足，無法判讀",
      assessmentTone: "insufficient",
      amounts: { numerator, denominator },
      substitution: `${formatMoney(numerator)} ÷ ${formatMoney(denominator)}`,
      reason: `${denominatorLabel}必須${expectation}，目前為 ${formatMoney(denominator)}`,
    };
  }

  const value = numerator / denominator;
  const { assessment, assessmentTone } = assessValue(value, assessmentRule);
  return {
    label,
    status: "ok",
    value,
    formattedValue:
      unit === "months" ? `${value.toFixed(1)} 個月` : formatPercent(value),
    unit,
    formula,
    formulaStatus,
    benchmark,
    assessment,
    assessmentTone,
    amounts: { numerator, denominator },
    substitution: `${numeratorLabel} ${formatMoney(numerator)} ÷ ${denominatorLabel} ${formatMoney(denominator)}`,
    warning: warning || null,
  };
}

/**
 * 計算八項個人財務比率。第一項「流動資金比率」包含基本、備用兩個結果。
 *
 * 公式與門檻已依《財務規劃資料 part1》核對。
 * 備用流動資金的公式已確認，但講義未另列獨立判讀門檻。
 */
export function calculateFinancialRatios(
  balanceInput = {},
  cashFlowInput = {},
  { formulaStatus = "已依講義確認" } = {},
) {
  const balance =
    balanceInput && "totalAssets" in balanceInput
      ? balanceInput
      : summarizeBalanceSheet(balanceInput);
  const cashFlow =
    cashFlowInput && cashFlowInput.monthly && cashFlowInput.annual
      ? cashFlowInput
      : normalizeCashFlow(cashFlowInput);

  const netWorthWarning =
    balance.netWorth < 0
      ? "個人淨值為負數；比率可計算，但不宜套用一般正值門檻。"
      : null;

  return [
    {
      id: "liquidity",
      name: "流動資金比率",
      formulaStatus,
      description: "衡量收入突然中斷時，現有基本與備用流動資金分別能支應幾個月的日常總流出。",
      results: [
        makeCalculationResult({
          label: "基本流動資金",
          numerator: balance.basicLiquidFunds,
          denominator: cashFlow.monthly.totalOutflows,
          numeratorLabel: "現金及約當現金＋其他流動資金",
          denominatorLabel: "每月總流出（含稅與扣繳）",
          unit: "months",
          denominatorRule: "positive",
          formula:
            "（現金及約當現金＋其他流動資金）÷ 每月總流出",
          formulaStatus,
          benchmark: "講義建議：3–6 個月",
          assessmentRule: { type: "range", min: 3, max: 6 },
        }),
        makeCalculationResult({
          label: "備用流動資金",
          numerator: balance.reserveLiquidFunds,
          denominator: cashFlow.monthly.totalOutflows,
          numeratorLabel: "可作備用的流動投資",
          denominatorLabel: "每月總流出（含稅與扣繳）",
          unit: "months",
          denominatorRule: "positive",
          formula:
            "可作備用的流動投資 ÷ 每月總流出",
          formulaStatus,
          benchmark: "判讀門檻：待確認（講義未另列）",
          assessmentRule: { type: "pending" },
        }),
      ],
    },
    {
      id: "savings",
      name: "儲蓄比率",
      formulaStatus,
      results: [
        makeCalculationResult({
          label: "儲蓄比率",
          numerator: cashFlow.annual.totalSavings,
          denominator: cashFlow.annual.grossIncome,
          numeratorLabel: "年度儲蓄及投資提撥＋年度現金結餘",
          denominatorLabel: "年度總收入",
          denominatorRule: "positive",
          formula:
            "（年度儲蓄及投資提撥＋年度現金結餘）÷ 年度總收入",
          formulaStatus,
          benchmark: "講義建議：至少 10%",
          assessmentRule: { type: "min", value: 0.1 },
        }),
      ],
      description: "衡量總收入中實際留下作為儲蓄、投資與現金結餘的比例，反映持續累積資產的能力；主比率依講義不含退休金提撥。",
    },
    {
      id: "liquid-assets-to-net-worth",
      name: "流動資產對淨值比率",
      formulaStatus,
      description: "衡量個人淨值中有多少能快速動用，反映面對緊急支出時的流動性與應變彈性。",
      results: [
        makeCalculationResult({
          label: "流動資產對淨值比率",
          numerator: balance.liquidAssets,
          denominator: balance.netWorth,
          numeratorLabel: "流動資產",
          denominatorLabel: "個人淨值",
          denominatorRule: "positive",
          formula: "流動資產 ÷ 個人淨值",
          formulaStatus,
          warning: netWorthWarning,
          benchmark: "講義可接受最低：15%",
          assessmentRule: { type: "min", value: 0.15 },
        }),
      ],
    },
    {
      id: "debt-to-assets",
      name: "負債對資產比率",
      formulaStatus,
      description: "衡量總資產有多少是以負債支應，用來觀察財務槓桿及債務侵蝕資產的程度。",
      results: [
        makeCalculationResult({
          label: "負債對資產比率",
          numerator: balance.totalLiabilities,
          denominator: balance.totalAssets,
          numeratorLabel: "總負債",
          denominatorLabel: "總資產",
          denominatorRule: "positive",
          formula: "總負債 ÷ 總資產",
          formulaStatus,
          benchmark: "講義建議：50% 或以下",
          assessmentRule: { type: "max", value: 0.5 },
        }),
      ],
    },
    {
      id: "debt-service",
      name: "償還債務比率",
      formulaStatus,
      description: "衡量講義定義的淨收入中，有多少比例用於房貸與其他債務還款，反映整體還款壓力。",
      results: [
        makeCalculationResult({
          label: "償還債務比率",
          numerator: cashFlow.annual.totalDebtPayment,
          denominator: cashFlow.annual.debtServiceNetIncome,
          numeratorLabel: "年度房貸＋非房貸還款",
          denominatorLabel: "年度淨收入",
          denominatorRule: "positive",
          formula: "（年度房貸還款＋年度非房貸還款）÷ 年度淨收入",
          formulaStatus,
          benchmark: "講義建議：35% 或以下",
          assessmentRule: { type: "max", value: 0.35 },
        }),
      ],
      netIncomeDefinition: cashFlow.debtServiceNetIncomeDefinition,
    },
    {
      id: "non-mortgage-debt-service",
      name: "償還非房貸債務比率",
      formulaStatus,
      description: "衡量講義定義的淨收入中，用於車貸、信貸、學貸、信用卡等非房貸債務的比例，反映較高成本債務的壓力。",
      results: [
        makeCalculationResult({
          label: "償還非房貸債務比率",
          numerator: cashFlow.annual.nonMortgagePayment,
          denominator: cashFlow.annual.debtServiceNetIncome,
          numeratorLabel: "年度非房貸還款",
          denominatorLabel: "年度淨收入",
          denominatorRule: "positive",
          formula: "年度非房貸還款 ÷ 年度淨收入",
          formulaStatus,
          benchmark: "講義：低於 15% 視為健康；高於 20% 顯示偏高",
          assessmentRule: { type: "nonMortgageDebt" },
        }),
      ],
      netIncomeDefinition: cashFlow.debtServiceNetIncomeDefinition,
    },
    {
      id: "net-investment-assets-to-net-worth",
      name: "淨投資資產對淨值比率",
      formulaStatus,
      description: "衡量個人淨值中有多少配置於可創造報酬的投資資產，反映資產配置是否偏向長期財富成長。",
      results: [
        makeCalculationResult({
          label: "淨投資資產對淨值比率",
          numerator: balance.investmentAssets,
          denominator: balance.netWorth,
          numeratorLabel: "可作備用的流動投資＋其他投資資產",
          denominatorLabel: "個人淨值",
          denominatorRule: "positive",
          formula:
            "（可作備用的流動投資＋其他投資資產）÷ 個人淨值",
          formulaStatus,
          warning: netWorthWarning,
          benchmark: "講義建議：50% 或以上",
          assessmentRule: { type: "min", value: 0.5 },
        }),
      ],
      assumption: "目前未另列投資性負債，故以投資資產合計作為分子。",
    },
    {
      id: "solvency",
      name: "償付能力比率",
      formulaStatus,
      description: "衡量全部資產扣除負債後真正屬於自己的比例，反映清償全部債務後的長期財務安全程度。",
      results: [
        makeCalculationResult({
          label: "償付能力比率",
          numerator: balance.netWorth,
          denominator: balance.totalAssets,
          numeratorLabel: "個人淨值",
          denominatorLabel: "總資產",
          denominatorRule: "positive",
          formula: "個人淨值 ÷ 總資產",
          formulaStatus,
          benchmark: "講義建議：50% 或以上",
          assessmentRule: { type: "min", value: 0.5 },
        }),
      ],
    },
  ];
}

function resolveLoanTerms(input = {}) {
  const principal = toAmount(input.principal);
  const fees = toAmount(input.fees);
  const includeFees = Boolean(input.includeFees);
  const financedPrincipal = principal + (includeFees ? fees : 0);
  const annualRate = toAmount(input.annualRate);
  const paymentsPerYear = Math.trunc(toAmount(input.paymentsPerYear) || 12);
  let periods = Math.trunc(toAmount(input.periods));

  if (!periods && toAmount(input.termYears)) {
    periods = Math.round(toAmount(input.termYears) * paymentsPerYear);
  }
  if (!periods && toAmount(input.termMonths)) {
    periods = Math.round((toAmount(input.termMonths) / 12) * paymentsPerYear);
  }

  if (financedPrincipal <= 0) throw new RangeError("貸款本金必須大於 0");
  if (paymentsPerYear <= 0) throw new RangeError("每年繳款次數必須大於 0");
  if (periods <= 0) throw new RangeError("貸款期數必須大於 0");

  return {
    inputPrincipal: principal,
    financedPrincipal,
    fees,
    includeFees,
    annualRate,
    paymentsPerYear,
    periods,
    periodicRate: annualRate / 100 / paymentsPerYear,
    precision: Math.max(0, Math.trunc(toAmount(input.precision))),
    paymentTiming: input.paymentTiming === "beginning" ? "beginning" : "end",
  };
}

function summarizeLoanSchedule(terms, schedule, method) {
  const totalPrincipal = schedule.reduce(
    (total, row) => total + row.principal,
    0,
  );
  const totalInterest = schedule.reduce(
    (total, row) => total + row.interest,
    0,
  );
  const totalPayments = schedule.reduce(
    (total, row) => total + row.payment,
    0,
  );
  const precision = terms.precision;

  return {
    method,
    inputPrincipal: terms.inputPrincipal,
    financedPrincipal: terms.financedPrincipal,
    fees: terms.fees,
    includeFees: terms.includeFees,
    excludedFees: terms.includeFees ? 0 : terms.fees,
    annualRate: terms.annualRate,
    periodicRate: terms.periodicRate,
    paymentsPerYear: terms.paymentsPerYear,
    periods: terms.periods,
    paymentTiming: terms.paymentTiming,
    periodicPayment: schedule[0]?.payment || 0,
    totalPrincipal: roundTo(totalPrincipal, precision),
    totalInterest: roundTo(totalInterest, precision),
    totalPayments: roundTo(totalPayments, precision),
    totalCostIncludingExcludedFees: roundTo(
      totalPayments + (terms.includeFees ? 0 : terms.fees),
      precision,
    ),
    schedule,
  };
}

/**
 * 本息平均攤還（等額本息）。預設為每月、期末繳款、金額取整數元。
 * 支援期初繳款；期初模式的第一期利息為 0。
 */
export function calculateAmortizedLoan(input = {}) {
  const terms = resolveLoanTerms(input);
  const {
    financedPrincipal,
    periodicRate,
    periods,
    precision,
    paymentTiming,
  } = terms;

  let exactPayment;
  if (periodicRate === 0) {
    exactPayment = financedPrincipal / periods;
  } else {
    exactPayment =
      (financedPrincipal * periodicRate) /
      (1 - (1 + periodicRate) ** -periods);
    if (paymentTiming === "beginning") exactPayment /= 1 + periodicRate;
  }
  const regularPayment = roundTo(exactPayment, precision);
  let balance = roundTo(financedPrincipal, precision);
  const schedule = [];

  for (let period = 1; period <= periods; period += 1) {
    const interest =
      paymentTiming === "beginning" && period === 1
        ? 0
        : roundTo(balance * periodicRate, precision);
    let payment = regularPayment;
    let principal = roundTo(payment - interest, precision);

    if (period === periods || principal >= balance) {
      principal = balance;
      payment = roundTo(principal + interest, precision);
    }

    balance = roundTo(Math.max(0, balance - principal), precision);
    schedule.push({
      period,
      payment,
      principal,
      interest,
      remainingPrincipal: balance,
    });
  }

  return summarizeLoanSchedule(terms, schedule, "amortized");
}

/** 房貸目前採已確認的本息平均攤還。 */
export function calculateMortgage(input = {}) {
  return {
    ...calculateAmortizedLoan({
      paymentsPerYear: 12,
      paymentTiming: "end",
      precision: 2,
      ...input,
    }),
    product: "mortgage",
    methodLabel: "本息平均攤還",
  };
}

/**
 * 車貸「本金固定計息」：每期本金固定，利息按原始融資本金計算，
 * 因此每期利息亦固定（俗稱 flat rate）。
 */
export function calculateFixedPrincipalCarLoan(input = {}) {
  const terms = resolveLoanTerms(input);
  const {
    financedPrincipal,
    periodicRate,
    periods,
    precision,
  } = terms;
  const regularPrincipal = roundTo(financedPrincipal / periods, precision);
  const regularInterest = roundTo(financedPrincipal * periodicRate, precision);
  const targetTotalInterest = roundTo(
    financedPrincipal * periodicRate * periods,
    precision,
  );
  let remainingPrincipal = roundTo(financedPrincipal, precision);
  let accumulatedInterest = 0;
  const schedule = [];

  for (let period = 1; period <= periods; period += 1) {
    const principal =
      period === periods ? remainingPrincipal : regularPrincipal;
    // 各期先依顯示精度取位，最後一期吸收分角尾差，讓總利息仍等於
    // 「原始融資本金 × 每期利率 × 總期數」的 flat-rate 公式結果。
    const interest = period === periods
      ? roundTo(targetTotalInterest - accumulatedInterest, precision)
      : regularInterest;
    const payment = roundTo(principal + interest, precision);
    accumulatedInterest = roundTo(accumulatedInterest + interest, precision);
    remainingPrincipal = roundTo(
      Math.max(0, remainingPrincipal - principal),
      precision,
    );
    schedule.push({
      period,
      payment,
      principal,
      interest,
      remainingPrincipal,
    });
  }

  return {
    ...summarizeLoanSchedule(terms, schedule, "flat-principal-interest"),
    product: "car-loan",
    methodLabel: "本金固定計息",
    interestBasis: "原始融資本金",
  };
}

/** 車貸計算入口：method = flat 或 amortized。 */
export function calculateCarLoan(input = {}) {
  const method =
    input.method === "amortized" || input.method === "equal-payment"
      ? "amortized"
      : "flat";
  if (method === "flat") return calculateFixedPrincipalCarLoan(input);

  return {
    ...calculateAmortizedLoan({ precision: 2, ...input }),
    product: "car-loan",
    methodLabel: "本息平均攤還",
  };
}

