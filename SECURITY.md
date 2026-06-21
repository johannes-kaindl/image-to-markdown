# Security Policy

## Supported Versions

Security updates are provided for the most recently released version of Image to Markdown. Older versions do not receive backported fixes — please update to the latest release.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public issues.

Instead, report them privately by email to **code@jkaindl.de** (PGP-encrypted mail is welcome). You will receive a prompt acknowledgement, and we will keep you informed as the fix progresses.

## Data Handling / Scope

Image to Markdown is offline-first by design, which is also its core security property:

- **Image data is sent only to the local endpoint you configure.** When you transcribe an image, the plugin builds a multimodal request to the OpenAI-compatible Vision endpoint set in the plugin settings (default `http://localhost:8080`). Nothing is sent anywhere else.
- **No telemetry.** The plugin does not collect usage data or phone home.
- **Nothing goes to the cloud or to third parties.** No external services, no analytics, no remote logging.
- **The trust anchor is the local server you control.** Because all image data flows exclusively to the endpoint you point the plugin at, the security of your data rests on the local server you run and trust (for example LM Studio, Ollama, or an MLX server). Keep that server local and under your control.

If you have questions about the plugin's data handling beyond what is described here, the same private contact above applies.
