const rate = (current, previous) => Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? current / previous - 1 : null;

export function compareMetric(current, comparison) {
  return {
    current: Number.isFinite(current) ? current : null,
    comparison: Number.isFinite(comparison) ? comparison : null,
    absoluteChange: Number.isFinite(current) && Number.isFinite(comparison) ? current - comparison : null,
    changeRate: rate(current, comparison),
  };
}

export function buildContributionAnalysis(currentGroups = [], comparisonGroups = []) {
  const previous = new Map(comparisonGroups.map((item) => [item.name, item]));
  return currentGroups.map((item) => {
    const before = previous.get(item.name);
    const change = Number(item.salesAmount || 0) - Number(before?.salesAmount || 0);
    return {
      name: item.name,
      current: Number(item.salesAmount || 0),
      comparison: Number(before?.salesAmount || 0),
      absoluteChange: change,
      changeRate: rate(Number(item.salesAmount || 0), Number(before?.salesAmount || 0)),
    };
  }).sort((a, b) => Math.abs(b.absoluteChange) - Math.abs(a.absoluteChange));
}

export function compareSummaries(current = {}, comparison = {}, currentGroups = [], comparisonGroups = []) {
  const sales = compareMetric(current.salesAmount, comparison.salesAmount);
  const quantity = compareMetric(current.quantity, comparison.quantity);
  const avgPrice = compareMetric(current.avgSellingPrice, comparison.avgSellingPrice);
  return {
    current,
    comparison,
    absoluteChange: {
      salesAmount: sales.absoluteChange,
      quantity: quantity.absoluteChange,
      avgSellingPrice: avgPrice.absoluteChange,
    },
    changeRate: {
      salesGrowthRate: sales.changeRate,
      quantityGrowthRate: quantity.changeRate,
      avgPriceGrowthRate: avgPrice.changeRate,
    },
    contributionAnalysis: buildContributionAnalysis(currentGroups, comparisonGroups),
    decomposition: {
      quantityEffect: Number.isFinite(comparison.avgSellingPrice) && Number.isFinite(current.quantity) && Number.isFinite(comparison.quantity)
        ? (current.quantity - comparison.quantity) * comparison.avgSellingPrice : null,
      priceEffect: Number.isFinite(current.avgSellingPrice) && Number.isFinite(comparison.avgSellingPrice) && Number.isFinite(current.quantity)
        ? (current.avgSellingPrice - comparison.avgSellingPrice) * current.quantity : null,
      priceVolumeOpposite: Number.isFinite(quantity.changeRate) && Number.isFinite(avgPrice.changeRate)
        ? Math.sign(quantity.changeRate) !== Math.sign(avgPrice.changeRate) && quantity.changeRate !== 0 && avgPrice.changeRate !== 0 : false,
    },
  };
}

export default compareSummaries;
