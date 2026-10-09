import { describe, it, expect } from "vitest";
import { sanitizeChoice } from "../src/resolve_endpoint";

describe("sanitizeChoice", () => {
  it("fehlt oder kaputt → leere Wahl", () => {
    expect(sanitizeChoice(undefined)).toEqual({});
    expect(sanitizeChoice("quatsch")).toEqual({});
    expect(sanitizeChoice(null)).toEqual({});
  });
  it("nur nicht-leere Strings bleiben", () => {
    expect(sanitizeChoice({ endpointId: "a", model: 5 })).toEqual({ endpointId: "a" });
    expect(sanitizeChoice({ endpointId: "", model: "m" })).toEqual({ model: "m" });
  });
});
