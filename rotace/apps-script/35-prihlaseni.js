// ============================================================
// Přihlášení skladníka – stejný princip jako ve WMS.
// ============================================================
// Skladník nejdřív vybere SKLAD, pak teprve dostane seznam jmen pro ten sklad.
// Po zadání PINu vydá skript podepsaný klíč, který nese jméno, sklad a platnost.
//
// ⚠ Sklad se bere VŽDY z klíče, nikdy z parametru v adrese. Jinak by stačilo
// přepsat adresu a skladník z Prostějova by viděl úžické požadavky.
//
// PIN se do čtečky nikdy neposílá. Pět chybných pokusů = pauza 5 minut;
// tu pauzu neodstraňovat, u čtyřmístného PINu je to jediná skutečná zábrana.

const LIST_UZIVATELE = 'UZIVATELE';
const PLATNOST_HODIN = 12;
const MAX_POKUSU = 5;
const PAUZA_MINUT = 5;

function tajemstvi_() {
  const vlastnosti = PropertiesService.getScriptProperties();
  let tajne = vlastnosti.getProperty('ROTACE_SECRET');
  if (!tajne) {
    // Vyrobí se samo při prvním přihlášení, nikam se nevypisuje.
    tajne = Utilities.getUuid() + Utilities.getUuid();
    vlastnosti.setProperty('ROTACE_SECRET', tajne);
  }
  return tajne;
}

function podpis_(text) {
  const bajty = Utilities.computeHmacSha256Signature(text, tajemstvi_());
  return Utilities.base64EncodeWebSafe(bajty);
}

/**
 * Sloupce listu UZIVATELE hledáme PODLE NÁZVU, ne podle pozice.
 *
 * Důvod: ten list už existuje a patří WMS (`Jméno | PIN | Aktivní`).
 * Rotace k němu potřebuje navíc `Sklad`. Kdybychom se spoléhali na pořadí,
 * stačilo by přidat sloupec doprostřed a rozbilo by se přihlašování –
 * buď nám, nebo WMS.
 */
function sloupceUzivatelu_() {
  const list = list_(LIST_UZIVATELE);
  const hlavicka = list.getRange(1, 1, 1, Math.max(1, list.getLastColumn())).getValues()[0];

  const uprav = text => String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // pryč s diakritikou
    .toLowerCase().trim();

  const mapa = {};
  hlavicka.forEach((nazev, index) => { mapa[uprav(nazev)] = index; });

  return {
    list: list,
    jmeno: mapa['jmeno'],
    pin: mapa['pin'],
    sklad: mapa['sklad'],
    aktivni: mapa['aktivni'],
    sirka: Math.max(1, list.getLastColumn())
  };
}

function uzivateleVse_() {
  const s = sloupceUzivatelu_();
  const posledni = s.list.getLastRow();
  if (posledni < 2) return [];

  if (s.jmeno === undefined || s.pin === undefined) {
    throw new Error('V listu UZIVATELE chybí sloupec Jméno nebo PIN.');
  }
  if (s.sklad === undefined) {
    throw new Error('V listu UZIVATELE chybí sloupec Sklad – spusť nastavUzivatele().');
  }

  const hodnoty = s.list.getRange(2, 1, posledni - 1, s.sirka).getValues();

  return hodnoty.map(radek => ({
    jmeno: String(radek[s.jmeno] || '').trim(),
    pin: String(radek[s.pin] || '').trim(),
    sklad: String(radek[s.sklad] || '').toUpperCase().trim(),
    aktivni: s.aktivni === undefined ? 'ANO' : String(radek[s.aktivni] || '').toUpperCase().trim()
  })).filter(u => u.jmeno);
}

/** Jména pro daný sklad. PINy se nikam nevracejí. */
function apiUzivatele_(sklad) {
  const kdeSklad = String(sklad || '').toUpperCase().trim();
  if (!SKLADY[kdeSklad]) throw new Error('Neznámý sklad.');

  const jmena = uzivateleVse_()
    .filter(u => u.sklad === kdeSklad && u.aktivni !== 'NE')
    .map(u => u.jmeno);

  return { ok: true, sklad: kdeSklad, nazev: SKLADY[kdeSklad], jmena: jmena };
}

function klicPauzy_(jmeno) {
  return 'POKUSY_' + String(jmeno).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function apiPrihlaseni_(jmeno, pin, sklad) {
  const vlastnosti = PropertiesService.getScriptProperties();
  const klicPokusu = klicPauzy_(jmeno);
  const ulozene = JSON.parse(vlastnosti.getProperty(klicPokusu) || '{"pocet":0,"do":0}');

  if (ulozene.do && new Date().getTime() < ulozene.do) {
    const zbyva = Math.ceil((ulozene.do - new Date().getTime()) / 60000);
    throw new Error('Příliš mnoho chybných pokusů. Zkus to za ' + zbyva + ' min.');
  }

  const kdeSklad = String(sklad || '').toUpperCase().trim();
  const uzivatel = uzivateleVse_().filter(u =>
    u.jmeno === String(jmeno).trim() && u.sklad === kdeSklad && u.aktivni !== 'NE'
  )[0];

  const sedi = uzivatel && uzivatel.pin && uzivatel.pin === String(pin).trim();

  if (!sedi) {
    const pocet = (ulozene.pocet || 0) + 1;
    const doKdy = pocet >= MAX_POKUSU ? new Date().getTime() + PAUZA_MINUT * 60000 : 0;
    vlastnosti.setProperty(klicPokusu, JSON.stringify({ pocet: doKdy ? 0 : pocet, do: doKdy }));

    log_('CHYBNÝ PIN', jmeno, 'CHYBA', kdeSklad + ', pokus ' + pocet);
    throw new Error(doKdy
      ? 'Pětkrát špatně. Zkus to za ' + PAUZA_MINUT + ' minut.'
      : 'Špatný PIN. Zbývá pokusů: ' + (MAX_POKUSU - pocet) + '.');
  }

  vlastnosti.deleteProperty(klicPokusu);

  const platnostDo = new Date().getTime() + PLATNOST_HODIN * 3600000;
  const zaklad = uzivatel.jmeno + '|' + uzivatel.sklad + '|' + platnostDo;
  const klic = Utilities.base64EncodeWebSafe(zaklad) + '.' + podpis_(zaklad);

  log_('PŘIHLÁŠENÍ', uzivatel.jmeno, 'OK', uzivatel.sklad);

  return {
    ok: true, klic: klic, jmeno: uzivatel.jmeno,
    sklad: uzivatel.sklad, nazev: SKLADY[uzivatel.sklad], platnostDo: platnostDo
  };
}

/** Rozbalí klíč a ověří podpis. Vrací { jmeno, sklad }. */
function overKlic_(klic) {
  if (!klic) throw new Error('Nepřihlášeno.');

  const casti = String(klic).split('.');
  if (casti.length !== 2) throw new Error('Nepřihlášeno.');

  const zaklad = Utilities.newBlob(Utilities.base64DecodeWebSafe(casti[0])).getDataAsString();
  if (podpis_(zaklad) !== casti[1]) throw new Error('Neplatné přihlášení.');

  const [jmeno, sklad, platnostDo] = zaklad.split('|');
  if (new Date().getTime() > Number(platnostDo)) throw new Error('Přihlášení vypršelo, přihlas se znovu.');

  return { jmeno: jmeno, sklad: sklad };
}

// ------------------------------------------------------------
// Založení listu UZIVATELE
// ------------------------------------------------------------

/**
 * Připraví list UZIVATELE pro rotaci.
 *
 * Ten list už ve zkopírované tabulce existuje a patří WMS
 * (`Jméno | PIN | Aktivní`). Proto se nic nepřepisuje ani nevkládá doprostřed –
 * sloupec `Sklad` se přidá **na konec**, aby se WMS nerozbilo, kdyby si
 * sloupce hledalo podle pozice.
 *
 * Stávajícím skladníkům se předvyplní **S096**, protože WMS dnes běží jen
 * na CS2 Úžice. Kdo patří jinam, přepiš ručně.
 */
function nastavUzivatele() {
  const ss = tabulka_();
  const byl = !!ss.getSheetByName(LIST_UZIVATELE);
  const list = zalozList_(ss, LIST_UZIVATELE, ['Jméno', 'PIN', 'Sklad', 'Aktivní']);

  let s = sloupceUzivatelu_();

  // 1) Chybí sloupec Sklad? Přidat na konec.
  if (s.sklad === undefined) {
    const novy = list.getLastColumn() + 1;
    list.getRange(1, novy).setValue('Sklad').setFontWeight('bold').setBackground('#d9d9d9');
    Logger.log('Přidán sloupec Sklad na pozici ' + novy + '.');
    SpreadsheetApp.flush();
    s = sloupceUzivatelu_();
  }

  // 2) Doplnit sklad tam, kde chybí.
  const posledni = list.getLastRow();
  let doplneno = 0;

  if (posledni >= 2) {
    const sloupecSkladu = s.sklad + 1;
    const hodnoty = list.getRange(2, sloupecSkladu, posledni - 1, 1).getValues();
    const jmena = list.getRange(2, s.jmeno + 1, posledni - 1, 1).getValues();

    for (let i = 0; i < hodnoty.length; i++) {
      if (!jmena[i][0]) continue;
      if (!String(hodnoty[i][0] || '').trim()) {
        hodnoty[i][0] = 'S096';
        doplneno++;
      }
    }
    list.getRange(2, sloupecSkladu, posledni - 1, 1).setValues(hodnoty);
  }

  // 3) Když byl list prázdný, založit dva zkušební skladníky.
  let zalozeni = [];
  if (list.getLastRow() < 2) {
    const pin = () => String(Math.floor(1000 + Math.random() * 9000));
    zalozeni = [
      ['Skladník CS2', pin(), 'S096', 'ANO'],
      ['Skladník CS1', pin(), 'S093', 'ANO']
    ];
    list.getRange(2, 1, zalozeni.length, 4).setValues(zalozeni);
  }

  const prehled = uzivateleVse_();
  const zprava = [
    byl ? 'List UZIVATELE už existoval – upraven, nic se nepřepsalo.' : 'List UZIVATELE založen.',
    'Doplněn sklad S096 u ' + doplneno + ' skladníků (přepiš ručně, kdo patří jinam).',
    'Celkem skladníků: ' + prehled.length
  ];

  Object.keys(SKLADY).forEach(kod => {
    zprava.push('  ' + kod + ': ' + prehled.filter(u => u.sklad === kod && u.aktivni !== 'NE').length);
  });

  const bezPinu = prehled.filter(u => !u.pin).map(u => u.jmeno);
  if (bezPinu.length) zprava.push('⚠ Bez PINu (nepřihlásí se): ' + bezPinu.join(', '));

  if (zalozeni.length) {
    zprava.push('', 'Založeni zkušební skladníci:');
    zalozeni.forEach(r => zprava.push('  ' + r[0] + ' (' + r[2] + ') – PIN ' + r[1]));
  }

  Logger.log(zprava.join('\n'));
}

/**
 * Hromadně přiřadí sklad vybraným skladníkům.
 * Použití: prirazSklad(['Novák Jan', 'Svoboda Petr'], 'S093')
 */
function prirazSklad(jmena, sklad) {
  const s = sloupceUzivatelu_();
  const posledni = s.list.getLastRow();
  if (posledni < 2) { Logger.log('Žádní skladníci.'); return; }

  const hledana = (jmena || []).map(j => String(j).trim().toLowerCase());
  const radky = s.list.getRange(2, 1, posledni - 1, s.sirka).getValues();
  let zmeneno = 0;

  radky.forEach((radek, index) => {
    const jmeno = String(radek[s.jmeno] || '').trim().toLowerCase();
    if (hledana.indexOf(jmeno) === -1) return;
    s.list.getRange(index + 2, s.sklad + 1).setValue(String(sklad).toUpperCase());
    zmeneno++;
  });

  Logger.log('Změněno ' + zmeneno + ' z ' + hledana.length + ' hledaných jmen.');
}
