import { useRef, useState, useEffect, useCallback } from 'react';
import './App.css';

const SEQUENCE = ['leftWrist','leftElbow','leftShoulder','rightShoulder','rightElbow','rightWrist'];
const SEQUENCE_ES = ['Muñeca Izq','Codo Izq','Hombro Izq','Hombro Der','Codo Der','Muñeca Der'];
const SCALE = [1, 2, 2, 2, 1, 2, 2];
const GAMUT = 10;
const HUMANIZE = 0.03;
const VIDEO_SIZE = 513;
const MAX_NOTES_PER_STEP = 3; // limit simultaneous notes for softness
const MOVEMENT_THRESHOLD = 8; // px average movement to consider "moving"

const SAMPLES = {
  C2:    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-c2.mp3',
  'D#2': 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-ds2.mp3',
  'F#2': 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-fs2.mp3',
  A2:    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-a2.mp3',
  C3:    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-c3.mp3',
  'D#3': 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-ds3.mp3',
  'F#3': 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-fs3.mp3',
  A3:    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/969699/pure-bell-a3.mp3',
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

export default function App() {
  const [status, setStatus] = useState('loading');
  const [loadLog, setLoadLog] = useState([]);
  const [toneLog, setToneLog] = useState([]);
  const [moving, setMoving] = useState(false);
  const [volume, setVolume] = useState(70);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const particleRef = useRef(null);
  const toneLogRef = useRef([]);
  const stateRef = useRef({
    points: null, prevPoints: null, notesOn: null, startTime: null,
    notesPlayed: [], particles: [],
    Tone: null, sampler: null, net: null, masterVol: null,
    movement: 0,
    isMoving: false,
  });

  const log = useCallback((msg) => {
    console.log(`[PoseMusic] ${msg}`);
    setLoadLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  const addToneLog = useCallback((entry) => {
    toneLogRef.current = [entry, ...toneLogRef.current].slice(0, 20);
    setToneLog([...toneLogRef.current]);
  }, []);

  const handleVolume = useCallback((e) => {
    const val = Number(e.target.value);
    setVolume(val);
    const { masterVol } = stateRef.current;
    if (masterVol) {
      // Map 0-100 to -Infinity..-6..+4 dB range
      if (val === 0) {
        masterVol.volume.value = -Infinity;
      } else {
        masterVol.volume.value = -40 + (val / 100) * 44; // -40dB to +4dB
      }
    }
  }, []);

  // ── Load deps ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        log('Importando Tone.js…');
        const Tone = await import('tone');
        if (cancelled) return;
        log('Tone.js cargado ✓');

        log('Importando TensorFlow.js…');
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        if (cancelled) return;
        log(`TF.js listo (backend: ${tf.getBackend()}) ✓`);

        log('Importando PoseNet…');
        const posenet = await import('@tensorflow-models/posenet');
        if (cancelled) return;
        log('Módulo PoseNet cargado ✓');

        log('Cargando modelo PoseNet (puede tardar)…');
        const net = await posenet.load();
        if (cancelled) return;
        log('Modelo PoseNet listo ✓');

        const ToneLib = Tone.default || Tone;
        log('Configurando efectos de audio (underwater)…');

        // ── Gentle audio chain ──
        const masterVol = new ToneLib.Volume(-6).toMaster();

        // Mild low-pass — just softens the highs a bit
        const filter = new ToneLib.Filter({
          frequency: 2500,
          type: 'lowpass',
          rolloff: -12,
        }).connect(masterVol);

        // Moderate reverb — some space, not drowning
        const reverb = new ToneLib.Freeverb({
          roomSize: 0.6,
          dampening: 3000,
        }).connect(filter);
        reverb.wet.value = 0.3;

        // Light delay
        const delay = new ToneLib.PingPongDelay({
          delayTime: ToneLib.Time('4n').toSeconds(),
          feedback: 0.2,
          wet: 0.15,
        }).connect(reverb);

        const sampler = new ToneLib.Sampler(SAMPLES).connect(delay);
        if (sampler.release && typeof sampler.release === 'object' && 'value' in sampler.release) {
          sampler.release.value = 3;
        } else {
          sampler.release = 3;
        }
        log('Cargando muestras de audio…');

        await new Promise((res, rej) => {
          if (sampler.loaded) return res();
          ToneLib.Buffer.on('load', res);
          setTimeout(() => rej(new Error('Timeout cargando muestras (30s)')), 30000);
        });
        if (cancelled) return;
        log('Muestras de audio cargadas ✓');

        // Slower tempo: use half notes as step instead of quarter
        const step = ToneLib.Time('2n').toSeconds();
        const loopDuration = ToneLib.Time('1m').toSeconds() * 4;
        const steps = Math.round(loopDuration / step);

        Object.assign(stateRef.current, {
          Tone: ToneLib, sampler, net, step, loopDuration, masterVol,
          rootNote: ToneLib.Frequency('E2').toMidi(),
          notesPlayed: Array.from({ length: steps }, () => Array(GAMUT).fill(0)),
        });

        log('Todo listo 🚀');
        setStatus('ready');
      } catch (err) {
        log(`ERROR: ${err.message}`);
        setStatus('error');
        console.error(err);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [log]);

  // ── Start ──
  const startApp = useCallback(async () => {
    const s = stateRef.current;
    const { Tone, net } = s;

    await Tone.start();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { width: VIDEO_SIZE, height: VIDEO_SIZE, facingMode: 'user' },
    });
    const video = videoRef.current;
    video.srcObject = stream;
    video.width = VIDEO_SIZE;
    video.height = VIDEO_SIZE;
    await video.play();
    setStatus('running');

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const captureCtx = captureCanvas.getContext('2d');
    const scaleFactor = Math.min(1.0, Math.max(0.2, video.videoWidth / VIDEO_SIZE * 0.5));

    const setMovingState = setMoving; // capture for use in closure

    // ── Pose detection + movement tracking ──
    function detectPose() {
      captureCtx.drawImage(video, 0, 0);
      net.estimateSinglePose(captureCanvas, scaleFactor, true, 32).then(pose => {
        const points = SEQUENCE.map(part => pose.keypoints.find(k => k.part === part)).filter(Boolean);

        // Compute movement from previous frame
        if (s.prevPoints && s.prevPoints.length === points.length) {
          let totalDelta = 0;
          for (let i = 0; i < points.length; i++) {
            const dx = points[i].position.x - s.prevPoints[i].position.x;
            const dy = points[i].position.y - s.prevPoints[i].position.y;
            totalDelta += Math.sqrt(dx * dx + dy * dy);
          }
          const avgDelta = totalDelta / points.length;
          // Smooth the movement value
          s.movement = s.movement * 0.7 + avgDelta * 0.3;
        }
        s.prevPoints = points.map(p => ({ position: { x: p.position.x, y: p.position.y } }));
        s.isMoving = s.movement > MOVEMENT_THRESHOLD;
        setMovingState(s.isMoving);

        s.points = points;
        const steps = Math.round(s.loopDuration / s.step);
        const noteWidth = video.videoWidth / steps;
        const noteHeight = video.videoHeight / GAMUT;
        const notesOn = [];
        for (let i = 0; i < steps; i++) {
          const x = i * noteWidth;
          const col = Array(GAMUT).fill(false);
          for (let j = 0; j < GAMUT; j++) {
            const y = j * noteHeight;
            for (let k = 0; k < points.length - 1; k++) {
              if (lineRectIntersect(
                points[k].position.x, points[k].position.y,
                points[k+1].position.x, points[k+1].position.y,
                x, y, noteWidth, noteHeight
              )) { col[j] = true; break; }
            }
          }
          notesOn.push(col);
        }
        s.notesOn = notesOn;
      });
      setTimeout(detectPose, s.step / 4 * 1000);
    }
    detectPose();

    // ── Audio scheduling ──
    let nextPlay = Tone.now() + s.step;
    s.startTime = nextPlay;

    function scheduleNextPlay() {
      while (nextPlay - Tone.now() < s.step) {
        const steps = Math.round(s.loopDuration / s.step);
        const playedFor = Tone.now() - s.startTime;
        const loopsGone = Math.floor(playedFor / s.loopDuration);
        const fraction = (playedFor - loopsGone * s.loopDuration) / s.loopDuration;
        const currentNote = Math.floor(fraction * steps);
        const noteWidth = video.videoWidth / steps;
        const noteHeight = video.videoHeight / GAMUT;

        // Only play if there's movement
        if (s.isMoving && s.notesOn && s.notesOn[currentNote]) {
          let noteVal = s.rootNote;
          const toPlay = [];
          for (let i = s.notesOn[currentNote].length - 1; i >= 0; i--) {
            if (s.notesOn[currentNote][i]) toPlay.push({ note: noteVal, idx: i });
            noteVal += SCALE[i % SCALE.length];
          }

          // Limit notes per step for softness
          const limited = toPlay.slice(0, MAX_NOTES_PER_STEP);

          for (let i = 0; i < limited.length; i++) {
            const isEven = i % 2 === 0;
            const t = (isEven ? nextPlay : nextPlay + s.step / 2) + HUMANIZE * Math.random();
            const freq = Tone.Frequency(limited[i].note, 'midi');
            // Softer velocity based on movement intensity (0.1 to 0.5)
            const velocity = Math.min(0.5, 0.1 + (s.movement / 80) * 0.4);
            s.sampler.triggerAttack(freq, t, velocity);
            s.notesPlayed[currentNote][limited[i].idx] = t;

            const cellX = currentNote * noteWidth;
            const cellY = limited[i].idx * noteHeight;
            const triggerSegments = [];
            if (s.points) {
              for (let k = 0; k < s.points.length - 1; k++) {
                if (lineRectIntersect(
                  s.points[k].position.x, s.points[k].position.y,
                  s.points[k+1].position.x, s.points[k+1].position.y,
                  cellX, cellY, noteWidth, noteHeight
                )) {
                  triggerSegments.push(`${SEQUENCE_ES[k]}→${SEQUENCE_ES[k+1]}`);
                }
              }
            }

            const freqHz = freq.toFrequency();
            addToneLog({
              id: Date.now() + i,
              nota: midiToName(limited[i].note),
              midi: limited[i].note,
              frecuencia: `${freqHz.toFixed(1)} Hz`,
              duracion: `${(s.step * 1000).toFixed(0)} ms`,
              columna: currentNote + 1,
              fila: limited[i].idx + 1,
              posX: `${cellX.toFixed(0)}–${(cellX + noteWidth).toFixed(0)} px`,
              posY: `${cellY.toFixed(0)}–${(cellY + noteHeight).toFixed(0)} px`,
              segmentos: triggerSegments.join(', ') || '—',
              compas: loopsGone + 1,
              subdiv: isEven ? 'tiempo fuerte' : 'contratiempo',
              velocidad: `${(velocity * 100).toFixed(0)}%`,
              movimiento: `${s.movement.toFixed(1)} px/frame`,
            });

            const p = particleRef.current;
            if (p) {
              const ox = (p.width - VIDEO_SIZE) / 2;
              const oy = (p.height - VIDEO_SIZE) / 2;
              const screenX = ox + (currentNote + 0.5) * noteWidth;
              const screenY = oy + (limited[i].idx + 0.5) * noteHeight;
              const intensity = 8 + Math.floor((GAMUT - limited[i].idx) * 1.5);
              const pitchRatio = limited[i].idx / GAMUT;
              spawnParticles(s.particles, screenX, screenY, intensity, pitchRatio, p.width, p.height);
            }
          }
        }
        nextPlay += s.step;
      }
      setTimeout(scheduleNextPlay, 10);
    }
    scheduleNextPlay();

    // ── Render loop ──
    function resizeCanvases() {
      const c = canvasRef.current, p = particleRef.current;
      if (c) { c.width = c.offsetWidth; c.height = c.offsetHeight; }
      if (p) { p.width = p.offsetWidth; p.height = p.offsetHeight; }
    }
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    function render() {
      const c = canvasRef.current, p = particleRef.current;
      if (!c || !p) return;
      const ctx = c.getContext('2d');
      const pCtx = p.getContext('2d');
      const ox = (c.width - VIDEO_SIZE) / 2;
      const oy = (c.height - VIDEO_SIZE) / 2;

      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.translate(ox, oy);

      // Skeleton
      if (s.points && s.points.length) {
        ctx.strokeStyle = s.isMoving ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = s.isMoving ? 15 : 4;
        ctx.beginPath();
        for (const pt of s.points) ctx.lineTo(pt.position.x, pt.position.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        for (const pt of s.points) {
          ctx.fillStyle = s.isMoving ? '#fff' : 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.arc(pt.position.x, pt.position.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Grid + colored playhead
      if (s.startTime) {
        const steps = Math.round(s.loopDuration / s.step);
        const nw = video.videoWidth / steps;
        const nh = video.videoHeight / GAMUT;
        const pf = Tone.now() - s.startTime - s.step;
        const lg = Math.floor(pf / s.loopDuration);
        const fr = (pf - lg * s.loopDuration) / s.loopDuration;
        const cn = Math.floor(fr * steps);

        const grad = ctx.createLinearGradient(cn * nw, 0, cn * nw + nw, 0);
        grad.addColorStop(0, 'rgba(0,180,255,0.0)');
        grad.addColorStop(0.3, 'rgba(0,180,255,0.15)');
        grad.addColorStop(0.5, 'rgba(100,220,255,0.2)');
        grad.addColorStop(0.7, 'rgba(0,180,255,0.15)');
        grad.addColorStop(1, 'rgba(0,180,255,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cn * nw, 0, nw, video.videoHeight);

        ctx.strokeStyle = 'rgba(0,200,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cn * nw, 0); ctx.lineTo(cn * nw, video.videoHeight);
        ctx.moveTo((cn+1) * nw, 0); ctx.lineTo((cn+1) * nw, video.videoHeight);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        for (let i = 0; i <= steps; i++) {
          ctx.beginPath();
          ctx.moveTo(i * nw, 0); ctx.lineTo(i * nw, video.videoHeight);
          ctx.stroke();
        }

        const radius = Math.min(nw, nh);
        for (let i = 0; i < GAMUT; i++) {
          const y = (i + 0.5) * nh;
          for (let j = 0; j < steps; j++) {
            const pa = s.notesPlayed[j][i];
            if (pa <= Tone.now() && pa > Tone.now() - 1.5) {
              const alpha = 1 - (Tone.now() - pa) / 1.5;
              const hue = 190 + (i / GAMUT) * 40;
              ctx.fillStyle = `hsla(${hue},80%,70%,${alpha * 0.4})`;
              ctx.beginPath();
              ctx.arc((j+0.5)*nw, y, radius * easeOutQuad(1-alpha) * 0.8, 0, Math.PI*2);
              ctx.fill();
            }
          }
        }
      }
      ctx.restore();

      // ── Fullscreen particles ──
      pCtx.clearRect(0, 0, p.width, p.height);
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const pt = s.particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += pt.gravity;
        pt.life -= pt.decay;
        if (pt.life <= 0) { s.particles.splice(i, 1); continue; }
        pCtx.globalAlpha = pt.life * 0.85;
        pCtx.fillStyle = pt.color;
        pCtx.shadowColor = pt.color;
        pCtx.shadowBlur = pt.radius * 3;
        pCtx.beginPath();
        pCtx.arc(pt.x, pt.y, pt.radius * (0.4 + pt.life * 0.6), 0, Math.PI * 2);
        pCtx.fill();
      }
      pCtx.shadowBlur = 0;
      pCtx.globalAlpha = 1;

      requestAnimationFrame(render);
    }
    render();
  }, [addToneLog]);

  return (
    <div id="app">
      <div id="wrap">
        <video ref={videoRef} autoPlay playsInline muted />
      </div>
      <canvas ref={canvasRef} id="canvas" />
      <canvas ref={particleRef} id="particleCanvas" />

      {status !== 'running' && (
        <div id="pre">
          <p>Haz una pose frente a la cámara para crear música</p>
          <button id="start" disabled={status !== 'ready'} onClick={startApp}>
            {status === 'loading' ? 'Cargando…' : status === 'error' ? 'Error' : 'Iniciar'}
          </button>
          <div className="load-log">
            {loadLog.map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">{entry.time}</span> {entry.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Movement indicator + volume */}
      {status === 'running' && (
        <div className="top-bar">
          <div className={`movement-indicator ${moving ? 'active' : 'idle'}`}>
            {moving ? '♪ Tocando — movimiento detectado' : '⏸ En pausa — muévete para tocar'}
          </div>
          <div className="volume-control">
            <label htmlFor="vol">🔊 {volume}%</label>
            <input
              id="vol"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolume}
            />
          </div>
        </div>
      )}

      {/* Tone notifications */}
      {status === 'running' && toneLog.length > 0 && (
        <div className="tone-notifs">
          {toneLog.map((t, i) => (
            <div key={t.id} className="tone-notif" style={{ opacity: Math.max(0, 1 - i * 0.045) }}>
              <span className="tone-note">{t.nota}</span>
              <span className="tone-detail">
                MIDI {t.midi} · {t.frecuencia} · {t.duracion} · vel {t.velocidad} · {t.subdiv}
              </span>
              <span className="tone-reason">
                Col {t.columna}, Fila {t.fila} — X:[{t.posX}] Y:[{t.posY}] · mov: {t.movimiento}
                {t.segmentos !== '—' && <> — {t.segmentos}</>}
                {' '}— compás #{t.compas}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ASCII explanation panel */}
      {status === 'running' && (
        <div className="ascii-panel">
<pre>{`┌─────────────────────────────┐
│  CÓMO SE GENERA LA MÚSICA   │
├─────────────────────────────┤
│                             │
│  Cámara → PoseNet detecta   │
│  6 puntos del cuerpo:       │
│                             │
│    ●─────●─────●            │
│   muñ   codo  hombro        │
│   izq    izq   izq          │
│            │                │
│    ●─────●─────●            │
│   muñ   codo  hombro        │
│   der    der   der          │
│                             │
├─────────────────────────────┤
│  DETECCIÓN DE MOVIMIENTO:   │
│                             │
│  Se compara la posición de  │
│  cada punto entre frames.   │
│  Si el promedio de delta    │
│  es < ${MOVEMENT_THRESHOLD} px → silencio.       │
│  Más movimiento = más       │
│  volumen (velocity 10-50%)  │
│                             │
├─────────────────────────────┤
│  Grid: columnas × filas     │
│                             │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┐  │
│  │  │░░│  │  │  │░░│  │  │  │
│  ├──┼──┼──┼──┼──┼──┼──┼──┤  │
│  │  │  │░░│  │  │  │░░│  │  │
│  └──┴──┴──┴──┴──┴──┴──┴──┘  │
│   col = TIEMPO (lento)      │
│   fila = TONO (pitch)       │
│   máx ${MAX_NOTES_PER_STEP} notas simultáneas   │
│                             │
├─────────────────────────────┤
│  CADENA DE AUDIO:            │
│                             │
│  sampler (vel dinámica)     │
│    ↓                        │
│  delay suave (¼ nota, 15%)  │
│    ↓                        │
│  reverb (sala 60%, wet 30%) │
│    ↓                        │
│  filtro LP 2500Hz (-12dB)   │
│    ↓                        │
│  volumen master -6dB        │
│    ↓                        │
│  release 3s                 │
│  → salida                   │
└─────────────────────────────┘`}</pre>
        </div>
      )}

      <div className="credits">
        TensorFlow.js + PoseNet + Tone.js · Original: <a href="https://twitter.com/teropa">@teropa</a>
      </div>
    </div>
  );
}

// ── Helpers ──
function lineLineIntersect(x1,y1,x2,y2,x3,y3,x4,y4) {
  const d = (y4-y3)*(x2-x1)-(x4-x3)*(y2-y1);
  if (d === 0) return false;
  const uA = ((x4-x3)*(y1-y3)-(y4-y3)*(x1-x3)) / d;
  const uB = ((x2-x1)*(y1-y3)-(y2-y1)*(x1-x3)) / d;
  return uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1;
}

function lineRectIntersect(x1,y1,x2,y2,rx,ry,rw,rh) {
  return lineLineIntersect(x1,y1,x2,y2,rx,ry,rx,ry+rh) ||
    lineLineIntersect(x1,y1,x2,y2,rx+rw,ry,rx+rw,ry+rh) ||
    lineLineIntersect(x1,y1,x2,y2,rx,ry,rx+rw,ry) ||
    lineLineIntersect(x1,y1,x2,y2,rx,ry+rh,rx+rw,ry+rh);
}

function easeOutQuad(x) { return x * x; }

function spawnParticles(arr, cx, cy, count, pitchRatio, screenW, screenH) {
  const hue = 190 + pitchRatio * 50;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.5 + Math.random() * 2) * (1.3 - pitchRatio);
    const spreadX = (Math.random() - 0.5) * screenW * 0.4;
    const spreadY = (Math.random() - 0.5) * screenH * 0.3;
    arr.push({
      x: cx + spreadX * 0.15,
      y: cy + spreadY * 0.15,
      vx: Math.cos(angle) * speed + spreadX * 0.006,
      vy: Math.sin(angle) * speed - (1 - pitchRatio) * 1.5 + spreadY * 0.004,
      life: 1,
      decay: 0.003 + Math.random() * 0.008,
      radius: 1.5 + Math.random() * 4,
      gravity: pitchRatio * 0.03 - 0.008,
      color: `hsl(${hue + Math.random()*20 - 10}, ${70+Math.random()*20}%, ${55+Math.random()*30}%)`,
    });
  }
}
