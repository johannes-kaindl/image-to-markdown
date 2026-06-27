// scripts/lib/codeberg-release.test.ts
import { describe, it, expect, vi } from "vitest";
import { createCodebergRelease } from "./codeberg-release.mjs";

// Minimaler Fake einer fetch-Response.
function res(ok: boolean, body: unknown = {}, status = ok ? 200 : 404) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("createCodebergRelease", () => {
  it("legt ein Release an, wenn keins existiert, und lädt Assets hoch", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetch = vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      if (url.endsWith("/repos/o/r") && init.method === "PATCH") return res(true);
      if (url.includes("/releases/tags/")) return res(false); // existiert nicht
      if (url.endsWith("/releases") && init.method === "POST") return res(true, { id: 7, html_url: "h", assets: [] });
      if (url.includes("/assets?name=") && init.method === "POST") return res(true, { id: 1 });
      return res(false);
    });

    const out = await createCodebergRelease({
      fetch, token: "t", repo: "o/r", tag: "0.8.0", notes: "n",
      assets: [{ name: "main.js", body: new Uint8Array([1]) }],
    });

    expect(out).toEqual({ id: 7, htmlUrl: "h" });
    expect(calls.some((c) => c.url.endsWith("/releases") && c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.url.includes("/assets?name=main.js") && c.method === "POST")).toBe(true);
  });

  it("nutzt ein bestehendes Release und überschreibt ein gleichnamiges Asset (clobber)", async () => {
    const deletes: string[] = [];
    const fetch = vi.fn(async (url: string, init: any = {}) => {
      if (url.endsWith("/repos/o/r") && init.method === "PATCH") return res(true);
      if (url.includes("/releases/tags/")) return res(true, { id: 9, html_url: "h2", assets: [{ id: 5, name: "main.js" }] });
      if (init.method === "DELETE") { deletes.push(url); return res(true); }
      if (url.includes("/assets?name=") && init.method === "POST") return res(true, { id: 2 });
      return res(false);
    });

    const out = await createCodebergRelease({
      fetch, token: "t", repo: "o/r", tag: "0.8.0", notes: "n",
      assets: [{ name: "main.js", body: new Uint8Array([1]) }],
    });

    expect(out).toEqual({ id: 9, htmlUrl: "h2" });
    expect(deletes.some((u) => u.includes("/releases/9/assets/5"))).toBe(true);
  });

  it("wirft, wenn das Anlegen fehlschlägt", async () => {
    const fetch = vi.fn(async (url: string, init: any = {}) => {
      if (url.endsWith("/repos/o/r") && init.method === "PATCH") return res(true);
      if (url.includes("/releases/tags/")) return res(false);
      if (url.endsWith("/releases") && init.method === "POST") return res(false, "boom", 500);
      return res(false);
    });

    await expect(createCodebergRelease({
      fetch, token: "t", repo: "o/r", tag: "0.8.0", notes: "n", assets: [],
    })).rejects.toThrow(/500/);
  });
});
