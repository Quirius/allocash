import { useEffect, useState, type ChangeEvent } from "react";
import {
  loadBalanceOverTime,
  loadForecast,
  loadIncomeBreakdown,
  loadIncomeVsExpense,
  loadInflowOutflowByMonth,
  loadNetWorthReport,
  loadOutflowOverTime,
  loadSpendingByCategory,
  loadSpendingByPayee,
  type AccountOverview,
  type BalanceOverTimeReport,
  type CategoryOption,
  type ForecastReport,
  type IncomeBreakdownReport,
  type IncomeExpenseReport,
  type InflowOutflowReport,
  type NetWorthReport,
  type OutflowOverTimeReport,
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

function balancePath(values: string[]): string {
  if (values.length === 0) return "";
  const amounts = values.map(BigInt);
  const minimum = amounts.reduce((current, amount) => amount < current ? amount : current);
  const maximum = amounts.reduce((current, amount) => amount > current ? amount : current);
  const range = maximum - minimum;
  const denominator = BigInt(Math.max(amounts.length - 1, 1));
  return amounts.map((amount, index) => {
    const x = 10 + Number(BigInt(index) * 340n / denominator);
    const y = range === 0n ? 60 : 10 + Number((maximum - amount) * 100n / range);
    return `${x},${y}`;
  }).join(" ");
}

function forecastPath(report: ForecastReport, percentile: number): string[] {
  return report.percentilePaths.find((path) => path.percentile === percentile)?.balances ?? [];
}

export function ReportsView({ accounts, categories: categoryOptions }: { accounts: AccountOverview[]; categories: CategoryOption[] }) {
  const today = localCalendarDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [forecastAccountIds, setForecastAccountIds] = useState<string[]>([]);
  const [balanceAccountIds, setBalanceAccountIds] = useState<string[]>([]);
  const [outflowCategoryIds, setOutflowCategoryIds] = useState<Array<string | null>>([]);
  const [forecastHorizon, setForecastHorizon] = useState(12);
  const [forecastHistory, setForecastHistory] = useState(12);
  const [forecastSeed, setForecastSeed] = useState("1");
  const [categories, setCategories] = useState<SpendingCategoryTotal[] | null>(null);
  const [payees, setPayees] = useState<SpendingPayeeTotal[] | null>(null);
  const [cashFlow, setCashFlow] = useState<InflowOutflowReport | null>(null);
  const [incomeExpense, setIncomeExpense] = useState<IncomeExpenseReport | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BalanceOverTimeReport | null>(null);
  const [outflowHistory, setOutflowHistory] = useState<OutflowOverTimeReport | null>(null);
  const [incomeBreakdown, setIncomeBreakdown] = useState<IncomeBreakdownReport | null>(null);
  const [forecast, setForecast] = useState<ForecastReport | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const input = { from, to, accountIds };
      const [spendingByCategory, spendingByPayee, inflowOutflow, incomeVsExpense, history, outflow, breakdown, projection, worth] = await Promise.all([
        loadSpendingByCategory(input),
        loadSpendingByPayee(input),
        loadInflowOutflowByMonth(input),
        loadIncomeVsExpense(input),
        loadBalanceOverTime({ from, to, accountIds: balanceAccountIds }),
        loadOutflowOverTime({ from, to, accountIds, categoryIds: outflowCategoryIds }),
        loadIncomeBreakdown({ from, to, accountIds }),
        loadForecast({ asOf: to, horizonMonths: forecastHorizon, historyMonths: forecastHistory, accountIds: forecastAccountIds, categoryIds: outflowCategoryIds, seed: forecastSeed }),
        loadNetWorthReport(to, from),
      ]);
      setCategories(spendingByCategory);
      setPayees(spendingByPayee);
      setCashFlow(inflowOutflow);
      setIncomeExpense(incomeVsExpense);
      setBalanceHistory(history);
      setOutflowHistory(outflow);
      setIncomeBreakdown(breakdown);
      setForecast(projection);
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

  function toggleBalanceAccount(id: string) {
    setBalanceAccountIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleForecastAccount(id: string) {
    setForecastAccountIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function updateOutflowCategories(event: ChangeEvent<HTMLSelectElement>) {
    setOutflowCategoryIds(Array.from(event.target.selectedOptions, (option) =>
      option.value === "__uncategorized__" ? null : option.value,
    ));
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
        <label>
          Outflow / forecast expense categories
          <select
            multiple
            value={outflowCategoryIds.map((id) => id ?? "__uncategorized__")}
            onChange={updateOutflowCategories}
          >
            <option value="__uncategorized__">Uncategorized</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>{category.groupName} / {category.name}</option>
            ))}
          </select>
        </label>
        <label>Forecast horizon
          <select value={forecastHorizon} onChange={(event) => setForecastHorizon(Number(event.target.value))}>
            {[3, 6, 12, 24, 36].map((months) => <option key={months} value={months}>{months} months</option>)}
          </select>
        </label>
        <label>Forecast history
          <select value={forecastHistory} onChange={(event) => setForecastHistory(Number(event.target.value))}>
            {[3, 6, 12, 24, 36, 60].map((months) => <option key={months} value={months}>{months} complete months</option>)}
          </select>
        </label>
        <label>Forecast seed<input value={forecastSeed} onChange={(event) => setForecastSeed(event.target.value)} inputMode="numeric" /></label>
        <span>Forecast accounts (open cash/credit when none selected)</span>
        {accounts.map((account) => (
          <label key={`forecast-${account.id}`}>
            <input
              type="checkbox"
              checked={forecastAccountIds.includes(account.id)}
              onChange={() => toggleForecastAccount(account.id)}
            /> {account.name}
          </label>
        ))}
        <span>Balance accounts (all when none selected)</span>
        {accounts.map((account) => (
          <label key={`balance-${account.id}`}>
            <input
              type="checkbox"
              checked={balanceAccountIds.includes(account.id)}
              onChange={() => toggleBalanceAccount(account.id)}
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
      {balanceHistory === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Balance over time · selected accounts</h3>
          <figure className="balance-chart">
            <svg viewBox="0 0 360 120" role="img" aria-label="Balance over time">
              <polyline points={balancePath(balanceHistory.totalBalances)} />
            </svg>
            <figcaption>{balanceHistory.accounts.length} account{balanceHistory.accounts.length === 1 ? "" : "s"} · posted working balances</figcaption>
          </figure>
          {balanceHistory.pointDates.map((point, index) => (
            <div key={point}>
              <span><strong>{point}</strong><small>Inclusive as-of balance</small></span>
              <b>{formatHuf(BigInt(balanceHistory.totalBalances[index] ?? "0"))}</b>
            </div>
          ))}
        </section>
      )}
      {forecast === null ? (
        <div className="register-message">Loading forecast…</div>
      ) : (
        <section className="schedule-list forecast-report">
          <h3>Balance forecast</h3>
          <figure className="balance-chart">
            <svg viewBox="0 0 360 120" role="img" aria-label="Forecast percentile paths">
              <polyline points={balancePath(forecastPath(forecast, 10))} style={{ stroke: "#bd7a78" }} />
              <polyline points={balancePath(forecastPath(forecast, 25))} style={{ stroke: "#c9a96c" }} />
              <polyline points={balancePath(forecastPath(forecast, 50))} style={{ stroke: "#8ad3a7", strokeWidth: 4 }} />
              <polyline points={balancePath(forecastPath(forecast, 75))} style={{ stroke: "#87b9d0" }} />
              <polyline points={balancePath(forecastPath(forecast, 90))} style={{ stroke: "#728fc2" }} />
            </svg>
            <figcaption>{forecast.simulationCount.toLocaleString()} deterministic simulations · {forecast.historyFrom} to {forecast.historyTo} · P10 / P25 / median / P75 / P90</figcaption>
          </figure>
          {forecast.pointDates.map((point, index) => (
            <div key={point}>
              <span><strong>{point}</strong><small>P10 {formatHuf(BigInt(forecastPath(forecast, 10)[index] ?? "0"))} · P90 {formatHuf(BigInt(forecastPath(forecast, 90)[index] ?? "0"))}</small></span>
              <b>{formatHuf(BigInt(forecastPath(forecast, 50)[index] ?? "0"))}</b>
            </div>
          ))}
          <p className="forecast-assumptions">{forecast.assumptions.join(" ")}</p>
        </section>
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
      {outflowHistory === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Outflow over time</h3>
          <figure className="balance-chart">
            <svg viewBox="0 0 360 120" role="img" aria-label="Outflow over time">
              <polyline points={balancePath(outflowHistory.monthlyTotals.map((row) => row.outflow))} />
            </svg>
            <figcaption>{outflowHistory.transactionCount} posted outflow{outflowHistory.transactionCount === 1 ? "" : "s"} · Average {formatHuf(BigInt(outflowHistory.averageMonthlyOutflow))}</figcaption>
          </figure>
          <div className="cash-flow-total">
            <span><strong>Selected period</strong><small>Gross ordinary outflow</small></span>
            <b>{formatHuf(BigInt(outflowHistory.totalOutflow))}</b>
          </div>
          {outflowHistory.monthlyTotals.map((row) => (
            <div key={row.month}>
              <span><strong>{row.month}</strong><small>{row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"}</small></span>
              <b>{formatHuf(BigInt(row.outflow))}</b>
            </div>
          ))}
          {outflowHistory.categories.map((category) => (
            <div key={category.categoryId ?? "uncategorized"}>
              <span>
                <strong>{category.groupName} / {category.categoryName}</strong>
                <small>{outflowHistory.months.map((month, index) => `${month}: ${formatHuf(BigInt(category.amounts[index] ?? "0"))}`).join(" · ")} · Average {formatHuf(BigInt(category.average))}</small>
              </span>
              <b>{formatHuf(BigInt(category.total))}</b>
            </div>
          ))}
        </section>
      )}
      {incomeBreakdown === null ? (
        <div className="register-message">Loading report…</div>
      ) : (
        <section className="schedule-list">
          <h3>Income breakdown</h3>
          {incomeBreakdown.totalIncome === "0" && incomeBreakdown.totalExpense === "0" ? <p className="income-flow-empty">No posted activity in this range.</p> : (
            <>
              <div className="income-flow">
                <section>
                  <h4>Income sources</h4>
                  {incomeBreakdown.incomeSources.map((source) => (
                    <div key={source.payeeId ?? "no-payee"}><span>{source.payeeName}</span><b>{formatHuf(BigInt(source.total))}</b></div>
                  ))}
                </section>
                <section className="income-flow-total">
                  <h4>Total income</h4>
                  <strong>{formatHuf(BigInt(incomeBreakdown.totalIncome))}</strong>
                  <span>→ Total expenses</span>
                  <strong>{formatHuf(BigInt(incomeBreakdown.totalExpense))}</strong>
                  {BigInt(incomeBreakdown.netIncome) >= 0n ? <small>Net gain {formatHuf(BigInt(incomeBreakdown.netIncome))}</small> : <small>Period shortfall {formatHuf(-BigInt(incomeBreakdown.netIncome))}<br />Funded by prior balances or debt.</small>}
                </section>
                <section>
                  <h4>Expense groups</h4>
                  {incomeBreakdown.expenseGroups.map((group) => (
                    <div key={group.groupId ?? "uncategorized"}><span>{group.groupName}</span><b>{formatHuf(BigInt(group.total))}</b></div>
                  ))}
                </section>
              </div>
              <p className="income-flow-disclosure">Flows compare aggregate period income and spending; they do not trace individual funds.</p>
            </>
          )}
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
