import { describe, expect, it } from 'vitest';
import { cellOcv } from '../src/sim/battery';
import { Drone, PHYSICS_DT } from '../src/sim/drone';
import { FREESTYLE_5 } from '../src/sim/params';
import { CENTER, hoveringDrone, run, setAttitude, stick } from './helpers';

function sumThrust(d: Drone): number {
  return d.thrust[0] + d.thrust[1] + d.thrust[2] + d.thrust[3];
}

/** A disarmed quad with motors forced to `w`, stepped once so thrust[] reflects the given state. */
function probeThrust(setup: (d: Drone) => void, w = 0.8): number {
  const d = new Drone(FREESTYLE_5);
  d.reset(0, 50, 0, 0);
  setup(d);
  d.motor.fill(w);
  d.step(CENTER);
  return sumThrust(d);
}

describe('fixed step and determinism', () => {
  it('R4.1 physics step is 1 ms', () => {
    expect(PHYSICS_DT).toBe(0.001);
    expect(new Drone(FREESTYLE_5).dt).toBe(0.001);
  });

  it('R4.2 identical inputs give bit-identical state (incl. prop-wash noise)', () => {
    const script = (d: Drone) => {
      run(d, stick({ throttle: 0.9, roll: 0.4 }), 0.5);
      run(d, stick({ throttle: 0.05 }), 1.5); // drop into own wash
      run(d, stick({ throttle: 0.8, pitch: -0.3, yaw: 0.2 }), 1.0);
    };
    const a = hoveringDrone(42);
    const b = hoveringDrone(42);
    script(a);
    script(b);
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'qw', 'qx', 'qy', 'qz', 'wx', 'wy', 'wz', 'soc'] as const) {
      expect(a[k]).toBe(b[k]);
    }
    expect([...a.motor]).toEqual([...b.motor]);
  });
});

describe('airframe', () => {
  it('R4.3 5" freestyle defaults: ~650 g, TWR ~8:1, 6S', () => {
    const p = FREESTYLE_5;
    expect(p.mass).toBeCloseTo(0.65, 2);
    const twr = (4 * p.thrustMax) / (p.mass * 9.81);
    expect(twr).toBeGreaterThan(7.5);
    expect(twr).toBeLessThan(8.5);
    expect(p.battery.cells).toBe(6);
  });
});

describe('motors', () => {
  it('R4.7 first-order lag: spin-up τ ≈ 30 ms, spin-down τ ≈ 50 ms', () => {
    const tau = (from: number, to: number) => {
      const d = new Drone(FREESTYLE_5);
      d.reset(0, 50, 0, 0);
      d.arm();
      d.motor.fill(from);
      // Hold the command fixed by overriding the controller output each step via throttle stick.
      const thr = to;
      const target = FREESTYLE_5.idle + (1 - FREESTYLE_5.idle) * thr;
      let t63 = -1;
      run(d, stick({ throttle: thr === 1 ? 1 : 0 }), 0.3, (dd, t) => {
        const v = dd.voltage / (6 * 4.2);
        const goal = target * v;
        if (t63 < 0 && Math.abs(dd.motor[0] - from) >= 0.632 * Math.abs(goal - from)) t63 = t;
      });
      return t63;
    };
    const up = tau(0.35, 1);
    const down = tau(0.9, 0);
    expect(up).toBeGreaterThan(0.024);
    expect(up).toBeLessThan(0.036);
    expect(down).toBeGreaterThan(0.04);
    expect(down).toBeLessThan(0.06);
  });

  it('R4.7 thrust ∝ ω²', () => {
    const t1 = probeThrust(() => {}, 0.4);
    const t2 = probeThrust(() => {}, 0.8);
    expect(t2 / t1).toBeGreaterThan(3.6);
    expect(t2 / t1).toBeLessThan(4.4);
  });

  it('R4.10 motor spin-up adds a transient yaw torque on top of drag torque', () => {
    const d = hoveringDrone();
    // Full yaw right: CCW motors speed up. Early yaw acceleration (rotor inertia) is well above
    // what the steady prop-drag torque alone could give.
    let peak = 0;
    run(d, stick({ yaw: 1 }), 0.01, (dd) => {
      peak = Math.max(peak, -dd.wy);
    });
    expect(d.wy).toBeLessThan(0); // yaw right
    const steadyOnly = (4 * FREESTYLE_5.torqueRatio * FREESTYLE_5.thrustMax * 0.5) / FREESTYLE_5.inertia.y; // generous
    expect(peak / 0.01).toBeGreaterThan(steadyOnly * 0.5);
  });

  it('R4.10 a throttle punch gives a small yaw kick that the controller corrects', () => {
    const d = hoveringDrone();
    let maxYaw = 0;
    run(d, stick({ throttle: 1 }), 0.3, (dd) => {
      maxYaw = Math.max(maxYaw, Math.abs(dd.wy));
    });
    run(d, stick({ throttle: 1 }), 0.7);
    expect(maxYaw).toBeGreaterThan(0.001);
    expect(maxYaw).toBeLessThan(0.5);
    expect(Math.abs(d.wy)).toBeLessThan(0.05);
  });
});

describe('aerodynamics', () => {
  it('R4.8 thrust falls with axial inflow', () => {
    const still = probeThrust(() => {});
    const climbing = probeThrust((d) => { d.vy = 20; });
    expect(climbing).toBeLessThan(still * 0.8);
    expect(climbing).toBeGreaterThan(still * 0.4);
  });

  it('R4.9 full-throttle sprint top speed is 35–50 m/s', () => {
    const d = new Drone(FREESTYLE_5);
    d.reset(0, 100, 0, 0);
    d.arm();
    run(d, stick({ throttle: 1 }), 8, (dd) => {
      setAttitude(dd, 1, 0, 0, -70 * (Math.PI / 180)); // nose down 70°, locked
      dd.wx = dd.wy = dd.wz = 0;
    });
    const horiz = Math.hypot(d.vx, d.vz);
    expect(horiz).toBeGreaterThan(35);
    expect(horiz).toBeLessThan(50);
    expect(Math.abs(d.vy)).toBeLessThan(10);
  });

  it('R4.9 drag is quadratic and larger through the top face than the front', () => {
    const decel = (setup: (d: Drone) => void) => {
      const d = new Drone(FREESTYLE_5);
      d.reset(0, 50, 0, 0);
      setup(d);
      d.step(CENTER);
      return Math.hypot(d.ax, d.ay + 9.81, d.az);
    };
    const front10 = decel((d) => { d.vz = -10; });
    const front20 = decel((d) => { d.vz = -20; });
    const top20 = decel((d) => { d.vy = -20; });
    expect(front20 / front10).toBeGreaterThan(3.8);
    expect(front20 / front10).toBeLessThan(4.2);
    expect(top20).toBeGreaterThan(front20);
  });

  it('R4.13 ground effect adds a little thrust near the ground', () => {
    const high = probeThrust((d) => { d.py = 5; });
    const low = probeThrust((d) => { d.py = 0.1; });
    expect(low).toBeGreaterThan(high * 1.01);
    expect(low).toBeLessThan(high * 1.1);
  });
});

describe('prop wash', () => {
  const gyroNoise = (descent: number) => {
    const d = hoveringDrone(7);
    let sumSq = 0;
    let n = 0;
    let sev = 0;
    run(d, stick({ throttle: 0.75 }), 0.6, (dd) => {
      dd.vx = 0; dd.vz = 0; dd.vy = -descent; // hold the descent condition
      sev = Math.max(sev, dd.washSeverity);
      sumSq += dd.wx * dd.wx + dd.wz * dd.wz;
      n++;
    });
    return { rms: Math.sqrt(sumSq / n), sev, thrust: sumThrust(d) };
  };

  it('R4.11 descending into own wash shakes the quad and costs thrust', () => {
    const wash = gyroNoise(6);
    const calm = gyroNoise(0.5);
    expect(wash.sev).toBeGreaterThan(0.5);
    expect(calm.sev).toBe(0);
    expect(wash.rms).toBeGreaterThan(calm.rms * 5);
    expect(wash.rms).toBeGreaterThan(0.05);
  });

  it('R4.11 no wash with fast horizontal flight', () => {
    const d = hoveringDrone();
    let sev = 0;
    run(d, stick({ throttle: 0.75 }), 0.2, (dd) => {
      dd.vy = -6; dd.vz = -15;
      sev = Math.max(sev, dd.washSeverity);
    });
    expect(sev).toBe(0);
  });
});

describe('battery', () => {
  it('R4.12 open-circuit voltage falls with charge used', () => {
    let prev = cellOcv(0);
    for (let s = 0.01; s <= 1; s += 0.01) {
      expect(cellOcv(s)).toBeGreaterThanOrEqual(prev);
      prev = cellOcv(s);
    }
    expect(cellOcv(1)).toBeCloseTo(4.2, 6);
  });

  it('R4.12 voltage sags under load, charge is consumed, reset restores a full pack', () => {
    const d = hoveringDrone();
    const vHover = d.voltage;
    run(d, stick({ throttle: 1 }), 0.3);
    const vPunch = d.voltage;
    expect(vPunch).toBeLessThan(vHover - 1.5);
    expect(d.current).toBeGreaterThan(80);
    const soc = d.soc;
    run(d, stick({ throttle: 1 }), 5);
    expect(d.soc).toBeLessThan(soc);
    expect(d.mAhUsed).toBeGreaterThan(100);
    d.reset(0, 1, 0, 0);
    expect(d.soc).toBe(1);
    expect(d.mAhUsed).toBe(0);
  });

  it('R4.12 hover draws a realistic ~8–12 A', () => {
    const d = hoveringDrone();
    expect(d.current).toBeGreaterThan(7);
    expect(d.current).toBeLessThan(13);
  });
});
