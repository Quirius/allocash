import type { CreditPaymentCategory, PlanCategory } from "../lib/desktop";
import { formatHuf } from "../lib/format";
import { creditPaymentStatus } from "./credit-payment";

export function CreditPaymentDetails({ category, payment }: { category: PlanCategory; payment: CreditPaymentCategory }) {
  const status = creditPaymentStatus(payment.currentBalance, category.available);
  return <div className="credit-payment-details">
    <section className={`credit-payment-status ${status.state}`} aria-label="Payment funding status">
      <h4>Payment</h4>
      <strong>{status.state === "overspent" ? "Overspent" : status.state === "underfunded" ? "Underfunded" : "Fully funded"}</strong>
      <p>{status.state === "overspent"
        ? `Payment availability is negative by ${formatHuf(status.overspent)}. Assign money to cover this overspending.`
        : status.state === "underfunded"
          ? `Assign ${formatHuf(status.shortfall)} more to cover your current card balance.`
          : "You have enough money set aside to pay off your current card balance."}</p>
    </section>
    {status.shortfall > 0n && <dl className="credit-payment-shortfall"><div><dt>Total Underfunded</dt><dd>{formatHuf(status.shortfall)}</dd></div></dl>}
    <details className="credit-payment-breakdown" open>
      <summary><span>Current Balance</span><strong>{formatHuf(BigInt(payment.currentBalance))}</strong></summary>
      <dl><MoneyRow label="Prior Balance" value={payment.priorBalance} /><div className="credit-payment-subheading">Activity This Month</div><MoneyRow label="Spending and Outflows" value={payment.spendingAndOutflows} /><MoneyRow label="Payments and Inflows" value={payment.paymentsAndInflows} /></dl>
    </details>
    <details className="credit-payment-breakdown" open>
      <summary><span>Available for Payment</span><strong className={`credit-payment-amount ${status.state}`}>{formatHuf(BigInt(category.available))}</strong></summary>
      <dl><MoneyRow label="Cash Left Over From Last Month" value={payment.cashLeftOverFromLastMonth} /><div className="credit-payment-subheading">Activity This Month</div><MoneyRow label="Assigned" value={category.assigned} /><MoneyRow label="Funded Spending" value={payment.fundedSpending} /><MoneyRow label="Payments Made" value={payment.paymentsMade} />{BigInt(payment.otherActivity) !== 0n && <MoneyRow label="Other Activity" value={payment.otherActivity} />}</dl>
      {status.state === "overspent" && <p className="credit-payment-warning">Cover the {formatHuf(status.overspent)} overspending to restore this payment category’s balance.</p>}
    </details>
  </div>;
}

function MoneyRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{formatHuf(BigInt(value))}</dd></div>;
}
