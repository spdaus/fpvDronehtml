import type { ContactReport } from '../sim/collision';
import { Drone, type FlightSettings, type StickInput } from '../sim/drone';
import { mulberry32 } from '../sim/math';
import type { QuadParams } from '../sim/params';
import type { World } from '../world/world';
import { TargetGame } from './targets';

export type FlightState = 'disarmed' | 'armed' | 'crashed';

/** Throttle stick must be below this (0..1) to arm, like a real flight controller. */
export const ARM_THROTTLE_MAX = 0.05;
/** Failsafe (R1.9): hold sticks centred this long after losing the link, then disarm. */
export const FAILSAFE_HOLD_S = 0.5;

const CENTERED: StickInput = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

/**
 * One flying session: the drone, the world it collides with, the target game and the
 * DISARMED → ARMED → CRASHED state machine (design.md §10, R5, R7). Steps at the physics rate.
 */
export class GameSession {
  readonly drone: Drone;
  readonly targets: TargetGame;
  state: FlightState = 'disarmed';
  /** Seconds armed since the last reset (OSD flight timer). */
  flightTime = 0;
  /** Sim time, s. */
  time = 0;
  /** Impact speed of the crash, m/s (OSD). */
  crashImpact = 0;
  /** Sim time until which the OSD shows "THROTTLE LOW TO ARM". */
  armWarnUntil = -1;
  /** True while the input link is lost (OSD shows FAILSAFE). */
  failsafe = false;
  private failsafeTime = 0;
  private readonly report: ContactReport = { contacts: 0, maxImpact: 0 };

  constructor(
    readonly world: World,
    params: QuadParams,
    settings: FlightSettings,
    seed = (Date.now() >>> 0) || 1,
  ) {
    this.drone = new Drone(params, settings, seed);
    this.targets = new TargetGame(world.spawnVolumes, world.collision, mulberry32(seed ^ 0x9e3779b9));
    this.reset(true);
  }

  /** R5.5: back on the pad, disarmed, level, full pack, timer cleared. */
  reset(newGame = false): void {
    const s = this.world.spawn;
    const crashed = this.state === 'crashed';
    this.drone.reset(s.x, s.y, s.z, s.yaw);
    this.state = 'disarmed';
    this.flightTime = 0;
    this.crashImpact = 0;
    this.failsafe = false;
    this.failsafeTime = 0;
    if (newGame || crashed) this.targets.reset(this.time); // R7.6
  }

  /** Arm switch. Returns false (and flags the OSD warning) if the throttle isn't low. */
  toggleArm(throttleStick: number): boolean {
    if (this.state === 'armed') {
      this.drone.disarm();
      this.state = 'disarmed';
      return true;
    }
    if (this.state === 'crashed' || this.failsafe) return false;
    if (throttleStick > ARM_THROTTLE_MAX) {
      this.armWarnUntil = this.time + 1.5;
      return false;
    }
    this.drone.arm();
    this.state = 'armed';
    return true;
  }

  /** One physics step. `linkOk` is false when the controller link is lost. */
  step(input: StickInput, linkOk: boolean): void {
    const d = this.drone;
    let cmd = input;
    if (!linkOk && this.state === 'armed') {
      this.failsafe = true;
      this.failsafeTime += d.dt;
      cmd = CENTERED;
      if (this.failsafeTime >= FAILSAFE_HOLD_S) {
        d.disarm();
        this.state = 'disarmed';
      }
    } else if (linkOk) {
      this.failsafe = false;
      this.failsafeTime = 0;
    }

    d.step(cmd);
    this.world.collision.resolve(d, this.report);
    if (this.state === 'armed' && this.report.maxImpact >= d.params.crashSpeed) {
      this.state = 'crashed';
      this.crashImpact = this.report.maxImpact;
      d.disarm();
    }

    this.time += d.dt;
    if (this.state === 'armed') {
      this.flightTime += d.dt;
      this.targets.check(d.px, d.py, d.pz, d.params.collisionRadius, this.time);
    }
  }
}
