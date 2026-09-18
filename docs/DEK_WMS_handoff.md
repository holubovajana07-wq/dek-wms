# DEK WMS – Handoff dokument pro Claude Code
*Stav: září 2026 | Autor: Jana Procházková, CS2*

---

## 1. Co je systém a proč existuje

DEK půjčovna strojů přesouvá stroje mezi ~100 pobočkami přes Centrální sklad CS2. Každý přesun má doklad **PSP** (Přesun Stroje – Příkaz). Jeden PSP může obsahovat více strojů/příslušenství. Stroje jsou označeny kovovými štítky s **QR kódem** obsahujícím 4-místné alfanumerické ID (např. `9JT9`, `61EJ`).

Cíl WMS: nahradit ruční evidenci pohybů skenováním QR kódů na čtečkách/telefonech, automaticky zapisovat časy příjmu/výdeje do evidenční tabulky.

---

## 2. Současná architektura

### 2a. Frontend – webová aplikace
- **URL:** `https://holubovajana07-wq.github.io/dek-wms/`
- **Soubor:** `index.html` (single-file HTML/CSS/JS)
- **Hosting:** GitHub Pages (HTTPS zdarma)
- **Technologie:** Vanilla JS, jsQR 1.4.0 pro skenování, JSONP pro komunikaci s backendem
- **Konfigurace:** ukládá se v `localStorage` každého zařízení zvlášť (URL skriptu, název skladu)

### 2b. Backend – Google Apps Script
- **Tabulka:** Půjčovna 2026, ID: `1BKvJXEUjrATA9d1ZMvU--DWzLU2X5e6kSlss6NaDWu8`
- **Skript:** samostatný Apps Script projekt (ne vázaný na tabulku), nasazen jako Web App
- **Přístup:** "Kdokoli" – bez autentizace (interní použití)
- **Komunikace:** GET + JSONP (fetch nefunguje kvůli CORS, doPost z prohlížeče nespolehlivý)

### 2c. Datová struktura – list `2026`

| Sl. | Písmeno | Obsah |
|-----|---------|-------|
| 1 | A | Zadáno ke svozu (datum) |
| 2 | B | Z (kód) – kód pobočky odkud |
| 3 | C | Z (místo) – název pobočky odkud |
| 4 | D | DO (kód) – kód pobočky kam |
| 5 | E | DO (místo) – název pobočky kam |
| 6 | F | Číslo PSP (např. PSP-500-26-00065) |
| 7 | G | Položka (text) |
| 8 | H | PP (číslo položky, např. PP01250) |
| 9 | I | **ID stroje** (4-místný kód, např. 9JT9) – klíč pro skenování |
| 10 | J | Název položky |
| 11 | K | Typ přesunu |
| 12 | L | Poznámka |
| 13 | M | E.Č. PUJ / vystavil |
| 14 | N | Datum svozu |
| 15–18 | O–R | Různé stavy svozu |
| **19** | **S** | **Čas příjmu na CS2** ← WMS zapisuje |
| **20** | **T** | **Čas výdeje z CS2** ← WMS zapisuje |

Řádků: ~6 700 a roste. Jeden PSP = typicky 1–5 řádků (stroj + příslušenství). Položky bez ID stroje (sl. I prázdné) jsou příslušenství – párují se přes PSP číslo.

### 2d. List `POHYBY` (audit log)
Vytvořen automaticky skriptem. Hlavička:
`Čas | ID stroje | Název | PSP | Akce | Pobočka odkud (kód) | Pobočka odkud | Pobočka kam (kód) | Pobočka kam | Lokace CS2 | Sklad | Zapsáno`

---

## 3. Současný Apps Script – klíčové funkce

```javascript
const WMS_CONFIG = {
  pujcovnaId:   '1BKvJXEUjrATA9d1ZMvU--DWzLU2X5e6kSlss6NaDWu8',
  pujcovnaList: '2026',
  pohybyList:   'POHYBY',
  col: {
    idNakladka: 2, pobNakladka: 3, idVykladka: 4, pobVykladka: 5,
    cisloPsp: 6, polozka: 7, pp: 8, idStroje: 9, nazevPolozky: 10,
    typPresunu: 11, pozn: 12, ecPuj: 13, datumSvozu: 14,
    casPrijmu: 19, casVydeje: 20   // S a T
  }
};
```

**`doGet(e)`** – přijímá GET requesty, podporuje JSONP (`?callback=xxx`)
- `?action=lookup&id=9JT9` → vrátí data stroje
- `?action=ping` → health check

**`lookupStroj(id)`** – hledá od konce tabulky (nejnovější záznamy první), vrátí:
```json
{
  "nalezeno": true,
  "id": "9JT9",
  "nazev": "Vibrační deska reverzní...",
  "cisloPsp": "PSP-500-26-00065",
  "idNakladka": "P500", "pobNakladka": "Sokolov",
  "idVykladka": "D918", "pobVykladka": "Olomouc (DEPO)",
  "polozky": [
    { "idStroje": "9JT9", "pp": "PP00098", "polozka": "PUJ-22-00124", "nazev": "Vibrační deska..." }
  ]
}
```

**`ulozPohyb(record)`** – zapíše řádek do POHYBY, pak zavolá `zapišCasDoTabulky`

**`zapišCasDoTabulky(psp, akce, cas)`** – zapíše čas do sl. S (příjem) nebo T (výdej) ke VŠEM řádkům se stejným PSP

**`doPost`** – existuje ale NEFUNGUJE spolehlivě z prohlížeče. Ukládání přes GET parametry je potřeba implementovat.

---

## 4. Cílové zařízení

**Urovo DT66 Mobile Data Terminal**
- Android čtečka s fyzickým laserovým skenerem čárových/QR kódů
- Skener funguje jako klávesnice (HID) – naskenované hodnoty se vloží do aktivního textového pole
- Prohlížeč: Chrome Android
- Displej: menší než běžný telefon, dotykový
- **Důsledek pro UI:** velká tlačítka (min 60px výška), velký text, minimum kroků, podpora HID vstupu ze skeneru do input pole

---

## 5. Co je potřeba přepracovat / dostavět

### 5a. PŘÍJEM (kompletní přepracování)

**Flow:**
1. Skladník zvolí „Příjem"
2. Naskenuje QR kód stroje (kamerou nebo laserem do input pole) NEBO naskenuje čárový kód PSP z papírového dokladu
3. Systém vyhledá nejnovější PSP pro daný stroj/PSP číslo
4. Zobrazí se:
   - Název stroje, PSP číslo
   - Odkud → Kam
   - Všechny položky na PSP s ID strojů
   - **NOVÉ:** Seznam dalších strojů ze stejné pobočky (stejný kód Z) se stejným datem svozu → „Co ještě mělo přijet dnes z této pobočky"
5. Dvě tlačítka:
   - **„Potvrdit příjem"** → zapíše čas do sl. S, uloží do POHYBY
   - **„Přijel bez dokladu"** → zapíše příznak, vygeneruje upozornění pro logistika (viz níže)

**Upozornění „bez dokladu":**
- Zapíše se do POHYBY s akcí `PRIJEM_BEZ_DOKLADU`
- Ideálně: automatický tisk PSP PDF ze složky (PSP dokumenty jsou uloženy jako PDF ve sdílené složce DEK, pojmenovány dle PSP čísla)
- Minimálně: email/notifikace logistikovi s číslem PSP k tisku

**Lookup podle PSP čárového kódu:**
- PSP doklad má čárový kód s hodnotou PSP čísla (např. `PSP-500-26-00065`)
- Nová funkce `lookupPSP(pspCislo)` – vrátí všechny řádky daného PSP

### 5b. VÝDEJ (kompletní přepracování – bez skenování)

**Flow:**
1. Skladník zvolí „Výdej"
2. Zobrazí se **seznam poboček** (kód + název) které mají PSP ve stavu „přijato na CS" (sl. S vyplněno, sl. T prázdné)
3. Klikne na pobočku → zobrazí se **seznam PSP** pro tuto pobočku s popisem strojů/příslušenství
4. U každého PSP zaškrtávátko (checkbox)
5. Tlačítko „Potvrdit výdej vybraných" → zapíše čas do sl. T ke všem řádkům zaškrtnutých PSP, uloží do POHYBY

**Nová backendová funkce `getSeznamKVydeje()`:**
```
Vrátí: seznam poboček s PSP připravenými k výdeji
{
  pobocky: [
    {
      kod: "P500",
      nazev: "Sokolov",
      pspList: [
        {
          cisloPsp: "PSP-500-26-00065",
          polozky: [...],
          datumPrijmu: "2026-08-03T10:30:00"
        }
      ]
    }
  ]
}
```

### 5c. Technické požadavky

**HID skener podpora:**
- Input pole musí být vždy aktivní (autofocus) nebo mít tlačítko „Aktivovat skener"
- Po naskenování (Enter od HID) se automaticky spustí lookup
- Nevyžadovat potvrzení tlačítkem po každém skenu

**Ukládání přes GET místo POST:**
- Přepsat `ulozPohyb` na GET: `?action=save&id=...&psp=...&akce=...&cas=...`
- Spolehlivější z prohlížeče, funguje s JSONP

**Performance:**
- Tabulka má 6 700 řádků a roste
- `getSeznamKVydeje` musí číst celou tabulku → cache výsledku v Apps Script na 5 minut (`CacheService`)
- Zápis do tabulky: dávkový `setValues` místo per-row `setValue`

---

## 6. Soubory k předání

- `index.html` – aktuální frontend (GitHub Pages)
- `SKRIPT_WMS_v1.js` – aktuální Apps Script backend
- Tento dokument

---

## 7. Co NESDĚLOVAT uživatelům / bezpečnost

- URL skriptu je veřejná (bez auth) – interní použití, přijatelné riziko
- Data v tabulce jsou citlivá (obchodní) – GitHub repo je public jen pro hosting, kód neobsahuje žádná data
- Po přechodu DEK na O365: zvážit přechod na Microsoft Graph API místo Google Apps Script

---

## 8. Kontext firmy

- DEK a.s. – stavebniny, ~100 poboček v ČR
- CS2 = Centrální sklad 2, depot 096
- Přechod na O365 se plánuje – aktuální řešení Google je přechodné
- Jana Procházková = manažer autodopravy CS2, hlavní uživatel systému
