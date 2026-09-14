import { useEffect, useMemo, useState } from "react";
import {
  loadAccountRegister,
  loadWorkspace,
  type AccountKind,
  type AccountOverview,
  type RegisterEntry,
  type WorkspaceSnapshot,
} from "../lib/desktop";
import { formatDate, formatHuf, localCalendarDate } from "../lib/format";

type Startup =
  | { status: "loading" }
  | { status: "ready"; workspace: WorkspaceSnapshot }
  | { status: "preview" }
  | { status: "error" };

type RegisterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; entries: RegisterEntry[] }
  | { status: "error" };

interface AccountGroup {
  title: string;
  kind?: AccountKind;
  closed?: true;
}

const accountGroups: AccountGroup[] = [
  { title: "Cash", kind: "cash" },
  { title: "Credit", kind: "credit" },
  { title: "Loans", kind: "loan" },
  { title: "Tracking", kind: "tracking" },
  { title: "Closed", closed: true },
];

function inGroup(account: AccountOverview, group: AccountGroup): boolean {
  return group.closed ? account.closed : !account.closed && account.kind === group.kind;
}

function huf(value: string): string {
  return formatHuf(BigInt(value));
}

function groupTotal(accounts: AccountOverview[]): string {
  const total = accounts.reduce(
    (sum, account) => sum + BigInt(account.balance.working),
    0n,
  );
  return huf(total.toString());
}

function displayPayee(entry: RegisterEntry): string {
  if (entry.transferAccountName) return `Transfer: ${entry.transferAccountName}`;
  return entry.payeeName || "No payee";
}

function displayCategory(entry: RegisterEntry): string {
  if (entry.transferAccountName) return "Transfer";
  if (entry.categoryGroupName && entry.categoryName) {
    return `${entry.categoryGroupName} / ${entry.categoryName}`;
  }
  return entry.categoryName || "Uncategorized";
}

function statusLabel(entry: RegisterEntry): string {
  if (entry.clearedState === "reconciled") return "Reconciled";
  if (entry.clearedState === "cleared") return "Cleared";
  return "Uncleared";
}

export function App() {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [register, setRegister] = useState<RegisterState>({ status: "idle" });
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [registerAttempt, setRegisterAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStartup({ status: "loading" });
    loadWorkspace(localCalendarDate()).then(
      (workspace) => {
        if (!active) return;
        if (!workspace) {
          setSelectedAccountId(null);
          setStartup({ status: "preview" });
          return;
        }
        setSelectedAccountId((selected) =>
          workspace.accounts.some((account) => account.id === selected)
            ? selected
            : workspace.accounts[0]?.id ?? null,
        );
        setStartup({ status: "ready", workspace });
      },
      () => {
        if (active) setStartup({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [startupAttempt]);

  useEffect(() => {
    if (startup.status !== "ready" || !selectedAccountId) {
      setRegister({ status: "idle" });
      return;
    }
    let active = true;
    setRegister({ status: "loading" });
    loadAccountRegister(selectedAccountId).then(
      (entries) => {
        if (active) setRegister({ status: "ready", entries: entries ?? [] });
      },
      () => {
        if (active) setRegister({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [selectedAccountId, registerAttempt, startup.status]);

  const accounts = startup.status === "ready" ? startup.workspace.accounts : [];
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Budget sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">A</span>Allocash</div>
        <div className="budget-name">
          {startup.status === "ready" ? startup.workspace.budget.name : "My budget"}
        </div>
        <p className="sidebar-caption">Your money. On your computer.</p>
        <div className="nav-current">Accounts <span>{accounts.length}</span></div>
        <nav className="account-groups" aria-label="Accounts">
          {accountGroups.map((group) => {
            const groupedAccounts = accounts.filter((account) => inGroup(account, group));
            return (
              <section className="account-group" key={group.title}>
                <div className="account-group-heading">
                  <h2>{group.title}</h2>
                  {groupedAccounts.length > 0 && <span>{groupTotal(groupedAccounts)}</span>}
                </div>
                {groupedAccounts.length === 0 ? (
                  <p>No accounts</p>
                ) : groupedAccounts.map((account) => (
                  <button
                    className={`account-link ${selectedAccountId === account.id ? "selected" : ""}`}
                    key={account.id}
                    onClick={() => setSelectedAccountId(account.id)}
                    aria-current={selectedAccountId === account.id ? "page" : undefined}
                  >
                    <span>{account.name}</span>
                    <strong className={BigInt(account.balance.working) < 0n ? "negative" : ""}>
                      {huf(account.balance.working)}
                    </strong>
                  </button>
                ))}
              </section>
            );
          })}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /> Offline · HUF</div>
      </aside>

      <main id="workspace" tabIndex={-1}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{selectedAccount ? "ACCOUNT REGISTER" : "YOUR BUDGET"}</p>
            <h1>{selectedAccount?.name ?? "Accounts"}</h1>
          </div>
          <span className="stage-badge">Local ledger</span>
        </header>

        <div className="workspace-content">
          {startup.status !== "ready" && (
            <div className={`connection-status ${startup.status === "error" ? "error" : ""}`} role="status" aria-live="polite">
              {startup.status === "loading" && "Opening your local budget…"}
              {startup.status === "preview" && "Browser preview — open the desktop app to read your local ledger."}
              {startup.status === "error" && <>
                Could not open your local budget. Check the data folder permissions and restart the app.
                <button onClick={() => setStartupAttempt((value) => value + 1)}>Retry</button>
              </>}
            </div>
          )}

          {startup.status === "ready" && selectedAccount && (
            <AccountRegister
              account={selectedAccount}
              register={register}
              onRetry={() => setRegisterAttempt((value) => value + 1)}
            />
          )}

          {startup.status === "ready" && !selectedAccount && <EmptyLedger />}
          {startup.status === "preview" && <EmptyLedger preview />}

          <section className="details-card" aria-labelledby="budget-details">
            <h2 id="budget-details">Budget details</h2>
            <dl>
              <div><dt>Currency</dt><dd>Hungarian forint · HUF</dd></div>
              <div><dt>Storage</dt><dd>{startup.status === "ready" ? "Local SQLite database" : "Available in the desktop app"}</dd></div>
              <div><dt>Connection</dt><dd>No account or internet required</dd></div>
            </dl>
            {startup.status === "ready" && <details>
              <summary>Local data location</summary>
              <p className="database-path">{startup.workspace.budget.databasePath}</p>
            </details>}
          </section>
        </div>
      </main>
    </div>
  );
}

function EmptyLedger({ preview = false }: { preview?: boolean }) {
  return (
    <section className="empty-state" aria-labelledby="welcome-title">
      <div className="ledger-icon" aria-hidden="true"><i /><i /><i /></div>
      <p className="eyebrow">{preview ? "DESKTOP REQUIRED" : "A FRESH START"}</p>
      <h2 id="welcome-title">A place for every forint.</h2>
      <p>
        {preview
          ? "The browser preview never opens or imitates your private budget data."
          : "Your account register is ready. Import or create an account to begin."}
      </p>
    </section>
  );
}

function AccountRegister({
  account,
  register,
  onRetry,
}: {
  account: AccountOverview;
  register: RegisterState;
  onRetry: () => void;
}) {
  return (
    <section className="register" aria-labelledby="register-title">
      <h2 className="sr-only" id="register-title">{account.name} transaction register</h2>
      <div className="balance-strip">
        <div className="primary-balance">
          <span>Working balance</span>
          <strong className={BigInt(account.balance.working) < 0n ? "negative" : ""}>
            {huf(account.balance.working)}
          </strong>
        </div>
        <div><span>Cleared</span><strong>{huf(account.balance.cleared)}</strong></div>
        <div><span>Uncleared</span><strong>{huf(account.balance.uncleared)}</strong></div>
        <div><span>Reconciled</span><strong>{huf(account.balance.reconciled)}</strong></div>
      </div>

      <div className="register-toolbar">
        <div>
          <strong>All transactions</strong>
          <span>{register.status === "ready" ? `${register.entries.length} entries` : "Local history"}</span>
        </div>
        <button disabled title="Manual entry is the next implementation step">+ Add transaction</button>
      </div>

      {register.status === "loading" && <div className="register-message" role="status">Loading transactions…</div>}
      {register.status === "error" && (
        <div className="register-message error" role="alert">
          Could not read this account register. <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {register.status === "ready" && register.entries.length === 0 && (
        <div className="register-message">No transactions in this account yet.</div>
      )}
      {register.status === "ready" && register.entries.length > 0 && (
        <div className="register-table-wrap">
          <table className="register-table">
            <thead>
              <tr>
                <th className="flag-column"><span className="sr-only">Flag</span></th>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th>Memo</th>
                <th className="status-column">Status</th>
                <th className="money-column">Outflow</th>
                <th className="money-column">Inflow</th>
              </tr>
            </thead>
            <tbody>
              {register.entries.map((entry) => {
                const amount = BigInt(entry.amount);
                return (
                  <tr key={entry.id} className={entry.postingState === "scheduled" ? "scheduled" : undefined}>
                    <td className="flag-column">
                      {entry.flagColor && (
                        <span
                          className={`flag flag-${entry.flagColor}`}
                          title={entry.flagName || `${entry.flagColor} flag`}
                        />
                      )}
                    </td>
                    <td className="date-column">{formatDate(entry.date)}</td>
                    <td className="payee-column">{displayPayee(entry)}</td>
                    <td className="category-column">{displayCategory(entry)}</td>
                    <td className="memo-column">{entry.memo || <span>—</span>}</td>
                    <td className="status-column">
                      <span className={`cleared-state ${entry.clearedState}`} title={statusLabel(entry)}>
                        {entry.clearedState === "reconciled" ? "R" : entry.clearedState === "cleared" ? "C" : "U"}
                      </span>
                    </td>
                    <td className="money-column outflow">{amount < 0n ? huf((-amount).toString()) : ""}</td>
                    <td className="money-column inflow">{amount >= 0n ? huf(amount.toString()) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
