#!/bin/sh
# Re-vendor kit modules from ../obsidian-kit. Run after kit updates.
#
# Zielordner ist Vertrag, nicht Geschmack: obsidian-kit/src/pure/* -> src/vendor/kit/,
# obsidian-kit/src/obsidian/* -> src/vendor/kit-obsidian/. Die pure-Schicht bleibt
# obsidian-frei (PROF-OBS-03/04); ein obsidian-importierendes Modul unter src/vendor/kit/
# faellt in den Nachbar-Repos durch deren check:pure.
#
# BEWUSST NICHT hier: tests/vendor/kit/obsidian-mock.ts. Die lokale Kopie steht auf 0.3.0
# und ist gegenueber obsidian-kit/src/testing/obsidian-mock.ts echt gedriftet (677 <-> 804
# Zeilen). Wer sie mitzieht, tauscht die Testbasis des GESAMTEN Repos in derselben Runde
# aus — ein rotes Gate waere dann keinem Diff mehr zuzuordnen. Eigene Aufgabe, eigener
# Gate-Lauf; ihr Pin steht bis dahin in ihrer Stempelzeile.
set -e

KIT="${KIT_DIR:-../obsidian-kit}"
[ -d "$KIT/src/pure" ] || { echo "Kit nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
VER=$(node -p "require('$KIT/package.json').version")
SHA=$(git -C "$KIT" rev-parse --short HEAD)

# Stempelform DIESES Repos: '#' statt '@', Kit-Pfad, kein Zusatz — so tragen es die neun
# vorbestehenden Kopien seit 0.3.0. Bewusst nicht die koda-Form ('@' + "do not hand-edit;
# re-vendor via ..."), damit ein Vendoring-Commit nicht nebenbei zehn Dateien umformatiert
# und dabei die eine echte Aenderung im Diff versteckt.
stamp() { # stamp <vendored-file> <kit-relative-path>
  header="// vendored from obsidian-kit#$VER, $2"
  printf '%s\n' "$header" | cat - "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}

# Kit-interne Querimporte aufs Vendor-Layout umschreiben. Im Kit liegen die Schichten als
# src/obsidian + src/pure nebeneinander, hier als src/vendor/kit-obsidian + src/vendor/kit —
# "../pure/" zeigt hier also ins Leere. Das ist die EINZIGE zulaessige Abweichung von
# verbatim; bei jedem Re-Vendor reproduzieren, sonst darf nichts abweichen.
# Praezedenz: kuro-gamification, markdown-presentation, vault-crews, vim-dojo (seit 0.26.0).
relayer() { # relayer <vendored-file>
  f=$1

  # (0) VORBEDINGUNG. Der Umschrieb setzt die Zwei-Ordner-Form der Kit-README voraus. Ohne
  #     sie zeigt "../kit/" von src/vendor/kit/ aus auf DIE DATEI SELBST — und weil
  #     obsidian/clipboard.ts und pure/clipboard.ts denselben Basenamen tragen, faellt das
  #     erst im Typecheck auf (TS2305). Laut abbrechen statt still falsch vendorieren.
  case "$f" in
    src/vendor/kit-obsidian/*) ;;
    *) echo "sync-kit: $f liegt nicht in src/vendor/kit-obsidian/ — der Querimport-Umschrieb setzt die Zwei-Ordner-Form voraus (obsidian-kit/README.md)" >&2; exit 1 ;;
  esac
  [ -d src/vendor/kit ] || { echo "sync-kit: src/vendor/kit/ fehlt — pure-Schicht anlegen, bevor gekoppelte Module mit Querimport vendoriert werden" >&2; exit 1; }

  # (1) Umschreiben, und feststellen OB umgeschrieben wurde. Das Muster ankert am
  #     Anfuehrungszeichen, nicht an 'from "': das Kit schreibt src/pure/pdf/* mit einfachen
  #     Anfuehrungszeichen. `cmp` statt md5, weil macOS (md5) und CI (md5sum) verschieden heissen.
  sed 's|\(["'"'"']\)\.\./pure/|\1../kit/|g' "$f" > "$f.tmp"
  if cmp -s "$f" "$f.tmp"; then rm -f "$f.tmp"; return 0; fi   # nichts zu tun, KEINE Notiz
  mv "$f.tmp" "$f"

  # (2) Gegenprobe: bleibt ein ../pure/ stehen, bricht der Build spaeter und woanders.
  if grep -q '\.\./pure/' "$f"; then
    echo "sync-kit: '../pure/' in $f nicht umgeschrieben — Muster pruefen" >&2; exit 1
  fi

  # (3) Mitvendorier-Gegenprobe: jedes umgeschriebene Ziel muss auch wirklich da sein.
  for dep in $(sed -n 's|.*from ["'"'"']\.\./kit/\([A-Za-z0-9_/-]*\)["'"'"'].*|\1|p' "$f" | sort -u); do
    [ -f "src/vendor/kit/$dep.ts" ] || {
      echo "sync-kit: $f importiert ../kit/$dep, aber src/vendor/kit/$dep.ts fehlt — mitvendorieren" >&2; exit 1
    }
  done

  note="// ONE mechanical deviation from verbatim: kit-internal imports ../pure/ → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ."
  printf '%s\n' "$note" | cat - "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
}

mkdir -p src/vendor/kit src/vendor/kit-obsidian

# Nur die Module, die DIESES Repo wirklich konsumiert. Form "kit-modul" oder
# "kit-modul:lokaler-name" — der Name weicht genau einmal ab: think-splitter.ts heisst hier
# seit 0.3.0 think.ts und wird von vier Stellen so importiert (Inhalt bleibt verbatim).
for m in capabilities clipboard diff endpoint endpoint_config error_body reasoning settings sse think-splitter:think; do
  case "$m" in *:*) src=${m%%:*}; dst=${m#*:} ;; *) src=$m; dst=$m ;; esac
  cp "$KIT/src/pure/$src.ts" "src/vendor/kit/$dst.ts"
  stamp "src/vendor/kit/$dst.ts" "src/pure/$src.ts"
  echo "vendored obsidian-kit#$VER/pure/$src.ts -> src/vendor/kit/$dst.ts"
done

for m in clipboard folder-suggest settings_walker; do
  cp "$KIT/src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  relayer "src/vendor/kit-obsidian/$m.ts"
  stamp "src/vendor/kit-obsidian/$m.ts" "src/obsidian/$m.ts"
  echo "vendored obsidian-kit#$VER/obsidian/$m.ts"
done

cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "capabilities.ts, clipboard.ts, diff.ts, endpoint.ts, endpoint_config.ts, error_body.ts, reasoning.ts, settings.ts, sse.ts, think.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. think.ts ist obsidian-kit/src/pure/think-splitter.ts — nur der Dateiname weicht ab, der Inhalt ist verbatim. kit-obsidian/ siehe dessen VENDOR.json; tests/vendor/kit/obsidian-mock.ts steht weiter auf 0.3.0 und wird von diesem Skript bewusst nicht angefasst (Begruendung im Skript-Kopf)."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "clipboard.ts, folder-suggest.ts, settings_walker.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. EINE mechanische Abweichung in clipboard.ts: die kit-internen Importe ../pure/ -> ../kit/ (Vendor-Layout; im Kit sind src/obsidian und src/pure Geschwister, hier kit-obsidian und kit). Wird bei jedem Re-Vendor reproduziert, sonst darf nichts abweichen. Praezedenz: kuro-gamification, markdown-presentation, vault-crews, vim-dojo."
}
JSON
echo "VENDOR.json → $VER ($SHA)"
