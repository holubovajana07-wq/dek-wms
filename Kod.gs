// ============================================================
// DEK WMS – Google Apps Script backend
// Verze: 2.0 | Pilotní provoz CS2
// ============================================================
// ZMĚNY PROTI v1.0:
//  - ID tabulky se čte z Vlastností skriptu (není v kódu)
//  - lookupStroj vrací SKUTEČNĚ nejnovější záznam (v1 vracel nejstarší)
//  - lookup zohledňuje, jestli je přesun ještě otevřený
//  - přibyla akce "save" přes GET (spolehlivější než POST z prohlížeče)
//  - zápis času jen k danému stroji + jeho příslušenství (ne k celému PSP)
//  - ochrana proti dvojímu zápisu (už přijato / dvojí sken)
//  - LockService – dvě čtečky současně si nepřepíšou řádky
//  - dávkový zápis místo setValue v cyklu
// ============================================================

// ============================================================
// NASTAVENÍ
// ============================================================
// ID tabulky NENÍ v kódu. Nastavte ho jednou takto:
//   Nastavení projektu → Vlastnosti skriptu → Přidat vlastnost
//   Název: SHEET_ID     Hodnota: 1BKvJXEUjrATA9d1ZMvU--DWzLU2X5e6kSlss6NaDWu8
// Nebo spusťte ručně funkci nastavSheetId() níže.

const WMS_CONFIG = {
  pujcovnaList: '2026',
  pohybyList:   'POHYBY',

  // Sdílený token – musí souhlasit s tím, co posílá čtečka.
  // Nastavte ve Vlastnostech skriptu jako WMS_TOKEN.
  // Necháte-li prázdné, kontrola se přeskočí (ale doporučuju nastavit).

  // Sloupce v listu "2026" (1 = A)
  col: {
    zadanoKeSvozu: 1,   // A
    idNakladka:    2,   // B – Z (kód)
    pobNakladka:   3,   // C – Z (místo)
    idVykladka:    4,   // D – DO (kód)
    pobVykladka:   5,   // E – DO (místo)
    cisloPsp:      6,   // F – Číslo PSP
    polozka:       7,   // G – Položka
    pp:            8,   // H – PP
    idStroje:      9,   // I – ID stroje (4 znaky)
    nazevPolozky: 10,   // J – Název položky
    typPresunu:   11,   // K
    pozn:         12,   // L
    ecPuj:        13,   // M
    datumSvozu:   14,   // N
    casPrijmu:    19,   // S – zapisuje WMS
    casVydeje:    20,   // T – zapisuje WMS
  }
};

function getSheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    throw new Error('Chybí SHEET_ID ve Vlastnostech skriptu. Spusťte nastavSheetId().');
  }
  return id;
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('WMS_TOKEN') || '';
}

function getList_(nazev) {
  const ss = SpreadsheetApp.openById(getSheetId_());
  const sheet = ss.getSheetByName(nazev);
  if (!sheet) throw new Error('List "' + nazev + '" nenalezen');
  return sheet;
}

// ============================================================
// VSTUPNÍ BOD – vše přes GET (JSONP)
// ============================================================

function doGet(e) {
  const params   = (e && e.parameter) || {};
  const action   = params.action   || '';
  const callback = params.callback || '';

  let result;
  try {
    // Kontrola sdíleného tokenu (pokud je nastaven)
    const token = getToken_();
    if (token && action !== 'ping' && params.token !== token) {
      result = { chyba: 'Neplatný token' };
      return odpoved_(result, callback);
    }

    if (action === 'lookup') {
      result = lookupStroj(params.id || '', params.akce || '');

    } else if (action === 'lookupPsp') {
      result = lookupPsp(params.psp || '');

    } else if (action === 'save') {
      result = ulozPohyb({
        id:          params.id          || '',
        psp:         params.psp         || '',
        nazev:       params.nazev       || '',
        akce:        params.akce        || '',
        idNakladka:  params.idNakladka  || '',
        pobNakladka: params.pobNakladka || '',
        idVykladka:  params.idVykladka  || '',
        pobVykladka: params.pobVykladka || '',
        lokace:      params.lokace      || '',
        sklad:       params.sklad       || 'CS2',
        cas:         params.cas         || '',
        nonce:       params.nonce       || '',
        prepsat:     params.prepsat === '1',
      });

    } else if (action === 'ping') {
      result = { ok: true, verze: '2.0', cas: new Date().toISOString() };

    } else {
      result = { chyba: 'Neznámá akce: ' + action };
    }

  } catch (err) {
    result = { chyba: err.message };
  }

  return odpoved_(result, callback);
}

function odpoved_(result, callback) {
  const json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// POST necháváme kvůli zpětné kompatibilitě se starou čtečkou
function doPost(e) {
  let result;
  try {
    const data = JSON.parse(e.postData.contents);
    result = (data.action === 'save')
      ? ulozPohyb(data.record)
      : { chyba: 'Neznámá akce' };
  } catch (err) {
    result = { chyba: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// LOOKUP – vyhledá stroj podle ID
// ============================================================
// akce = 'prijem' | 'vydej' | '' (nepovinné)
// Když je zadaná, upřednostní se přesun, který tomu odpovídá:
//   prijem → řádek, kde ještě není čas příjmu
//   vydej  → řádek, kde je příjem, ale není výdej
// ============================================================
function lookupStroj(id, akce) {
  if (!id) return { chyba: 'Chybí ID stroje' };

  const sheet   = getList_(WMS_CONFIG.pujcovnaList);
  const data    = sheet.getDataRange().getValues();
  const c       = WMS_CONFIG.col;
  const hledane = id.toString().trim().toUpperCase();

  // Projdi od konce – radky[0] je tím pádem NEJNOVĚJŠÍ záznam
  const radky = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const radId = (data[i][c.idStroje - 1] || '').toString().trim().toUpperCase();
    if (radId === hledane) radky.push(precistRadek_(data[i], i + 1));
  }

  if (radky.length === 0) {
    return { nalezeno: false, id: hledane, zprava: 'Stroj nenalezen v evidenci půjčovny' };
  }

  // Vyber nejvhodnější řádek podle stavu
  let hlavni = null;
  if (akce === 'prijem') {
    hlavni = radky.find(r => !r.casPrijmu);
  } else if (akce === 'vydej') {
    hlavni = radky.find(r => r.casPrijmu && !r.casVydeje);
  }
  // Nic nesedí → vezmi prostě nejnovější (v1 tady brala NEJSTARŠÍ – to byla chyba)
  if (!hlavni) hlavni = radky[0];

  // Všechny položky na stejném PSP (stroje i příslušenství bez ID)
  const polozky = najdiPolozkyPsp_(data, hlavni.cisloPsp);

  const vysledek = {
    nalezeno:    true,
    id:          hledane,
    radek:       hlavni.radek,
    nazev:       hlavni.nazev,
    cisloPsp:    hlavni.cisloPsp,
    idNakladka:  hlavni.idNakladka,
    pobNakladka: hlavni.pobNakladka,
    idVykladka:  hlavni.idVykladka,
    pobVykladka: hlavni.pobVykladka,
    ecPuj:       hlavni.ecPuj,
    datumSvozu:  hlavni.datumSvozu ? new Date(hlavni.datumSvozu).toISOString() : '',
    casPrijmu:   hlavni.casPrijmu  ? new Date(hlavni.casPrijmu).toISOString()  : '',
    casVydeje:   hlavni.casVydeje  ? new Date(hlavni.casVydeje).toISOString()  : '',
    polozky:     polozky,
    pocetZaznamu: radky.length,
  };

  // Varování pro skladníka – aby nepřepsal něco, co už je hotové
  if (akce === 'prijem' && hlavni.casPrijmu) {
    vysledek.varovani = 'Tento stroj už byl přijat ' + formatCas_(hlavni.casPrijmu);
  } else if (akce === 'vydej' && !hlavni.casPrijmu) {
    vysledek.varovani = 'Pozor: stroj nemá zapsaný příjem na CS2';
  } else if (akce === 'vydej' && hlavni.casVydeje) {
    vysledek.varovani = 'Tento stroj už byl vydán ' + formatCas_(hlavni.casVydeje);
  }

  return vysledek;
}

// ============================================================
// LOOKUP PODLE PSP – pro skenování čárového kódu z dokladu
// ============================================================
function lookupPsp(psp) {
  if (!psp) return { chyba: 'Chybí číslo PSP' };

  const sheet = getList_(WMS_CONFIG.pujcovnaList);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;
  const hledane = psp.toString().trim().toUpperCase();

  const polozky = [];
  let hlavni = null;

  for (let i = 1; i < data.length; i++) {
    const radPsp = (data[i][c.cisloPsp - 1] || '').toString().trim().toUpperCase();
    if (radPsp !== hledane) continue;
    const r = precistRadek_(data[i], i + 1);
    polozky.push(r);
    if (!hlavni) hlavni = r;
  }

  if (!hlavni) {
    return { nalezeno: false, psp: hledane, zprava: 'PSP nenalezeno v evidenci' };
  }

  return {
    nalezeno:    true,
    cisloPsp:    hlavni.cisloPsp,
    idNakladka:  hlavni.idNakladka,
    pobNakladka: hlavni.pobNakladka,
    idVykladka:  hlavni.idVykladka,
    pobVykladka: hlavni.pobVykladka,
    polozky:     polozky,
  };
}

function precistRadek_(radek, cisloRadku) {
  const c = WMS_CONFIG.col;
  return {
    radek:       cisloRadku,
    idNakladka:  radek[c.idNakladka  - 1],
    pobNakladka: radek[c.pobNakladka - 1],
    idVykladka:  radek[c.idVykladka  - 1],
    pobVykladka: radek[c.pobVykladka - 1],
    cisloPsp:    radek[c.cisloPsp    - 1],
    polozka:     radek[c.polozka     - 1],
    pp:          radek[c.pp          - 1],
    idStroje:    radek[c.idStroje    - 1],
    nazev:       radek[c.nazevPolozky- 1],
    ecPuj:       radek[c.ecPuj       - 1],
    datumSvozu:  radek[c.datumSvozu  - 1],
    casPrijmu:   radek[c.casPrijmu   - 1],
    casVydeje:   radek[c.casVydeje   - 1],
  };
}

function najdiPolozkyPsp_(data, psp) {
  const c = WMS_CONFIG.col;
  const hledane = (psp || '').toString().trim().toUpperCase();
  if (!hledane) return [];

  const out = [];
  for (let i = 1; i < data.length; i++) {
    const radPsp = (data[i][c.cisloPsp - 1] || '').toString().trim().toUpperCase();
    if (radPsp !== hledane) continue;
    out.push({
      radek:    i + 1,
      idStroje: data[i][c.idStroje     - 1],
      pp:       data[i][c.pp           - 1],
      polozka:  data[i][c.polozka      - 1],
      nazev:    data[i][c.nazevPolozky - 1],
      ecPuj:    data[i][c.ecPuj        - 1],
    });
  }
  return out;
}

// ============================================================
// ULOŽENÍ POHYBU
// ============================================================
function ulozPohyb(record) {
  if (!record)        return { chyba: 'Chybí data záznamu' };
  if (!record.akce)   return { chyba: 'Chybí akce (prijem/vydej)' };
  if (!record.psp && !record.id) return { chyba: 'Chybí PSP i ID stroje' };

  // Ochrana proti dvojímu odeslání téhož skenu (retry při špatném signálu)
  const cache = CacheService.getScriptCache();
  if (record.nonce) {
    const drive = cache.get('nonce_' + record.nonce);
    if (drive) {
      return { ok: true, duplicita: true, zprava: 'Tento zápis už proběhl' };
    }
  }

  // Zámek – aby si dvě čtečky nepřepsaly řádky
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { chyba: 'Systém je zaneprázdněn, zkuste to za chvíli znovu' };
  }

  try {
    const cas = record.cas ? new Date(record.cas) : new Date();

    // 1) Zapiš čas do hlavní tabulky
    const vysledekCasu = zapisCas_(record.psp, record.id, record.akce, cas, record.prepsat);

    if (vysledekCasu.jizZapsano && !record.prepsat) {
      return {
        ok: false,
        jizZapsano: true,
        cas: formatCas_(vysledekCasu.existujiciCas),
        zprava: (record.akce === 'prijem' ? 'Příjem' : 'Výdej')
                + ' už byl zapsán ' + formatCas_(vysledekCasu.existujiciCas),
      };
    }

    // 2) Zapiš do auditního logu POHYBY
    const radekLogu = zapisDoPohybu_(record, cas, vysledekCasu.zapsanoRadku);

    if (record.nonce) cache.put('nonce_' + record.nonce, '1', 600); // 10 minut

    return {
      ok: true,
      radekLogu:    radekLogu,
      zapsanoRadku: vysledekCasu.zapsanoRadku,
      zprava: (record.akce === 'prijem' ? 'Příjem' : 'Výdej') + ' zapsán ('
              + vysledekCasu.zapsanoRadku + ' řádků)',
    };

  } catch (err) {
    Logger.log('Chyba ulozPohyb: ' + err.message);
    return { chyba: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// ZÁPIS ČASU DO HLAVNÍ TABULKY
// ============================================================
// Zapisuje se POUZE k řádku daného stroje a k příslušenství
// téhož PSP (řádky bez ID stroje). NE k celému PSP jako ve v1 –
// tam se stávalo, že přijely 2 stroje ze 3 a označily se všechny.
// ============================================================
function zapisCas_(psp, idStroje, akce, cas, prepsat) {
  const sheet = getList_(WMS_CONFIG.pujcovnaList);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;

  const sloupec    = (akce === 'prijem') ? c.casPrijmu : c.casVydeje;
  const hledanePsp = (psp || '').toString().trim().toUpperCase();
  const hledanyId  = (idStroje || '').toString().trim().toUpperCase();

  const cileRadky = [];
  let existujiciCas = null;

  for (let i = 1; i < data.length; i++) {
    const radPsp = (data[i][c.cisloPsp - 1] || '').toString().trim().toUpperCase();
    if (radPsp !== hledanePsp) continue;

    const radId = (data[i][c.idStroje - 1] || '').toString().trim().toUpperCase();

    // Bereme: řádek skenovaného stroje + příslušenství (prázdné ID)
    const jeNasStroj      = hledanyId && radId === hledanyId;
    const jePrislusenstvi = !radId;
    if (!jeNasStroj && !jePrislusenstvi) continue;

    // Když sken neměl ID stroje (sken PSP z dokladu), ber všechny řádky PSP
    if (!hledanyId || jeNasStroj || jePrislusenstvi) {
      const stavajici = data[i][sloupec - 1];
      if (stavajici && !existujiciCas) existujiciCas = stavajici;
      cileRadky.push(i + 1);
    }
  }

  if (cileRadky.length === 0) {
    return { zapsanoRadku: 0, jizZapsano: false, zprava: 'Žádný odpovídající řádek' };
  }

  if (existujiciCas && !prepsat) {
    return { zapsanoRadku: 0, jizZapsano: true, existujiciCas: existujiciCas };
  }

  // Dávkový zápis – souvislé bloky řádků najednou (místo setValue v cyklu)
  let zapsano = 0;
  let zacatek = 0;
  while (zacatek < cileRadky.length) {
    let konec = zacatek;
    while (konec + 1 < cileRadky.length && cileRadky[konec + 1] === cileRadky[konec] + 1) {
      konec++;
    }
    const pocet = konec - zacatek + 1;
    const hodnoty = [];
    for (let k = 0; k < pocet; k++) hodnoty.push([cas]);
    sheet.getRange(cileRadky[zacatek], sloupec, pocet, 1).setValues(hodnoty);
    zapsano += pocet;
    zacatek = konec + 1;
  }

  SpreadsheetApp.flush();
  Logger.log('Zapsáno ' + zapsano + ' řádků do sl. ' + (akce === 'prijem' ? 'S' : 'T'));

  return { zapsanoRadku: zapsano, jizZapsano: false };
}

// ============================================================
// AUDITNÍ LOG – list POHYBY
// ============================================================
function zapisDoPohybu_(record, cas, pocetRadku) {
  const ss = SpreadsheetApp.openById(getSheetId_());
  let sheet = ss.getSheetByName(WMS_CONFIG.pohybyList);

  if (!sheet) {
    sheet = ss.insertSheet(WMS_CONFIG.pohybyList);
    sheet.appendRow([
      'Čas', 'ID stroje', 'Název', 'PSP', 'Akce',
      'Pobočka odkud (kód)', 'Pobočka odkud',
      'Pobočka kam (kód)', 'Pobočka kam',
      'Lokace CS2', 'Sklad', 'Řádků', 'Zapsáno'
    ]);
    sheet.getRange(1, 1, 1, 13)
      .setBackground('#C8281A').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(4, 180);
  }

  const akceText = record.akce === 'prijem' ? 'PŘÍJEM na CS2' : 'VÝDEJ z CS2';

  sheet.appendRow([
    cas,
    record.id          || '',
    record.nazev       || '',
    record.psp         || '',
    akceText,
    record.idNakladka  || '',
    record.pobNakladka || '',
    record.idVykladka  || '',
    record.pobVykladka || '',
    record.lokace      || '',
    record.sklad       || 'CS2',
    pocetRadku         || 0,
    new Date(),
  ]);

  return sheet.getLastRow();
}

function formatCas_(cas) {
  if (!cas) return '';
  return Utilities.formatDate(new Date(cas), Session.getScriptTimeZone(), 'd.M.yyyy HH:mm');
}

// ============================================================
// JEDNORÁZOVÉ NASTAVENÍ – spusťte ručně v editoru
// ============================================================

function nastavSheetId() {
  // ⬇ SEM vložte ID vaší tabulky, spusťte jednou, pak řádek zase vymažte
  const ID = 'SEM_VLOZTE_ID_TABULKY';
  if (ID === 'SEM_VLOZTE_ID_TABULKY') {
    throw new Error('Nejdřív do funkce vložte skutečné ID tabulky.');
  }
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ID);
  Logger.log('SHEET_ID nastaveno.');
}

function nastavToken() {
  // Vymyslete si libovolné heslo, např. 'dek-cs2-2026-xK9pQ'
  const TOKEN = 'SEM_VLOZTE_TOKEN';
  if (TOKEN === 'SEM_VLOZTE_TOKEN') {
    throw new Error('Nejdřív do funkce vložte token.');
  }
  PropertiesService.getScriptProperties().setProperty('WMS_TOKEN', TOKEN);
  Logger.log('WMS_TOKEN nastaven. Stejný token zadejte v nastavení čtečky.');
}

// ============================================================
// DIAGNOSTIKA – spusťte při podezření, že něco nesedí
// ============================================================

function overSloupce() {
  const sheet = getList_(WMS_CONFIG.pujcovnaList);
  const hlavicka = sheet.getRange(1, 1, 1, 20).getValues()[0];
  Logger.log('Počet řádků: ' + sheet.getLastRow());
  Logger.log('--- Hlavička podle sloupců ---');
  const c = WMS_CONFIG.col;
  Object.keys(c).forEach(klic => {
    const idx = c[klic] - 1;
    const pismeno = String.fromCharCode(65 + idx);
    Logger.log(pismeno + ' (' + c[klic] + ') ' + klic + ' → "' + (hlavicka[idx] || '(prázdné)') + '"');
  });
  Logger.log('POZOR: zkontrolujte, že názvy vpravo odpovídají tomu, co čekáte.');
}

function testLookup() {
  Logger.log(JSON.stringify(lookupStroj('9JT9', 'prijem'), null, 2));
}

function testPing() {
  Logger.log(JSON.stringify(doGet({ parameter: { action: 'ping' } }).getContent()));
}
