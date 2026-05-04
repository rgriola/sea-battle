// Last touched by agent: 2026-05-04T18:00:00Z
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

const SHIP_SVGS: Record<ShipClass, JSX.Element> = {
  sloop: (
    <svg viewBox="0 0 90 55" width="88" height="52" aria-hidden="true">
      <path d="M14,37 Q45,47 76,37 L72,44 Q45,51 18,44 Z" fill="#7a5c3a" />
      <line x1="40" y1="11" x2="40" y2="38" stroke="#4a3010" strokeWidth="2.5" />
      <path d="M40,13 L40,37 L63,28 Z" fill="rgba(235,220,165,0.92)" stroke="rgba(140,120,60,0.4)" strokeWidth="0.5" />
      <path d="M40,21 L24,35 L40,37 Z" fill="rgba(225,210,155,0.82)" />
      <line x1="14" y1="38" x2="24" y2="31" stroke="#4a3010" strokeWidth="1.5" />
    </svg>
  ),
  schooner: (
    <svg viewBox="0 0 90 55" width="88" height="52" aria-hidden="true">
      <path d="M10,37 Q45,49 80,37 L76,44 Q45,53 14,44 Z" fill="#7a5c3a" />
      <line x1="30" y1="9" x2="30" y2="38" stroke="#4a3010" strokeWidth="2.5" />
      <line x1="55" y1="7" x2="55" y2="38" stroke="#4a3010" strokeWidth="2.5" />
      <path d="M30,11 L30,37 L52,28 Z" fill="rgba(235,220,165,0.9)" />
      <path d="M55,9 L55,37 L75,27 Z" fill="rgba(235,220,165,0.9)" />
      <path d="M30,22 L16,35 L30,37 Z" fill="rgba(225,210,155,0.8)" />
      <line x1="10" y1="38" x2="16" y2="31" stroke="#4a3010" strokeWidth="1.5" />
    </svg>
  ),
  brigantine: (
    <svg viewBox="0 0 90 55" width="88" height="52" aria-hidden="true">
      <path d="M9,36 Q45,51 81,36 L77,45 Q45,55 13,45 Z" fill="#6b4d2e" />
      <line x1="28" y1="7" x2="28" y2="38" stroke="#3d2510" strokeWidth="2.5" />
      <line x1="15" y1="15" x2="41" y2="15" stroke="#3d2510" strokeWidth="1.5" />
      <path d="M16,16 L40,16 L37,34 L19,34 Z" fill="rgba(235,220,165,0.88)" />
      <line x1="55" y1="6" x2="55" y2="38" stroke="#3d2510" strokeWidth="2.5" />
      <path d="M55,8 L55,37 L74,27 Z" fill="rgba(235,220,165,0.88)" />
      <line x1="9" y1="38" x2="17" y2="29" stroke="#3d2510" strokeWidth="1.5" />
    </svg>
  ),
  galleon: (
    <svg viewBox="0 0 90 55" width="88" height="52" aria-hidden="true">
      <path d="M6,34 Q45,53 84,34 L80,45 Q45,57 10,45 Z" fill="#5c3d1e" />
      <rect x="76" y="25" width="9" height="19" rx="1" fill="#5c3d1e" />
      <line x1="22" y1="9" x2="22" y2="37" stroke="#32200a" strokeWidth="2.5" />
      <line x1="12" y1="17" x2="32" y2="17" stroke="#32200a" strokeWidth="1.5" />
      <path d="M13,18 L31,18 L29,34 L15,34 Z" fill="rgba(235,220,165,0.87)" />
      <line x1="44" y1="4" x2="44" y2="37" stroke="#32200a" strokeWidth="2.5" />
      <line x1="31" y1="11" x2="57" y2="11" stroke="#32200a" strokeWidth="1.5" />
      <path d="M32,12 L56,12 L53,33 L35,33 Z" fill="rgba(235,220,165,0.87)" />
      <line x1="63" y1="13" x2="63" y2="37" stroke="#32200a" strokeWidth="2.5" />
      <path d="M63,15 L63,36 L75,28 Z" fill="rgba(235,220,165,0.84)" />
      <line x1="6" y1="38" x2="15" y2="28" stroke="#32200a" strokeWidth="1.5" />
    </svg>
  ),
};

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
          {!started && !selectedMap && (
            <div className="start-overlay">
              <div className="start-card">
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
              </div>
            </div>
          )}
          {!started && selectedMap && (
            <div className="start-overlay">
              <div className="ship-select-panel">
                {/* Left column: ship cards */}
                <div className="ship-select-left">
                  <h2 className="ship-select-title">Choose Your Ship</h2>
                  <div className="ship-cards-grid">
                    {PLAYER_SHIP_OPTIONS.map((option) => {
                      const specs = SHIP_BALANCE[option.shipClass];
                      const selected = selectedShip === option.shipClass;
                      return (
                        <button
                          key={option.shipClass}
                          className={`ship-card${selected ? " ship-card--selected" : ""}`}
                          onClick={() => setSelectedShip(option.shipClass)}
                          type="button"
                        >
                          <div className="ship-card-image">{SHIP_SVGS[option.shipClass]}</div>
                          <div className="ship-card-name">{option.label}</div>
                          <div className="ship-card-role">{option.role}</div>
                          <div className="ship-card-specs">
                            Hull {specs.hullHp} · Spd {specs.maxSpeedFtPerSec.toFixed(0)} ft/s · Turn {specs.turnRateDegPerSec.toFixed(0)}°/s
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Right column: info + controls + buttons */}
                <div className="ship-select-right">
                  <h3 className="ship-select-subtitle">Sea Battle</h3>
                  <p>Each hull trades speed, durability, crew size, and turning circle differently. Choose the vessel that fits your fighting style.</p>
                  <ul className="ship-controls-list">
                    <li><kbd>W</kbd> / <kbd>S</kbd> — sail trim up / down</li>
                    <li><kbd>A</kbd> / <kbd>D</kbd> — rudder port / starboard</li>
                    <li><kbd>Q</kbd> — fire port broadside</li>
                    <li><kbd>E</kbd> — fire starboard broadside</li>
                    <li><kbd>Wheel</kbd> — zoom in / out</li>
                  </ul>
                  <p className="wind-note">
                    Square-rigged ships are fastest on a reach or with the wind abaft the beam. Pointing too close into the
                    wind enters the no-go zone and kills your drive.
                  </p>
                  <p className="wind-note">
                    Watch the compass, keep some sail set, and remember the rudder works best when the ship already has speed.
                  </p>
                  <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
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
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
