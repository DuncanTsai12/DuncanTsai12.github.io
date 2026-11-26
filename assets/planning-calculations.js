/**
 * 櫻木財務規劃 — 專項規劃計算核心
 *
 * 百分比輸入採「8.175 代表 8.175%」。本模組不讀寫 DOM、localStorage
 * 或網路，可供瀏覽器與 Node 測試共同使用。
 */

function toFiniteNumber(value, fieldName) {
  const parsed = Number(
    typeof value === "string" ? value.replaceAll(",", "").trim() : value,
  );
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${fieldName}必須是有效數字`);
  }
  return parsed;
}

function nonNegative(value, fieldName) {
  const parsed = toFiniteNumber(value ?? 0, fieldName);
  if (parsed < 0) throw new RangeError(`${fieldName}不可小於 0`);
  return parsed;
}

function percent(value, fieldName, { maximum = null } = {}) {
  const parsed = nonNegative(value, fieldName);
  if (maximum !== null && parsed > maximum) {
    throw new RangeError(`${fieldName}不可大於 ${maximum}%`);
  }
  return parsed / 100;
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 計算退休準備金累積結果。
 *
 * 公式依《財務規劃資料 part4》p14–15：
 * - 稅後年報酬率 = 名目年報酬率 × (1 − 稅率)
 * - 期末年金終值 = PMT × [((1+i)^n − 1) / i]
 * - 期初年金終值 = 期末年金終值 × (1+i)
 * - 今日購買力 = 退休終值 / (1+通膨率)^年數
 *
 * paymentsPerYear 大於 1 時，以稅後年報酬率除以每年投入次數取得
 * 每期利率；此為名目利率等分假設，會在回傳的 assumptions 中揭露。
 */
export function calculateRetirementPlan(input = {}) {
  const existingAssets = nonNegative(input.existingAssets, "既有退休資產");
  const periodicContribution = nonNegative(
    input.periodicContribution,
    "每期投入",
  );
  const years = toFiniteNumber(input.years, "準備年數");
  if (years <= 0) throw new RangeError("準備年數必須大於 0");

  const paymentsPerYear = Math.trunc(
    toFiniteNumber(input.paymentsPerYear ?? 1, "每年投入次數"),
  );
  if (paymentsPerYear <= 0) {
    throw new RangeError("每年投入次數必須大於 0");
  }

  const exactPeriods = years * paymentsPerYear;
  const periods = Math.round(exactPeriods);
  if (Math.abs(exactPeriods - periods) > 1e-9) {
    throw new RangeError("準備年數乘以每年投入次數必須為整數期數");
  }

  const nominalAnnualRate = percent(
    input.nominalAnnualRate,
    "名目年報酬率",
  );
  const taxRate = percent(input.taxRate, "稅率", { maximum: 100 });
  const inflationRate = percent(input.inflationRate, "通膨率");
  const paymentTiming =
    input.paymentTiming === "end" ? "end" : "beginning";
  const precision = Math.trunc(nonNegative(input.precision ?? 2, "小數位數"));
  if (precision > 8) throw new RangeError("小數位數不可大於 8");

  const afterTaxAnnualRate = nominalAnnualRate * (1 - taxRate);
  const periodicRate = afterTaxAnnualRate / paymentsPerYear;
  const accumulationFactor = (1 + periodicRate) ** periods;
  const existingAssetsFutureValue = existingAssets * accumulationFactor;

  let contributionFutureValue;
  if (periodicRate === 0) {
    contributionFutureValue = periodicContribution * periods;
  } else {
    contributionFutureValue =
      periodicContribution * ((accumulationFactor - 1) / periodicRate);
    if (paymentTiming === "beginning") {
      contributionFutureValue *= 1 + periodicRate;
    }
  }

  const exactFutureValue =
    existingAssetsFutureValue + contributionFutureValue;
  const exactPresentPurchasingPower =
    exactFutureValue / (1 + inflationRate) ** years;
  const contributions = existingAssets + periodicContribution * periods;
  const investmentGrowth = exactFutureValue - contributions;

  return {
    existingAssets: roundTo(existingAssets, precision),
    periodicContribution: roundTo(periodicContribution, precision),
    years,
    paymentsPerYear,
    periods,
    paymentTiming,
    nominalAnnualRate,
    taxRate,
    afterTaxAnnualRate,
    periodicRate,
    inflationRate,
    contributions: roundTo(contributions, precision),
    existingAssetsFutureValue: roundTo(existingAssetsFutureValue, precision),
    contributionFutureValue: roundTo(contributionFutureValue, precision),
    investmentGrowth: roundTo(investmentGrowth, precision),
    futureValue: roundTo(exactFutureValue, precision),
    presentPurchasingPower: roundTo(
      exactPresentPurchasingPower,
      precision,
    ),
    exactFutureValue,
    exactPresentPurchasingPower,
    assumptions: [
      "名目年報酬率、稅率與通膨率在整段期間固定。",
      "所有投資報酬均以同一輸入稅率估算；實際稅負依商品與個案而異。",
      `每期投入發生在${paymentTiming === "beginning" ? "期初" : "期末"}。`,
      paymentsPerYear === 1
        ? "每年複利一次。"
        : `稅後年報酬率平均分成每年 ${paymentsPerYear} 期計息。`,
      "今日購買力以固定通膨率把退休時終值折算回目前價值。",
    ],
  };
}

/**
 * 計算信用卡循環餘額的清償期程。
 *
 * repaymentMode = "fixed"：
 *   先按期初未償餘額計息，再以固定付款扣除利息與本金。
 *
 * repaymentMode = "percentage"：
 *   依《財務計算概念 part3》的最低還款範例，先支付
 *   max(期初餘額 × 最低還款比例, 最低金額)，再對付款後餘額計息。
 *
 * 百分比輸入仍採「18 代表 18%」。所有期程以未四捨五入的數值累計，
 * 僅在回傳結果時依 precision 顯示取位，以避免逐期取位放大誤差。
 */
export function calculateCreditCardRepayment(input = {}) {
  const balance = nonNegative(input.balance, "信用卡未清償餘額");
  const nominalAnnualRate = percent(
    input.nominalAnnualRate,
    "名目年利率",
  );
  const paymentsPerYear = Math.trunc(
    toFiniteNumber(input.paymentsPerYear ?? 12, "每年付款次數"),
  );
  if (paymentsPerYear <= 0) {
    throw new RangeError("每年付款次數必須大於 0");
  }

  const precision = Math.trunc(nonNegative(input.precision ?? 2, "小數位數"));
  if (precision > 8) throw new RangeError("小數位數不可大於 8");

  const repaymentMode = input.repaymentMode === "percentage"
    ? "percentage"
    : "fixed";
  const periodicRate = nominalAnnualRate / paymentsPerYear;
  const effectiveAnnualRate = (1 + periodicRate) ** paymentsPerYear - 1;
  const fixedPayment = nonNegative(input.fixedPayment, "固定每期付款");
  const minimumPaymentPercent = percent(
    input.minimumPaymentPercent,
    "最低還款比例",
    { maximum: 100 },
  );
  const minimumPaymentFloor = nonNegative(
    input.minimumPaymentFloor,
    "最低還款金額",
  );
  const maximumPeriods = 1200;

  if (balance > 0 && repaymentMode === "fixed") {
    if (fixedPayment <= 0) {
      throw new RangeError("固定每期付款必須大於 0");
    }
    const firstPeriodInterest = balance * periodicRate;
    if (fixedPayment <= firstPeriodInterest) {
      throw new RangeError(
        `固定每期付款必須高於首期利息 ${roundTo(firstPeriodInterest, precision)}`,
      );
    }
  }

  if (balance > 0 && repaymentMode === "percentage") {
    if (minimumPaymentPercent <= 0 && minimumPaymentFloor <= 0) {
      throw new RangeError("最低還款比例或最低還款金額至少一項必須大於 0");
    }
    if (minimumPaymentFloor <= 0) {
      throw new RangeError("最低還款金額必須大於 0，才能產生完整清償期程");
    }
  }

  const schedule = [];
  let remainingBalance = balance;
  let exactTotalInterest = 0;
  let exactTotalPayments = 0;

  while (remainingBalance > 0 && schedule.length < maximumPeriods) {
    const period = schedule.length + 1;
    const openingBalance = remainingBalance;
    let payment;
    let interest;
    let principal;
    let closingBalance;

    if (repaymentMode === "percentage") {
      payment = Math.min(
        openingBalance,
        Math.max(
          openingBalance * minimumPaymentPercent,
          minimumPaymentFloor,
        ),
      );
      const balanceAfterPayment = openingBalance - payment;
      interest = balanceAfterPayment * periodicRate;
      principal = payment - interest;
      closingBalance = balanceAfterPayment + interest;
    } else {
      interest = openingBalance * periodicRate;
      payment = Math.min(fixedPayment, openingBalance + interest);
      principal = payment - interest;
      closingBalance = openingBalance - principal;
    }

    // 吸收浮點數尾差，但不把一般的小額餘額提前視為清償。
    if (Math.abs(closingBalance) < 1e-10) closingBalance = 0;

    exactTotalInterest += interest;
    exactTotalPayments += payment;
    schedule.push({
      period,
      openingBalance: roundTo(openingBalance, precision),
      payment: roundTo(payment, precision),
      principal: roundTo(principal, precision),
      interest: roundTo(interest, precision),
      closingBalance: roundTo(closingBalance, precision),
    });
    remainingBalance = closingBalance;
  }

  if (remainingBalance > 0) {
    throw new RangeError(
      `依目前條件超過 ${maximumPeriods} 期仍未清償，請提高還款金額或比例`,
    );
  }

  return {
    repaymentMode,
    methodLabel: repaymentMode === "fixed"
      ? "固定每期付款"
      : "最低還款比例（先付款後計息）",
    balance: roundTo(balance, precision),
    nominalAnnualRate,
    paymentsPerYear,
    periodicRate,
    effectiveAnnualRate,
    fixedPayment: roundTo(fixedPayment, precision),
    minimumPaymentPercent,
    minimumPaymentFloor: roundTo(minimumPaymentFloor, precision),
    periods: schedule.length,
    totalInterest: roundTo(exactTotalInterest, precision),
    totalPayments: roundTo(exactTotalPayments, precision),
    exactTotalInterest,
    exactTotalPayments,
    schedule,
    assumptions: [
      "名目年利率在完整清償期間固定，且以每年付款次數平均分成每期利率。",
      "未計入新增刷卡、預借現金手續費、違約金、年費或其他費用。",
      repaymentMode === "fixed"
        ? "每期先按期初未償餘額計息，再以固定付款償還利息及本金；最後一期按實際應付金額截短。"
        : "依講義範例先支付期初餘額的一定比例或最低金額，再對付款後餘額計息。",
      "逐期以未四捨五入數值累計，畫面金額才依設定小數位數取位。",
    ],
  };
}
