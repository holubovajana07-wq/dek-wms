// ============================================================
// Hlavní práce robota: přečíst požadavky z helpu a zapsat je do listu ROTACE.
// Spouští se časovou spouští po 2 minutách – viz 50-setup.js.
// ============================================================

const SL = {   // sloupce listu ROTACE (1 = A)
  ID: 1, TICKET: 2, PRIJATO: 3, SKLAD: 4, POBOCKA: 5,
  STROJ_POZ: 6, PSK: 7, NAZEV: 8, NAKLADKA: 9, STAV: 10,
  STROJ_SKUT: 11, LOKACE: 12, VYDEJ: 13, PSP: 14, UZAVRENO: 15,
  POZNAMKA: 16, REZIM: 17, ODPOVED_NA: 18
};
const SL_POCET = 18;

/** Rozebere blok klíč: hodnota z těla požadavku. */
function rozeberPozadavek_(telo) {
  const text = String(telo || '');

  const zacatek = text.indexOf(BLOK_START);
  if (zacatek === -1) return null;

  const konec = text.indexOf(BLOK_KONEC, zacatek);
  const blok = text.slice(zacatek + BLOK_START.length, konec === -1 ? undefined : konec);

  const pole = {};
  blok.split('\n').forEach(radek => {
    const shoda = radek.match(/^\s*([A-Za-z_ ]+?)\s*:\s*(.*?)\s*$/);
    if (shoda) pole[shoda[1].trim().toLowerCase()] = shoda[2].trim();
  });

  return pole;
}

function zkontrolujPozadavek_(pole) {
  const chybi = [];
  ['id pozadavku', 'akce', 'sklad', 'pobocka', 'id stroje', 'psk', 'nakladka']
    .forEach(klic => { if (!pole[klic]) chybi.push(klic); });

  if (chybi.length) return 'Chybí povinné údaje: ' + chybi.join(', ');

  const sklad = String(pole['sklad']).toUpperCase();
  if (!SKLADY[sklad]) return 'Neznámý sklad: ' + pole['sklad'] + ' (čekáme S096 nebo S093)';

  const akce = String(pole['akce']).toUpperCase();
  if (['NOVY', 'ZMENA', 'STORNO'].indexOf(akce) === -1) return 'Neznámá akce: ' + pole['akce'];

  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(pole['nakladka'])) {
    return 'Nakladka musí být ve tvaru RRRR-MM-DD HH:MM, přišlo: ' + pole['nakladka'];
  }

  return '';
}

function najdiRadekPozadavku_(idPozadavku) {
  const list = list_(LIST_ROTACE);
  const posledni = list.getLastRow();
  if (posledni < 2) return 0;

  const hodnoty = list.getRange(2, SL.ID, posledni - 1, 1).getValues();
  for (let i = 0; i < hodnoty.length; i++) {
    if (String(hodnoty[i][0]).trim() === String(idPozadavku).trim()) return i + 2;
  }
  return 0;
}

// ------------------------------------------------------------
// Paměť už prohlédnutých ticketů
// ------------------------------------------------------------
// RT bere v dotazu `Created > ...` jen datum, čas ignoruje. Filtr podle času
// tedy sám o sobě nestačí – fronta by se celý den dokola vracela celá.
// Proto si vedeme seznam ticketů, na které jsme se už podívali.
// Bez toho se každou minutu znovu stahovalo 30 ticketů (= přes 40 000 dotazů
// denně, nad limit Apps Scriptu) a do logu padala pořád tatáž chyba.

const PAMET_TICKETU = 300;

function videneTickety_() {
  const ulozene = String(hodnotaControl_('VIDENE_TICKETY') || '');
  return new Set(ulozene.split(',').filter(x => x));
}

function zapamatujTicket_(mnozina, ticketId) {
  mnozina.add(String(ticketId));
}

function ulozVidene_(mnozina) {
  const seznam = Array.from(mnozina).slice(-PAMET_TICKETU);
  nastavControl_('VIDENE_TICKETY', seznam.join(','));
}

/** Jediný vstupní bod: projde nové ticketky a zapíše z nich požadavky. */
function nactiPozadavky() {
  const zamek = LockService.getScriptLock();
  if (!zamek.tryLock(10000)) return;   // běží předchozí spuštění, nevadí

  try {
    const ted = new Date();
    const videne = videneTickety_();
    const idcka = rtNajdiNoveTickety_().filter(id => !videne.has(String(id)));

    let zapsano = 0, preskoceno = 0, chyb = 0;

    idcka.forEach(ticketId => {
      try {
        const hlavicka = rtGet_('/REST/1.0/ticket/' + ticketId + '/show');
        const predmet = rtHodnota_(hlavicka, 'Subject');

        // Zapamatujeme si až ten, na který jsme se opravdu podívali.
        // Když spojení selže, ticket se příště zkusí znovu.
        zapamatujTicket_(videne, ticketId);

        // Není náš ticket – nesaháme na něj a necháme ho ostatním.
        if (predmet.toUpperCase().indexOf(PREDMET_KLIC) === -1) return;

        const telo = rtTeloTicketu_(ticketId);
        const pole = rozeberPozadavek_(telo);

        if (!pole) {
          chyb++;
          log_('POŽADAVEK NEROZPOZNÁN', ticketId, 'CHYBA', 'V těle není blok ' + BLOK_START);
          return;
        }

        const chyba = zkontrolujPozadavek_(pole);
        if (chyba) {
          chyb++;
          log_('POŽADAVEK VADNÝ', pole['id pozadavku'] || ticketId, 'CHYBA', chyba);
          return;
        }

        const vysledek = zapisPozadavek_(pole, ticketId);
        if (vysledek === 'zapsano') zapsano++; else preskoceno++;

      } catch (err) {
        chyb++;
        log_('CHYBA ZPRACOVÁNÍ TICKETU', ticketId, 'CHYBA', err.message);
      }
    });

    nastavControl_('POSLEDNI_KONTROLA', formatDatumCas_(ted));
    ulozVidene_(videne);

    // Při stejném kolečku se podíváme i na to, jestli někdo nedopsal PSP
    // do tabulky – pak odejde odpověď pobočce a ticket se uzavře.
    try { dokonciPodlePsp(); } catch (err) { log_('DOKONČENÍ PODLE PSP', '', 'CHYBA', err.message); }

    if (zapsano || chyb) {
      log_('SOUHRN', '', 'OK', 'zapsáno: ' + zapsano + ', přeskočeno: ' + preskoceno + ', chyb: ' + chyb);
    }

  } finally {
    zamek.releaseLock();
  }
}

function zapisPozadavek_(pole, ticketId) {
  const list = list_(LIST_ROTACE);
  const id = pole['id pozadavku'];
  const akce = String(pole['akce']).toUpperCase();
  const radek = najdiRadekPozadavku_(id);

  if (akce === 'STORNO') {
    if (!radek) {
      log_('STORNO BEZ POŽADAVKU', id, 'CHYBA', 'Takový požadavek v tabulce není');
      return 'preskoceno';
    }
    const stav = list.getRange(radek, SL.STAV).getValue();
    if (stav === STAV_NALOZENO || stav === STAV_UZAVRENO) {
      log_('STORNO POZDĚ', id, 'CHYBA', 'Stroj už je naložený, storno se neprovedlo');
      return 'preskoceno';
    }
    list.getRange(radek, SL.STAV).setValue(STAV_ZRUSENO);
    obarviRadek_(list, radek);
    log_('STORNO', id, 'OK', '');
    return 'zapsano';
  }

  // Tentýž požadavek podruhé (přeposlaný mail) – nezakládat znovu.
  if (radek && akce === 'NOVY') {
    log_('DUPLICITA', id, 'PŘESKOČENO', 'Požadavek už v tabulce je, řádek ' + radek);
    return 'preskoceno';
  }

  const hodnoty = [
    id,
    ticketId,
    new Date(),
    String(pole['sklad']).toUpperCase(),
    String(pole['pobocka']).toUpperCase(),
    String(pole['id stroje']).toUpperCase(),
    String(pole['psk']).toUpperCase(),
    pole['nazev'] || '',
    pole['nakladka'],
    STAV_K_VYDEJI,
    '', '', '', '', '',
    '',
    (pole['rezim'] || 'OSTRY').toUpperCase(),
    pole['odpoved na'] || ''      // adresa aplikace půjčovny, chodí jí kopie
  ];

  const cilovy = radek || list.getLastRow() + 1;
  list.getRange(cilovy, 1, 1, SL_POCET).setValues([hodnoty]);
  obarviRadek_(list, cilovy);
  zkontrolujDostupnost_(list, cilovy);   // sedí stroj se skladovou zásobou?

  log_(radek ? 'ZMĚNA' : 'NOVÝ POŽADAVEK', id, 'OK',
    pole['sklad'] + ' → ' + pole['pobocka'] + ', stroj ' + pole['id stroje']);

  odpovezPrijato_(ticketId, id, pole);
  presunDoFrontyRotace_(ticketId, id);
  return 'zapsano';
}

/**
 * Přehodí ticket z hlavní fronty do fronty rotace, aby tam kolegům nezacláněl.
 * Když fronta ještě neexistuje, nic se nestane – požadavek je zpracovaný tak
 * jako tak a v hlavní frontě ho zavře odpověď na konci procesu.
 */
let _frontaRotaceExistuje = null;   // zjišťuje se jednou za běh

function presunDoFrontyRotace_(ticketId, id) {
  if (!ticketId) return;

  if (_frontaRotaceExistuje === null) {
    _frontaRotaceExistuje = rtFrontaExistuje_(RT_FRONTA_ROTACE);
    if (!_frontaRotaceExistuje) {
      log_('FRONTA NEEXISTUJE', RT_FRONTA_ROTACE, 'PŘESKOČENO',
        'Ticket zůstal ve frontě ' + RT_FRONTA_VSTUP + '. Frontu musí založit správce helpdesku.');
    }
  }
  if (!_frontaRotaceExistuje) return;

  try {
    const vysledek = rtPresunDoFronty_(ticketId, RT_FRONTA_ROTACE);
    const ok = vysledek.kod === 200 && vysledek.text.indexOf('200 Ok') !== -1;
    log_('PŘESUN DO FRONTY', id, ok ? 'OK' : 'CHYBA',
      ok ? RT_FRONTA_ROTACE : String(vysledek.kod) + ' ' + vysledek.text.slice(0, 200));
  } catch (err) {
    log_('PŘESUN DO FRONTY', id, 'CHYBA', err.message);
  }
}

function odpovezPrijato_(ticketId, id, pole) {
  const text =
    '### ODPOVED ROTACE v1\n' +
    'ID pozadavku: ' + id + '\n' +
    'Stav: PRIJATO\n' +
    'Nas klic: ' + id + '\n' +
    'Sklad: ' + String(pole['sklad']).toUpperCase() + '\n' +
    'Nakladka: ' + pole['nakladka'] + '\n' +
    '### KONEC';

  try {
    const vysledek = rtOdpovez_(ticketId, text, pole['odpoved na']);
    log_('ODPOVĚĎ PRIJATO', id, 'OK', rtHlaskaOdpovedi_(vysledek.text));
  } catch (err) {
    log_('ODPOVĚĎ PRIJATO', id, 'CHYBA', err.message);
  }
}

/**
 * Porovná požadovaný stroj se skladovou zásobou a dá to v tabulce najevo.
 *
 * Řádek drží barvu podle stavu, problém se označí na buňce s ID stroje –
 * oranžově. Do Poznámky se napíše proč a kolik kusů ze skupiny je k dispozici,
 * aby bylo hned vidět, jestli stačí vzít náhradu, nebo je potřeba zasáhnout.
 */
function zkontrolujDostupnost_(list, radek) {
  const stroj = String(list.getRange(radek, SL.STROJ_POZ).getValue()).toUpperCase().trim();
  const psk = String(list.getRange(radek, SL.PSK).getValue()).toUpperCase().trim();
  const sklad = String(list.getRange(radek, SL.SKLAD).getValue()).toUpperCase().trim();

  const vZasobe = zasobaNajdiStroj_(stroj);
  let problem = '';

  if (!vZasobe) {
    problem = 'Stroj ' + stroj + ' není ve skladové zásobě';
  } else if (vZasobe.stav !== ZASOBA_NA_SKLADE) {
    problem = 'Stroj ' + stroj + ' je podle zásoby už vydaný';
  } else if (vZasobe.sklad !== sklad) {
    problem = 'Stroj ' + stroj + ' leží na ' + vZasobe.sklad + ', požadavek je na ' + sklad;
  } else if (psk && vZasobe.psk !== psk) {
    problem = 'Stroj ' + stroj + ' je v zásobě skupina ' + vZasobe.psk + ', v požadavku ' + psk;
  }

  const bunkaStroje = list.getRange(radek, SL.STROJ_POZ);

  if (!problem) {
    bunkaStroje.setBackground(null).setFontColor(null).setNote('');
    return false;
  }

  const nahrady = zasobaSkupina_(psk, sklad).length;
  const text = problem + '. Ze skupiny ' + psk + ' je na ' + sklad + ' k dispozici ' +
    nahrady + ' ks.';

  bunkaStroje.setBackground('#f6b26b').setFontColor('#783f04').setNote(text);

  const poznamka = list.getRange(radek, SL.POZNAMKA);
  const stavajici = String(poznamka.getValue() || '');
  if (stavajici.indexOf(problem) === -1) {
    poznamka.setValue(stavajici ? stavajici + ' | ' + text : text);
  }

  log_('STROJ MIMO ZÁSOBU', list.getRange(radek, SL.ID).getValue(), 'POZOR', text);
  return true;
}

/**
 * Překontroluje všechny požadavky, které čekají na výdej.
 * Zásoba se mění – stroj mohl mezitím odjet na jiný požadavek.
 * Spustit ručně, nebo si na to dát vlastní časovou spoušť (stačí po hodině).
 */
function prekontrolujDostupnost() {
  const list = list_(LIST_ROTACE);
  const posledni = list.getLastRow();
  if (posledni < 2) { Logger.log('Žádné požadavky.'); return; }

  const stavy = list.getRange(2, SL.STAV, posledni - 1, 1).getValues();
  let problemu = 0, zkontrolovano = 0;

  stavy.forEach((hodnota, index) => {
    if (hodnota[0] !== STAV_K_VYDEJI) return;
    zkontrolovano++;
    if (zkontrolujDostupnost_(list, index + 2)) problemu++;
  });

  Logger.log('Zkontrolováno ' + zkontrolovano + ' čekajících požadavků, problémů: ' + problemu);
}

/** Barva řádku podle stavu – ať je v tabulce vidět, co se děje. */
function obarviRadek_(list, radek) {
  const stav = list.getRange(radek, SL.STAV).getValue();
  const barvy = {};
  barvy[STAV_K_VYDEJI] = '#fff2cc';   // žlutá – čeká na skladníka
  barvy[STAV_NALOZENO] = '#f4cccc';   // červená – naloženo, čeká PSP
  barvy[STAV_UZAVRENO] = '#d9ead3';   // zelená – hotovo
  barvy[STAV_ZRUSENO] = '#efefef';
  barvy[STAV_NESPLNENO] = '#efefef';

  list.getRange(radek, 1, 1, SL_POCET).setBackground(barvy[stav] || null);
}
