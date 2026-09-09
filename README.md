# 🦊 Hanka The Fox Hunter

Multiplayerová webová skákačka. Hráči běhají po nočním lese, ze stran se na ně
sápou lišky a jediná obrana je puška. Server drží celý herní stav (fyziku,
AI lišek, střely) a klientům posílá snapshoty přes WebSockety.

## Spuštění

```bash
npm install
npm start          # http://localhost:3000
PORT=8080 npm start
```

Otevři adresu ve více oknech/prohlížečích (nebo na více počítačích v síti)
a hrajete spolu.

## Ovládání

| Akce    | Klávesy                                  |
| ------- | ---------------------------------------- |
| Pohyb   | `A`/`D` nebo `←`/`→`                     |
| Skok    | `W`, `↑` nebo `Space`                    |
| Střelba | `Ctrl`, `F` nebo `X`                     |
| Oživení | drž `E` vedle ducha (3 s, nehýbat se, nestřílet) |
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
- Les (plošiny, stromy, dekorace) se generuje znovu každé kolo.
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

- `server.js` – HTTP server pro statické soubory + WebSocket herní server
  (60 Hz simulace, 20 Hz snapshoty).
- `public/index.html` – úvodní obrazovka a dotykové ovládání.
- `public/game.js` – vykreslování na Canvas, interpolace snapshotů, částice, zvuky.

## Protokol

Klient → server: `{t:'join', name, outfit?}`, `{t:'input', left, right, jump, down, shoot, revive}`, `{t:'emote', n}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, world, platforms, seed}`, `{t:'state', players, foxes, bullets, pickups, fires, events, wave, kills, maxFoxes, round}`, `{t:'pong', ts}`

Události ve `state.events`: `shoot`, `hit`, `kill` (s `foxKind`, `mega`, `score`), `hurt`, `bite`, `death` (s `by` při friendly fire, `fire` při uhoření), `respawn`, `revived`, `ff`, `clash`, `pickup`, `emote`, `dig`, `emerge`, `jump`, `foxjump`, `wave`, `mega`, `gameover`, `newround` (s novými `platforms` a `seed`), `join`, `leave`.

## Vykreslování

Klient kreslí v logickém rozlišení 960×540, ale backing store canvasu se
přizpůsobuje skutečné velikosti na obrazovce krát `devicePixelRatio`, takže
je obraz ostrý i na velkém nebo HiDPI monitoru.
