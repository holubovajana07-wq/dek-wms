# DEK WMS – Půjčovna strojů

Skenovací aplikace pro centrální sklad CS2. Skladník naskenuje QR kód stroje
při příjmu nebo výdeji, aplikace zapíše čas do evidenční tabulky.

**Aplikace:** https://holubovajana07-wq.github.io/dek-wms/

## Co je v repozitáři

| Soubor | Co to je |
|---|---|
| `index.html` | Celá aplikace pro čtečku. Nasazuje se sama přes GitHub Pages. |
| `backend/Kod.gs` | Google Apps Script – komunikuje s tabulkou. Kopíruje se ručně. |
| `CLAUDE.md` | Kontext projektu |
| `docs/` | Původní dokumentace |

Data v repozitáři **nejsou** a nikdy nebudou – ta zůstávají v Google Sheets.

---

## Jak nasadit změnu ve frontendu (`index.html`)

1. V GitHub Desktopu napsat popisek změny a dát **Commit to main**
2. **Push origin**
3. Počkat 1–2 minuty, GitHub Pages se aktualizují samy
4. Na čtečce obnovit stránku (přetáhnout prstem dolů)

Hotovo. Nic dalšího není potřeba.

---

## Jak nasadit změnu v backendu (`backend/Kod.gs`)

1. Otevřít projekt v [Apps Scriptu](https://script.google.com)
2. Smazat obsah souboru a vložit nový obsah z `backend/Kod.gs`
3. Uložit (Ctrl+S)
4. **Nasadit → Spravovat nasazení → ozubené kolečko → Verze: Nová → Nasadit**

> ⚠️ **Nikdy nevolit „Nové nasazení".** Dostali byste jinou URL adresu
> a všechny čtečky by přestaly fungovat, protože mají uloženou tu starou.

### Ověření, že to běží

Otevřít v prohlížeči URL skriptu s `?action=ping` na konci. Má se vrátit:

```json
{"ok":true,"verze":"2.0","cas":"..."}
```

---

## První nastavení Apps Scriptu

ID tabulky není v kódu (repozitář je veřejný). Nastavuje se jednou:

**Nastavení projektu → Vlastnosti skriptu → Přidat vlastnost**

| Název | Hodnota |
|---|---|
| `SHEET_ID` | ID tabulky Půjčovna (najdete v její URL) |
| `WMS_TOKEN` | *(nepovinné)* heslo, které musí čtečka poslat |

Bez `SHEET_ID` skript záměrně neběží – aby se nestalo, že si omylem sáhne
do špatné tabulky.

**Token nastavujte až tehdy, když ho zadáte i do čtečky** (Nastavení →
Přístupový token). Jinak se čtečka ke skriptu nedostane.

---

## Nastavení čtečky

Při prvním spuštění aplikace se zeptá na:

- **URL webové aplikace** – z Apps Scriptu, Nasadit → Spravovat nasazení
- **Přístupový token** – jen pokud je nastaven `WMS_TOKEN`
- **Sklad** – CS2

Nastavení se ukládá v prohlížeči té konkrétní čtečky. Každé zařízení se
nastavuje zvlášť.

Tlačítko **Spustit DEMO bez připojení** jede na vymyšlených datech a nic
nikam nezapisuje – vhodné na zaškolení.

---

## Diagnostika

V Apps Scriptu lze ručně spustit:

| Funkce | K čemu |
|---|---|
| `overSloupce()` | Vypíše, jestli sloupce v tabulce odpovídají tomu, co kód čeká. Spustit, když se začnou zapisovat nesmysly – typicky když někdo do tabulky vloží sloupec. |
| `testLookup()` | Zkusí vyhledat stroj `9JT9` a vypíše, co našel. |

Výsledek se objeví v **Protokoly spuštění**.
