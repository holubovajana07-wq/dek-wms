# Nová čtečka – postup krok za krokem

> Co udělat s čtečkou Urovo DT66, která přijde z krabice nebo od jiného skladu,
> aby na ní jela WMS Půjčovna. **Bod po bodu, v tomhle pořadí.**
> Počítáno na nasazení na CS1 Prostějov.
> Souvisí: [[scanwedge-profily]] (profil skeneru) · [[skener-na-ctecce]] (když něco nejde) ·
> `test-skeneru-pres-usb.md` (hlubší diagnostika) · `../README.md`

**Čas:** asi 15 minut na první čtečku, pak ~5 minut na další.

## Co si připravit

- čtečku a její **USB kabel** (datový, ne jen nabíjecí)
- počítač s **platform-tools** (balík od Googlu, nic se neinstaluje, jen rozbalí):
  https://dl.google.com/android/repository/platform-tools-latest-windows.zip
- soubor **`scanwedge/WMS_scanner_property.xml`** z tohohle repozitáře
- přístup na firemní **wifi**
- jméno skladníka zapsané v listu `UZIVATELE` + jeho **PIN**

---

## 1. Wifi a čas

Zapnout čtečku, připojit na wifi skladu. Zkontrolovat, že **datum a čas sedí** –
aplikace zapisuje přesné časy příjmu a výdeje do evidence.

## 2. Povolit ladění USB

Tohle je potřeba jen jednou a jen kvůli tomu, aby šlo z počítače nahrát
nastavení skeneru a aplikaci. Pak se dá zase vypnout.

1. **Nastavení → Informace o telefonu**
2. **sedmkrát klepnout na „Číslo sestavení"** – objeví se hláška, že jste vývojář
3. zpět v Nastavení přibude **Pro vývojáře** (někdy pod *Systém*) → zapnout **Ladění USB**
4. připojit čtečku kabelem k počítači
5. na čtečce potvrdit dotaz **Povolit ladění** a zatrhnout „vždy"

Kdyby se čtečka nehlásila, stáhnout na ní horní lištu a u USB přepnout
z *Pouze nabíjení* na **Přenos souborů**.

Ověření v PowerShellu (ve složce platform-tools):

```powershell
.\adb.exe devices
```

Má se vypsat řádek se sériovým číslem a slovem `device`.

## 3. ⚠ Nahrát profil skeneru – NEJDŮLEŽITĚJŠÍ KROK

**Bez tohohle kroku bude skener na čtečce čas od času mrtvý** a skladník ho bude
muset odemykat ručně. Agendová aplikace (DEKsklady/DEKscan) si skener při své
práci vypne a nevrátí ho zpět – zámek je na úrovni zařízení, takže platí
i v naší aplikaci.

Profil `WMS` to spraví: ScanWedge ho nasadí pokaždé, když se přepne do naší
aplikace, a skener zase zapne.

```powershell
.\adb.exe push WMS_scanner_property.xml /sdcard/enterprise/scanwedge/autoimport/
```

Hotovo. ScanWedge si soubor **do vteřiny načte a smaže sám** – žádný restart,
žádné klikání na čtečce. Kontrola, že se import povedl (složka musí být prázdná):

```powershell
.\adb.exe shell ls /sdcard/enterprise/scanwedge/autoimport/
```

> ⚠️ Profil se váže na Chrome, takže platí pro **všechny webové aplikace**
> na té čtečce. Když na ní má někdo další svou aplikaci, dát mu vědět.
> Podrobně: [[scanwedge-profily]].

## 4. Zkontrolovat nastavení skeneru

Profil z kroku 3 řeší **zapnutí** skeneru, ne jeho výstupní režim. Ten se
nastavuje jednou na každém kuse, v aplikaci **Scanner** (modrá ikona,
ve skutečnosti Urovo ScanWedge).

Dá se otevřít z počítače, ať se nehledá mezi ikonami:

```powershell
.\adb.exe shell am start -n com.ubx.datawedge/.settings.activity.DataWedgeProfileSubSettings
```

| Kde | Nastavit na |
|---|---|
| Output mode → **Output Mode** | **Keyboard output** ← z výroby bývá `Intent output`, který webová stránka nevidí |
| Output mode → Action key character | `Enter Key` |
| Output mode → Sounds | **zapnout** – bez pípnutí skladník nepozná úspěch |
| Scanner Input → Enable | zapnuto |

**Rychlá zkouška:** otevřít Chrome, klepnout do adresního řádku, zmáčknout spoušť.
Vypíše se text → skener píše jako klávesnice, je to dobře.

## 5. Otevřít aplikaci – bez psaní adresy

Adresa aplikace:

**https://holubovajana07-wq.github.io/dek-wms/**

Na malém displeji v rukavicích se takhle dlouhá adresa píše mizerně, tak jsou
tři cesty, jak se tomu vyhnout:

**a) Z počítače přes kabel (nejrychlejší, čtečka je stejně připojená):**

```powershell
.\adb.exe shell am start -a android.intent.action.VIEW -d https://holubovajana07-wq.github.io/dek-wms/
```

**b) QR kód:** vytisknout si `instalace.html` z repozitáře – je to list s QR
kódem adresy, postupem instalace a tabulkou nastavení skeneru. Čtečka QR
naskenuje a Chrome se otevře sám.
Online: https://holubovajana07-wq.github.io/dek-wms/instalace.html

**c) Ručně** v Chromu, když nic z výše uvedeného není po ruce.

## 6. Nainstalovat jako aplikaci na plochu

1. V Chromu menu **⋮** → **Přidat na plochu** (nebo *Nainstalovat aplikaci*)
2. Potvrdit název **DEK WMS**
3. Od té chvíle spouštět **jen přes ikonu na ploše**, ne přes prohlížeč

Proč to tak: jako nainstalovaná aplikace má vlastní ikonu, běží přes celou
obrazovku bez adresního řádku a naběhne i bez signálu.

Na čtečce se **nenastavuje žádná adresa ani token** – adresa skriptu je
v `konfigurace.js`, společná pro všechny. Stačí jméno a PIN.

## 7. Zkouška v provozu

1. Přihlásit se jménem a **čtyřmístným PINem** (platí 12 hodin)
2. Na obrazovce příjmu **naskenovat QR stroje** – kód se objeví v poli
3. Zkusit i **sken čárového kódu z dokladu** (obsahuje číslo PSP)
4. **Zkouška zámku:** otevřít agendovou aplikaci, chvíli v ní skenovat, odejít,
   vrátit se do WMS a skenovat. **Musí to jít bez zásahu.** Když ne, nepovedl
   se krok 3.

Testovací kódy: `qr-test.html` v repozitáři.

## 8. Kontrolní seznam

- [ ] wifi a správný čas
- [ ] ladění USB (a po nasazení klidně zase vypnout)
- [ ] **profil skeneru nahraný, složka autoimport prázdná**
- [ ] Output Mode = Keyboard output, Enter Key, pípnutí zapnuté
- [ ] aplikace nainstalovaná na ploše pod ikonou DEK WMS
- [ ] přihlášení jménem a PINem funguje
- [ ] sken stroje i dokladu projde
- [ ] **zámek se po agendové aplikaci sám uvolní**

## Když něco nejde

| Příznak | Kde hledat |
|---|---|
| Skener nesvítí, nepípá | profil z kroku 3; `Scanner Input → Enable` |
| Svítí a pípá, v Chromu se nic nevypíše | **Output Mode → Keyboard output** (krok 4) |
| V Chromu se vypíše, v aplikaci ne | běžící kamera; viz [[skener-na-ctecce]] |
| Funguje, po přepnutí z agendy přestane | profil se nenahrál – zopakovat krok 3 |
| Sken přijde useknutý | ScanSettings → Special Settings → Characters delay 5–10 ms |

Hlubší diagnostika: `diagnostika.html` přímo na čtečce (projde síť, verzi,
spojení se skriptem, paměť i skener) a `test-skeneru-pres-usb.md` z počítače.
