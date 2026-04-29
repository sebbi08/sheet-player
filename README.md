# Sheet Player

A browser-based MusicXML player built with React, Node.js, and [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/).

## Features

- **Score browser** – lists all MusicXML files in `server/music/` with title, composer and part count parsed from the XML on the server.
- **Sheet display** – renders the score as SVG using OSMD, one page at a time; pages switch automatically with playback.
- **Bar highlight** – a yellow overlay tracks the current measure in real time.
- **Click-to-jump** – click any measure to seek playback to that bar.
- **Piano playback** – all parts are played as Acoustic Grand Piano via [osmd-audio-player](https://github.com/opensheetmusicdisplay/osmd-audio-player) and the FluidR3_GM soundfont, regardless of the original instrument definitions in the file.
- **Part selector** – mute / unmute individual parts while playing.
- **Tempo control** – slider from 25 % to 200 % of the written tempo.

## Requirements

- Node.js 18+

## Quick start (development)

```bash
npm install --legacy-peer-deps
npm run dev        # Express on :3001  +  Vite dev-server on :5173
```

Open **http://localhost:5173** in your browser.

## Adding scores

Drop `.xml` or `.musicxml` MusicXML files into `server/music/`.  
Three sample public-domain scores are included.

## Admin interface (password protected)

The sidebar includes an **Admin** section where you can upload new MusicXML files and remove existing ones.

1. Set an admin password before starting the server:

```bash
export ADMIN_PASSWORD="your-strong-password"
```

2. Start the app (`npm run dev` or `npm start`).
3. Open the **Admin** section in the sidebar, enter the password, and upload or remove `.xml`, `.musicxml`, or `.mxl` files.

If `ADMIN_PASSWORD` is not set, admin endpoints are disabled.

## Production build

```bash
npm run build      # builds React client → client/dist
npm start          # Express serves the app on :3001
```

Open **http://localhost:3001**.

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