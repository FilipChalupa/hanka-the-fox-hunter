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
| Duch    | `W`/`↑` nahoru, `S`/`↓` dolů             |

Na dotykových zařízeních se zobrazí tlačítka na obrazovce. Duchové létají
pomocí `W`/`S` (nahoru/dolů) a `A`/`D`.

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

Klient → server: `{t:'join', name, outfit?}`, `{t:'input', left, right, jump, down, shoot}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, world, platforms}`, `{t:'state', players, foxes, bullets, events, wave, kills, maxFoxes, round}`, `{t:'pong', ts}`

Události ve `state.events`: `shoot`, `hit`, `kill` (s `mega`, `score`), `hurt`, `bite`, `death`, `respawn`, `jump`, `foxjump`, `wave`, `mega`, `gameover`, `newround`, `join`, `leave`.

## Vykreslování

Klient kreslí v logickém rozlišení 960×540, ale backing store canvasu se
přizpůsobuje skutečné velikosti na obrazovce krát `devicePixelRatio`, takže
je obraz ostrý i na velkém nebo HiDPI monitoru.
