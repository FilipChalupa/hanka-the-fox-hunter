# 🦊 Hanka The Fox Hunter

Multiplayerová webová skákačka. Hráči běhají po nočním lese, ze stran se na ně
sápou lišky a jediná obrana je puška. Server drží celý herní stav (fyziku,
AI lišek, střely) a klientům posílá snapshoty přes WebSockety.

## Spuštění

```bash
npm install
npm start          # http://localhost:3000
PORT=8080 npm start
npm test           # testy herní logiky (node:test)
```

Žebříček se ukládá do `data/leaderboard.json` (adresář jde změnit přes `DATA_DIR`).

### Nasazení s HTTPS (Docker + Caddy)

```bash
DOMAIN=lisky.example.com docker compose up -d --build
```

Caddy si sám obstará certifikát od Let's Encrypt a přeposílá WebSockety na
herní server. DNS záznam domény musí mířit na stroj, porty 80 a 443 musí být
otevřené. Bez `DOMAIN` běží stack na `localhost` s vlastním certifikátem.
Samotný server jde spustit i bez proxy: `docker build -t fox-hunter . && docker run -p 3000:3000 -v fox-data:/app/data fox-hunter`.

Otevři adresu ve více oknech/prohlížečích (nebo na více počítačích v síti)
a hrajete spolu.

## Ovládání

| Akce    | Klávesy                                  |
| ------- | ---------------------------------------- |
| Pohyb   | `A`/`D` nebo `←`/`→`                     |
| Skok    | `W`, `↑` nebo `Space`                    |
| Střelba | `Shift`, `F`, `X`, `J` nebo `K` (Ctrl záměrně ne, Ctrl+W by zavřelo kartu) |
| Celá obrazovka | `F11` nebo tlačítko vpravo dole; v celé obrazovce Chrome díky Keyboard Lock nezavře kartu ani na Ctrl+W |
| Oživení | drž `E` vedle ducha (3 s, nehýbat se, nestřílet) |
| Úhyb    | dvojité `A`/`D` (krátký sprint s nezranitelností, cooldown 1 s) |
| Lezení  | drž `W` ve výskoku u světlého kmene, `S` u paty kmene; `W`/`S` leze, skok do strany seskočí |
| Propad  | `S`/`↓` na plošině propadne skrz ni dolů |
| Použít  | `Q` (past, roh, semínko, světluška, vnadidlo); podržet `Q` = hodit předmět kamarádovi |
| Menu    | `Esc`: hlasitost efektů a hudby, otřesy, blesky, titulky zvuků, velikost HUD, kvalita grafiky, klávesy |
| Přehled | drž `Tab` (na mobilu tlačítko ❔): všechny bedýnky s popisem a vlnou odemčení, tabulka hráčů s HP, body, oživeními, zbraní a předměty |
| Připraven | `Enter` nebo klepnutí ve výsledcích; když jsou připraveni všichni, nové kolo začne za sekundu |
| Emoty   | `1` 👍, `2` 🆘, `3` 😂, `4` ❤️            |
| Zvuk    | `M` vypne/zapne všechny zvuky včetně hudby (pamatuje se) |
| Duch    | `W`/`↑` nahoru, `S`/`↓` dolů             |

Na dotykových zařízeních je vlevo virtuální joystick (doleva, doprava a dolů;
skok a lezení nahoru má vlastní tlačítko, duch létá joystickem a tlačítkem
skoku), vpravo tlačítka skok, střelba, oživení, úhyb a použít, na levém
okraji sloupec emotů. Na výšku v prohlížeči je les u horního okraje a
ovládání pod ním; nainstalovaná aplikace se otevře na šířku.

## Pravidla

- Liška ubere kousnutím 12 HP, hráč má 100 HP.
- Liška má 30 HP, střela ubírá 10 → tři zásahy. Zabití = **+10 bodů**.
- Každých 12 ulovených lišek roste vlna: lišek je víc, jsou rychlejší a odolnější.
- Kdo umře, zůstane mrtvý až do konce kola. Poletuje jako duch, vidí hru a
  může fandit, ale nestřílí a lišky si ho nevšímají.
- Když padnou všichni, kolo končí: zobrazí se pořadí a za 12 s začne nové kolo
  od vlny 1. Kdo se připojí během přestávky, čeká jako duch.
- Každou třetí vlnu přijde **mega liška** (dvojnásobná, 150+ HP, kousne za 30,
  za 50 bodů). Od vlny 9 přicházejí dvě, od vlny 15 tři.
- Druhy lišek: **rychlá** (od vlny 2, malá, 12 HP, +15), **skákavá** (od vlny 3,
  vyskočí na každou plošinu, +15), **hrabavá** (od vlny 4, cestuje pod zemí jako
  krtina, nejde zasáhnout, vyskočí pod obětí, kouše za 18, +20).
- **Friendly fire**: kulka zraní i kamaráda za 10 HP. Zastřelit spoluhráče
  stojí 20 bodů.
- **Oživení**: duch přiletí k živému lovci, ten se postaví, drží `E` a 3 s se
  nehýbe ani nestřílí. Duch se vrátí s 10 HP, oživující dostane 15 bodů.
- **Vylepšení** padají z lišek (8 %, z mega lišky 60 %) a občas se objeví na
  plošinách: lékárnička (+40 HP), brokovnice (12 ran po 3 brocích za 9),
  rychlopalba (40 ran), zápalné náboje (10 nábojů, které padají k zemi a kde
  dopadnou nebo koho trefí, tam vzplane oheň, pálí i kamarády), smrad (10 s:
  lišky do 190 px se otočí a utíkají pryč, hrabavé se odplazí, mega liška si
  ho nevšímá), dvojité body (15 s), liščí převlek (8 s: lišky tě ignorují, ale
  nemůžeš střílet), rychlé nohy (12 s). Zbraně jsou omezené počtem ran, ne
  časem; když dojdou, vrátí se puška. Stejná zbraň znovu náboje doplní.
- **Držené předměty** se sbírají do ruky a používají klávesou `Q` (na mobilu
  tlačítko „použít“): past (položí se na zem, první liška se chytí na 3 s a
  nemůže kousat, musíš ji dojít dorazit), lovecký roh (všechny lišky na mapě
  na 4 s zamíří k tobě), semínko (za 5 s vyroste nový lezecký kmen, ne blíž
  než 160 px od jiného kmene nebo nory), světluška v lahvi (20 s láká lišky
  k sobě a v mlze osvítí dvojnásobný kruh), vnadidlo (8 s: lišky se seběhnou
  a perou se u masa). Nový držený předmět nahradí starý.
- **Prokletí**: některá bedýnka vypadá jako obyčejná, ale po sebrání vyskočí
  zpod hráče hrabavá liška.
- **Hořící stromy**: oheň u paty lezeckého kmene ho zapálí. Kdo na něm leze
  nebo stojí v koruně, hoří; po 6 s strom shoří i s plošinami. Déšť hoření
  zpomalí na polovinu.
- **Střet střel**: když se kulky dvou lovců potkají, zruší se, zableskne a na
  zemi vzplane oheň na 6 s. Pálí lovce i lišky; lišky se mu vyhýbají.
- Les (plošiny, stromy, dekorace) se generuje znovu každé kolo. Světlé kmeny
  s vruby jde lézt až do koruny, kam lišky nedosáhnou; v půlce kmene je větev.
- **Liščí nory** na obou krajích mapy. Lišky vylézají jen z nich; když do nory
  nastřílíš 80 poškození, zavalí se na 12 s a z ní nic nevyleze. Poškození se
  bez střelby pomalu hojí.
- **Noční události** (od 25. sekundy kola, každých 35–60 s na 20 s): mlha
  (vidíš jen kolem sebe), déšť (ohně hasnou 3× rychleji), bouřka (déšť +
  blesky, které osvítí les a občas trefí lišku za 25).
- **Interaktivní prostředí**: střela přes kmen setřese listí, střela do houby ji
  roztrhá, hráč stojící u pařezu je krytý před hrabavou liškou (ta vyleze vedle
  a je 1,6 s omráčená).
- **Odznaky za kolo**: Nejlepší střelec, Zachránce, Přežil nejdéle. Vedle pořadí
  se ukazují i statistiky napříč koly (lišky / oživení / teamkilly).
- **Rekonexe**: server drží tělo hráče 60 s po výpadku, klient se s tokenem
  z localStorage připojí zpět ke stejnému hráči i skóre.
- **Liščí matka**: ve vlně 10 vyleze z nory boss. V první fázi bojuje sama a
  jiné lišky nepřicházejí; pod polovinou HP zavyje a každých 6 s přivolá tři
  lišky z nor. Dopad po skoku omráčí lovce na zemi do 170 px za 15. Nevšímá si
  smradu, návnad ani pastí. Její porážka kolo nekončí: tým dostane odznak,
  8 s klidu a les jede dál.
- **Matka s mláďaty**: ve vlně 20 se vrátí s 900+ HP a čtyřmi mláďaty, která
  se jí drží u boku. Dokud je některé do 150 px, nic jí neublíží. Mláďata
  slyší vnadidlo a světlušku ze 700 px a rozběhnou se k nim; ztracená mláďata
  dorůstají každých 10 s. Její smrt kolo vyhraje.
- **Replay**: po smrti klávesa R (na mobilu klepnutí do hry) přehraje
  posledních 10 s z bufferu snapshotů, s kamerou na tobě.
- **Hod a chycení**: házející lovec se napřáhne, chytající natáhne ruku;
  chycení bedýnky ve vzduchu ohlásí feed.
- **Odemykání bedýnek**: druhy vylepšení přibývají s vlnou (1: lékárnička,
  brokovnice; 2: rychlopalba, rychlé nohy; 3: smrad, past, vnadidlo; 4: zápalné
  náboje, roh, prokletí; 5: dvojité body, světluška; 6: převlek, semínko).
  Oznámení vlny vypíše, co je nově k mání.
- **Týmové odznaky** na konci kola: Liščí matka poražena, Nikdo neumřel do
  vlny 5, Zavaleny obě nory najednou, Tři oživení v jednom kole.
- **Oživený** má 3 s nesmrtelnosti a blikající rámeček HP, dokud se neuzdraví
  na 40 HP nebo nesebere lékárničku.
- **Tutoriál**: nováček vidí v prvním kole checklist (pohyb, skok, zastřelit
  lišku, sebrat bedýnku, vylézt na strom, volitelně oživit), položky se
  odškrtávají samy a po splnění se panel už nevrací (pamatuje prohlížeč).
- **Tipy** se střídají v přestávce mezi vlnami a ve výsledcích kola.
- **Profil**: úvodní obrazovka ukazuje statistiky z tohoto prohlížeče (kola,
  výhry, lišky, oživení, nejvyšší vlna, nejvíc bodů).
- **Titulky zvuků**: vytí, hrabání pod zemí, roh, hrom, dupnutí a další se
  vypisují dole uprostřed, hodí se při hraní bez zvuku.
- Dřevěné plošiny jsou průchozí zespodu (jde na ně vyskočit).
- Každý hráč má jiný outfit: první v lese dostane mysliveckou zelenou, další
  nejnižší volnou paletu z osmi. Outfit jde vybrat i ručně na úvodní obrazovce.
- Odkaz `/?name=Jméno` přeskočí úvodní obrazovku a rovnou vstoupí do hry.

## Grafika a UI

- Kamera s přiblížením a předvídáním směru, minimapa s hráči a liškami.
- Animace: dřep při dopadu, záklon ve skoku, zpětný ráz a záblesk pušky,
  protažení lišky ve výskoku, cvakání čelistí, převrácení a rozplynutí po zásahu.
- Živý les: kývající se stromy, padající listí, přízemní mlha, světlušky,
  sova nad korunami, pařezy, kameny, houby a kapradí. Obloha s každou vlnou tmavne.
- Osvětlení: halo kolem lovců, záblesky výstřelů, vinětace, červené bliknutí
  při zranění, hit-stop a otřes kamery při zabití.
- HUD z dřevěných cedulí (fonty Cinzel a Nunito), srdíčka místo HP pruhu,
  „+10“ letící do žebříčku, oznámení nové vlny, obrazovka smrti se statistikami.
- Ambientní zvuk: vítr, cvrčci a houkání sovy generované přes WebAudio.
- Podkresová hudba generovaná za běhu (A moll, pad + basa + pentatonická
  melodie s echem). Tempo, jas a hustota melodie rostou s vlnou a s počtem
  lišek poblíž, v klidu mezi vlnami a po smrti hudba zjemní.

## Struktura

- `game/sim.js` – herní simulace (třída `Game`), bez sítě; 60 Hz tick.
- `game/leaderboard.js` – persistentní žebříček v JSON.
- `public/shared.js` – kód sdílený serverem i klientem: generování světa,
  pohyb hráče (predikce na klientu), delta kódování snapshotů.
- `server.js` – HTTP (statika, `/api/leaderboard`, `/api/status`, `/healthz`),
  WebSockety, rekonexe tokenem, keyframe každých 5 s + delta snapshoty 20 Hz,
  permessage-deflate.
- `public/index.html` – úvodní obrazovka se žebříčkem a dotykové ovládání.
- `public/game.js` – vykreslování na Canvas, predikce vlastního pohybu s
  replayem vstupů, interpolace ostatních, částice, počasí, zvuky.
- `test/sim.test.js` – scénářové testy simulace (`npm test`, přes 35 scénářů).
- `test/e2e.test.js` – Playwright: skutečný server a dva prohlížeče, ověří
  načtení, protokol, predikci, vzájemnou viditelnost, střelbu, menu a reload
  při změně verze protokolu (`npm run test:e2e`, jednou předtím
  `npx playwright install chromium`).

## Protokol

Klient → server: `{t:'join', name, outfit?, token?}`, `{t:'input', left, right, jump, down, shoot, revive, dash, seq}`, `{t:'emote', n}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, token, world, rejoined}`, `{t:'state', …}` (plný snapshot), `{t:'delta', …}` (jen změněné entity a pole; klient je skládá přes `Shared.applyDelta`), `{t:'pong', ts}`

Události ve `state.events`: `shoot`, `hit`, `kill`, `hurt`, `bite`, `death`, `respawn`, `revived`, `ff`, `clash`, `pickup`, `emote`, `dig`, `emerge` (s `blocked` u pařezu), `jump`, `dash`, `grab`, `foxjump`, `foxspawn`, `denhit`, `dencollapse`, `denopen`, `leaves`, `mushroom`, `weather`, `lightning`, `wave`, `mega`, `gameover` (s `ranking` včetně `badges` a statistik), `newround` (s novým `world`), `join`, `leave`, `away`, `back`.

## Provoz

- `/metrics` vrací metriky ve formátu Prometheus: hráči online, lišky, vlna,
  kolo, doba ticku (průměr a maximum), velikost plných a delta snapshotů,
  počet snapshotů, dokončená a vyhraná kola, uptime, verze protokolu, a
  histogramy dosažené vlny za kolo a počtu hráčů v kole (ukládají se do
  `data/telemetry.json`, takže přežijí restart).
- `/api/status` totéž zkráceně v JSON, `/healthz` pro health check.
- `welcome` nese verzi protokolu (`Shared.PROTOCOL`). Klient se starým skriptem
  se jednou sám znovu načte s parametrem `v`. Skripty a HTML se servírují
  s `no-cache`, ikony a obrázky s dlouhou platností.
- Klient interpoluje ostatní entity podle času serveru se zpožděním, které se
  přizpůsobuje jitteru (60–260 ms), takže při horší lince nedochází k trhání.
  Vlastní lovec se předvídá lokálně.
- Service worker (`public/sw.js`) drží úvodní obrazovku a skripty v cache:
  offline se stránka otevře, nainstalovaná aplikace startuje hned. Skripty se
  načítají nejdřív ze sítě, takže nová verze vždy vyhraje.
- Predikce při ztrátě paketů: bez snapshotu déle než 0,8 s se vlastní lovec
  lokálně zastaví, historie vstupů drží 15 s a větší oprava se plynule
  dojede místo skoku.
- Nastavení „Grafika: automaticky“ přepne na jednodušší vykreslování (méně
  částic, bez osvětlení a mlhy), když FPS spadne pod 40 na 4 s.

## Vykreslování

Klient kreslí v logickém rozlišení 960×540, ale backing store canvasu se
přizpůsobuje skutečné velikosti na obrazovce krát `devicePixelRatio`, takže
je obraz ostrý i na velkém nebo HiDPI monitoru.
