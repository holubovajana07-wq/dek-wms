// ============================================================
// Webová aplikace pro čtečku – prioritní nakládka.
// Vlastní doGet, proto MUSÍ zůstat v samostatném projektu (ne ve WMS backendu
// ani v Půjčovna_skript – tam už jeden doGet je a Google by jeden z nich zahodil).
// ============================================================

function doGet(e) {
  const p = (e && e.parameter) || {};

  try {
    // Veřejné akce – bez nich by se skladník neměl jak přihlásit.
    switch (p.action) {
      // Verzi zvyšovat při každé změně backendu – podle ní se pozná,
      // jestli je nasazená aktuální verze, nebo běží stará.
      case 'ping':
        return json_({ ok: true, verze: '2.5', cas: new Date() });
      case 'sklady':
        return json_({ ok: true, sklady: Object.keys(SKLADY).map(k => ({ kod: k, nazev: SKLADY[k] })) });
      case 'uzivatele':
        return json_(apiUzivatele_(p.sklad));
      case 'prihlaseni':
        return json_(apiPrihlaseni_(p.jmeno, p.pin, p.sklad));
    }

    // Všechno ostatní jen pro přihlášeného. Sklad se bere z klíče,
    // ne z adresy – skladník tak vidí výhradně svůj sklad.
    const kdo = overKlic_(p.klic);

    switch (p.action) {
      case 'seznam': return json_(apiSeznam_(kdo));
      case 'skupina': return json_(apiSkupina_(p.psk, kdo));
      case 'vydej': return json_(apiVydej_(p.id, p.stroj, kdo));
      case 'psp': return json_(apiPsp_(p.id, p.psp, kdo));
      case 'nesplneno': return json_(apiNesplneno_(p.id, p.duvod, kdo));
      default: return json_({ ok: false, chyba: 'Neznámá akce: ' + (p.action || '') });
    }
  } catch (err) {
    return json_({ ok: false, chyba: err.message });
  }
}

function json_(objekt) {
  return ContentService.createTextOutput(JSON.stringify(objekt))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Požadavek musí patřit skladu, pod kterým je skladník přihlášený. */
function overSklad_(list, radek, kdo) {
  const sklad = String(list.getRange(radek, SL.SKLAD).getValue()).toUpperCase().trim();
  if (sklad !== kdo.sklad) {
    throw new Error('Tenhle požadavek patří skladu ' + sklad + ', ty jsi přihlášený na ' + kdo.sklad + '.');
  }
  return sklad;
}

/** Co čeká na naložení – řazeno podle času nakládky, nejbližší nahoře. */
function apiSeznam_(kdo) {
  const list = list_(LIST_ROTACE);
  const posledni = list.getLastRow();
  if (posledni < 2) return { ok: true, polozky: [], kdo: kdo };

  const kdeSklad = kdo.sklad;
  const hodnoty = list.getRange(2, 1, posledni - 1, SL_POCET).getValues();
  const zasoba = zasobaVse_();

  const polozky = [];

  hodnoty.forEach(radek => {
    if (radek[SL.STAV - 1] !== STAV_K_VYDEJI) return;
    if (kdeSklad && String(radek[SL.SKLAD - 1]).toUpperCase() !== kdeSklad) return;

    const stroj = String(radek[SL.STROJ_POZ - 1]).toUpperCase();
    const vZasobe = zasoba.filter(s => s.stroj === stroj)[0];

    polozky.push({
      id: radek[SL.ID - 1],
      sklad: radek[SL.SKLAD - 1],
      pobocka: radek[SL.POBOCKA - 1],
      stroj: stroj,
      psk: radek[SL.PSK - 1],
      nazev: radek[SL.NAZEV - 1],
      nakladka: formatNakladku_(radek[SL.NAKLADKA - 1]),
      lokace: vZasobe ? vZasobe.lokace : '',
      naSklade: vZasobe ? vZasobe.stav === ZASOBA_NA_SKLADE : false
    });
  });

  polozky.sort((a, b) => String(a.nakladka).localeCompare(String(b.nakladka)));

  // Běžné převozy přes CS – jen pro přehled, odbavují se ve WMS.
  // Jedou přes CS2, takže pro Prostějov se nenabízejí.
  let bezne = [];
  if (kdeSklad === 'S096') {
    try {
      bezne = pspCekajiciNaVydej_();
    } catch (err) {
      log_('PŘEHLED PSP', '', 'CHYBA', err.message);
    }
  }

  return { ok: true, polozky: polozky, bezne: bezne, kdo: kdo };
}

/** Náhradní kusy ze stejné skupiny – vždy jen z vlastního skladu. */
function apiSkupina_(psk, kdo) {
  if (!psk) throw new Error('Chybí PSK.');

  return {
    ok: true,
    stroje: zasobaSkupina_(psk, kdo.sklad).map(s => ({
      stroj: s.stroj, nazev: s.nazev, lokace: s.lokace
    }))
  };
}

/** Skladník naskenoval stroj – zapíše se výdej. */
function apiVydej_(id, stroj, kdo) {
  if (!id) throw new Error('Chybí ID požadavku.');
  if (!stroj) throw new Error('Chybí ID stroje.');

  const zamek = LockService.getScriptLock();
  if (!zamek.tryLock(15000)) throw new Error('Zkuste to prosím znovu, systém je zaneprázdněný.');

  try {
    const list = list_(LIST_ROTACE);
    const radek = najdiRadekPozadavku_(id);
    if (!radek) throw new Error('Požadavek ' + id + ' v tabulce není.');

    const sklad = overSklad_(list, radek, kdo);

    const stav = list.getRange(radek, SL.STAV).getValue();
    if (stav === STAV_NALOZENO || stav === STAV_UZAVRENO) {
      throw new Error('Tenhle požadavek už je odbavený (' + stav + ').');
    }
    if (stav === STAV_ZRUSENO) throw new Error('Požadavek byl stornovaný, nenakládat.');

    const naskenovany = String(stroj).toUpperCase().trim();
    const pozadovany = String(list.getRange(radek, SL.STROJ_POZ).getValue()).toUpperCase().trim();
    const psk = String(list.getRange(radek, SL.PSK).getValue()).toUpperCase().trim();

    const vZasobe = zasobaNajdiStroj_(naskenovany);
    if (!vZasobe) throw new Error('Stroj ' + naskenovany + ' není ve skladové zásobě.');
    if (vZasobe.stav !== ZASOBA_NA_SKLADE) throw new Error('Stroj ' + naskenovany + ' je už vydaný.');
    if (vZasobe.sklad !== sklad) throw new Error('Stroj ' + naskenovany + ' leží na ' + vZasobe.sklad + ', ne na ' + sklad + '.');

    // Náhrada se smí vzít jen ze stejné skupiny.
    if (naskenovany !== pozadovany && vZasobe.psk !== psk) {
      throw new Error('Stroj ' + naskenovany + ' je jiná skupina (' + vZasobe.psk + '), požadovaná je ' + psk + '.');
    }

    list.getRange(radek, SL.STROJ_SKUT).setValue(naskenovany);
    list.getRange(radek, SL.LOKACE).setValue(vZasobe.lokace);
    list.getRange(radek, SL.VYDEJ).setValue(new Date());
    list.getRange(radek, SL.STAV).setValue(STAV_NALOZENO);
    if (naskenovany !== pozadovany) {
      const poznamka = list.getRange(radek, SL.POZNAMKA);
      const stavajici = String(poznamka.getValue() || '');
      // Nepřepisovat – v poznámce už může být, proč původní kus nešel vydat.
      poznamka.setValue(stavajici ? stavajici + ' | Náhrada za ' + pozadovany
                                  : 'Náhrada za ' + pozadovany);
    }
    obarviRadek_(list, radek);

    zasobaOznacVydano_(vZasobe.radek);

    log_('VÝDEJ', id, 'OK', naskenovany +
      (naskenovany !== pozadovany ? ' (náhrada za ' + pozadovany + ')' : '') +
      ', ' + kdo.jmeno + ', ' + kdo.sklad);

    return {
      ok: true,
      id: id,
      stroj: naskenovany,
      nahrada: naskenovany !== pozadovany,
      pozadovany: pozadovany,
      lokace: vZasobe.lokace,
      zprava: 'Naloženo. Teď je potřeba vystavit PSP.'
    };

  } finally {
    zamek.releaseLock();
  }
}

/** SO vystavilo PSP – dopíše se, odejde odpověď a ticket se uzavře. */
function apiPsp_(id, psp, kdo) {
  if (!id) throw new Error('Chybí ID požadavku.');
  if (!psp) throw new Error('Chybí číslo PSP.');

  const list = list_(LIST_ROTACE);
  const radek = najdiRadekPozadavku_(id);
  if (!radek) throw new Error('Požadavek ' + id + ' v tabulce není.');

  overSklad_(list, radek, kdo);

  const vysledek = uzavriSPsp_(list, radek, psp, kdo.jmeno);
  return { ok: true, id: id, psp: psp, helpdesk: vysledek.helpdesk,
           zprava: 'Hotovo, pobočce odešla odpověď.' };
}

/**
 * Dopsání PSP, odpověď pobočce a uzavření ticketu.
 *
 * Volá se ze dvou míst – ze čtečky (apiPsp_) a z hlídání tabulky
 * (dokonciPodlePsp), protože PSP vystavuje SO a číslo se často dopisuje
 * rovnou do tabulky, ne na čtečce.
 */
function uzavriSPsp_(list, radek, psp, kdoText) {
  const stav = list.getRange(radek, SL.STAV).getValue();
  if (stav !== STAV_NALOZENO) {
    throw new Error('Požadavek není ve stavu „naloženo" (je: ' + stav + ').');
  }

  const hodnoty = list.getRange(radek, 1, 1, SL_POCET).getValues()[0];
  const id = hodnoty[SL.ID - 1];

  list.getRange(radek, SL.PSP).setValue(psp);
  list.getRange(radek, SL.STAV).setValue(STAV_UZAVRENO);
  list.getRange(radek, SL.UZAVRENO).setValue(new Date());
  obarviRadek_(list, radek);

  const vydej = hodnoty[SL.VYDEJ - 1];
  const text =
    '### ODPOVED ROTACE v1\n' +
    'ID pozadavku: ' + id + '\n' +
    'Stav: NALOZENO\n' +
    'Nas klic: ' + id + '\n' +
    'Sklad: ' + hodnoty[SL.SKLAD - 1] + '\n' +
    'Pobocka: ' + hodnoty[SL.POBOCKA - 1] + '\n' +
    'ID stroje pozadovane: ' + hodnoty[SL.STROJ_POZ - 1] + '\n' +
    'ID stroje nalozene: ' + hodnoty[SL.STROJ_SKUT - 1] + '\n' +
    'PSP: ' + psp + '\n' +
    'Nalozeno: ' + (vydej ? formatDatumCas_(new Date(vydej)) : '') + '\n' +
    'Nakladka: ' + formatNakladku_(hodnoty[SL.NAKLADKA - 1]) + '\n' +
    '### KONEC';

  const ticketId = hodnoty[SL.TICKET - 1];
  let odpoved = 'bez ticketu';

  if (ticketId) {
    try {
      const vysledekOdpovedi = rtOdpovez_(ticketId, text, hodnoty[SL.ODPOVED_NA - 1]);
      const vysledekUzavreni = rtUzavri_(ticketId);
      // Co RT doopravdy udělal, stojí na řádku s #, ne ve stavovém řádku.
      odpoved = 'ticket ' + ticketId +
        ' | odpověď: ' + rtHlaskaOdpovedi_(vysledekOdpovedi.text) +
        ' | uzavření: ' + rtHlaskaOdpovedi_(vysledekUzavreni.text);
    } catch (err) {
      odpoved = 'CHYBA: ' + err.message;
    }
  }

  log_('PSP A UZAVŘENÍ', id, 'OK', psp + ' | ' + odpoved + ' | ' + (kdoText || ''));

  return { helpdesk: odpoved };
}

/**
 * Hlídá tabulku: kde je stav „naloženo (čeká PSP)" a někdo dopsal číslo PSP,
 * odejde odpověď pobočce a ticket se uzavře.
 *
 * Běží jako součást minutové kontroly, takže se nemusí nic mačkat –
 * stačí číslo PSP napsat do sloupce PSP a nechat být.
 */
function dokonciPodlePsp() {
  const list = list_(LIST_ROTACE);
  const posledni = list.getLastRow();
  if (posledni < 2) return;

  const hodnoty = list.getRange(2, 1, posledni - 1, SL_POCET).getValues();

  hodnoty.forEach((radek, index) => {
    if (radek[SL.STAV - 1] !== STAV_NALOZENO) return;

    const psp = String(radek[SL.PSP - 1] || '').trim();
    if (!psp) return;

    try {
      uzavriSPsp_(list, index + 2, psp, 'dopsáno v tabulce');
    } catch (err) {
      log_('UZAVŘENÍ Z TABULKY', radek[SL.ID - 1], 'CHYBA', err.message);
    }
  });
}

function apiNesplneno_(id, duvod, kdo) {
  if (!id) throw new Error('Chybí ID požadavku.');

  const list = list_(LIST_ROTACE);
  const radek = najdiRadekPozadavku_(id);
  if (!radek) throw new Error('Požadavek ' + id + ' v tabulce není.');

  overSklad_(list, radek, kdo);

  list.getRange(radek, SL.STAV).setValue(STAV_NESPLNENO);
  list.getRange(radek, SL.POZNAMKA).setValue(duvod || '');
  list.getRange(radek, SL.UZAVRENO).setValue(new Date());
  obarviRadek_(list, radek);

  const ticketId = list.getRange(radek, SL.TICKET).getValue();
  if (ticketId) {
    const text =
      '### ODPOVED ROTACE v1\n' +
      'ID pozadavku: ' + id + '\n' +
      'Stav: NESPLNENO\n' +
      'Nas klic: ' + id + '\n' +
      'Duvod: ' + (duvod || 'NEUVEDEN') + '\n' +
      '### KONEC';
    try { rtOdpovez_(ticketId, text); rtUzavri_(ticketId); } catch (err) { /* zapsáno níž */ }
  }

  log_('NESPLNĚNO', id, 'OK', duvod || '');
  return { ok: true, id: id };
}
