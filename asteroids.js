const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startupScreenEl = document.getElementById("startup-screen");
const startupNameEl = document.getElementById("startup-name");
const startupControlsEl = document.getElementById("startup-controls");
const startupPlayEl = document.getElementById("startup-play");

const CTA_SECTIONS = [
  { id: "projects", label: "Projects", href: "./projects.html" },
  { id: "art", label: "Art", href: "./art.html" },
  { id: "swimming", label: "Swimming", href: "./swimming.html" },
  { id: "food", label: "Food", href: "./food.html" },
  { id: "about-me", label: "About me", href: "./about-me.html" },
];

const config = {
  rotationSpeed: 0.065,
  thrustPower: 0.16,
  drag: 0.992,
  bulletSpeed: 9.4,
  bulletLifetimeMs: 1250,
  shotCooldownMs: 145,
  shipRadius: 13,
  starCount: 220,
  fillerAsteroidCount: 18,
  minAsteroidRadius: 18,
  maxAsteroidRadius: 58,
};

const state = {
  stars: [],
  bullets: [],
  asteroids: [],
  particles: [],
  keys: new Set(),
  previousFrame: performance.now(),
  navigating: false,
  booting: true,
  startupReady: false,
  navigationTimeoutId: null,
  flash: 0,
  shake: 0,
  shakeX: 0,
  shakeY: 0,
  shipRespawnLockMs: 0,
  lastShotAt: 0,
};

const ship = {
  x: 0,
  y: 0,
  prevX: 0,
  prevY: 0,
  vx: 0,
  vy: 0,
  rotation: -Math.PI / 2,
  radius: config.shipRadius,
};

let asteroidId = 0;

const audio = {
  initialized: false,
  ctx: null,
  compressor: null,
  thrustGain: null,
  thrustOsc: null,
  thrustLfoOsc: null,
  thrustLfoGain: null,
};

function setStatusMessage(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowMs() {
  return performance.now();
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (ship.x === 0 && ship.y === 0) {
    ship.x = canvas.width / 2;
    ship.y = canvas.height / 2;
  }
}

function seedStars() {
  state.stars = [];
  for (let i = 0; i < config.starCount; i += 1) {
    state.stars.push({
      x: random(0, canvas.width),
      y: random(0, canvas.height),
      size: random(0.45, 2.2),
      alpha: random(0.12, 0.92),
      pulse: random(0.002, 0.012),
    });
  }
}

function createAsteroid(options) {
  const {
    x = random(0, canvas.width),
    y = random(0, canvas.height),
    radius = random(24, config.maxAsteroidRadius),
    vx = random(-1.4, 1.4),
    vy = random(-1.4, 1.4),
    spin = random(-0.018, 0.018),
    isCta = false,
    label = "",
    href = "",
    generation = 0,
  } = options;

  return {
    id: `asteroid-${(asteroidId += 1)}`,
    x,
    y,
    prevX: x,
    prevY: y,
    vx,
    vy,
    radius,
    spin,
    rotation: random(0, Math.PI * 2),
    roughness: Array.from({ length: 12 }, () => random(0.78, 1.17)),
    isCta,
    label,
    href,
    generation,
    alive: true,
  };
}

function spawnInitialAsteroids() {
  state.asteroids = [];
  const margin = 90;

  CTA_SECTIONS.forEach((section, index) => {
    const spreadX = (canvas.width - margin * 2) / Math.max(1, CTA_SECTIONS.length - 1);
    const baseX = margin + spreadX * index;
    const baseY = random(margin, canvas.height - margin);
    const angle = random(0, Math.PI * 2);
    const speed = random(0.5, 1.2);

    state.asteroids.push(
      createAsteroid({
        x: clamp(baseX + random(-70, 70), margin, canvas.width - margin),
        y: baseY,
        radius: random(40, 56),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        isCta: true,
        label: section.label,
        href: section.href,
      })
    );
  });

  for (let i = 0; i < config.fillerAsteroidCount; i += 1) {
    const angle = random(0, Math.PI * 2);
    const speed = random(0.45, 1.6);
    state.asteroids.push(
      createAsteroid({
        radius: random(20, 48),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      })
    );
  }
}

function wrapPosition(body) {
  const r = body.radius;
  if (body.x < -r) body.x = canvas.width + r;
  if (body.x > canvas.width + r) body.x = -r;
  if (body.y < -r) body.y = canvas.height + r;
  if (body.y > canvas.height + r) body.y = -r;
}

function segmentHitsCircle(x0, y0, x1, y1, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const a = dx * dx + dy * dy;

  if (a === 0) {
    return x0 * x0 + y0 * y0 <= radius * radius;
  }

  const b = 2 * (x0 * dx + y0 * dy);
  const c = x0 * x0 + y0 * y0 - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDiscriminant) / (2 * a);
  const t2 = (-b + sqrtDiscriminant) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

function movedThroughWrap(prevX, prevY, x, y) {
  return (
    Math.abs(x - prevX) > canvas.width * 0.5 ||
    Math.abs(y - prevY) > canvas.height * 0.5
  );
}

function initAudio() {
  if (audio.initialized) {
    if (audio.ctx.state === "suspended") {
      audio.ctx.resume();
    }
    return;
  }

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  const ctxAudio = new AC();
  const compressor = ctxAudio.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 9;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.22;

  const master = ctxAudio.createGain();
  master.gain.value = 0.34;
  compressor.connect(master);
  master.connect(ctxAudio.destination);

  const thrustOsc = ctxAudio.createOscillator();
  thrustOsc.type = "sawtooth";
  thrustOsc.frequency.value = 62;

  const thrustGain = ctxAudio.createGain();
  thrustGain.gain.value = 0.0001;
  thrustOsc.connect(thrustGain);
  thrustGain.connect(compressor);

  const thrustLfoOsc = ctxAudio.createOscillator();
  thrustLfoOsc.type = "triangle";
  thrustLfoOsc.frequency.value = 18;

  const thrustLfoGain = ctxAudio.createGain();
  thrustLfoGain.gain.value = 10;
  thrustLfoOsc.connect(thrustLfoGain);
  thrustLfoGain.connect(thrustOsc.frequency);

  thrustOsc.start();
  thrustLfoOsc.start();

  audio.initialized = true;
  audio.ctx = ctxAudio;
  audio.compressor = compressor;
  audio.thrustGain = thrustGain;
  audio.thrustOsc = thrustOsc;
  audio.thrustLfoOsc = thrustLfoOsc;
  audio.thrustLfoGain = thrustLfoGain;
}

function playTone({
  type = "square",
  frequency = 240,
  frequencyEnd = 120,
  duration = 0.12,
  attack = 0.004,
  release = 0.09,
  volume = 0.15,
}) {
  if (!audio.initialized || audio.ctx.state !== "running") return;

  const t = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequencyEnd), t + duration);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration + release);

  osc.connect(gain);
  gain.connect(audio.compressor);
  osc.start(t);
  osc.stop(t + duration + release + 0.02);
}

function playNoiseBurst(duration = 0.16, volume = 0.18) {
  if (!audio.initialized || audio.ctx.state !== "running") return;

  const sampleRate = audio.ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const noiseBuffer = audio.ctx.createBuffer(1, frameCount, sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
  }

  const source = audio.ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = random(460, 1600);
  filter.Q.value = 1;

  const gain = audio.ctx.createGain();
  const t = audio.ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.009);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.04);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.compressor);
  source.start(t);
  source.stop(t + duration + 0.06);
}

function playShotSfx() {
  playTone({
    type: "square",
    frequency: random(750, 930),
    frequencyEnd: random(190, 250),
    duration: 0.08,
    volume: 0.16,
    release: 0.06,
  });
}

function playExplosionSfx() {
  playTone({
    type: "triangle",
    frequency: random(300, 420),
    frequencyEnd: random(48, 70),
    duration: 0.35,
    volume: 0.22,
    release: 0.16,
  });
  playTone({
    type: "sawtooth",
    frequency: random(180, 250),
    frequencyEnd: random(35, 55),
    duration: 0.28,
    volume: 0.14,
    release: 0.14,
  });
  playNoiseBurst(0.22, 0.2);
}

function updateThrustAudio() {
  if (!audio.initialized || audio.ctx.state !== "running") return;
  const t = audio.ctx.currentTime;
  const thrusting = state.keys.has("ArrowUp");
  audio.thrustGain.gain.cancelScheduledValues(t);
  audio.thrustGain.gain.setTargetAtTime(thrusting ? 0.085 : 0.0001, t, 0.03);
  audio.thrustOsc.frequency.cancelScheduledValues(t);
  audio.thrustOsc.frequency.setTargetAtTime(thrusting ? 76 : 60, t, 0.045);
}

function drawStars() {
  state.stars.forEach((star) => {
    star.alpha += star.pulse;
    if (star.alpha > 0.95 || star.alpha < 0.1) {
      star.pulse *= -1;
    }
    ctx.fillStyle = `rgba(195, 230, 255, ${star.alpha.toFixed(2)})`;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  });
}

function drawShip() {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.rotation);
  ctx.strokeStyle = "#9df8ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ship.radius + 8, 0);
  ctx.lineTo(-ship.radius, ship.radius * 0.85);
  ctx.lineTo(-ship.radius * 0.7, 0);
  ctx.lineTo(-ship.radius, -ship.radius * 0.85);
  ctx.closePath();
  ctx.stroke();

  if (state.keys.has("ArrowUp")) {
    ctx.strokeStyle = "#dcff84";
    const flame = 12 + Math.sin(nowMs() * 0.036) * 4;
    ctx.beginPath();
    ctx.moveTo(-ship.radius * 1.06, 0);
    ctx.lineTo(-ship.radius - flame, random(-3.4, 3.4));
    ctx.stroke();
  }
  ctx.restore();
}

function drawAsteroid(asteroid) {
  ctx.save();
  ctx.translate(asteroid.x, asteroid.y);
  ctx.rotate(asteroid.rotation);
  ctx.strokeStyle = asteroid.isCta ? "rgba(178, 255, 104, 0.96)" : "rgba(134, 255, 164, 0.84)";
  ctx.lineWidth = asteroid.isCta ? 2.4 : 1.9;
  ctx.beginPath();
  asteroid.roughness.forEach((mod, i) => {
    const angle = (i / asteroid.roughness.length) * Math.PI * 2;
    const r = asteroid.radius * mod;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.closePath();
  ctx.stroke();

  if (asteroid.isCta) {
    ctx.fillStyle = "rgba(221, 255, 171, 0.96)";
    ctx.font = "700 15px Trebuchet MS, Verdana, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(asteroid.label, 0, 0, asteroid.radius * 1.6);
  }
  ctx.restore();
}

function drawBullets() {
  state.bullets.forEach((bullet) => {
    ctx.beginPath();
    ctx.fillStyle = "#b9ff60";
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawParticles() {
  state.particles.forEach((particle) => {
    const lifeRatio = clamp(particle.life / particle.ttl, 0, 1);
    ctx.beginPath();
    if (particle.type === "spark") {
      ctx.fillStyle = `rgba(205, 255, 108, ${(lifeRatio * 0.92).toFixed(2)})`;
      ctx.arc(particle.x, particle.y, particle.radius * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(153, 248, 255, ${(lifeRatio * 0.88).toFixed(2)})`;
      ctx.lineWidth = 1.25;
      ctx.arc(particle.x, particle.y, particle.radius * lifeRatio, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function spawnExplosion(x, y, intensity = 1) {
  const shards = Math.floor(34 * intensity);
  const sparks = Math.floor(22 * intensity);
  for (let i = 0; i < shards; i += 1) {
    const a = random(0, Math.PI * 2);
    const s = random(2.2, 7.4) * intensity;
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      radius: random(1.3, 3.2),
      ttl: random(0.45, 0.95),
      life: random(0.45, 0.95),
      drag: random(0.91, 0.97),
      type: "shard",
    });
  }
  for (let i = 0; i < sparks; i += 1) {
    const a = random(0, Math.PI * 2);
    const s = random(3.4, 10.2) * intensity;
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      radius: random(1, 2.3),
      ttl: random(0.22, 0.6),
      life: random(0.22, 0.6),
      drag: random(0.88, 0.94),
      type: "spark",
    });
  }
  state.shake = clamp(state.shake + 9 * intensity, 0, 24);
  state.flash = clamp(state.flash + 0.3 * intensity, 0, 1);
}

function scheduleNavigation(href, label) {
  if (state.navigating) return;
  state.navigating = true;
  setStatusMessage(`Warping to ${label}...`);
  state.navigationTimeoutId = setTimeout(() => {
    state.navigationTimeoutId = null;
    window.location.href = href;
  }, 650);
}

function resetTransientGameplayState() {
  state.navigating = false;
  state.keys.clear();
  state.shipRespawnLockMs = 0;
  state.lastShotAt = 0;
  if (state.navigationTimeoutId) {
    clearTimeout(state.navigationTimeoutId);
    state.navigationTimeoutId = null;
  }
}

function finishStartupAndPlay() {
  if (!state.booting) return;
  if (startupScreenEl) {
    startupScreenEl.classList.add("hidden");
  }

  setTimeout(() => {
    document.body.classList.remove("booting");
    state.booting = false;
    state.startupReady = false;
    updateStatusText();
    initAudio();
  }, 520);
}

function startStartupSequence() {
  if (!startupScreenEl) {
    state.booting = false;
    document.body.classList.remove("booting");
    return;
  }

  setStatusMessage("Booting console...");

  if (startupNameEl) {
    startupNameEl.classList.add("is-visible");
  }
  if (startupPlayEl) {
    startupPlayEl.disabled = true;
  }

  setTimeout(() => {
    if (startupPlayEl) {
      startupPlayEl.disabled = false;
      if (typeof startupPlayEl.focus === "function") {
        try {
          startupPlayEl.focus({ preventScroll: true });
        } catch {
          startupPlayEl.focus();
        }
      }
    }
    state.startupReady = true;
    setStatusMessage("Press Play to start");
  }, 4600);
}

function bounceShipOffAsteroid(asteroid) {
  const dx = ship.x - asteroid.x;
  const dy = ship.y - asteroid.y;
  const distance = Math.max(0.0001, Math.hypot(dx, dy));
  const nx = dx / distance;
  const ny = dy / distance;

  const overlap = ship.radius + asteroid.radius - distance;
  if (overlap > 0) {
    ship.x += nx * (overlap + 1.5);
    ship.y += ny * (overlap + 1.5);
    wrapPosition(ship);
  }

  // Reflect ship velocity along the contact normal with slight damping.
  const velocityAlongNormal = ship.vx * nx + ship.vy * ny;
  if (velocityAlongNormal < 0) {
    const restitution = 0.84;
    const impulse = -(1 + restitution) * velocityAlongNormal;
    ship.vx += impulse * nx;
    ship.vy += impulse * ny;
  } else {
    // Ensure a noticeable bounce even when overlap was detected late.
    const push = Math.max(1.2, Math.hypot(ship.vx, ship.vy) * 0.65);
    ship.vx += nx * push;
    ship.vy += ny * push;
  }

  asteroid.vx -= nx * 0.22;
  asteroid.vy -= ny * 0.22;
  state.shake = clamp(state.shake + 2, 0, 24);
}

function fractureAsteroid(asteroid, impactVX, impactVY, navigateOnHit) {
  if (!asteroid.alive) return;
  asteroid.alive = false;

  const hitAngle = Math.atan2(impactVY, impactVX);
  const fragments = Math.floor(random(2, 4));
  const canSplit =
    !asteroid.isCta &&
    asteroid.radius > config.minAsteroidRadius + 8 &&
    asteroid.generation < 2;

  spawnExplosion(asteroid.x, asteroid.y, asteroid.isCta ? 1.35 : 1);
  playExplosionSfx();

  if (canSplit) {
    for (let i = 0; i < fragments; i += 1) {
      const spread = random(-0.75, 0.75);
      const angle = hitAngle + spread + i * 0.18;
      const impulse = random(1.1, 2.5);
      const tangent = random(-1, 1);
      const radius = clamp(
        asteroid.radius * random(0.44, 0.62),
        config.minAsteroidRadius,
        asteroid.radius * 0.72
      );
      state.asteroids.push(
        createAsteroid({
          x: asteroid.x + Math.cos(angle) * random(6, 18),
          y: asteroid.y + Math.sin(angle) * random(6, 18),
          radius,
          vx:
            asteroid.vx * 0.72 +
            Math.cos(angle) * impulse +
            Math.cos(angle + Math.PI / 2) * tangent,
          vy:
            asteroid.vy * 0.72 +
            Math.sin(angle) * impulse +
            Math.sin(angle + Math.PI / 2) * tangent,
          spin: asteroid.spin + random(-0.03, 0.03),
          generation: asteroid.generation + 1,
        })
      );
    }
  }

  if (navigateOnHit && asteroid.isCta) {
    scheduleNavigation(asteroid.href, asteroid.label);
  }
}

function shoot(now) {
  if (now - state.lastShotAt < config.shotCooldownMs || state.navigating) return;
  state.lastShotAt = now;
  state.bullets.push({
    x: ship.x + Math.cos(ship.rotation) * (ship.radius + 8),
    y: ship.y + Math.sin(ship.rotation) * (ship.radius + 8),
    prevX: ship.x,
    prevY: ship.y,
    vx: Math.cos(ship.rotation) * config.bulletSpeed + ship.vx * 0.2,
    vy: Math.sin(ship.rotation) * config.bulletSpeed + ship.vy * 0.2,
    birth: now,
    radius: 2.35,
  });
  playShotSfx();
}

function updateShip() {
  ship.prevX = ship.x;
  ship.prevY = ship.y;

  if (state.keys.has("ArrowLeft")) ship.rotation -= config.rotationSpeed;
  if (state.keys.has("ArrowRight")) ship.rotation += config.rotationSpeed;
  if (state.keys.has("ArrowUp")) {
    ship.vx += Math.cos(ship.rotation) * config.thrustPower;
    ship.vy += Math.sin(ship.rotation) * config.thrustPower;
  }

  ship.vx *= config.drag;
  ship.vy *= config.drag;
  ship.x += ship.vx;
  ship.y += ship.vy;
  wrapPosition(ship);
}

function updateAsteroids() {
  state.asteroids.forEach((asteroid) => {
    if (!asteroid.alive) return;
    asteroid.prevX = asteroid.x;
    asteroid.prevY = asteroid.y;
    asteroid.x += asteroid.vx;
    asteroid.y += asteroid.vy;
    asteroid.rotation += asteroid.spin;
    wrapPosition(asteroid);
  });
}

function updateBullets(now) {
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    bullet.prevX = bullet.x;
    bullet.prevY = bullet.y;
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;

    const offscreen =
      bullet.x < -bullet.radius ||
      bullet.x > canvas.width + bullet.radius ||
      bullet.y < -bullet.radius ||
      bullet.y > canvas.height + bullet.radius;

    if (offscreen || now - bullet.birth > config.bulletLifetimeMs) {
      state.bullets.splice(i, 1);
    }
  }
}

function updateParticles(dtSeconds) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= particle.drag;
    particle.vy *= particle.drag;
    particle.life -= dtSeconds;
    if (particle.life <= 0) {
      state.particles.splice(i, 1);
    }
  }
}

function detectBulletImpacts() {
  for (let bi = state.bullets.length - 1; bi >= 0; bi -= 1) {
    const bullet = state.bullets[bi];
    let consumed = false;
    for (let ai = 0; ai < state.asteroids.length; ai += 1) {
      const asteroid = state.asteroids[ai];
      if (!asteroid.alive) continue;
      const hitRadius = asteroid.radius + bullet.radius;
      const pointDx = bullet.x - asteroid.x;
      const pointDy = bullet.y - asteroid.y;
      let hit = pointDx * pointDx + pointDy * pointDy <= hitRadius * hitRadius;

      if (
        !hit &&
        !movedThroughWrap(bullet.prevX, bullet.prevY, bullet.x, bullet.y) &&
        !movedThroughWrap(
          asteroid.prevX,
          asteroid.prevY,
          asteroid.x,
          asteroid.y
        )
      ) {
        const relStartX = bullet.prevX - asteroid.prevX;
        const relStartY = bullet.prevY - asteroid.prevY;
        const relEndX = bullet.x - asteroid.x;
        const relEndY = bullet.y - asteroid.y;
        hit = segmentHitsCircle(relStartX, relStartY, relEndX, relEndY, hitRadius);
      }

      if (hit) {
        fractureAsteroid(asteroid, bullet.vx, bullet.vy, true);
        consumed = true;
        break;
      }
    }
    if (consumed) {
      state.bullets.splice(bi, 1);
    }
  }
}

function detectShipImpacts(now) {
  if (now < state.shipRespawnLockMs || state.navigating) return;

  for (let i = 0; i < state.asteroids.length; i += 1) {
    const asteroid = state.asteroids[i];
    if (!asteroid.alive) continue;
    const dx = ship.x - asteroid.x;
    const dy = ship.y - asteroid.y;
    const collisionRadius = ship.radius + asteroid.radius;
    let collided = dx * dx + dy * dy <= collisionRadius * collisionRadius;

    if (
      !collided &&
      !movedThroughWrap(ship.prevX, ship.prevY, ship.x, ship.y) &&
      !movedThroughWrap(
        asteroid.prevX,
        asteroid.prevY,
        asteroid.x,
        asteroid.y
      )
    ) {
      const relStartX = ship.prevX - asteroid.prevX;
      const relStartY = ship.prevY - asteroid.prevY;
      const relEndX = ship.x - asteroid.x;
      const relEndY = ship.y - asteroid.y;
      collided = segmentHitsCircle(
        relStartX,
        relStartY,
        relEndX,
        relEndY,
        collisionRadius
      );
    }

    if (collided) {
      if (asteroid.isCta) {
        bounceShipOffAsteroid(asteroid);
      } else {
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const nx = dx / distance;
        const ny = dy / distance;
        const impactSpeed = Math.max(
          2.5,
          Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy) + 1.4
        );

        ship.vx = nx * impactSpeed;
        ship.vy = ny * impactSpeed;
        ship.x = asteroid.x + nx * (collisionRadius + 2);
        ship.y = asteroid.y + ny * (collisionRadius + 2);
        wrapPosition(ship);

        fractureAsteroid(
          asteroid,
          ship.vx - asteroid.vx,
          ship.vy - asteroid.vy,
          false
        );
      }
      state.shipRespawnLockMs = now + 700;
      break;
    }
  }
}

function pruneAsteroids() {
  state.asteroids = state.asteroids.filter((asteroid) => asteroid.alive);
}

function applyCameraEffects() {
  if (state.shake <= 0.01) {
    state.shake = 0;
    state.shakeX = 0;
    state.shakeY = 0;
    return;
  }
  state.shakeX = random(-state.shake, state.shake);
  state.shakeY = random(-state.shake, state.shake);
  state.shake *= 0.86;
}

function drawFlash() {
  if (state.flash <= 0.01) {
    state.flash = 0;
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(210, 248, 255, ${Math.min(0.4, state.flash).toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  state.flash *= 0.88;
}

function updateStatusText() {
  // Intentionally blank: game HUD instructions are hidden.
}

function drawFrame(now) {
  const dtSeconds = (now - state.previousFrame) / 1000;
  state.previousFrame = now;

  if (!state.booting) {
    if (state.keys.has("Space")) shoot(now);
    updateShip();
    updateAsteroids();
    updateBullets(now);
    updateParticles(dtSeconds);
    detectBulletImpacts();
    detectShipImpacts(now);
    pruneAsteroids();
    updateThrustAudio();
    applyCameraEffects();
    updateStatusText();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(state.shakeX, state.shakeY);
  drawStars();
  state.asteroids.forEach(drawAsteroid);
  drawParticles();
  drawBullets();
  drawShip();
  ctx.restore();
  drawFlash();

  requestAnimationFrame(drawFrame);
}

function handleKeyDown(event) {
  const isGameplayKey = [
    "ArrowUp",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ].includes(event.code);
  const isStartupPlayKey = event.code === "Enter" || event.code === "Space";

  if (isGameplayKey || (state.booting && isStartupPlayKey)) {
    event.preventDefault();
    if (state.booting) {
      if (state.startupReady && startupPlayEl && isStartupPlayKey) {
        finishStartupAndPlay();
      }
      return;
    }
    state.keys.add(event.code);
    initAudio();
  }
}

function handleKeyUp(event) {
  if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
    if (state.booting) {
      return;
    }
    state.keys.delete(event.code);
  }
}

function boot() {
  resizeCanvas();
  seedStars();
  spawnInitialAsteroids();
  startStartupSequence();
  if (startupPlayEl) {
    startupPlayEl.addEventListener("click", finishStartupAndPlay);
  }
  window.addEventListener("pageshow", () => {
    resetTransientGameplayState();
    updateStatusText();
  });
  window.addEventListener("pagehide", () => {
    resetTransientGameplayState();
  });
  window.addEventListener("resize", () => {
    resizeCanvas();
    seedStars();
  });
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  requestAnimationFrame(drawFrame);
}

boot();
