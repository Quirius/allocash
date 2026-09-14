import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { loadAccountRegister, loadBudgetInfo, loadWorkspace } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it("does not access desktop storage in browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadBudgetInfo()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("loads the actual budget through the desktop command", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const budget = { name: "Test budget", currency: "HUF", schemaVersion: 1, databasePath: "test.sqlite3" };
  vi.mocked(invoke).mockResolvedValue(budget);
  expect(await loadBudgetInfo()).toEqual(budget);
  expect(invoke).toHaveBeenCalledWith("get_budget_info");
});

it("propagates storage failure instead of falling back to a fake budget", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockRejectedValue(new Error("Database unavailable"));
  await expect(loadBudgetInfo()).rejects.toThrow("Database unavailable");
});

it("loads account balances for an explicit local calendar date", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const workspace = {
    budget: { name: "Test budget", currency: "HUF", schemaVersion: 2, databasePath: "test.sqlite3" },
    accounts: [],
  };
  vi.mocked(invoke).mockResolvedValue(workspace);
  expect(await loadWorkspace("2026-09-14")).toEqual(workspace);
  expect(invoke).toHaveBeenCalledWith("get_workspace", { asOf: "2026-09-14" });
});

it("loads the selected account register without numeric money conversion", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const entries = [{ id: "t", amount: "9223372036854775807" }];
  vi.mocked(invoke).mockResolvedValue(entries);
  expect(await loadAccountRegister("cash")).toEqual(entries);
  expect(invoke).toHaveBeenCalledWith("get_account_register", { accountId: "cash" });
});

it("keeps workspace and register reads out of the browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadWorkspace("2026-09-14")).toBeNull();
  expect(await loadAccountRegister("cash")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
