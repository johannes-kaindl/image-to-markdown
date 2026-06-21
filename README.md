# Image to Markdown

Obsidian-Plugin: transkribiert die **Bilder einer Notiz** per **lokalem Vision-LLM** nach
Markdown — komplett offline, ohne Cloud. Für jede gescannte/fotografierte Seite entsteht eine
eigene Transkript-Notiz, der Bild-Embed in der Quellnotiz wird durch einen Embed der neuen
Notiz ersetzt (nicht-destruktiv, idempotent).

> Schwester-Plugin von [vault-rag](https://codeberg.org/jkaindl/vault-rag) — dort liegt der
> RAG-Kern (Related-Notes, semantische Suche, Chat). `image-to-markdown` wurde aus vault-rag 0.2.0
> ausgegliedert, weil Bild-Transkription kein RAG ist.

## Funktionen

- **Sidebar** (Ribbon „Image → Markdown"): Liste aller eingebetteten Bilder der aktiven Notiz
  (alle vorausgewählt; nicht unterstützte Formate deaktiviert). „Transkribieren" streamt die
  Antwort des Vision-Modells **live** in Karten — inkl. aufklappbarem Gedanken-Block bei
  Reasoning-Modellen und Kopier-Button. Pro Karte „Notiz anlegen" oder „Alle anlegen".
- **Command** „Bilder der aktiven Notiz transkribieren" — Batch ohne Sidebar.
- **Editor-Kontextmenü** „Image → Markdown" — nur das Bild unter dem Cursor.

## Setup

Ein OpenAI-kompatibler Server mit Vision-Modell (z.B. [LM Studio](https://lmstudio.ai),
MLX, Ollama). In den Plugin-Einstellungen:

| Einstellung | Default | Hinweis |
|---|---|---|
| **Vision Endpoint** | `http://localhost:8080` | MLX-Default; **LM Studio nutzt `:1234`** |
| **Vision Modell** | (aus `/v1/models`) | z.B. Qwen2-VL, Llama-3.2-Vision |
| **Vision Prompt** | Markdown-Transkription | frei editierbar |

## Gotchas

- **HEIC/HEIF** (iOS-Default) werden von Vision-Modellen abgelehnt und übersprungen — iOS auf
  „Maximal kompatibel" stellen oder vorher konvertieren. Unterstützt: PNG, JPG, JPEG, WebP, GIF.
- **LM Studio ignoriert das `model`-Feld** und nutzt das geladene Modell — das tatsächlich
  genutzte Modell wird aus der Response übernommen (`transcribed_by`-Frontmatter).

## Entwicklung

```bash
npm install
npm run dev     # esbuild watch
npm run build   # prod-Bundle → main.js
npm test        # vitest
```

## Lizenz

[AGPL-3.0](LICENSE).
