# Skener na Android čtečce a webová aplikace

Zkušenosti z nasazení WMS Půjčovna na čtečkách **Urovo DT66** (CS2 DEK,
září–říjen 2026). Sepsáno pro kolegy, kteří řeší totéž: skener svítí, kód
přečte, ale do aplikace se nic nedostane.

Platí pro **webovou aplikaci v prohlížeči** (Chrome, PWA na ploše). Nativní
Android aplikace má jiné možnosti a většina téhle stránky se jí netýká.

---

## Nejčastější příčina: skener neposílá znaky jako klávesnice

Čtečka umí výsledek skenu předat dvěma způsoby:

| Režim | Co dělá | Vidí to webová stránka? |
|---|---|---|
| **Keyboard output** | „napíše" kód jako klávesnice | **ano** |
| **Intent output** | pošle ho jako vnitřní zprávu pro Android aplikace | **ne** |

Z výroby bývá nastavený **Intent output**. Skener pak funguje — svítí, pípá,
kód přečte — ale webová stránka o něm neví, protože nedostane žádné znaky.

**To je ten případ „svítí, přečte, nezapíše".**

### Oprava

Na čtečce otevřít aplikaci **ScanSettings**:

| Kde | Nastavit na |
|---|---|
| Output mode → **Output Mode** | **Keyboard output** |
| Output mode → Action key character | `Enter Key` |
| Output mode → Sounds | zapnout |
| Scanner Input → Enable | zapnuto |

První řádek je ten podstatný. Zbytek je pohodlí: Enter aplikaci řekne, že je
kód kompletní, a pípnutí dá obsluze zpětnou vazbu, že sken prošel.

### Rychlá zkouška bez aplikace

Otevřít Chrome, klepnout do **adresního řádku** a zmáčknout spoušť.

- **Vypíše se text** → skener píše jako klávesnice, problém je ve vaší aplikaci
- **Nevypíše se nic** → je to výstupní režim, viz výše

Tahle zkouška obejde vaši aplikaci úplně, takže jednoznačně rozdělí, na které
straně hledat.

---

## Když skener píše, ale aplikace to nechytá

### 1. Text chodí přes klávesnici (IME), ne jako stisky kláves

Urovo má v Output mode položku **Keyboard type**. Při hodnotě
`Automatic Text Mode` čtečka text **vkládá přes androidí klávesnici (IME)**,
ne jako skutečné stisky kláves.

Důsledek: globální `keydown` listener na `document` **takový sken nevidí**.
Klasické řešení „odchytávám znaky kdekoliv na stránce" nefunguje.

**Co funguje:** mít na stránce **zaměřené viditelné textové pole** a číst
událost `input`. Do něj sken spadne při obou režimech.

```js
// pole musí být opravdu zaměřené, jinak nemá text kam spadnout
pole.addEventListener('input', function () {
  clearTimeout(budik);
  budik = setTimeout(odesli, 250);   // pojistka, když nepřijde Enter
});
pole.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); odesli(); }
});
```

> ⚠️ **Nikdy tomu poli nedávat `inputmode="none"`.** Vypadá to lákavě (schová
> klávesnici na displeji), ale tím se zavře právě ta cesta, kterou sken chodí.
> Pole je zaměřené, sken proběhne a text nedorazí. Stálo nás to dva dny.

> ⚠️ **Schované pole mimo obrazovku taky nefunguje.** Androidí IME se
> k neviditelnému poli nepřipojí. Pole musí být vidět.

### 2. Android pouští zaměření pole jen během doteku

`pole.focus()` volané z časovače nebo po načtení stránky Android většinou
**tiše ignoruje**. Obsluha pak musí nejdřív klepnout do řádku, aby sken
někam spadl — což je přesně to, čemu se chcete vyhnout.

**Zaměřujte synchronně v obsluze doteku**, kterým se uživatel na obrazovku
dostal, ne přes `setTimeout`:

```js
tlacitkoPrijem.addEventListener('click', function () {
  zobrazObrazovku('sken');
  pole.focus();        // ještě uvnitř doteku – tady to Android pustí
});
```

Dobré doplnit: dotek kamkoliv na skenovací obrazovce zaměření vrátí, a časovač
po sekundě ho hlídá na pozadí.

### 3. Nenechávat vedle sebe dvě cesty odchytávání

Měli jsme chvíli zaměřené pole **i** globální `keydown`. Obě si braly stejný
sken a navzájem si vyprazdňovaly text — výsledkem byla hláška „zadejte kód"
u skenu, který proběhl v pořádku.

**Jedna cesta. Když přidáte novou, tu starou odstraňte.**

### 4. Kamera si bere stejný hardware jako skener

Když na obrazovce běží náhled kamery (čtení QR přes `getUserMedia`), **spoušť
nemusí vůbec zabrat**. Vypadá to jako rozbitý skener.

Kameru proto **nespouštět automaticky** — dát ji za tlačítko a po úspěšném
skenu vypnout. Ve skladu se stejně skenuje laserem; kamera je záloha pro
poškrábané štítky. Navíc tím výrazně vydrží baterie.

---

## Co nás ještě potkalo

### Jiná aplikace skener zamkne a neodemkne

**U nás to byla hlavní příčina opakovaných výpadků** (potvrzeno naším IT,
11/2026). Firemní aplikace si skener **vypne** — `Scanner Input → Enable` —
aby zabránila opakovanému naskenování téhož kódu. Jenže ten zámek je
**na úrovni zařízení**, ne aplikace, takže platí i po přepnutí jinam.

Projev: skener přestane reagovat úplně. Nesvítí, nepípá, nic.

**Oprava:** aplikace **Scanner** (modrá ikona) → `Scanner Input` → **Enable**
zapnout.

Pozor, je to **jiné místo než Output Mode**. Když skener svítí a čte, ale text
nikam nejde, je to výstupní režim (viz výše). Když nereaguje vůbec, je to
tenhle zámek.

Příbuzný případ: aplikace si nastaví **Intent output** a nevrátí ho. Tam
skener svítí a pípá, ale webová stránka nedostane znaky.

Webová stránka s tím v obou případech nic nenadělá — k nastavení skeneru
nemá přístup.

Co s tím:
- **Export Profile / Import Profile** ve ScanSettings: uložit si správné
  nastavení do souboru, obnova je pak rychlejší než cesta přes menu
- zeptat se dodavatele čtečky, jestli umí **vázat profil na aplikaci**
  (DT66 v menu neumí, ale u téhle třídy zařízení to bývá)
- **zeptat se autorů té druhé aplikace, ať zámek po sobě uklidí** — při
  odchodu z aplikace nebo při ztrátě popředí. Je to jediná skutečná oprava
  a je na jejich straně: aplikace mění sdílené nastavení zařízení a nevrací
  ho do původního stavu.

### Sken přichází useknutý nebo zpřeházený

ScanSettings → **Special Settings → Characters delay**. Zkusit 5–10 ms.
Pomalejší čtečka nebo pomalé pole to občas potřebuje.

### Čtečka Enter neposílá

Některé kusy mají suffix vypnutý. Nespoléhejte na Enter jako na jediný signál
konce — odešlete i po krátké pauze (u nás 250 ms) od posledního znaku.
Ručně psaný text tím neohrozíte, když rozlišíte rychlost: člověk neťuká
rychleji než zhruba 50 ms na znak, skener ano.

---

## Shrnutí pro rychlou diagnostiku

| Příznak | Kde hledat |
|---|---|
| Nesvítí, nepípá | **Scanner Input → Enable** (jiná aplikace ho mohla zamknout); přiřazení spouště; restart čtečky |
| Svítí a pípá, v Chromu se nic nevypíše | **Output Mode → Keyboard output** |
| V Chromu se vypíše, v aplikaci ne | zaměřené viditelné pole; `inputmode="none"`; běžící kamera |
| Funguje, po přepnutí z jiné aplikace přestane | ta aplikace si přepsala Output Mode |
| Text přijde useknutý | Special Settings → Characters delay |
| Funguje jen po klepnutí do pole | zaměřovat v obsluze doteku, ne z časovače |

---

*Zkušenosti z projektu WMS Půjčovna, CS2. Nastavení se dělá na každé čtečce
zvlášť; profil jde vyexportovat a nahrát na ostatní.*
