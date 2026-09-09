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
| Střelba | `Ctrl`, `F`, `X` nebo levé tlačítko myši |

Na dotykových zařízeních se zobrazí tlačítka na obrazovce. Po smrti stačí
`Space`, `Enter` nebo klik pro rychlý návrat (po první sekundě).

## Pravidla

- Liška ubere kousnutím 12 HP, hráč má 100 HP.
- Liška má 30 HP, střela ubírá 10 → tři zásahy. Zabití = **+10 bodů**.
- Každých 12 ulovených lišek roste vlna: lišek je víc, jsou rychlejší a odolnější.
- Po smrti se hráč za 3 s znovu objeví uprostřed lesa s krátkou nesmrtelností.
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

Klient → server: `{t:'join', name, outfit?}`, `{t:'input', left, right, jump, shoot}`, `{t:'respawn'}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, world, platforms}`, `{t:'state', players, foxes, bullets, events, wave, kills, maxFoxes}`, `{t:'pong', ts}`

Události ve `state.events`: `shoot`, `hit`, `kill`, `hurt`, `bite`, `death`, `respawn`, `jump`, `foxjump`, `wave`, `join`, `leave`.
