import { useEffect, useState } from "react";
import {
  loadIncomeVsExpense,
  loadInflowOutflowByMonth,
  loadNetWorthReport,
  loadSpendingByCategory,
  loadSpendingByPayee,
  type AccountOverview,
  type IncomeExpenseReport,
  type InflowOutflowReport,
  type NetWorthReport,
  type SpendingCategoryTotal,
  type SpendingPayeeTotal,
} from "../lib/desktop";
import { formatHuf, localCalendarDate } from "../lib/format";

function formatSavingsRatio(value: string | null): string {
  if (value === null) return "No income";
  const basisPoints = BigInt(value);
  const sign = basisPoints < 0n ? "−" : "";
  const magnitude = basisPoints < 0n ? -basisPoints : basisPoints;
  return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}%`;
}

export function ReportsView({ accounts }: { accounts: AccountOverview[] }) {
  const today = localCalendarDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<SpendingCategoryTotal[] | null>(null);
  const [payees, setPayees] = useState<SpendingPayeeTotal[] | null>(null);
  const [cashFlow, setCashFlow] = useState<InflowOutflowReport | null>(null);
  const [incomeExpense, setIncomeExpense] = useState<IncomeExpenseReport | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const input = { from, to, accountIds };
      const [spendingByCategory, spendingByPayee, inflowOutflow, incomeVsExpense, worth] = await Promise.all([
        loadSpendingByCategory(input),
        loadSpendingByPayee(input),
        loadInflowOutflowByMonth(input),
        loadIncomeVsExpense(input),
        loadNetWorthReport(to, from),
      ]);
      setCategories(spendingByCategory);
      setPayees(spendingByPayee);
      setCashFlow(inflowOutflow);
      setIncomeExpense(incomeVsExpense);
      setNetWorth(worth);
      setError(null);
    } catch {
      setError("Could not load these reports.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleAccount(id: string) {
    setAccountIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <section className="reports-view">
      <div className="plan-toolbar">
        <div>
          <p className="eyebrow">REPORTS</p>
          <h2>Spending and net worth</h2>
        </div>
      </div>
      {error && <p className="editor-error">{error}</p>}
      <form
        className="schedule-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <span>Activity report accounts</span>
        {accounts.map((account) => (
          <label key={account.id}>
            <input
              type="checkbox"
              checked={accountIds.includes(account.id)}
              onChange={() => toggleAccount(account.id)}
            /> {account.name}
          </label>
        ))}
        <button>Refresh</button>
      </form>
      {netWorth && (
        <div className="balance-strip">
          <div><span>Assets</span><strong>{formatHuf(BigInt(netWorth.assets))}</strong></div>
          <div><span>Debts</span><strong>{formatHuf(BigInt(netWorth.debts))}</strong></div>
          <div>
            <span>Net worth</span><strong>{formatHuf(BigInt(netWorth.netWorth))}</strong>
            {netWorth.change && <small>Change {formatHuf(BigInt(netWorth.change))}</small>}
          </div>
        </div>
      )}
      {cashFlow === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Inflow / outflow</h3>
          <div className="cash-flow-total">
            <span>
              <strong>Selected period</strong>
              <small>Inflow {formatHuf(BigInt(cashFlow.totalInflow))} · Outflow {formatHuf(BigInt(cashFlow.totalOutflow))}</small>
            </span>
            <b>{formatHuf(BigInt(cashFlow.totalDifference))}</b>
          </div>
          {cashFlow.months.map((row) => (
            <div key={row.month}>
              <span>
                <strong>{row.month}</strong>
                <small>Inflow {formatHuf(BigInt(row.inflow))} ({row.inflowTransactionCount}) · Outflow {formatHuf(BigInt(row.outflow))} ({row.outflowTransactionCount})</small>
              </span>
              <b>{formatHuf(BigInt(row.difference))}</b>
            </div>
          ))}
        </section>
      )}
      {incomeExpense === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Income vs expense</h3>
          <div className="cash-flow-total">
            <span>
              <strong>Selected period</strong>
              <small>Income {formatHuf(BigInt(incomeExpense.totalIncome))} · Expense {formatHuf(BigInt(incomeExpense.totalExpense))} · Savings {formatSavingsRatio(incomeExpense.savingsRatioBasisPoints)}</small>
            </span>
            <b>{formatHuf(BigInt(incomeExpense.totalNetIncome))}</b>
          </div>
          {incomeExpense.monthlyTotals.map((row) => (
            <div key={row.month}>
              <span>
                <strong>{row.month}</strong>
                <small>Income {formatHuf(BigInt(row.income))} · Expense {formatHuf(BigInt(row.expense))} · Savings {formatSavingsRatio(row.savingsRatioBasisPoints)}</small>
              </span>
              <b>{formatHuf(BigInt(row.netIncome))}</b>
            </div>
          ))}
          {incomeExpense.incomeGroups.flatMap((group) => group.categories.map((category) => (
            <div key={`income-${category.categoryId ?? "uncategorized"}`}>
              <span>
                <strong>Income · {group.groupName} / {category.categoryName}</strong>
                <small>{incomeExpense.months.map((month, index) => `${month}: ${formatHuf(BigInt(category.amounts[index] ?? "0"))}`).join(" · ")} · Average {formatHuf(BigInt(category.average))}</small>
              </span>
              <b>{formatHuf(BigInt(category.total))}</b>
            </div>
          )))}
          {incomeExpense.expenseGroups.flatMap((group) => group.categories.map((category) => (
            <div key={`expense-${category.categoryId ?? "uncategorized"}`}>
              <span>
                <strong>Expense · {group.groupName} / {category.categoryName}</strong>
                <small>{incomeExpense.months.map((month, index) => `${month}: ${formatHuf(BigInt(category.amounts[index] ?? "0"))}`).join(" · ")} · Average {formatHuf(BigInt(category.average))}</small>
              </span>
              <b>{formatHuf(BigInt(category.total))}</b>
            </div>
          )))}
        </section>
      )}
      {categories === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Spending by category</h3>
          {categories.length === 0 ? <p>No posted spending in this range.</p> : categories.map((row) => (
            <div key={row.categoryId ?? "uncategorized"}>
              <span>
                <strong>{row.categoryName}</strong>
                <small>{row.groupName ?? "Uncategorized"} · {row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"}</small>
              </span>
              <b>{formatHuf(BigInt(row.total))}</b>
            </div>
          ))}
        </section>
      )}
      {payees === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Spending by payee</h3>
          {payees.length === 0 ? <p>No posted spending in this range.</p> : payees.map((row) => (
            <div key={row.payeeName}>
              <span>
                <strong>{row.payeeName}</strong>
                <small>{row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"}</small>
              </span>
              <b>{formatHuf(BigInt(row.total))}</b>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
