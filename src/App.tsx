// Last touched by agent: 2026-05-05T00:20:00Z
import { useEffect, useRef, useState } from "react";
import { SHIP_BALANCE, type ShipClass } from "./config/balance";
import { mountPixiScene, type SceneHandle } from "./render/pixiScene";
import type { SimulationAuthority } from "./sim/runtime";
import type { MapType } from "./config/maps";
import { ALL_MAPS } from "./config/maps";

const PLAYER_SHIP_OPTIONS: Array<{ shipClass: ShipClass; label: string; role: string }> = [
  { shipClass: "sloop", label: "Sloop", role: "Fast scout and duelist" },
  { shipClass: "schooner", label: "Schooner", role: "Quick raider with balanced handling" },
  { shipClass: "brigantine", label: "Brigantine", role: "Solid all-rounder with staying power" },
  { shipClass: "galleon", label: "Galleon", role: "Heavy hitter with slow turn response" },
];

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
  const [selectedMap, setSelectedMap] = useState<MapType | null>(null);
  const [selectedShip, setSelectedShip] = useState<ShipClass>("sloop");
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
    if (!started || !hostRef.current || !hudRef.current || !statusRef.current || !selectedMap) return;
    const scene = mountPixiScene(hostRef.current, hudRef.current, statusRef.current, {
      authority,
      zoomEl: zoomRef.current ?? undefined,
      mapType: selectedMap,
      playerShipClass: selectedShip,
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [started, selectedMap, selectedShip]);

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
                {!selectedMap ? (
                  <>
                    <h2>Choose Theater</h2>
                    <p>Select your battle theater:</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                      {ALL_MAPS.map((map) => (
                        <button
                          key={map.id}
                          className="btn-map-select"
                          onClick={() => setSelectedMap(map.id)}
                          type="button"
                        >
                          <div style={{ fontWeight: 600 }}>{map.label}</div>
                          <div style={{ fontSize: "0.85rem", color: "#9dd4e8", marginTop: "4px" }}>{map.description}</div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Sea Battle</h2>
                    <p>Choose your command, then fight under sail. Each hull trades speed, durability, crew size, and turning circle differently.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                      {PLAYER_SHIP_OPTIONS.map((option) => {
                        const specs = SHIP_BALANCE[option.shipClass];
                        const selected = selectedShip === option.shipClass;
                        return (
                          <button
                            key={option.shipClass}
                            className="btn-map-select"
                            onClick={() => setSelectedShip(option.shipClass)}
                            type="button"
                            style={{
                              textAlign: "left",
                              borderColor: selected ? "#c7a45a" : undefined,
                              boxShadow: selected ? "0 0 0 1px #c7a45a inset" : undefined,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
                              <div style={{ fontWeight: 600 }}>{option.label}</div>
                              <div style={{ fontSize: "0.75rem", color: selected ? "#f3d893" : "#9dd4e8" }}>{selected ? "Selected" : option.role}</div>
                            </div>
                            <div style={{ fontSize: "0.82rem", color: "#c9e7f1", marginTop: "6px" }}>
                              Hull {specs.hullHp} · Sails {specs.sailsHp} · Crew {specs.crew} · Speed {specs.maxSpeedFtPerSec.toFixed(0)} ft/s · Turn {specs.turnRateDegPerSec.toFixed(0)}°/s
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <ul>
                      <li><kbd>W</kbd> / <kbd>S</kbd> — raise or reduce sail trim in 10% steps</li>
                      <li><kbd>A</kbd> / <kbd>D</kbd> — angle the rudder to port or starboard in 5° steps</li>
                      <li><kbd>Q</kbd> — fire port broadside</li>
                      <li><kbd>E</kbd> — fire starboard broadside</li>
                    </ul>
                    <p className="wind-note">
                      Square-rigged ships are fastest on a reach or with the wind abaft the beam. If you point too close into the wind,
                      you enter the no-go zone and lose most of your drive.
                    </p>
                    <p className="wind-note">
                      Watch the compass for wind direction, keep some sail on, and remember that the rudder turns best when the ship already has speed.
                      Use the minimap and mouse wheel to manage range and positioning before you commit to a broadside.
                    </p>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        className="btn-start"
                        onClick={() => setSelectedMap(null)}
                        type="button"
                        style={{ flex: 1, backgroundColor: "#4a4a4a" }}
                      >
                        Back
                      </button>
                      <button
                        className="btn-start"
                        onClick={() => setStarted(true)}
                        type="button"
                        style={{ flex: 1 }}
                      >
                        Start Battle
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
