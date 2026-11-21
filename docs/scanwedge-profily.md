# ScanWedge profily – jak odemknout skener bez zásahu skladníka

> Zjištěno 21. 11. 2026 měřením na čtečce DT66 přes USB (adb) + dokumentace
> Urovo: https://github.com/urovosamples/DeploymentConfigForScanner
> Souvisí: [[skener-na-ctecce]] · `test-skeneru-pres-usb.md`

**VYŘEŠENO 21. 11. 2026, ověřeno na náhradní čtečce.** Vlastní Android aplikaci
na odemykání skeneru **nepotřebujeme.** Stačí profil ScanWedge navázaný na Chrome.
Hotový soubor k nasazení: `scanwedge/WMS_scanner_property.xml`,
postup v kapitole „Nasazení na víc čteček“.

## Co je na čtečce (ověřeno)

DT66, **Android 13**. Nastavení skeneru neřídí aplikace `com.ubx.uscanner`
(to je jen demo obrazovka), ale **`com.ubx.datawedge`** – Urovo ScanWedge,
obdoba Zebra DataWedge. To je ta aplikace, které v [[skener-na-ctecce]]
říkáme „Scanner (modrá ikona)“.

Otevře se příkazem:

```
adb shell am start -n com.ubx.datawedge/.settings.activity.DataWedgeProfileSubSettings
```

Na čtečce jsou **dva profily**: `default` a `novsig`
(`novsig` je podle `/sdcard/Download` od aplikace digital signage, ne od nás).

Dál je na zařízení složka pro hromadné nasazení:

```
/sdcard/enterprise/scanwedge/autoimport
```

## Co se vyvrátilo

**Nastavení skeneru NENÍ v systémových nastaveních Androidu.** Porovnání snímku
`settings list system/secure/global` před ručním přepnutím `Scanner Input → Enable`
a po něm nenašlo **žádný** související rozdíl. Tím definitivně padá cesta 5a
z `test-skeneru-pres-usb.md` i dřívější pokus s `UROVO_SCAN_PASS`.

## Co se naopak potvrdilo

V logu čtečky je při stisku spouště zamčeného skeneru vidět:

```
DWedgeScanService: locked triggering
```

Zámek tedy drží **ScanWedge** a sám ho hlásí. To je zároveň způsob,
jak stav spolehlivě poznat při diagnostice.

## Klíčový nález: profil se dá přivázat k aplikaci

Konfigurace ScanWedge je XML. Profil může obsahovat:

```xml
<profilePackages packageName="com.android.chrome">*</profilePackages>
<property id="0" name="SCANNER_ENABLE">1</property>
<scanwedgeEnable>true</scanwedgeEnable>
<profileEnable>true</profileEnable>
```

`profilePackages` váže profil na aplikaci (`*` = všechny její obrazovky).
Jedna aplikace smí patřit **jen jednomu** profilu.

**Pokud to funguje, jak dokumentace tvrdí, pak při přepnutí do naší aplikace
ScanWedge sám nasadí náš profil se zapnutým skenerem** – bez ohledu na to,
co předtím udělala agendová aplikace. Přesně to, co potřebujeme.

### Naše aplikace má na čtečce vlastní balíček

WMS je nainstalovaná jako PWA, takže běží pod vlastním balíčkem WebAPK:

| Balíček | Co to je |
|---|---|
| `org.chromium.webapk.a19e41e56969b259b_v2` | **naše aplikace** (`holubovajana07-wq.github.io`) |
| `org.chromium.webapk.ac73055cf48899932_v2` | `washeck009.github.io` – cizí |
| `com.android.chrome` | Chrome, když se stránka otevře v prohlížeči |

> ⚠️ **Jméno balíčku WebAPK se po přeinstalaci aplikace změní.** Profil proto vázat
> na **oba** – WebAPK i `com.android.chrome` – a při nasazení nové čtečky jméno
> znovu zjistit (`adb shell pm list packages | findstr webapk`,
> ověřit přes `dumpsys package <balicek>`, kde je vidět doména).

## Jak se konfigurace dostává do čtečky

| Cesta | Jak |
|---|---|
| **Hromadně** | soubor nakopírovat do `/sdcard/enterprise/scanwedge/autoimport` – ScanWedge ho načte a soubor smaže |
| **Při startu** | `/sdcard/autoimport_scanner_property.xml` – načte se po příštím bootu |
| **Příkazem** | broadcast `action.IMPORT_SCANNER_CONFIG` s extra `configFilepath` = celá cesta k souboru |

Soubory se jmenují `[NazevProfilu]_scanner_property.xml`,
výchozí profil `Default_scanner_property.xml`.

Výsledek chodí zpět v `RESULT_CODE` (> 0 = úspěch) a `RESULT_INFO_EXTRA`.
Chybové kódy: `-1002` profil nenalezen, `-1006` špatná cesta,
`-1008` vadný soubor, `-1009` soubor neexistuje.

## Ověřeno na čtečce 21. 11. 2026

**Automatický import funguje.** Soubor `WMS_scanner_property.xml` nakopírovaný
do `/sdcard/enterprise/scanwedge/autoimport` byl načten **do vteřiny, bez restartu**,
a sám se smazal:

```
WedgeIETask: inProfileName = WMS profileId = 3 profileEnable = true existProfile = false
WedgeFileObserver: DELETE: WMS_scanner_property.xml
```

Profil `WMS` je od té chvíle v seznamu profilů (třetí vedle `default` a `novsig`).
Tím je **cesta nasazení na flotilu ověřená**: nakopírovat soubor = hotovo.

### ⚠ Jenže: PWA se ScanWedge nehlásí jako vlastní aplikace

ScanWedge sleduje, která aplikace je v popředí (`DWedgeFATracker`), a podle toho
nasazuje profil. Při spuštění naší WMS se v logu objeví tohle:

```
DWedgeFATracker: ... org.chromium.webapk.a19e41e...  H2OOpaqueMainActivity
DWedgeFATracker: ... org.chromium.webapk.a19e41e...  SplashActivity
DWedgeFATracker: ... com.android.chrome  WebappLauncherActivity
DWedgeFATracker: ... com.android.chrome  SameTaskWebApkActivity
```

Balíček WebAPK se mihne jen při startu; **po celou dobu skutečné práce je
v popředí `com.android.chrome`**. Vázat profil jen na WebAPK tedy nestačí –
při skenování by se nepoužil.

A `SameTaskWebApkActivity` je společná **všem** PWA v Chromu, takže ani vázání
na konkrétní aktivitu neoddělí naši aplikaci od kolegovy.

Profil se proto váže na **`com.android.chrome`**. Tím převezme i ostatní PWA
v Chromu, mezi nimi kolegovu – **kolega s tím 21. 11. 2026 souhlasil**, protože
má přesně tentýž problém a zapnutý skener mu vyhovuje.

Vázat na balíček WebAPK není potřeba a vede k hlášce
`add TABLE_APP_LIST error, packageName already added`. V nasazovaném souboru
je proto jen Chrome – navíc je tím soubor stejný pro všechny čtečky,
protože jméno WebAPK se liší kus od kusu.

## Výsledek zkoušky

**Funguje.** Zkouška 21. 11. 2026 na náhradní čtečce, zachyceno v logu:

```
11:07:46  DWedgeScanService: locked triggering          ← agendová aplikace zamkla skener
11:07:54  DWedgeFATracker: com.android.launcher3        ← odchod na plochu
11:07:56  DWedgeFATracker: com.android.chrome / SameTaskWebApkActivity   ← start WMS
11:07:56  DWedgeScanService: scanner already open       ← skener je zase otevřený
11:08:06  SCANNER_DECODE_EVENT  (6×)                    ← šest úspěšných skenů
```

Skener se tedy odemkl **sám při přepnutí do naší aplikace**, bez zásahu skladníka.

> Pozn.: zámek v téhle zkoušce nastavila aplikace **`cz.gajatech.deksklady`**
> (DEKsklady), ne `cz.gajatech.dekscan`, jak jsme dosud psali. Na čtečce jsou
> obě; `deksklady` je ta, u které je zámek zachycený v logu.

Výstupní režim se profilem **nerozbil** – sken dál chodí jako klávesnice,
přestože je v profilu zapsaná jen vlastnost `SCANNER_ENABLE`. Ostatní
nastavení se tedy dědí, nevrací se na výchozí.

## Co ještě nevíme

- **Export nefunguje tak, jak dokumentace píše.** Broadcasty
  `action.EXPORT_SCANNER_CONFIG` i `com.ubx.datawedge.EXPORT_SCANNER_CONFIG`
  s extra `profileName` proběhly bez chyby, ale **žádný soubor nevznikl**.
  Proto zatím neznáme skutečný tvar konfigurace z téhle čtečky, jen tvar z dokumentace.
- **Neznáme číslo vlastnosti pro Output Mode** (keyboard vs. intent). Známe
  `id 0 = SCANNER_ENABLE`, `id 6 = SEND_GOOD_READ_BEEP_ENABLE`,
  `id 200000 = WEDGE_INTENT_ACTION_NAME`, `id 200002 = INTENT_DATA_STRING_TAG`.
  Úplný seznam v repozitáři Urova není.
- Jestli `profilePackages` zabere i na WebAPK (Chrome si obrazovky spravuje sám).

## Nasazení na víc čteček

**Konfigurace je vždy na zařízení, ne v aplikaci.** Webová aplikace nemá
k nastavení skeneru přístup, takže se profil **nedá přibalit k aplikaci**
a rozdat přes Commit + Push jako zbytek WMS. Každá čtečka ho musí jednou dostat.

Dobrá zpráva: je to **jednorázové**. Profil přežije restart čtečky i aktualizaci
aplikace. Proti dnešku, kdy skladník musí skener odemykat pořád dokola, je to
jedno nastavení navždy.

Cesty, jak soubor na čtečku dostat (od nejjednodušší):

| Způsob | Co to obnáší | Vhodné pro |
|---|---|---|
| **Kopie přes USB** | `adb push` nebo prostě nakopírovat soubor do `/sdcard/enterprise/scanwedge/autoimport` | první zkouška, pár kusů |
| **Soubor přes síť** | stáhnout na čtečce a přesunout do autoimport složky | čtečky, které nejsou po ruce |
| **UStage / Enterprise Desktop** | na čtečce jsou `com.ubx.ustage` a `com.urovo.enterprisemodeldesktop` – Urovo nástroje na hromadné nastavení | 10–15 kusů najednou |
| **MDM** | Urovo uvádí UHome a SOTI MobiControl | když DEK správu zařízení má – OVĚŘIT u IT |

Odhad: ručně přes USB **~2 minuty na čtečku**, tedy půl hodiny na celou flotilu.
Jednou.

### Postup na jednu čtečku (ověřený)

1. Čtečku připojit USB kabelem, mít povolené **Ladění USB** (viz `test-skeneru-pres-usb.md`).
2. Nahrát soubor:

```powershell
.\adb.exe push WMS_scanner_property.xml /sdcard/enterprise/scanwedge/autoimport/
```

3. Hotovo. ScanWedge soubor **do vteřiny načte a smaže** – prázdná složka
   je potvrzení, že import proběhl. Žádný restart, žádné klikání na čtečce.
4. Kontrola (nepovinná): v aplikaci ScanWedge přibude v seznamu profil `WMS`.

Soubor je v repozitáři: **`scanwedge/WMS_scanner_property.xml`** – stejný pro
všechny čtečky.

**Odebrání:** v aplikaci ScanWedge → profily → `WMS` → odebrat.
Profily `default` a `novsig` zůstávají nedotčené.

## ⚠ Riziko pro cizí aplikace – číst před nasazením

Na téže čtečce **nejsme sami**. Vedle naší WMS je nainstalovaná ještě PWA
kolegy (`washeck009.github.io`) a agendové aplikace Gajatechu.

Z toho plynou dvě pravidla:

1. **Profil vázat jen na náš balíček WebAPK, NE na `com.android.chrome`.**
   Kolegova aplikace je taky PWA a běží přes tentýž Chrome. Kdybychom profil
   navázali na Chrome, převzal by i jeho aplikaci a nasadil jí naše nastavení
   skeneru. Dokumentace navíc říká, že **jedna aplikace smí patřit jen jednomu
   profilu** – vznikl by spor s tím, co má nastavené dnes.
   Cena za to: když někdo otevře WMS v prohlížeči místo z nainstalované ikony,
   profil se nepoužije. Skladníci chodí přes ikonu, takže to nevadí.

2. **Nikdy neměnit profily `default` a `novsig`, jen přidávat vlastní.**
   A to z tvrdého důvodu: **export konfigurace na téhle čtečce nefunguje**,
   takže si current stav nemáme jak zazálohovat. Co bychom přepsali,
   to už nevrátíme jinak než ručním překlikáním.

Kolega má se zámkem skeneru **stejný problém**. Až se u nás ověří, že to funguje,
dá se mu udělat vlastní profil na jeho balíček – ale to je jeho rozhodnutí
a jeho aplikace, my mu do nastavení nesaháme.

**Zkoušet na jedné čtečce, ideálně ne na té, která je v provozu na CS2.**
Profil se dá kdykoli smazat v ScanWedge (Profily → vybrat → odebrat).

## Další krok

Napsat vlastní profil `WMS_scanner_property.xml` (nový profil, **výchozí se nesahá**),
nahrát ho do autoimport složky a vyzkoušet:

1. otevřít agendovou aplikaci, aby skener zamkla
2. přepnout do WMS
3. zkusit sken

Když skener naběhne sám, je problém vyřešený konfigurací a **nativní obal
kvůli skeneru stavět nemusíme** (pro notifikace a frontu při výpadku wifi
může dávat smysl dál, ale to je jiné rozhodnutí).
