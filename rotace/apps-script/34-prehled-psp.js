// ============================================================
// Běžné převozy přes CS – jen pro přehled
// ============================================================
// Vedle prioritních nakládek chceme na čtečce vidět i obyčejná PSP, která
// na CS čekají na odeslání. Aby seznam vypadal tak, jak bude vypadat
// v provozu: jeden seznam poboček, v něm urgenty označené jako prioritní.
//
// ⚠ ČTEME, NEZAPISUJEME. Běžný výdej odbavuje WMS a zápis do listu DATA
// patří jemu. Dva zapisovatelé nad jedním sloupcem = dvojí výdej.
// Až se obrazovka přestěhuje do WMS, převezme i zápis.

// Pozice sloupců v listu DATA bereme stejné jako WMS (1 = A).
const DATA_SL = {
  idVykladka: 4,    // D
  pobVykladka: 5,   // E
  cisloPsp: 6,      // F
  idStroje: 9,      // I – prázdné = příslušenství
  nazevPolozky: 11, // K
  svezenoNaCS: 18,  // R
  odeslanoZCS: 19,  // S
  svezeno: 20,      // T
  odeslano: 22,     // V
  storno: 31        // AE
};

const OKNO_DATA = 2500;    // kolik posledních řádků DATA procházíme
const OKNO_POHYBU = 2000;

function jeVyplneno_(hodnota) {
  return !!(hodnota && String(hodnota).trim());
}

/** ID stroje → lokace, kde naposledy stál. Stejný princip jako ve WMS. */
function lokaceZPohybu_() {
  const s = sloupcePohybu_();
  if (!s || s.stroj < 0 || s.akce < 0 || s.lokace < 0) return {};

  const posledni = s.list.getLastRow();
  if (posledni < 2) return {};

  const od = Math.max(2, posledni - OKNO_POHYBU + 1);
  const hodnoty = s.list.getRange(od, 1, posledni - od + 1, s.sirka).getValues();

  const mapa = {};
  hodnoty.forEach(radek => {
    const stroj = String(radek[s.stroj] || '').toUpperCase().trim();
    if (!stroj) return;
    const akce = String(radek[s.akce] || '').toUpperCase();
    // Rozhoduje nejnovější pohyb: příjem s lokací = stojí tam, výdej = je pryč.
    if (akce.indexOf('PŘÍJEM') !== -1 || akce.indexOf('PRIJEM') !== -1) {
      mapa[stroj] = String(radek[s.lokace] || '').trim();
    } else {
      mapa[stroj] = '';
    }
  });

  return mapa;
}

/**
 * PSP, která leží přijatá na CS a ještě neodjela.
 * Vrací je seskupená po dokladech, s pobočkou, kam mají jet.
 */
function pspCekajiciNaVydej_() {
  const list = tabulka_().getSheetByName('DATA');
  if (!list) return [];

  const posledni = list.getLastRow();
  if (posledni < 2) return [];

  const sirka = list.getLastColumn();
  const hlavicka = list.getRange(1, 1, 1, sirka).getValues()[0]
    .map(h => String(h || '').trim().toLowerCase());

  const iPrijem = hlavicka.indexOf('wms příjem');
  const iVydej = hlavicka.indexOf('wms výdej');

  const od = Math.max(2, posledni - OKNO_DATA + 1);
  const hodnoty = list.getRange(od, 1, posledni - od + 1, sirka).getValues();

  const lokace = lokaceZPohybu_();
  const doklady = {};

  hodnoty.forEach(radek => {
    const hod = pozice => radek[pozice - 1];

    if (hod(DATA_SL.storno) === true) return;

    const prijato = (iPrijem >= 0 && jeVyplneno_(radek[iPrijem])) ||
      jeVyplneno_(hod(DATA_SL.svezenoNaCS)) || hod(DATA_SL.svezeno) === true;

    const odeslano = (iVydej >= 0 && jeVyplneno_(radek[iVydej])) ||
      jeVyplneno_(hod(DATA_SL.odeslanoZCS)) || hod(DATA_SL.odeslano) === true;

    if (!prijato || odeslano) return;

    const psp = String(hod(DATA_SL.cisloPsp) || '').trim();
    if (!psp) return;

    const pobocka = String(hod(DATA_SL.idVykladka) || '').toUpperCase().trim();
    if (!pobocka) return;

    if (!doklady[psp]) {
      doklady[psp] = {
        psp: psp,
        pobocka: pobocka,
        nazevPobocky: String(hod(DATA_SL.pobVykladka) || '').trim(),
        polozky: []
      };
    }

    const stroj = String(hod(DATA_SL.idStroje) || '').toUpperCase().trim();
    doklady[psp].polozky.push({
      stroj: stroj,
      nazev: String(hod(DATA_SL.nazevPolozky) || '').trim(),
      lokace: stroj ? (lokace[stroj] || '') : ''
    });
  });

  return Object.keys(doklady).map(psp => doklady[psp]);
}

/** Kolik toho na CS čeká – rychlý přehled do protokolu. */
function prehledCekajicich() {
  const doklady = pspCekajiciNaVydej_();
  const pobocky = {};
  doklady.forEach(d => { pobocky[d.pobocka] = (pobocky[d.pobocka] || 0) + 1; });

  const zpravy = ['Dokladů čekajících na odeslání z CS: ' + doklady.length];
  Object.keys(pobocky).sort().forEach(kod => {
    zpravy.push('  ' + kod + ': ' + pobocky[kod]);
  });

  Logger.log(zpravy.join('\n'));
  return zpravy.join('\n');
}
