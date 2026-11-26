/**
 * 櫻木財務規劃 — 子女教育規劃計算核心
 *
 * 百分比輸入採「5 代表 5%」。本模組不讀寫 DOM、localStorage
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

function percent(value, fieldName) {
  return nonNegative(value, fieldName) / 100;
}

function positiveInteger(value, fieldName) {
  const parsed = toFiniteNumber(value, fieldName);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${fieldName}必須是大於 0 的整數`);
  }
  return parsed;
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 反推教育基金每期所需投入。
 *
 * 公式依《財務計算概念 part3》教育案例：
 * - 第 k 學年學費 = 今日年學費 × (1+教育費成長率)^(入學年數+k)
 * - 入學時目標 = 各學年名目學費加總
 * - 期末年金終值因子 = ((1+i)^n−1) / i
 * - 期初年金終值因子 = 期末因子 × (1+i)
 *
 * 教材將就學期間的各年名目學費全數視為入學時就要備妥，
 * 因此本計算不假設就學四年間未支用資金還會繼續獲利。
 */
export function calculateEducationPlan(input = {}) {
  const annualTuitionToday = nonNegative(
    input.annualTuitionToday,
    "今日每年教育費",
  );
  const tuitionGrowthRate = percent(
    input.tuitionGrowthRate,
    "教育費年成長率",
  );
  const yearsUntilEnrollment = nonNegative(
    input.yearsUntilEnrollment,
    "距離入學年數",
  );
  const studyYears = positiveInteger(input.studyYears, "就學年數");
  const investmentAnnualRate = percent(
    input.investmentAnnualRate,
    "名目年報酬率",
  );
  const existingFund = nonNegative(input.existingFund, "既有教育基金");
  const paymentsPerYear = positiveInteger(
    input.paymentsPerYear ?? 12,
    "每年投入次數",
  );
  const paymentTiming = input.paymentTiming === "end" ? "end" : "beginning";
  const precision = Math.trunc(nonNegative(input.precision ?? 2, "小數位數"));
  if (precision > 8) throw new RangeError("小數位數不可大於 8");

  const exactPeriods = yearsUntilEnrollment * paymentsPerYear;
  const periods = Math.round(exactPeriods);
  if (Math.abs(exactPeriods - periods) > 1e-9) {
    throw new RangeError("距離入學年數乘以每年投入次數必須為整數期數");
  }

  const scheduleExact = Array.from({ length: studyYears }, (_, index) => {
    const paymentYear = yearsUntilEnrollment + index;
    const tuition = annualTuitionToday * (1 + tuitionGrowthRate) ** paymentYear;
    return {
      academicYear: index + 1,
      paymentYear,
      tuition,
    };
  });
  const schedule = scheduleExact.map((row) => ({
    academicYear: row.academicYear,
    paymentYear: row.paymentYear,
    tuition: roundTo(row.tuition, precision),
  }));
  // 講義先列出各學年取位後的金額，再將顯示金額相加；沿用相同順序，
  // 讓明細逐列加總與畫面／報告的名目總需求完全一致。
  const inflatedTuitionTotalExact = schedule.reduce(
    (sum, row) => sum + row.tuition,
    0,
  );

  const periodicRate = investmentAnnualRate / paymentsPerYear;
  const accumulationFactor = (1 + periodicRate) ** periods;
  const existingFundFutureValueExact = existingFund * accumulationFactor;
  const fundingGapExact = Math.max(
    0,
    inflatedTuitionTotalExact - existingFundFutureValueExact,
  );

  let annuityFactor;
  if (periods === 0) {
    annuityFactor = 0;
  } else if (periodicRate === 0) {
    annuityFactor = periods;
  } else {
    annuityFactor = (accumulationFactor - 1) / periodicRate;
    if (paymentTiming === "beginning") annuityFactor *= 1 + periodicRate;
  }

  if (fundingGapExact > 0 && annuityFactor === 0) {
    throw new RangeError(
      "入學時仍有資金缺口，距離入學年數必須大於 0 才能反推每期投入",
    );
  }

  const requiredPeriodicContributionExact =
    fundingGapExact === 0 ? 0 : fundingGapExact / annuityFactor;
  const projectedContributionFutureValueExact =
    requiredPeriodicContributionExact * annuityFactor;

  return {
    annualTuitionToday: roundTo(annualTuitionToday, precision),
    tuitionGrowthRate,
    yearsUntilEnrollment,
    studyYears,
    investmentAnnualRate,
    existingFund: roundTo(existingFund, precision),
    paymentsPerYear,
    paymentTiming,
    periods,
    periodicRate,
    schedule,
    inflatedTuitionTotal: roundTo(inflatedTuitionTotalExact, precision),
    existingFundFutureValue: roundTo(existingFundFutureValueExact, precision),
    fundingGap: roundTo(fundingGapExact, precision),
    requiredPeriodicContribution: roundTo(
      requiredPeriodicContributionExact,
      precision,
    ),
    projectedContributionFutureValue: roundTo(
      projectedContributionFutureValueExact,
      precision,
    ),
    exactInflatedTuitionTotal: inflatedTuitionTotalExact,
    exactExistingFundFutureValue: existingFundFutureValueExact,
    exactFundingGap: fundingGapExact,
    exactRequiredPeriodicContribution: requiredPeriodicContributionExact,
    assumptions: [
      "教育費年成長率與投資報酬率在全期固定。",
      "依講義保守假設，將所有學年的未來名目學費合計，視為入學時需備妥的目標。",
      "未計入就學期間未支用資金的投資報酬、稅負、獎學金、助學貸款與其他教育支出。",
      `每期投入發生在${paymentTiming === "beginning" ? "期初" : "期末"}。`,
      paymentsPerYear === 1
        ? "每年複利一次。"
        : `名目年報酬率平均分成每年 ${paymentsPerYear} 期計息。`,
    ],
  };
}
