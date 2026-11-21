// ============================================================
// Jednorázové nastavení cvičné tabulky + spoušť + testovací data.
// Spouští se RUČNĚ z editoru, v tomhle pořadí:
//   1) nastavTabulku()     – založí listy
//   2) naplnZkusebniZasobu() – vymyšlené stroje na CS (JEN pro zkoušku!)
//   3) nastavSpoust()      – robot začne číst help po 2 minutách
// ============================================================

function nastavTabulku() {
  const ss = tabulka_();

  zalozList_(ss, LIST_ROTACE, [
    'ID požadavku', 'Ticket', 'Přijato', 'Sklad', 'Pobočka',
    'ID stroje požadované', 'PSK', 'Název položky', 'Nakládka plán', 'Stav',
    'ID stroje skutečné', 'Lokace', 'WMS výdej', 'PSP', 'Uzavřeno',
    'Poznámka', 'Režim'
  ]);

  zalozList_(ss, LIST_ZASOBA, [
    'ID stroje', 'PSK', 'Název', 'Sklad', 'Lokace', 'Stav', 'Poslední pohyb'
  ]);

  zalozList_(ss, LIST_LOG, ['Čas', 'Akce', 'Klíč', 'Výsledek', 'Poznámka']);
  zalozList_(ss, LIST_CONTROL, ['Klíč', 'Hodnota']);

  SpreadsheetApp.flush();
  Logger.log('Listy připravené: ' + [LIST_ROTACE, LIST_ZASOBA, LIST_LOG, LIST_CONTROL].join(', '));
}

function zalozList_(ss, nazev, hlavicka) {
  let list = ss.getSheetByName(nazev);
  if (!list) list = ss.insertSheet(nazev);

  if (list.getLastRow() === 0) {
    list.getRange(1, 1, 1, hlavicka.length).setValues([hlavicka])
      .setFontWeight('bold').setBackground('#d9d9d9');
    list.setFrozenRows(1);
  }
  return list;
}

// ------------------------------------------------------------
// Zkušební skladová zásoba
// ------------------------------------------------------------
// ⚠ VYMYŠLENÁ DATA. Skutečnou zásobu dnes nikdo nevede – než se rotace spustí
// doopravdy, musí se na CS udělat inventura skenem. Tohle je jen proto,
// aby šel vyzkoušet celý proces včetně náhradního kusu.

const ZKUSEBNI_STROJE = [
  // PSK, název, [ID strojů]
  ['PSK0090', 'Deska vibrační jednosměrná do 120 kg', ['4XAB', '7K2M', '9QD4']],
  ['PSK0089', 'Deska vibrační reverzní 400-600 kg', ['2HJ8', '5RT1', '8WM3']],
  ['PSK0648', 'Vysavač průmyslový 40-60 l/s', ['3NP7', '6CV2', '1ZB9', '4LK5']],
  ['PSK0402', 'Pěch vibrační 70 kg', ['7DE3', '2YF6', '9GH1']],
  ['PSK0283', 'Laser rotační samonivelační', ['5JQ8', '3MW4', '8TR2']],
  ['PSK0243', 'Kladivo kombi/vrtací 9 kg', ['6BN9', '1XC7']],
  ['PSK0053', 'Bruska na beton pr. 150 mm', ['4VD6', '9SL3', '2PK8']],
  ['PSK0228', 'Kladivo bourací 8 kg', ['7FM1', '3HQ5', '8NW4']],
  ['PSK0224', 'Kladivo bourací 12 kg', ['5CT9', '1DJ2']],
  ['PSK0599', 'Vibrátor ponorný pr. 28 mm AKU', ['6RB7', '2VG3', '9KM8']],
  ['PSK0225', 'Kladivo bourací 15 kg', ['4ZP1', '7LH6']],
  ['PSK0164', 'Fréza drážkovací - pr. 150 mm', ['3WQ2', '8BF5']],
  ['PSK0157', 'Elektrocentrála do 5 kVA', ['1MT4', '6YD9', '2NC7']],
  ['PSK0415', 'Pila rozbrušovací s odsáváním pr. 300 mm', ['9JT9', '5XV3']],
  ['PSK0161', 'Elektrocentrála 5-10 kVA', ['7GS8', '3QL1']],
  ['PSK0060', 'Bruska podlahová víceúčelová pr. 400 mm', ['8DK6', '4HR2']]
];

const ZKUSEBNI_LOKACE = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

function naplnZkusebniZasobu() {
  const list = list_(LIST_ZASOBA);

  if (list.getLastRow() > 1) {
    list.getRange(2, 1, list.getLastRow() - 1, ZS_POCET).clearContent().setBackground(null);
  }

  const radky = [];
  let poradi = 0;

  ZKUSEBNI_STROJE.forEach(([psk, nazev, stroje]) => {
    stroje.forEach((stroj, index) => {
      // Většina na CS2 Úžice, každý čtvrtý kus na CS1 Prostějov.
      const sklad = (poradi % 4 === 3) ? 'S093' : 'S096';
      radky.push([
        stroj, psk, nazev, sklad,
        ZKUSEBNI_LOKACE[poradi % ZKUSEBNI_LOKACE.length],
        ZASOBA_NA_SKLADE, ''
      ]);
      poradi++;
    });
  });

  list.getRange(2, 1, radky.length, ZS_POCET).setValues(radky);

  Logger.log('Zásoba naplněna: ' + radky.length + ' strojů (' +
    radky.filter(r => r[3] === 'S096').length + '× S096, ' +
    radky.filter(r => r[3] === 'S093').length + '× S093).');
}

// ------------------------------------------------------------
// Spoušť
// ------------------------------------------------------------

/**
 * Řekne robotovi „co bylo do téhle chvíle, mě nezajímá".
 *
 * Spustit TĚSNĚ PŘED nastavSpoust(). Bez toho by první běh prohledal celý
 * včerejšek ve vstupní frontě skladu – a to je fronta, kam chodí spousta
 * věcí, které s rotací nemají nic společného.
 */
function zacniTed() {
  nastavControl_('POSLEDNI_KONTROLA', formatDatumCas_(new Date()));
  Logger.log('Robot bude brát jen požadavky vzniklé od ' +
    formatDatumCas_(new Date()) + ' dál.');
}

// ⚠ Apps Script neumí spoušť „po 2 minutách". Povolené hodnoty jsou
// 1, 5, 10, 15 a 30 minut. Bereme tedy 1 minutu – rychleji, než bylo v zadání.
//
// Pozor na denní limit: na běžném účtu je strop 90 minut běhu spouští za den.
// Jedno kolečko je ~2 s (jeden dotaz na helpdesk), takže 1440 běhů ≈ 48 minut.
// Vejde se, ale není kam růst – kdyby se limit začal vyčerpávat,
// přepnout na nastavSpoustUsporna().
function nastavSpoust() {
  zrusSpoust();
  ScriptApp.newTrigger('nactiPozadavky').timeBased().everyMinutes(1).create();
  Logger.log('Spoušť nastavená: nactiPozadavky každou minutu.');
}

/** Šetrnější varianta, když by docházel denní limit spouští. */
function nastavSpoustUsporna() {
  zrusSpoust();
  ScriptApp.newTrigger('nactiPozadavky').timeBased().everyMinutes(5).create();
  Logger.log('Spoušť nastavená: nactiPozadavky každých 5 minut.');
}

function zrusSpoust() {
  ScriptApp.getProjectTriggers().forEach(spoust => {
    if (spoust.getHandlerFunction() === 'nactiPozadavky') ScriptApp.deleteTrigger(spoust);
  });
}

// ------------------------------------------------------------
// Kontroly – spustit, když něco nehraje
// ------------------------------------------------------------

function kontrolaNastaveni() {
  const zpravy = [];

  ['SHEET_ID', 'RT_TOKEN'].forEach(klic => {
    zpravy.push(klic + ': ' + (vlastnost_(klic) ? 'nastaveno' : '❌ CHYBÍ'));
  });
  zpravy.push('ROTACE_SECRET: ' + (vlastnost_('ROTACE_SECRET')
    ? 'nastaveno' : 'zatím ne (vyrobí se samo při prvním přihlášení)'));

  try {
    const ss = tabulka_();
    zpravy.push('Tabulka: ' + ss.getName());
    [LIST_ROTACE, LIST_ZASOBA, LIST_LOG, LIST_CONTROL, LIST_UZIVATELE].forEach(nazev => {
      zpravy.push('List ' + nazev + ': ' + (ss.getSheetByName(nazev) ? 'je' : '❌ chybí'));
    });
    zpravy.push('Strojů v zásobě: ' + Math.max(0, list_(LIST_ZASOBA).getLastRow() - 1));
    zpravy.push('Požadavků: ' + Math.max(0, list_(LIST_ROTACE).getLastRow() - 1));

    try {
      const skladnici = uzivateleVse_().filter(u => u.aktivni !== 'NE');
      Object.keys(SKLADY).forEach(kod => {
        zpravy.push('Skladníků pro ' + kod + ': ' + skladnici.filter(u => u.sklad === kod).length);
      });
      const bezPinu = skladnici.filter(u => !u.pin).length;
      if (bezPinu) zpravy.push('⚠ Skladníků bez PINu: ' + bezPinu + ' – nepřihlásí se');
    } catch (err) {
      zpravy.push('❌ UZIVATELE: ' + err.message + ' → spusť nastavUzivatele()');
    }
  } catch (err) {
    zpravy.push('❌ Tabulka: ' + err.message);
  }

  const spousti = ScriptApp.getProjectTriggers()
    .filter(s => s.getHandlerFunction() === 'nactiPozadavky').length;
  zpravy.push('Spoušť nactiPozadavky: ' + (spousti ? 'běží' : '❌ není'));

  Logger.log(zpravy.join('\n'));
  return zpravy.join('\n');
}

/** Projde rozebrání vzorového požadavku, aniž by se sáhlo na helpdesk. */
function testRozebrani() {
  const vzorek =
    'Dobrý den,\n\n' +
    BLOK_START + '\n' +
    'ID pozadavku: EXR-26-00001\n' +
    'Akce: NOVY\n' +
    'Sklad: S096\n' +
    'Pobocka: P350\n' +
    'ID stroje: 4XAB\n' +
    'PSK: PSK0090\n' +
    'Nazev: Deska vibracni jednosmerna do 120 kg\n' +
    'Nakladka: 2026-11-23 13:00\n' +
    'Odpoved na: pujcovna-sklad@dek.cz\n' +
    'Rezim: TEST\n' +
    BLOK_KONEC + '\n\n' +
    'S pozdravem\nPůjčovna';

  const pole = rozeberPozadavek_(vzorek);
  Logger.log('Rozebráno: ' + JSON.stringify(pole, null, 2));
  Logger.log('Kontrola: ' + (zkontrolujPozadavek_(pole) || 'v pořádku'));
}
