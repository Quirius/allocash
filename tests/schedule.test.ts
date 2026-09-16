import { expect, it } from "vitest";
import { SAFETY_BACKUP_ERROR, scheduleCancellationError } from "../src/app/ScheduleView";

it("keeps the required safety-backup failure visible when canceling a schedule", () => {
  expect(scheduleCancellationError(SAFETY_BACKUP_ERROR)).toBe(SAFETY_BACKUP_ERROR);
  expect(scheduleCancellationError(new Error("disk unavailable"))).toBe("This schedule could not be canceled.");
});
