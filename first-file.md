# this is my work file for you to read.

https://github.com/rgriola/sea-battle.git

# this project to replicating sea battle between Sloops, Schooners and Brigantines and Galleons.

**_ task _**

- design a 3d sea battle game to simulate pirate ships, Sloops, Schooners and Brigantines and Galleons from the periods of 1650 - 1875, multi mast ships with multiple gun power driven cannons.
- BaseballCzar is using Pixli and react next.js. The tech stack works. We do not need a database or auth system, just the sim.
- ships need colliders raycast, cannon balls, damage, Ocean Evironment.
- for dev the ships Sprites can be rectangles with circles for cannon. to start 3 cannon each side.
- We can work on the Sim first. It should have Caption controls to manage the ship and firing the canons.
- Cannons should be realist in timing since they took time to reload.
- I'm open to suggestions for the plan before building.
- the scale of the battle sea can be 2000 ft by 2000ft. The UI can be 1000 x 1000 we can adjust as needed later.

---

## recommended plan (before coding)

### 1) MVP scope (first playable)

- one playable ship (captain controls) versus 1-3 AI ships.
- world size: 2000 ft x 2000 ft.
- viewport/UI: 1000 px x 1000 px.
- visual placeholders only:
  - ship hull = rectangle
  - cannons = circles on port/starboard sides
  - cannonballs = small circles
  - ocean = animated color layers + subtle wave lines
- no database, no auth, no economy, no campaign in MVP.

### 2) coordinate system and scale

- scale: 1 ft = 0.5 px.
- world center at (0, 0), extents from -1000 to +1000 ft on both axes.
- helper transforms:
  - worldToScreen: sx = (wx + 1000) _ 0.5, sy = (1000 - wy) _ 0.5
  - screenToWorld for mouse targeting and debug tools
- keep all simulation values in feet/seconds; convert to px only when rendering.

### 3) simulation architecture (clean and testable)

- use a fixed timestep simulation loop:
  - sim tick: 60 Hz (dt = 1/60 sec)
  - render can run independently
- separate modules:
  - simulation core (pure TS): physics, combat, damage, AI
  - presentation layer (Pixi): sprites, particles, camera, UI overlays
  - input layer: captain controls and fire commands
- deterministic random generator (seeded) so battles can be replayed.

### 4) ship classes and baseline stats

Use approximate gameplay stats first, then tune:

- Sloop
  - hull HP: 800
  - max speed: 22 ft/s
  - turn rate: 0.95 deg/s
  - broadside cannons: 3 per side
  - reload: 18 s
- Schooner
  - hull HP: 1000
  - max speed: 20 ft/s
  - turn rate: 0.8 deg/s
  - broadside cannons: 3 per side
  - reload: 20 s
- Brigantine
  - hull HP: 1400
  - max speed: 18 ft/s
  - turn rate: 0.65 deg/s
  - broadside cannons: 3 per side
  - reload: 24 s
- Galleon
  - hull HP: 2200
  - max speed: 14 ft/s
  - turn rate: 0.45 deg/s
  - broadside cannons: 3 per side
  - reload: 30 s

Note: historical reloads can exceed this; these values are gameplay-friendly for MVP.

### 5) captain controls (player)

- throttle up/down: W/S
- rudder left/right: A/D
- fire port broadside: Q
- fire starboard broadside: E
- brace/repair mode (optional MVP+): R
- tactical pause (optional): Space

Control model:

- velocity changes with acceleration/deceleration, not instant speed jumps.
- rudder effectiveness scales down at very low speed.

### 6) cannon and projectile model

- each side has 3 cannon slots with independent reload timers.
- firing rules:
  - can fire only if broadside is loaded
  - target must be inside side arc (example: 40 to 140 degrees from bow for each side)
  - optional line-of-sight check with raycast
- projectile model:
  - spawn position at each cannon muzzle
  - initial speed in ft/s
  - gravity drop term (gameplay-tuned, not full ballistic realism)
  - max lifetime (example: 6 sec)
- hit effects:
  - direct hull damage
  - small chance to start mast/sail damage debuff

### 7) collisions and raycast

- ship collider for MVP: oriented rectangle (OBB).
- projectile collision:
  - broad phase: simple radius check around ship center
  - narrow phase: point-in-rotated-rect test
- raycast utility:
  - segment vs OBB for predicted impact and AI fire decision.
- keep collider math in separate utility file with unit tests.

### 8) damage and ship state

- health pools:
  - hull HP
  - sails HP (affects max speed)
  - crew efficiency (affects reload speed)
- threshold effects:
  - below 60% sails: speed penalty
  - below 40% crew efficiency: reload penalty
  - hull <= 0: sink state and debris

### 9) ocean environment (MVP and next)

MVP:

- animated normal-like wave lines
- global wind vector that modifies acceleration/speed by heading angle

MVP+:

- current zones (rectangles with flow direction)
- shallow water hazard zones

### 10) AI behavior (simple but effective)

- finite state machine:
  - approach -> broadside setup -> fire -> disengage/turn -> re-engage
- AI chooses side (port/starboard) based on angle and reload availability.
- AI avoids map edge by steering toward center when outside safe radius.

### 11) engineering milestones

- Milestone A: Core loop + one ship movement in ocean
- Milestone B: Projectile firing + reload timers + hit detection
- Milestone C: Enemy AI + win/lose conditions
- Milestone D: Damage subsystems + polish + balancing tools

### 12) testing checklist

- deterministic battle replay with same seed gives same outcomes.
- cannon reload timers never go negative or double-fire.
- projectiles despawn correctly at lifetime/world bounds.
- collisions are consistent under high frame-rate and low frame-rate.
- ship cannot leave world bounds silently.

---

## recommended folder layout for implementation

```text
Sea-Battle/
	src/
		sim/
			engine.ts
			rng.ts
			types.ts
			ship.ts
			cannon.ts
			projectile.ts
			collision.ts
			ai.ts
			ocean.ts
		render/
			pixiScene.ts
			shipView.ts
			projectileView.ts
			oceanView.ts
			hudView.ts
		input/
			controls.ts
		config/
			balance.ts
			world.ts
```

If you want, next step is I can scaffold this structure and generate a first playable prototype loop (movement + broadside fire + collisions) with placeholder art.
