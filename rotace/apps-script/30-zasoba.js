// ============================================================
// Skladová zásoba strojů na CS.
// Dnes ji nikdo jiný nevede, takže ji drží tenhle list. Přírůstek při příjmu,
// úbytek při výdeji. Pro zkoušku se naplní vymyšlenými stroji – viz 50-setup.js.
// ============================================================

const ZS = { STROJ: 1, PSK: 2, NAZEV: 3, SKLAD: 4, LOKACE: 5, STAV: 6, POHYB: 7 };
const ZS_POCET = 7;

const ZASOBA_NA_SKLADE = 'na skladě';
const ZASOBA_VYDANO = 'vydáno';

function zasobaVse_() {
  const list = list_(LIST_ZASOBA);
  const posledni = list.getLastRow();
  if (posledni < 2) return [];

  return list.getRange(2, 1, posledni - 1, ZS_POCET).getValues().map((radek, i) => ({
    radek: i + 2,
    stroj: String(radek[ZS.STROJ - 1]).toUpperCase().trim(),
    psk: String(radek[ZS.PSK - 1]).toUpperCase().trim(),
    nazev: radek[ZS.NAZEV - 1],
    sklad: String(radek[ZS.SKLAD - 1]).toUpperCase().trim(),
    lokace: radek[ZS.LOKACE - 1],
    stav: radek[ZS.STAV - 1]
  }));
}

function zasobaNajdiStroj_(idStroje) {
  const hledany = String(idStroje).toUpperCase().trim();
  return zasobaVse_().filter(s => s.stroj === hledany)[0] || null;
}

/** Co na skladě leží ze stejné skupiny – nabídka náhrady, když kus nejde vydat. */
function zasobaSkupina_(psk, sklad) {
  const skupina = String(psk).toUpperCase().trim();
  const kdeSklad = String(sklad).toUpperCase().trim();

  return zasobaVse_().filter(s =>
    s.psk === skupina && s.sklad === kdeSklad && s.stav === ZASOBA_NA_SKLADE
  );
}

function zasobaOznacVydano_(radek) {
  const list = list_(LIST_ZASOBA);
  list.getRange(radek, ZS.STAV).setValue(ZASOBA_VYDANO);
  list.getRange(radek, ZS.POHYB).setValue(new Date());
  list.getRange(radek, 1, 1, ZS_POCET).setBackground('#efefef');
}

/** Příjem stroje na CS – přibude do zásoby, nebo se vrátí ten, co odjel. */
function zasobaPrijem_(idStroje, psk, nazev, sklad, lokace) {
  const list = list_(LIST_ZASOBA);
  const existujici = zasobaNajdiStroj_(idStroje);

  if (existujici) {
    list.getRange(existujici.radek, ZS.SKLAD).setValue(String(sklad).toUpperCase());
    list.getRange(existujici.radek, ZS.LOKACE).setValue(lokace || '');
    list.getRange(existujici.radek, ZS.STAV).setValue(ZASOBA_NA_SKLADE);
    list.getRange(existujici.radek, ZS.POHYB).setValue(new Date());
    list.getRange(existujici.radek, 1, 1, ZS_POCET).setBackground(null);
    return existujici.radek;
  }

  list.appendRow([
    String(idStroje).toUpperCase(), String(psk).toUpperCase(), nazev || '',
    String(sklad).toUpperCase(), lokace || '', ZASOBA_NA_SKLADE, new Date()
  ]);
  return list.getLastRow();
}
