export function creditPaymentStatus(currentBalance: string, available: string) {
  const balance = BigInt(currentBalance);
  const payment = BigInt(available);
  const debt = balance < 0n ? -balance : 0n;
  const shortfall = debt > payment ? debt - payment : 0n;
  return {
    state: payment < 0n ? "overspent" as const : shortfall > 0n ? "underfunded" as const : "funded" as const,
    shortfall,
    overspent: payment < 0n ? -payment : 0n,
  };
}
