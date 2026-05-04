import type { InputState } from "../sim/types";

const DEFAULT_INPUT: InputState = {
  trimUp: false,
  trimDown: false,
  rudderLeft: false,
  rudderRight: false,
  firePort: false,
  fireStarboard: false,
};

export function createControls(target: HTMLElement | Window = window): {
  input: InputState;
  dispose: () => void;
} {
  const input: InputState = { ...DEFAULT_INPUT };

  function setKey(code: string, value: boolean): void {
    switch (code) {
      case "KeyW":
        input.trimUp = value;
        break;
      case "KeyS":
        input.trimDown = value;
        break;
      case "KeyA":
        input.rudderLeft = value;
        break;
      case "KeyD":
        input.rudderRight = value;
        break;
      case "KeyQ":
        input.firePort = value;
        break;
      case "KeyE":
        input.fireStarboard = value;
        break;
      default:
        break;
    }
  }

  const down = (ev: KeyboardEvent) => setKey(ev.code, true);
  const up = (ev: KeyboardEvent) => setKey(ev.code, false);

  target.addEventListener("keydown", down as EventListener);
  target.addEventListener("keyup", up as EventListener);

  return {
    input,
    dispose: () => {
      target.removeEventListener("keydown", down as EventListener);
      target.removeEventListener("keyup", up as EventListener);
    },
  };
}
