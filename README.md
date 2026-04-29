# PoseMusic — Sonido con el Cuerpo, Luz con el Sonido

> Este código fue parte de la conferencia **OwuUnplugged: Creatividad y Fundamentos de la Información**, organizada por la comunidad **aillumina** el **18 de abril de 2026**.

---

## ¿Qué es esto?

Una aplicación web interactiva que convierte los movimientos del cuerpo humano en música en tiempo real. La cámara detecta la pose del usuario, mapea las posiciones de brazos y hombros sobre una grilla musical, y genera sonidos de campanas cristalinas que responden a la intensidad del movimiento.

En la conferencia, la salida de audio de esta aplicación se conectó a un sistema de **láseres audiorítmicos** que transformaban las frecuencias y amplitudes del sonido generado en patrones de luz sincronizados — cerrando el ciclo de **movimiento → sonido → luz**.

---

## Cómo funciona

### 1. Detección de pose (PoseNet + TensorFlow.js)

La cámara captura video en tiempo real. El modelo PoseNet identifica 6 puntos clave del cuerpo superior:

```
  ●─────●─────●
 muñeca codo  hombro
  izq    izq   izq
           │
  ●─────●─────●
 muñeca codo  hombro
  der    der   der
```

Estos puntos forman segmentos de línea que se proyectan sobre una grilla invisible superpuesta al video.

### 2. Detección de movimiento

El sistema compara la posición de cada punto entre frames consecutivos. Si el promedio de desplazamiento supera 8 píxeles por frame, se considera que hay movimiento y se activa la generación de sonido. Sin movimiento, hay silencio — la música solo existe cuando el cuerpo se mueve.

La intensidad del movimiento también controla la velocidad (velocity) de las notas: movimientos suaves producen sonidos más tenues (10%), movimientos amplios llegan hasta 50%.

### 3. Grilla musical

El espacio del video se divide en una grilla donde:

- **Columnas** = tiempo (pasos del secuenciador, tempo lento en blancas)
- **Filas** = tono (10 niveles de pitch, escala basada en E2 con intervalos de tono/semitono)

Cuando un segmento del esqueleto cruza una celda de la grilla, esa nota se activa. Se limitan a 3 notas simultáneas por paso para mantener la suavidad.

### 4. Cadena de audio (Tone.js)

Las notas disparan muestras de campanas puras procesadas por una cadena de efectos diseñada para un sonido envolvente y etéreo:

```
Sampler (campanas, velocity dinámica)
  ↓
PingPong Delay (¼ nota, feedback 20%, wet 15%)
  ↓
Freeverb (sala 60%, dampening 3kHz, wet 30%)
  ↓
Filtro Low-Pass (2500 Hz, -12 dB/oct)
  ↓
Volumen Master (-6 dB)
  ↓
Release largo (3 segundos)
  → Salida de audio
```

### 5. Visualización

- Esqueleto luminoso sobre fondo negro que brilla más con movimiento
- Partículas de color que explotan desde las celdas activadas y se dispersan por toda la pantalla
- Playhead con gradiente azul que recorre la grilla
- Panel de notificaciones en tiempo real mostrando nota MIDI, frecuencia, velocity y segmento corporal que la disparó

---

## Uso en la conferencia

Durante la presentación en OwuUnplugged:

1. **El presentador se colocó frente a la cámara** y sus movimientos de brazos generaron música en vivo ante la audiencia.
2. **La salida de audio se enrutó a un sistema de láseres audiorítmicos** que analizaban las frecuencias y amplitudes del sonido producido por la aplicación.
3. **Los láseres transformaron el audio en patrones de luz**: notas graves producían barridos amplios y lentos, notas agudas generaban trazos rápidos y concentrados. La intensidad del láser seguía la dinámica del volumen.
4. El resultado fue una demostración en vivo del ciclo completo: **cuerpo → datos de pose → música generativa → luz láser** — ilustrando cómo la información fluye y se transforma entre distintos medios.

Esto sirvió como ejemplo práctico de los fundamentos de la información: cómo un gesto físico se codifica en coordenadas, se mapea a frecuencias sonoras, y finalmente se decodifica como luz visible.

---

## Stack técnico

| Tecnología | Rol |
|---|---|
| React 19 | UI e interfaz |
| Vite | Bundler y dev server |
| TensorFlow.js | Runtime de ML en el navegador |
| PoseNet | Modelo de detección de pose |
| Tone.js | Síntesis y procesamiento de audio |
| Canvas API | Renderizado del esqueleto, grilla y partículas |

---

## Cómo ejecutar

```bash
npm install
npm run dev
```

Abrir en el navegador, permitir acceso a la cámara, y hacer clic en **Iniciar**. Mover los brazos para generar música.

---

## Créditos

Concepto original de síntesis por pose: [@teropa](https://twitter.com/teropa). Adaptado y extendido para la conferencia OwuUnplugged por la comunidad aillumina.
