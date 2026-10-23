---
paths:
  - "src/main.ts"
  - "src/settings.ts"
  - "src/vision_client.ts"
  - "src/llm_call.ts"
  - "src/http.ts"
  - "src/capabilities.ts"
  - "src/request_params.ts"
  - "src/resolve_endpoint.ts"
  - "src/ocr_provider.ts"
  - "src/img_to_md.ts"
  - "scripts/gui-smoke.ts"
---

# LLM-Anbindung, Endpunkt-Quelle und Vision — Gotchas

Gotchas zur Kit-Verbindung `createLlmConnection` (`plugin.llm`) und zum Vision-Weg. Aufbau der Module: `docs/internal/architecture.md`; das Warum: `docs/internal/decisions.md`.

## Verbindung

- **Der Chat-Weg ist die Kit-Verbindung `createLlmConnection` (`plugin.llm`), nicht ein eigener Client.** Seit Welle 15 (0.28.0). Fristen sind die des Kits und statisch: Idle 120 s, erster Chunk 600 s (JIT-ladendes Modell, großes Bild), ohne Stream 900 s. Die Nicht-Stream-Aufrufe (Befehl, Kontextmenü, Anbieter-API, Vision-Test) laufen mit `stream: false`. Die Fehlertexte baut `llm_call.ts::chatOutOrThrow` aus `kind` über `t("chat.err.*")`.
- **Die Verbindung schwärzt Geheimnisse vor dem Senden (umkehrbar, Bildteile nie).** Das Anfrage-Profil (Modus `transform`) und der Abschnitt „Anfrage“ kommen ebenfalls aus der Verbindung.
- **Der Schlüssel kommt aus `(await llm.resolve()).config`, nicht aus den Settings.** Er liegt im Obsidian-Schlüsselbund.

## Endpunkt-Quelle (Welle 8, 2026-09-25; seit Welle 15 über die Verbindung)

- **Die Endpunkt-QUELLE gehört dem LLM Endpoint Manager, sobald er installiert ist.** `plugin.llm.resolve()` löst Endpunkt UND Modell auf — Manager zuerst (bei JEDEM Aufruf frisch gefunden, nie gemerkt), sonst `visionEndpoints` (Modell je Zeile, lokal gemerkt bis `invalidate()`).
- **`plugin.model` ist das Modell für jeden Aufruf** (`llm.modelInUse()`, mit Manager nach `invalidate()` aus `choice.model`). Das globale Feld `visionModel` ist seit Welle 17 abgeschafft, `migrateVisionModel` verteilt den Altwert einmal auf die Zeilen; die Panel-Wahl schreibt über `llm.setModel` in die aktive Zeile.
- **`settings.choice` hält die Wahl gegenüber dem Manager und gilt nur mit Manager** (ein Modellname ist an seinen Endpunkt gebunden).
- **Es gibt keine eigene Modell-Zeile mehr (Welle 17).** Die Fähigkeits-Anzeige folgt über `onResolved` dem Modell der Zeile — **nur bei geändertem Modell**, sonst ruft ihre Probe die Auflösung im Kreis (gemessen: Renderer hing, F1–V1 Zeitüberschreitung).
- **Ein Manager ohne Endpunkt ergibt KEINEN lokalen Rückfall** (Kit-Vertrag).
- **GUI-Smoke F1–F3 legen einen Fake-Manager in den Plugin-Slot und stellen den Slot im `finally` und im Abbruch-Handler zurück;** V1–V5 prüfen Schlüssel, Schlüsselbund, Nicht-Stream, Schwärzung und Stufenwahl gegen einen Fake-Endpunkt.

## Server-Eigenheiten

- **Endpoint mit `/v1`-Suffix:** `normalizeEndpoint()` strippt ein trailing `/v1`, sonst baute der Client `…/v1/v1/chat/completions`. LM Studio antwortet auf falsche Pfade mit HTTP 200 + Fehler-Body (kein echter Fehler) → `res.ok` true, Stream leer → still leeres Transkript. Seit 0.22.0 fällt so ein Endpunkt aus der Auflösung, weil `ping()` die Modell-Listen-Form verlangt.
- **LM Studio ignoriert das `model`-Feld** → das tatsächliche Modell aus `response.model` lesen.
- **HEIC/HEIF** (iOS-Default) werden von Vision-Modellen abgelehnt → übersprungen + Warnung.
- **Der Vision-Endpoint-Default ist `:1234`** (LM Studio, Referenzserver des Dachs; bis 0.30.1 `:8080`, MLX). Ein MLX-Server hört auf `:8080`; eine gespeicherte Liste bleibt.
