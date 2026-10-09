// ============================================================
// DEK WMS – společné nastavení pro všechny čtečky
// ============================================================
// Sem vložte adresu webové aplikace z Apps Scriptu (končí na /exec).
// Od té chvíle se na čtečkách nenastavuje nic – stačí jméno a PIN.
//
// POZOR: tenhle soubor je ve veřejném repozitáři, takže adresa bude
// veřejně dohledatelná. Samotná adresa ale nikomu nestačí – skript
// bez platného přihlášení neodpoví.
//
// Dokud je hodnota prázdná, chová se aplikace po starém: adresu
// zadáte ručně v nastavení čtečky.
// ============================================================

const WMS_URL = 'https://script.google.com/macros/s/AKfycbw4Dt1QjzoDfCUfWb7ludUID8fsYmWJQW7or2Jk1-BMY2uZyBSRbJnbttclLI9itlnIcw/exec';

// ============================================================
// Lokace ve skladu – tlačítka, která skladník vidí při příjmu.
// ============================================================
// Mění se TADY, jednou pro všechny čtečky. Po úpravě stačí v GitHub
// Desktopu Commit + Push; čtečky si novou sadu vezmou při příštím
// spuštění a na žádné se nic nenastavuje.
//
// Tahle hodnota přebije i to, co má čtečka uložené z minula – jinak by
// na starých čtečkách zůstaly viset staré lokace.
//
// Pořadí určuje pořadí tlačítek. Vejde se jich klidně víc, zalomí se
// samy do řádků; na malém displeji DT66 je rozumný strop kolem dvanácti.
const WMS_LOKACE = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
