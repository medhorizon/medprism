import { describe, expect, it } from "vitest";
import { confirmationControlForText } from "./confirmation";

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
});
