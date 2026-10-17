/* Čo je nové: krátko a ľudsky, najnovšie hore. Pri novom vydaní pridaj záznam navrch. */
(function (root) {
  const LOG = [
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
