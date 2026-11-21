// ============================================================
// Naskladnění: co přijede na CS, přibude do ZASOBA_CS
// ============================================================
// Zásoba se udržuje ze dvou stran:
//   ÚBYTEK  – při výdeji na čtečce (40-webapp.js → apiVydej_)
//   PŘÍRŮSTEK – tady, z listu POHYBY, který plní WMS při příjmu na CS
//
// Pravidlo: do zásoby patří stroj, jehož PSP míří **na centrální sklad**,
// ne na pobočku. Takový doklad je doplnění zásoby. Běžný přesun
// pobočka → pobočka přes CS jen projede a do zásoby nepatří.
//
// ⚠ POHYBY plní WMS, které dnes běží jen na CS2 Úžice. Dokud nebudou čtečky
// na CS1 Prostějov, naskladnění se tam samo nenačte.

// Kódy, které bereme jako „centrální sklad" v cílovém poli dokladu.
// OVĚŘIT u Jany: patří sem i S095 (CS1 Úžice)? V zadání rotace byly
// sklady S096 a S093, v pozdější zprávě padlo S093 a S095.
const KODY_SKLADU_CS = ['S096', 'S093'];

const LIST_POHYBY = 'POHYBY';

function sloupcePohybu_() {
  const list = tabulka_().getSheetByName(LIST_POHYBY);
  if (!list) return null;

  const sirka = Math.max(1, list.getLastColumn());
  const hlavicka = list.getRange(1, 1, 1, sirka).getValues()[0]
    .map(h => String(h || '').trim().toLowerCase());

  return {
    list: list,
    sirka: sirka,
    cas: hlavicka.indexOf('čas'),
    stroj: hlavicka.indexOf('id stroje'),
    nazev: hlavicka.indexOf('název'),
    psp: hlavicka.indexOf('psp'),
    akce: hlavicka.indexOf('akce'),
    kamKod: hlavicka.indexOf('pobočka kam (kód)'),
    lokace: hlavicka.indexOf('lokace cs2')
  };
}

/**
 * Dohledá skupinu (PSK) pro stroj, který přijel.
 * 1) stroj už v zásobě byl – vezmeme jeho skupinu
 * 2) podle názvu položky, když stejný název v zásobě je
 * 3) nic – zapíše se prázdné a nahlásí se, protože bez PSK nejde nabídnout náhrada
 */
function dohledejPsk_(idStroje, nazev) {
  const zasoba = zasobaVse_();

  const podleStroje = zasoba.filter(s => s.stroj === String(idStroje).toUpperCase().trim())[0];
  if (podleStroje && podleStroje.psk) return podleStroje.psk;

  const hledanyNazev = String(nazev || '').trim().toLowerCase();
  if (hledanyNazev) {
    const podleNazvu = zasoba.filter(s =>
      String(s.nazev || '').trim().toLowerCase() === hledanyNazev && s.psk)[0];
    if (podleNazvu) return podleNazvu.psk;
  }

  return '';
}

/** Projde nové řádky v POHYBY a naskladní, co přijelo na centrální sklad. */
function naskladniZPohybu() {
  const s = sloupcePohybu_();
  if (!s) { Logger.log('List POHYBY v tabulce není – není co načítat.'); return; }

  if (s.stroj < 0 || s.akce < 0 || s.kamKod < 0) {
    Logger.log('POHYBY nemá čekané sloupce (ID stroje / Akce / Pobočka kam (kód)).');
    return;
  }

  const posledniRadek = s.list.getLastRow();
  const zpracovanoDo = Number(hodnotaControl_('POSLEDNI_POHYB_RADEK') || 1);

  if (posledniRadek <= zpracovanoDo) return;   // nic nového

  const pocet = posledniRadek - zpracovanoDo;
  const hodnoty = s.list.getRange(zpracovanoDo + 1, 1, pocet, s.sirka).getValues();

  let naskladneno = 0, bezPsk = 0, jinySklad = 0;

  hodnoty.forEach(radek => {
    const akce = String(radek[s.akce] || '').toUpperCase();
    if (akce.indexOf('PŘÍJEM') === -1 && akce.indexOf('PRIJEM') === -1) return;

    const stroj = String(radek[s.stroj] || '').toUpperCase().trim();
    if (!stroj) return;   // příslušenství bez ID stroje se do zásoby nevede

    const kam = String(radek[s.kamKod] || '').toUpperCase().trim();

    if (KODY_SKLADU_CS.indexOf(kam) === -1) {
      // Doklad míří na pobočku – stroj jen projíždí, do zásoby nepatří.
      if (/^S0\d\d$/.test(kam)) {
        jinySklad++;
        log_('PŘÍJEM NA JINÝ SKLAD', stroj, 'POZOR',
          'Doklad míří na ' + kam + ', což není mezi sklady rotace. Ověřit.');
      }
      return;
    }

    const nazev = s.nazev >= 0 ? radek[s.nazev] : '';
    const lokace = s.lokace >= 0 ? radek[s.lokace] : '';
    const psk = dohledejPsk_(stroj, nazev);

    zasobaPrijem_(stroj, psk, nazev, kam, lokace);
    naskladneno++;

    if (!psk) {
      bezPsk++;
      log_('NASKLADNĚNO BEZ SKUPINY', stroj, 'POZOR',
        'Nepodařilo se určit PSK pro „' + nazev + '". Bez skupiny nejde nabídnout jako náhrada.');
    } else {
      log_('NASKLADNĚNO', stroj, 'OK', psk + ', ' + kam + (lokace ? ', lokace ' + lokace : ''));
    }
  });

  nastavControl_('POSLEDNI_POHYB_RADEK', posledniRadek);

  if (naskladneno || jinySklad) {
    log_('SOUHRN NASKLADNĚNÍ', '', 'OK',
      'naskladněno: ' + naskladneno + ', bez skupiny: ' + bezPsk + ', jiný sklad: ' + jinySklad);
  }

  Logger.log('Prošlo ' + pocet + ' nových řádků POHYBY, naskladněno ' + naskladneno + '.');
}

/**
 * Jednorázově: naskladnit z CELÉHO listu POHYBY, ne jen z nových řádků.
 * Hodí se při prvním spuštění, aby se zásoba načetla zpětně.
 * Pozor: čím delší POHYBY, tím déle to poběží.
 */
function naskladniZpetne() {
  nastavControl_('POSLEDNI_POHYB_RADEK', 1);
  naskladniZPohybu();
}

/** Kde se zásoba právě nachází – rychlý přehled do protokolu. */
function prehledZasoby() {
  const zasoba = zasobaVse_();
  const zpravy = ['Strojů v zásobě celkem: ' + zasoba.length];

  KODY_SKLADU_CS.forEach(kod => {
    const naSklade = zasoba.filter(s => s.sklad === kod && s.stav === ZASOBA_NA_SKLADE);
    const vydano = zasoba.filter(s => s.sklad === kod && s.stav !== ZASOBA_NA_SKLADE);
    zpravy.push(kod + ': na skladě ' + naSklade.length + ', vydáno ' + vydano.length);
  });

  const bezPsk = zasoba.filter(s => !s.psk);
  if (bezPsk.length) {
    zpravy.push('⚠ Bez skupiny PSK: ' + bezPsk.length + ' (' +
      bezPsk.slice(0, 10).map(s => s.stroj).join(', ') + ')');
  }

  Logger.log(zpravy.join('\n'));
  return zpravy.join('\n');
}
