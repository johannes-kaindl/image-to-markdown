// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { attachDomGuard } from "../src/vendor/kit-obsidian/dom-guard";

/** Linkschutz-Härtung (code-kit 0.68.0 `link-guard`, obsidian-kit 0.88.0 `dom-guard`) auf echtem DOM (happy-dom, kein Fake-Tree). Modelltext erreicht den Wächter im Betrieb nie
 *  (`neutralizeModelMarkdown` maskiert `<`); das Netz dahinter wird hier selbst gemessen: rohes HTML mit on*, ping, formaction und form wird in den beobachteten Container gesetzt. */
const HTML = [
  '<a href="https://example.org/ok" onclick="window.__m = 1" ping="https://example.invalid/ping">h-ok</a>',
  '<p onmouseover="window.__m = 2">h-p</p>',
  '<form action="https://example.invalid/form"><button formaction="https://example.invalid/fa">h-form</button></form>',
].join("");

function zaehle(root: Element) {
  const all = Array.from(root.querySelectorAll("*"));
  const anker = all.find((e) => e.localName === "a" && e.textContent === "h-ok") ?? null;
  return {
    anker: anker ? { href: anker.getAttribute("href"), attrs: anker.getAttributeNames().filter((n) => n.startsWith("on") || n === "ping") } : null,
    forms: all.filter((e) => e.localName === "form").length,
    formaction: all.filter((e) => e.hasAttribute("formaction")).length,
    on: all.filter((e) => e.getAttributeNames().some((n) => n.startsWith("on"))).length,
    ping: all.filter((e) => e.hasAttribute("ping")).length,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("dom-guard Härtung (0.88.0)", () => {
  it("Gegenprobe: dasselbe HTML ohne Wächter behält alle Marker (sonst ist „gekappt“ nichts wert)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = HTML;
    const z = zaehle(host);
    expect(z.forms).toBe(1);
    expect(z.formaction).toBe(1);
    expect(z.on).toBe(2);
    expect(z.ping).toBe(1);
    expect(z.anker?.attrs).toEqual(["onclick", "ping"]);
    host.remove();
  });

  it("der Beobachter nimmt on*, ping, formaction und form mitten im Strom heraus, der https-Link bleibt", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const guard = attachDomGuard(host);
    host.innerHTML = HTML;
    await tick();
    const z = zaehle(host);
    expect(z.anker).toEqual({ href: "https://example.org/ok", attrs: [] });
    expect(z.forms).toBe(0);
    expect(z.formaction).toBe(0);
    expect(z.on).toBe(0);
    expect(z.ping).toBe(0);
    guard.disconnect();
    host.remove();
  });

  it("flush() fährt den Durchgang synchron, ohne auf den Observer-Callback zu warten", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const guard = attachDomGuard(host);
    host.innerHTML = HTML;
    guard.flush();
    const z = zaehle(host);
    expect(z.anker?.attrs).toEqual([]);
    expect(z.forms + z.formaction + z.on + z.ping).toBe(0);
    guard.disconnect();
    host.remove();
  });

  it("ein Attribut, das erst später auf ein vorhandenes Element gesetzt wird, fällt ebenfalls", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const p = document.createElement("p");
    host.appendChild(p);
    const guard = attachDomGuard(host);
    p.setAttribute("onclick", "x()");
    await tick();
    expect(p.hasAttribute("onclick")).toBe(false);
    guard.disconnect();
    host.remove();
  });
});
