/**
 * Erzeugt das Pruefmaterial fuer Aufnahme-Vault und GUI-Smoke.
 *
 * Warum ein Generator statt getrackter Binaerdateien: das Material soll im Repo
 * lesbar und aenderbar sein. Ein PNG im Diff ist ein undurchsichtiger Blob; die
 * Zeilen, die darauf stehen, gehoeren in eine Datei, die man lesen kann.
 *
 * Warum ueberhaupt eigenes Material: der Vertrag in `docs/images/README.md` verlangt
 * fuer die Aufnahmen einen Wegwerf-Vault ohne fremde Inhalte, und der GUI-Smoke darf
 * nicht "die erste .png nehmen, die der Vault liefert" — ein einziger kaputter Fund
 * im Produktivvault kippt sonst die ganze Runde (gemessen an 3d-codeblocks,
 * 2026-08-30: 2/19, das Plugin war fehlerfrei).
 *
 * Aufruf: node docs/images/fixture/make-assets.mjs <zielverzeichnis>
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const ziel = argv[2];
if (!ziel) {
  console.error("Aufruf: node make-assets.mjs <zielverzeichnis>");
  exit(1);
}

// --- PNGs --------------------------------------------------------------------
// Gezeichnet mit PIL. Die Schrift kommt aus dem System, weil ein mitgeliefertes TTF
// eine Lizenzfrage waere und `load_default()` bei 11 px aufhoert — zu klein, als dass
// ein Vision-Modell daraus etwas lesen koennte. Faellt die Suche durch, bricht der
// Generator ab statt unlesbares Material zu erzeugen.

const PIL = String.raw`
import sys
from PIL import Image, ImageDraw, ImageFont

ziel = sys.argv[1]

KANDIDATEN = [
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]

def font(groesse, fett=False):
    for pfad in KANDIDATEN:
        try:
            return ImageFont.truetype(pfad, groesse)
        except OSError:
            continue
    raise SystemExit(
        "Keine brauchbare Systemschrift gefunden. Gesucht:\n  " + "\n  ".join(KANDIDATEN)
    )

PAPIER = (250, 248, 243)
TINTE = (38, 36, 33)
BLASS = (120, 116, 110)

# --- field-notes.png: eine Notizbuchseite mit Ueberschrift, Liste und Tabelle ---
# Das Motiv traegt bewusst eine Tabelle: sie ist der Fall, an dem sich Transkription
# von OCR unterscheidet, und der Prompt-Preset "tables" hat damit einen Gegenstand.
im = Image.new("RGB", (1000, 1300), PAPIER)
d = ImageDraw.Draw(im)
y = 70
d.text((70, y), "Ridge survey", font=font(52, True), fill=TINTE); y += 78
d.text((70, y), "14 August, north-west face", font=font(28), fill=BLASS); y += 66
d.line((70, y, 930, y), fill=BLASS, width=2); y += 40

for zeile in [
    "Wind held from the north-west all morning. Cloud base",
    "sat just below the saddle, so the upper traverse stayed",
    "out of sight until noon.",
]:
    d.text((70, y), zeile, font=font(30), fill=TINTE); y += 46
y += 24

for punkt in [
    "Snow line: 1 840 m, receding",
    "Stream crossing at marker 7: passable, ankle deep",
    "Hut roof: two sheets lifted, needs a second look",
]:
    d.ellipse((74, y + 12, 86, y + 24), fill=TINTE)
    d.text((106, y), punkt, font=font(30), fill=TINTE); y += 48
y += 40

spalten = [70, 520, 760]
kopf = ["Segment", "Distance", "Time"]
reihen = [
    ["Trailhead to marker 7", "4.2 km", "1 h 05"],
    ["Marker 7 to saddle", "2.8 km", "1 h 40"],
    ["Saddle to hut", "1.1 km", "0 h 25"],
]
for x, text in zip(spalten, kopf):
    d.text((x, y), text, font=font(28, True), fill=TINTE)
y += 44
d.line((70, y, 930, y), fill=BLASS, width=2); y += 18
for reihe in reihen:
    for x, text in zip(spalten, reihe):
        d.text((x, y), text, font=font(28), fill=TINTE)
    y += 46

im.save(ziel + "/field-notes.png")
print("  field-notes.png  1000x1300")

# --- water-cycle.png: ein Schema, kein Fliesstext -------------------------------
# Gegenstand fuer den Beschreiben-Modus: hier ist "transkribiere den Text" die
# falsche Antwort, und genau daran zeigt sich der Moduswechsel.
im = Image.new("RGB", (1000, 700), (247, 250, 252))
d = ImageDraw.Draw(im)
d.text((60, 42), "The water cycle", font=font(44, True), fill=(28, 52, 74))

kaesten = [
    (90, 170, 330, 290, "Ocean", (176, 208, 232)),
    (400, 120, 640, 240, "Evaporation", (206, 228, 198)),
    (700, 170, 930, 290, "Cloud", (222, 226, 232)),
    (400, 420, 640, 540, "Precipitation", (208, 214, 236)),
    (90, 470, 330, 590, "Runoff", (232, 216, 196)),
]
for x0, y0, x1, y1, name, farbe in kaesten:
    d.rounded_rectangle((x0, y0, x1, y1), radius=14, fill=farbe, outline=(90, 108, 126), width=2)
    f = font(30, True)
    b = d.textbbox((0, 0), name, font=f)
    d.text((x0 + (x1 - x0 - b[2]) / 2, y0 + (y1 - y0 - b[3]) / 2), name, font=f, fill=(28, 52, 74))

for a, b in [((330, 230), (400, 190)), ((640, 180), (700, 220)),
             ((815, 290), (640, 470)), ((400, 490), (330, 520)), ((210, 470), (210, 290))]:
    d.line((a[0], a[1], b[0], b[1]), fill=(90, 108, 126), width=3)

d.text((60, 630), "Arrows show direction of transport, not volume.", font=font(24), fill=(110, 124, 138))
im.save(ziel + "/water-cycle.png")
print("  water-cycle.png  1000x700")
`;

console.log("PNG-Material:");
execFileSync("python3", ["-c", PIL, ziel], { stdio: "inherit" });

// --- photo.heic --------------------------------------------------------------
// Absichtlich KEIN echtes HEIC: die Datei existiert, damit die Sidebar-Zeile den
// nicht unterstuetzten Fall zeigt (ausgegraut, nicht ausgewaehlt). `findImageEmbeds`
// liest den Notiztext, nicht die Datei — der Inhalt ist deshalb nie im Spiel, und ein
// echtes HEIC waere ein Binaerblob ohne Gegenwert. Der Kommentar steht IM Material,
// damit niemand es fuer eine kaputte Aufnahme haelt.
writeFileSync(
  join(ziel, "photo.heic"),
  "Not a real HEIC. Placeholder so the sidebar has an unsupported format to grey out.\n",
);
console.log("  photo.heic       Platzhalter (Endung genuegt)");

// --- trail-handbook.pdf ------------------------------------------------------
// Minimaler PDF-Schreiber statt einer Abhaengigkeit: drei Seiten, echter Text-Layer
// (Helvetica, eine der 14 Standard-Schriften — braucht keine eingebettete Datei).
// Der Text-Layer ist nicht Zierde: an ihm haengt die Einstellung "use embedded PDF
// text", und ein reines Bild-PDF wuerde diesen Pfad still ueberspringen.

/** PDF-Stringliteral: \, ( und ) sind die drei Zeichen, die escaped werden muessen. */
const pdfText = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const SEITEN = [
  {
    titel: "Trail handbook",
    zeilen: [
      "Page 1 of 3 - Before you go",
      "",
      "Check the hut warden's board at the trailhead. It carries the only",
      "current word on the upper traverse; the printed times below assume",
      "the saddle route is open.",
      "",
      "Water is reliable up to marker 7 and nowhere above it.",
      "Carry two litres from the crossing.",
    ],
  },
  {
    titel: "Stages and times",
    zeilen: [
      "Page 2 of 3 - Stages",
      "",
      "Trailhead to marker 7      4.2 km      1 h 05",
      "Marker 7 to the saddle     2.8 km      1 h 40",
      "Saddle to the hut          1.1 km      0 h 25",
      "",
      "Times are for a loaded pack in dry conditions. Add half an hour",
      "to the middle stage once the snow line drops below the saddle.",
    ],
  },
  {
    titel: "At the hut",
    zeilen: [
      "Page 3 of 3 - At the hut",
      "",
      "Twelve bunks, no warden outside the season. The stove works;",
      "the chimney damper sticks and needs a firm pull.",
      "",
      "Leave the shutters closed and the door barred. Sign the book by",
      "the door - it is how the maintenance round knows what to bring.",
    ],
  },
];

function baueSeitenInhalt(seite) {
  const teile = [
    "BT",
    "/F1 24 Tf",
    "72 720 Td",
    `(${pdfText(seite.titel)}) Tj`,
    "ET",
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "72 680 Td",
  ];
  for (const zeile of seite.zeilen) teile.push(`(${pdfText(zeile)}) Tj T*`);
  teile.push("ET");
  return teile.join("\n") + "\n";
}

function bauePdf(seiten) {
  const objekte = [];       // 1-basiert: objekte[i] ist Objekt i+1
  const seitenIds = seiten.map((_, i) => 4 + i * 2);

  objekte.push("<< /Type /Catalog /Pages 2 0 R >>");
  objekte.push(
    `<< /Type /Pages /Kids [${seitenIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${seiten.length} >>`,
  );
  objekte.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  seiten.forEach((seite, i) => {
    const inhaltId = seitenIds[i] + 1;
    objekte.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${inhaltId} 0 R >>`,
    );
    const inhalt = baueSeitenInhalt(seite);
    objekte.push(`<< /Length ${Buffer.byteLength(inhalt, "latin1")} >>\nstream\n${inhalt}endstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objekte.forEach((koerper, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${koerper}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const pdf = bauePdf(SEITEN);
writeFileSync(join(ziel, "trail-handbook.pdf"), pdf);
console.log(`  trail-handbook.pdf  ${SEITEN.length} Seiten, ${pdf.length} Bytes, mit Text-Layer`);
