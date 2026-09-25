// ============================================================
// DEK WMS – Google Apps Script backend
// Verze: 3.3 | Pilotní provoz CS2
// ============================================================
// Pracuje nad listem DATA (databáze PSP).
// Časy zapisuje do VLASTNÍCH sloupců "WMS příjem" / "WMS výdej",
// které si sám založí na konci listu. Existující sloupce
// "Datum svezeno na CS" a "Datum odesláno z CS" needituje –
// ty patří jiné automatizaci.
//
// Přístup: po přihlášení jménem a PINem vydá skript podepsaný klíč
// platný 12 hodin. Bez něj odpoví jen na ping, seznam uživatelů
// a samotné přihlášení. Na čtečce se proto nenastavuje nic.
// ============================================================

const WMS_CONFIG = {
  dataList:      'DATA',
  pohybyList:    'POHYBY',
  uzivateleList: 'UZIVATELE',

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

// ============================================================
// PŘÍSTUPOVÝ KLÍČ – vydává se po přihlášení
// ============================================================
// Klíč je podepsaný text "jméno|do kdy platí". Podpis umí vyrobit
// jen tenhle skript, takže se nedá zfalšovat ani si v něm přepsat
// jméno. Nikde se neukládá – platnost se pozná z něj samotného.
//
// Díky tomu se na čtečce nic nenastavuje: stačí jméno a PIN.
// ============================================================

const PLATNOST_KLICE = 12 * 60 * 60 * 1000;   // 12 hodin

function getTajemstvi_() {
  const props = PropertiesService.getScriptProperties();
  let t = props.getProperty('WMS_SECRET');
  if (!t) {
    t = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('WMS_SECRET', t);
  }
  return t;
}

function podpis_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(text, getTajemstvi_())
  );
}

function vytvorKlic_(jmeno) {
  const zaklad = jmeno + '|' + (Date.now() + PLATNOST_KLICE);
  return Utilities.base64EncodeWebSafe(zaklad) + '.' + podpis_(zaklad);
}

// Vrátí jméno přihlášeného, nebo null když klíč neplatí
function overKlic_(klic) {
  if (!klic) return null;
  try {
    const casti = String(klic).split('.');
    if (casti.length !== 2) return null;

    const zaklad = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(casti[0])
    ).getDataAsString();

    if (podpis_(zaklad) !== casti[1]) return null;   // cizí nebo upravený klíč

    const p = zaklad.split('|');
    if (p.length !== 2) return null;
    if (Number(p[1]) < Date.now()) return null;      // vypršel

    return p[0];
  } catch (e) {
    return null;
  }
}

// Otevření tabulky není zadarmo – u téhle (20 listů, 1,25 MB) trvá skoro
// vteřinu. V rámci jednoho požadavku si ji proto pamatujeme a neotevíráme
// ji znovu při každém volání. Totéž pro listy a pro pozice sloupců WMS.
let _ss = null;
const _listy = {};
let _wmsSloupce = null;

function getSS_() {
  if (!_ss) _ss = SpreadsheetApp.openById(getSheetId_());
  return _ss;
}

// Zahodí zapamatované hodnoty – používá se jen při měření rychlosti,
// aby každé měření začínalo nastudena jako skutečný požadavek ze čtečky.
function zapomen_() {
  _ss = null;
  _wmsSloupce = null;
  for (const k in _listy) delete _listy[k];
}

// Volitelné měření uvnitř funkcí. Když je _mereni null (běžný provoz),
// tik_ nedělá vůbec nic, takže to nic nestojí.
let _mereni = null;

function tik_(co) {
  if (!_mereni) return;
  const t = Date.now();
  _mereni.log.push('   ' + co + ': ' + (t - _mereni.t) + ' ms');
  _mereni.t = t;
}

function getList_(nazev) {
  if (_listy[nazev]) return _listy[nazev];
  const sheet = getSS_().getSheetByName(nazev);
  if (!sheet) throw new Error('List "' + nazev + '" nenalezen');
  _listy[nazev] = sheet;
  return sheet;
}

// ============================================================
// SLOUPCE WMS – najdi je, nebo je založ na konci listu
// ============================================================
function wmsSloupce_(sheet) {
  if (_wmsSloupce) return _wmsSloupce;

  const props = PropertiesService.getScriptProperties();
  const sirka = Math.max(sheet.getLastColumn(), 1);

  // Pozice sloupců se nemění, takže si je pamatujeme i mezi požadavky
  // a nemusíme kvůli nim číst hlavičku. Součástí zápisu je i počet sloupců –
  // jakmile někdo sloupec přidá nebo ubere, hodnota přestane sedět
  // a pozice se najdou znovu.
  const ulozeno = props.getProperty('WMS_COL_CACHE');
  if (ulozeno) {
    const p = ulozeno.split(',').map(Number);
    if (p.length === 3 && p[2] === sirka && p[0] > 0 && p[1] > 0) {
      _wmsSloupce = { prijem: p[0], vydej: p[1] };
      return _wmsSloupce;
    }
  }

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

  _wmsSloupce = { prijem: prijem, vydej: vydej };
  props.setProperty('WMS_COL_CACHE',
    prijem + ',' + vydej + ',' + Math.max(sheet.getLastColumn(), 1));
  return _wmsSloupce;
}

// ============================================================
// VSTUPNÍ BOD – vše přes GET (JSONP)
// ============================================================

function doGet(e) {
  const zacatek  = Date.now();
  const params   = (e && e.parameter) || {};
  const action   = params.action   || '';
  const callback = params.callback || '';

  let result;
  try {
    // Bez přihlášení jdou jen tyhle tři věci: ozvat se, vypsat jména
    // do výběru a samotné přihlášení.
    const verejne = (action === 'ping' || action === 'prihlaseni' || action === 'uzivatele');

    if (!verejne) {
      const prihlaseny = overKlic_(params.klic);
      const token = getToken_();
      const tokenSedi = token && params.token === token;

      if (!prihlaseny && !tokenSedi) {
        return odpoved_({
          chyba: 'Nejste přihlášeni nebo platnost vypršela',
          prihlasitZnovu: true
        }, callback);
      }

      // Jméno bereme z podepsaného klíče, ne z toho, co pošle čtečka –
      // do tabulky se tak nedá zapsat pohyb pod cizím jménem.
      if (prihlaseny) params.uzivatel = prihlaseny;
    }

    if (action === 'lookup') {
      result = lookupStroj(params.id || '', params.akce || '');

    } else if (action === 'lookupPsp') {
      result = lookupPsp(params.psp || '');

    } else if (action === 'seznamKVydeji') {
      result = getSeznamKVydeje(params.cerstve === '1');

    } else if (action === 'index') {
      result = getIndexPrijem(params.cerstve === '1');

    } else if (action === 'uzivatele') {
      result = getUzivatele();

    } else if (action === 'prihlaseni') {
      result = prihlas(params.jmeno || '', params.pin || '');

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
        uzivatel:    params.uzivatel    || '',
        cas:         params.cas         || '',
        nonce:       params.nonce       || '',
        prepsat:     params.prepsat === '1',
        bezDokladu:  params.bezDokladu === '1',
      });

    } else if (action === 'ping') {
      result = { ok: true, verze: '3.3', list: WMS_CONFIG.dataList, cas: new Date().toISOString() };

    } else {
      result = { chyba: 'Neznámá akce: ' + action };
    }

  } catch (err) {
    result = { chyba: err.message };
  }

  // Doba zpracování – ať je při potížích vidět, jestli se čekalo na skript
  if (result && typeof result === 'object') result.ms = Date.now() - zacatek;

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
// RYCHLÉ ČTENÍ
// ============================================================
// Klíčové zjištění: každý dotaz do Sheets stojí ~0,25 s sám o sobě,
// nezávisle na množství dat. Dvacet malých dotazů je tedy pomalejší
// než jeden velký. Proto čteme VŽDY jen pár bloků sloupců naráz
// a nikdy nečteme řádky jeden po druhém.
//
// Druhé zrychlení: nové přesuny přibývají na KONEC tabulky, takže
// při hledání stroje stačí projít poslední část. Když se tam nenajde,
// teprve pak se sáhne na celou tabulku.

// Měření na ostrých datech: čtení 1 500 řádků trvá ~750 ms, čtení 7 500 řádků
// ~2 100 ms, přestože jde o srovnatelný počet buněk. Rozhoduje délka úseku.
// Proto hledáme po stupních – drtivá většina skenů se trefí hned v prvním.
const OKNA_RADKU = [400, 2000];

// Kolik posledních řádků se prochází při sestavování seznamu k výdeji.
// Vychází z toho, že na skladě nic neleží déle než měsíc (~850 řádků),
// takže 2 500 je zhruba tříměsíční rezerva.
const OKNO_VYDEJ = 2500;

// Načte DVA bloky sloupců pro rozsah řádků odRadku..odRadku+pocet-1.
// Dva souvislé bloky jsou rychlejší než čtyři užší – režie dotazu
// převáží nad pár sloupci navíc.
function nactiBloky_(sheet, wms, odRadku, pocet) {
  const c = WMS_CONFIG.col;
  const A_OD = c.idNakladka;   // B
  const A_DO = c.odeslanoZCS;  // S
  const B_OD = Math.min(c.storno, wms.prijem, wms.vydej);
  const B_DO = Math.max(c.storno, wms.prijem, wms.vydej);

  const hlavni = sheet.getRange(odRadku, A_OD, pocet, A_DO - A_OD + 1).getValues();
  const stavy  = sheet.getRange(odRadku, B_OD, pocet, B_DO - B_OD + 1).getValues();

  return {
    odRadku: odRadku,
    pocet:   pocet,
    get: function (i, sloupec) {
      if (sloupec >= A_OD && sloupec <= A_DO) return hlavni[i][sloupec - A_OD];
      if (sloupec >= B_OD && sloupec <= B_DO) return stavy[i][sloupec - B_OD];
      return '';
    }
  };
}

// Hledá po stupních od konce tabulky: nejdřív posledních 400 řádků,
// pak 2 000 a teprve nakonec celou tabulku. Nové přesuny přibývají na konec,
// takže běžný sken skončí hned v prvním kroku.
function najdiSBlokem_(sheet, wms, jeToOno) {
  const posledni = sheet.getLastRow();
  if (posledni < 2) return null;

  const meze = OKNA_RADKU.concat([posledni - 1]);
  let predchozi = 0;

  for (let k = 0; k < meze.length; k++) {
    const oknoRadku = Math.min(meze[k], posledni - 1);
    if (oknoRadku <= predchozi) continue;       // stejný rozsah už prohledaný
    predchozi = oknoRadku;

    const odRadku = Math.max(2, posledni - oknoRadku + 1);
    const b = nactiBloky_(sheet, wms, odRadku, posledni - odRadku + 1);
    tik_('  ↳ čtení okna ' + (posledni - odRadku + 1) + ' řádků');
    const nalezene = projdiBlok_(b, jeToOno);
    if (nalezene.length) return { bloky: b, indexy: nalezene };
    tik_('  ↳ v tomto okně nenalezeno, jde se šíř');

    if (odRadku <= 2) break;                    // víc už není kde hledat
  }
  return null;
}

function projdiBlok_(b, jeToOno) {
  const out = [];
  for (let i = b.pocet - 1; i >= 0; i--) {   // od nejnovějšího
    if (jeToOno(b, i)) out.push(i);
  }
  return out;
}

function precistZBloku_(b, i, wms) {
  const c = WMS_CONFIG.col;
  return {
    radek:       b.odRadku + i,
    idNakladka:  b.get(i, c.idNakladka),
    pobNakladka: b.get(i, c.pobNakladka),
    idVykladka:  b.get(i, c.idVykladka),
    pobVykladka: b.get(i, c.pobVykladka),
    cisloPsp:    b.get(i, c.cisloPsp),
    ecPuj:       b.get(i, c.ecPuj),
    polozka:     b.get(i, c.polozka),
    idStroje:    b.get(i, c.idStroje),
    nazev:       b.get(i, c.nazevPolozky),
    datumSvozu:  b.get(i, c.datumSvozu),
    svezenoNaCS: b.get(i, c.svezenoNaCS),
    odeslanoZCS: b.get(i, c.odeslanoZCS),
    storno:      b.get(i, c.storno),
    wmsPrijem:   b.get(i, wms.prijem),
    wmsVydej:    b.get(i, wms.vydej),
  };
}

// ============================================================
// LOOKUP – vyhledá stroj podle ID
// ============================================================
function lookupStroj(id, akce) {
  if (!id) return { chyba: 'Chybí ID stroje' };

  const sheet = getList_(WMS_CONFIG.dataList);
  tik_('otevření tabulky a listu');
  const wms   = wmsSloupce_(sheet);
  tik_('zjištění sloupců WMS');
  const c     = WMS_CONFIG.col;
  const hledane = id.toString().trim().toUpperCase();

  const nalez = najdiSBlokem_(sheet, wms, function (b, i) {
    return String(b.get(i, c.idStroje) || '').trim().toUpperCase() === hledane;
  });
  tik_('vyhledání stroje CELKEM');

  if (!nalez) {
    return { nalezeno: false, id: hledane, zprava: 'Stroj nenalezen v databázi PSP' };
  }

  // indexy jsou od nejnovějšího, takže radky[0] je nejnovější záznam
  const b = nalez.bloky;
  const radky = nalez.indexy.map(function (i) { return precistZBloku_(b, i, wms); });
  tik_('načtení ' + radky.length + ' záznamů stroje');

  // Vyber přesun, který odpovídá akci
  let hlavni = null;
  if (akce === 'prijem') {
    hlavni = radky.filter(function (r) { return !r.wmsPrijem && !r.storno; })[0];
  } else if (akce === 'vydej') {
    hlavni = radky.filter(function (r) { return r.wmsPrijem && !r.wmsVydej && !r.storno; })[0];
    if (!hlavni) hlavni = radky.filter(function (r) { return r.svezenoNaCS && !r.wmsVydej && !r.odeslanoZCS && !r.storno; })[0];
  }
  if (!hlavni) hlavni = radky[0];

  const polozky = najdiPolozkyZBloku_(b, hlavni.cisloPsp);
  tik_('dohledání položek PSP');

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
    dalsiZPobocky: najdiDalsiZPobocky_(b, hlavni, wms),
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
  const c     = WMS_CONFIG.col;
  const hledane = psp.toString().trim().toUpperCase();

  const nalez = najdiSBlokem_(sheet, wms, function (b, i) {
    return String(b.get(i, c.cisloPsp) || '').trim().toUpperCase() === hledane;
  });
  if (!nalez) return { nalezeno: false, psp: hledane, zprava: 'PSP nenalezeno v databázi' };

  const b = nalez.bloky;
  const polozky = nalez.indexy
    .slice().reverse()                       // zpět do pořadí, v jakém jsou v tabulce
    .map(function (i) { return precistZBloku_(b, i, wms); });
  const hlavni = polozky[0];

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
// Pořadí poboček: nejdřív D (depa), pak P, v obou skupinách podle čísla
// vzestupně. Abecední řazení dávalo P100 vedle P1000 a D9 až za P200.
function poradiPobocky_(kod) {
  const s = String(kod || '').trim().toUpperCase();
  const m = s.match(/^([A-Z]*)(\d+)/);
  const pismeno = m ? m[1] : '';
  const cislo   = m ? Number(m[2]) : 999999;
  const vaha    = (pismeno === 'D') ? 0 : (pismeno === 'P' ? 1 : 2);
  return { vaha: vaha, cislo: cislo, text: s };
}

function getSeznamKVydeje(cerstve, celaTabulka) {
  const cache = CacheService.getScriptCache();
  if (celaTabulka) cerstve = true;     // kontrolní běh se z paměti neodpovídá

  // Seznam musí projít celou tabulku, což trvá pár vteřin. Držíme ho
  // proto 5 minut v paměti – a při KAŽDÉM zápisu času ho zahazujeme,
  // aby nemohlo dojít k tomu, že dva skladníci vydají totéž PSP.
  if (!cerstve) {
    const ulozeno = cache.get('seznam_vydej');
    if (ulozeno) {
      try {
        const v = JSON.parse(ulozeno);
        v.zPameti = true;
        return v;
      } catch (e) { /* poškozený záznam – spočítáme znovu */ }
    }
  }

  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const c     = WMS_CONFIG.col;
  const posledni = sheet.getLastRow();
  if (posledni < 2) return { ok: true, pobocky: [], celkemPsp: 0 };

  // Podle provozu nic neleží na skladě déle než měsíc (informace od CS2).
  // Do tabulky přibývá kolem 850 řádků měsíčně, takže OKNO_VYDEJ pokrývá
  // zhruba tři měsíce – trojnásobná rezerva.
  // Ověřit, že se tím nic neztratí, jde funkcí porovnejOknoVydeje().
  const odRadku = celaTabulka ? 2 : Math.max(2, posledni - OKNO_VYDEJ + 1);
  const n = posledni - odRadku + 1;

  // Čteme dva bloky sloupců, které opravdu potřebujeme:
  //   D..S  (pobočky, PSP, ID stroje, název, data svozu a odeslání)
  //   AE..  (storno a sloupce WMS)
  const A_OD = c.idVykladka;                 // 4
  const A_DO = c.odeslanoZCS;                // 19
  const B_OD = Math.min(c.storno, wms.prijem, wms.vydej);
  const B_DO = Math.max(c.storno, wms.prijem, wms.vydej);

  const blokA = sheet.getRange(odRadku, A_OD, n, A_DO - A_OD + 1).getValues();
  const blokB = sheet.getRange(odRadku, B_OD, n, B_DO - B_OD + 1).getValues();

  const a = function (radek, sloupec) { return radek[sloupec - A_OD]; };
  const b = function (radek, sloupec) { return radek[sloupec - B_OD]; };

  const pobocky = {};

  for (let i = 0; i < n; i++) {
    const rA = blokA[i], rB = blokB[i];
    if (b(rB, c.storno)) continue;

    const prijato = b(rB, wms.prijem) || a(rA, c.svezenoNaCS);
    const vydano  = b(rB, wms.vydej)  || a(rA, c.odeslanoZCS);
    if (!prijato || vydano) continue;

    const psp = (a(rA, c.cisloPsp) || '').toString().trim();
    if (!psp) continue;

    const kod   = (a(rA, c.idVykladka)  || '').toString().trim() || '???';
    const nazev = (a(rA, c.pobVykladka) || '').toString().trim() || 'Neznámá pobočka';

    if (!pobocky[kod]) pobocky[kod] = { kod: kod, nazev: nazev, psp: {} };
    if (!pobocky[kod].psp[psp]) {
      pobocky[kod].psp[psp] = { cisloPsp: psp, datumPrijmu: naIso_(prijato), polozky: [] };
    }
    pobocky[kod].psp[psp].polozky.push({
      radek:    odRadku + i,
      idStroje: a(rA, c.idStroje),
      nazev:    a(rA, c.nazevPolozky),
      ecPuj:    a(rA, c.ecPuj),
    });
  }

  const out = Object.keys(pobocky).map(function (kod) {
    const p = pobocky[kod];
    const pspList = Object.keys(p.psp).map(function (k) { return p.psp[k]; });
    return { kod: p.kod, nazev: p.nazev, pocetPsp: pspList.length, pspList: pspList };
  });

  out.sort(function (a, b) {
    const x = poradiPobocky_(a.kod);
    const y = poradiPobocky_(b.kod);
    if (x.vaha !== y.vaha)   return x.vaha - y.vaha;     // D před P
    if (x.cislo !== y.cislo) return x.cislo - y.cislo;   // podle čísla vzestupně
    return x.text.localeCompare(y.text, 'cs');
  });

  const vysledek = {
    ok: true,
    pobocky: out,
    celkemPsp: out.reduce(function (s, p) { return s + p.pocetPsp; }, 0),
  };

  try {
    // Kontrolní běh přes celou tabulku se do paměti neukládá –
    // ta patří běžnému, zkrácenému hledání.
    // Jen 60 s. Příjem přes WMS paměť zahodí sám, takže tohle pokrývá
    // hlavně případ, kdy stroj označí jako svezený ta druhá automatizace
    // (sloupec R) – o tom WMS neví a jinak by to mohl minout.
    const text = JSON.stringify(vysledek);
    if (!celaTabulka && text.length < 90000) cache.put('seznam_vydej', text, 60);
  } catch (e) { /* když se nevejde, prostě se nekešuje */ }

  return vysledek;
}

// ============================================================
// INDEX ČEKANÝCH STROJŮ – ke stažení do čtečky
// ============================================================
// Jedno kolečko k Apps Scriptu stojí kolem 1,8 s a zkrátit se nedá.
// Proto si čtečka jednou stáhne seznam strojů čekaných na příjem
// a každý sken pak vyhledá u sebe – okamžitě a i bez signálu.
//
// Posílá se jako pole polí (ne pojmenované objekty), aby byl přenos
// co nejmenší. Pořadí sloupců drží POLE_INDEXU.
// ============================================================

const POLE_INDEXU = ['id', 'nazev', 'psp', 'kodZ', 'pobZ', 'kodDo', 'pobDo', 'datumSvozu', 'radek'];

function getIndexPrijem(cerstve) {
  const cache = CacheService.getScriptCache();
  if (!cerstve) {
    const ulozeno = cache.get('index_prijem');
    if (ulozeno) {
      try {
        const v = JSON.parse(ulozeno);
        v.zPameti = true;
        return v;
      } catch (e) { /* spočítáme znovu */ }
    }
  }

  const sheet = getList_(WMS_CONFIG.dataList);
  const wms   = wmsSloupce_(sheet);
  const c     = WMS_CONFIG.col;
  const posledni = sheet.getLastRow();
  if (posledni < 2) return { ok: true, pole: POLE_INDEXU, pocet: 0, stroje: [] };

  const odRadku = Math.max(2, posledni - OKNO_VYDEJ + 1);
  const n = posledni - odRadku + 1;

  const A_OD = c.idNakladka, A_DO = c.odeslanoZCS;
  const B_OD = Math.min(c.storno, wms.prijem, wms.vydej);
  const B_DO = Math.max(c.storno, wms.prijem, wms.vydej);

  const blokA = sheet.getRange(odRadku, A_OD, n, A_DO - A_OD + 1).getValues();
  const blokB = sheet.getRange(odRadku, B_OD, n, B_DO - B_OD + 1).getValues();
  const a = function (r, s) { return r[s - A_OD]; };
  const b = function (r, s) { return r[s - B_OD]; };

  const stroje = [];
  for (let i = 0; i < n; i++) {
    const rA = blokA[i], rB = blokB[i];
    if (b(rB, c.storno)) continue;
    if (b(rB, wms.prijem)) continue;          // už přijato – do indexu nepatří
    if (a(rA, c.svezenoNaCS)) continue;

    const id = String(a(rA, c.idStroje) || '').trim();
    if (!id) continue;                        // příslušenství bez ID

    stroje.push([
      id,
      String(a(rA, c.nazevPolozky) || ''),
      String(a(rA, c.cisloPsp)     || ''),
      String(a(rA, c.idNakladka)   || ''),
      String(a(rA, c.pobNakladka)  || ''),
      String(a(rA, c.idVykladka)   || ''),
      String(a(rA, c.pobVykladka)  || ''),
      datumKlic_(a(rA, c.datumSvozu)),
      odRadku + i,
    ]);
  }

  const vysledek = {
    ok:     true,
    pole:   POLE_INDEXU,
    pocet:  stroje.length,
    cas:    new Date().toISOString(),
    stroje: stroje,
  };

  try {
    const text = JSON.stringify(vysledek);
    if (text.length < 90000) cache.put('index_prijem', text, 300);
  } catch (e) {}

  return vysledek;
}

// ============================================================
// CO JEŠTĚ MĚLO PŘIJET Z TÉ SAMÉ POBOČKY
// ============================================================
// Stejný kód nakládky + stejné datum svozu = stejná jízda.
// Hledá se v bloku, který už máme načtený z vyhledání stroje,
// takže to nestojí žádné čtení navíc.
// ============================================================

function datumKlic_(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) { return ''; }
}

function najdiDalsiZPobocky_(b, hlavni, wms) {
  const c = WMS_CONFIG.col;
  const pobocka = String(hlavni.idNakladka || '').trim().toUpperCase();
  const datum   = datumKlic_(hlavni.datumSvozu);
  const tento   = String(hlavni.idStroje || '').trim().toUpperCase();
  if (!pobocka || !datum) return [];

  const out = [];
  for (let i = 0; i < b.pocet; i++) {
    if (String(b.get(i, c.idNakladka) || '').trim().toUpperCase() !== pobocka) continue;
    if (datumKlic_(b.get(i, c.datumSvozu)) !== datum) continue;
    if (b.get(i, c.storno)) continue;

    const id = String(b.get(i, c.idStroje) || '').trim();
    if (!id) continue;                       // příslušenství bez ID
    if (id.toUpperCase() === tento) continue; // ten právě naskenovaný

    out.push({
      idStroje: id,
      nazev:    b.get(i, c.nazevPolozky),
      cisloPsp: b.get(i, c.cisloPsp),
      prijato:  !!(b.get(i, wms.prijem) || b.get(i, c.svezenoNaCS)),
    });
  }

  // Nepřijaté napřed – to je to, co skladník potřebuje vidět
  out.sort(function (x, y) {
    if (x.prijato !== y.prijato) return x.prijato ? 1 : -1;
    return String(x.cisloPsp).localeCompare(String(y.cisloPsp), 'cs');
  });

  return out.slice(0, 25);
}

// Položky jednoho PSP – hledají se v už načteném bloku, tedy zadarmo.
// Řádky jednoho PSP se do tabulky importují společně, takže leží vedle sebe.
function najdiPolozkyZBloku_(b, psp) {
  const c = WMS_CONFIG.col;
  const hledane = (psp || '').toString().trim().toUpperCase();
  if (!hledane) return [];

  const out = [];
  for (let i = 0; i < b.pocet; i++) {
    if (String(b.get(i, c.cisloPsp) || '').trim().toUpperCase() !== hledane) continue;
    out.push({
      radek:    b.odRadku + i,
      idStroje: b.get(i, c.idStroje),
      pp:       b.get(i, c.polozka),
      polozka:  b.get(i, c.ecPuj),
      nazev:    b.get(i, c.nazevPolozky),
      ecPuj:    b.get(i, c.ecPuj),
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

    const odpoved = {
      ok:           true,
      radekLogu:    radekLogu,
      zapsanoRadku: vysledek.zapsanoRadku,
      zprava: (record.akce === 'prijem' ? 'Příjem' : 'Výdej')
              + ' zapsán (' + vysledek.zapsanoRadku + ' řádků)',
    };

    // Stroj dorazil bez papírového dokladu – dát vědět logistikovi.
    // Zápis už proběhl, takže případné selhání mailu ho neruší;
    // jen se to poctivě vrátí do aplikace.
    if (record.bezDokladu) {
      const info = record.psp ? lookupPsp(record.psp) : {};
      const mail = posliUpozorneniBezDokladu_(record, info || {}, cas);
      odpoved.mail = mail;
      odpoved.zprava = 'Přijato BEZ DOKLADU. '
        + (mail.odeslano
            ? 'Upozornění odesláno na ' + mail.komu
            : 'E-MAIL SE NEPODAŘILO ODESLAT: ' + mail.duvod);
    }

    return odpoved;

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
  const c     = WMS_CONFIG.col;

  const sloupec    = (akce === 'prijem') ? wms.prijem : wms.vydej;
  const hledanePsp = (psp || '').toString().trim().toUpperCase();
  const hledanyId  = (idStroje || '').toString().trim().toUpperCase();

  const n = sheet.getLastRow() - 1;
  if (n < 1) return { zapsanoRadku: 0, jizZapsano: false };

  // Dvě čtení: blok F..I pokryje číslo PSP i ID stroje, druhé je cílový sloupec
  const blok   = sheet.getRange(2, c.cisloPsp, n, c.idStroje - c.cisloPsp + 1).getValues();
  const cilCol = sheet.getRange(2, sloupec, n, 1).getValues();
  const POSUN_ID = c.idStroje - c.cisloPsp;

  const cileRadky = [];
  let existujiciCas = null;

  for (let i = 0; i < n; i++) {
    if (String(blok[i][0] || '').trim().toUpperCase() !== hledanePsp) continue;

    const radId = String(blok[i][POSUN_ID] || '').trim().toUpperCase();

    // Bez ID stroje (sken PSP z dokladu) bereme všechny řádky PSP
    if (hledanyId) {
      const jeNasStroj      = (radId === hledanyId);
      const jePrislusenstvi = !radId;
      if (!jeNasStroj && !jePrislusenstvi) continue;
    }

    const stavajici = cilCol[i][0];
    if (stavajici && !existujiciCas) existujiciCas = stavajici;
    cileRadky.push(i + 2);
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

  // Oba uložené seznamy jsou teď zastaralé – zahodit, ať nikdo nedostane
  // PSP, které právě odjelo, ani stroj, který je už přijatý.
  try {
    CacheService.getScriptCache().removeAll(['seznam_vydej', 'index_prijem']);
  } catch (e) {}

  return { zapsanoRadku: zapsano, jizZapsano: false };
}

// ============================================================
// PŘIHLÁŠENÍ SKLADNÍKŮ
// ============================================================
// List UZIVATELE:  Jméno | PIN | Aktivní
// PINy se NIKDY neposílají do čtečky – ověřují se tady na serveru.
// Slouží k dohledatelnosti (kdo co naskenoval), ne jako trezor:
// kdo zná kolegův PIN, může jednat jeho jménem. Proti cizím lidem
// chrání sdílený token (WMS_TOKEN), ne tohle.
// ============================================================

function getUzivateleList_() {
  const ss = getSS_();
  let sheet = ss.getSheetByName(WMS_CONFIG.uzivateleList);
  if (!sheet) {
    sheet = ss.insertSheet(WMS_CONFIG.uzivateleList);
    sheet.appendRow(['Jméno', 'PIN', 'Aktivní']);
    sheet.getRange(1, 1, 1, 3)
      .setBackground('#C8281A').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 220);
  }
  return sheet;
}

// Vrátí jen jména aktivních uživatelů – bez PINů
function getUzivatele() {
  const sheet = getUzivateleList_();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return { ok: true, uzivatele: [] };

  const data = sheet.getRange(2, 1, n, 3).getValues();
  const jmena = [];
  for (let i = 0; i < n; i++) {
    const jmeno  = String(data[i][0] || '').trim();
    const aktivni = String(data[i][2] || '').trim().toUpperCase();
    if (!jmeno) continue;
    if (aktivni === 'NE' || aktivni === 'FALSE') continue;
    jmena.push(jmeno);
  }
  jmena.sort(function (a, b) { return a.localeCompare(b, 'cs'); });
  return { ok: true, uzivatele: jmena };
}

function prihlas(jmeno, pin) {
  jmeno = String(jmeno || '').trim();
  pin   = String(pin   || '').trim();
  if (!jmeno || !pin) return { ok: false, chyba: 'Vyberte jméno a zadejte PIN' };

  // Ochrana proti hádání PINu – po pěti omylech pauza na pět minut
  const cache = CacheService.getScriptCache();
  const klic  = 'pokusy_' + jmeno.toLowerCase();
  const pokusu = Number(cache.get(klic) || 0);
  if (pokusu >= 5) {
    return { ok: false, chyba: 'Příliš mnoho pokusů, zkuste to za 5 minut' };
  }

  const sheet = getUzivateleList_();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return { ok: false, chyba: 'V tabulce nejsou žádní uživatelé' };

  const data = sheet.getRange(2, 1, n, 3).getValues();
  for (let i = 0; i < n; i++) {
    const radJmeno = String(data[i][0] || '').trim();
    if (radJmeno.toLowerCase() !== jmeno.toLowerCase()) continue;

    const aktivni = String(data[i][2] || '').trim().toUpperCase();
    if (aktivni === 'NE' || aktivni === 'FALSE') {
      return { ok: false, chyba: 'Tento uživatel je neaktivní' };
    }

    if (String(data[i][1] || '').trim() === pin) {
      cache.remove(klic);
      return { ok: true, jmeno: radJmeno, klic: vytvorKlic_(radJmeno) };
    }
    break;
  }

  cache.put(klic, String(pokusu + 1), 300);
  return { ok: false, chyba: 'Nesprávný PIN' };
}

// ============================================================
// PŘÍJEM BEZ DOKLADU – upozornění logistikovi
// ============================================================
// Stroj dorazil, ale bez papírového PSP. Zapíše se jako normální
// příjem (protože fyzicky na skladě je) a navíc odejde e-mail,
// aby logistik doklad vytiskl.
//
// Adresa je ve VLASTNOSTECH TOHOTO SKRIPTU (EMAIL_BEZ_DOKLADU),
// schválně NE v listu EMAIL_NASTAVENI. Ten patří dispečerské
// automatizaci a míchat do něj WMS by mátlo obě strany.
//
// Nastavení: Nastavení projektu → Vlastnosti skriptu
//   EMAIL_BEZ_DOKLADU = adresa (víc adres oddělte čárkou)
// ============================================================

const SLOZKA_PSP = 'V:\\CS\\DOPRAVA\\PSP_IMPORT\\02_ZPRACOVANO';

function getEmailPrijemce_() {
  const komu = (PropertiesService.getScriptProperties()
    .getProperty('EMAIL_BEZ_DOKLADU') || '').trim();
  return komu ? { komu: komu } : null;
}

function posliUpozorneniBezDokladu_(record, info, cas) {
  const prijemce = getEmailPrijemce_();
  if (!prijemce) {
    return { odeslano: false,
      duvod: 'Není nastavena vlastnost EMAIL_BEZ_DOKLADU ve Vlastnostech skriptu' };
  }

  const psp   = record.psp || '(bez PSP)';
  const odkud = info.pobNakladka || record.pobNakladka || '?';
  const kam   = info.pobVykladka || record.pobVykladka || 'CS2';
  const kdy   = Utilities.formatDate(cas, Session.getScriptTimeZone(), 'd. M. \'ve\' HH:mm');

  const predmet = psp + ' dorazilo bez dokladu';

  const telo =
      psp + ' dorazilo bez dokladu\n\n'
    + 'Stroj: ' + (record.id || '?') + ', ' + (record.nazev || info.nazev || '?') + '\n'
    + 'Z pobočky: ' + odkud + ' → ' + kam + '\n'
    + 'Přijal: ' + (record.uzivatel || '?') + ', ' + kdy + '\n\n'
    + 'Doklad k vytištění:\n'
    + SLOZKA_PSP + '\\' + psp + '.pdf\n';

  try {
    MailApp.sendEmail(prijemce.komu, predmet, telo, { name: 'DEK WMS' });
    return { odeslano: true, komu: prijemce.komu };
  } catch (err) {
    return { odeslano: false, duvod: err.message };
  }
}

// ============================================================
// AUDITNÍ LOG – list POHYBY
// ============================================================
function zapisDoPohybu_(record, cas, pocetRadku) {
  const ss = getSS_();
  let sheet = ss.getSheetByName(WMS_CONFIG.pohybyList);

  if (!sheet) {
    sheet = ss.insertSheet(WMS_CONFIG.pohybyList);
    sheet.appendRow([
      'Čas', 'ID stroje', 'Název', 'PSP', 'E.Č. PUJ', 'Akce',
      'Pobočka odkud (kód)', 'Pobočka odkud',
      'Pobočka kam (kód)', 'Pobočka kam',
      'Lokace CS2', 'Sklad', 'Uživatel', 'Řádků', 'Zapsáno'
    ]);
    sheet.getRange(1, 1, 1, 15)
      .setBackground('#C8281A').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(4, 180);
  }

  const akceText = record.bezDokladu
    ? 'PŘÍJEM BEZ DOKLADU'
    : (record.akce === 'prijem' ? 'PŘÍJEM na CS2' : 'VÝDEJ z CS2');

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
    'uživatel':            record.uzivatel    || '',
    'řádků':               pocetRadku         || 0,
    'zapsáno':             new Date(),
  };

  let sirka    = Math.max(sheet.getLastColumn(), 1);
  let hlavicka = sheet.getRange(1, 1, 1, sirka).getValues()[0];

  // Starší list POHYBY sloupec Uživatel nemá – doplníme ho na konec
  const maUzivatele = hlavicka.some(function (h) {
    return String(h || '').trim().toLowerCase() === 'uživatel';
  });
  if (!maUzivatele) {
    sheet.getRange(1, sirka + 1).setValue('Uživatel').setFontWeight('bold');
    SpreadsheetApp.flush();
    sirka += 1;
    hlavicka = sheet.getRange(1, 1, 1, sirka).getValues()[0];
  }
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

// Nastaví adresu, kam chodí upozornění "stroj bez dokladu".
// Víc adres oddělte čárkou. Nemá to nic společného s listem
// EMAIL_NASTAVENI – ten patří dispečerské automatizaci.
function nastavEmailBezDokladu() {
  const ADRESA = 'SEM_VLOZTE_ADRESU';
  if (ADRESA === 'SEM_VLOZTE_ADRESU') {
    throw new Error('Nejdřív do funkce vložte e-mailovou adresu.');
  }
  PropertiesService.getScriptProperties().setProperty('EMAIL_BEZ_DOKLADU', ADRESA);
  Logger.log('Upozornění "bez dokladu" budou chodit na: ' + ADRESA);
}

// Pošle zkušební upozornění, ať je vidět, jak mail vypadá
function testEmailBezDokladu() {
  const vysledek = posliUpozorneniBezDokladu_(
    { psp: 'PSP-730-26-00108', id: '8HY3', nazev: 'Pila stolová 350–400 mm',
      uzivatel: 'Zkouška' },
    { pobNakladka: 'Blansko', pobVykladka: 'CS2' },
    new Date()
  );
  Logger.log(vysledek.odeslano
    ? 'Odesláno na ' + vysledek.komu
    : 'NEODESLÁNO: ' + vysledek.duvod);
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

// Založí list UZIVATELE (pokud chybí) a vypíše, co v něm je.
// Uživatele pak přidávejte prostě psaním do tabulky:
//   Jméno            | PIN  | Aktivní
//   Novák Jan        | 4812 | ANO
// Sloupec Aktivní nechte prázdný nebo ANO; NE uživatele vypne,
// aniž byste mazala historii jeho pohybů.
function pripravUzivatele() {
  const sheet = getUzivateleList_();
  const v = getUzivatele();
  Logger.log('List UZIVATELE je připravený (' + sheet.getLastRow() + ' řádků).');
  Logger.log('Aktivních uživatelů: ' + v.uzivatele.length);
  v.uzivatele.forEach(function (j) { Logger.log('  • ' + j); });
  if (!v.uzivatele.length) {
    Logger.log('Zatím nikdo – doplňte do listu jméno a čtyřmístný PIN.');
  }
}

// Udržuje skript zahřátý. Po nastavení časovače (Spouštěče → Přidat spouštěč →
// funkce "zahrej", časový, každých 5 minut) Google instanci tak často neuspává
// a první sken po pauze netrvá tři sekundy. Není to záruka, jen to pomáhá.
function zahrej() {
  try {
    getList_(WMS_CONFIG.dataList).getRange(1, 1).getValue();
  } catch (e) {
    Logger.log('zahrej: ' + e.message);
  }
}

// Založí sloupce WMS a řekne, kde skončily. Spusťte jako první.
function pripravSloupce() {
  PropertiesService.getScriptProperties().deleteProperty('WMS_COL_CACHE');
  _wmsSloupce = null;
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

// Změří, jak dlouho trvá vyhledání stroje a načtení seznamu k výdeji.
// Před spuštěním si do PROMENNE dole doplňte ID stroje z najdiTestovaciStroj().
function zmerRychlost() {
  const ID = '4CK1';

  // Každý požadavek z čtečky začíná s prázdnou pamětí, takže i měření
  // musí začínat nastudena – jinak by druhé číslo vyšlo falešně dobře.
  zapomen_();
  let t = Date.now();
  const v = lookupStroj(ID, 'prijem');
  Logger.log('lookupStroj(' + ID + '): ' + (Date.now() - t) + ' ms  →  '
    + (v.nalezeno ? v.nazev : v.zprava || v.chyba));

  zapomen_();
  t = Date.now();
  const s = getSeznamKVydeje();
  Logger.log('getSeznamKVydeje(): ' + (Date.now() - t) + ' ms  →  '
    + s.pobocky.length + ' poboček, ' + s.celkemPsp + ' PSP');
}

// Rozpad času přímo uvnitř lookupStroj – spusťte třikrát po sobě.
function zmerLookupPodrobne() {
  const ID = '4CK1';

  for (let pokus = 1; pokus <= 3; pokus++) {
    zapomen_();
    _mereni = { t: Date.now(), log: [] };
    const zacatek = Date.now();
    const v = lookupStroj(ID, 'prijem');
    const celkem = Date.now() - zacatek;

    Logger.log('───── pokus ' + pokus + ': CELKEM ' + celkem + ' ms ─────');
    _mereni.log.forEach(function (r) { Logger.log(r); });
    Logger.log('   výsledek: ' + (v.nazev || v.zprava || v.chyba));
    _mereni = null;
  }
}

// Rozloží zpoždění na jednotlivé kroky – ať je vidět, co přesně trvá.
function zmerFaze() {
  zapomen_();

  let t = Date.now();
  const ss = SpreadsheetApp.openById(getSheetId_());
  Logger.log('1. otevření tabulky:            ' + (Date.now() - t) + ' ms');

  t = Date.now();
  const sheet = ss.getSheetByName(WMS_CONFIG.dataList);
  Logger.log('2. výběr listu DATA:            ' + (Date.now() - t) + ' ms');

  t = Date.now();
  const posledni = sheet.getLastRow();
  const sirka    = sheet.getLastColumn();
  Logger.log('3. zjištění rozměrů (' + posledni + '×' + sirka + '):  ' + (Date.now() - t) + ' ms');

  t = Date.now();
  sheet.getRange(1, 1, 1, sirka).getValues();
  Logger.log('4. čtení hlavičky:              ' + (Date.now() - t) + ' ms');

  const od = Math.max(2, posledni - 1499);
  const kolik = posledni - od + 1;

  t = Date.now();
  sheet.getRange(od, 2, kolik, 18).getValues();
  Logger.log('5. blok ' + kolik + '×18 řádků:        ' + (Date.now() - t) + ' ms');

  t = Date.now();
  sheet.getRange(od, 31, kolik, 10).getValues();
  Logger.log('6. blok ' + kolik + '×10 řádků:        ' + (Date.now() - t) + ' ms');

  t = Date.now();
  sheet.getRange(2, 6, posledni - 1, 4).getValues();
  Logger.log('7. blok ' + (posledni - 1) + '×4 (celá tabulka): ' + (Date.now() - t) + ' ms');
}

// Ověří, že zkrácené hledání (OKNO_VYDEJ řádků) nevynechává žádné PSP
// oproti průchodu celou tabulkou. Spusťte po každé větší změně v provozu
// nebo když bude podezření, že něco ve výdeji chybí.
function porovnejOknoVydeje() {
  const t1 = Date.now();
  const okno = getSeznamKVydeje(true, false);
  const casOkno = Date.now() - t1;

  const t2 = Date.now();
  const cela = getSeznamKVydeje(true, true);
  const casCela = Date.now() - t2;

  const vOkne = {}, vCele = {};
  okno.pobocky.forEach(function (p) {
    p.pspList.forEach(function (x) { vOkne[x.cisloPsp] = true; });
  });
  cela.pobocky.forEach(function (p) {
    p.pspList.forEach(function (x) { vCele[x.cisloPsp] = true; });
  });

  const chybi = Object.keys(vCele).filter(function (p) { return !vOkne[p]; });

  Logger.log('Zkrácené hledání (' + OKNO_VYDEJ + ' řádků): '
    + okno.celkemPsp + ' PSP za ' + casOkno + ' ms');
  Logger.log('Celá tabulka:                    '
    + cela.celkemPsp + ' PSP za ' + casCela + ' ms');
  Logger.log('');

  if (!chybi.length) {
    Logger.log('✓ Zkrácené hledání nic nevynechává – je bezpečné.');
  } else {
    Logger.log('⚠ VE ZKRÁCENÉM HLEDÁNÍ CHYBÍ ' + chybi.length + ' PSP:');
    Logger.log('  ' + chybi.join(', '));
    Logger.log('Tahle PSP leží na skladě déle, než jsme čekali.');
    Logger.log('Buď je prověřte, nebo v kódu zvyšte OKNO_VYDEJ.');
  }
}

// Kolik strojů se čeká na příjem a jak velký je přenos do čtečky
function testIndex() {
  const t = Date.now();
  const v = getIndexPrijem(true);
  const velikost = JSON.stringify(v).length;
  Logger.log('Strojů čekaných na příjem: ' + v.pocet);
  Logger.log('Velikost přenosu: ' + Math.round(velikost / 1024) + ' kB');
  Logger.log('Spočítáno za: ' + (Date.now() - t) + ' ms');
  v.stroje.slice(0, 5).forEach(function (s) {
    Logger.log('  ' + s[0] + '  ' + s[2] + '  ' + s[1]);
  });
}

function testSeznamKVydeji() {
  const v = getSeznamKVydeje();
  Logger.log('Poboček: ' + v.pobocky.length + ', PSP celkem: ' + v.celkemPsp);
  v.pobocky.slice(0, 10).forEach(function (p) {
    Logger.log(p.kod + ' ' + p.nazev + ' → ' + p.pocetPsp + ' PSP');
  });
}

// Porovná živý výpočet se snímkem v listu LOGISTIK-výdej.
function porovnejSVydejem() {
  const ss = SpreadsheetApp.openById(getSheetId_());
  const snimek = ss.getSheetByName('LOGISTIK-výdej');
  if (!snimek) { Logger.log('List LOGISTIK-výdej neexistuje.'); return; }

  const data = snimek.getDataRange().getValues();

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

  const jenZivy   = Object.keys(zivy).filter(function (p) { return !veSnimku[p]; });
  const jenSnimek = Object.keys(veSnimku).filter(function (p) { return !zivy[p]; });

  Logger.log('Živý výpočet: ' + Object.keys(zivy).length + ' PSP');
  Logger.log('Snímek LOGISTIK-výdej: ' + Object.keys(veSnimku).length + ' PSP');
  Logger.log('');
  Logger.log('--- Vidí jen WMS (ve snímku chybí) ---');
  Logger.log(jenZivy.length ? jenZivy.join(', ') : '(žádné)');
  Logger.log('');
  Logger.log('--- Vidí jen snímek (WMS je nebere jako čekající) ---');
  Logger.log(jenSnimek.length ? jenSnimek.join(', ') : '(žádné)');
}

// Pro sporná PSP vypíše skutečný obsah rozhodujících sloupců v DATA.
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
