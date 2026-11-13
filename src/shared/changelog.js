/* Čo je nové: krátko a ľudsky, najnovšie hore. Pri novom vydaní pridaj záznam navrch. */
(function (root) {
  const LOG = [
    { v: '1.0.45', items: [
      'Obrázky na časovej osi: tlačidlo Obrázok pridá logo, meme alebo vodoznak (PNG aj s priehľadnosťou, JPG, WebP) na vrstvu nad videom. Dá sa posúvať, zväčšovať, otáčať, animovať keyframami a ľubovoľne natiahnuť.',
      'Výber obdĺžnikom: ťahaním z prázdneho miesta na časovej osi vyberieš viac klipov naraz (Shift pridá k výberu). Po čase sa ťahá za pravítko alebo prehrávaciu hlavu.',
      'Opravené: keď bol ten istý klip na osi dvakrát v tom istom čase (napr. na hlavnej stope aj na vrstve), v náhľade hral zvuk len jedného.',
      'Esc v advanced editore už nezatvára celý editor, len ruší výber. Zatvára sa tlačidlom Späť.',
      'Opravené: THE FINALS sa pri spustení cez Discovery-d.exe ukazovali ako „Discovery-d“. Platí aj pre už uložené klipy.',
      'Hľadanie nainštalovaných hier si zapamätá aj varianty spúšťacieho súboru (napr. Discovery-d.exe pri THE FINALS).'
    ] },
    { v: '1.0.44', items: [
      'Opravené (dôležité): text, ktorý si v advanced editore zväčšil, otočil alebo rozhýbal keyframami či efektom, sa vyexportoval nehybný v pôvodnej veľkosti. Export teraz sedí s náhľadom a zväčšený text je ostrý.',
      'Opravené: dĺžka zosilnenia a stíšenia zvuku sa v exporte ignorovala (vždy pol sekundy).',
      'Opravené: roztmievanie klipu na vrchnej video vrstve stmavilo v náhľade celý obraz a v exporte spravilo čierny obdĺžnik. Vrstva sa teraz plynulo objaví a stratí, rovnako v náhľade aj vo videu.',
      'Opravené: po kliknutí na posuvník (priblíženie osi, hlasitosť, dĺžka stmievania) prestali fungovať klávesové skratky. Esc pri hľadaní v médiách zavrel celý editor, Enter nepotvrdil premenovanie stopy ani názov pri exporte.',
      'Opravené: zmena pohybu alebo veľkosti na duplikáte klipu menila aj originál. Prázdna stopa, ktorú si si pridal, zmizla pri najbližšom mazaní. Okraj klipu sa na strihu nedal chytiť, lebo ho prekrývalo tlačidlo prechodu (je teraz dole).',
      'Rýchly strih: Q odreže začiatok klipu po prehrávaciu hlavu, W koniec od hlavy, a medzera sa hneď zavrie. Šípky hore a dole skáču po strihoch a značkách.',
      'Kopírovať, vystrihnúť a vložiť (Ctrl+C, X, V), aj medzi projektmi. Pravý klik do prázdna na stope: Vložiť sem a Zavrieť medzeru.',
      'Značky z nahrávania (skratka Značka) vidno na klipoch na časovej osi.',
      'Viac textov naraz: „+ Stopa“ → Textová stopa. Texty medzi stopami presunieš ťahaním, text má aj vlastnú farbu.',
      'Farby klipu: jas, kontrast a sýtosť (sekcia Farby). Pribudla aj nepriehľadnosť klipu, napr. pre obraz v obraze.'
    ] },
    { v: '1.0.42', items: [
      'Opravené: pri náročnej hre alebo renderovaní sa so zapnutou stopou Systém sekal zvuk celého PC. Prevod zvuku (vzorkovanie a kanály) robil Windows priamo vo vlákne, ktoré hrá zvuk do reproduktorov, a pri plnom procesore to nestíhal. Teraz LookAtThis berie zvuk zo zariadenia v jeho vlastnom formáte a prevod si robí sám vo svojom procese, takže zvuk PC to nezdržuje. Platí aj pre mikrofón.'
    ] },
    { v: '1.0.41', items: [
      'Graf keyframov ako v After Effects (kláves G alebo ikonka krivky pri sekcii Pohyb): vidíš, ako sa hodnota mení v čase, kosoštvorce ťaháš v čase aj hodnote (so Shiftom len jedným smerom), úchytmi tvaruješ krivku, dvojklik pridá keyframe, ťahaním v prázdnom mieste vyberieš viac naraz. F9 = plynulo, Delete zmaže, Esc zavrie.',
      'Úpravy v náhľade ako v DaVinci: prepínač pod náhľadom (kláves V). Keď je zapnutý, vybraný klip alebo text dostane rámik: ťahaním ho posunieš, rohmi zmeníš veľkosť, guličkou nad ním otočíš (so Shiftom po 15°). Keď je vypnutý, klik do obrazu len vyberie a nič sa omylom nepohne.',
      'Priblíženie náhľadu: Ctrl + koliesko priblíži k miestu kurzora (aj oddiali), koliesko alebo prostredné tlačidlo posúva. Je to len pre teba pri úpravách, do videa sa nezapíše. Klik na percentá vráti celý obraz.',
      'Plynulé spomalenie: pri spomalenom klipe (aj pri rampe) môžeš zapnúť dopočítanie chýbajúcich snímok, takže spomalenie nie je trhané. Prejaví sa vo výslednom videu, export takého klipu trvá dlhšie.',
      'Dĺžka stmievania: pri roztmievaní, stmievaní, zosilnení aj stíšení nastavíš, ako dlho trvá. Klin na klipe na osi ukazuje skutočnú dĺžku.',
      'Médiá sa dajú filtrovať podľa priečinka (ak máš klipy vo viacerých priečinkoch).',
      'Časová os: koliesko posúva hore a dole, s Altom (alebo Shiftom) doľava a doprava.',
      'Prehľad klávesových skratiek: kláves ? alebo tlačidlo ? v lište časovej osi.',
      'Opravené: pri ťahaní klipu jeden z obrysov zaostával.',
      'Opravené: rozdelenie klipu s keyframami pridávalo na začiatok novej časti keyframe navyše. Pohyb teraz po rozdelení pokračuje presne tak, ako bol.',
      'Opravené: text „Klikni na klip, zvuk alebo text…“ v prázdnom inšpektore sa zobrazoval cez stred náhľadu.'
    ] },
    { v: '1.0.40', items: [
      'Simple editor ukladá cez rovnaké okno ako export v advanced editore. Veľkosť (Pôvodná, Discord 20 MB…) vyberáš priamo v ňom a hneď vidíš, aká kvalita pri nej vyjde. Výber veľkosti z hornej lišty zmizol.',
      'Inšpektor v advanced editore je prerobený: prehľadné sekcie Rýchlosť, Obraz, Pohyb a Prechod a stmievanie, ktoré sa plynulo zbaľujú a rozbaľujú (a pamätajú si to). Zbalená sekcia ukáže stručný stav, napríklad „1,5×“ alebo „2 keyframy“.',
      'Keyframy majú vlastný pás s kosoštvorcami a prehrávacou hlavou: klik skočí na keyframe, ťahaním ho posunieš, šípky skáču medzi keyframami. Krivka priebehu sa ukáže pri vybranom keyframe.',
      'Opravené: keď bol rozbalený zvuk a klikol si na klip, keyframe sa pridal na zvukovú stopu namiesto videa.',
      'Záložky inšpektora sa ukazujú podľa výberu: klip = Klip a Zvuk (hlasitosť každej stopy tohto klipu), samotný zvuk = Zvuk, text = Text. Bez výberu ukáže hlasitosť stôp.',
      'Text sa pridáva na jednom mieste: panel Text vľavo (alebo kláves T). Duplicitné tlačidlá zmizli z lišty aj z inšpektora.',
      'In a Out: oba úchyty sú vždy vidno a dajú sa potiahnuť (predtým sa po nastavení len In nedal Out upraviť). Pri zapnutom prichytávaní sa chytia na začiatok a koniec klipov.',
      'Plynulejší editor: rozbalený zvuk sa vyroluje a pri zbalení zaroluje, nové a odstránené stopy sa vysunú a zasunú, klip pridaný z médií preletí na svoje miesto na osi a tlačidlá jemne reagujú na stlačenie. Kosoštvorec „poskočí“ len pri pridaní keyframu, nie pri každej zmene.'
    ] },
    { v: '1.0.39', items: [
      'Advanced editor: klik na klip vyberie video aj jeho zvuk naraz, ako v strihových programoch. S Alt vyberieš len to, na čo klikneš.',
      'Zvukové stopy klipu sú zbalené do jedného riadku „Zvuk“ (všetky stopy klipu v jednom bloku, každá vo svojej farbe). Šípkou ho rozbalíš na Systém, Hru, Discord a Mikrofón. Klipy na vrstve Video 2 majú vlastný riadok „Zvuk 2“, takže pri skladaní viacerých videí na seba nevznikne chaos.',
      'Rýchly náhľad: klik na klip v paneli Médiá ho prehrá v náhľade bez pridania na os. Klávesmi I a O vyberieš len časť, Enter ju pridá na koniec, Esc ťa vráti späť. Dvojklik alebo pretiahnutie pridá klip ako doteraz.',
      'Pridaný klip je na osi hneď s animáciou načítavania, zvuk sa doplní, keď je pripravený (už to nevyzerá, že appka zamrzla). Stopy sa pripravujú rýchlejšie a pri náhľade už vopred.',
      'Export má nový vzhľad v štýle appky: náhľad obrazu, veľkosť ako karty s informáciou, čo pri nej vyjde (rozlíšenie, fps, kvalita), a priebeh aj Hotovo v tom istom okne bez skákania.',
      'Opravené animácie: karty v knižnici už po štarte a pri návrate na Klipy znova neposkakujú, stopy v advanced editore neposkakujú počas načítavania projektu a okno ukladania v simple editore sa pri dokončení neotvára nanovo.'
    ] },
    { v: '1.0.38', items: [
      'Opravené (dôležité): keď sa buffer reštartoval po zaseknutí obrazu (hra zmenila režim obrazovky) alebo po zamknutí PC, všetko pred reštartom sa stratilo. Clip si teraz vezme aj zábery spred zaseknutia a nahrávka pokračuje cez reštart a uloží sa celá (predtým mohla prísť skoro o všetko). Zaseknutie sa zistí rýchlejšie (8 s namiesto 12 s).',
      'Opravené: staré priečinky bufferu po každom zaseknutí ostávali v Tempe až do reštartu appky (stovky MB). Teraz sa mažú priebežne.',
      'Rýchlejšie editory po reštarte PC: náhľadové kópie a zvukové stopy klipov sa pri štarte appky už nemažú (predtým sa po každom štarte kódovali znova). Cache sa stráži veľkosťou.',
      'Opravené: zmazanie klipu, ktorý mal ešte otvorený prehrávač, občas zlyhalo. Teraz to appka skúsi znova.',
      'Drobnosti: náhľad zmazaného klipu už nespôsobí chybu v logu, aktualizácie nepíšu zbytočné varovanie.'
    ] },
    { v: '1.0.37', items: [
      'Opravené: advanced editor nenačítal celý projekt. Projekt si zoznam klipov ukladal len z toho, čo už bolo načítané, takže uloženie počas otvárania niektoré klipy „stratilo“ (ostali na osi bez obrazu a zvuku). Teraz sa nič nestratí a už pokazené projekty sa pri otvorení samé opravia.',
      'Klip, ktorý chýba na disku, sa už z projektu nevymaže. Ostane na osi šrafovaný s nápisom Chýba a export ho vynechá.',
      'Projekt sa ukáže hneď, náhľady a zvuk sa dopĺňajú, ako sa klipy načítavajú (vpravo dole vidno, koľko ešte).',
      'Opravené: výber na časovej osi sa nedal zrušiť. Zruší ho klik do prázdna (aj pod stopami a vedľa náhľadu) alebo Esc. Klik na jeden z viacerých vybraných klipov vyberie len ten.',
      'Klipy na časovej osi majú jasné hranice, aj keď sú vybrané.',
      'Viac stôp: „+ Stopa“ pod hlavičkami pridá video vrstvu (kreslí sa nad hlavným videom, napr. B-roll alebo obraz v obraze cez Pohyb) alebo zvukovú stopu. Klipy a zvuk sa medzi stopami presúvajú ťahaním hore a dole. Pravý klik na hlavičku stopy = premenovať alebo odstrániť.',
      'Simple editor: rovnako ako advanced editor ukazuje, koľko ešte zostáva, ukladanie sa dá zrušiť, dekóduje sa na grafike a uloženie na MB ide jedným prechodom.'
    ] },
    { v: '1.0.36', items: [
      'Advanced editor: viac úsekov naraz. Označ In/Out a stlač P (alebo „+“), úsek sa uloží a značíš ďalší. Úseky sú očíslované navrchu pravítka (klik = upraviť, pravý klik = menu). V exporte vyberieš Úseky a každý sa uloží ako samostatné video.',
      'Úsek medzi In a Out sa dá prehrať dokola: Shift+medzerník alebo tlačidlo v čipe In/Out.',
      'Export ukazuje, koľko ešte zostáva.',
      'Rýchlejší export: videá sa pri renderovaní dekódujú na grafike (ak to nejde, automaticky procesor).',
      'Export na 10/20/50/100 MB s grafickým enkodérom ide jedným prechodom priamo na cieľovú veľkosť, predtým sa kódovalo dvakrát. Keby to vyšlo nad limit, video sa samo dokomprimuje.'
    ] },
    { v: '1.0.35', items: [
      'Advanced editor: In a Out. Klávesou I a O (alebo tlačidlami pod náhľadom) si označíš úsek, na pravítku ho vidíš a vieš ho ťahať za okraje. Pri exporte si vyberieš, či chceš len označený úsek alebo celú časovú os. Shift+I / Shift+O skočí na značku, Alt+X ich zruší.',
      'Export v advanced editore sa dá zrušiť, nedokončený súbor sa zmaže.',
      'Uložené projekty sa otvárajú rýchlejšie: klipy sa načítajú naraz, stopy a náhľady na časovej osi sa pamätajú a projekt sa začne čítať už počas animácie.',
      'Opravené: v exporte advanced editora sa nedalo zmeniť rozlíšenie ani snímky za sekundu (vždy sa použili predvolené).'
    ] },
    { v: '1.0.34', items: [
      'Opravené: OBS sa spúšťalo na pozadí, aj keď nebežala žiadna hra. Okno pred snímaním skrývala aj iná appka (napr. Claude) a LookAtThis ju bral ako hru. OBS teraz štartuje len kvôli hrám a zoznam sa pri štarte sám vyčistí.'
    ] },
    { v: '1.0.33', items: [
      'Pri ukladaní a exporte pribudla možnosť 100 MB (pri Discorde s Nitrom, v oboch editoroch aj v komprimácii).',
      'Sprievodca prvým spustením má nový krok Špeciálne situácie: vysvetlí HDR → SDR a nahrávanie cez OBS pre hry ako Valorant (s kontrolou, či je OBS nainštalované a tlačidlom na stiahnutie).'
    ] },
    { v: '1.0.32', items: [
      'HDR videá (napr. z OBS alebo z telefónu) sa v simple editore označia tlačidlom HDR → SDR. Jedným klikom sa vytvorí SDR kópia s normálnymi farbami (originál ostane) a hneď sa otvorí.',
      'Opravené: ovládanie hlasitosti v simple editore sa prekrývalo s tlačidlami.'
    ] },
    { v: '1.0.31', items: [
      'HDR → SDR: keď máš vo Windowse zapnuté HDR, nahrávanie sa automaticky prevedie na normálne farby (už nie je prepálené). Nájdeš v Nastavenia → Video; ak sa ti obraz zdá tmavý alebo svetlý, uprav Jas pri HDR. Prevod beží na procesore, preto max. 1080p a 30 fps.',
      'Kvalita Vlastná: v Nastavenia → Video vyberieš presný dátový tok v Mbps.',
      'Hlasitosť náhľadu v oboch editoroch (aj vo fullscreene). Advanced editor má teraz aj celú obrazovku (F). Nové klávesy: M stlmiť, Z celá časová os, J/K/L, Ctrl+A.',
      'Opravené: po dorenderovaní v advanced editore ostala len rozmazaná obrazovka, kým si nekliol. Okno teraz po exporte zabliká na lište.',
      'Opravené: Nastavenia poskočili pri každom kliknutí.',
      'Advanced editor sa otvára plynulejšie (zdroje sa načítajú až po animácii).'
    ] },
    { v: '1.0.30', items: [
      'Nastavenia sú rozdelené do kategórií (Clipy, Skratky, Video, Výkon, OBS, Hry, Overlay a zvuk, Vzhľad, Systém, O appke) s hľadaním vľavo.',
      'Pri uložení clipu sa hneď ukáže animovaný overlay „Ukladám clip“ a tlačidlo v okne sa zmení na „Ukladám…“. Pri zastavení nahrávania je to tak isto. Druhé stlačenie skratky počas ukladania sa ignoruje.',
      'Opravené: clip mohol vyjsť oveľa dlhší, než je nastavené (aj desiatky minút). Appka teraz pred skladaním skontroluje časy segmentov, preskočí poškodené, a ak je výsledok aj tak dlhší, orezá ho na nastavenú dĺžku. Po spánku alebo zamknutí PC sa buffer čisto reštartuje. Do logu pribudol riadok o každom uloženom clipe.',
      'Opravené: zvuk z videa sa už nemôže prehrávať na pozadí po zavretí simple ani advanced editora, ani keď rýchlo klikáš alebo editor zatváraš počas načítavania.',
      'Výkon: v Nastaveniach → Výkon vidíš naživo, koľko procesora, grafiky (aj video enkodéra), pamäte a disku LookAtThis berie. Meria sa len kým je tá karta otvorená.',
      'Nahrávanie cez OBS ukáže, či je OBS nainštalované. Ak nie, tlačidlo ťa pošle na oficiálnu stránku obsproject.com.',
      'Pri logu pribudlo tlačidlo Otvoriť priečinok.'
    ] },
    { v: '1.0.29', items: [
      'Prechody medzi klipmi: prelínanie, cez čiernu, záblesk, posun doľava/doprava/hore a priblíženie. Klikni na kruh na strihu medzi dvoma klipmi (alebo Efekty → Prechody), dĺžku nastavíš posuvníkom.',
      'Speed ramp: plynulá zmena rýchlosti v klipe. Predvoľby Spomalenie na hlave, Hrdina, Montáž, Zrýchlenie, Spomalenie, a krivku doladíš ako keyframy (riadok Rýchlosť v sekcii Pohyb). Zvuk sa spomalí s obrazom.',
      'Náhľad aj export počítajú prechody a ramp rovnako, takže to, čo vidíš, je to, čo dostaneš.'
    ] },
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
