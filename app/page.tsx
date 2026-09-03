'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 620;
const FIXED_STEP = 1 / 60;
const DANGER_LINE = 528;

type Phase = 'ready' | 'playing' | 'paused' | 'wave-clear' | 'game-over';
type SoundName = 'start' | 'shot' | 'hit' | 'hurt' | 'wave' | 'bonus';
type Control = 'left' | 'right' | 'fire';

type Rect = { x: number; y: number; w: number; h: number };
type Shot = Rect & { vy: number; active: boolean; hostile: boolean; color: string };
type Enemy = Rect & {
  id: number;
  row: number;
  col: number;
  kind: number;
  alive: boolean;
};
type BarrierCell = Rect & { hp: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};
type Guardian = Rect & { vx: number; value: number; active: boolean };

type World = {
  phase: Phase;
  score: number;
  best: number;
  wave: number;
  lives: number;
  combo: number;
  comboTimer: number;
  transitionTimer: number;
  player: Rect & { invulnerable: number };
  enemies: Enemy[];
  playerShots: Shot[];
  enemyShots: Shot[];
  barriers: BarrierCell[];
  particles: Particle[];
  guardian: Guardian | null;
  guardianTimer: number;
  direction: 1 | -1;
  fireCooldown: number;
  enemyFireTimer: number;
  elapsed: number;
  shake: number;
  waveHit: boolean;
  reducedMotion: boolean;
};

type UiState = {
  phase: Phase;
  score: number;
  best: number;
  wave: number;
  lives: number;
  combo: number;
  status: string;
};

const CREATURE_COLORS = ['#ff8b4d', '#80e35a', '#a77bff', '#57d9ff', '#ff6fb1'];
const CREATURE_NAMES = ['Emberkit', 'Mossback', 'Voltwing', 'Bubblotl', 'Prismbat'];

const STARS = Array.from({ length: 118 }, (_, index) => ({
  x: (index * 83 + 29) % WORLD_WIDTH,
  y: (index * 47 + index * index * 3) % WORLD_HEIGHT,
  size: index % 11 === 0 ? 2 : 1,
  phase: (index % 9) * 0.7,
}));

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function overlaps(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function makeEnemies(wave: number): Enemy[] {
  const enemies: Enemy[] = [];
  const columns = 9;
  const startX = 146;
  const startY = 78;

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      enemies.push({
        id: row * columns + col,
        x: startX + col * 76,
        y: startY + row * 57,
        w: 48,
        h: 38,
        row,
        col,
        kind: (row + wave - 1) % CREATURE_COLORS.length,
        alive: true,
      });
    }
  }

  return enemies;
}

function makeBarriers(): BarrierCell[] {
  const cells: BarrierCell[] = [];
  const barrierStarts = [129, 349, 569, 789];

  for (const startX of barrierStarts) {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const isTopCorner = row === 0 && (col === 0 || col === 6);
        const isDoor = row >= 2 && col >= 2 && col <= 4;
        if (!isTopCorner && !isDoor) {
          cells.push({ x: startX + col * 12, y: 478 + row * 10, w: 11, h: 9, hp: 3 });
        }
      }
    }
  }

  return cells;
}

function makeWorld(best: number): World {
  return {
    phase: 'ready',
    score: 0,
    best,
    wave: 1,
    lives: 3,
    combo: 1,
    comboTimer: 0,
    transitionTimer: 0,
    player: { x: 452, y: 566, w: 56, h: 26, invulnerable: 0 },
    enemies: makeEnemies(1),
    playerShots: [],
    enemyShots: [],
    barriers: makeBarriers(),
    particles: [],
    guardian: null,
    guardianTimer: 14,
    direction: 1,
    fireCooldown: 0,
    enemyFireTimer: 1.2,
    elapsed: 0,
    shake: 0,
    waveHit: false,
    reducedMotion: false,
  };
}

function saveBest(score: number) {
  try {
    window.localStorage.setItem('critter-cosmos-best', String(score));
  } catch {
    // The game remains fully playable when storage is unavailable.
  }
}

function burst(world: World, x: number, y: number, color: string, amount = 12) {
  for (let index = 0; index < amount; index += 1) {
    const angle = (Math.PI * 2 * index) / amount + Math.random() * 0.45;
    const speed = 45 + Math.random() * 110;
    world.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.35,
      maxLife: 0.7,
      size: 2 + Math.floor(Math.random() * 4),
      color,
    });
  }
}

function updateParticles(world: World, dt: number) {
  for (const particle of world.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 115 * dt;
    particle.life -= dt;
  }
  world.particles = world.particles.filter((particle) => particle.life > 0);
}

function endGame(
  world: World,
  announce: (message?: string) => void,
  playSound: (sound: SoundName) => void,
  message: string,
) {
  if (world.phase === 'game-over') return;
  world.phase = 'game-over';
  world.lives = 0;
  world.best = Math.max(world.best, world.score);
  saveBest(world.best);
  playSound('hurt');
  announce(message);
}

function clearWave(
  world: World,
  announce: (message?: string) => void,
  playSound: (sound: SoundName) => void,
) {
  if (world.phase !== 'playing') return;
  const clearBonus = 500 * world.wave;
  const noHitBonus = world.waveHit ? 0 : 1000 * world.wave;
  world.score += clearBonus + noHitBonus;
  world.best = Math.max(world.best, world.score);
  world.phase = 'wave-clear';
  world.transitionTimer = 2.15;
  saveBest(world.best);
  playSound('wave');
  announce(
    `Wave ${world.wave} secured. ${clearBonus + noHitBonus} bonus points. Next wave incoming.`,
  );
}

function prepareNextWave(world: World) {
  world.wave += 1;
  world.phase = 'playing';
  world.enemies = makeEnemies(world.wave);
  world.playerShots = [];
  world.enemyShots = [];
  world.barriers = makeBarriers();
  world.guardian = null;
  world.guardianTimer = Math.max(10, 17 - world.wave * 0.45) + Math.random() * 7;
  world.direction = world.wave % 2 === 0 ? -1 : 1;
  world.enemyFireTimer = 0.9;
  world.fireCooldown = 0;
  world.combo = 1;
  world.comboTimer = 0;
  world.waveHit = false;
  world.player.x = 452;
  world.player.invulnerable = 1.2;
}

function scoreEnemy(
  world: World,
  enemy: Enemy,
  shot: Shot,
  announce: (message?: string) => void,
  playSound: (sound: SoundName) => void,
) {
  enemy.alive = false;
  shot.active = false;
  world.combo = world.comboTimer > 0 ? Math.min(5, world.combo + 1) : 1;
  world.comboTimer = 1.5;
  const basePoints = [30, 25, 20, 15, 10][enemy.row];
  const points = basePoints * world.combo;
  world.score += points;
  world.best = Math.max(world.best, world.score);
  saveBest(world.best);
  burst(world, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, CREATURE_COLORS[enemy.kind]);
  world.shake = world.reducedMotion ? 0 : 0.055;
  playSound('hit');
  announce(`${CREATURE_NAMES[enemy.kind]} dispersed. ${points} points.`);

  if (!world.enemies.some((candidate) => candidate.alive)) {
    clearWave(world, announce, playSound);
  }
}

function updateWorld(
  world: World,
  input: Record<Control, boolean>,
  dt: number,
  announce: (message?: string) => void,
  playSound: (sound: SoundName) => void,
) {
  world.elapsed += dt;
  world.shake = Math.max(0, world.shake - dt);
  updateParticles(world, dt);

  if (world.phase === 'wave-clear') {
    world.transitionTimer -= dt;
    if (world.transitionTimer <= 0) {
      prepareNextWave(world);
      playSound('start');
      announce(`Wave ${world.wave}. The formation is moving faster.`);
    }
    return;
  }

  if (world.phase !== 'playing') return;

  const previousComboTimer = world.comboTimer;
  world.comboTimer = Math.max(0, world.comboTimer - dt);
  if (previousComboTimer > 0 && world.comboTimer === 0 && world.combo !== 1) {
    world.combo = 1;
    announce('Combo window closed.');
  }

  world.player.invulnerable = Math.max(0, world.player.invulnerable - dt);
  const moveDirection = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  world.player.x = clamp(world.player.x + moveDirection * 380 * dt, 22, WORLD_WIDTH - 22 - world.player.w);

  world.fireCooldown = Math.max(0, world.fireCooldown - dt);
  if (input.fire && world.fireCooldown === 0 && world.playerShots.length < 4) {
    world.playerShots.push({
      x: world.player.x + world.player.w / 2 - 2,
      y: world.player.y - 13,
      w: 4,
      h: 15,
      vy: -580,
      active: true,
      hostile: false,
      color: '#b8f74b',
    });
    world.fireCooldown = 0.21;
    playSound('shot');
  }

  const survivors = world.enemies.filter((enemy) => enemy.alive);
  const removedRatio = 1 - survivors.length / world.enemies.length;
  const formationSpeed = Math.min(178, 24 + world.wave * 5.5 + removedRatio * 125);
  const formationMove = world.direction * formationSpeed * dt;

  for (const enemy of survivors) enemy.x += formationMove;

  if (survivors.length > 0) {
    const leftEdge = Math.min(...survivors.map((enemy) => enemy.x));
    const rightEdge = Math.max(...survivors.map((enemy) => enemy.x + enemy.w));
    if (leftEdge < 27 || rightEdge > WORLD_WIDTH - 27) {
      for (const enemy of survivors) {
        enemy.x -= formationMove;
        enemy.y += 20;
      }
      world.direction = world.direction === 1 ? -1 : 1;
      if (!world.reducedMotion) world.shake = 0.04;
    }

    const lowestEnemy = Math.max(...survivors.map((enemy) => enemy.y + enemy.h));
    if (lowestEnemy >= DANGER_LINE) {
      endGame(world, announce, playSound, 'The critters reached the research perimeter. Expedition over.');
      return;
    }
  }

  world.enemyFireTimer -= dt;
  const enemyShotLimit = Math.min(7, 2 + Math.floor(world.wave / 2));
  if (world.enemyFireTimer <= 0 && world.enemyShots.length < enemyShotLimit && survivors.length > 0) {
    const lowestByColumn = new Map<number, Enemy>();
    for (const enemy of survivors) {
      const current = lowestByColumn.get(enemy.col);
      if (!current || enemy.y > current.y) lowestByColumn.set(enemy.col, enemy);
    }
    const shooters = Array.from(lowestByColumn.values());
    const shooter = shooters[Math.floor(Math.random() * shooters.length)];
    world.enemyShots.push({
      x: shooter.x + shooter.w / 2 - 3,
      y: shooter.y + shooter.h,
      w: 6,
      h: 13,
      vy: 245 + world.wave * 12,
      active: true,
      hostile: true,
      color: CREATURE_COLORS[shooter.kind],
    });
    world.enemyFireTimer = Math.max(0.34, 1.22 - world.wave * 0.055) + Math.random() * 0.62;
  }

  world.guardianTimer -= dt;
  if (!world.guardian && world.guardianTimer <= 0) {
    const fromLeft = Math.random() > 0.5;
    const values = [100, 150, 300];
    world.guardian = {
      x: fromLeft ? -78 : WORLD_WIDTH + 8,
      y: 29,
      w: 70,
      h: 30,
      vx: fromLeft ? 108 : -108,
      value: values[Math.floor(Math.random() * values.length)],
      active: true,
    };
    playSound('bonus');
  }

  if (world.guardian) {
    world.guardian.x += world.guardian.vx * dt;
    if (world.guardian.x > WORLD_WIDTH + 85 || world.guardian.x < -90) {
      world.guardian = null;
      world.guardianTimer = 14 + Math.random() * 10;
    }
  }

  for (const shot of world.playerShots) shot.y += shot.vy * dt;
  for (const shot of world.enemyShots) shot.y += shot.vy * dt;

  for (const shot of world.playerShots) {
    if (!shot.active) continue;

    if (world.guardian?.active && overlaps(shot, world.guardian)) {
      shot.active = false;
      world.guardian.active = false;
      world.score += world.guardian.value;
      world.best = Math.max(world.best, world.score);
      saveBest(world.best);
      burst(
        world,
        world.guardian.x + world.guardian.w / 2,
        world.guardian.y + world.guardian.h / 2,
        '#ffd85a',
        20,
      );
      announce(`Rare comet critter tagged. ${world.guardian.value} bonus points.`);
      playSound('bonus');
      world.guardian = null;
      world.guardianTimer = 17 + Math.random() * 8;
      continue;
    }

    for (const cell of world.barriers) {
      if (cell.hp > 0 && overlaps(shot, cell)) {
        cell.hp -= 1;
        shot.active = false;
        break;
      }
    }
    if (!shot.active) continue;

    for (const enemy of world.enemies) {
      const fairHitbox = { x: enemy.x + 4, y: enemy.y + 3, w: enemy.w - 8, h: enemy.h - 6 };
      if (enemy.alive && overlaps(shot, fairHitbox)) {
        scoreEnemy(world, enemy, shot, announce, playSound);
        break;
      }
    }
  }

  for (const shot of world.enemyShots) {
    if (!shot.active) continue;
    for (const cell of world.barriers) {
      if (cell.hp > 0 && overlaps(shot, cell)) {
        cell.hp -= 1;
        shot.active = false;
        break;
      }
    }
    if (!shot.active) continue;

    const playerHitbox = {
      x: world.player.x + 8,
      y: world.player.y + 5,
      w: world.player.w - 16,
      h: world.player.h - 5,
    };
    if (world.player.invulnerable === 0 && overlaps(shot, playerHitbox)) {
      shot.active = false;
      world.lives -= 1;
      world.waveHit = true;
      world.player.invulnerable = 1.45;
      world.player.x = 452;
      world.enemyShots = [];
      world.shake = world.reducedMotion ? 0 : 0.22;
      burst(world, playerHitbox.x + playerHitbox.w / 2, playerHitbox.y, '#edfdf6', 25);
      playSound('hurt');

      if (world.lives <= 0) {
        endGame(world, announce, playSound, 'Research ship disabled. Final expedition score recorded.');
      } else {
        announce(`${world.lives} ${world.lives === 1 ? 'life' : 'lives'} remaining. Temporary shield active.`);
      }
      break;
    }
  }

  world.playerShots = world.playerShots.filter((shot) => shot.active && shot.y + shot.h > -20);
  world.enemyShots = world.enemyShots.filter(
    (shot) => shot.active && shot.y < WORLD_HEIGHT + 25,
  );

  for (const enemy of survivors) {
    for (const cell of world.barriers) {
      if (cell.hp > 0 && overlaps(enemy, cell)) cell.hp = 0;
    }
  }
}

function polygon(context: CanvasRenderingContext2D, points: number[][], color: string) {
  context.fillStyle = color;
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fill();
}

function drawCritter(context: CanvasRenderingContext2D, enemy: Enemy, time: number) {
  const bob = Math.floor(Math.sin(time * 5.4 + enemy.col * 0.7) * 2);
  const flap = Math.sin(time * 8 + enemy.row) > 0;
  context.save();
  context.translate(Math.round(enemy.x + enemy.w / 2), Math.round(enemy.y + enemy.h / 2 + bob));
  context.shadowColor = CREATURE_COLORS[enemy.kind];
  context.shadowBlur = 10;
  context.fillStyle = CREATURE_COLORS[enemy.kind];

  if (enemy.kind === 0) {
    polygon(context, [[-21, -5], [-16, -18], [-7, -11], [7, -11], [17, -18], [21, -4], [15, 14], [0, 18], [-15, 14]], CREATURE_COLORS[0]);
    polygon(context, [[19, 4], [28, -2], [25, 11], [17, 14]], '#ffca59');
    context.fillStyle = '#ffe0a3';
    context.fillRect(-11, -3, 22, 13);
  } else if (enemy.kind === 1) {
    context.fillRect(-18, -10, 36, 24);
    context.fillStyle = '#3e983f';
    context.fillRect(-12, -15, 24, 25);
    context.fillStyle = '#b8f74b';
    context.fillRect(-7, -11, 6, 6);
    context.fillRect(3, -2, 6, 6);
    polygon(context, [[-18, -6], [-28, -12], [-25, 3]], '#b8f74b');
    polygon(context, [[18, -6], [28, -12], [25, 3]], '#b8f74b');
  } else if (enemy.kind === 2) {
    polygon(context, [[-3, -5], [-25, flap ? -17 : -10], [-20, 11], [-5, 6]], CREATURE_COLORS[2]);
    polygon(context, [[3, -5], [25, flap ? -17 : -10], [20, 11], [5, 6]], CREATURE_COLORS[2]);
    context.fillStyle = '#d4c4ff';
    context.fillRect(-6, -11, 12, 27);
    polygon(context, [[-3, -12], [-10, -23], [-5, -21], [0, -14], [7, -23], [10, -20], [4, -11]], '#ffe85a');
  } else if (enemy.kind === 3) {
    context.fillRect(-16, -11, 32, 25);
    context.fillStyle = '#b9f3ff';
    context.fillRect(-10, -7, 20, 15);
    polygon(context, [[-16, -7], [-28, -14], [-24, -3], [-29, 5], [-16, 9]], CREATURE_COLORS[3]);
    polygon(context, [[16, -7], [28, -14], [24, -3], [29, 5], [16, 9]], CREATURE_COLORS[3]);
  } else {
    polygon(context, [[-4, -9], [-22, -17], [-18, 3], [-27, 12], [-8, 10], [0, 18], [8, 10], [27, 12], [18, 3], [22, -17], [4, -9]], CREATURE_COLORS[4]);
    context.fillStyle = '#ffd4e8';
    context.fillRect(-7, -5, 14, 12);
  }

  context.shadowBlur = 0;
  context.fillStyle = '#061012';
  context.fillRect(-10, -3, 4, 5);
  context.fillRect(6, -3, 4, 5);
  context.fillRect(-3, 6, 6, 3);
  context.restore();
}

function drawPlayer(context: CanvasRenderingContext2D, world: World, time: number) {
  if (world.player.invulnerable > 0 && Math.floor(time * 12) % 2 === 0) return;
  const player = world.player;
  context.save();
  context.translate(Math.round(player.x), Math.round(player.y));
  context.shadowColor = '#edfdf6';
  context.shadowBlur = world.player.invulnerable > 0 ? 22 : 9;
  polygon(context, [[0, 26], [7, 13], [20, 13], [24, 4], [32, 4], [36, 13], [49, 13], [56, 26]], '#edfdf6');
  context.fillStyle = '#4df4bd';
  context.fillRect(24, 11, 8, 7);
  context.fillStyle = Math.sin(time * 22) > 0 ? '#b8f74b' : '#57d9ff';
  context.fillRect(12, 26, 8, 5);
  context.fillRect(36, 26, 8, 5);
  context.restore();
}

function drawGuardian(context: CanvasRenderingContext2D, guardian: Guardian, time: number) {
  context.save();
  context.translate(Math.round(guardian.x), Math.round(guardian.y));
  context.shadowColor = '#ffd85a';
  context.shadowBlur = 14 + Math.sin(time * 8) * 3;
  polygon(context, [[0, 16], [13, 3], [26, 8], [35, 0], [44, 8], [58, 3], [70, 16], [56, 28], [14, 28]], '#ffd85a');
  context.fillStyle = '#fff2ac';
  context.fillRect(25, 10, 20, 10);
  context.fillStyle = '#091315';
  context.fillRect(28, 12, 4, 4);
  context.fillRect(38, 12, 4, 4);
  context.restore();
}

function drawWorld(context: CanvasRenderingContext2D, world: World, time: number) {
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const sky = context.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  sky.addColorStop(0, '#0a1b1c');
  sky.addColorStop(0.55, '#071012');
  sky.addColorStop(1, '#030708');
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  for (const star of STARS) {
    const alpha = 0.28 + (Math.sin(time * 1.8 + star.phase) + 1) * 0.19;
    context.fillStyle = `rgba(207, 255, 239, ${alpha})`;
    context.fillRect(star.x, star.y, star.size, star.size);
  }

  context.save();
  if (world.shake > 0 && !world.reducedMotion) {
    context.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5);
  }

  context.setLineDash([7, 9]);
  context.strokeStyle = 'rgba(255, 139, 77, .38)';
  context.beginPath();
  context.moveTo(28, DANGER_LINE);
  context.lineTo(WORLD_WIDTH - 28, DANGER_LINE);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(255, 139, 77, .5)';
  context.font = '9px monospace';
  context.textAlign = 'right';
  context.fillText('DEFENSE PERIMETER', WORLD_WIDTH - 29, DANGER_LINE - 8);

  for (const cell of world.barriers) {
    if (cell.hp === 0) continue;
    context.fillStyle = cell.hp === 3 ? '#4df4bd' : cell.hp === 2 ? '#36b997' : '#23705f';
    context.shadowColor = '#4df4bd';
    context.shadowBlur = cell.hp === 3 ? 5 : 0;
    context.fillRect(cell.x, cell.y, cell.w, cell.h);
  }
  context.shadowBlur = 0;

  for (const enemy of world.enemies) {
    if (enemy.alive) drawCritter(context, enemy, time);
  }
  if (world.guardian) drawGuardian(context, world.guardian, time);

  for (const shot of world.playerShots) {
    context.shadowColor = shot.color;
    context.shadowBlur = 12;
    context.fillStyle = shot.color;
    context.fillRect(Math.round(shot.x), Math.round(shot.y), shot.w, shot.h);
  }
  for (const shot of world.enemyShots) {
    context.shadowColor = shot.color;
    context.shadowBlur = 10;
    context.fillStyle = shot.color;
    context.fillRect(Math.round(shot.x), Math.round(shot.y), shot.w, shot.h);
    context.fillStyle = '#fff';
    context.fillRect(Math.round(shot.x + 2), Math.round(shot.y + 3), 2, 4);
  }
  context.shadowBlur = 0;

  drawPlayer(context, world, time);

  for (const particle of world.particles) {
    context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
    context.fillStyle = particle.color;
    context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
  }
  context.globalAlpha = 1;
  context.restore();
}

function formatScore(score: number) {
  return score.toString().padStart(6, '0');
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const inputRef = useRef<Record<Control, boolean>>({ left: false, right: false, fire: false });
  const audioRef = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const mutedRef = useRef(false);
  const draggingRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [ui, setUi] = useState<UiState>({
    phase: 'ready',
    score: 0,
    best: 0,
    wave: 1,
    lives: 3,
    combo: 1,
    status: 'Incoming creatures detected. Start the expedition when ready.',
  });

  const syncUi = useCallback((message?: string) => {
    const world = worldRef.current;
    if (!world) return;
    setUi((current) => ({
      phase: world.phase,
      score: world.score,
      best: world.best,
      wave: world.wave,
      lives: world.lives,
      combo: world.combo,
      status: message ?? current.status,
    }));
  }, []);

  const playSound = useCallback((name: SoundName) => {
    if (mutedRef.current || typeof window === 'undefined') return;
    const AudioConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioConstructor) return;

    if (!audioRef.current) {
      const context = new AudioConstructor();
      const gain = context.createGain();
      gain.gain.value = 0.12;
      gain.connect(context.destination);
      audioRef.current = { context, gain };
    }

    const { context, gain } = audioRef.current;
    if (context.state === 'suspended') void context.resume();
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const now = context.currentTime;
    const settings: Record<SoundName, [number, number, OscillatorType, number]> = {
      start: [220, 520, 'square', 0.24],
      shot: [620, 310, 'square', 0.075],
      hit: [180, 72, 'sawtooth', 0.13],
      hurt: [125, 45, 'sawtooth', 0.36],
      wave: [330, 740, 'triangle', 0.42],
      bonus: [510, 920, 'triangle', 0.2],
    };
    const [startFrequency, endFrequency, type, duration] = settings[name];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.exponentialRampToValueAtTime(name === 'shot' ? 0.45 : 0.75, now + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }, []);

  const startGame = useCallback(() => {
    const currentBest = worldRef.current?.best ?? 0;
    const nextWorld = makeWorld(currentBest);
    nextWorld.phase = 'playing';
    nextWorld.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    worldRef.current = nextWorld;
    inputRef.current = { left: false, right: false, fire: false };
    playSound('start');
    syncUi('Wave 1 started. Move with arrows or A and D. Fire with Space.');
    window.setTimeout(() => canvasRef.current?.focus(), 0);
  }, [playSound, syncUi]);

  const togglePause = useCallback(() => {
    const world = worldRef.current;
    if (!world || (world.phase !== 'playing' && world.phase !== 'paused')) return;
    world.phase = world.phase === 'playing' ? 'paused' : 'playing';
    inputRef.current = { left: false, right: false, fire: false };
    syncUi(world.phase === 'paused' ? 'Expedition paused.' : 'Expedition resumed.');
    if (world.phase === 'playing') canvasRef.current?.focus();
  }, [syncUi]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      try {
        window.localStorage.setItem('critter-cosmos-muted', next ? '1' : '0');
      } catch {
        // Preference storage is optional.
      }
      if (!next) window.setTimeout(() => playSound('start'), 0);
      return next;
    });
  }, [playSound]);

  useEffect(() => {
    let savedBest = 0;
    let savedMuted = false;
    try {
      savedBest = Number(window.localStorage.getItem('critter-cosmos-best')) || 0;
      savedMuted = window.localStorage.getItem('critter-cosmos-muted') === '1';
    } catch {
      // Local preferences are a progressive enhancement.
    }

    mutedRef.current = savedMuted;
    window.queueMicrotask(() => setMuted(savedMuted));
    const world = makeWorld(savedBest);
    world.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    worldRef.current = world;
    syncUi();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let dpr = 1;
    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = WORLD_WIDTH * dpr;
      canvas.height = WORLD_HEIGHT * dpr;
      canvas.style.aspectRatio = `${WORLD_WIDTH} / ${WORLD_HEIGHT}`;
    };
    sizeCanvas();

    let animationFrame = 0;
    let previousTime = performance.now();
    let accumulator = 0;

    const frame = (time: number) => {
      const activeWorld = worldRef.current;
      if (!activeWorld) return;
      const elapsed = Math.min(0.1, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      accumulator += elapsed;
      while (accumulator >= FIXED_STEP) {
        updateWorld(activeWorld, inputRef.current, FIXED_STEP, syncUi, playSound);
        accumulator -= FIXED_STEP;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      drawWorld(context, activeWorld, time / 1000);
      animationFrame = window.requestAnimationFrame(frame);
    };
    animationFrame = window.requestAnimationFrame(frame);

    const gameKeys = new Set([
      'ArrowLeft',
      'ArrowRight',
      'KeyA',
      'KeyD',
      'Space',
      'KeyP',
      'Escape',
      'Enter',
    ]);
    const onKeyDown = (event: KeyboardEvent) => {
      const activeWorld = worldRef.current;
      if (!activeWorld || !gameKeys.has(event.code)) return;
      if (activeWorld.phase !== 'ready' || event.code === 'Enter') event.preventDefault();

      if (event.code === 'Enter' && (activeWorld.phase === 'ready' || activeWorld.phase === 'game-over')) {
        startGame();
        return;
      }
      if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) {
        togglePause();
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') inputRef.current.left = true;
      if (event.code === 'ArrowRight' || event.code === 'KeyD') inputRef.current.right = true;
      if (event.code === 'Space') inputRef.current.fire = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') inputRef.current.left = false;
      if (event.code === 'ArrowRight' || event.code === 'KeyD') inputRef.current.right = false;
      if (event.code === 'Space') inputRef.current.fire = false;
    };
    const pauseForBackground = () => {
      const activeWorld = worldRef.current;
      inputRef.current = { left: false, right: false, fire: false };
      if (activeWorld?.phase === 'playing') {
        activeWorld.phase = 'paused';
        syncUi('Expedition paused while the window was inactive.');
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) pauseForBackground();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', pauseForBackground);
    window.addEventListener('resize', sizeCanvas);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', pauseForBackground);
      window.removeEventListener('resize', sizeCanvas);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (audioRef.current) void audioRef.current.context.close();
      audioRef.current = null;
    };
  }, [playSound, startGame, syncUi, togglePause]);

  const setControl = useCallback((control: Control, pressed: boolean) => {
    inputRef.current[control] = pressed;
  }, []);

  const pressControl =
    (control: Control) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setControl(control, true);
    };

  const releaseControl =
    (control: Control) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setControl(control, false);
    };

  const positionPlayerFromPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    const canvas = canvasRef.current;
    if (!world || !canvas || world.phase !== 'playing') return;
    const bounds = canvas.getBoundingClientRect();
    const worldX = ((event.clientX - bounds.left) / bounds.width) * WORLD_WIDTH;
    world.player.x = clamp(worldX - world.player.w / 2, 22, WORLD_WIDTH - 22 - world.player.w);
  }, []);

  const handleCanvasDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (worldRef.current?.phase !== 'playing') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    positionPlayerFromPointer(event);
    inputRef.current.fire = true;
  };

  const handleCanvasMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) positionPlayerFromPointer(event);
  };

  const handleCanvasUp = () => {
    draggingRef.current = false;
    inputRef.current.fire = false;
  };

  return (
    <main className="arcade-shell">
      <header className="game-header">
        <a className="brand" href="#game" aria-label="Critter Cosmos game">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <span>Critter Cosmos</span>
        </a>
        <p>Field Log {String(ui.wave).padStart(3, '0')} <span aria-hidden="true">•</span> Deep Space</p>
        <div className="header-actions">
          <button
            className="text-button"
            type="button"
            onClick={togglePause}
            disabled={ui.phase !== 'playing' && ui.phase !== 'paused'}
          >
            {ui.phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Turn sound on' : 'Mute sound'}
            aria-pressed={muted}
          >
            <span aria-hidden="true">{muted ? '×' : '♪'}</span>
          </button>
        </div>
      </header>

      <section className="game-wrap" id="game" aria-labelledby="game-title">
        <div className="game-kicker">
          <span><i /> Live expedition</span>
          <span>Best {formatScore(ui.best)}</span>
        </div>

        <div className="score-strip" aria-label="Current game statistics">
          <div>
            <span>Score</span>
            <strong>{formatScore(ui.score)}</strong>
          </div>
          <h1 id="game-title">Wave <span>{String(ui.wave).padStart(2, '0')}</span></h1>
          <div className="lives">
            <span>Research ships</span>
            <strong aria-label={`${ui.lives} lives remaining`}>
              {[0, 1, 2].map((life) => (
                <i className={life < ui.lives ? 'life-active' : ''} key={life} />
              ))}
            </strong>
          </div>
        </div>

        <div className={`game-frame phase-${ui.phase}`}>
          <canvas
            ref={canvasRef}
            className="game-canvas"
            width={WORLD_WIDTH}
            height={WORLD_HEIGHT}
            tabIndex={0}
            aria-label="Critter Cosmos playfield. Move left and right and fire upward to stop the descending creature formation."
            onPointerDown={handleCanvasDown}
            onPointerMove={handleCanvasMove}
            onPointerUp={handleCanvasUp}
            onPointerCancel={handleCanvasUp}
          />
          <div className="scanlines" aria-hidden="true" />

          {ui.combo > 1 && ui.phase === 'playing' && (
            <div className="combo-pill" aria-label={`${ui.combo} times score combo`}>
              Chain <strong>×{ui.combo}</strong>
            </div>
          )}

          {ui.phase === 'ready' && (
            <div className="intro-card state-card">
              <span className="tiny-label"><i /> Incoming signal</span>
              <h2>Curious.<br />Colorful.<br /><em>Descending.</em></h2>
              <p>Defend the research outpost from five rows of wild cosmic critters.</p>
              <button type="button" className="play-button" onClick={startGame}>
                <span>Start expedition</span><kbd>Enter</kbd>
              </button>
              <div className="card-meta"><span>3 ships</span><span>Endless waves</span><span>Best saved locally</span></div>
            </div>
          )}

          {ui.phase === 'paused' && (
            <div className="pause-card state-card compact-card">
              <span className="tiny-label">Field log suspended</span>
              <h2>Paused</h2>
              <p>The formation is holding. Your score is safe.</p>
              <div className="button-pair">
                <button type="button" className="play-button" onClick={togglePause}>Resume</button>
                <button type="button" className="secondary-button" onClick={startGame}>Restart</button>
              </div>
            </div>
          )}

          {ui.phase === 'wave-clear' && (
            <div className="wave-card" role="status">
              <span>Perimeter secure</span>
              <strong>Wave {String(ui.wave).padStart(2, '0')} cleared</strong>
              <i />
              <small>Cataloging specimens...</small>
            </div>
          )}

          {ui.phase === 'game-over' && (
            <div className="game-over-card state-card compact-card">
              <span className="tiny-label">Final field report</span>
              <h2>Expedition<br /><em>complete.</em></h2>
              <div className="final-score"><span>Score</span><strong>{formatScore(ui.score)}</strong></div>
              <p>Wave {ui.wave} reached <span aria-hidden="true">•</span> Best {formatScore(ui.best)}</p>
              <button type="button" className="play-button" onClick={startGame}>
                <span>New expedition</span><kbd>Enter</kbd>
              </button>
            </div>
          )}
        </div>

        <div className="touch-controls" aria-label="Touch game controls">
          <div className="touch-move">
            <button
              type="button"
              aria-label="Move left"
              onPointerDown={pressControl('left')}
              onPointerUp={releaseControl('left')}
              onPointerCancel={releaseControl('left')}
              onLostPointerCapture={() => setControl('left', false)}
            >←</button>
            <button
              type="button"
              aria-label="Move right"
              onPointerDown={pressControl('right')}
              onPointerUp={releaseControl('right')}
              onPointerCancel={releaseControl('right')}
              onLostPointerCapture={() => setControl('right', false)}
            >→</button>
          </div>
          <button
            type="button"
            className="touch-fire"
            aria-label="Fire pulse"
            onPointerDown={pressControl('fire')}
            onPointerUp={releaseControl('fire')}
            onPointerCancel={releaseControl('fire')}
            onLostPointerCapture={() => setControl('fire', false)}
          >Pulse</button>
        </div>

        <div className="game-bottom-bar">
          <div className="controls-row" aria-label="Keyboard controls">
            <p><kbd>A</kbd><kbd>D</kbd><span>Move</span></p>
            <p><kbd>Space</kbd><span>Pulse</span></p>
            <p><kbd>P</kbd><span>Pause</span></p>
          </div>
          <div className="field-note">
            <span>Field note</span>
            <p>Only the lowest critter in each column can launch an attack.</p>
          </div>
        </div>

        <p className="sr-status" role="status" aria-live="polite" aria-atomic="true">{ui.status}</p>
      </section>

      <section className="specimen-strip" aria-label="Creature field guide">
        <div className="specimen-intro">
          <span>Stellar Ecology Unit</span>
          <strong>Known cosmic critters</strong>
        </div>
        {CREATURE_NAMES.slice(0, 4).map((name, index) => (
          <div className="specimen" key={name}>
            <i style={{ '--specimen-color': CREATURE_COLORS[index] } as CSSProperties} />
            <span>{name}</span>
            <small>{['Ember', 'Canopy', 'Storm', 'Tide'][index]} class</small>
          </div>
        ))}
      </section>

      <footer>
        <span>© 2084 Stellar Ecology Unit</span>
        <span>Original creature designs. Not affiliated with Pokémon or Nintendo.</span>
      </footer>
    </main>
  );
}
