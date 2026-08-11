import { describe, expect, it } from "vitest";
import { confirmationControlForText, disambiguationChoiceForText } from "./confirmation";
import type { PendingDisambiguationTask } from "../../types/chat";

describe("confirmation controls", () => {
  it.each(["确认", "继续", "好，继续", "confirm", "Proceed."])(
    "recognizes an unqualified confirmation: %s",
    (text) => {
      expect(confirmationControlForText(text)).toBe("confirm");
    },
  );

  it.each(["取消", "不要", "不修改", "cancel", "No!"])(
    "recognizes an unqualified cancellation: %s",
    (text) => {
      expect(confirmationControlForText(text)).toBe("cancel");
    },
  );

  it.each(["继续，但改成另一个标题", "确认并润色", "不要修改标题，改摘要"])(
    "does not consume a new request as a transaction control: %s",
    (text) => {
      expect(confirmationControlForText(text)).toBeNull();
    },
  );

  it("recognizes a numeric disambiguation choice", () => {
    const task: PendingDisambiguationTask = {
      schemaVersion: "1",
      id: "task",
      projectId: "p",
      projectRevision: "rev",
      createdAt: new Date().toISOString(),
      status: "awaiting-disambiguation",
      spec: {
        schemaVersion: "2",
        action: "fill-sections",
        applyMode: "propose-patch",
        contentMode: "provided",
        scope: "targets",
        evidenceMode: "none",
        targets: [],
      },
      sources: [],
      taskSource: "runtime",
      repaired: false,
      explicitlyAuthorized: false,
      choices: [
        { id: "first", targetIndex: 0, occurrenceId: "a", slot: "Title", path: "main.tex", syntax: "command", heading: "Title" },
        { id: "second", targetIndex: 0, occurrenceId: "b", slot: "Title", path: "front/title.tex", syntax: "command", heading: "Title" },
      ],
    };
    expect(disambiguationChoiceForText("2", task)).toBe("second");
    expect(disambiguationChoiceForText("choose 2 but shorten it", task)).toBeNull();
  });
});
