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

Na dotykových zařízeních se zobrazí tlačítka na obrazovce.

## Pravidla

- Liška ubere kousnutím 12 HP, hráč má 100 HP.
- Liška má 30 HP, střela ubírá 10 → tři zásahy. Zabití = **+10 bodů**.
- Každých 12 ulovených lišek roste vlna: lišek je víc, jsou rychlejší a odolnější.
- Po smrti se hráč za 3 s znovu objeví uprostřed lesa s krátkou nesmrtelností.
- Dřevěné plošiny jsou průchozí zespodu (jde na ně vyskočit).

## Struktura

- `server.js` – HTTP server pro statické soubory + WebSocket herní server
  (60 Hz simulace, 20 Hz snapshoty).
- `public/index.html` – úvodní obrazovka a dotykové ovládání.
- `public/game.js` – vykreslování na Canvas, interpolace snapshotů, částice, zvuky.

## Protokol

Klient → server: `{t:'join', name}`, `{t:'input', left, right, jump, shoot}`, `{t:'ping', ts}`

Server → klient: `{t:'welcome', id, world, platforms}`, `{t:'state', players, foxes, bullets, events, wave, kills}`, `{t:'pong', ts}`
