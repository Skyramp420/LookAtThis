# LookAtThis

*„Pozri sa na to.“* Ľahký replay buffer a nahrávanie obrazovky. Robí to isté, čo ti doteraz robil skrytý OBS, ale so zvukom, ktorý SteelSeries Sonar nerozbije. Vyzerá ako WorkingOnIt (téma Čistá).

## Inštalácia

Stiahni `LookAtThis-Setup-….exe` z [Releases](https://github.com/Skyramp420/LookAtThis/releases/latest) a nainštaluj. Appka sa potom aktualizuje sama. Kým inštalačka nie je podpísaná, Windows ukáže modré okno: *Ďalšie informácie → Spustiť aj tak*.

Ako vydať novú verziu, je v [VYDANIE.md](VYDANIE.md).

## Spustenie zo zdrojákov

1. Dvojklik na **`Spustit.bat`**. Pri prvom spustení sa asi minútu inštaluje, potom sa appka otvorí.
2. Prejdi **sprievodcu** (skratky, zvuk so živými meračmi, výkon podľa tvojho PC, priečinok a overlay). Znova ho spustíš v Nastavenia → O appke.
3. Vypni v OBS spúšťanie s Windowsom, nech sa dve appky nebijú o GPU a zvuk.

Normálnu inštalačku s ikonkou v Štarte urobí `Vytvorit-instalacku.bat` (výsledok je v priečinku `dist`).

## Ako sa ovláda

| Čo | Ako |
|---|---|
| **Uložiť clip** | `Alt+F10` uloží posledných 60 s. Dĺžku rýchlo zmeníš kliknutím na ňu v karte bufferu vľavo dole (15 s až 10 min) |
| **Nahrávanie** | `Alt+F9` spustí, druhé `Alt+F9` zastaví a uloží |
| **Klipy** | Klik otvorí editor. `Ctrl` + klik (alebo krúžok v rohu) vyberie viac klipov, `Shift` + klik celý rozsah, `Ctrl+A` všetko. Vybrané klipy spojíš v editore alebo vymažeš (`Delete`) |
| **Triedenie** | Pásik hier hore filtruje podľa hry (pravý klik na hru = premenovať). Hviezdička na klipe = obľúbené. Zoradíš podľa dátumu, dĺžky, veľkosti alebo názvu a zoskupíš podľa dní alebo hier. Hru klipu zmeníš cez pravý klik → *Zmeniť hru* |
| **Priečinky** | Vľavo pod menu: *+* vytvorí skutočný podpriečinok v priečinku s klipmi. Klipy doň pretiahneš myšou, alebo pravý klik → *Presunúť do priečinka* (funguje aj pre viac vybraných). *Klipy* ukazujú len klipy mimo priečinkov, hľadanie ide cez všetky. Pravý klik na priečinok = premenovať, otvoriť v Prieskumníkovi, zrušiť (klipy sa vrátia späť, nič sa nemaže) |
| **Krátky clip** | Druhá skratka (nastavíš v Nastavenia → Skratky) uloží len posledných 10 až 30 s |
| **Náhľad** | Prejdi myšou po karte klipu a video sa pretáča podľa polohy myši |
| **Import** | Pretiahni videá z Prieskumníka do appky (alebo na priečinok vľavo) a skopírujú sa do knižnice |
| **Upratovanie** | Nastavenia → Clipy: keď klipy zaberú viac ako 20 až 200 GB, najstaršie idú do Koša. Obľúbené a klipy v priečinkoch sa nikdy nemažú |
| **Hľadanie** | `Ctrl+F`. Hľadá v názve, hre, type aj dátume a nevadí mu diakritika. Výrazy sa dajú kombinovať: `dnes`, `včera`, `pondelok`, `16.10.`, `>30s`, `<2m`, `hra:valorant`, `typ:nahrávka`, `typ:strih`, `obľúbené` |
| **Zdieľanie** | Pravý klik → *Zmenšiť* (20 MB, 10 MB, Nitro Basic 50 MB alebo vlastná veľkosť). Rozlíšenie a fps sa vyberú samy podľa dĺžky klipu a výsledok sa skopíruje do schránky, v Discorde stačí `Ctrl+V`. Klip môžeš z knižnice aj rovno pretiahnuť myšou do Discordu |
| **Editor** | Vľavo náhľad, vpravo panel s kartami *Text*, *Úsek* a *Zvuk*, dole časová os s filmovým pásom a priebehom zvuku. Najrýchlejší strih: posuň prehrávanie a stlač `Q` (odstrihne začiatok) alebo `W` (odstrihne koniec). `S` rozdelí úsek, okraje úseku orežeš ťahaním, úseky preusporiadaš ťahaním, *Pridať klip* pridá ďalší klip na koniec. Okraje sa prichytávajú (magnet, `N`). Všetky skratky ukáže ikonka klávesnice alebo `?` |
| **Úsek** | Klik na úsek otvorí kartu *Úsek*: rýchlosť (0,25× až 2×), roztmievanie a stmievanie, orezanie po miesto prehrávania, duplikovanie a návrat k celému klipu |
| **Na výšku** | Hore v editore prepni formát na *9:16* (TikTok, Shorts, Reels), *1:1* alebo *4:5*. Video v náhľade ťaháš do strán a vyberáš, čo bude vidieť. Každý úsek môže mať výrez inde: rozdeľ klip (`S`) a posuň výrez za akciou. V karte *Úsek* je aj mapka výrezu a tlačidlá Vľavo / Stred / Vpravo |
| **Text a šípky** | Klik na *Text* alebo na rýchly štýl (Klasický, Meme, Titulok, Neón, Žltý) pridá text na 4 sekundy. Šípku ťaháš vo videu. Text sa pri ťahaní prichytí na stred, poloha Hore / Stred / Dole jedným klikom, animácie objavenia (Fade, Pop, Zdola) aj zmiznutia |
| **Uloženie** | Hore vpravo vyberieš veľkosť (pôvodná, 20 / 10 / 50 MB) a *Uložiť* (`Ctrl+S`). Po uložení môžeš klip rovno skopírovať do Discordu. Keď editor zavrieš s neuloženými úpravami, spýta sa, či ich chceš zahodiť |
| **Hry** | LookAtThis sám nájde nainštalované hry (Steam, Epic, GOG, Ubisoft, Xbox, Riot, Minecraft) aj s ikonkami. Stopa Hra ich potom spozná aj v okne |
| **Overlay** | Po uložení clipu sa v rohu otvorí oko, ktoré sa pozrie na tvoj clip, alebo vybehne klapka (nad hrou v okne alebo v borderless režime, nie v exkluzívnom fullscreene). Animáciu, roh a zvuk vyberieš v Nastaveniach. Kým je overlay zapnutý, notifikácia Windowsu o uložení nechodí (len pri chybe). |
| **Slabší PC** | *Úsporný režim* (Nastavenia → Video) zníži fps na 30, rozlíšenie na max. 1080p (bez HW enkodéra 720p) a odľahčí enkodér. Na *Automaticky* sa zapne sám, keď má PC 4 jadrá a menej, menej ako 8 GB RAM alebo žiadny HW enkodér |
| **Na pozadí** | Krížik okno len skryje. Appka beží v lište vedľa hodín a s Windowsom sa spúšťa skrytá |

Clip má názov podľa hry, napríklad `VALORANT-Win64-Shipping 2026-10-16 20-15-01.mp4`. Ukladá sa do `Videá\LookAtThis`. Nastavenia zo starého ClipItu sa pri prvom spustení prenesú samy a staré klipy zostanú tam, kde boli (priečinok sa nemení).

## Zvukové stopy v clipe

1. **Mix (systém + mikrofón)**: aby si v bežnom prehrávači a na Discorde počul všetko. Dá sa vypnúť.
2. **Systém**: loopback zariadenia, na ktorom počúvaš (slúchadlá za Sonarom)
3. **Hra**: len zvuk hry. Automaticky sa chytí appka v popredí na celú obrazovku alebo borderless.
4. **Discord**: len hlasový chat
5. **Mikrofón**

V DaVinci Resolve aj Premiere sa každá stopa naimportuje zvlášť a s názvom.

**Keď mikrofón mešká za obrazom** (napríklad cez VST pluginy): v *Zvuk → Mikrofón → Zistiť tlieskaním* appka zahrá 8 úderov, pri posledných 4 tleskneš. Tiky sa nahrajú do stopy Systém, tlesknutia do mikrofónu a z rozdielu sa nastaví oneskorenie (dá sa doladiť tlačidlami − / + pri každej stope). V editore má každá stopa v karte *Zvuk* tlačidlo ⇆ na posun konkrétneho klipu.

## Prečo to Sonar nerozbije

- **Zariadenia sa hľadajú podľa ID, nie podľa poradia.** Keď ID zmizne (napríklad po aktualizácii Sonaru), LookAtThis nájde zariadenie podľa mena, nové ID si uloží a ukáže ti o tom upozornenie. Keď nenájde ani meno, použije predvolené zariadenie a dá ti vedieť.
- **Hra a Discord sa chytajú priamo z procesu** (Windows process loopback). Je im jedno, na ktorý virtuálny výstup ich Sonar pošle.
- Keď zariadenie alebo appka zmizne, do stopy sa píše ticho. Zvuk sa tak nikdy nerozíde s obrazom a nahrávanie nespadne.

## Ako to funguje vo vnútri

- `native/fxaudio.exe`: malý pomocník v C (zdroják je `native/fxaudio.c`) zachytáva zvuk cez WASAPI. Každá stopa je jeden proces a zvuk posiela cez pomenovanú rúru do ffmpeg.
- Obraz snímaš cez **ddagrab** (Desktop Duplication priamo na GPU) a kóduje sa cez **NVENC**. Keď NVENC nie je, appka skúsi AMD AMF, potom Intel QuickSync a nakoniec procesor (x264). Na NVIDII v natívnom rozlíšení obraz vôbec neopustí grafiku.
- ffmpeg píše 2-sekundové segmenty do `%TEMP%\LookAtThis-buffer`. Staré segmenty sa mažú, clip vznikne spojením posledných segmentov bez prekódovania, takže sa uloží za zlomok sekundy.
- Ak sa ffmpeg nerozbehne, appka sama skúsi ľahší režim (cez systémovú pamäť, potom x264).
- Na pozadí sa šetrí: zoznam enkodérov sa zisťuje raz za 30 dní, skryté okno sa po minúte úplne zavrie (pri spustení s Windowsom sa ani neotvorí) a overlay okno existuje len pár sekúnd po uložení.

Pomocníka skompiluješ znova takto (stačí raz, `fxaudio.exe` už je v priečinku):
```
pip install ziglang
python -m ziglang cc -target x86_64-windows-gnu -O2 -s -o native/fxaudio.exe native/fxaudio.c -lole32 -lshell32 -luser32
```

## Keď niečo nejde

**Nastavenia → O appke → Otvoriť log.** V logu je celý príkaz pre ffmpeg aj dôvod, prečo spadol.

Požiadavky: Windows 10 2004 a novší alebo Windows 11 (kvôli zvuku z jednotlivých appiek) a Node.js LTS.
