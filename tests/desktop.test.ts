import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { loadBudgetInfo } from "../src/lib/desktop";

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
