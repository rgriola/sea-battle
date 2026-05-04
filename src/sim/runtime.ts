import { SIM_TICK_SECONDS } from "../config/world";
import { createInitialGame, tickGame } from "./engine";
import type { Rng } from "./rng";
import type { GameState, InputState } from "./types";

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
