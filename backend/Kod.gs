// ============================================================
// DEK WMS – Google Apps Script backend
// Verze: 3.0 | Pilotní provoz CS2
// ============================================================
// Pracuje nad listem DATA (databáze PSP).
// Časy zapisuje do VLASTNÍCH sloupců "WMS příjem" / "WMS výdej",
// které si sám založí na konci listu. Existující sloupce
// "Datum svezeno na CS" a "Datum odesláno z CS" needituje –
// ty patří jiné automatizaci.
// ============================================================

const WMS_CONFIG = {
  dataList:   'DATA',
  pohybyList: 'POHYBY',

  // Názvy sloupců, které si WMS založí (hledají se podle názvu,
  // takže je jedno, na které pozici skončí)
  wmsPrijemNazev: 'WMS příjem',
  wmsVydejNazev:  'WMS výdej',

  // Sloupce v listu DATA (1 = A)
  col: {
    idNakladka:    2,   // B – ID nakládka
    pobNakladka:   3,   // C – Pobočka nakládka
    idVykladka:    4,   // D – ID vykládka
    pobVykladka:   5,   // E – Pobočka vykládka
    cisloPsp:      6,   // F – Číslo PSP
    ecPuj:         7,   // G – E.Č. PUJ
    polozka:       8,   // H – Položka
    idStroje:      9,   // I – ID (ID stroje); prázdné = příslušenství
    vc:           10,   // J – VČ
    nazevPolozky: 11,   // K – Název položky
    vystavil:     14,   // N – Vystavil
    datumSvozu:   17,   // Q – Datum svozu
    svezenoNaCS:  18,   // R – Datum svezeno na CS   (JEN ČTEME)
    odeslanoZCS:  19,   // S – Datum odesláno z CS   (JEN ČTEME)
    poznamka:     25,   // Y – Poznámka
    storno:       31,   // AE – Storno
  }
};

function getSheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Chybí SHEET_ID ve Vlastnostech skriptu. Spusťte nastavSheetId().');
  return id;
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('WMS_TOKEN') || '';
}

function getList_(nazev) {
  const sheet = SpreadsheetApp.openById(getSheetId_()).getSheetByName(nazev);
  if (!sheet) throw new Error('List "' + nazev + '" nenalezen');
  return sheet;
}

// ============================================================
// SLOUPCE WMS – najdi je, nebo je založ na konci listu
// ============================================================
function wmsSloupce_(sheet) {
  const sirka    = Math.max(sheet.getLastColumn(), 1);
  const hlavicka = sheet.getRange(1, 1, 1, sirka).getValues()[0];

  function najdi(nazev) {
    const hledany = nazev.trim().toLowerCase();
    for (let i = 0; i < hlavicka.length; i++) {
      if (String(hlavicka[i] || '').trim().toLowerCase() === hledany) return i + 1;
    }
    return 0;
  }

  let prijem = najdi(WMS_CONFIG.wmsPrijemNazev);
  let vydej  = najdi(WMS_CONFIG.wmsVydejNazev);
  let dalsi  = sirka + 1;
  let zalozeno = false;

  if (!prijem) {
    prijem = dalsi++;
    sheet.getRange(1, prijem).setValue(WMS_CONFIG.wmsPrijemNazev).setFontWeight('bold');
    zalozeno = true;
  }
  if (!vydej) {
    vydej = dalsi++;
    sheet.getRange(1, vydej).setValue(WMS_CONFIG.wmsVydejNazev).setFontWeight('bold');
    zalozeno = true;
  }
  if (zalozeno) {
    SpreadsheetApp.flush();
    Logger.log('Založeny sloupce WMS: příjem=' + pismenoSloupce_(prijem) + ', výdej=' + pismenoSloupce_(vydej));
  }

  return { prijem: prijem, vydej: vydej };
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
    const token = getToken_();
    if (token && action !== 'ping' && params.token !== token) {
      return odpoved_({ chyba: 'Neplatný token' }, callback);
    }

    if (action === 'lookup') {
      result = lookupStroj(params.id || '', params.akce || '');

    } else if (action === 'lookupPsp') {
      result = lookupPsp(params.psp || '');

    } else if (action === 'seznamKVydeji') {
      result = getSeznamKVydeje();

    } else if (action === 'save') {
      result = ulozPohyb({
        id:          params.id          || '',
        psp:         params.psp         || '',
        nazev:       params.nazev       || '',
        ecPuj:       params.ecPuj       || '',
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
      result = { ok: true, verze: '3.0', list: WMS_CONFIG.dataList, cas: new Date().toISOString() };

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
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const data = JSON.parse(e.postData.contents);
    result = (data.action === 'save') ? ulozPohyb(data.record) : { chyba: 'Neznámá akce' };
  } catch (err) {
    result = { chyba: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// LOOKUP – vyhledá stroj podle ID
// ============================================================
function lookupStroj(id, akce) {
  if (!id) return { chyba: 'Chybí ID stroje' };

  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;
  const hledane = id.toString().trim().toUpperCase();

  // Od konce – radky[0] je nejnovější záznam
  const radky = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const radId = (data[i][c.idStroje - 1] || '').toString().trim().toUpperCase();
    if (radId === hledane) radky.push(precistRadek_(data[i], i + 1, wms));
  }

  if (radky.length === 0) {
    return { nalezeno: false, id: hledane, zprava: 'Stroj nenalezen v databázi PSP' };
  }

  // Vyber přesun, který odpovídá akci
  let hlavni = null;
  if (akce === 'prijem') {
    hlavni = radky.filter(function (r) { return !r.wmsPrijem && !r.storno; })[0];
  } else if (akce === 'vydej') {
    hlavni = radky.filter(function (r) { return r.wmsPrijem && !r.wmsVydej && !r.storno; })[0];
    if (!hlavni) hlavni = radky.filter(function (r) { return r.svezenoNaCS && !r.wmsVydej && !r.odeslanoZCS && !r.storno; })[0];
  }
  if (!hlavni) hlavni = radky[0];

  const polozky = najdiPolozkyPsp_(data, hlavni.cisloPsp, wms);

  const vysledek = {
    nalezeno:     true,
    id:           hledane,
    radek:        hlavni.radek,
    nazev:        hlavni.nazev,
    cisloPsp:     hlavni.cisloPsp,
    idNakladka:   hlavni.idNakladka,
    pobNakladka:  hlavni.pobNakladka,
    idVykladka:   hlavni.idVykladka,
    pobVykladka:  hlavni.pobVykladka,
    ecPuj:        hlavni.ecPuj,
    datumSvozu:   naIso_(hlavni.datumSvozu),
    casPrijmu:    naIso_(hlavni.wmsPrijem),
    casVydeje:    naIso_(hlavni.wmsVydej),
    svezenoNaCS:  naIso_(hlavni.svezenoNaCS),
    odeslanoZCS:  naIso_(hlavni.odeslanoZCS),
    polozky:      polozky,
    pocetZaznamu: radky.length,
  };

  if (hlavni.storno) {
    vysledek.varovani = 'POZOR: tento přesun je označen jako STORNO';
  } else if (akce === 'prijem' && hlavni.wmsPrijem) {
    vysledek.varovani = 'Tento stroj už byl přijat ' + formatCas_(hlavni.wmsPrijem);
  } else if (akce === 'vydej' && !hlavni.wmsPrijem && !hlavni.svezenoNaCS) {
    vysledek.varovani = 'Pozor: stroj nemá zapsaný příjem na CS2';
  } else if (akce === 'vydej' && hlavni.wmsVydej) {
    vysledek.varovani = 'Tento stroj už byl vydán ' + formatCas_(hlavni.wmsVydej);
  }

  return vysledek;
}

// ============================================================
// LOOKUP PODLE PSP – sken čárového kódu z papírového dokladu
// ============================================================
function lookupPsp(psp) {
  if (!psp) return { chyba: 'Chybí číslo PSP' };

  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;
  const hledane = psp.toString().trim().toUpperCase();

  const polozky = [];
  let hlavni = null;

  for (let i = 1; i < data.length; i++) {
    const radPsp = (data[i][c.cisloPsp - 1] || '').toString().trim().toUpperCase();
    if (radPsp !== hledane) continue;
    const r = precistRadek_(data[i], i + 1, wms);
    polozky.push(r);
    if (!hlavni) hlavni = r;
  }

  if (!hlavni) return { nalezeno: false, psp: hledane, zprava: 'PSP nenalezeno v databázi' };

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

// ============================================================
// SEZNAM K VÝDEJI – počítá se ŽIVĚ z listu DATA
// ============================================================
// Záměrně NEČTE list LOGISTIK-výdej: ten je snímek pořízený
// ručním kliknutím na "aktualizuj listy". Kdyby z něj výdej
// vycházel, dva skladníci by mohli vydat totéž PSP dvakrát.
// ============================================================
function getSeznamKVydeje() {
  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;

  const pobocky = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[c.storno - 1]) continue;

    const prijato  = r[wms.prijem - 1] || r[c.svezenoNaCS - 1];
    const vydano   = r[wms.vydej - 1]  || r[c.odeslanoZCS - 1];
    if (!prijato || vydano) continue;

    const psp = (r[c.cisloPsp - 1] || '').toString().trim();
    if (!psp) continue;

    const kod   = (r[c.idVykladka - 1]  || '').toString().trim() || '???';
    const nazev = (r[c.pobVykladka - 1] || '').toString().trim() || 'Neznámá pobočka';

    if (!pobocky[kod]) pobocky[kod] = { kod: kod, nazev: nazev, psp: {} };
    if (!pobocky[kod].psp[psp]) {
      pobocky[kod].psp[psp] = { cisloPsp: psp, datumPrijmu: naIso_(prijato), polozky: [] };
    }
    pobocky[kod].psp[psp].polozky.push({
      radek:    i + 1,
      idStroje: r[c.idStroje - 1],
      nazev:    r[c.nazevPolozky - 1],
      ecPuj:    r[c.ecPuj - 1],
    });
  }

  const out = Object.keys(pobocky).map(function (kod) {
    const p = pobocky[kod];
    const pspList = Object.keys(p.psp).map(function (k) { return p.psp[k]; });
    return { kod: p.kod, nazev: p.nazev, pocetPsp: pspList.length, pspList: pspList };
  });

  out.sort(function (a, b) { return a.nazev.localeCompare(b.nazev, 'cs'); });

  return { ok: true, pobocky: out, celkemPsp: out.reduce(function (s, p) { return s + p.pocetPsp; }, 0) };
}

// ============================================================
// POMOCNÉ ČTENÍ ŘÁDKU
// ============================================================
function precistRadek_(radek, cisloRadku, wms) {
  const c = WMS_CONFIG.col;
  return {
    radek:       cisloRadku,
    idNakladka:  radek[c.idNakladka   - 1],
    pobNakladka: radek[c.pobNakladka  - 1],
    idVykladka:  radek[c.idVykladka   - 1],
    pobVykladka: radek[c.pobVykladka  - 1],
    cisloPsp:    radek[c.cisloPsp     - 1],
    ecPuj:       radek[c.ecPuj        - 1],
    polozka:     radek[c.polozka      - 1],
    idStroje:    radek[c.idStroje     - 1],
    nazev:       radek[c.nazevPolozky - 1],
    datumSvozu:  radek[c.datumSvozu   - 1],
    svezenoNaCS: radek[c.svezenoNaCS  - 1],
    odeslanoZCS: radek[c.odeslanoZCS  - 1],
    storno:      radek[c.storno       - 1],
    wmsPrijem:   radek[wms.prijem     - 1],
    wmsVydej:    radek[wms.vydej      - 1],
  };
}

function najdiPolozkyPsp_(data, psp, wms) {
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
      pp:       data[i][c.polozka      - 1],
      polozka:  data[i][c.ecPuj        - 1],
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
  if (!record)      return { ok: false, chyba: 'Chybí data záznamu' };
  if (!record.akce) return { ok: false, chyba: 'Chybí akce (prijem/vydej)' };
  if (!record.psp && !record.id) return { ok: false, chyba: 'Chybí PSP i ID stroje' };

  const cache = CacheService.getScriptCache();
  if (record.nonce && cache.get('nonce_' + record.nonce)) {
    return { ok: true, duplicita: true, zprava: 'Tento zápis už proběhl' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, chyba: 'Systém je zaneprázdněn, zkuste to za chvíli znovu' };
  }

  try {
    const cas = record.cas ? new Date(record.cas) : new Date();
    const vysledek = zapisCas_(record.psp, record.id, record.akce, cas, record.prepsat);

    if (vysledek.jizZapsano && !record.prepsat) {
      return {
        ok: false,
        jizZapsano: true,
        cas: formatCas_(vysledek.existujiciCas),
        zprava: (record.akce === 'prijem' ? 'Příjem' : 'Výdej')
                + ' už byl zapsán ' + formatCas_(vysledek.existujiciCas),
      };
    }

    if (vysledek.zapsanoRadku === 0) {
      return { ok: false, chyba: 'Nenašel jsem řádek k zápisu (PSP ' + record.psp + ')' };
    }

    const radekLogu = zapisDoPohybu_(record, cas, vysledek.zapsanoRadku);
    if (record.nonce) cache.put('nonce_' + record.nonce, '1', 600);

    return {
      ok:           true,
      radekLogu:    radekLogu,
      zapsanoRadku: vysledek.zapsanoRadku,
      zprava: (record.akce === 'prijem' ? 'Příjem' : 'Výdej')
              + ' zapsán (' + vysledek.zapsanoRadku + ' řádků)',
    };

  } catch (err) {
    Logger.log('Chyba ulozPohyb: ' + err.message);
    return { ok: false, chyba: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// ZÁPIS ČASU do sloupců WMS
// ============================================================
// Zapisuje POUZE k řádku daného stroje a k příslušenství téhož
// PSP (řádky bez ID stroje). Ne k celému PSP – když přijedou
// 2 stroje ze 3, nesmí se označit všechny tři.
// ============================================================
function zapisCas_(psp, idStroje, akce, cas, prepsat) {
  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;

  const sloupec    = (akce === 'prijem') ? wms.prijem : wms.vydej;
  const hledanePsp = (psp || '').toString().trim().toUpperCase();
  const hledanyId  = (idStroje || '').toString().trim().toUpperCase();

  const cileRadky = [];
  let existujiciCas = null;

  for (let i = 1; i < data.length; i++) {
    const radPsp = (data[i][c.cisloPsp - 1] || '').toString().trim().toUpperCase();
    if (radPsp !== hledanePsp) continue;

    const radId = (data[i][c.idStroje - 1] || '').toString().trim().toUpperCase();

    // Bez ID stroje (sken PSP z dokladu) bereme všechny řádky PSP
    if (hledanyId) {
      const jeNasStroj      = (radId === hledanyId);
      const jePrislusenstvi = !radId;
      if (!jeNasStroj && !jePrislusenstvi) continue;
    }

    const stavajici = data[i][sloupec - 1];
    if (stavajici && !existujiciCas) existujiciCas = stavajici;
    cileRadky.push(i + 1);
  }

  if (cileRadky.length === 0) return { zapsanoRadku: 0, jizZapsano: false };
  if (existujiciCas && !prepsat) {
    return { zapsanoRadku: 0, jizZapsano: true, existujiciCas: existujiciCas };
  }

  // Dávkový zápis souvislých bloků
  let zapsano = 0;
  let zacatek = 0;
  while (zacatek < cileRadky.length) {
    let konec = zacatek;
    while (konec + 1 < cileRadky.length && cileRadky[konec + 1] === cileRadky[konec] + 1) konec++;
    const pocet   = konec - zacatek + 1;
    const hodnoty = [];
    for (let k = 0; k < pocet; k++) hodnoty.push([cas]);
    sheet.getRange(cileRadky[zacatek], sloupec, pocet, 1).setValues(hodnoty);
    zapsano += pocet;
    zacatek = konec + 1;
  }

  SpreadsheetApp.flush();
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
      'Čas', 'ID stroje', 'Název', 'PSP', 'E.Č. PUJ', 'Akce',
      'Pobočka odkud (kód)', 'Pobočka odkud',
      'Pobočka kam (kód)', 'Pobočka kam',
      'Lokace CS2', 'Sklad', 'Řádků', 'Zapsáno'
    ]);
    sheet.getRange(1, 1, 1, 14)
      .setBackground('#C8281A').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(4, 180);
  }

  const akceText = record.akce === 'prijem' ? 'PŘÍJEM na CS2' : 'VÝDEJ z CS2';

  // Řádek se skládá PODLE EXISTUJÍCÍ HLAVIČKY, ne napevno –
  // list POHYBY už v tabulce může být s jiným pořadím sloupců.
  const hodnoty = {
    'čas':                 cas,
    'id stroje':           record.id          || '',
    'název':               record.nazev       || '',
    'psp':                 record.psp         || '',
    'e.č. puj':            record.ecPuj       || '',
    'akce':                akceText,
    'pobočka odkud (kód)': record.idNakladka  || '',
    'pobočka odkud':       record.pobNakladka || '',
    'pobočka kam (kód)':   record.idVykladka  || '',
    'pobočka kam':         record.pobVykladka || '',
    'lokace cs2':          record.lokace      || '',
    'sklad':               record.sklad       || 'CS2',
    'řádků':               pocetRadku         || 0,
    'zapsáno':             new Date(),
  };

  const sirka    = Math.max(sheet.getLastColumn(), 1);
  const hlavicka = sheet.getRange(1, 1, 1, sirka).getValues()[0];
  const radek = hlavicka.map(function (nadpis) {
    const klic = String(nadpis || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(hodnoty, klic) ? hodnoty[klic] : '';
  });

  sheet.appendRow(radek);
  return sheet.getLastRow();
}

// ============================================================
// DROBNOSTI
// ============================================================
function naIso_(v) {
  if (!v) return '';
  try { return new Date(v).toISOString(); } catch (e) { return ''; }
}

function formatCas_(cas) {
  if (!cas) return '';
  return Utilities.formatDate(new Date(cas), Session.getScriptTimeZone(), 'd.M.yyyy HH:mm');
}

function pismenoSloupce_(cislo) {
  let s = '';
  while (cislo > 0) {
    const zbytek = (cislo - 1) % 26;
    s = String.fromCharCode(65 + zbytek) + s;
    cislo = Math.floor((cislo - zbytek) / 26);
  }
  return s;
}

// ============================================================
// JEDNORÁZOVÉ NASTAVENÍ
// ============================================================
function nastavSheetId() {
  const ID = 'SEM_VLOZTE_ID_TABULKY';
  if (ID === 'SEM_VLOZTE_ID_TABULKY') throw new Error('Nejdřív do funkce vložte skutečné ID tabulky.');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ID);
  Logger.log('SHEET_ID nastaveno.');
}

function nastavToken() {
  const TOKEN = 'SEM_VLOZTE_TOKEN';
  if (TOKEN === 'SEM_VLOZTE_TOKEN') throw new Error('Nejdřív do funkce vložte token.');
  PropertiesService.getScriptProperties().setProperty('WMS_TOKEN', TOKEN);
  Logger.log('WMS_TOKEN nastaven. Stejný token zadejte v nastavení čtečky.');
}

// ============================================================
// DIAGNOSTIKA
// ============================================================

// Založí sloupce WMS a řekne, kde skončily. Spusťte jako první.
function pripravSloupce() {
  const sheet = getList_(WMS_CONFIG.dataList);
  const wms = wmsSloupce_(sheet);
  Logger.log('List: ' + WMS_CONFIG.dataList + ' (' + sheet.getLastRow() + ' řádků)');
  Logger.log('WMS příjem → sloupec ' + pismenoSloupce_(wms.prijem) + ' (' + wms.prijem + ')');
  Logger.log('WMS výdej  → sloupec ' + pismenoSloupce_(wms.vydej)  + ' (' + wms.vydej  + ')');
}

function overSloupce() {
  const sheet = getList_(WMS_CONFIG.dataList);
  const wms = wmsSloupce_(sheet);
  const hlavicka = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('Počet řádků: ' + sheet.getLastRow());
  const c = WMS_CONFIG.col;
  Object.keys(c).forEach(function (klic) {
    const idx = c[klic] - 1;
    Logger.log(pismenoSloupce_(c[klic]) + '  ' + klic + '  →  "' + (hlavicka[idx] || '(prázdné)') + '"');
  });
  Logger.log('WMS příjem → ' + pismenoSloupce_(wms.prijem) + ', WMS výdej → ' + pismenoSloupce_(wms.vydej));
}

// Vypíše stroje, na kterých jde vyzkoušet příjem (sloupec WMS příjem prázdný)
function najdiTestovaciStroj() {
  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;

  Logger.log('--- Stroje vhodné k testu PŘÍJMU ---');
  let nalezeno = 0;
  for (let i = data.length - 1; i >= 1 && nalezeno < 5; i--) {
    const id = (data[i][c.idStroje - 1] || '').toString().trim();
    if (!id) continue;
    if (data[i][wms.prijem - 1]) continue;
    if (data[i][c.storno - 1]) continue;

    Logger.log('ID: ' + id +
      '  |  PSP: ' + data[i][c.cisloPsp - 1] +
      '  |  ' + data[i][c.nazevPolozky - 1] +
      '  |  řádek ' + (i + 1));
    nalezeno++;
  }
  if (nalezeno === 0) Logger.log('Žádný takový stroj.');
}

function testSeznamKVydeji() {
  const v = getSeznamKVydeje();
  Logger.log('Poboček: ' + v.pobocky.length + ', PSP celkem: ' + v.celkemPsp);
  v.pobocky.slice(0, 10).forEach(function (p) {
    Logger.log(p.kod + ' ' + p.nazev + ' → ' + p.pocetPsp + ' PSP');
  });
}

// Porovná živý výpočet getSeznamKVydeje() se snímkem v listu LOGISTIK-výdej.
// Slouží k ověření, že "je na skladě" počítáme stejně jako logistický přehled.
// Rozdíly jsou očekávané (snímek se obnovuje ručně), ale mají být malé.
function porovnejSVydejem() {
  const ss = SpreadsheetApp.openById(getSheetId_());
  const snimek = ss.getSheetByName('LOGISTIK-výdej');
  if (!snimek) { Logger.log('List LOGISTIK-výdej neexistuje.'); return; }

  const data = snimek.getDataRange().getValues();

  // Najdi řádek hlavičky a v něm sloupec "Číslo PSP"
  let radekHlavicky = -1, sloupecPsp = -1;
  for (let r = 0; r < Math.min(data.length, 6); r++) {
    for (let s = 0; s < data[r].length; s++) {
      if (String(data[r][s] || '').trim().toLowerCase() === 'číslo psp') {
        radekHlavicky = r; sloupecPsp = s; break;
      }
    }
    if (sloupecPsp >= 0) break;
  }
  if (sloupecPsp < 0) { Logger.log('Ve snímku jsem nenašel sloupec "Číslo PSP".'); return; }

  const veSnimku = {};
  for (let r = radekHlavicky + 1; r < data.length; r++) {
    const psp = String(data[r][sloupecPsp] || '').trim();
    if (psp) veSnimku[psp] = true;
  }

  const zivy = {};
  getSeznamKVydeje().pobocky.forEach(function (p) {
    p.pspList.forEach(function (x) { zivy[String(x.cisloPsp).trim()] = true; });
  });

  const jenZivy  = Object.keys(zivy).filter(function (p) { return !veSnimku[p]; });
  const jenSnimek = Object.keys(veSnimku).filter(function (p) { return !zivy[p]; });

  Logger.log('Živý výpočet: ' + Object.keys(zivy).length + ' PSP');
  Logger.log('Snímek LOGISTIK-výdej: ' + Object.keys(veSnimku).length + ' PSP');
  Logger.log('');
  Logger.log('--- Vidí jen WMS (ve snímku chybí) ---');
  Logger.log(jenZivy.length ? jenZivy.join(', ') : '(žádné)');
  Logger.log('');
  Logger.log('--- Vidí jen snímek (WMS je nebere jako čekající) ---');
  Logger.log(jenSnimek.length ? jenSnimek.join(', ') : '(žádné)');
  Logger.log('');
  Logger.log('U rozdílů si v listu DATA ověřte sloupce R, S, AE (Storno).');
}

// Pro PSP, která vidí jen snímek LOGISTIK-výdej, vypíše skutečný obsah
// rozhodujících sloupců v DATA – ať je vidět, PROČ je WMS nebere jako čekající.
function zkontrolujRozdily() {
  const ss     = SpreadsheetApp.openById(getSheetId_());
  const snimek = ss.getSheetByName('LOGISTIK-výdej');
  if (!snimek) { Logger.log('List LOGISTIK-výdej neexistuje.'); return; }

  const sData = snimek.getDataRange().getValues();
  let rh = -1, sp = -1;
  for (let r = 0; r < Math.min(sData.length, 6); r++) {
    for (let s = 0; s < sData[r].length; s++) {
      if (String(sData[r][s] || '').trim().toLowerCase() === 'číslo psp') { rh = r; sp = s; break; }
    }
    if (sp >= 0) break;
  }
  if (sp < 0) { Logger.log('Sloupec "Číslo PSP" ve snímku nenalezen.'); return; }

  const veSnimku = [];
  for (let r = rh + 1; r < sData.length; r++) {
    const psp = String(sData[r][sp] || '').trim();
    if (psp && veSnimku.indexOf(psp) < 0) veSnimku.push(psp);
  }

  const zivy = {};
  getSeznamKVydeje().pobocky.forEach(function (p) {
    p.pspList.forEach(function (x) { zivy[String(x.cisloPsp).trim()] = true; });
  });

  const sporne = veSnimku.filter(function (p) { return !zivy[p]; });
  if (!sporne.length) { Logger.log('Žádné sporné PSP – seznamy se shodují.'); return; }

  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const data  = sheet.getDataRange().getValues();
  const c     = WMS_CONFIG.col;

  sporne.forEach(function (psp) {
    Logger.log('═══ ' + psp + ' ═══');
    let nasel = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c.cisloPsp - 1] || '').trim() !== psp) continue;
      nasel = true;
      const r = data[i];
      Logger.log(
        'řádek ' + (i + 1) +
        ' | ID: '        + (r[c.idStroje - 1]    || '—') +
        ' | R svezeno: ' + (r[c.svezenoNaCS - 1] ? formatCas_(r[c.svezenoNaCS - 1]) : 'PRÁZDNÉ') +
        ' | S odesláno: '+ (r[c.odeslanoZCS - 1] ? formatCas_(r[c.odeslanoZCS - 1]) : 'prázdné') +
        ' | Storno: '    + (r[c.storno - 1]      || '—') +
        ' | WMS příjem: '+ (r[wms.prijem - 1]    || '—') +
        ' | WMS výdej: ' + (r[wms.vydej - 1]     || '—')
      );
    }
    if (!nasel) Logger.log('  V listu DATA vůbec není!');
    Logger.log('');
  });
}

// Mapovací nástroje (ponechány pro diagnostiku struktury)
function zmapujData() { zmapujJedenList_('DATA'); }

function zmapujJedenList_(nazevListu) {
  const sheet = SpreadsheetApp.openById(getSheetId_()).getSheetByName(nazevListu);
  if (!sheet) { Logger.log('List "' + nazevListu + '" neexistuje.'); return; }
  const sloupcu = sheet.getLastColumn();
  Logger.log('LIST: "' + nazevListu + '"  (' + sheet.getLastRow() + ' řádků, ' + sloupcu + ' sloupců)');
  const hlavicka = sheet.getRange(1, 1, 1, sloupcu).getValues()[0];
  const ukazky = sheet.getLastRow() >= 3 ? sheet.getRange(2, 1, 2, sloupcu).getValues() : [];
  for (let i = 0; i < sloupcu; i++) {
    let v1 = ukazky[0] ? String(ukazky[0][i] || '') : '';
    let v2 = ukazky[1] ? String(ukazky[1][i] || '') : '';
    if (v1.length > 30) v1 = v1.substring(0, 30) + '…';
    if (v2.length > 30) v2 = v2.substring(0, 30) + '…';
    Logger.log(pismenoSloupce_(i + 1) + ' (' + (i + 1) + ')  ' +
      String(hlavicka[i] || '(prázdné)') + '   →   ' + v1 + '  |  ' + v2);
  }
}
