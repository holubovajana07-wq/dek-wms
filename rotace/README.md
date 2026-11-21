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
| `EMAIL_PSP` | adresa, kam chodí upozornění „stroj naložen, vystavit PSP" (víc adres oddělit čárkou) |

> `ROTACE_TOKEN` se od verze 2.0 nepoužívá – nahradilo ho přihlašování skladníků.
> Můžeš ho smazat. `ROTACE_SECRET` se vyrobí samo při prvním přihlášení.

> 🔒 `RT_TOKEN` je přístup do firemního helpdesku. Kopíruj ho **přímo mezi
> projekty v prohlížeči** – neposílej ho do chatu, do e-mailu ani do repozitáře.

### 2. Založit listy a naplnit zkušební zásobu

V editoru nahoře vybrat funkci a dát **Spustit**. Při prvním spuštění
Google požádá o oprávnění – potvrdit.

1. `nastavTabulku()` – založí listy `ROTACE`, `ZASOBA_CS`, `ROTACE_LOG`, `ROTACE_CONTROL`
2. `naplnZkusebniZasobu()` – nasype 42 vymyšlených strojů v 16 skupinách
3. `nastavUzivatele()` – založí list `UZIVATELE` a dva zkušební skladníky
   (jednoho pro každý sklad) s náhodným PINem. **PINy se vypíšou do protokolu
   spuštění – přečíst je tam.** V listu se dají kdykoli přepsat.
4. `kontrolaNastaveni()` – vypíše, co je hotové a co chybí

### List `UZIVATELE`

Ten list **už v tabulce je** – patří WMS a má sloupce `Jméno | PIN | Aktivní`.
Rotace k němu potřebuje navíc **`Sklad`**.

`nastavUzivatele()` proto:

- přidá sloupec **`Sklad` na konec** (nikdy doprostřed – WMS by si mohlo
  hledat sloupce podle pozice a rozbilo by se),
- stávajícím skladníkům předvyplní **`S096`**, protože WMS dnes běží jen na CS2,
- nic jiného nepřepíše.

**Kdo patří na S093, toho přepiš ručně** – v listu, nebo hromadně:

```javascript
prirazSklad(['Novák Jan', 'Svoboda Petr'], 'S093')
```

Sloupce se čtou **podle názvů v hlavičce**, ne podle pořadí, takže se dají
kdykoli přeházet. Kdo má `Aktivní` = `NE`, v seznamu se neobjeví.

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

### ⚠ Otevřený editor přepíše nahraný kód

Když je v prohlížeči **otevřená karta s editorem Apps Scriptu** a mezitím se
kód nahraje přes `clasp push`, editor si pořád drží svou starší kopii –
a při první akci ji uloží zpátky. Nově přidané soubory přitom **zmizí**.

Stalo se to 21. 11. 2026: zmizel `32-naskladneni.js` a `50-setup.js` se vrátil
o verzi zpět. Pozná se to tak, že funkce vypíše hlášku ze starého kódu.

**Pravidlo: po každém `clasp push` dát v editoru F5**, než se tam cokoli spustí.
Když si nejsi jistá, co na serveru je, dá se to zkontrolovat stažením do
prázdné složky:

```powershell
clasp clone 1CCD6VLK1s2B9EeBdqkCmB8eK7o_JvHnr-93JN7Q-YxMLnynsmZrwAOct
```

### ⚠ Po KAŽDÉ změně kódu znovu nasadit

**Apps Script posílá do webové aplikace tu verzi kódu, se kterou bylo nasazení
vytvořeno.** `clasp push` nahraje kód do editoru, ale webová aplikace dál běží
po starém, dokud se nasazení neaktualizuje.

Pozná se to podle hlášek, které v aktuálním kódu vůbec nejsou –
třeba `Není nastavená vlastnost ROTACE_TOKEN` z dávno smazané funkce.

**Nasadit → Spravovat nasazení → ⚙ (tužka) → Verze: Nová → Nasadit.**

Adresa zůstane stejná, v `konfigurace.js` se nic nemění.

### 5. Vložit adresu do stránky

Do `rotace/konfigurace.js` vyplnit `ROTACE_URL = 'https://script.google.com/.../exec';`,
pak v GitHub Desktopu **Commit to main** a **Push origin**.

### 6. Spustit robota

1. `zacniTed()` – robot bude brát jen požadavky vzniklé **od téhle chvíle**.
   Bez toho by první běh prohledával celý včerejšek ve vstupní frontě skladu,
   kam chodí spousta věcí, které s rotací nemají nic společného.
2. `nastavSpoust()` – od té chvíle kouká do helpdesku každou minutu.

> Apps Script neumí „po 2 minutách" – povolené jsou 1, 5, 10, 15 a 30.
> Bereme 1 minutu. Kdyby začal docházet denní limit spouští,
> přepnout na `nastavSpoustUsporna()` (5 minut).

Zastavit se dá kdykoli funkcí `zrusSpoust()`.

### 7. Čtečka

Na čtečce otevřít **https://holubovajana07-wq.github.io/dek-wms/rotace/**
a přidat na plochu jako druhou aplikaci (vedle DEK WMS).

**Přihlášení má tři kroky:**

1. **Vyber sklad** – S096 Úžice, nebo S093 Prostějov
2. **Vyber jméno** – nabídnou se jen skladníci **toho skladu**
3. **Zadej PIN** – čtyři číslice na velké klávesnici

Platnost přihlášení je **12 hodin**, pak se přihlašuje znovu.
Pět chybných PINů = pauza 5 minut.

> ⚠ **Sklad se bere z přihlášení, ne z adresy.** Skladník z Prostějova tedy
> nevidí úžické požadavky, ani kdyby si adresu přepsal. Stejně je chráněný
> i výdej: požadavek z cizího skladu odbavit nejde.

PIN se do čtečky nikdy neposílá – ověřuje se na serveru a zpátky jde jen
podepsaný klíč, ve kterém je jméno, sklad a platnost.

### Seznam se obnovuje sám

Skladník nemusí na nic klikat. Na obrazovce se seznamem se **každých 30 vteřin**
načte znovu, a když se čtečka vrátí z pozadí (odemknutí), načte se hned.

Když **přibude nová nakládka**, čtečka **pípne a zavibruje** a nahoře se objeví
pruh „Přibyla nová nakládka".

Obnovování běží **jen na seznamu**. Jakmile skladník otevře konkrétní nakládku,
skenuje nebo zadává PSP, obnovování se zastaví – jinak by mu seznam přepsal
rozdělanou práci. Po návratu na seznam se zase rozběhne.

Výpadek wifi při tichém obnovení se nehlásí, zkusí se to za půl minuty znovu.

> **Skutečné notifikace** (upozornění, když je aplikace zavřená) webová stránka
> na Androidu neumí bez push serveru. Dokud je Rotace webová aplikace, platí:
> **musí být otevřená**. Proto je rozumné nechat čtečku na téhle obrazovce.
> Notifikace by uměl až nativní obal – viz `docs/scanwedge-profily.md`,
> kapitola o tom, proč jsme obal nakonec nepotřebovali kvůli skeneru.

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

> ⚠ **Uzavřený ticket zmizí z přehledu fronty.** Běžný pohled filtruje
> `Status = '__Active__'`, a `resolved` mezi aktivní nepatří. Když tedy
> požadavek po uzavření ve frontě nevidíš, **je to v pořádku – právě proto**.
> Hledat ho se dá přes `Status = 'resolved'`, nebo přímo podle čísla ticketu
> ze sloupce `Ticket` v listu `ROTACE`.
>
> Odpověď jde zároveň e-mailem žadateli, tedy na adresu, ze které požadavek přišel,
> a **v kopii na adresu ze sloupce `Odpověď na`** (z pole `Odpoved na` v požadavku).
>
> ⚠ **Při zkoušení vlastním požadavkem e-mail nepřijde.** Robot píše pod účtem,
> jehož token má v `RT_TOKEN`. Když je to tentýž člověk, který požadavek poslal,
> RT mu vlastní text mailem nepřeposílá – jen ho zapíše do ticketu.
> Ověřeno 21. 11. 2026 (ticket 2466735: Creator i Requestor tentýž).
> V provozu, kdy žádá pobočka, to nenastane. Na doložení slouží `testKopie()`,
> která pošle kopii na jinou adresu.
| Čtečka | karta s červeným pruhem a velkým `4XAB` |
| Po skenu | řádek zčervená, stav `naloženo (čeká PSP)`, stroj v `ZASOBA_CS` je `vydáno` |
| Po zadání PSP | řádek zezelená, stav `uzavřeno`, ticket v helpdesku `resolved` |

### PSP se zadává jen v tabulce, ne na čtečce

**PSP vystavuje SO. Skladník s ním nemá nic společného** a na čtečce se
nezadává — po naložení se vrací rovnou na seznam.

Místo toho odejde **e-mail**, že stroj je na vozidle a je potřeba vystavit PSP.
Adresa je ve vlastnosti skriptu **`EMAIL_PSP`** (víc adres oddělit čárkou).
Bez ní se nic neposílá a zapíše se to jen do logu — osobní adresy do
veřejného repozitáře nepatří.

V e-mailu je sklad, pobočka, ID naloženého stroje (a za co je případně
náhradou), položka, čas naložení, termín nakládky, kdo nakládal, ID požadavku
a číslo ticketu.

**Uzavření:** číslo PSP napsat do sloupce `PSP` u červeného řádku v listu
`ROTACE`. Do minuty robot odešle pobočce odpověď `NALOZENO`, uzavře ticket
a řádek zezelená. Je to **jediná cesta**, jak se požadavek uzavírá.

### Barvy v listu `ROTACE`

**Řádek** drží barvu podle stavu:

| Barva | Stav |
|---|---|
| žlutá | `k výdeji` – čeká na skladníka |
| červená | `naloženo (čeká PSP)` |
| zelená | `uzavřeno` |
| šedá | `zrušeno` nebo `nesplněno` |

**Buňka s ID stroje** navíc zoranžoví, když požadovaný stroj nesedí se
skladovou zásobou – není v ní, je už vydaný, leží na jiném skladu, nebo má
jinou skupinu. Důvod je v komentáři buňky i v Poznámce, včetně toho,
**kolik kusů ze stejné skupiny je k dispozici** jako náhrada.

Zásoba se mění, takže stroj může přestat být dostupný i po zapsání požadavku.
Přepočítat všechny čekající řádky umí **`prekontrolujDostupnost()`** –
spustit ručně, nebo si na ni dát vlastní časovou spoušť (stačí po hodině).

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
| V seznamu jmen nikdo není | v listu `UZIVATELE` není nikdo s tím skladem a `Aktivní` = ANO |
| `Špatný PIN` i se správným | sedí `Sklad` u toho jména v listu `UZIVATELE`? |
| `Přihlášení vypršelo` | normální po 12 hodinách – přihlásit se znovu |
| `Tenhle požadavek patří skladu …` | skladník je přihlášený pod druhým skladem |
| `Stroj … není ve skladové zásobě` | `naplnZkusebniZasobu()` neproběhl |
| Helpdesk vrací chybu | `RT_TOKEN` se nezkopíroval správně |
| Sken nepadá do pole | profil skeneru – `docs/scanwedge-profily.md` |
