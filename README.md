# Sheet Player

A browser-based MusicXML player built with React, Node.js, and [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/).

## Features

- **Score browser** – lists all MusicXML files in `server/music/` with title, composer and part count parsed from the XML on the server.
- **Sheet display** – renders the score as SVG using OSMD, one page at a time; pages switch automatically with playback.
- **Bar highlight** – a yellow overlay tracks the current measure in real time.
- **Click-to-jump** – click any measure to seek playback to that bar.
- **Piano playback** – all parts are played as Acoustic Grand Piano via [osmd-audio-player](https://github.com/opensheetmusicdisplay/osmd-audio-player) and the FluidR3_GM soundfont, regardless of the original instrument definitions in the file.
- **Part selector** – mute / unmute individual parts while playing.
- **Shared grouped parts** – admin can combine multiple sheet parts into one playback toggle (for example, multiple piano staves as one "Piano" control).
- **Tempo control** – slider from 25 % to 200 % of the written tempo.
- **Admin dashboard** – upload new sheets, explicitly replace existing files, delete sheets, and manage grouped-part definitions.
- **Admin auth** – shared admin password with session cookie login and optional "remember me" (7 days).

## Requirements

- Node.js 18+

## Quick start (development)

```bash
npm install --legacy-peer-deps
export ADMIN_PASSWORD='choose-a-strong-password'
npm run dev        # Express on :3001  +  Vite dev-server on :5173
```

Open **http://localhost:5173** in your browser.

## Adding scores

Drop `.xml` or `.musicxml` MusicXML files into `server/music/`.  
Three sample public-domain scores are included.

You can also manage files in the UI via the **Admin** button in the header:

- Upload: rejects duplicates unless you use explicit replace.
- Replace: replaces by filename only.
- Delete: removes the sheet and its saved group config.

## Production build

```bash
npm run build      # builds React client → client/dist
npm start          # Express serves the app on :3001
```

Open **http://localhost:3001**.

## Admin configuration

Set this environment variable before starting the server:

- `ADMIN_PASSWORD` (required for admin login)

Session behavior:

- Session cookie is `HttpOnly` and `SameSite=Lax`.
- Non-remembered login lasts 8 hours.
- "Remember me" login lasts 7 days and is persisted on disk.

Server-side admin data files:

- `server/music/groups.json` for grouped part definitions keyed by score filename.
- `server/data/admin-sessions.json` for persisted admin sessions.
- `server/data/admin-actions.log.jsonl` for append-only admin action logs.

## Docker

```bash
docker build -t sheet-player .
docker run -p 3001:3001 -v ./server/music:/app/server/music sheet-player
```

## Project layout

```
.
├── server/
│   ├── index.js          Express API + static file serving
│   └── music/            MusicXML files go here
└── client/
    ├── vite.config.js
    └── src/
        ├── audioPlayer.js         CustomPianoPlayer (forces piano for all parts)
        ├── App.jsx / App.css
        └── components/
            ├── FileList.jsx        Score list sidebar
            ├── SheetPlayer.jsx     OSMD renderer + playback logic
            ├── PartSelector.jsx    Per-part mute toggles
            └── PlayerControls.jsx  Play/Pause/Stop + tempo slider
```