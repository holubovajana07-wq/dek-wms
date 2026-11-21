// ============================================================
// Čtení a zápis do helpdesku (RT, helpdesk.dek.cz)
// Postavené na tom, jak to dělá ostrý robot (RT_API.js) – jen čte jinou frontu
// požadavků a navíc si bere TĚLO ticketu, ne jen předmět a přílohu.
// ============================================================

function rtGet_(cesta) {
  const token = vlastnost_('RT_TOKEN');
  if (!token) throw new Error('Chybí vlastnost skriptu RT_TOKEN.');

  const odpoved = UrlFetchApp.fetch(RT_BASE_URL + cesta, {
    method: 'get',
    headers: { Authorization: 'token ' + token },
    muteHttpExceptions: true
  });

  return odpoved.getContentText();
}

function rtPost_(cesta, obsah) {
  const token = vlastnost_('RT_TOKEN');
  if (!token) throw new Error('Chybí vlastnost skriptu RT_TOKEN.');

  const odpoved = UrlFetchApp.fetch(RT_BASE_URL + cesta, {
    method: 'post',
    headers: { Authorization: 'token ' + token },
    payload: { content: obsah },
    muteHttpExceptions: true
  });

  return { kod: odpoved.getResponseCode(), text: odpoved.getContentText() };
}

function rtHodnota_(text, klic) {
  const shoda = text.match(new RegExp('^' + klic + ':\\s*(.*)$', 'm'));
  return shoda ? shoda[1].trim() : '';
}

/**
 * Vrátí ID živých ticketů ve vstupní frontě, které vznikly po poslední kontrole.
 * Bereme `__Active__` (nové, otevřené i odložené), ne jen `new` – někdo mohl
 * požadavek v hlavní frontě mezitím otevřít a nám by utekl.
 */
function rtNajdiNoveTickety_() {
  const posledniKontrola = hodnotaControl_('POSLEDNI_KONTROLA');

  let dotaz = "Queue='" + RT_FRONTA_VSTUP + "' AND Status='__Active__'";
  dotaz += posledniKontrola
    ? " AND Created > '" + posledniKontrola + "'"
    : " AND Created > '1 days ago'";

  const text = rtGet_('/REST/1.0/search/ticket?query=' + encodeURIComponent(dotaz));

  const idcka = [];
  text.split('\n').forEach(radek => {
    const shoda = radek.match(/^(\d+):/);
    if (shoda) idcka.push(shoda[1]);
  });

  // Vstupní fronta je hlavní fronta skladu, chodí do ní spousta věcí, které
  // s rotací nemají nic společného. U každého ticketu se musíme doptat na
  // předmět, takže strop na jeden běh – jinak by se do šesti minut nevešel.
  return idcka.slice(-MAX_TICKETU_NA_BEH);
}

/** Přehodí ticket do jiné fronty. */
function rtPresunDoFronty_(ticketId, fronta) {
  return rtPost_('/REST/1.0/ticket/' + ticketId + '/edit', 'Queue: ' + fronta + '\n');
}

/**
 * Existuje fronta? Vrací true/false, chybu spolkne.
 *
 * ⚠ Pozor na past: když fronta NEexistuje, RT stejně odpoví `200 Ok` a v těle
 * pošle `# No queue named … exists.` **a k tomu `id: queue/<jméno>`** –
 * tedy řádek, který vypadá jako úspěch. Proto se ptáme na číselné id
 * (`id: queue/49`), ne jen na to, že se tam slovo „queue" vyskytuje.
 */
function rtFrontaExistuje_(nazev) {
  try {
    const text = rtGet_('/REST/1.0/queue/' + encodeURIComponent(nazev));
    if (rtStavOdpovedi_(text) !== 200) return false;
    if (/No queue named/i.test(text)) return false;
    return /^id:\s*queue\/\d+\s*$/m.test(text);
  } catch (err) {
    return false;
  }
}

/**
 * Tělo ticketu. `show` vrací jen hlavičky, text požadavku je až v historii.
 * Bereme první transakci typu Create.
 */
function rtTeloTicketu_(ticketId) {
  const text = rtGet_('/REST/1.0/ticket/' + ticketId + '/history?format=l');

  // Historie je rozdělená oddělovačem z pomlček; první blok je založení ticketu.
  const bloky = text.split(/\n--\n/);
  const prvni = bloky.length > 1 ? bloky[1] : text;

  const poziceObsahu = prvni.indexOf('Content:');
  if (poziceObsahu === -1) return prvni;

  const zbytek = prvni.slice(poziceObsahu + 'Content:'.length);

  // RT odsazuje pokračovací řádky mezerami – odsazení zahodíme.
  return zbytek
    .split('\n')
    .map(radek => radek.replace(/^\s{1,9}/, ''))
    .join('\n');
}

function rtOdpovez_(ticketId, text) {
  const telo = String(text || '')
    .split(/\r?\n/)
    .map(radek => ' ' + radek)
    .join('\n');

  return rtPost_('/REST/1.0/ticket/' + ticketId + '/comment',
    'Action: correspond\nText:\n' + telo + '\n');
}

function rtUzavri_(ticketId) {
  return rtPost_('/REST/1.0/ticket/' + ticketId + '/edit', 'Status: resolved\n');
}

/** Ověření, že se na helpdesk vůbec dostaneme. Spustit ručně. */
function testHelpdesk() {
  const dotaz = "Queue='" + RT_FRONTA_VSTUP + "' AND Created > '2 days ago'";
  const text = rtGet_('/REST/1.0/search/ticket?query=' + encodeURIComponent(dotaz));
  Logger.log('VSTUPNÍ FRONTA ' + RT_FRONTA_VSTUP + ':\n' + text.slice(0, 1500));
}

/** Zjistí, jestli cílová fronta existuje a jestli na ni token vidí. */
function testFronty() {
  const zpravy = [];

  [RT_FRONTA_VSTUP, RT_FRONTA_ROTACE].forEach(nazev => {
    let vysledek;
    try {
      const text = rtGet_('/REST/1.0/queue/' + encodeURIComponent(nazev));
      vysledek = text.split('\n').slice(0, 8).join(' | ');
    } catch (err) {
      vysledek = 'CHYBA: ' + err.message;
    }
    zpravy.push('--- ' + nazev + '\n' + vysledek);
  });

  Logger.log(zpravy.join('\n\n'));
  return zpravy.join('\n\n');
}

/**
 * POKUS o založení fronty přes API.
 *
 * ⚠ Není jisté, že to projde – RT to povolí jen správci helpdesku a náš token
 * tohle oprávnění skoro jistě nemá. Funkce proto nic nepředstírá: vypíše
 * přesně to, co RT odpověděl, a podle toho se pozná, jestli to jde, nebo
 * jestli frontu musí založit správce helpdesku.
 *
 * Fronta je nastavení celého firemního helpdesku, ne naše věc – pokud tohle
 * neprojde, je to v pořádku a požádá se správce. NEOBCHÁZET jinudy.
 */
function zkusZalozitFrontu() {
  const obsah =
    'id: queue/new\n' +
    'Name: ' + RT_FRONTA_ROTACE + '\n' +
    'Description: Pozadavky chytre rotace stroju pujcovny (CS2 Uzice, CS1 Prostejov)\n' +
    'CorrespondAddress: \n' +
    'CommentAddress: \n' +
    'Disabled: 0\n';

  const vysledek = rtPost_('/REST/1.0/edit', obsah);
  const stav = rtStavOdpovedi_(vysledek.text);

  Logger.log('HTTP: ' + vysledek.kod + ', RT: ' + stav + '\nOdpověď RT:\n' + vysledek.text);

  if (stav !== 200) {
    Logger.log('\n→ Přes REST 1.0 to nejde. Zkus zkusZalozitFrontuREST2().');
  }

  return vysledek.text;
}

/**
 * RT vrací svůj vlastní stav v TĚLE odpovědi ("RT/5.0.10 400 Bad Request"),
 * i když HTTP hlavička hlásí 200. Tohle vytáhne to RT číslo.
 */
function rtStavOdpovedi_(text) {
  const shoda = String(text || '').match(/^RT\/\S+\s+(\d+)/);
  return shoda ? Number(shoda[1]) : 0;
}

/**
 * Druhý pokus – novější rozhraní RT 5 (REST 2.0), kde se fronty zakládat dají.
 * Pořád to ale vyžaduje oprávnění správce (AdminQueue / SuperUser).
 * Když vrátí 403, je odpověď jasná: frontu musí založit správce helpdesku.
 */
function zkusZalozitFrontuREST2() {
  const token = vlastnost_('RT_TOKEN');
  if (!token) throw new Error('Chybí vlastnost skriptu RT_TOKEN.');

  const odpoved = UrlFetchApp.fetch(RT_BASE_URL + '/REST/2.0/queue', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'token ' + token },
    payload: JSON.stringify({
      Name: RT_FRONTA_ROTACE,
      Description: 'Pozadavky chytre rotace stroju pujcovny (CS2 Uzice, CS1 Prostejov)'
    }),
    muteHttpExceptions: true
  });

  const kod = odpoved.getResponseCode();
  Logger.log('HTTP: ' + kod + '\nOdpověď:\n' + odpoved.getContentText().slice(0, 1000));

  if (kod === 201 || kod === 200) {
    Logger.log('\n→ Fronta založena. Spusť testFronty() a ověř.');
  } else if (kod === 403) {
    Logger.log('\n→ Token nemá práva správce. Frontu musí založit správce helpdesku.');
  } else if (kod === 404) {
    Logger.log('\n→ REST 2.0 na tomhle helpdesku není zapnuté. Frontu založí správce.');
  } else {
    Logger.log('\n→ Nepovedlo se. Frontu založí správce helpdesku.');
  }

  return kod;
}

/** Co o nás helpdesk ví – verze a přihlášený uživatel. Jen čte. */
function testPristup() {
  const token = vlastnost_('RT_TOKEN');
  const odpoved = UrlFetchApp.fetch(RT_BASE_URL + '/REST/2.0/rt', {
    method: 'get',
    headers: { Authorization: 'token ' + token },
    muteHttpExceptions: true
  });
  Logger.log('REST 2.0 dostupné: HTTP ' + odpoved.getResponseCode() +
    '\n' + odpoved.getContentText().slice(0, 500));
}
