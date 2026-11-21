// ============================================================
// Chytrá rotace – robot. Samostatný projekt, NESAHÁ na ostrý provoz.
// ============================================================
// Vlastnosti skriptu (Nastavení projektu → Vlastnosti skriptu):
//   SHEET_ID       ID cvičné tabulky Půjčovna
//   RT_TOKEN       token do helpdesku (zkopírovat z projektu Půjčovna_skript)
//   ROTACE_TOKEN   heslo, které musí poslat čtečka (vymyslet libovolné)
// ============================================================

const RT_BASE_URL = 'https://helpdesk.dek.cz';

// Fronta, do které požadavek spadne jako první. Robot z ní jen ČTE a sahá
// výhradně na ticketky, které mají v předmětu ROTACE a v těle náš blok.
// Všechno ostatní v té frontě patří kolegům a nesmíme se toho dotknout.
const RT_FRONTA_VSTUP = 'Centralni sklad 1 - Uzice S095';

// Fronta, kam robot požadavek přehodí, aby nezacláněl v hlavní frontě.
// Dokud neexistuje, přesun se neprovede a jen se zapíše do logu.
const RT_FRONTA_ROTACE = 'Rotace stroju CS';

// Předmět, podle kterého robot pozná svoje ticketky.
const PREDMET_KLIC = 'ROTACE';

// Kolik ticketů nanejvýš projít v jednom běhu. Vstupní fronta je rušná a na
// každý ticket je potřeba jeden dotaz navíc; Apps Script má na běh 6 minut.
const MAX_TICKETU_NA_BEH = 30;

// Značky bloku v těle požadavku.
const BLOK_START = '### POZADAVEK ROTACE v1';
const BLOK_KONEC = '### KONEC';

const LIST_ROTACE = 'ROTACE';
const LIST_ZASOBA = 'ZASOBA_CS';
const LIST_LOG = 'ROTACE_LOG';
const LIST_CONTROL = 'ROTACE_CONTROL';

// Stavy řádku v listu ROTACE
const STAV_NOVY = 'nový';
const STAV_K_VYDEJI = 'k výdeji';
const STAV_NALOZENO = 'naloženo (čeká PSP)';
const STAV_UZAVRENO = 'uzavřeno';
const STAV_ZRUSENO = 'zrušeno';
const STAV_NESPLNENO = 'nesplněno';

const SKLADY = { S096: 'CS2 Úžice', S093: 'CS1 Prostějov' };

function vlastnost_(klic) {
  return PropertiesService.getScriptProperties().getProperty(klic) || '';
}

function tabulka_() {
  const id = vlastnost_('SHEET_ID');
  if (!id) throw new Error('Chybí vlastnost skriptu SHEET_ID.');
  return SpreadsheetApp.openById(id);
}

function list_(nazev) {
  const list = tabulka_().getSheetByName(nazev);
  if (!list) throw new Error('V tabulce chybí list ' + nazev + '. Spusť nastavTabulku().');
  return list;
}

function log_(akce, klic, vysledek, poznamka) {
  try {
    list_(LIST_LOG).appendRow([new Date(), akce, klic || '', vysledek || '', poznamka || '']);
  } catch (err) {
    Logger.log('LOG selhal: ' + err.message);
  }
}

function hodnotaControl_(klic) {
  const list = list_(LIST_CONTROL);
  const posledni = list.getLastRow();
  if (posledni < 1) return '';
  const hodnoty = list.getRange(1, 1, posledni, 2).getValues();
  for (const radek of hodnoty) if (radek[0] === klic) return radek[1];
  return '';
}

function nastavControl_(klic, hodnota) {
  const list = list_(LIST_CONTROL);
  const posledni = list.getLastRow();
  if (posledni >= 1) {
    const hodnoty = list.getRange(1, 1, posledni, 2).getValues();
    for (let i = 0; i < hodnoty.length; i++) {
      if (hodnoty[i][0] === klic) {
        list.getRange(i + 1, 2).setValue(hodnota);
        return;
      }
    }
  }
  list.appendRow([klic, hodnota]);
}

function formatDatumCas_(datum) {
  return Utilities.formatDate(datum, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Čas nakládky pro čtečku, vždy jako `RRRR-MM-DD HH:MM`.
 *
 * Do tabulky se zapisuje text, ale Sheets si ho převede na datum. Při čtení
 * pak vyleze objekt Date a prosté String() z něj udělá „Mon Nov 23 2026…",
 * což skladníkovi nic neřekne. Proto se formátuje tady, na jednom místě.
 */
function formatNakladku_(hodnota) {
  if (hodnota instanceof Date) {
    return Utilities.formatDate(hodnota, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }
  return String(hodnota || '').trim();
}
