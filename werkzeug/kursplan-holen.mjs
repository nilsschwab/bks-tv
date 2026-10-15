// Holt den oeffentlichen Virtuagym-Kursplan (diese und naechste Woche) und schreibt kurse.json
// fuer die Kursplan-Folie des Fernsehers.
//
// Quelle: https://bks.virtuagym.com/classes/week/JJJJ-MM-TT?embedded=1 - oeffentlich, ohne Login
// und ohne API-Schluessel. Laeuft stuendlich als GitHub Action im Repository bks-tv
// (.github/workflows/kursplan.yml), lokal geht es genauso:
//
//   node werkzeug/kursplan-holen.mjs kurse.json
//
// Zeitzone: Die Wochen werden nach Ortszeit bestimmt. Die Action setzt TZ=Europe/Berlin.
//
// Schutz gegen stille Fehler: Liefert Virtuagym eine geaenderte Seite und es lassen sich nicht
// genau so viele Kurse lesen, wie Termine auf der Seite stehen, bricht das Skript ab und
// schreibt nichts. Die Folie zeigt dann nach drei Tagen von selbst wieder die eingebettete
// Virtuagym-Ansicht.

import { readFile, writeFile } from 'node:fs/promises';

const ZIEL = process.argv[2] || 'kurse.json';
const BASIS = 'https://bks.virtuagym.com/classes/week/';
const HERZSCHLAG_STUNDEN = 20; // ohne Aenderung trotzdem einmal am Tag neu schreiben (Lebenszeichen)

const zwei = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;

function montag(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function text(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
}

async function woche(mo) {
  const url = `${BASIS}${iso(mo)}?embedded=1`;
  const antwort = await fetch(url, { headers: { 'User-Agent': 'BKS-Fernseher/1.0 (Kursplan im Aufenthaltsraum)' } });
  if (!antwort.ok) throw new Error(`${url} -> HTTP ${antwort.status}`);
  const html = await antwort.text();
  if (!html.includes('Kursplan') && !html.includes('cal_column')) throw new Error(`${url}: unerwartete Seite`);

  const erwartet = (html.match(/openScheduleModal\('\/classes\/class\//g) || []).length;
  const kurse = [];

  // Jeder Termin ist ein <div id="..."> mit class="class ... internal-event-day-TT-MM-JJJJ".
  // Platzhalter haben id="" und werden uebersprungen.
  for (const stueck of html.split('<div id="').slice(1)) {
    const id = stueck.slice(0, stueck.indexOf('"'));
    if (!id || id.endsWith('_p')) continue;
    const klasse = (stueck.match(/class="(class [^"]*)"/) || [])[1];
    if (!klasse) continue;
    const tag = klasse.match(/internal-event-day-(\d{2})-(\d{2})-(\d{4})/);
    const name = stueck.match(/<span class="classname">([^<]*)<\/span>/);
    const zeit = stueck.match(/<span class="time">\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*<\/span>/);
    if (!tag || !name || !zeit || !text(name[1])) continue;
    const trainer = stueck.match(/<span class="instructor">\s*<i>([^<]*)<\/i>/);
    const farbe = stueck.match(/border-left:\s*\d+px solid (#[0-9A-Fa-f]{3,6})/);
    kurse.push({
      datum: `${tag[3]}-${tag[2]}-${tag[1]}`,
      start: zeit[1].padStart(5, '0'),
      ende: zeit[2].padStart(5, '0'),
      titel: text(name[1]),
      trainer: trainer ? text(trainer[1]) : '',
      farbe: farbe ? farbe[1].toUpperCase() : '',
      abgesagt: /cancel/i.test(klasse),
      voll: /class_full/i.test(klasse)
    });
  }

  if (kurse.length !== erwartet) {
    throw new Error(`${url}: ${erwartet} Termine auf der Seite, aber ${kurse.length} gelesen - Seitenaufbau geaendert?`);
  }
  return kurse;
}

const heute = new Date();
const mo1 = montag(heute);
const mo2 = new Date(mo1.getFullYear(), mo1.getMonth(), mo1.getDate() + 7);
const wochen = [iso(mo1), iso(mo2)];

const kurse = [...await woche(mo1), ...await woche(mo2)]
  .sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));

let alt = null;
try { alt = JSON.parse(await readFile(ZIEL, 'utf8')); } catch { /* erste Ausfuehrung */ }

const gleich = alt && JSON.stringify(alt.wochen) === JSON.stringify(wochen)
  && JSON.stringify(alt.kurse) === JSON.stringify(kurse);
const frisch = alt && (Date.now() - Date.parse(alt.stand)) < HERZSCHLAG_STUNDEN * 3600 * 1000;

if (gleich && frisch) {
  console.log(`Keine Aenderung (${kurse.length} Kurse), ${ZIEL} bleibt wie es ist.`);
} else {
  const daten = { stand: new Date().toISOString(), quelle: 'https://bks.virtuagym.com/classes', wochen, kurse };
  await writeFile(ZIEL, JSON.stringify(daten, null, 1) + '\n', 'utf8');
  console.log(`${ZIEL} geschrieben: ${kurse.length} Kurse in den Wochen ab ${wochen.join(' und ')}.`);
}
