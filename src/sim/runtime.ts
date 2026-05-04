// Last touched by agent: 2026-05-04T21:05:00Z
// Purpose: Simulation runtime boundary — local and remote adapters with authority metadata.
import { SIM_TICK_SECONDS } from "../config/world";
import { createInitialGame, tickGame } from "./engine";
import type { MapType } from "../config/maps";
import type { Rng } from "./rng";
import type { DamageEvent, FiringEvent, GameState, ImpactEvent, InputState } from "./types";

export type SimulationAuthority = "local-client" | "server-authoritative";

export type SimulationSession = {
  matchId: string;
  seed: number;
  authority: SimulationAuthority;
  tickSeconds: number;
  playerShipClass: import("../config/balance").ShipClass;
  game: GameState;
  rng: Rng;
};

export type SimulationMeta = {
  matchId: string;
  seed: number;
  authority: SimulationAuthority;
  tickSeconds: number;
  tick: number;
  winner: GameState["winner"];
};

export type SimulationCommand =
  | {
      type: "set-input";
      input: InputState;
    }
  | {
      type: "reset";
      seed: number;
    };

export type SimulationFrameEvent = {
  type: "frame";
  tick: number;
  firingEvents: FiringEvent[];
  impactEvents: ImpactEvent[];
  damageEvents: DamageEvent[];
};

export type SimulationMatchEndedEvent = {
  type: "match-ended";
  tick: number;
  winner: GameState["winner"];
};

export type SimulationEvent = SimulationFrameEvent | SimulationMatchEndedEvent;

export type SimulationAdapter = {
  dispatch: (command: SimulationCommand) => void;
  step: (dt?: number) => void;
  getSnapshot: () => GameState;
  getMeta: () => SimulationMeta;
  consumeEvents: () => SimulationEvent[];
};

function cloneInput(input: InputState): InputState {
  return {
    trimUp: input.trimUp,
    trimDown: input.trimDown,
    rudderLeft: input.rudderLeft,
    rudderRight: input.rudderRight,
    firePort: input.firePort,
    fireStarboard: input.fireStarboard,
  };
}

function cloneFiringEvents(events: FiringEvent[]): FiringEvent[] {
  return events.map((event) => ({ ...event }));
}

function cloneImpactEvents(events: ImpactEvent[]): ImpactEvent[] {
  return events.map((event) => ({ ...event }));
}

function cloneDamageEvents(events: DamageEvent[]): DamageEvent[] {
  return events.map((event) => ({ ...event }));
}

function createEmptyInputState(): InputState {
  return {
    trimUp: false,
    trimDown: false,
    rudderLeft: false,
    rudderRight: false,
    firePort: false,
    fireStarboard: false,
  };
}

export function createSimulationSession(opts?: {
  seed?: number;
  matchId?: string;
  authority?: SimulationAuthority;
  tickSeconds?: number;
  mapType?: MapType;
  playerShipClass?: import("../config/balance").ShipClass;
}): SimulationSession {
  const seed = opts?.seed ?? 42;
  const tickSeconds = opts?.tickSeconds ?? SIM_TICK_SECONDS;
  const mapType = opts?.mapType ?? "open-ocean";
  const playerShipClass = opts?.playerShipClass ?? "sloop";
  const initial = createInitialGame(mapType, seed, playerShipClass);

  return {
    matchId: opts?.matchId ?? "local-sea-battle",
    seed,
    authority: opts?.authority ?? "local-client",
    tickSeconds,
    playerShipClass,
    game: initial.game,
    rng: initial.rng,
  };
}

export function resetSimulationSession(session: SimulationSession, seed: number): void {
  const mapType = session.game.mapType;
  const initial = createInitialGame(mapType, seed, session.playerShipClass);
  session.seed = seed;
  session.game = initial.game;
  session.rng = initial.rng;
}

export function stepSimulation(
  session: SimulationSession,
  input: InputState,
  dt = session.tickSeconds,
): void {
  tickGame(session.game, session.rng, input, dt);
}

export function getSimulationMeta(session: SimulationSession): SimulationMeta {
  return {
    matchId: session.matchId,
    seed: session.seed,
    authority: session.authority,
    tickSeconds: session.tickSeconds,
    tick: session.game.tick,
    winner: session.game.winner,
  };
}

export type AdapterOpts = {
  seed?: number;
  matchId?: string;
  tickSeconds?: number;
  mapType?: MapType;
  playerShipClass?: import("../config/balance").ShipClass;
};

export function createLocalSimulationAdapter(opts?: AdapterOpts): SimulationAdapter {
  const session = createSimulationSession({ ...opts, authority: "local-client" });
  let input = createEmptyInputState();
  const eventQueue: SimulationEvent[] = [];

  return {
    dispatch: (command) => {
      if (command.type === "set-input") {
        input = cloneInput(command.input);
        return;
      }

      if (command.type === "reset") {
        resetSimulationSession(session, command.seed);
        input = createEmptyInputState();
        eventQueue.length = 0;
      }
    },
    step: (dt = session.tickSeconds) => {
      const winnerBefore = session.game.winner;
      stepSimulation(session, input, dt);

      eventQueue.push({
        type: "frame",
        tick: session.game.tick,
        firingEvents: cloneFiringEvents(session.game.firingEvents),
        impactEvents: cloneImpactEvents(session.game.impactEvents),
        damageEvents: cloneDamageEvents(session.game.damageEvents),
      });

      if (!winnerBefore && session.game.winner) {
        eventQueue.push({
          type: "match-ended",
          tick: session.game.tick,
          winner: session.game.winner,
        });
      }
    },
    getSnapshot: () => session.game,
    getMeta: () => getSimulationMeta(session),
    consumeEvents: () => {
      const snapshot = eventQueue.slice();
      eventQueue.length = 0;
      return snapshot;
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 3: Remote/server-authoritative adapter stub
//
// Runs locally as a prediction engine but marks authority as server-authoritative.
// Call applyServerSnapshot() whenever a trusted state frame arrives from the server
// (WebSocket, REST poll, etc.) — it overwrites the local prediction and drains
// any events produced by the reconciled state.
// ---------------------------------------------------------------------------

export type RemoteSimulationAdapter = SimulationAdapter & {
  applyServerSnapshot: (serverState: GameState) => void;
};

export function createRemoteSimulationAdapter(opts?: AdapterOpts): RemoteSimulationAdapter {
  const session = createSimulationSession({ ...opts, authority: "server-authoritative" });
  let input = createEmptyInputState();
  const eventQueue: SimulationEvent[] = [];

  const base: SimulationAdapter = {
    dispatch: (command) => {
      if (command.type === "set-input") {
        input = cloneInput(command.input);
        return;
      }
      if (command.type === "reset") {
        resetSimulationSession(session, command.seed);
        input = createEmptyInputState();
        eventQueue.length = 0;
      }
    },
    step: (dt = session.tickSeconds) => {
      const winnerBefore = session.game.winner;
      // Run local prediction tick — server state overwrites this on next snapshot
      stepSimulation(session, input, dt);

      eventQueue.push({
        type: "frame",
        tick: session.game.tick,
        firingEvents: cloneFiringEvents(session.game.firingEvents),
        impactEvents: cloneImpactEvents(session.game.impactEvents),
        damageEvents: cloneDamageEvents(session.game.damageEvents),
      });

      if (!winnerBefore && session.game.winner) {
        eventQueue.push({
          type: "match-ended",
          tick: session.game.tick,
          winner: session.game.winner,
        });
      }
    },
    getSnapshot: () => session.game,
    getMeta: () => getSimulationMeta(session),
    consumeEvents: () => {
      const snapshot = eventQueue.slice();
      eventQueue.length = 0;
      return snapshot;
    },
  };

  return {
    ...base,
    applyServerSnapshot: (serverState: GameState) => {
      // Authoritative reconcile: overwrite local prediction with server state.
      // Fire a synthetic frame event so the renderer picks up the reconciled events.
      const winnerBefore = session.game.winner;
      session.game = serverState;

      eventQueue.push({
        type: "frame",
        tick: serverState.tick,
        firingEvents: cloneFiringEvents(serverState.firingEvents),
        impactEvents: cloneImpactEvents(serverState.impactEvents),
        damageEvents: cloneDamageEvents(serverState.damageEvents),
      });

      if (!winnerBefore && serverState.winner) {
        eventQueue.push({
          type: "match-ended",
          tick: serverState.tick,
          winner: serverState.winner,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mode factory — selects the correct adapter for local vs server-authoritative play
// ---------------------------------------------------------------------------

export function createSimulationAdapterForMode(
  authority: SimulationAuthority,
  opts?: AdapterOpts,
): SimulationAdapter {
  if (authority === "server-authoritative") {
    return createRemoteSimulationAdapter(opts);
  }
  return createLocalSimulationAdapter(opts);
}
