# Ako vydať LookAtThis

Návod pre teba ako autora. Používatelia nič z toho nepotrebujú, tým stačí inštalačka. Funguje to rovnako ako pri WorkingOnIt.

## Ako to funguje

1. Zvýšiš verziu v `package.json` a pošleš na GitHub značku (tag), napríklad `v1.0.1`.
2. GitHub skontroluje kód, postaví inštalačku pre Windows a dá ju do **Releases**.
3. Nainštalované appky si to do pár hodín všimnú, novú verziu stiahnu potichu na pozadí a nainštalujú ju, keď appku ukončíš. Vľavo v appke sa objaví tlačidlo *Aktualizovať na …*, v *Nastavenia → O appke* sa dá skontrolovať a reštartovať aj hneď.

Rozpracované zmeny bez značky nikomu nič nespravia, takže pushovať môžeš koľko chceš.

## Jednorazové nastavenie

Repozitár `Skyramp420/LookAtThis` je verejný a návod pre GitHub (`.github/workflows/release.yml`) je už v ňom. Aktualizácie z GitHub Releases sú zadarmo a bez hesla len pri verejnom repozitári, preto ho nechaj verejný.

Ak chceš kód upravovať aj sám, v GitHub Desktop daj *File → Clone repository → LookAtThis*. Priečinok na ploche (`Spustit.bat`) slúži na testovanie.

## Vydanie novej verzie

1. V `package.json` zvýš `"version"`, napríklad z `1.0.0` na `1.0.1`.
   - opravy: posledné číslo (1.0.**1**)
   - nové funkcie: prostredné (1.**1**.0)
2. V GitHub Desktop zmeny *Commit* a *Push origin*.
3. Značka: *History*, pravý klik na posledný commit, *Create Tag…*, napíš `v1.0.1` (s malým v), potom znova *Push origin*.
4. Na GitHube v záložke **Actions** uvidíš, ako to beží (zhruba 5 až 10 minút). Keď je to zelené, v **Releases** je `LookAtThis-Setup-1.0.1.exe`.

Namiesto značky môžeš vydanie spustiť aj ručne: **Actions → Vydanie → Run workflow**. Verzia sa zoberie z `package.json` a značku si vydanie vytvorí samo.

### Testovacie (beta) verzie

Verzia s pomlčkou, napríklad `1.1.0-beta.1` a značka `v1.1.0-beta.1`, sa označí ako *pre-release*. Dostanú ju len tí, čo majú v *Nastavenia → O appke* zapnuté **Beta verzie**.

## Ty a Spustit.bat

- Nainštalovaná appka a `Spustit.bat` majú **spoločné nastavenia aj klipy** (`%APPDATA%\LookAtThis`), takže po inštalácii máš všetko ako doteraz.
- Naraz nebežia: druhá sa len prepne na tú, čo už beží. Pred testovaním cez `Spustit.bat` nainštalovanú appku ukonči (ikonka v lište → Ukončiť).
- Štart s Windowsom patrí nainštalovanej verzii, `Spustit.bat` ho neprepisuje.

## Prvá inštalácia u ľudí

Pošli im odkaz `https://github.com/Skyramp420/LookAtThis/releases/latest`, stiahnu si `LookAtThis-Setup-….exe` a nainštalujú. Ďalej sa aktualizuje samo.

Kým inštalačka nie je podpísaná, Windows ukáže modré okno **„Systém Windows ochránil počítač“**. Treba kliknúť na *Ďalšie informácie → Spustiť aj tak*. Možnosti podpisu (Microsoft Store zadarmo, SignPath pre open source, Certum) sú rovnaké ako pri WorkingOnIt, viď jeho `VYDANIE.md`.
