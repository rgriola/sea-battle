// Last touched by agent: 2026-05-04T22:00:00Z
import { useEffect, useRef, useState } from "react";
import { mountPixiScene, type SceneHandle } from "./render/pixiScene";
import type { SimulationAuthority } from "./sim/runtime";

function readAuthorityMode(): SimulationAuthority {
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("authority");
    if (param === "server-authoritative") return "server-authoritative";
  }
  return "local-client";
}

export default function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [started, setStarted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const authority = readAuthorityMode();

  useEffect(() => {
    if (!started) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "KeyI") setShowInstructions((prev) => !prev);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [started]);

  useEffect(() => {
    if (!started || !hostRef.current || !hudRef.current || !statusRef.current) return;
    const scene = mountPixiScene(hostRef.current, hudRef.current, statusRef.current, { authority, zoomEl: zoomRef.current ?? undefined });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [started]);

  const handleReset = () => {
    sceneRef.current?.reset();
  };

  const handleCenter = () => {
    sceneRef.current?.centerOnPlayer();
  };

  return (
    <main className="app-shell">
      <section className="title-panel">
        <h1>Sea Battle</h1>
        <p>1650-1875 square-rig combat. Wind affects every ship — sail with it, not against it.</p>
      </section>

      {started && (
        <section className="controls-bar">
          <button className="btn-camera" onClick={handleCenter} type="button">
            My Ship
          </button>
          <button className="btn-reset" onClick={handleReset} type="button">
            Reset
          </button>
          <div className="zoom-display" ref={zoomRef}>Zoom: 1.00×</div>
        </section>
      )}

      <section className="sim-panel">
        <div className="viewport" ref={hostRef}>
          {started && (
            <div className="viewport-overlay">
              <div className="status status-bottom" ref={statusRef} />
              <div className="hud hud-right" ref={hudRef} />
              {showInstructions && (
                <div className="instructions-overlay" onClick={() => setShowInstructions(false)}>
                  <div className="start-card" onClick={(e) => e.stopPropagation()}>
                    <h2>Controls</h2>
                    <ul>
                      <li><kbd>W</kbd> / <kbd>S</kbd> — sail trim up / down</li>
                      <li><kbd>A</kbd> / <kbd>D</kbd> — rudder port / starboard (5° steps)</li>
                      <li><kbd>Q</kbd> — fire port broadside</li>
                      <li><kbd>E</kbd> — fire starboard broadside</li>
                      <li><kbd>Wheel</kbd> — zoom in / out</li>
                      <li><kbd>I</kbd> — toggle this panel</li>
                    </ul>
                    <p className="wind-note">
                      The compass (top-center) shows wind direction. The red wedge is the
                      no-go zone — sailing into it kills speed. Click the minimap to pan camera.
                    </p>
                    <button className="btn-start" onClick={() => setShowInstructions(false)} type="button">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!started && (
            <div className="start-overlay">
              <div className="start-card">
                <h2>Set Sail</h2>
                <ul>
                  <li><kbd>W</kbd> / <kbd>S</kbd> — throttle up / down</li>
                  <li><kbd>A</kbd> / <kbd>D</kbd> — rudder left / right</li>
                  <li><kbd>Q</kbd> — fire port broadside</li>
                  <li><kbd>E</kbd> — fire starboard broadside</li>
                </ul>
                <p className="wind-note">
                  The compass (top-right) shows wind direction. The red wedge is the no-go zone.
                  Sailing into it will stop you dead. Use trackpad/wheel to zoom.
                </p>
                <button className="btn-start" onClick={() => setStarted(true)} type="button">
                  Start Battle
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
