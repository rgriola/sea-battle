import { SIM_TICK_SECONDS } from "../config/world";
import { createInitialGame, tickGame } from "./engine";
import type { Rng } from "./rng";
import type { DamageEvent, FiringEvent, GameState, ImpactEvent, InputState } from "./types";

export type SimulationAuthority = "local-client" | "server-authoritative";

export type SimulationSession = {
  matchId: string;
  seed: number;
  authority: SimulationAuthority;
  tickSeconds: number;
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
}): SimulationSession {
  const seed = opts?.seed ?? 42;
  const tickSeconds = opts?.tickSeconds ?? SIM_TICK_SECONDS;
  const initial = createInitialGame(seed);

  return {
    matchId: opts?.matchId ?? "local-sea-battle",
    seed,
    authority: opts?.authority ?? "local-client",
    tickSeconds,
    game: initial.game,
    rng: initial.rng,
  };
}

export function resetSimulationSession(session: SimulationSession, seed: number): void {
  const initial = createInitialGame(seed);
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

export function createLocalSimulationAdapter(opts?: {
  seed?: number;
  matchId?: string;
  authority?: SimulationAuthority;
  tickSeconds?: number;
}): SimulationAdapter {
  const session = createSimulationSession(opts);
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
