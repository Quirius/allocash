import { AccountEditor } from "./AccountEditor";
import { TransactionContextMenu } from "./TransactionContextMenu";
import { TransactionStatusIcon } from "./TransactionStatusIcon";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createNativeBackup,
  deleteRegisterEntry,
  RECONCILED_CONFIRMATION_REQUIRED,
  setRegisterEntryClearedState,
  realizeDueScheduledTransactions,
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

function accountKindLabel(kind?: AccountKind): string { return kind === "cash" ? "Cash account" : kind === "credit" ? "Credit account" : kind === "loan" ? "Loan account" : kind === "tracking" ? "Tracking account" : "Accounts"; }

export function App() {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [register, setRegister] = useState<RegisterState>({ status: "idle" });
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [registerAttempt, setRegisterAttempt] = useState(0);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [view, setView] = useState<"register" | "plan" | "reports" | "settings">("plan");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [undoStatus, setUndoStatus] = useState<UndoStatus>({ canUndo: false, label: null });
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoFeedback, setUndoFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const undoLock = useRef(false);
  const realizedDay = useRef("");
  const realizing = useRef(false);
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
    const today = localCalendarDate();
    realizeDueScheduledTransactions(today).then(() => loadWorkspace(today)).then(
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
        realizedDay.current = today;
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

  async function refreshTransactionStatus(id: string, clearedState: "cleared" | "uncleared") {
    // The status write already succeeded. Keep every row mounted, even if the
    // balance read fails; a retry must never replay the write.
    setRegister((current) => current.status === "ready" ? {
      ...current, entries: current.entries.map((entry) => entry.id === id ? { ...entry, clearedState } : entry),
    } : current);
    const request = ledgerRefreshSequence.current.begin();
    const workspace = await loadWorkspace(localCalendarDate());
    if (!ledgerRefreshSequence.current.isCurrent(request)) return;
    if (!workspace) throw new Error("The desktop ledger is unavailable.");
    setStartup({ status: "ready", workspace });
  }

  useEffect(() => {
    if (startup.status !== "ready") return;
    async function checkDay() {
      const day = localCalendarDate();
      if (day === realizedDay.current || realizing.current || undoLock.current || hasSavedMutationPending()
        || document.querySelector(".transaction-editor, .account-editor[open]")) return;
      realizing.current = true;
      try {
        await realizeDueScheduledTransactions(day);
        await refreshLedger();
        realizedDay.current = day;
      } catch {
        setUndoFeedback({ kind: "error", message: "Could not realize due scheduled transactions. Allocash will retry." });
      } finally { realizing.current = false; }
    }
    const timer = window.setInterval(() => void checkDay(), 60_000);
    window.addEventListener("focus", checkDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", checkDay); };
  }, [startup.status]);

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
    <div className={`app-shell view-${view}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {editingAccountId && <AccountEditor key={editingAccountId} accountId={editingAccountId} pending={mutation.pending || undoBusy} onChanged={refreshLedger} onClose={() => setEditingAccountId(null)} />}
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Budget sidebar">
        <div className="budget-identity"><span className="brand-mark" aria-hidden="true">A</span><div><strong>{startup.status === "ready" ? startup.workspace.budget.name : "Allocash"}</strong><span>Allocash · Local budget</span></div></div>
        <nav className="primary-navigation" aria-label="Budget views">
          <button title="Plan" className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}><span aria-hidden="true">▣</span><span>Plan</span></button>
          <button title="Reports" className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}><span aria-hidden="true">▥</span><span>Reports</span></button>
          <button title="Accounts" className={view === "register" ? "active" : ""} onClick={() => setView("register")}><span aria-hidden="true">▤</span><span>Accounts</span></button>
          <button title="Budget & backups" className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><span aria-hidden="true">⚙</span><span>Budget & backups</span></button>
        </nav>
        <nav className="account-groups" aria-label="Accounts">
          {accountGroups.map((group) => {
            const groupedAccounts = accounts.filter((account) => inGroup(account, group));
            return (
              <section className="account-group" key={group.title}>
                <button type="button" className="account-group-heading" aria-expanded={!collapsedGroups.has(group.title)} onClick={() => setCollapsedGroups((old) => { const next = new Set(old); if (next.has(group.title)) next.delete(group.title); else next.add(group.title); return next; })}>
                  <h2><span aria-hidden="true">{collapsedGroups.has(group.title) ? "›" : "⌄"}</span> {group.title}</h2>
                  {groupedAccounts.length > 0 && <span className={BigInt(groupedAccounts.reduce((total, item) => total + BigInt(item.balance.working), 0n)) < 0n ? "negative" : ""}>{groupTotal(groupedAccounts)}</span>}
                </button>
                {!collapsedGroups.has(group.title) && (groupedAccounts.length === 0 ? (
                  <p>No accounts</p>
                ) : groupedAccounts.map((account) => (
                  <button
                    className={`account-link ${selectedAccountId === account.id ? "selected" : ""}`}
                    key={account.id}
                    onClick={() => { setSelectedAccountId(account.id); setView("register"); }}
                    onContextMenu={(event) => { event.preventDefault(); if (!hasSavedMutationPending() && !undoBusy) { event.currentTarget.focus(); setEditingAccountId(account.id); } }}
                    onKeyDown={(event) => { if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && !hasSavedMutationPending() && !undoBusy) { event.preventDefault(); setEditingAccountId(account.id); } }}
                    aria-current={selectedAccountId === account.id ? "page" : undefined}
                  >
                    <span>{account.name}</span>
                    <strong className={BigInt(account.balance.working) < 0n ? "negative" : ""}>
                      {huf(account.balance.working)}
                    </strong>
                  </button>
                )))}
              </section>
            );
          })}
        </nav>
        <div className="sidebar-footer"><span className="offline-label">Offline · HUF</span>{view === "plan" && <button type="button" aria-label="Undo last action" title={undoStatus.label ? `Undo ${undoStatus.label} (Ctrl+Z)` : "Undo (Ctrl+Z)"} disabled={!undoStatus.canUndo || mutation.pending || undoBusy} onClick={() => void undo()}>↶</button>}<button type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? "▸" : "◂"}</button></div>
      </aside>

      <main id="workspace" tabIndex={-1}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{view === "register" ? accountKindLabel(selectedAccount?.kind) : "YOUR BUDGET"}</p>
            <h1>{view === "register" ? selectedAccount?.name ?? "Accounts" : view === "reports" ? "Reports" : "Budget & backups"}</h1>
          </div>
          <div className="workspace-actions">
            <button className="undo-button" onClick={() => void undo()} disabled={!undoStatus.canUndo || mutation.pending || undoBusy || startup.status !== "ready"} title={undoStatus.label ? `Undo ${undoStatus.label} (Ctrl+Z)` : "Undo (Ctrl+Z)"}>
              {undoBusy ? "Undoing…" : undoStatus.label ? `Undo ${undoStatus.label}` : "Undo"} <kbd>Ctrl+Z</kbd>
            </button>
            {view === "register" && selectedAccount && <button disabled={mutation.pending || undoBusy} onClick={() => setEditingAccountId(selectedAccount.id)}>Edit account</button>}

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


          {undoFeedback && <p className={undoFeedback.kind === "error" ? "backup-error" : "backup-success"} role={undoFeedback.kind === "error" ? "alert" : "status"}>{undoFeedback.message}</p>}
          {startup.status === "ready" && view === "plan" && <PlanView onCategoryRenamed={refreshLedger} refreshRevision={refreshRevision} readEpoch={mutation.version} mutationPending={mutation.pending} />}
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
              onStatusChanged={refreshTransactionStatus}
            />
          )}

          {startup.status === "ready" && view === "register" && !selectedAccount && <EmptyLedger />}
          {startup.status === "preview" && <EmptyLedger preview />}

          {(view === "settings" || startup.status === "error") && <section className="details-card" aria-labelledby="budget-details">
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
          </section>}
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

export function AccountRegister({
  account,
  accounts,
  options,
  register,
  onRetry,
  onChanged,
  onStatusChanged,
}: {
  account: AccountOverview;
  accounts: AccountOverview[];
  options: WorkspaceSnapshot["transactionOptions"];
  register: RegisterState;
  onRetry: () => void;
  onChanged: () => Promise<void>;
  onStatusChanged?: (id: string, state: "cleared" | "uncleared") => Promise<void>;
}) {
  const [editor, setEditor] = useState<"new" | "reconcile" | RegisterEntry | { kind: "duplicate"; key: number; draft: TransactionDraft } | null>(null);
  const [scheduleAction, setScheduleAction] = useState(false);
  const actionLock = useRef(false);
  const retryRead = useRef<() => Promise<void>>(onChanged);
  const [refreshPending, setRefreshPending] = useState(false);
  const [menu, setMenu] = useState<{ entry: RegisterEntry; x: number; y: number } | null>(null);
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

  async function mutate(operation: () => Promise<void>, refresh = onChanged) {
    if (actionLock.current || refreshPending || hasSavedMutationPending()) return;
    actionLock.current = true;
    setScheduleAction(true); setScheduleError(null);
    let saved = false;
    retryRead.current = refresh;
    try {
      await operation(); saved = true;
      await refresh();
    } catch (error) {
      setRefreshPending(saved);
      setScheduleError(saved ? "Saved, but the register could not refresh. Retry the refresh below." : typeof error === "string" ? error : error instanceof Error ? error.message : "Could not update this transaction.");
    } finally { actionLock.current = false; setScheduleAction(false); }
  }

  async function retryRefresh() {
    if (actionLock.current) return;
    actionLock.current = true; setScheduleAction(true);
    try { await retryRead.current(); setRefreshPending(false); setScheduleError(null); }
    catch { setScheduleError("Could not refresh the register. Your change is already saved."); }
    finally { actionLock.current = false; setScheduleAction(false); }
  }

  function edit(entry: RegisterEntry) {
    if (!actionLock.current && !refreshPending && !hasSavedMutationPending()) setEditor(entry);
  }

  function duplicate(entry: RegisterEntry, repeating: boolean) {
    if (actionLock.current || refreshPending || hasSavedMutationPending()) return;
    if (repeating && (entry.postingState === "scheduled" || entry.date > today)) {
      setEditor({ ...entry, repeatIntervalMonths: 1 }); return;
    }
    try {
      const draft = draftFromPostedEntry(entry, account.id, accounts);
      setEditor({ kind: "duplicate", key: Date.now(), draft: repeating ? draft : { ...draft, date: entry.date, repeat: "never", repeatDayOfMonth: undefined } });
    } catch (error) { setScheduleError(error instanceof Error ? error.message : "Could not prepare this transaction."); }
  }

  function remove(entry: RegisterEntry) {
    if (actionLock.current || refreshPending || hasSavedMutationPending()) return;
    const question = entry.transferId ? "Delete this transfer and both linked transactions?" : entry.postingState === "scheduled" ? "Delete this scheduled transaction and stop its repeating rule?" : "Delete this transaction?";
    if (!window.confirm(question)) return;
    void mutate(async () => {
      try { await deleteRegisterEntry(entry.id, false); }
      catch (error) {
        if (String(error).includes(RECONCILED_CONFIRMATION_REQUIRED)) {
          if (!window.confirm("This changes reconciled history. Delete it after making a safety backup?")) throw new Error("Deletion cancelled.");
          await deleteRegisterEntry(entry.id, true);
        } else throw error;
      }
    });
  }

  function changeStatus(entry: RegisterEntry, next: "cleared" | "uncleared") {
    if (entry.postingState === "scheduled" || entry.date > today || entry.clearedState === "reconciled") return;
    void mutate(() => setRegisterEntryClearedState(entry.id, next, today),
      onStatusChanged ? () => onStatusChanged(entry.id, next) : onChanged);
  }

  return (
    <section className="register" aria-labelledby="register-title">
      <h2 className="sr-only" id="register-title">{account.name} transaction register</h2>
      <div className="balance-strip">
        <div><strong className={BigInt(account.balance.cleared) < 0n ? "negative" : "positive"}>{huf(account.balance.cleared)}</strong><span>Cleared Balance</span></div><span className="balance-operator">+</span>
        <div><strong>{huf(account.balance.uncleared)}</strong><span>Uncleared Balance</span></div><span className="balance-operator">=</span>
        <div className="primary-balance"><strong className={BigInt(account.balance.working) < 0n ? "negative" : "positive"}>{huf(account.balance.working)}</strong><span>Working Balance</span></div>
      </div>

      <div className="register-toolbar">
        <div>
          <strong>All transactions</strong>
          <span>{register.status === "ready" ? `${entryCount} entries` : "Local history"}</span>
        </div>
        <button
          disabled={account.closed}
          title={account.closed ? "Reopen this account before reconciling" : undefined}
          onClick={() => { if (!hasSavedMutationPending()) setEditor("reconcile"); }}
        >Reconcile</button>
        <button
          disabled={account.closed}
          title={account.closed ? "Reopen this account before adding transactions" : undefined}
          onClick={() => { if (!hasSavedMutationPending()) setEditor("new"); }}
        >+ Add transaction</button>
      </div>

      {scheduleError && <p className="editor-error" role="alert">{scheduleError} {refreshPending && <button disabled={scheduleAction} onClick={() => void retryRefresh()}>Retry refresh</button>}</p>}
      {menu && <TransactionContextMenu entry={menu.entry} x={menu.x} y={menu.y} disabled={scheduleAction || refreshPending || hasSavedMutationPending()}
        onClose={() => setMenu(null)} onEdit={() => edit(menu.entry)} onDuplicate={() => duplicate(menu.entry, false)}
        onMakeRepeating={() => duplicate(menu.entry, true)} onDelete={() => remove(menu.entry)}
        onStatusChange={(next) => changeStatus(menu.entry, next)}
        onSkip={menu.entry.postingState === "scheduled" ? () => void mutate(() => skipScheduledOccurrence(menu.entry.id)) : undefined}
        onPost={menu.entry.postingState === "scheduled" ? () => void mutate(() => postScheduledOccurrence(menu.entry.id)) : undefined}
        onEditMemo={() => { edit(menu.entry); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".memo-field input")?.focus()); }} />}

      {editor === "reconcile" && (
        <ReconciliationEditor account={account} onSaved={onChanged} onCancel={() => setEditor(null)} />
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
      {register.status === "ready" && (
        <>
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
                  <th className="money-column">Outflow</th>
                  <th className="money-column">Inflow</th>
                  <th className="status-column"><span className="sr-only">Cleared status</span>ⓒ</th>
                </tr>
              </thead>
              <tbody>
                {(editor === "new" || (editor && typeof editor === "object" && "kind" in editor)) && <tr className="register-edit-row new-entry-row"><td colSpan={8}>
      {editor === "new" && (
        <TransactionComposer inline
          account={account}
          accounts={accounts}
          options={options}
          onSaved={onChanged}
          onCancel={() => setEditor(null)}
        />
      )}
      {typeof editor === "object" && editor !== null && "kind" in editor && editor.kind === "duplicate" && <TransactionComposer inline
        key={`duplicate-${editor.key}`} account={account} accounts={accounts} options={options} initialDraft={editor.draft}
        onSaved={onChanged} onCancel={() => setEditor(null)}
      />}

                </td></tr>}
              {partitionedEntries.upcoming.length > 0 && <tr className="upcoming-divider"><th colSpan={8} scope="rowgroup">Upcoming</th></tr>}
              {[...upcomingPageEntries, ...pageEntries].map((entry) => {
                const amount = BigInt(entry.amount);
                const isUpcoming = entry.postingState === "scheduled" || entry.date > today;
                return (
                  <Fragment key={entry.id}>
                  {!isUpcoming && entry.id === pageEntries[0]?.id && partitionedEntries.upcoming.length > 0 && <tr className="upcoming-divider"><th colSpan={8} scope="rowgroup">Transactions</th></tr>}
                  {editor && typeof editor === "object" && !("kind" in editor) && editor.id === entry.id ? <tr className="register-edit-row" data-entry-id={entry.id}><td colSpan={8}>
      {editor && typeof editor === "object" && !("kind" in editor) && (
        <RegisterEntryEditor inline
          key={editor.id}
          entry={editor}
          account={account}
          accounts={accounts}
          options={options}
          onMakeRepeating={() => { try { const draft = draftFromPostedEntry(editor, account.id, accounts); setEditor({ kind: "duplicate", key: Date.now(), draft }); } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Could not prepare this repeating entry."); } }}
          onSaved={onChanged}
          onCancel={() => setEditor(null)}
        />
      )}                  </td></tr> : (
                  <tr className={isUpcoming ? "upcoming-row" : undefined} data-entry-id={entry.id} tabIndex={0}
                    onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button")) edit(entry); }}
                    onContextMenu={(event) => { event.preventDefault(); if (!actionLock.current && !refreshPending) setMenu({ entry, x: event.clientX, y: event.clientY }); }}
                    onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter") edit(entry); if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ entry, x: rect.left + 80, y: rect.top }); } }}>
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
                    <td className="money-column outflow">{amount < 0n ? `(${huf((-amount).toString())})` : ""}</td>
                    <td className="money-column inflow">{amount >= 0n ? huf(amount.toString()) : ""}</td>
                    <td className="status-column">
                      <TransactionStatusIcon state={entry.clearedState} pending={isUpcoming} disabled={scheduleAction || refreshPending || hasSavedMutationPending()}
                        onToggle={entry.clearedState === "reconciled" ? undefined : () => changeStatus(entry, entry.clearedState === "cleared" ? "uncleared" : "cleared")} />
                    </td>
                  </tr>)}
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
