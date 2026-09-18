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
index.html (GitHub Pages)  ──JSONP/GET──>  Apps Script  ──>  Google Sheets
   čtečka ve skladu                        "WMS backend"        list "DATA"
                                           backend/Kod.gs       list "POHYBY"
```

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
- Komunikace **jen přes JSONP (GET)** – Apps Script neposílá CORS hlavičky,
  takže `fetch()` z prohlížeče nefunguje spolehlivě. Nevracet se k tomu.
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
| `POHYBY` | Auditní log WMS |

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
| Y | Poznámka | čte |
| AE | Storno | čte – stornované řádky se přeskakují |
| **„WMS příjem"** | přesný čas příjmu | **zapisuje** |
| **„WMS výdej"** | přesný čas výdeje | **zapisuje** |

Sloupce WMS si skript **založí sám na konci listu** a hledá je podle názvu,
ne podle pozice – takže se nerozbijí, když někdo vloží sloupec doprostřed.

Položky bez ID stroje (sl. I prázdné) jsou příslušenství a párují se přes PSP.

## Zařízení

**Urovo DT66** – Android čtečka s laserovým skenerem, který se chová jako
klávesnice (HID): načte kód a stiskne Enter. Aplikace to odchytává globálním
listenerem, nemusí být aktivní žádné pole. Malý displej → velká tlačítka.

## Zásadní pravidla

1. **Nikdy nehlásit úspěch, který se nestal.** Verze 1.0 vracela „uloženo"
   vždycky, i při chybě. Skladník podle toho řídil sklad.
2. **Čas se zapisuje po řádcích, ne po celém PSP.** Když z PSP přijedou 2 stroje
   ze 3, nesmí se označit všechny tři jako přijaté.
3. **Nesahat na cizí sloupce.** R a S patří jiné automatizaci – jen číst.
4. **Při redeployi Apps Scriptu zachovat stejnou URL.** Čtečky ji mají uloženou
   v `localStorage`; nové nasazení = nová adresa = nefunkční čtečky.
5. **Nezakládat nic v tabulce naslepo** – vždy nejdřív `zmapujData()`.

## Stav (září 2026)

Hotovo ve v3.0 (backend):
- práce nad `DATA`, vlastní sloupce WMS zakládané automaticky
- příjem i výdej po jednom stroji, ochrana proti dvojímu zápisu, zámek
- `getSeznamKVydeje()` – živý seznam poboček a PSP čekajících na výdej
- `lookupPsp()` pro sken čárového kódu z dokladu
- POHYBY se zapisuje podle existující hlavičky, ne napevno

Zbývá:
- **Obrazovka výdeje ve frontendu** – backend `getSeznamKVydeje()` je hotový,
  UI (seznam poboček → PSP → zaškrtat → potvrdit) ještě ne.
- **Výkon** – `getSeznamKVydeje` čte celý list. Až bude pomalé, přidat
  `CacheService`, **ale invalidovat cache při každém zápisu**, jinak hrozí
  dvojí výdej.
- **Příjem bez dokladu** – akce `PRIJEM_BEZ_DOKLADU` + notifikace logistikovi.
  Automatický tisk PSP z Apps Scriptu **nejde** – maximum je odkaz na PDF
  (sloupce W/X v `DATA`) nebo e-mail.
- **Fronta při výpadku signálu** – ve skladu je slabá wifi.
- **Přechod na O365.** Držet backend tenký a komunikaci přes pevný kontrakt
  (`lookup`, `lookupPsp`, `seznamKVydeji`, `save`, `ping`).

## Postup nasazení

Viz `README.md`. Backend se do Apps Scriptu **kopíruje ručně** – `clasp` zatím
není nastavený.
