/* Čo je nové: krátko a ľudsky, najnovšie hore. Pri novom vydaní pridaj záznam navrch. */
(function (root) {
  const LOG = [
    { v: '1.0.28', items: [
      'Opravené: video v náhľade po čase stále preblikávalo (skákalo dookola na to isté miesto).',
      'Časová os sa posúva plynulo: priebehy zvuku a náhľady už nezaostávajú. Pribudol posuvník dole, koliesko posúva v čase, Ctrl + koliesko približuje.',
      'Posuvníky ukazujú správnu výplň, prepínače sedia aj po zmene veľkosti panelov a inšpektor sa pri úpravách už znova neanimuje.',
      'Keyframy: klik na kosoštvorec ho vyberie a Delete zmaže len ten jeden. Pravý klik = zmazať alebo zmeniť krivku. V inšpektore je panel vybraného keyframu.',
      'Menej záťaže pri prehrávaní (video sa neprekresľuje zbytočne každú snímku).'
    ] },
    { v: '1.0.27', items: [
      'Opravené: po otvorení klipu, ktorý už mal náhľadovú kópiu, sa uložil v nižšom rozlíšení. Uložené video je teraz vždy v plnej kvalite. V editoroch pribudol prepínač náhľadu v plnej kvalite (HD).',
      'Keyframy v advanced editore: priblíženie, poloha, otočenie (video aj text) a hlasitosť úseku. Kosoštvorce na osi sa dajú ťahať, ku každému nastavíš krivku (plynulo, rozbeh, dobeh, s prekmitom, skok alebo vlastnú).',
      'Efekty: pomalý nájazd, oddialenie, Ken Burns, úder, nájazd na moment, zatrasenie, otočka a prílet zboku. Pridajú sa ako keyframy, takže sa dajú doladiť.',
      'Klipy na osi presunieš pred alebo za iné klipy, ostatné plynulo uhnú. Zvuk pripojíš späť k videu aj po posunutí (pravý klik).',
      'Panely editora si zväčšíš ťahaním za okraj, vľavo pribudli karty Text a Efekty. Priebeh zvuku je v decibeloch, takže sú vidieť aj tiché stopy.'
    ] },
    { v: '1.0.26', items: [
      'Plynulejšie editory: ku každému klipu sa na grafike vyrobí ľahká náhľadová kópia. Skok na iné miesto je hneď a posúvanie po osi skoro nezaťaží procesor. Export stále berie pôvodnú kvalitu.',
      'Pri ťahaní po časovej osi sa video už nesnaží dobehnúť každý pohyb myši, ide rovno na posledné miesto.',
      'Nová karta Projekty: montáže z advanced editora sa ukladajú samé, môžeš ich otvoriť, premenovať, duplikovať alebo vymazať. Nová montáž jedným klikom.',
      'Advanced editor: médiá sa dajú filtrovať (text, dátum, hra, zoradenie), pravý klik na položku na osi (rozdeliť, duplikovať, odpojiť/pripojiť zvuk, rýchlosť, roztmievanie, vymazať).',
      'Opravené: tlačidlo Späť (a ďalšie hore) v editore nereagovalo. Opravený aj zoom časovej osi. Pribudli tlačidlá okna.'
    ] },
    { v: '1.0.25', items: [
      'Nové: advanced editor. V jednoduchom editore daj „Advanced“ (alebo pravý klik na klip → Otvoriť v advanced editore) a video plynulo prejde do väčšieho editora.',
      'Každá zvuková stopa (systém, hra, Discord, mikrofón) má na časovej osi vlastný riadok: stlmíš ju, zosilníš alebo ostrihneš zvlášť. Pridáš aj hudbu zo súboru.',
      'Viac klipov za sebou, rozdelenie (S), presúvanie a orezávanie ťahaním, prichytávanie, späť/znova.',
      'Text so štýlmi a animáciami, posúvaš ho priamo v náhľade. Formáty 16:9, 9:16 (Shorts, TikTok) a 1:1 s posúvaním výrezu.',
      'Export do knižnice, aj na 20 MB pre Discord, alebo so samostatnými stopami pre DaVinci. Rozpracovaná montáž sa priebežne ukladá.'
    ] },
    { v: '1.0.24', items: [
      'Opravené: klip uložený cez OBS ukázal „bez hry“, hoci hra v ňom bola.'
    ] },
    { v: '1.0.23', items: [
      'Most do OBS: OBS dodá len obraz hry, zvuk je z LookAtThis, takže klip má zase oddelené stopy (systém, hra, Discord, mikrofón, mix). Obraz so zvukom sa zosynchronizuje automaticky podľa zvuku.',
      'Opravené: skryté OBS sa niekedy nespustilo (zaseklo sa na neviditeľnom okne a Windows len pípol). LookAtThis teraz také OBS ukončí a spustí znova.'
    ] },
    { v: '1.0.22', items: [
      'Most do OBS: obraz z hry je roztiahnutý na celé plátno v rozlíšení tvojho monitora (predtým bola v klipe len časť obrazu).',
      'Most do OBS nahráva aj zvuk počítača a mikrofón (rovnaké zariadenia ako v LookAtThis) a kóduje na grafike (NVENC/AMD/Intel) namiesto procesora.',
      'OBS sa spustí hneď s Valorantom, takže aj prvý klip po skrytí hry má celý buffer. Keď hru vypneš, OBS sa samo zavrie a vyskočí „Nahrávam cez LookAtThis“.',
      'OBS spustené mostom sa už nehlási ako „iný nahrávací program“.'
    ] },
    { v: '1.0.21', items: [
      'Nové (skúšobné): most do OBS pre hry, čo sa skrývajú pred nahrávaním (Valorant). Zapni v Nastaveniach → „Nahrávať cez OBS“. Keď sa hra skryje, LookAtThis spustí na pozadí OBS (skrytý v tray), nahráva cez jeho Game Capture a klip uloží tou istou skratkou do tvojej knižnice.',
      'Kontrolka v rohu pri takej hre ukáže „cez OBS“ (zelená) namiesto „sa nenahráva“, a vyskočí aj upozornenie „Nahrávam cez OBS“.'
    ] },
    { v: '1.0.20', items: [
      'Keď sa hra (napr. Valorant) skryje pred nahrávaním, v rohu obrazovky sa rozsvieti kontrolka „sa nenahráva“ a svieti, kým to trvá.',
      'Ak uložíš clip, kým je hra skrytá, oznámenie ti povie, že v klipe bude len plocha.',
      'Oznámenia v rohu sa už nedostanú do klipov.'
    ] },
    { v: '1.0.19', items: [
      'Keď sa hra (napr. Valorant) skryje pred nahrávaním alebo sa znova ukáže, appka si zapíše presný čas. Pomôže to zistiť, prečo sa to deje.'
    ] },
    { v: '1.0.18', items: [
      'Opravené: keď si zamkol PC alebo vyskočilo okno „Chcete povoliť…“ (UAC), buffer spadol a už sa nerozbehol. Teraz počká a rozbehne sa sám, hneď ako sa obrazovka vráti.'
    ] },
    { v: '1.0.17', items: [
      'Opravené: klip sa v editore niekedy otvoril dvakrát, video hralo na pozadí a časová os bola dlhšia.',
      'Opravené: po odchode z celej obrazovky bol výber záložky (Text / Úsek / Zvuk) roztiahnutý.',
      'Časová os sa už nedá posunúť o kúsok za koniec.'
    ] },
    { v: '1.0.16', items: [
      'Opravené: keď sa snímanie obrazu zaseklo, klip mohol mať desiatky minút prázdneho videa. Buffer sa teraz po 12 s sám reštartuje a klip sa skráti na správnu dĺžku.'
    ] },
    { v: '1.0.15', items: [
      'Appka spozná, keď sa hra schováva pred snímaním obrazovky (vo videu by bola vidieť len plocha), a upozorní ťa.',
      'Nový prepínač „Rozšírené zachytávanie kláves“ v Nastaveniach → Skratky.'
    ] },
    { v: '1.0.14', items: [
      'Opravené: pomocník na skratky a sledovanie okien sa vôbec nedostal do inštalačky. Až teraz naozaj fungujú skratky v hrách s anti-cheatom, prepnutia hier na časovej osi aj výrez okna hry.'
    ] },
    { v: '1.0.13', items: [
      'Časová os v editore ukazuje malé ikonky, keď si počas klipu prepol na inú hru alebo na plochu.',
      'Výrez okna hry sa berie z toho, ako dlho a kde bolo okno hry počas celého klipu, nie len v momente uloženia.',
      'Opravené: video v editore malo po otvorení niekedy čierny okraj vpravo.',
      'Tlačidlo celej obrazovky je teraz v lište nad časovou osou.',
      'Hviezdička obľúbených má jemnejšiu animáciu a karta už neposkočí.'
    ] },
    { v: '1.0.12', items: [
      'Skratku zmeníš priamo v karte buffra vľavo dole: klikni na ňu a stlač novú kombináciu.',
      'Editor vie prehrať video na celú obrazovku (tlačidlo v rohu videa alebo kláves F).',
      'Formát → „Orezať čierne okraje“: keď hra beží v inom pomere strán ako monitor, jedným klikom odrežeš čierne pásy.',
      'Opravené: video sa v editore niekedy neprispôsobilo a panel napravo utiekol mimo okna.',
      'Upozornenie na iný nahrávací program zmizne do pár sekúnd po jeho zatvorení.',
      'Sprievodca nastavením sa pýta aj na upratovanie, značky a hry s anti-cheatom.',
      'Nový Minecraft (java.exe) sa spozná ako hra sám.'
    ] },
    { v: '1.0.11', items: ['Okno appky v pozadí už takmer nezaťažuje procesor ani grafiku: animácie stoja, keď sa naň nepozeráš.'] },
    { v: '1.0.10', items: ['Upozornenie, keď na pozadí beží aj OBS, Medal, Game Bar alebo iný nahrávací program. Dá sa zavrieť jedným klikom.'] },
    { v: '1.0.9', items: [
      'Značky: skratkou označíš moment počas hrania, v editore naň skočíš klávesou M.',
      'Nastavenie „Vyrezať okno hry v editore“: klip z hry v okne sa otvorí rovno s výrezom.',
      'Vysoká kvalita zapisuje na disk zhruba o polovicu menej, rozdiel takmer nevidno.'
    ] },
    { v: '1.0.8', items: ['Editor vie vyrezať len okno hry alebo vlastnú oblasť (Formát → Oblasť záznamu).', 'Skratky fungujú aj v hrách s anti-cheatom (LoL, Valorant), v Nastaveniach je na to prepínač.'] },
    { v: '1.0.7', items: ['Opravený pád pri ťahaní klipu do Discordu.'] },
    { v: '1.0.6', items: ['Veľmi široké monitory (napr. 5120×1440) sa nahrávajú správne.', 'Skratky sa dajú nastaviť aj na slovenskej klávesnici.'] },
    { v: '1.0.5', items: ['Pridávanie klipov v editore má hľadanie, zoradenie a výber dátumu.', 'Knižnica má kalendár s rozsahom dátumov.', 'Časová os sa po strihu plynulo prispôsobí, už neskáče pod kurzorom.'] }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = LOG;
  else root.CHANGELOG = LOG;
})(typeof window !== 'undefined' ? window : globalThis);
