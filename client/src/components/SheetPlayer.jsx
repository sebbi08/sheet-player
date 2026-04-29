import { useEffect, useRef, useState, useCallback } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import PlaybackEngine from 'osmd-audio-player';
import { PlaybackEvent } from 'osmd-audio-player/dist/PlaybackEngine';
import { CustomPianoPlayer } from '../audioPlayer.js';
import PartSelector from './PartSelector.jsx';
import PlayerControls from './PlayerControls.jsx';

// ─── geometry helpers ─────────────────────────────────────────────────────────

/**
 * Return pixel bounds of measure `measureIndex` (first staff row) relative
 * to `wrapperEl`, plus the page index it lives on.
 * Returns null when the measure cannot be found.
 */
function getMeasureBounds(osmd, wrapperEl, measureIndex) {
  try {
    const ml = osmd.GraphicSheet?.MeasureList;
    if (!ml?.[0]?.[measureIndex]) return null;
    const targetMeasure = ml[0][measureIndex];

    // Find the page this measure lives on
    const pages = osmd.GraphicSheet.MusicPages;
    let pageIndex = 0;
    outer: for (let p = 0; p < pages.length; p++) {
      for (const sl of pages[p].StaffLines) {
        for (const gm of sl.Measures) {
          if (gm === targetMeasure) { pageIndex = p; break outer; }
        }
      }
    }

    // SVGs: one per page, rendered as children of the OSMD container
    const svgs = wrapperEl.querySelectorAll('svg');
    const svgEl = svgs[pageIndex];
    if (!svgEl) return null;

    const vb = svgEl.viewBox.baseVal;
    if (!vb || vb.width === 0) return null;

    const svgRect = svgEl.getBoundingClientRect();
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const sx = svgRect.width / vb.width;
    const sy = svgRect.height / vb.height;

    const pos = targetMeasure.PositionAndShape.AbsolutePosition;
    const size = targetMeasure.PositionAndShape.Size;

    return {
      x: svgRect.left - wrapperRect.left + pos.x * sx,
      y: svgRect.top  - wrapperRect.top  + pos.y * sy,
      w: size.width  * sx,
      h: size.height * sy,
      pageIndex,
    };
  } catch (err) {
    console.warn('getMeasureBounds: could not compute bounds for measure', measureIndex, err);
    return null;
  }
}

/**
 * Given a mouse click on wrapperEl, return which measure was clicked or -1.
 */
function measureAtClick(osmd, wrapperEl, event) {
  try {
    const pages = osmd.GraphicSheet?.MusicPages;
    const ml = osmd.GraphicSheet?.MeasureList;
    if (!pages || !ml?.[0]) return -1;

    const svgs = wrapperEl.querySelectorAll('svg');
    for (let p = 0; p < svgs.length; p++) {
      const svgRect = svgs[p].getBoundingClientRect();
      if (
        event.clientX < svgRect.left || event.clientX > svgRect.right ||
        event.clientY < svgRect.top  || event.clientY > svgRect.bottom
      ) continue;

      const vb = svgs[p].viewBox.baseVal;
      if (!vb || vb.width === 0) continue;
      const unitX = (event.clientX - svgRect.left) / (svgRect.width  / vb.width);
      const unitY = (event.clientY - svgRect.top)  / (svgRect.height / vb.height);

      for (const sl of (pages[p]?.StaffLines ?? [])) {
        for (const gm of sl.Measures) {
          const pos  = gm.PositionAndShape.AbsolutePosition;
          const size = gm.PositionAndShape.Size;
          if (
            unitX >= pos.x && unitX <= pos.x + size.width &&
            unitY >= pos.y - 4 && unitY <= pos.y + size.height + 4
          ) {
            const idx = ml[0].indexOf(gm);
            if (idx >= 0) return idx;
          }
        }
      }
      break; // clicked this page but no measure hit
    }
  } catch (err) { console.warn('measureAtClick: error detecting measure', err); }
  return -1;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function SheetPlayer({ fileInfo }) {
  const wrapperRef      = useRef(null);  // position:relative outer div
  const osmdContainerRef = useRef(null); // OSMD renders SVGs here
  const osmdRef         = useRef(null);
  const engineRef       = useRef(null);
  const customPlayerRef = useRef(null);
  const playingRef      = useRef(false);
  const baseBpmRef      = useRef(100);
  const measureStepsRef = useRef([]);    // measureIndex → engine step

  const [loading,  setLoading]  = useState(false);
  const [ready,    setReady]    = useState(false);
  const [playing,  setPlaying]  = useState(false);
  const [tempo,    setTempo]    = useState(1.0);
  const [instruments, setInstruments] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  const [highlight,   setHighlight]   = useState(null); // { x,y,w,h }

  // ── cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setReady(false);
    setCurrentPage(0);
    setTotalPages(1);
    setHighlight(null);
    setInstruments([]);
    measureStepsRef.current = [];

    if (engineRef.current) {
      try { engineRef.current.stop(); } catch (err) { console.warn('cleanup: engine.stop() failed', err); }
      engineRef.current = null;
    }
    customPlayerRef.current = null;
    if (osmdContainerRef.current) osmdContainerRef.current.innerHTML = '';
    osmdRef.current = null;
  }, []);

  // ── show only current page ─────────────────────────────────────────────────
  useEffect(() => {
    if (!osmdContainerRef.current || !ready) return;
    Array.from(osmdContainerRef.current.children).forEach((child, i) => {
      child.style.display = i === currentPage ? '' : 'none';
    });
  }, [currentPage, ready]);

  // ── load score ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileInfo) return;
    cleanup();
    loadScore(fileInfo);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileInfo.filename]);

  async function loadScore(info) {
    setLoading(true);
    try {
      const xmlContent = await fetch(`/api/files/${encodeURIComponent(info.filename)}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });

      // ── OSMD ──────────────────────────────────────────────────────────────
      const osmd = new OpenSheetMusicDisplay(osmdContainerRef.current, {
        autoResize: false,
        backend: 'svg',
        drawTitle: true,
        drawComposer: true,
        pageFormat: 'A4 P',
        pageBackgroundColor: '#FFFFFF',
        followCursor: false,
      });
      await osmd.load(xmlContent);

      // Give each instrument a unique MIDI ID (0,1,2,…) so CustomPianoPlayer
      // can mute individual parts while still playing everything as piano.
      osmd.Sheet.Instruments.forEach((inst, i) => { inst.MidiInstrumentId = i; });

      await osmd.render();
      osmd.cursor.show();
      osmdRef.current = osmd;

      // ── part list ────────────────────────────────────────────────────────
      const instList = osmd.Sheet.Instruments.map((inst, i) => ({
        id: String(i),
        midiId: i,
        name: inst.Name || `Part ${i + 1}`,
        muted: false,
      }));
      setInstruments(instList);
      setTotalPages(osmd.GraphicSheet?.MusicPages?.length ?? 1);

      // ── PlaybackEngine ────────────────────────────────────────────────────
      const customPlayer = new CustomPianoPlayer();
      customPlayerRef.current = customPlayer;
      const engine = new PlaybackEngine(undefined, customPlayer);
      await engine.loadScore(osmd);

      // Record base BPM so tempo slider works correctly after re-loads
      baseBpmRef.current = engine.playbackSettings.bpm;
      engine.setBpm(baseBpmRef.current * tempo);

      // Build measure→step map
      measureStepsRef.current = buildMeasureStepMap(osmd);

      // Subscribe to events
      engine.on(PlaybackEvent.STATE_CHANGE, (state) => {
        if (state === 'STOPPED') {
          playingRef.current = false;
          setPlaying(false);
        }
      });
      engine.on(PlaybackEvent.ITERATION, () => {
        const iter = osmdRef.current?.cursor?.Iterator;
        if (!iter) return;
        const m = iter.CurrentMeasureIndex ?? 0;
        applyHighlight(osmdRef.current, m);
      });

      engineRef.current = engine;
      applyHighlight(osmd, 0);
      setLoading(false);
      setReady(true);
    } catch (e) {
      console.error('Failed to load score:', e);
      setLoading(false);
    }
  }

  /** Walk the cursor and record which engine step index each measure starts at. */
  function buildMeasureStepMap(osmd) {
    const map = [];
    let prevMeasure = -1;
    let step = 0;
    try {
      osmd.cursor.reset();
      while (!osmd.cursor.Iterator.EndReached) {
        const m = osmd.cursor.Iterator.CurrentMeasureIndex ?? 0;
        if (m !== prevMeasure) { map[m] = step; prevMeasure = m; }
        osmd.cursor.next();
        step++;
      }
      osmd.cursor.reset();
    } catch (err) { console.warn('buildMeasureStepMap: cursor walk failed', err); }
    return map;
  }

  function applyHighlight(osmd, measureIndex) {
    const bounds = getMeasureBounds(osmd, wrapperRef.current, measureIndex);
    if (!bounds) return;
    setCurrentPage(bounds.pageIndex);
    setHighlight({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
  }

  // ── transport ──────────────────────────────────────────────────────────────
  async function handlePlay() {
    if (!engineRef.current) return;
    await engineRef.current.play();
    playingRef.current = true;
    setPlaying(true);
  }

  function handlePause() {
    if (!engineRef.current) return;
    engineRef.current.pause();
    playingRef.current = false;
    setPlaying(false);
  }

  async function handleStop() {
    if (!engineRef.current) return;
    await engineRef.current.stop();
    playingRef.current = false;
    setPlaying(false);
    try { osmdRef.current?.cursor?.reset(); osmdRef.current?.cursor?.show(); } catch (err) { console.warn('handleStop: cursor reset failed', err); }
    applyHighlight(osmdRef.current, 0);
  }

  function handleTempoChange(newTempo) {
    setTempo(newTempo);
    if (engineRef.current) engineRef.current.setBpm(baseBpmRef.current * newTempo);
  }

  function handleMuteToggle(instrumentId, muted) {
    setInstruments((prev) =>
      prev.map((inst) => inst.id === instrumentId ? { ...inst, muted } : inst)
    );
    const inst = instruments.find((i) => i.id === instrumentId);
    if (inst) customPlayerRef.current?.setMuted(inst.midiId, muted);
  }

  // ── click-to-jump ──────────────────────────────────────────────────────────
  async function handleWrapperClick(e) {
    if (!ready || !osmdRef.current) return;
    const measureIdx = measureAtClick(osmdRef.current, wrapperRef.current, e);
    if (measureIdx < 0) return;
    await jumpToMeasure(measureIdx);
  }

  async function jumpToMeasure(measureIndex) {
    const engine = engineRef.current;
    const osmd   = osmdRef.current;
    if (!engine || !osmd) return;

    const wasPlaying = playingRef.current;
    if (wasPlaying) { engine.pause(); setPlaying(false); playingRef.current = false; }

    const step = measureStepsRef.current[measureIndex] ?? 0;
    try { engine.jumpToStep(step); } catch (err) { console.warn('jumpToStep:', err); }

    // Re-sync visual cursor
    try {
      osmd.cursor.reset(); osmd.cursor.show();
      let cur = osmd.cursor.Iterator.CurrentMeasureIndex ?? 0;
      while (cur < measureIndex && !osmd.cursor.Iterator.EndReached) {
        osmd.cursor.next();
        cur = osmd.cursor.Iterator.CurrentMeasureIndex ?? cur + 1;
      }
    } catch (err) { console.warn('jumpToMeasure: cursor sync failed', err); }

    applyHighlight(osmd, measureIndex);

    if (wasPlaying) {
      await engine.play();
      setPlaying(true);
      playingRef.current = true;
    }
  }

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="sheet-player">
      <div className="sheet-player-header">
        <h2>{fileInfo.title}</h2>
        {fileInfo.composer && <span className="composer">{fileInfo.composer}</span>}
        <span className="page-indicator">Page {currentPage + 1} / {totalPages}</span>
      </div>

      <div className="sheet-player-body">
        <div className="sheet-area">
          {loading && <div className="loading-overlay">Loading score…</div>}

          <div ref={wrapperRef} className="osmd-wrapper" onClick={handleWrapperClick}>
            <div ref={osmdContainerRef} />

            {highlight && ready && (
              <div
                className="measure-highlight"
                style={{
                  left: highlight.x,
                  top:  highlight.y,
                  width:  highlight.w,
                  height: highlight.h,
                  backgroundColor: 'rgba(255,200,0,0.25)',
                  border: '2px solid rgba(255,160,0,0.7)',
                }}
              />
            )}
          </div>
        </div>

        <div className="controls-panel">
          <PlayerControls
            playing={playing}
            ready={ready}
            tempo={tempo}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onTempoChange={handleTempoChange}
          />
          <PartSelector instruments={instruments} onMuteToggle={handleMuteToggle} />
        </div>
      </div>
    </div>
  );
}
