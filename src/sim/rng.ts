export type Rng = {
  next: () => number;
  range: (min: number, max: number) => number;
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  }

  return {
    next,
    range(min: number, max: number): number {
      return min + (max - min) * next();
    },
  };
}
