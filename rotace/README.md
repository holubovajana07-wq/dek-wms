# Chytrá rotace – zkušební provoz

> Postavené 21. 11. 2026 pro první zkušební rotaci.
> **Ostrého provozu se to nedotýká:** vlastní Apps Script projekt, vlastní
> webová aplikace, vlastní stránka pro čtečku, zápis jen do **cvičné kopie**
> tabulky. `Půjčovna_skript`, `WMS backend`, ostrá tabulka ani `index.html`
> se nemění.

## Co je kde

| | |
|---|---|
| Apps Script projekt | **Rotace robot TEST**, ID `1CCD6VLK1s2B9EeBdqkCmB8eK7o_JvHnr-93JN7Q-YxMLnynsmZrwAOct` |
| Cvičná tabulka | `1odBO21c-eRu-vIk3epKPO4st3C7JgXovlfu7h_PV360` |
| Kód robota | `rotace/apps-script/` (nahrává se přes `clasp push`) |
| Stránka pro čtečku | `rotace/index.html` → https://holubovajana07-wq.github.io/dek-wms/rotace/ |
| Záloha před zásahem | `GITHUB/_zalohy/2026-11-21/` (repozitář + stažený `Půjčovna_skript`) |

## Co robot dělá

1. Každou minutu se podívá do **vstupní fronty `Centralni sklad 1 - Uzice S095`**,
   kam požadavek spadne jako první. Bere živé ticketky (`__Active__`).
2. Vezme si jen ty, které mají v předmětu **ROTACE** *a zároveň* v těle náš blok.
   **Ničeho jiného v té frontě se nedotkne** – patří to kolegům.
3. Z těla přečte blok `### POZADAVEK ROTACE v1 … ### KONEC`.
4. Zapíše řádek do listu **`ROTACE`** a pobočce pošle odpověď **PRIJATO**.
5. **Přehodí ticket do fronty `Rotace stroju CS`**, aby v hlavní frontě nezaclánět.
6. Skladník na čtečce vidí prioritní nakládku, naskenuje stroj.
7. Po doplnění čísla PSP odejde odpověď **NALOZENO** a ticket se uzavře.

### Fronta `Rotace stroju CS` – zatím neexistuje

Robot ji **nepotřebuje k tomu, aby fungoval**. Když ji nenajde, požadavek
normálně zpracuje, jen ticket nechá ve vstupní frontě a zapíše to do logu.

Založení fronty je **nastavení celého firemního helpdesku**, ne naše věc.
RT to povolí jen správci a náš token to oprávnění skoro jistě nemá.
Dá se to zkusit funkcí **`zkusZalozitFrontu()`** – nic nepředstírá, vypíše
přesně to, co RT odpoví. Když to neprojde, **požádat správce helpdesku**;
obcházet to jinudy nemá smysl ani se nemá.

> Název mám v kódu bez diakritiky (`Rotace stroju CS`), protože RT si
> s diakritikou v názvech front přes API občas neporadí. Kdyby ji správce
> založil jinak, stačí přepsat `RT_FRONTA_ROTACE` v `apps-script/00-config.js`.

Skladová zásoba se drží v listu **`ZASOBA_CS`** – výdej z ní stroj odepíše.

## Nastavení – krok za krokem

### 1. Vlastnosti skriptu

Otevřít [projekt Rotace robot TEST](https://script.google.com/d/1CCD6VLK1s2B9EeBdqkCmB8eK7o_JvHnr-93JN7Q-YxMLnynsmZrwAOct/edit)
→ **Nastavení projektu → Vlastnosti skriptu → Přidat vlastnost**:

| Název | Hodnota |
|---|---|
| `SHEET_ID` | `1odBO21c-eRu-vIk3epKPO4st3C7JgXovlfu7h_PV360` |
| `RT_TOKEN` | **zkopírovat z projektu `Půjčovna_skript`** (Nastavení projektu → Vlastnosti skriptu) |
| `ROTACE_TOKEN` | vymyslet libovolné heslo, třeba `rotace2026test` |

> 🔒 `RT_TOKEN` je přístup do firemního helpdesku. Kopíruj ho **přímo mezi
> projekty v prohlížeči** – neposílej ho do chatu, do e-mailu ani do repozitáře.

### 2. Založit listy a naplnit zkušební zásobu

V editoru nahoře vybrat funkci a dát **Spustit**. Při prvním spuštění
Google požádá o oprávnění – potvrdit.

1. `nastavTabulku()` – založí listy `ROTACE`, `ZASOBA_CS`, `ROTACE_LOG`, `ROTACE_CONTROL`
2. `naplnZkusebniZasobu()` – nasype 42 vymyšlených strojů v 16 skupinách
3. `kontrolaNastaveni()` – vypíše, co je hotové a co chybí

### 3. Zkoušky nanečisto (nic se neodešle)

- `testRozebrani()` – rozebere vzorový požadavek. V protokolu musí být
  `Kontrola: v pořádku`.
- `testHelpdesk()` – ověří, že se dostaneme na helpdesk a vidíme do vstupní
  fronty. Musí vypsat seznam ticketů, ne chybu.
- `testFronty()` – ukáže, jestli token vidí na obě fronty a jestli
  `Rotace stroju CS` vůbec existuje.
- `zkusZalozitFrontu()` – **jediná funkce, která něco mění v helpdesku.**
  Pokus o založení fronty; vypíše odpověď RT. Když neprojde, je to v pořádku –
  frontu založí správce.

### 4. Nasadit webovou aplikaci

**Nasadit → Nové nasazení → typ Webová aplikace**

| | |
|---|---|
| Spustit jako | já |
| Kdo má přístup | kdokoli |

Zkopírovat adresu, která končí `/exec`.

> U **tohohle** projektu se „Nové nasazení" použít smí – je nový a žádná čtečka
> si jeho adresu zatím nepamatuje. (U `WMS backend` to pořád platí: tam jen
> **Verze: Nová**, jinak se čtečkám rozbije spojení.)

### 5. Vložit adresu do stránky

Do `rotace/konfigurace.js` vyplnit `ROTACE_URL = 'https://script.google.com/.../exec';`,
pak v GitHub Desktopu **Commit to main** a **Push origin**.

### 6. Spustit robota

`nastavSpoust()` – od té chvíle kouká do helpdesku každou minutu.

> Apps Script neumí „po 2 minutách" – povolené jsou 1, 5, 10, 15 a 30.
> Bereme 1 minutu. Kdyby začal docházet denní limit spouští,
> přepnout na `nastavSpoustUsporna()` (5 minut).

Zastavit se dá kdykoli funkcí `zrusSpoust()`.

### 7. Čtečka

Na čtečce otevřít **https://holubovajana07-wq.github.io/dek-wms/rotace/**
a přidat na plochu jako druhou aplikaci (vedle DEK WMS).

Při prvním spuštění zadat **heslo** (`ROTACE_TOKEN`) a vybrat **sklad**.
Uloží se to jen v té čtečce.

> Skener si poradí sám, pokud je na čtečce nahraný profil `WMS` –
> ten se váže na Chrome, takže platí i pro tuhle stránku.
> Viz `docs/scanwedge-profily.md`.

## Zkušební požadavek

Poslat na **help.cs@dek.cz** – předmět i tělo přesně takhle:

```
Předmět: ROTACE EXR-26-00001

### POZADAVEK ROTACE v1
ID pozadavku: EXR-26-00001
Akce: NOVY
Sklad: S096
Pobocka: P350
ID stroje: 4XAB
PSK: PSK0090
Nazev: Deska vibracni jednosmerna do 120 kg
Nakladka: 2026-11-23 13:00
Odpoved na: jana.prochazkova@dek-cz.com
Rezim: TEST
### KONEC
```

Stroj `4XAB` je ve zkušební zásobě na `S096`, lokace `A1`.
Ze stejné skupiny tam leží i `7K2M` a `9QD4` – na nich se dá vyzkoušet náhrada.

Do minuty se má objevit řádek v listu `ROTACE` (žlutý) a do helpdesku odpověď
`Stav: PRIJATO`.

## Jak poznat, že to jede

| Kde | Co tam má být |
|---|---|
| List `ROTACE` | žlutý řádek, stav `k výdeji` |
| List `ROTACE_LOG` | `NOVÝ POŽADAVEK` a `ODPOVĚĎ PRIJATO` |
| Helpdesk | komentář s blokem `### ODPOVED ROTACE v1` |
| Čtečka | karta s červeným pruhem a velkým `4XAB` |
| Po skenu | řádek zčervená, stav `naloženo (čeká PSP)`, stroj v `ZASOBA_CS` je `vydáno` |
| Po zadání PSP | řádek zezelená, stav `uzavřeno`, ticket v helpdesku `resolved` |

## Co tady ještě není

- **TSC** – zápis urgentu k rezervaci (vědomě odloženo)
- **aplikace půjčovny** – požadavek se zatím píše ručně
- **příjem na CS** – zásoba se zatím plní jen zkušebními daty;
  do ostrého provozu bude potřeba inventura skenem
- **sloučení s WMS** – dnes je to samostatná stránka vedle DEK WMS.
  Až se proces usadí, patří obrazovka do `index.html` jako další záložka.

## Když něco nejde

| Příznak | Kde hledat |
|---|---|
| Řádek se neobjeví | `ROTACE_LOG`; `kontrolaNastaveni()`; sedí předmět s `ROTACE`? |
| Ticket zůstal v hlavní frontě | fronta `Rotace stroju CS` neexistuje – viz výše; v logu je `FRONTA NEEXISTUJE` |
| `Permission Denied` u přesunu | token nemá právo zapisovat do cílové fronty – řeší správce helpdesku |
| `Chybí vlastnost skriptu …` | krok 1 |
| `Neplatný token` na čtečce | heslo v čtečce ≠ `ROTACE_TOKEN` |
| `Stroj … není ve skladové zásobě` | `naplnZkusebniZasobu()` neproběhl |
| Helpdesk vrací chybu | `RT_TOKEN` se nezkopíroval správně |
| Sken nepadá do pole | profil skeneru – `docs/scanwedge-profily.md` |
