# DEK WMS – kontext projektu

## Co to je

Skladová aplikace pro půjčovnu strojů DEK. Skladník na centrálním skladu **CS2**
skenuje QR kódy strojů při příjmu a výdeji; aplikace zapisuje časy do databáze
PSP v Google Sheets.

- **Uživatel:** Jana Procházková, manažer autodopravy CS2. Není programátorka –
  vysvětlovat laicky, bez žargonu, a nabízet hotová řešení místo možností.
- **PSP** = Přesun Stroje – Příkaz. Jeden doklad, může obsahovat víc strojů
  a příslušenství. Formát `PSP-500-26-00065`.
- **ID stroje** = 4znakový alfanumerický kód na kovovém štítku (`9JT9`, `7DE3`).

## Architektura

```
index.html (GitHub Pages)  ──fetch/GET──>  Apps Script  ──>  Google Sheets
   čtečka ve skladu                        "WMS backend"        DATA · POHYBY
                                           backend/Kod.gs       UZIVATELE · LOKACE
```

**Soubory v repozitáři:**

| Soubor | K čemu |
|---|---|
| `index.html` | Celá aplikace. Jeden soubor, žádný build krok. |
| `konfigurace.js` | Adresa skriptu (`WMS_URL`) + záložní lokace (`WMS_LOKACE`) |
| `sw.js` | Ukládání do čtečky, aby aplikace naběhla i bez signálu |
| `backend/Kod.gs` | Apps Script. Kopíruje se do projektu ručně. |
| `diagnostika.html` | Kontrola čtečky, test skeneru, vyčištění aplikace |
| `instalace.html` | Tisknutelný list: QR s adresou + nastavení skeneru |
| `qr-test.html` | Testovací QR kódy strojů a čárové kódy dokladů |

- Apps Script WMS je **vlastní samostatný projekt** jménem `WMS backend`,
  založený od nuly na script.google.com. Není připojený k žádné tabulce –
  ví o ní jen díky vlastnosti `SHEET_ID`.

> ⚠️ **WMS kód NIKDY nedávat do `Půjčovna_skript`** (ani do skriptu kopie).
> To je velká automatizace (import z helpdesku, maily, logistika, menu) a má
> vlastní `doGet`. V Apps Scriptu se všechny `.gs` soubory slijí do jednoho
> jmenného prostoru, takže dva `doGet` v jednom projektu = jeden z nich
> Google beze slova zahodí a jedna z webových aplikací tiše přestane fungovat.

**Které je které:**

| | Tabulka | Skript |
|---|---|---|
| Ostrá | `1BKvJXEU…` | `Půjčovna_skript` (1P3RYK0…) – nesahat |
| Testovací kopie | `1W1VOPle…` | kopie automatizace (1vOdqjwd…) – nesahat |
| WMS | podle `SHEET_ID` | `WMS backend` – nový, jen náš |

Přepnutí mezi testem a ostrým provozem = **změna jediné vlastnosti `SHEET_ID`**
v projektu `WMS backend`. Nic jiného se nemění.
- Kód žije v gitu, **data v Google Sheets** a do gitu nepatří.
- Komunikace přes **`fetch()` (GET)**. Původní handoff tvrdil, že kvůli CORS
  nefunguje a musí se použít JSONP – **to už neplatí**, Apps Script hlavičky
  posílá (ověřeno 25. 9. 2026: status 200, ~1,8 s).
  JSONP zůstává jen jako záloha, když by `fetch` selhal.

> ⚠️ **Nevracet se k JSONP jako k hlavní cestě.** Načítá odpověď přes
> `<script src>`, a prohlížeče s ochranou proti sledování (Edge Tracking
> Prevention, Safari ITP) takové volání na `google.com` blokují. Projevovalo
> se to jako náhodné „nepodařilo se spojit se skriptem" – jednou to prošlo,
> jindy ne, podle prohlížeče.
- Frontend je jeden soubor bez build kroku. Žádný npm, žádný bundler.
- ID tabulky a token jsou ve **Vlastnostech skriptu** (`SHEET_ID`, `WMS_TOKEN`),
  ne v kódu – repozitář je veřejný kvůli GitHub Pages.

## Tabulka není jen tabulka

Je to běžící automatizace, do které WMS vstupuje jako další účastník.
**Nikdy neměnit sloupce, které patří jiným částem systému.**

| List | Co to je |
|---|---|
| **`DATA`** | **Databáze PSP – zdroj pravdy pro WMS.** ~7 500 řádků, 38 sloupců |
| `2026` | Starý ruční list. WMS ho nepoužívá |
| `LOGISTIK-příjem` / `LOGISTIK-výdej` | Přehledy pro logistika |
| `RT_IMPORT`, `RT_IMPORT_LOG` | Import PSP z helpdesku včetně PDF |
| `EMAIL_FRONTA`, `EMAIL_NASTAVENI` | Rozesílání mailů |
| `AGENDA_IMPORT`, `AGENDA_LOG` | Import z Agendy |
| `POBOCKY`, `PUJ`, `PP`, `OBJEMNE_POLOZKY` | Číselníky |
| `POHYBY` | Auditní log WMS – včetně sloupce **Uživatel** |
| `UZIVATELE` | Skladníci pro přihlášení: `Jméno \| PIN \| Aktivní` |

> ⚠️ `LOGISTIK-výdej` vypadá jako hotový seznam „PSP čeká na odeslání", ale
> **je to snímek, který se obnoví až ručním kliknutím na „aktualizuj listy".**
> Výdej z něj nesmí vycházet – dva skladníci by podle zastaralého seznamu mohli
> vydat totéž PSP dvakrát. `getSeznamKVydeje()` proto počítá živě z `DATA`.

## Sloupce v listu `DATA`

| Sl. | Obsah | WMS |
|-----|-------|-----|
| B/C | ID / Pobočka nakládka | čte |
| D/E | ID / Pobočka vykládka | čte |
| F | **Číslo PSP** | čte |
| G | E.Č. PUJ | čte |
| I | **ID stroje** – prázdné = příslušenství | čte, klíč pro skenování |
| K | Název položky | čte |
| Q | Datum svozu | čte |
| R | Datum svezeno na CS | **jen čte** – plní jiná automatizace |
| S | Datum odesláno z CS | **jen čte** – plní jiná automatizace |
| T | Svezeno | **zaškrtává** při příjmu |
| U | Nesvezeno | **odškrtává** při příjmu – jinak si odporuje s T |
| V | Odesláno | **zaškrtává** při výdeji |
| Y | Poznámka | čte |
| AE | Storno | čte – stornované řádky se přeskakují |
| **„WMS příjem"** | přesný čas příjmu | **zapisuje** |
| **„WMS výdej"** | přesný čas výdeje | **zapisuje** |

Sloupce WMS si skript **založí sám na konci listu** a hledá je podle názvu,
ne podle pozice – takže se nerozbijí, když někdo vloží sloupec doprostřed.

Položky bez ID stroje (sl. I prázdné) jsou příslušenství a párují se přes PSP.

## Zařízení

**Urovo DT66** – Android čtečka se skenovacím modulem. Malý displej → velká
tlačítka. Nastavení je v aplikaci **ScanSettings** na čtečce, ne v naší aplikaci,
a dělá se **na každém kusu zvlášť**.

Rozchození stálo den hledání (13. 10. 2026), takže pro příště:

| Co | Kde | Musí být |
|---|---|---|
| Výstup skenu | ScanSettings → Output mode | **Keyboard** (z výroby bývá `Intent output`, který webová stránka nevidí) |
| Enter na konci | Output mode → Action key character | `Enter Key` |
| Zapnutý skener | ScanSettings → Scanner Input → Enable | zapnuto |
| Pípnutí | Output mode → Sounds | zapnout, jinak skladník nepozná úspěch |

> ⚠️ **Kamera a skener si berou stejný hardware.** Když běží náhled kamery,
> spoušť nemusí vůbec zabrat a vypadá to jako rozbitý skener. Proto se kamera
> **nespouští sama** – je za tlačítkem a po skenu se vypne. Nikdy to nevracet
> na automatické spouštění.

> ⚠️ **Android pouští `focus()` hlavně během doteku.** Zaměření se proto nastavuje
> synchronně v obsluze doteku (přepnutí na příjem, tlačítko Zpět, dotek kamkoliv
> na obrazovce příjmu), ne přes `setTimeout`. Jinak skladník musí nejdřív klepnout
> do pole, aby měl sken kam spadnout.

## Jak se zpracovává sken

Rozchození trvalo několik pokusů a každý selhal z jiného důvodu. Výsledný stav
je schválně co nejjednodušší – **jedna cesta, žádné souběžné odchytávání.**

Na **obrazovce příjmu** je cílem skenu **viditelné pole ručního zadání**
(`#inp-manual`). Je zaměřené hned po přechodu na příjem, sken do něj spadne
a skladník navíc vidí, co se načetlo.

> ⚠️ **Tomu poli nikdy nedávat `inputmode="none"`.** Vypadá to lákavě (schová
> klávesnici), ale čtečka vkládá text právě přes klávesnici (IME) – tím atributem
> se jí cesta zavře. Pole je zaměřené, sken proběhne a text nedorazí. Shodilo to
> dva pokusy po sobě, než se na to přišlo.

> ⚠️ **Schované pole mimo obrazovku nefunguje** ze stejného důvodu: androidí IME
> se k neviditelnému poli nepřipojí.

Co se s textem stane (`zpracujZadani_`, jediný vstupní bod):

| Vstup | Výsledek |
|---|---|
| Samé číslice, 3+ | Konec čísla dokladu → dohledá se v indexu. Víc shod = nabídne se výběr, nikdy se netipuje. |
| `PSP-…` | Doklad, celý naráz |
| Cokoliv jiného | ID stroje |

Odesílá se **Enterem, šipkou, nebo samo po 250 ms**, když text přibýval rychleji,
než stihne člověk psát (pojistka pro čtečky, které Enter neposílají). Ručně psané
číslo se samo neodešle, aby nic neodletělo dřív, než to skladník dopíše.

Globální odchytávání znaků (`hidOdesli_`) zůstává **jen pro potvrzovací obrazovku**,
kde žádné pole není a skladník míří rovnou na další stroj. Na obrazovce příjmu je
vypnuté – dřív běželo vedle pole, obě cesty si text braly a vyprazdňovaly,
a sken končil hláškou „Zadejte ID stroje".

## Aktualizace aplikace

**Nasazení = Commit + Push. Na čtečky se nechodí.**

Aplikace porovnává `VERZE_APP` se souborem na webu – při startu, po 15 minutách
a po návratu z pozadí. Když se liší, přenačte se.

> ⚠️ Přenačtení se odkládá **jen** na obrazovce potvrzení příjmu a výběru PSP
> k výdeji, kde má skladník rozdělanou práci. Nikde jinde. Dřív to bylo obráceně
> (přenačítat jen na skenovací obrazovce) a kdo si otevřel Nastavení, aby
> zkontroloval verzi, čekal marně.

> ⚠️ **Nevázat aktualizaci na změnu `sw.js`.** Verze 3.5 to tak měla a když se
> upravil jen `index.html`, nespustilo se nic.

Záchranné cesty, když by selhala i tahle:

1. **Nastavení → Zkontrolovat aktualizaci** – zahodí uloženou kopii a načte ze sítě
2. **`diagnostika.html` → Vyčistit aplikaci** – navíc odregistruje service worker

Čerstvá instalace si vždycky stáhne nejnovější verzi, tam není co řešit.
**Při každé změně zvýšit `VERZE_APP`** – je to jediné, podle čeho čtečky poznají,
že mají něco stáhnout.

**Čárový kód na dokladu obsahuje číslo PSP** (Code 128, ověřeno skenem
13. 10. 2026). Nadpis „Příkaz k jízdě" nad ním je jen popisek formuláře.

## Rychlost – proč je to postavené takhle

Jedno kolečko k Apps Scriptu stojí u DEKu **1,8–10 s** (měřeno), přičemž
samotný skript počítá jednotky milisekund. Zkracovat výpočet tedy nemá smysl –
platí se za cestu, ne za práci.

Proto si čtečka po přihlášení stáhne **index čekaných strojů** (`action=index`)
a sken se vyhledává lokálně – **~20 ms místo ~10 s**. Server se ptá jen tehdy,
když stroj v indexu není (už přijatý, nebo starší než okno 2 500 řádků).

> Index obsahuje **jen položky bez zapsaného příjmu**. Zastaralý index proto
> nemůže způsobit dvojí zápis: souběh zachytí server při ukládání a vrátí
> „už přijato". Index se navíc zahazuje při každém zápisu (server i čtečka).

Vedle strojů nese index i **příslušenství** (řádky bez ID stroje), jen jako
`PSP + název`. Díky tomu se po naskenování čárového kódu z dokladu vykreslí
celá karta **z paměti čtečky** a server se doptá až na pozadí – doplní jen to,
co je už přijaté. Měřeno 29. 9. 2026: 225 strojů + 228 příslušenství = 40 kB
(příslušenství stojí 12 kB). Jsou doklady, které stroj neobsahují vůbec
(oplocení, patky) – bez příslušenství by po skenu papíru zůstaly prázdné.

Zápis času hledá řádek **po stupních** (`OKNA_ZAPISU` = 400, 2 500, celá).
Měřeno: celá tabulka 3 843 ms na PSP, okno 2 500 řádků 1 387 ms – rozhoduje
délka úseku, ne počet buněk. Ověřuje `porovnejOknoZapisu()`.

## Zásadní pravidla

1. **Nikdy nehlásit úspěch, který se nestal.** Verze 1.0 vracela „uloženo"
   vždycky, i při chybě. Skladník podle toho řídil sklad.
   **A stejně tak nehlásit neúspěch, který se nestal.** Nedoručená odpověď
   neznamená, že zápis selhal – skript mohl dopsat a ztratit se mohla až
   cesta zpátky. Po vypršení limitu se proto stav **ověřuje dotazem**
   (`ulozSOverenim` → `overZapis`), teprve pak se hlásí výsledek.
2. **Čas se zapisuje po řádcích, ne po celém PSP.** Když z PSP přijedou 2 stroje
   ze 3, nesmí se označit všechny tři jako přijaté.
3. **Nesahat na cizí sloupce.** R a S patří jiné automatizaci – jen číst.
4. **Při redeployi Apps Scriptu zachovat stejnou URL.** Čtečky ji mají uloženou
   v `localStorage`; nové nasazení = nová adresa = nefunkční čtečky.
5. **Nezakládat nic v tabulce naslepo** – vždy nejdřív `zmapujData()`.
6. **Nenechávat vedle sebe dvě řešení téhož.** Sken odchytávaly chvíli dvě cesty
   naráz a braly si navzájem text; aktualizace se kontrolovala dvěma způsoby,
   z nichž jeden nefungoval. Když přibude nová cesta, tu starou odstranit.
7. **Při každé změně frontendu zvýšit `VERZE_APP`.** Podle ní čtečky poznají,
   že mají stahovat, a podle ní se v provozu pozná, co na které čtečce běží.

## Stav (září 2026)

Hotovo ve v3.0 (backend):
- práce nad `DATA`, vlastní sloupce WMS zakládané automaticky
- příjem i výdej po jednom stroji, ochrana proti dvojímu zápisu, zámek
- `getSeznamKVydeje()` – živý seznam poboček a PSP čekajících na výdej
- `lookupPsp()` pro sken čárového kódu z dokladu
- POHYBY se zapisuje podle existující hlavičky, ne napevno

Hotovo ve frontendu:
- příjem skenem (kamera i HID laser), trvalé varovné pruhy místo mizejících bublin
- **výdej bez skenování**: seznam poboček → PSP se stroji → zaškrtat → potvrdit
- `localStorage` ošetřený – aplikace naběhne i tam, kde je ukládání zakázané
- ověřeno příjmem `4CK1` z PSP-860-26-00082: čas dostal jen on, `92CN` zůstalo prázdné

Přihlášení (v3.1):
- Skladník se vybere ze seznamu a zadá PIN; ověřuje se na serveru proti
  listu `UZIVATELE`. PIN se do čtečky **nikdy neposílá**.
- Jméno se zapisuje do `POHYBY` (sloupec Uživatel). Platnost 12 hodin,
  pak se přihlašuje znovu. Pět chybných PINů = pauza 5 minut.

Přístup (v3.2) – **přihlášení je zároveň ochranou**:
- Po úspěšném přihlášení vydá skript **podepsaný klíč** (HMAC nad
  „jméno|platnost", tajemství ve vlastnosti `WMS_SECRET`). Klíč se nikde
  neukládá, platnost i jméno se čtou přímo z něj a nejdou zfalšovat.
- Čtečka ho posílá s každým dalším požadavkem. **Bez klíče backend neodpoví** –
  veřejné jsou jen `ping`, `uzivatele` (seznam jmen) a `prihlaseni`.
- Jméno do `POHYBY` se bere **z klíče**, ne z parametru → nejde zapsat pohyb
  pod cizím jménem.
- `WMS_TOKEN` zůstává jako druhá, nepovinná cesta (hodí se na testy z prohlížeče).

Adresa skriptu je v `konfigurace.js` (`WMS_URL`), takže **na čtečce se nenastavuje
nic** – stačí jméno a PIN. Cena za to: adresa je ve veřejném repozitáři. Sama
o sobě je ale k ničemu, protože bez platného přihlášení skript neodpoví.

**PINy jsou čtyřmístné** (rozhodnuto 9. 10. 2026 – skladníci je zadávají v rukavicích
na malém displeji, delší PIN znamenal víc překlepů). Čtyři číslice = 10 000 možností.
Hlavní ochranou proto není délka, ale **pauza po pěti chybných pokusech**
(`prihlas()`, pět minut, počítá se zvlášť pro každé jméno). Uhodnout PIN hrubou silou
tím trvá desítky hodin na jednoho skladníka. Nikdy tu pauzu neodstraňovat – bez ní
je čtyřmístný PIN prolomený za pár minut.

Ostrý provoz od 1. 10. 2026 (`SHEET_ID` → `1BKvJXEU…`, ověřuje `kteraTabulka()`).
Aplikace je ve verzi **4.4** (13. 10. 2026), sken na čtečkách ověřen v provozu.

Hotovo od října:
- **Sken dokladu i stroje** funguje na čtečce včetně laseru – viz Zařízení
  a Jak se zpracovává sken
- **Doklad jde zadat koncem čísla** (`122` místo celého PSP); při víc shodách
  se nabídne výběr, nikdy se netipuje
- **Kamera je volitelná** – za tlačítkem, po skenu se vypne. Nesmí běžet sama,
  brala by hardware laseru.
- **Lokace řídí list `LOKACE`** – zapnutí/vypnutí + obsazenost počítaná
  z `POHYBY`. Jedou do čtečky s indexem, takže změna je všude do minuty.
  Přepočet: `prepocitejLokace()`, ideálně časovou spouští po hodině.
- **Aplikace se aktualizuje sama** – viz Aktualizace aplikace
- **`diagnostika.html`** – projde síť, konfiguraci, verzi, ping, seznam
  skladníků, instalaci, paměť i skener; má test skeneru, který vypíše přesně
  to, co čtečka poslala, a umí vyčistit nainstalovanou aplikaci
- **`instalace.html`** – tisknutelný list pro nasazení nové čtečky:
  QR s adresou, postup instalace a tabulka nastavení skeneru

Zbývá:
- **Fronta při výpadku signálu** – ve skladu je slabá wifi. Zatím se zápis
  bez signálu nepovede a skladník ho musí zopakovat.
- **Výkon** – `getSeznamKVydeje` čte celý list. Až bude pomalé, přidat
  `CacheService`, **ale invalidovat cache při každém zápisu**, jinak hrozí
  dvojí výdej.
- **Reporty** – `report-presuny` (doba přesunu) a `report-pobocky`
  (upozorňování poboček) jsou rozpracované jako návrhy. Druhý z nich stojí
  na číselníku důvodů místo volné poznámky – bez něj je důvod známý
  jen u pětiny případů.
- **Přechod na O365.** Držet backend tenký a komunikaci přes pevný kontrakt
  (`lookup`, `lookupPsp`, `seznamKVydeji`, `save`, `ping`).

## Postup nasazení

Viz `README.md`. Backend se do Apps Scriptu **kopíruje ručně** – `clasp` zatím
není nastavený.
