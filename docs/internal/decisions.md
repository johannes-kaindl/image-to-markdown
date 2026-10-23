# Entscheidungen in image-to-markdown — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Die Herleitungen liegen im Coding-Cockpit des Maintainers (CORE-META-14, maintainer-lokal). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt, Ergebnis melden.

## Warum es das Plugin gibt

Ausgegliedert aus [`vault-rag`](https://git.jkaindl.de/jkaindl/vault-rag) 0.2.0 (2026-06-21). Bild-Transkription ist **kein RAG** — sie teilte mit vault-rag nur den SSE-Transport, nicht den Index/Retrieval-Kern. Als eigenes Plugin bleibt vault-rag ein schlanker RAG-Kern und `image-to-markdown` ein fokussiertes Werkzeug mit eigener Registry-/Feedback-Fläche. Spec und Plan der Ausgliederung liegen im Cockpit von vault-rag unter `_SDD/` (maintainer-lokal, CORE-META-14).

## Bewusste Designentscheidungen

- **Nicht-destruktiv und idempotent:** pro Bild eine Transkript-Notiz; der Bild-Embed in der Quellnotiz wird durch einen Embed der neuen Notiz ersetzt — nie der Originaltext überschrieben.
- **Offline-first:** spricht einen konfigurierbaren OpenAI-kompatiblen Vision-Endpoint (LM Studio, MLX, Ollama) — keine Cloud, kein VPN.
- **Streamend:** die Transkription läuft live in die Sidebar (inkl. Reasoning-Block bei Reasoning-Modellen), abbrechbar.

## Geteilter Code ist vendored, nicht als Package geteilt

Kit-first-Regel des Dachs: Gemeinsames liegt in `obsidian-kit` und `code-kit` und kommt als Kopie mit festem Pin ins Repo. Die Trennung `vendor/kit/` (obsidian-frei) und `vendor/kit-obsidian/` ist Vertrag, nicht Geschmack: ein obsidian-importierendes Modul unter `vendor/kit/` fällt in den Nachbar-Repos durch deren `check:pure`.

## Die Endpunkt-Quelle gehört dem LLM Endpoint Manager (Welle 8, 2026-09-25)

Sobald der Manager installiert ist, löst er Endpunkt und Modell auf; die lokale Liste `visionEndpoints` gilt nur ohne ihn. Seit Welle 15 (0.28.0) läuft das über die Kit-Verbindung. Das globale Feld `visionModel` ist seit Welle 17 abgeschafft (Modell je Zeile). Ein Manager ohne Endpunkt ergibt keinen lokalen Rückfall: das ist Vertrag des Kits. Wie es im Code zusammenhängt: `.claude/rules/llm-verbindung.md`.

## Vision-Endpoint-Default `:1234`

LM Studio ist der Referenzserver des Dachs; bis 0.30.1 war der Default `:8080` (MLX). Gemessen 2026-10-14: 6 von 8 Vergleichsplugins nutzen `:1234`. Ein MLX-Server hört auf `:8080`; eine gespeicherte Liste bleibt.

## Ein Endpunkt, der keine Modell-Liste liefert, fällt aus der Auflösung (0.22.0)

`normalizeEndpoint()` strippt ein trailing `/v1`. Ein falscher Pfad lieferte bei LM Studio trotzdem HTTP 200 mit Fehler-Body und damit still ein leeres Transkript (der Bug des ersten Smoke-Tests). Seit 0.22.0 verlangt `ping()` die Modell-Listen-Form, ein solcher Endpunkt fällt aus der Auflösung: der Footgun ist strukturell abgefangen, nicht nur angezeigt. Belegt vor der Umstellung an LM Studio (live, `n=9`), Ollama (live), MLX (`mlx_lm/server.py`) und llama.cpp (`tools/server/server-models.cpp`): alle liefern ein `data`-Array, es gibt keinen bekannten Server, der dadurch aus der Auswahl fiele.

## Abweichungen von der Leitkonvention

- **PROF-TS-04, kein `tsconfig.build.json`-Split:** `tsconfig.json`, `tsconfig.test.json` und `tsconfig.scripts.json` genügen; das Repo ist klein genug.
- **Streaming-Antwortbereich nicht aus dem Kit (UI-STANDARD §8):** `buildStreamArea` baut einen Antwortbereich für einen Anstrich; die View rendert `N` gleichzeitige Karten mit eigenem Gedankenblock, Versions-Verlauf und „Notiz anlegen“ je Version. Ein Vendoring müsste die Mehrkarten-Struktur daneben nachbauen. Die Deklaration steht im Kern (`## UI-Abweichungen`).
- **Textquelle `src/i18n.ts` statt `src/i18n/strings.ts` (UI-STANDARD §10):** ein Umzug änderte nur Dateipfade (Entscheidung Welle 14, 2026-09-30).
