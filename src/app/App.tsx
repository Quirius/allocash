import { useEffect, useState } from "react";
import { loadBudgetInfo, type BudgetInfo } from "../lib/desktop";

type Startup =
  | { status: "loading" }
  | { status: "ready"; budget: BudgetInfo }
  | { status: "preview" }
  | { status: "error" };

export function App() {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStartup({ status: "loading" });
    loadBudgetInfo().then(
      (budget) => {
        if (active) setStartup(budget ? { status: "ready", budget } : { status: "preview" });
      },
      () => {
        if (active) setStartup({ status: "error" });
      },
    );
    return () => { active = false; };
  }, [attempt]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Budget sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">A</span>Allocash</div>
        <div className="budget-name">{startup.status === "ready" ? startup.budget.name : "My budget"}</div>
        <p className="sidebar-caption">Your money. On your computer.</p>
        <div className="nav-current">Accounts <span>v0.1</span></div>
        <div className="account-groups">
          {["Cash", "Credit", "Loans", "Tracking", "Closed"].map((group) => (
            <section className="account-group" key={group}>
              <h2>{group}</h2>
              <p>No accounts yet</p>
            </section>
          ))}
        </div>
        <div className="sidebar-footer"><span className="status-dot" /> Offline · HUF</div>
      </aside>

      <main id="workspace" tabIndex={-1}>
        <header className="workspace-header">
          <div><p className="eyebrow">YOUR BUDGET</p><h1>Accounts</h1></div>
          <span className="stage-badge">Foundation preview</span>
        </header>

        <div className="workspace-content">
          <div className={`connection-status ${startup.status === "error" ? "error" : ""}`} role="status" aria-live="polite">
            {startup.status === "loading" && "Opening your local budget…"}
            {startup.status === "ready" && "Your local budget is ready. Data stays on this computer."}
            {startup.status === "preview" && "Browser preview — open the desktop app to use local storage."}
            {startup.status === "error" && <>
              Could not open your local budget. Check the data folder permissions and restart the app.
              <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
            </>}
          </div>

          <section className="empty-state" aria-labelledby="welcome-title">
            <div className="ledger-icon" aria-hidden="true"><i /><i /><i /></div>
            <p className="eyebrow">A FRESH START</p>
            <h2 id="welcome-title">A place for every forint.</h2>
            <p>Your local budgeting app starts here. The next step is bringing in your accounts and transaction history.</p>
            <div className="next-step"><span>UP NEXT</span> YNAB import & account register</div>
            <p className="availability-note">Import and transaction entry are still being built.</p>
          </section>

          <section className="details-card" aria-labelledby="budget-details">
            <h2 id="budget-details">Budget details</h2>
            <dl>
              <div><dt>Currency</dt><dd>Hungarian forint · HUF</dd></div>
              <div><dt>Storage</dt><dd>{startup.status === "ready" ? "Local SQLite database" : "Available in the desktop app"}</dd></div>
              <div><dt>Connection</dt><dd>No account or internet required</dd></div>
            </dl>
            {startup.status === "ready" && <details>
              <summary>Local data location</summary>
              <p className="database-path">{startup.budget.databasePath}</p>
            </details>}
          </section>
        </div>
      </main>
    </div>
  );
}
