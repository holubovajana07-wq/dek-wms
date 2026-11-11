# Jak zjistit, čím se na čtečce zapíná skener

Postup, jak z počítače zjistit, **jestli a čím se dá skener na Urovo DT66
zapnout zvenčí**. Nic se neinstaluje na čtečku, nic se nemění natrvalo.

Cíl: zjistit, jestli má smysl stavět vlastní aplikaci, která skener odemkne
pokaždé, když ho firemní aplikace zamkne.

**Čas:** asi půl hodiny. **Potřeba:** čtečka, USB kabel, počítač.

---

## 1. Stáhnout nástroje (jednou)

Oficiální balík od Googlu, asi 10 MB, **neinstaluje se** – jen se rozbalí:

https://dl.google.com/android/repository/platform-tools-latest-windows.zip

Rozbalit třeba do `C:\platform-tools`.

---

## 2. Povolit ladění na čtečce

1. **Nastavení → Informace o telefonu**
2. Sedmkrát klepnout na **Číslo sestavení** – objeví se hláška, že jste vývojář
3. Zpět v Nastavení přibude **Pro vývojáře** (někdy pod *Systém*)
4. Tam zapnout **Ladění USB**

Pak připojit kabelem k počítači. Na čtečce vyskočí dotaz, jestli povolit ladění
z tohoto počítače – **Povolit** (a zatrhnout „vždy").

---

## 3. Ověřit spojení

V PowerShellu:

```powershell
cd C:\platform-tools
.\adb.exe devices
```

Má se vypsat řádek se sériovým číslem a slovem `device`.

- `unauthorized` → na čtečce nebyl potvrzen dotaz na ladění
- prázdný seznam → kabel, nebo chybí ovladač

---

## 4. Najít aplikaci skeneru

```powershell
.\adb.exe shell pm list packages | Select-String -Pattern "scan|urovo|barcode|sean"
```

Vypíše se něco jako `package:com.urovo.scansettings`. **Ten název si poznamenejte** –
v dalších krocích se používá.

---

## 5. Zjistit, čím se skener ovládá

Tohle je jádro celého testu. Zkoušejí se tři možnosti, stačí, když vyjde jedna.

### 5a. Nastavení uložené v systému

```powershell
.\adb.exe shell settings list global | Select-String -Pattern "scan"
.\adb.exe shell settings list secure | Select-String -Pattern "scan"
.\adb.exe shell settings list system | Select-String -Pattern "scan"
```

Když se objeví něco jako `scanner_enable=0`, je vyhráno – jde to přepnout
jedním příkazem a aplikace bude triviální.

### 5b. Co aplikace skeneru poslouchá

```powershell
.\adb.exe shell dumpsys package com.urovo.scansettings | Select-String -Pattern "Receiver|android.intent|action" -Context 0,2
```

(za `com.urovo.scansettings` dosaďte název z kroku 4)

Hledáme řádky s názvy akcí – něco ve tvaru `com.urovo.*` nebo `android.intent.*`.
To jsou povely, kterými se dá aplikaci říct, co má udělat.

### 5c. Odposlech při ručním přepnutí — nejspolehlivější

1. Smazat dosavadní záznam:

```powershell
.\adb.exe logcat -c
```

2. **Na čtečce** otevřít aplikaci Scanner → `Scanner Input` → přepnout
   **Enable** vypnout a zase zapnout

3. Hned potom vypsat, co se dělo:

```powershell
.\adb.exe logcat -d | Select-String -Pattern "scan" -CaseSensitive:$false | Select-Object -First 100
```

V tom výpisu bývá vidět přesně ten povel, který aplikace sama sobě poslala.
To je přesně to, co potřebujeme napodobit.

---

## 6. Co poslat

Výpisy z kroků **4, 5a, 5b a 5c**. Klidně jako text nebo snímky obrazovky.

Z nich se pozná, kterou ze tří cest se skener ovládá, a podle toho:

- **vyjde 5a** → stačí jeden příkaz, aplikace bude mít pár řádků
- **vyjde 5b nebo 5c** → napíše se malá aplikace, která ten povel pošle
- **nevyjde nic** → skener se zvenčí ovládat nedá a musí se shánět SDK
  od Urova, nebo to vyřeší jen opravа v té aplikaci, která zamyká

---

## Co se tím nerozbije

Všechny příkazy výše jen **čtou**. Nic nemění, nic neinstalují, nic nemažou.
Jediná trvalá změna je zapnuté ladění USB, které se dá stejnou cestou vypnout.

Pokud by DEK mělo pravidla pro připojování firemních zařízení k počítačům,
stojí za to to předem zmínit IT – ne kvůli riziku, ale aby je nepřekvapilo,
že se zařízení hlásí v režimu ladění.
