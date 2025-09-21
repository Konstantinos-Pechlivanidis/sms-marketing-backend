// apps/api/src/lib/namedays.js
const GREEK_DIACRITICS = /[\u0384-\u03CE\u1f00-\u1ffe]/g;

// Basic accent stripping for Greek; fallback remove diacritics
function stripGreekAccents(input) {
  if (!input) return '';
  // NFD then remove combining diacritics
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ϊ/g, 'Ι').replace(/Ϋ/g, 'Υ')
    .replace(/ϊ/g, 'ι').replace(/ϋ/g, 'υ').replace(/ΐ/g, 'ι').replace(/ΰ/g, 'υ');
}

// Lowercase, strip accents, keep letters only (greek & latin)
function normalizeRawName(s) {
  if (!s) return '';
  const t = stripGreekAccents(String(s).toLowerCase());
  return t.replace(/[^a-zα-ωάέίόύήώϊϋΐΰ]/g, '');
}

// Map many variants → canonical keys
const ALIASES = [
  // Konstantinos family
  { canon: 'konstantinos', variants: ['κωνσταντινο', 'κωνσταντινος', 'κωστας', 'κωστα', 'κωστης', 'kostas', 'kosta', 'konstantino', 'konstantinos', 'constantinos', 'costas', 'kostis'] },
  // Eleni
  { canon: 'eleni', variants: ['ελενη', 'ελενη', 'ελενη', 'eleni', 'helen', 'elene'] },
  // Giorgos / George
  { canon: 'giorgos', variants: ['γεωργιος', 'γεωργοσ', 'γιωργος', 'γιωργοσ', 'giorgos', 'georgios', 'george', 'jorge'] },
  // Ioannis / Giannis / Yannis / John
  { canon: 'ioannis', variants: ['ιωαννης', 'ιοαννης', 'γιαννης', 'γιανησ', 'γιάννης', 'giannis', 'yannis', 'ioannis', 'john', 'ioanis'] },
  // Maria
  { canon: 'maria', variants: ['μαρια', 'maria', 'mary', 'marie'] },
  // Nikos
  { canon: 'nikos', variants: ['νικοσ', 'νικος', 'nikos', 'niko', 'nicholas', 'nikolaos', 'νικολαος'] },
  // Anna
  { canon: 'anna', variants: ['αννα', 'anna', 'anne', 'hannah'] },
  // Thanasis / Athanasios
  { canon: 'athanasios', variants: ['αθανασιοσ', 'αθανασιος', 'θανασης', 'θανασησ', 'thanasis', 'athanasios'] },
  // Dimitrios
  { canon: 'dimitrios', variants: ['δημητριοσ', 'δημητρης', 'dimitris', 'dimitrios', 'demetrios', 'jim'] },
];

const VARIANT_INDEX = (() => {
  const idx = new Map();
  for (const { canon, variants } of ALIASES) {
    for (const v of variants) idx.set(v, canon);
  }
  return idx;
})();

// Orthodox Easter (Meeus/Jones/Butcher for Julian-based Orthodox)
function orthodoxEaster(year) {
  // Algorithm adapted for Orthodox Easter (Julian calendar → Gregorian)
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;

  // Julian date of Pascha = month/day, then convert +13 days to Gregorian (20th–21st c.)
  const julian = new Date(Date.UTC(year, month - 1, day + 13));
  // Sunday after full moon + 7 days = Pascha Sunday
  const pascha = new Date(julian.getTime());
  pascha.setUTCDate(julian.getUTCDate() + 7);
  return pascha; // UTC date of Orthodox Easter Sunday
}

// St George: 23 April; if falls before Easter → moved to **Easter Monday**
function stGeorgeDate(year) {
  const easter = orthodoxEaster(year);
  const base = new Date(Date.UTC(year, 3, 23)); // Apr 23
  // Compare by date (ignore tz)
  const baseYMD = Date.UTC(year, base.getUTCMonth(), base.getUTCDate());
  const easterYMD = Date.UTC(year, easter.getUTCMonth(), easter.getUTCDate());
  if (baseYMD < easterYMD) {
    const moved = new Date(easter);
    moved.setUTCDate(easter.getUTCDate() + 1); // Easter Monday
    return moved;
  }
  return base;
}

// Canonical name → fixed / movable date(s) per year
function namedayDatesForCanon(canon, year) {
  switch (canon) {
    case 'konstantinos':
    case 'eleni':
      return [new Date(Date.UTC(year, 4, 21))]; // 21 May
    case 'giorgos': {
      return [stGeorgeDate(year)];
    }
    case 'ioannis':
      return [new Date(Date.UTC(year, 0, 7))]; // 7 Jan
    case 'maria':
      return [new Date(Date.UTC(year, 7, 15))]; // 15 Aug
    case 'nikos':
      return [new Date(Date.UTC(year, 11, 6))]; // 6 Dec
    case 'anna':
      return [new Date(Date.UTC(year, 6, 25))]; // 25 Jul
    case 'athanasios':
      return [new Date(Date.UTC(year, 0, 18))]; // 18 Jan
    case 'dimitrios':
      return [new Date(Date.UTC(year, 9, 26))]; // 26 Oct
    default:
      return [];
  }
}

function canonicalizeName(firstName) {
  const norm = normalizeRawName(firstName);
  if (!norm) return null;
  const direct = VARIANT_INDEX.get(norm);
  if (direct) return direct;
  // simple latin fallbacks
  if (norm === 'kostas') return 'konstantinos';
  if (norm === 'kwnstantinos' || norm === 'konstantinos') return 'konstantinos';
  return null;
}

function hasNamedayOn(firstName, date) {
  const canon = canonicalizeName(firstName);
  if (!canon) return false;
  const year = date.getUTCFullYear();
  const ymd = `${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  return namedayDatesForCanon(canon, year).some(d => 
    (d.getUTCMonth() + 1) === (date.getUTCMonth() + 1) && d.getUTCDate() === date.getUTCDate()
  );
}

module.exports = {
  canonicalizeName,
  namedayDatesForCanon,
  hasNamedayOn,
  orthodoxEaster,
  stGeorgeDate,
};
