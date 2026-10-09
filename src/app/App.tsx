import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createNativeBackup,
  listNativeBackups,
  loadAccountRegister,
  loadWorkspace,
  postScheduledOccurrence,
  skipScheduledOccurrence,
  recoverUnreadableBudget,
  restoreNativeBackup,
  hasSavedMutationPending,
  getSavedMutationVersion,
  loadUndoStatus,
  releaseUndoReservation,
  subscribeSavedMutations,
  undoLastAction,
  type AccountKind,
  type AccountOverview,
  type RegisterEntry,
  type WorkspaceSnapshot,
  type UndoStatus,
} from "../lib/desktop";
import { formatDate, formatHuf, localCalendarDate } from "../lib/format";
import { partitionRegisterEntries } from "../lib/register";
import { draftFromPostedEntry, RegisterEntryEditor, TransactionComposer, type TransactionDraft } from "./TransactionEditor";
import { ReconciliationEditor } from "./ReconciliationEditor";
import { PlanView } from "./PlanView";
import { ReportsView } from "./ReportsView";
import { isUndoShortcutEligible } from "../lib/undo";
import { createRequestSequence } from "../lib/request-sequence";

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

function displayCategory(entry: RegisterEntry, account: AccountOverview): string {
  if (entry.categoryGroupName && entry.categoryName) {
    return `${entry.categoryGroupName} / ${entry.categoryName}`;
  }
  if (entry.transferAccountName) return "Transfer";
  if (entry.categoryName) return entry.categoryName;
  return account.kind === "cash" || account.kind === "credit" ? "Uncategorized" : "—";
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
  const [view, setView] = useState<"register" | "plan" | "reports">("register");
  const [undoStatus, setUndoStatus] = useState<UndoStatus>({ canUndo: false, label: null });
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoFeedback, setUndoFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const undoLock = useRef(false);
  const ledgerRefreshSequence = useRef(createRequestSequence());
  const [mutation, setMutation] = useState({ pending: false, version: 0 });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [backup, setBackup] = useState<
    { status: "idle" } | { status: "saving" } | { status: "ready"; path: string } | { status: "error" }
  >({ status: "idle" });
  const [backups, setBackups] = useState<string[]>([]);
  const [backupDirectory, setBackupDirectory] = useState("");
  const [selectedBackup, setSelectedBackup] = useState("");
  const [restore, setRestore] = useState<
    { status: "idle" } | { status: "restoring" } | { status: "ready"; message: string; path: string } | { status: "error"; message: string }
  >({ status: "idle" });

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

  useEffect(() => subscribeSavedMutations((pending, version) => setMutation({ pending, version })), []);

  useEffect(() => {
    if (startup.status !== "ready" || mutation.pending) {
      if (startup.status !== "ready") setUndoStatus({ canUndo: false, label: null });
      return;
    }
    let active = true;
    const requestedVersion = mutation.version;
    loadUndoStatus().then((status) => {
      if (active && !hasSavedMutationPending() && getSavedMutationVersion() === requestedVersion) setUndoStatus(status ?? { canUndo: false, label: null });
    }).catch(() => {
      if (active && !hasSavedMutationPending() && getSavedMutationVersion() === requestedVersion) setUndoStatus({ canUndo: false, label: null });
    });
    return () => { active = false; };
  }, [startup.status, startup.status === "ready" ? startupAttempt : 0, mutation.version, mutation.pending]);

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

  useEffect(() => {
    if (startup.status === "ready" || startup.status === "error") {
      listNativeBackups().then((result) => {
        setBackups(result.names);
        setBackupDirectory(result.directory);
        setSelectedBackup((current) => result.names.includes(current) ? current : "");
      }).catch(() => setRestore({ status: "error", message: "Could not list local backups." }));
    }
  }, [startup.status, startupAttempt]);

  const accounts = startup.status === "ready" ? startup.workspace.accounts : [];
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  async function refreshLedger() {
    const request = ledgerRefreshSequence.current.begin();
    let workspace: WorkspaceSnapshot | null;
    try { workspace = await loadWorkspace(localCalendarDate()); }
    catch (error) {
      if (!ledgerRefreshSequence.current.isCurrent(request)) return;
      throw error;
    }
    if (!ledgerRefreshSequence.current.isCurrent(request)) return;
    if (!workspace) throw new Error("The desktop ledger is unavailable.");
    setSelectedAccountId((selected) => workspace.accounts.some((account) => account.id === selected) ? selected : workspace.accounts[0]?.id ?? null);
    setStartup({ status: "ready", workspace });
    setRegisterAttempt((value) => value + 1);
    setRefreshRevision((value) => value + 1);
  }

  async function undo() {
    if (undoLock.current || undoBusy || mutation.pending || hasSavedMutationPending() || !undoStatus.canUndo) return;
    undoLock.current = true;
    ledgerRefreshSequence.current.invalidate();
    setUndoBusy(true); setUndoFeedback(null);
    try {
      const nextStatus = await undoLastAction();
      await refreshLedger();
      setUndoStatus(nextStatus);
      setUndoFeedback({ kind: "success", message: "Last action undone." });
    } catch (error) {
      setUndoFeedback({ kind: "error", message: typeof error === "string" ? error : "Could not undo the last action." });
      const requestedVersion = getSavedMutationVersion();
      try {
        const status = await loadUndoStatus();
        if (status && !hasSavedMutationPending() && getSavedMutationVersion() === requestedVersion) setUndoStatus(status);
      } catch { /* Keep the current status when the refresh fails. */ }
    } finally { releaseUndoReservation(); undoLock.current = false; setUndoBusy(false); }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isUndoShortcutEligible(event)) return;
      if (undoLock.current || mutation.pending || hasSavedMutationPending() || !undoStatus.canUndo) return;
      event.preventDefault(); void undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoStatus, mutation.pending]);

  async function saveNativeBackup() {
    setBackup({ status: "saving" });
    try {
      const receipt = await createNativeBackup();
      setBackup({ status: "ready", path: receipt.path });
    } catch {
      setBackup({ status: "error" });
    }
  }

  async function refreshBackups() {
    const result = await listNativeBackups();
    setBackups(result.names);
    setBackupDirectory(result.directory);
    setSelectedBackup((current) => result.names.includes(current) ? current : "");
  }

  async function restoreSelectedBackup() {
    if (!selectedBackup || restore.status === "restoring") return;
    const recovering = startup.status === "error";
    const confirmation = recovering
      ? `Recover from ${selectedBackup}? Allocash will preserve the unreadable database files before installing this backup.`
      : `Restore ${selectedBackup}? This replaces the current budget. Allocash will save a verified safety backup first.`;
    if (!window.confirm(confirmation)) return;
    setRestore({ status: "restoring" });
    try {
      if (recovering) {
        const receipt = await recoverUnreadableBudget(selectedBackup);
        setRestore({ status: "ready", message: "Budget recovered. Unreadable files were preserved at", path: receipt.preservedDataPath });
      } else {
        const receipt = await restoreNativeBackup(selectedBackup);
        setRestore({ status: "ready", message: "Budget restored. The previous budget was saved at", path: receipt.safetyBackupPath });
      }
      setView("register");
      setSelectedAccountId(null);
      setStartupAttempt((value) => value + 1);
    } catch (error) {
      setRestore({ status: "error", message: String(error) });
    }
  }

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
          <div className="workspace-actions">
            <button className="undo-button" onClick={() => void undo()} disabled={!undoStatus.canUndo || mutation.pending || undoBusy || startup.status !== "ready"} title={undoStatus.label ? `Undo ${undoStatus.label} (Ctrl+Z)` : "Undo (Ctrl+Z)"}>
              {undoBusy ? "Undoing…" : undoStatus.label ? `Undo ${undoStatus.label}` : "Undo"} <kbd>Ctrl+Z</kbd>
            </button>
            <span className="stage-badge">Local ledger</span>
          </div>
        </header>

        <div className="workspace-content">
          {startup.status !== "ready" && (
            <div className={`connection-status ${startup.status === "error" ? "error" : ""}`} role="status" aria-live="polite">
              {startup.status === "loading" && "Opening your local budget…"}
              {startup.status === "preview" && "Browser preview — open the desktop app to read your local ledger."}
              {startup.status === "error" && <>
                Could not open your local budget. Retry, or recover from a verified local backup below if the database is unreadable.
                <button onClick={() => setStartupAttempt((value) => value + 1)} disabled={restore.status === "restoring"}>Retry</button>
              </>}
            </div>
          )}

          {startup.status === "ready" && <div className="workspace-tabs"><button className={view === "register" ? "active" : ""} onClick={() => setView("register")}>Register</button><button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}>Plan</button><button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}>Reports</button></div>}
          {undoFeedback && <p className={undoFeedback.kind === "error" ? "backup-error" : "backup-success"} role={undoFeedback.kind === "error" ? "alert" : "status"}>{undoFeedback.message}</p>}
          {startup.status === "ready" && view === "plan" && <PlanView refreshRevision={refreshRevision} readEpoch={mutation.version} mutationPending={mutation.pending} />}
          {startup.status === "ready" && view === "reports" && <ReportsView accounts={accounts} categories={startup.workspace.transactionOptions.categories} refreshRevision={refreshRevision} readEpoch={mutation.version} readPending={mutation.pending} />}
          {startup.status === "ready" && view === "register" && selectedAccount && (
            <AccountRegister
              key={selectedAccount.id}
              account={selectedAccount}
              accounts={accounts}
              options={startup.workspace.transactionOptions}
              register={register}
              onRetry={() => setRegisterAttempt((value) => value + 1)}
              onChanged={refreshLedger}
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
            {(startup.status === "ready" || startup.status === "error") && <div className="backup-controls">
              {startup.status === "ready" && <><button onClick={saveNativeBackup} disabled={backup.status === "saving" || restore.status === "restoring"}>
                {backup.status === "saving" ? "Creating verified backup…" : "Create verified backup"}
              </button>
              <p>A full local SQLite copy is saved beside your budget. Copy it to another drive or private storage to protect against disk loss.</p>
              {backup.status === "ready" && <p className="backup-success" role="status">Verified backup created: <span>{backup.path}</span></p>}
              {backup.status === "error" && <p className="backup-error" role="alert">The backup could not be created. Your live budget was not changed.</p>}</>}
              <div className="restore-controls">
                <p>{startup.status === "error" ? "Recover from a local backup. Allocash preserves the unreadable database files before installing it." : "Restore replaces the current budget after saving a safety copy."} Only backups in the local backups folder appear here.</p>
                {backupDirectory && <p className="database-path">Backups folder: {backupDirectory}</p>}
                <button onClick={() => refreshBackups().catch(() => setRestore({ status: "error", message: "Could not list local backups." }))} disabled={restore.status === "restoring"}>Find local backups</button>
                {startup.status === "error" && backups.length === 0 && <p>No local backups found. Copy a verified Allocash backup into this folder, then select Find local backups.</p>}
                {backups.length > 0 && <>
                  <label htmlFor="restore-backup">Backup to restore</label>
                  <select id="restore-backup" value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)} disabled={restore.status === "restoring"}>
                    <option value="">Choose a backup</option>
                    {backups.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button onClick={restoreSelectedBackup} disabled={!selectedBackup || restore.status === "restoring"}>{restore.status === "restoring" ? "Restoring…" : startup.status === "error" ? "Recover from backup" : "Restore selected backup"}</button>
                </>}
                {restore.status === "ready" && <p className="backup-success" role="status">{restore.message} <span>{restore.path}</span></p>}
                {restore.status === "error" && <p className="backup-error" role="alert">{restore.message}</p>}
              </div>
            </div>}
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
  accounts,
  options,
  register,
  onRetry,
  onChanged,
}: {
  account: AccountOverview;
  accounts: AccountOverview[];
  options: WorkspaceSnapshot["transactionOptions"];
  register: RegisterState;
  onRetry: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<"new" | "reconcile" | RegisterEntry | { kind: "duplicate"; key: number; draft: TransactionDraft } | null>(null);
  const [scheduleAction, setScheduleAction] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [registerPage, setRegisterPage] = useState(0);
  const [upcomingPage, setUpcomingPage] = useState(0);
  const registerPageSize = 100;
  const today = localCalendarDate();
  const entryCount = register.status === "ready" ? register.entries.length : 0;
  const partitionedEntries = useMemo(
    () => register.status === "ready" ? partitionRegisterEntries(register.entries, today) : { upcoming: [], history: [] },
    [register, today],
  );
  const historyCount = partitionedEntries.history.length;
  const historyPageCount = Math.ceil(historyCount / registerPageSize);
  const upcomingPageCount = Math.ceil(partitionedEntries.upcoming.length / registerPageSize);
  const safeUpcomingPage = Math.min(upcomingPage, Math.max(0, upcomingPageCount - 1));
  const upcomingPageEntries = useMemo(
    () => partitionedEntries.upcoming.slice(safeUpcomingPage * registerPageSize, (safeUpcomingPage + 1) * registerPageSize),
    [partitionedEntries, safeUpcomingPage],
  );
  const safeRegisterPage = register.status === "ready"
    ? Math.min(registerPage, Math.max(0, historyPageCount - 1))
    : registerPage;
  const pageEntries = useMemo(
    () => partitionedEntries.history.slice(safeRegisterPage * registerPageSize, (safeRegisterPage + 1) * registerPageSize),
    [partitionedEntries, safeRegisterPage],
  );

  useEffect(() => {
    setRegisterPage(0);
    setUpcomingPage(0);
    setEditor(null);
  }, [account.id]);

  useEffect(() => {
    if (register.status === "ready" && registerPage !== safeRegisterPage) setRegisterPage(safeRegisterPage);
  }, [register.status, registerPage, safeRegisterPage]);

  useEffect(() => {
    if (upcomingPage !== safeUpcomingPage) setUpcomingPage(safeUpcomingPage);
  }, [upcomingPage, safeUpcomingPage]);

  async function finishSchedule(id: string, post: boolean) {
    setScheduleAction(true); setScheduleError(null);
    try {
      if (post) await postScheduledOccurrence(id); else await skipScheduledOccurrence(id);
      await onChanged();
    } catch (error) {
      setScheduleError(typeof error === "string" ? error : "Could not update this scheduled entry.");
    } finally { setScheduleAction(false); }
  }

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
          <span>{register.status === "ready" ? `${entryCount} entries` : "Local history"}</span>
        </div>
        <button
          disabled={account.closed}
          title={account.closed ? "Reopen this account before reconciling" : undefined}
          onClick={() => setEditor("reconcile")}
        >Reconcile</button>
        <button
          disabled={account.closed}
          title={account.closed ? "Reopen this account before adding transactions" : undefined}
          onClick={() => setEditor("new")}
        >+ Add transaction</button>
      </div>

      {scheduleError && <p className="editor-error" role="alert">{scheduleError}</p>}
      {editor === "new" && (
        <TransactionComposer
          account={account}
          accounts={accounts}
          options={options}
          onSaved={onChanged}
          onCancel={() => setEditor(null)}
        />
      )}
      {typeof editor === "object" && editor !== null && "kind" in editor && editor.kind === "duplicate" && <TransactionComposer
        key={`duplicate-${editor.key}`} account={account} accounts={accounts} options={options} initialDraft={editor.draft}
        onSaved={onChanged} onCancel={() => setEditor(null)}
      />}
      {editor === "reconcile" && (
        <ReconciliationEditor account={account} onSaved={onChanged} onCancel={() => setEditor(null)} />
      )}
      {editor && typeof editor === "object" && !("kind" in editor) && (
        <RegisterEntryEditor
          key={editor.id}
          entry={editor}
          account={account}
          accounts={accounts}
          options={options}
          onMakeRepeating={() => { try { const draft = draftFromPostedEntry(editor, account.id, accounts); setEditor({ kind: "duplicate", key: Date.now(), draft }); } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Could not prepare this repeating entry."); } }}
          onSaved={onChanged}
          onCancel={() => setEditor(null)}
        />
      )}

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
        <>
          <nav className="register-pagination" aria-label="Register pages">
            <span aria-live="polite">
              Showing {historyCount === 0 ? 0 : safeRegisterPage * registerPageSize + 1}–{Math.min((safeRegisterPage + 1) * registerPageSize, historyCount)} of {historyCount} past and current transactions · {partitionedEntries.upcoming.length} upcoming
            </span>
            <div>
              <button type="button" onClick={() => setRegisterPage((page) => Math.max(0, page - 1))} disabled={safeRegisterPage === 0}>Previous</button>
              <span>Page {historyPageCount === 0 ? 0 : safeRegisterPage + 1} of {historyPageCount}</span>
              <button type="button" onClick={() => setRegisterPage((page) => Math.min(historyPageCount - 1, page + 1))} disabled={historyPageCount === 0 || safeRegisterPage >= historyPageCount - 1}>Next</button>
            </div>
          </nav>
          {upcomingPageCount > 1 && <nav className="register-pagination upcoming-pagination" aria-label="Upcoming pages">
            <span aria-live="polite">Upcoming {safeUpcomingPage * registerPageSize + 1}–{Math.min((safeUpcomingPage + 1) * registerPageSize, partitionedEntries.upcoming.length)} of {partitionedEntries.upcoming.length}</span>
            <div>
              <button type="button" onClick={() => setUpcomingPage((page) => Math.max(0, page - 1))} disabled={safeUpcomingPage === 0}>Previous upcoming</button>
              <span>Page {safeUpcomingPage + 1} of {upcomingPageCount}</span>
              <button type="button" onClick={() => setUpcomingPage((page) => Math.min(upcomingPageCount - 1, page + 1))} disabled={safeUpcomingPage >= upcomingPageCount - 1}>Next upcoming</button>
            </div>
          </nav>}
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
                  <th className="action-column"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
              {partitionedEntries.upcoming.length > 0 && <tr className="upcoming-divider"><th colSpan={9} scope="rowgroup">Upcoming</th></tr>}
              {[...upcomingPageEntries, ...pageEntries].map((entry) => {
                const amount = BigInt(entry.amount);
                const isUpcoming = entry.postingState === "scheduled" || entry.date > today;
                return (
                  <Fragment key={entry.id}>
                  {!isUpcoming && entry.id === pageEntries[0]?.id && partitionedEntries.upcoming.length > 0 && <tr className="upcoming-divider"><th colSpan={9} scope="rowgroup">Transactions</th></tr>}
                  <tr className={isUpcoming ? "upcoming-row" : undefined}>
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
                    <td className="category-column">{displayCategory(entry, account)}</td>
                    <td className="memo-column">{entry.memo || <span>—</span>}</td>
                    <td className="status-column">
                      <span className={`cleared-state ${entry.clearedState}`} title={statusLabel(entry)}>
                        {entry.postingState === "scheduled" ? "S" : entry.clearedState === "reconciled" ? "R" : entry.clearedState === "cleared" ? "C" : "U"}
                      </span>
                    </td>
                    <td className="money-column outflow">{amount < 0n ? huf((-amount).toString()) : ""}</td>
                    <td className="money-column inflow">{amount >= 0n ? huf(amount.toString()) : ""}</td>
                    <td className="action-column"><button onClick={() => setEditor(entry)}>Edit</button>{entry.postingState === "scheduled" && <><button disabled={scheduleAction} onClick={() => void finishSchedule(entry.id, true)}>Post</button><button disabled={scheduleAction} onClick={() => void finishSchedule(entry.id, false)}>Skip</button></>}</td>
                  </tr>
                  </Fragment>
                );
              })}
              </tbody>
            </table>
          </div>
          <nav className="register-pagination bottom" aria-label="Register pages">
            <span aria-live="polite">
              Showing {historyCount === 0 ? 0 : safeRegisterPage * registerPageSize + 1}–{Math.min((safeRegisterPage + 1) * registerPageSize, historyCount)} of {historyCount} past and current transactions · {partitionedEntries.upcoming.length} upcoming
            </span>
            <div>
              <button type="button" onClick={() => setRegisterPage((page) => Math.max(0, page - 1))} disabled={safeRegisterPage === 0}>Previous</button>
              <span>Page {historyPageCount === 0 ? 0 : safeRegisterPage + 1} of {historyPageCount}</span>
              <button type="button" onClick={() => setRegisterPage((page) => Math.min(historyPageCount - 1, page + 1))} disabled={historyPageCount === 0 || safeRegisterPage >= historyPageCount - 1}>Next</button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
