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
| Střelba | `Ctrl`, `F` nebo `X`                     |
| Oživení | drž `E` vedle ducha (3 s, nehýbat se, nestřílet) |
| Úhyb    | dvojité `A`/`D` (krátký sprint s nezranitelností, cooldown 1 s) |
| Lezení  | drž `W` ve výskoku u světlého kmene, `S` u paty kmene; `W`/`S` leze, skok do strany seskočí |
| Emoty   | `1` 👍, `2` 🆘, `3` 😂, `4` ❤️            |
| Duch    | `W`/`↑` nahoru, `S`/`↓` dolů             |

Na dotykových zařízeních je vlevo virtuální joystick (pohyb, skok tahem
nahoru, duch létá všemi směry), vpravo tlačítka skok, střelba a oživení,
nahoře řada emotů.

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
  plošinách: lékárnička (+40 HP), brokovnice (3 broky, 12 s), rychlopalba
  (10 s), rychlé nohy (12 s).
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
- `test/sim.test.js` – scénářové testy (oživení, střet střel, nora, úhyb,
  lezení, houby a listí, pařez, konec kola, rekonexe, delta snapshoty, blesky).

## Protokol

Klient → server: `{t:'join', name, outfit?, token?}`, `{t:'input', left, right, jump, down, shoot, revive, dash, seq}`, `{t:'emote', n}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, token, world, rejoined}`, `{t:'state', …}` (plný snapshot), `{t:'delta', …}` (jen změněné entity a pole; klient je skládá přes `Shared.applyDelta`), `{t:'pong', ts}`

Události ve `state.events`: `shoot`, `hit`, `kill`, `hurt`, `bite`, `death`, `respawn`, `revived`, `ff`, `clash`, `pickup`, `emote`, `dig`, `emerge` (s `blocked` u pařezu), `jump`, `dash`, `grab`, `foxjump`, `foxspawn`, `denhit`, `dencollapse`, `denopen`, `leaves`, `mushroom`, `weather`, `lightning`, `wave`, `mega`, `gameover` (s `ranking` včetně `badges` a statistik), `newround` (s novým `world`), `join`, `leave`, `away`, `back`.

## Vykreslování

Klient kreslí v logickém rozlišení 960×540, ale backing store canvasu se
přizpůsobuje skutečné velikosti na obrazovce krát `devicePixelRatio`, takže
je obraz ostrý i na velkém nebo HiDPI monitoru.
