import { describe, it, expect } from "vitest";
import { buildRefineMessages } from "../src/refine";

const SYS = "SYSTEM";

describe("buildRefineMessages", () => {
  it("Runde 1 (leerer Verlauf): System + eine User-Message mit Feedback + Basistext", () => {
    const msgs = buildRefineMessages("BASIS", [], "Tabellen als GFM", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Tabellen als GFM\n\n---\n\nBASIS" },
    ]);
  });

  it("Runde 2: erste Runde als user/assistant, neues Feedback als letzte User-Message", () => {
    const msgs = buildRefineMessages("BASIS", [{ feedback: "f1", text: "v1" }], "f2", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
      { role: "assistant", content: "v1" },
      { role: "user", content: "f2" },
    ]);
  });

  it("Runde 3: alterniert korrekt, Basistext nur an der ersten User-Message", () => {
    const msgs = buildRefineMessages("BASIS", [
      { feedback: "f1", text: "v1" },
      { feedback: "f2", text: "v2" },
    ], "f3", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
      { role: "assistant", content: "v1" },
      { role: "user", content: "f2" },
      { role: "assistant", content: "v2" },
      { role: "user", content: "f3" },
    ]);
  });
});
