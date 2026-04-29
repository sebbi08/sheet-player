import { useEffect, useRef, useState, useCallback } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import PlaybackEngine from 'osmd-audio-player';
import { CustomPianoPlayer } from '../audioPlayer.js';
import PartSelector from './PartSelector.jsx';
import PlayerControls from './PlayerControls.jsx';

// PlaybackEngine event name constants (not re-exported by osmd-audio-player index)
const PlaybackEvent = {
  STATE_CHANGE: 'state-change',
  ITERATION: 'iteration',
};

// ─── geometry helpers ─────────────────────────────────────────────────────────

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

      // OSMD page hierarchy: MusicPages → MusicSystems → StaffLines → Measures
      for (const system of (pages[p]?.MusicSystems ?? [])) {
        for (const sl of (system?.StaffLines ?? [])) {
          for (const gm of (sl?.Measures ?? [])) {
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
      }
      break; // clicked this page but no measure hit
    }
  } catch (err) { console.warn('measureAtClick: error detecting measure', err); }
  return -1;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function SheetPlayer({ fileInfo }) {
  const wrapperRef       = useRef(null);  // position:relative outer div
  const osmdContainerRef = useRef(null);  // OSMD renders SVGs here
  const sheetAreaRef     = useRef(null);  // scroll container
  const osmdRef          = useRef(null);
  const engineRef        = useRef(null);
  const customPlayerRef  = useRef(null);
  const playingRef       = useRef(false);
  const baseBpmRef       = useRef(100);
  const measureStepsRef  = useRef([]);    // measureIndex → engine step
  const lastMeasureRef   = useRef(-1);    // last measure scrolled to (avoids redundant work)

  const [loading,  setLoading]  = useState(false);
  const [ready,    setReady]    = useState(false);
  const [playing,  setPlaying]  = useState(false);
  const [tempo,    setTempo]    = useState(1.0);
  const [instruments, setInstruments] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  // Incremented after each successful OSMD render so the scroll-to-top
  // effect fires immediately when a new score loads.
  const [scoreVersion, setScoreVersion] = useState(0);

  // ── cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setReady(false);
    setCurrentPage(0);
    setTotalPages(1);
    setInstruments([]);
    measureStepsRef.current = [];
    lastMeasureRef.current  = -1;

    if (engineRef.current) {
      try { engineRef.current.stop(); } catch (err) { console.warn('cleanup: engine.stop() failed', err); }
      engineRef.current = null;
    }
    customPlayerRef.current = null;
    if (osmdContainerRef.current) osmdContainerRef.current.innerHTML = '';
    osmdRef.current = null;
  }, []);

  // ── scroll to top when a new score loads ──────────────────────────────────
  useEffect(() => {
    if (scoreVersion > 0 && sheetAreaRef.current) {
      sheetAreaRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [scoreVersion]);

  // ── load score ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileInfo) return;
    cleanup();
    let cancelled = false;
    loadScore(fileInfo, () => cancelled);
    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileInfo.filename]);

  async function loadScore(info, isCancelled) {
    setLoading(true);
    try {
      // ── Phase 1: fetch + OSMD render ─────────────────────────────────────
      const xmlContent = await fetch(`/api/files/${encodeURIComponent(info.filename)}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
      if (isCancelled()) return;

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
      if (isCancelled()) return;

      osmd.Sheet.Instruments.forEach((inst, i) => { inst.MidiInstrumentId = i; });

      await osmd.render();
      if (isCancelled()) return;

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

      // Show cursor at measure 0 so the start position is visible while the
      // audio engine loads in Phase 2.
      try { osmd.cursor.reset(); osmd.cursor.show(); } catch (_) { /* ignore */ }
      applyHighlight(osmd, 0);
      setScoreVersion((v) => v + 1);
      setLoading(false);

      // ── Phase 2: audio engine (best-effort) ───────────────────────────────
      try {
        const customPlayer = new CustomPianoPlayer();
        customPlayerRef.current = customPlayer;
        const engine = new PlaybackEngine(undefined, customPlayer);
        await engine.loadScore(osmd);
        if (isCancelled()) return;

        // engine.loadScore() hides the cursor via countAndSetIterationSteps;
        // restore it so the start position is visible before playback begins.
        try { osmd.cursor.show(); } catch (_) { /* ignore */ }

        baseBpmRef.current = engine.playbackSettings.bpm;
        engine.setBpm(baseBpmRef.current * tempo);

        measureStepsRef.current = buildMeasureStepMap(osmd);

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
          if (m === lastMeasureRef.current) return;
          lastMeasureRef.current = m;
          applyHighlight(osmdRef.current, m);
        });

        engineRef.current = engine;
        setReady(true);
      } catch (audioErr) {
        console.warn('Audio engine setup failed (score shown without playback):', audioErr);
      }
    } catch (e) {
      if (isCancelled()) return;
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
    // Update page indicator
    const ml    = osmd.GraphicSheet?.MeasureList;
    const pages = osmd.GraphicSheet?.MusicPages;
    if (ml?.[0]?.[measureIndex] && pages) {
      const target = ml[0][measureIndex];
      outer: for (let p = 0; p < pages.length; p++) {
        for (const sys of (pages[p]?.MusicSystems ?? [])) {
          for (const sl of (sys?.StaffLines ?? [])) {
            for (const gm of (sl?.Measures ?? [])) {
              if (gm === target) { setCurrentPage(p); break outer; }
            }
          }
        }
      }
    }
    // Scroll OSMD cursor element into view
    try {
      osmd.cursor.cursorElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) { /* ignore */ }
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
    setInstruments((prev) => {
      const inst = prev.find((i) => i.id === instrumentId);
      if (inst) customPlayerRef.current?.setMuted(inst.midiId, muted);
      return prev.map((i) => i.id === instrumentId ? { ...i, muted } : i);
    });
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
        <div className="sheet-area" ref={sheetAreaRef}>
          {loading && <div className="loading-overlay">Loading score…</div>}

          <div ref={wrapperRef} className="osmd-wrapper" onClick={handleWrapperClick}>
            <div ref={osmdContainerRef} />
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
