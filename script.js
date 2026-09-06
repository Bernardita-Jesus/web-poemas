let uploadedImages = [];
let mosaicCanvas = null;

// Lo usan los dos efectos (escritura y mosaico): si el sistema pide
// menos movimiento, se apagan solos.
const prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// efecto escritura: el tecleo de los poemas no arranca hasta que el
// mosaico de fondo terminó de dibujarse. Hasta entonces, los poemas que
// ya entraron en pantalla esperan su turno en esta cola.
let mosaicReady = false;
const pendingTypewriter = [];
// Los poemas y las fechas no se muestran hasta que el mosaico de fotos
// terminó de dibujarse. Si los poemas se cargan antes, quedan armados
// pero ocultos y esto marca que hay un "reveal" esperando.
let revealPendiente = false;

// Recortes ya calculados (color, brillo, imgData) del último mosaico armado,
// y el layout con el que se dibujaron.
let currentTiles = [];
let currentLayout = null;

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const thumbrow = document.getElementById('thumbrow');
const imgCount = document.getElementById('imgCount');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const tileWSlider = document.getElementById('tileW');
const tileWVal = document.getElementById('tileWVal');
const tileHSlider = document.getElementById('tileH');
const tileHVal = document.getElementById('tileHVal');
const variableSizesCheckbox = document.getElementById('variableSizes');
const fixedSizeControls = document.getElementById('fixedSizeControls');
const variableSizeControls = document.getElementById('variableSizeControls');
const rowHeightSlider = document.getElementById('rowHeight');
const rowHeightVal = document.getElementById('rowHeightVal');
const minWidthSlider = document.getElementById('minWidth');
const minWidthVal = document.getElementById('minWidthVal');
const maxWidthSlider = document.getElementById('maxWidth');
const maxWidthVal = document.getElementById('maxWidthVal');
const sortMode = document.getElementById('sortMode');
const jitterSlider = document.getElementById('jitter');
const jitterVal = document.getElementById('jitterVal');

// Ordenamiento del mosaico: siempre por brillo, con una pizca de
// aleatoriedad (SORT_JITTER) para que las bandas no queden lisas. El
// SENTIDO lo elige cada estación en el mapa ESTACIONES (campo `orden`):
//   'brightness'      -> claro → oscuro (arranca claro arriba)
//   'brightness-dark' -> oscuro → claro (arranca oscuro arriba)
// SORT_MODE es solo el valor por defecto para una estación que no defina
// `orden`. El que se usa de verdad es SEASON_SORT_MODE (más abajo, junto
// a CURRENT_SEASON).
const SORT_MODE = 'brightness';
const SORT_JITTER = 0.25;

// =====================================================================
// EFECTO MOSAICO (opcional)
// ---------------------------------------------------------------------
// Una vez dibujado el mosaico de fondo (el de recortes fijos, que es el
// que usa la home), algunos cuadrados van cambiando de a poco y sin
// parar, así la imagen "respira" en lugar de quedar congelada.
//
// Hay dos modos, se elige con MOSAICO_MODO:
//
//   'desliz'      (actual) - cada cuadrado sale de una foto más grande y,
//                 en esa foto, tiene un recorte real pegado al lado. El
//                 cuadrado se desliza muy despacio dentro de su foto y va
//                 mostrando ese recorte contiguo. Por ahora solo se
//                 desliza hacia los lados (izquierda o derecha), nunca
//                 arriba/abajo. El paneo es acumulativo: cada cuadrado se
//                 pasea horizontalmente por su propia foto. Al iniciar, el
//                 efecto arranca "en caliente": ya hay una tanda de
//                 cuadrados deslizándose desde el primer momento.
//
//   'intercambio'          - cada cuadrado se intercambia de golpe (sin
//                 fundido) con un vecino de la grilla: arriba, abajo,
//                 izquierda o derecha. El conjunto de recortes no cambia,
//                 solo se reordenan. Es más brusco y más movido.
//
// PARA DESACTIVARLO: poné EFECTO_MOSAICO en false. El mosaico queda
// quieto como antes. No hace falta tocar nada más.
//
// También se apaga solo si el sistema pide menos movimiento
// (prefers-reduced-motion).
//
// Ajustes:
//   MOSAICO_CAMBIO_PORCENTAJE - qué proporción del mosaico ARRANCA un
//                               cambio en cada ciclo (5 = 5% de los
//                               cuadrados por ciclo)
//   MOSAICO_CAMBIO_INTERVALO  - cuánto dura ese ciclo, en milisegundos
//                               (más alto = cambios más espaciados)
//   MOSAICO_DESLIZ_MS         - cuánto tarda un cuadrado en deslizarse
//                               hasta el recorte de al lado (modo 'desliz')
//   MOSAICO_MAX_ACTIVAS       - tope duro de cuadrados moviéndose a la vez
//                               (freno de rendimiento; ver más abajo)
//
// PORCENTAJE vs. CUADRADOS MOVIÉNDOSE A LA VEZ (modo 'desliz'):
//   El porcentaje es cuántos EMPIEZAN a deslizarse por ciclo, no cuántos
//   se ven en movimiento en un instante. Como cada deslizamiento (17,5 s)
//   dura más que el ciclo (5 s), se van solapando y acumulando. La
//   cantidad que TENDERÍA a haber moviéndose a la vez es:
//
//       PORCENTAJE * (MOSAICO_DESLIZ_MS / MOSAICO_CAMBIO_INTERVALO)
//       = 5% * (17500 / 5000) = 5% * 3,5 = 17,5% del mosaico
//
//   ...pero MOSAICO_MAX_ACTIVAS lo corta ahí: sobre un mosaico grande ese
//   17,5% eran cientos de cuadrados, cada uno con su animación, y la
//   página se pegaba. Ahora, pasado el tope, los pedidos nuevos se
//   ignoran hasta que alguno termina, y un único requestAnimationFrame
//   anima a todos los activos juntos.
//
//   Para que se vean MENOS en movimiento a la vez: bajá MAX_ACTIVAS (o
//   PORCENTAJE). Para que cambien más seguido: bajá INTERVALO.
// =====================================================================
const EFECTO_MOSAICO = true;
const MOSAICO_MODO = 'desliz'; // 'desliz' | 'intercambio'
const MOSAICO_CAMBIO_PORCENTAJE = 5;
const MOSAICO_CAMBIO_INTERVALO = 5000;
const MOSAICO_DESLIZ_MS = 17500;

// El ciclo se reparte en pasos chiquitos de este tamaño para que los
// cambios se sientan graduales y no como un parpadeo de golpe.
const MOSAICO_PASO_MS = 260;

// Tope de cuadrados deslizándose a la vez. El reloj interno puede pedir
// más (según PORCENTAJE), pero por encima de este número los pedidos se
// ignoran hasta que alguno termina. Es el freno principal contra el "se
// pega": cada cuadrado en movimiento es un blit de canvas por frame, y
// dejar que se acumulen cientos trababa la página. Un único
// requestAnimationFrame los anima a todos (ver startMosaicDrift).
const MOSAICO_MAX_ACTIVAS = 64;

// Estado del efecto en curso (o null si está apagado / sin arrancar).
let mosaicoDrift = null;

// Fotos normalizadas (canvas WORK_DIM x WORK_DIM) de las que salió cada
// recorte. El modo 'desliz' las necesita para panear dentro de la foto
// original; se llenan al armar el mosaico.
let mosaicSources = [];

variableSizesCheckbox.addEventListener('change', () => {
  const on = variableSizesCheckbox.checked;
  fixedSizeControls.style.display = on ? 'none' : '';
  variableSizeControls.style.display = on ? '' : 'none';
});
rowHeightSlider.addEventListener('input', () => {
  rowHeightVal.textContent = rowHeightSlider.value;
});
minWidthSlider.addEventListener('input', () => {
  minWidthVal.textContent = minWidthSlider.value;
  if (parseInt(minWidthSlider.value, 10) >= parseInt(maxWidthSlider.value, 10)) {
    maxWidthSlider.value = Math.min(300, parseInt(minWidthSlider.value, 10) + 20);
    maxWidthVal.textContent = maxWidthSlider.value;
  }
});
maxWidthSlider.addEventListener('input', () => {
  maxWidthVal.textContent = maxWidthSlider.value;
  if (parseInt(maxWidthSlider.value, 10) <= parseInt(minWidthSlider.value, 10)) {
    minWidthSlider.value = Math.max(20, parseInt(maxWidthSlider.value, 10) - 20);
    minWidthVal.textContent = minWidthSlider.value;
  }
});

tileWSlider.addEventListener('input', () => {
  tileWVal.textContent = tileWSlider.value;
});
tileHSlider.addEventListener('input', () => {
  tileHVal.textContent = tileHSlider.value;
});
jitterSlider.addEventListener('input', () => {
  jitterVal.textContent = jitterSlider.value;
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0 && fileList.length > 0) {
    imgCount.textContent = 'Ese archivo no es una imagen soportada.';
    return;
  }
  files.forEach(file => {
    const reader = new FileReader();
    reader.onerror = () => {
      imgCount.textContent = 'No se pudo leer "' + file.name + '".';
    };
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => {
        imgCount.textContent = '"' + file.name + '" no se pudo abrir (formato no soportado, probá con JPG o PNG).';
      };
      img.onload = () => {
        uploadedImages.push(img);
        const t = document.createElement('img');
        t.src = ev.target.result;
        thumbrow.appendChild(t);
        updateCount();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateCount() {
  imgCount.textContent = uploadedImages.length + (uploadedImages.length === 1 ? ' imagen cargada' : ' imágenes cargadas');
  processBtn.disabled = uploadedImages.length === 0;
}

processBtn.addEventListener('click', buildMosaic);
downloadBtn.addEventListener('click', () => {
  if (!mosaicCanvas) return;
  const link = document.createElement('a');
  link.download = 'mosaico-color.png';
  link.href = mosaicCanvas.toDataURL('image/png');
  link.click();
});

function rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const bri = max;
  return { h, s, bri };
}

// Resolución de trabajo: más alta que antes para no perder nitidez en los recortes.
const WORK_DIM = 960;

// Factor de zoom aplicado antes de recortar: en vez de usar la foto completa
// (encuadre "cover"), recorta una región más chica y centrada, así cada
// pieza del mosaico muestra un detalle de más cerca en vez de la escena entera.
const ZOOM = 1.35;

function planFixedGrid(colsUnits, rowsUnits) {
  // one tile per cell — trivial "plan" for the fixed-size mode
  const plan = [];
  for (let gy = 0; gy < rowsUnits; gy++) {
    for (let gx = 0; gx < colsUnits; gx++) {
      plan.push({ gx, gy, size: 1 });
    }
  }
  return plan;
}

function planVariableWidths(size, rowHeight, minW, maxW) {
  // Fills a size x size square in horizontal rows of fixed height `rowHeight`.
  // Within each row, tile widths are picked at random from [min, mid, max],
  // always leaving either 0 or at least minW of remaining space so no sliver
  // tiles appear — the very last tile in a row just fills whatever is left.
  const widthOptions = [minW, Math.round((minW + maxW) / 2), maxW];
  const plan = [];
  let y = 0;
  while (y < size) {
    const h = Math.min(rowHeight, size - y);
    let x = 0;
    while (x < size) {
      const remaining = size - x;
      let w;
      if (remaining <= maxW) {
        w = remaining;
      } else {
        const candidates = widthOptions.filter(o => remaining - o === 0 || remaining - o >= minW);
        w = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : minW;
      }
      plan.push({ x, y, w, h });
      x += w;
    }
    y += rowHeight;
  }
  return plan;
}

function buildMosaic() {
  if (uploadedImages.length === 0) {
    imgCount.textContent = 'Subí al menos una foto primero.';
    return;
  }
  processBtn.disabled = true;
  processBtn.textContent = 'Procesando… 0%';

  const variable = variableSizesCheckbox.checked;
  const rowHeight = parseInt(rowHeightSlider.value, 10);
  const minWidth = parseInt(minWidthSlider.value, 10);
  const maxWidth = parseInt(maxWidthSlider.value, 10);
  const tileW = parseInt(tileWSlider.value, 10);
  const tileH = parseInt(tileHSlider.value, 10);

  // Resolución de trabajo para ESTA estación: WORK_DIM por la densidad
  // pedida (mosaicoDensidad). Más resolución = la grilla de abajo saca más
  // recortes reales por foto = mosaico más largo y con más detalle.
  const workDim = Math.round(WORK_DIM * ((SEASON_CFG && SEASON_CFG.mosaicoDensidad) || 1));

  // Pre-render each uploaded photo onto its own normalized square canvas at full working resolution.
  const normalized = uploadedImages.map(img => {
    const c = document.createElement('canvas');
    c.width = workDim;
    c.height = workDim;
    const cx = c.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(workDim / img.width, workDim / img.height) * ZOOM;
    const sw = workDim / scale, sh = workDim / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, workDim, workDim);
    return cx;
  });

  // efecto mosaico (modo 'desliz'): guardamos las fotos normalizadas para
  // poder deslizarnos dentro de ellas más tarde.
  mosaicSources = normalized.map(cx => cx.canvas);

  const colsUnits = Math.floor(workDim / tileW);
  const rowsUnits = Math.floor(workDim / tileH);

  const jobs = [];
  normalized.forEach((cx, imgIdx) => {
    if (variable) {
      const plan = planVariableWidths(workDim, rowHeight, minWidth, maxWidth);
      plan.forEach(p => {
        jobs.push({ imgIdx, px: p.x, py: p.y, w: p.w, h: p.h });
      });
    } else {
      const plan = planFixedGrid(colsUnits, rowsUnits);
      plan.forEach(p => {
        jobs.push({ imgIdx, px: p.gx * tileW, py: p.gy * tileH, w: tileW, h: tileH });
      });
    }
  });

  const totalTiles = jobs.length;

  // 1x1 scratch canvas: drawing a region scaled down to a single pixel
  // makes the browser do the color averaging for us, no manual pixel loop.
  const avgCanvas = document.createElement('canvas');
  avgCanvas.width = 1;
  avgCanvas.height = 1;
  const actx = avgCanvas.getContext('2d', { willReadFrequently: true });

  const tiles = [];
  let cursor = 0;
  const BATCH = 25; // small enough per tick to never look like a runaway loop

  function processStep() {
    try {
      const end = Math.min(cursor + BATCH, totalTiles);
      for (let k = cursor; k < end; k++) {
        const job = jobs[k];
        const cx = normalized[job.imgIdx];

        actx.clearRect(0, 0, 1, 1);
        actx.drawImage(cx.canvas, job.px, job.py, job.w, job.h, 0, 0, 1, 1);
        const avg = actx.getImageData(0, 0, 1, 1).data;
        const hsb = rgbToHsb(avg[0], avg[1], avg[2]);
        const tileData = cx.getImageData(job.px, job.py, job.w, job.h);
        // imgIdx / srcX / srcY: de qué foto y de qué posición salió el
        // recorte, para que el modo 'desliz' pueda panear dentro de ella.
        tiles.push({ imgData: tileData, w: job.w, h: job.h, h_: hsb.h, s: hsb.s, bri: hsb.bri,
                     imgIdx: job.imgIdx, srcX: job.px, srcY: job.py });
      }
      cursor = end;
      processBtn.textContent = 'Procesando… ' + Math.round((cursor / totalTiles) * 100) + '%';

      if (cursor < totalTiles) {
        setTimeout(processStep, 0);
      } else {
        sortAndRender();
      }
    } catch (err) {
      console.error(err);
      imgCount.textContent = 'Ups, falló: ' + err.message;
      processBtn.disabled = false;
      processBtn.textContent = 'Armar mosaico';
    }
  }

  function sortAndRender() {
    applySort(tiles, SEASON_SORT_MODE, SORT_JITTER);

    currentTiles = tiles;
    currentLayout = { variable, tileW, tileH, rowHeight, minWidth, maxWidth };

    processBtn.textContent = 'Dibujando…';
    const finish = () => {
      imgCount.textContent = tiles.length + ' recortes armados.';
      processBtn.disabled = false;
      processBtn.textContent = 'Armar mosaico';
      downloadBtn.disabled = false;
      // efecto escritura: recién con el mosaico dibujado se sueltan los
      // poemas que estaban esperando para empezar a teclearse.
      markMosaicReady();
    };

    renderCurrentTiles(finish);
  }

  processStep();
}

// Calcula una clave numérica de orden por recorte según el modo, y le suma
// ruido proporcional a `jitterAmount` (0 = orden estricto, 1 ≈ mezcla total).
// Se usa tanto al armar el mosaico por primera vez como al reordenar con los
// botones flotantes.
function applySort(tilesArr, mode, jitterAmount) {
  if (mode === 'shuffle') {
    for (let i = tilesArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tilesArr[i], tilesArr[j]] = [tilesArr[j], tilesArr[i]];
    }
    return;
  }
  tilesArr.forEach(t => {
    let key;
    if (mode === 'hue') key = t.h_; // 0..360
    else if (mode === 'brightness') key = (1 - t.bri) * 360; // flip so low = bright, scale to 360 (claro → oscuro)
    else if (mode === 'brightness-dark') key = t.bri * 360; // low = dark, scale to 360 (oscuro → claro)
    else if (mode === 'saturation') key = (1 - t.s) * 360;
    else key = t.h_ + t.bri * 40; // hue-bright, small brightness nudge

    const noise = (Math.random() - 0.5) * jitterAmount * 480; // up to ~±240 at max
    t.sortKey = key + noise;
  });
  tilesArr.sort((a, b) => a.sortKey - b.sortKey);
}

function renderCurrentTiles(onDone) {
  const { variable, tileW, tileH, rowHeight, minWidth, maxWidth } = currentLayout;
  if (variable) {
    renderFlowMosaic(currentTiles, rowHeight, minWidth, maxWidth, onDone);
  } else {
    renderFixedMosaic(currentTiles, tileW, tileH, onDone);
  }
}

function renderFixedMosaic(tiles, tileW, tileH, onDone) {
  const n = tiles.length;
  // Ancho fijo (pensado para pantalla); las filas necesarias se apilan hacia
  // abajo según cuántos recortes haya, así una mayor densidad de recortes
  // se traduce en una página más larga en vez de un mosaico más cuadrado.
  const TARGET_WIDTH = 1600;
  const cols = Math.max(1, Math.round(TARGET_WIDTH / tileW));
  // Una fila extra al final: se suma una línea entera de recortes debajo de
  // la última, sin tocar el tamaño de cada recorte. Esas celdas nuevas caen
  // en i >= n y se rellenan con la misma regla de reflejo que las sobrantes.
  // (Para un mosaico más largo se genera MÁS recortes reales por foto; ver
  // mosaicoDensidad en ESTACIONES / buildMosaic, no filas de relleno acá.)
  const rows = Math.ceil(n / cols) + 1;
  const total = rows * cols; // suele ser > n; las celdas sobrantes de la última fila se rellenan reflejando el final del array (ver más abajo)

  const holder = document.getElementById('canvas-holder');
  holder.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW;
  canvas.height = rows * tileH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  holder.appendChild(canvas);
  mosaicCanvas = canvas;

  let i = 0;
  const BATCH = 80;

  function drawStep() {
    const end = Math.min(i + BATCH, total);
    for (; i < end; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Para las celdas sobrantes de la última fila (i >= n) reflejamos hacia
      // atrás desde el final del array en vez de volver al principio: así el
      // relleno sigue con los recortes del mismo extremo del degradado que la
      // última fila dibujada, y no con los del arranque (el otro extremo).
      let idx = i;
      if (idx >= n) idx = Math.max(0, 2 * n - 1 - idx);
      ctx.putImageData(tiles[idx].imgData, col * tileW, row * tileH);
    }
    if (i < total) {
      setTimeout(drawStep, 0);
    } else {
      // efecto mosaico: con el fondo ya dibujado, dejamos que algunos
      // cuadrados se vayan cambiando de a poco (ver EFECTO_MOSAICO).
      startMosaicDrift(ctx, tiles, n, tileW, tileH, cols, total);
      if (onDone) onDone();
    }
  }
  drawStep();
}

// efecto mosaico: arranca (o reinicia) el cambio gradual de cuadrados
// sobre el canvas ya dibujado. Un reloj interno corre en pasos chicos y,
// en cada paso, toca unos pocos cuadrados según el modo elegido.
function startMosaicDrift(ctx, tiles, n, tileW, tileH, cols, total) {
  stopMosaicDrift();
  if (!EFECTO_MOSAICO || prefersReducedMotion) return;
  if (total === 0 || cols === 0) return;

  // Qué celda muestra cada recorte (misma regla que el dibujado: las
  // celdas sobrantes reflejan el final del array). Para el modo 'desliz'
  // guardamos una copia por celda del origen del paneo, así cada una se
  // pasea por su foto sin pisar a las demás.
  let cellPan = null;
  if (MOSAICO_MODO === 'desliz') {
    cellPan = new Array(total);
    for (let i = 0; i < total; i++) {
      let idx = i;
      if (idx >= n) idx = Math.max(0, 2 * n - 1 - idx);
      const t = tiles[idx];
      cellPan[i] = t ? { imgIdx: t.imgIdx, srcX: t.srcX, srcY: t.srcY, moviendo: false } : null;
    }
  }

  // Cuántos cuadrados tocar por paso: el porcentaje pedido repartido a lo
  // largo del ciclo. La fracción sobrante se acumula para que, aun con
  // números chicos, el cambio termine ocurriendo.
  const porPaso = (total * MOSAICO_CAMBIO_PORCENTAJE / 100) *
                  (MOSAICO_PASO_MS / MOSAICO_CAMBIO_INTERVALO);
  let acum = 0;

  // activas: los deslizamientos en curso. Un ÚNICO requestAnimationFrame
  // (state.raf) los adelanta a todos en cada frame; antes había un rAF por
  // cuadrado y se juntaban cientos, que es lo que trababa la página.
  // seedTimers: los timers del arranque en caliente.
  const state = { ctx, tileW, tileH, cols, total, cellPan,
                  activas: [], raf: 0, seedTimers: [] };
  const paso = MOSAICO_MODO === 'desliz' ? iniciarDesliz : intercambiarConVecino;

  // Bucle compartido: recorre las activas, adelanta cada una y saca las
  // que llegaron al final. Se vuelve a pedir solo mientras quede alguna.
  state.loop = (ahora) => {
    const activas = state.activas;
    for (let i = activas.length - 1; i >= 0; i--) {
      const a = activas[i];
      const t = Math.min(1, (ahora - a.inicio) / MOSAICO_DESLIZ_MS);
      // Mezcla mitad lineal, mitad suavizado en las puntas: se mueve
      // parejo pero sin que se note el salto al arrancar y frenar.
      const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const e = 0.5 * t + 0.5 * easeInOut;
      const sX = a.fromX + (a.toX - a.fromX) * e;
      const sY = a.fromY + (a.toY - a.fromY) * e;
      state.ctx.drawImage(a.src, sX, sY, state.tileW, state.tileH,
                          a.cellX, a.cellY, state.tileW, state.tileH);
      if (t >= 1) {
        a.pan.srcX = a.toX;
        a.pan.srcY = a.toY;
        a.pan.moviendo = false;
        activas.splice(i, 1);
      }
    }
    state.raf = activas.length ? requestAnimationFrame(state.loop) : 0;
  };
  state.arrancarLoop = () => {
    if (!state.raf && !document.hidden && state.activas.length) {
      state.raf = requestAnimationFrame(state.loop);
    }
  };

  // Pausa al cambiar de pestaña: con la pestaña oculta el navegador
  // congela los rAF; sin esto el setInterval seguiría sumando
  // deslizamientos y, al volver, llegaría todo junto y se trabaría.
  state.onVisibilidad = () => {
    if (document.hidden) {
      if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    } else {
      state.arrancarLoop();
    }
  };
  document.addEventListener('visibilitychange', state.onVisibilidad);

  state.timer = setInterval(() => {
    if (document.hidden) return;
    acum += porPaso;
    let cuantos = Math.floor(acum);
    acum -= cuantos;
    while (cuantos-- > 0) paso(state);
  }, MOSAICO_PASO_MS);
  mosaicoDrift = state;

  // Arranque "en caliente" (modo 'desliz'): en vez de esperar a que el
  // reloj vaya sumando deslizamientos de a poco, largamos ya una tanda
  // —topeada por MOSAICO_MAX_ACTIVAS— con demoras al azar repartidas en la
  // duración de un deslizamiento. Así, apenas se dibuja el mosaico, ya hay
  // cuadrados en movimiento y a distintas alturas del recorrido.
  if (MOSAICO_MODO === 'desliz') {
    const enRegimen = Math.min(
      SEASON_MOSAICO_MAX,
      Math.round((total * MOSAICO_CAMBIO_PORCENTAJE / 100) *
                 (MOSAICO_DESLIZ_MS / MOSAICO_CAMBIO_INTERVALO)));
    for (let k = 0; k < enRegimen; k++) {
      state.seedTimers.push(setTimeout(() => paso(state), Math.random() * MOSAICO_DESLIZ_MS));
    }
  }
}

function stopMosaicDrift() {
  if (mosaicoDrift) {
    if (mosaicoDrift.timer) clearInterval(mosaicoDrift.timer);
    if (mosaicoDrift.raf) cancelAnimationFrame(mosaicoDrift.raf);
    (mosaicoDrift.seedTimers || []).forEach(clearTimeout);
    if (mosaicoDrift.onVisibilidad) {
      document.removeEventListener('visibilitychange', mosaicoDrift.onVisibilidad);
    }
  }
  mosaicoDrift = null;
}

// efecto mosaico: elige una celda al azar y la intercambia con una
// vecina —arriba, abajo, izquierda o derecha—. El cambio es instantáneo:
// se leen los dos cuadrados y se vuelven a pintar cruzados, sin fundido.
// El conjunto de recortes no cambia: solo se reordenan.
function intercambiarConVecino(state) {
  const { total, cols, tileW, tileH, ctx } = state;
  const rows = Math.round(total / cols);

  const celda = Math.floor(Math.random() * total);
  const c = celda % cols;
  const r = Math.floor(celda / cols);

  const vecinas = [];
  if (r > 0)         vecinas.push([c, r - 1]);
  if (r < rows - 1)  vecinas.push([c, r + 1]);
  if (c > 0)         vecinas.push([c - 1, r]);
  if (c < cols - 1)  vecinas.push([c + 1, r]);
  if (vecinas.length === 0) return;

  const [vc, vr] = vecinas[Math.floor(Math.random() * vecinas.length)];
  const ax = c * tileW,  ay = r * tileH;
  const bx = vc * tileW, by = vr * tileH;

  const imgA = ctx.getImageData(ax, ay, tileW, tileH);
  const imgB = ctx.getImageData(bx, by, tileW, tileH);
  ctx.putImageData(imgB, ax, ay);
  ctx.putImageData(imgA, bx, by);
}

// efecto mosaico (modo 'desliz'): elige una celda al azar y arma un
// deslizamiento —despacio, su ventana de recorte se corre un cuadrado
// hacia la izquierda o la derecha dentro de la foto original, revelando el
// recorte pegado al lado—. El paneo es acumulativo: la celda queda
// apuntando al recorte nuevo y la próxima vez sigue desde ahí. El avance
// cuadro a cuadro lo hace el bucle compartido (state.loop); acá solo se
// prepara y se mete en state.activas.
function iniciarDesliz(state) {
  const { tileW, tileH, cols, total, cellPan } = state;
  if (!cellPan) return;
  // Tope de simultáneos: por encima se ignora el pedido hasta que alguno
  // termine (ver MOSAICO_MAX_ACTIVAS / SEASON_MOSAICO_MAX).
  if (state.activas.length >= SEASON_MOSAICO_MAX) return;

  const celda = Math.floor(Math.random() * total);
  const pan = cellPan[celda];
  if (!pan || pan.moviendo) return;

  const src = mosaicSources[pan.imgIdx];
  if (!src) return;
  const dim = src.width; // foto normalizada, cuadrada (WORK_DIM)

  // Direcciones que no se salen de la foto original. Por ahora solo
  // horizontal: izquierda o derecha. Para volver a habilitar arriba/abajo
  // descomentar las dos líneas verticales.
  const dirs = [];
  if (pan.srcX - tileW >= 0)            dirs.push([-tileW, 0]);
  if (pan.srcX + 2 * tileW <= dim)      dirs.push([tileW, 0]);
  // if (pan.srcY - tileH >= 0)            dirs.push([0, -tileH]);
  // if (pan.srcY + 2 * tileH <= dim)      dirs.push([0, tileH]);
  if (dirs.length === 0) return;
  const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];

  pan.moviendo = true;
  state.activas.push({
    pan, src,
    fromX: pan.srcX, fromY: pan.srcY,
    toX: pan.srcX + dx, toY: pan.srcY + dy,
    cellX: (celda % cols) * tileW,
    cellY: Math.floor(celda / cols) * tileH,
    inicio: performance.now(),
  });
  state.arrancarLoop();
}

// ---------------------------------------------------------------------
// ESTACIONES: qué fotos y qué texturas usa cada una. La estación que se
// muestra se elige con ?estacion=... en la URL; los botones de la barra
// de arriba y los de la pantalla "Estaciones" la cambian y recargan la
// página (ver "BARRA DE ESTACIONES" más abajo). Sin un parámetro válido
// NO hay estación elegida: la web arranca en la pantalla "Estaciones",
// donde se elige otoño o invierno.
//
// Los poemas de la estación salen de assets/poemas/<estacion>.yaml.
// Primavera y Verano todavía no tienen assets, así que sus botones no
// hacen nada. Si sumás o sacás fotos de assets/imagenes, actualizá la
// lista correspondiente acá.
// ---------------------------------------------------------------------
const ESTACIONES = {
  otono: {
    // sentido del degradado por brillo (ver SORT_MODE): claro arriba.
    orden: 'brightness',
    // cuántas texturas apaisadas se colocan (mínimo; ver construirTexturas)
    texturasCantidad: 16,
    fotos: [
      'assets/imagenes/otono-04.jpg',
      'assets/imagenes/otono-07.jpg',
      'assets/imagenes/otono-08.jpg',
      'assets/imagenes/otono-09.jpg',
      'assets/imagenes/otono-10.jpeg',
      'assets/imagenes/otono-11.jpeg',
      'assets/imagenes/otono-12.jpeg',
    ],
    texturas: [
      'assets/imagenes/textura-otono-01.jpeg',
      'assets/imagenes/textura-otono-02.jpeg',
      'assets/imagenes/textura-otono-03.jpeg',
      'assets/imagenes/textura-otono-04.jpeg',
      'assets/imagenes/textura-otono-05.jpeg',
      'assets/imagenes/textura-otono-06.jpeg',
      'assets/imagenes/textura-otono-07.jpg',
      'assets/imagenes/textura-otono-08.jpg',
    ],
  },
  invierno: {
    // sentido del degradado por brillo (ver SORT_MODE): oscuro arriba.
    orden: 'brightness-dark',
    // más recortes deslizándose a la vez que el default (ver
    // MOSAICO_MAX_ACTIVAS). Subilo/bajalo para más o menos movimiento.
    mosaicoMax: 120,
    // densidad del mosaico: cuántos recortes REALES se sacan de cada foto,
    // como factor sobre el default (1 = 8x16 por foto). 1.25 = ~1.5x más
    // recortes -> mosaico más largo y con más detalle, todos iguales,
    // ordenados en el mismo degradado (no son filas de relleno). Sirve
    // para que los poemas tengan más aire entre sí. Subilo para más
    // (1.5, 2...). Ver buildMosaic.
    mosaicoDensidad: 1.25,
    // cuántas texturas apaisadas se colocan (mínimo; ver construirTexturas)
    texturasCantidad: 23,
    fotos: [
      'assets/imagenes/invierno-01.jpg',
      'assets/imagenes/invierno-02.jpg',
      'assets/imagenes/invierno-03.jpg',
      'assets/imagenes/invierno-04.jpg',
      'assets/imagenes/invierno-05.jpg',
      'assets/imagenes/invierno-06.jpg',
      'assets/imagenes/invierno-07.jpg',
      'assets/imagenes/invierno-08.jpg',
      'assets/imagenes/invierno-09.jpg',
      'assets/imagenes/invierno-10.jpg',
      'assets/imagenes/invierno-11.jpg',
    ],
    texturas: [
      'assets/imagenes/textura-invierno-01.jpg',
      'assets/imagenes/textura-invierno-02.jpg',
    ],
  },
};
// Estación pedida por la URL (?estacion=otono). Si no es una de las que
// tienen assets, queda null: no se carga ningún mosaico ni poemas y se
// muestra la pestaña "Estaciones" (página en blanco con fotos, la de
// entrada; ver "BARRA DE ESTACIONES" y .vista-estaciones en style.css).
const CURRENT_SEASON = (function () {
  const pedida = new URLSearchParams(location.search).get('estacion');
  return (pedida && ESTACIONES[pedida]) ? pedida : null;
})();

// Config de la estación actual. Si todavía no se eligió, un molde vacío
// para que lo de abajo no explote; igual no se usa, porque la carga de
// fotos y poemas se saltea cuando CURRENT_SEASON es null.
const SEASON_CFG = ESTACIONES[CURRENT_SEASON] ||
                   { fotos: [], texturas: [], orden: SORT_MODE };

// Sentido del degradado por brillo para la estación actual. Otoño va
// claro → oscuro (como siempre); invierno, oscuro → claro.
const SEASON_SORT_MODE = SEASON_CFG.orden || SORT_MODE;

// Tope de recortes deslizándose a la vez para la estación actual: el que
// pida ESTACIONES.<estacion>.mosaicoMax, o el default MOSAICO_MAX_ACTIVAS.
const SEASON_MOSAICO_MAX = SEASON_CFG.mosaicoMax || MOSAICO_MAX_ACTIVAS;

// Marca la estación en el <body> para que el CSS pueda cambiar cosas por
// estación (por ahora, el color del velo; ver body[data-estacion] en
// style.css). Sin estación elegida no se marca nada (no hay velo).
if (CURRENT_SEASON) document.body.dataset.estacion = CURRENT_SEASON;

// Sin ?estacion=... se muestra la pestaña "Estaciones": una página
// aparte, en blanco, con fotos (index.html, #estacionesHome), y se
// oculta el mosaico. Con una estación elegida es al revés. Ver
// .vista-estaciones en style.css.
document.body.classList.toggle('vista-estaciones', !CURRENT_SEASON);

// ---------------------------------------------------------------------
// Carga automática de fondo: en "modo fondo de home" el panel de
// controles está oculto (ver style.css), así que en vez de esperar a
// que alguien arrastre fotos, cargamos directamente las fotos de la
// estación actual y armamos el mosaico apenas terminan de cargar.
// ---------------------------------------------------------------------
const ASSET_IMAGE_PATHS = SEASON_CFG.fotos;

// Las fotos originales son de varios MB y miles de píxeles de lado.
// Decodificarlas todas juntas y a resolución completa es lo que más hace
// "tardar y pegarse" el arranque, así que:
//   - se decodifican de a pocas (ASSET_DECODE_CONCURRENCIA);
//   - se reducen a ASSET_LADO_MAX de lado al decodificar. El mosaico
//     trabaja a WORK_DIM (960) con un zoom de recorte y el efecto desliz
//     pasea por la foto, así que 2000 px deja margen de sobra; las
//     originales de 5000-6000 px solo gastaban memoria.
const ASSET_DECODE_CONCURRENCIA = 3;
const ASSET_LADO_MAX = 2000;

// Decodifica una foto ya reducida y fuera del hilo principal con
// createImageBitmap. Si el navegador no soporta el resize (Safari viejo),
// devuelve el bitmap a resolución completa; si no hay createImageBitmap,
// cae al <img> de siempre. Devuelve una promesa con algo dibujable
// (ImageBitmap o HTMLImageElement), las dos sirven para drawImage.
function cargarFotoReducida(path) {
  if (window.createImageBitmap && window.fetch) {
    return fetch(path)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(blob => createImageBitmap(blob))
      .then(bm => {
        const escala = Math.min(1, ASSET_LADO_MAX / Math.max(bm.width, bm.height));
        if (escala === 1) return bm;
        return createImageBitmap(bm, {
          resizeWidth: Math.round(bm.width * escala),
          resizeHeight: Math.round(bm.height * escala),
          resizeQuality: 'high',
        }).then(chico => { bm.close(); return chico; })
          .catch(() => bm); // navegador sin opciones de resize: usar el grande
      });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('no se pudo abrir'));
    img.src = path;
  });
}

function loadAssetBackground() {
  let settled = 0;
  let siguiente = 0;

  const onSettle = () => {
    settled++;
    updateCount();
    if (settled === ASSET_IMAGE_PATHS.length && uploadedImages.length > 0) {
      buildMosaic();
    }
  };

  const arrancarUna = () => {
    if (siguiente >= ASSET_IMAGE_PATHS.length) return;
    const path = ASSET_IMAGE_PATHS[siguiente++];
    cargarFotoReducida(path)
      .then(bm => {
        uploadedImages.push(bm);
        const t = document.createElement('img');
        t.src = path;
        t.loading = 'lazy';
        thumbrow.appendChild(t);
      })
      .catch(err => console.error('No se pudo cargar la imagen de fondo:', path, err))
      .then(() => { onSettle(); arrancarUna(); }); // libera el cupo para la próxima
  };

  const enParalelo = Math.min(ASSET_DECODE_CONCURRENCIA, ASSET_IMAGE_PATHS.length);
  for (let i = 0; i < enParalelo; i++) arrancarUna();
}

// Sin estación elegida no hay mosaico: la web queda en la pantalla
// "Estaciones" hasta que se elige otoño o invierno.
if (CURRENT_SEASON) loadAssetBackground();

// ---------------------------------------------------------------------
// Lectura de poemas: carga los poemas de la estación actual desde su
// YAML (assets/poemas/<estacion>.yaml), los ordena por fecha y los
// muestra en una columna, cada uno con su fecha. El mosaico queda fijo
// de fondo (ver style.css) y cada poema entra con un fundido cuando
// aparece en pantalla al hacer scroll.
// La estación activa (CURRENT_SEASON) se resuelve más arriba, junto con
// el mapa ESTACIONES.
// ---------------------------------------------------------------------
const poemCard = document.getElementById('poemCard');

// =====================================================================
// EFECTO ESCRITURA (opcional)
// ---------------------------------------------------------------------
// Cuando un poema entra en pantalla, su título y sus versos no aparecen
// de golpe: se "teclean" letra por letra, uno abajo del otro, con un
// cursor parpadeante al final de la línea que se está escribiendo.
//
// El tecleo no arranca hasta que el mosaico de fondo terminó de
// dibujarse: los poemas que ya están en pantalla esperan en cola y
// empiezan todos juntos cuando el mosaico está listo (ver mosaicReady /
// markMosaicReady).
//
// PARA DESACTIVARLO: poné EFECTO_ESCRITURA en false. Los poemas siguen
// entrando con el fundido de siempre, pero con el texto completo desde
// el arranque (sin tecleo ni cursor). No hace falta tocar nada más.
//
// El efecto también se apaga solo si el sistema pide menos movimiento
// (prefers-reduced-motion).
//
// Cada poema se teclea cuando entra en pantalla al hacer scroll y queda
// completo y quieto.
//
// Para ajustar el ritmo sin desactivarlo, tocá los tiempos de abajo (en
// milisegundos):
//   TYPE_CHAR_MS        - lo que tarda cada letra (más alto = más lento)
//   TYPE_LINE_PAUSE     - pausa al saltar de un verso al siguiente
//   TYPE_SENTENCE_PAUSE - pausa larga en las paradas fuertes: punto,
//                         signos de exclamación/interrogación, puntos
//                         suspensivos y punto y coma (. ! ? … ;)
//   TYPE_COMMA_PAUSE    - pausa media en las paradas suaves: coma y dos
//                         puntos (, :)
//
// BORRADO POR INACTIVIDAD:
//   Con ESCRITURA_CONSTANTE en true, si la pantalla se mantiene SIN
//   ninguna señal de actividad —ni scroll, ni mover el cursor, ni rueda,
//   ni teclas, ni toques— durante TYPE_IDLE_BORRAR_MS (30 s), cada poema
//   visible ya tecleado se borra solo —de atrás hacia adelante, letra por
//   letra, tomándose también las pausas en los puntos y las comas, aunque
//   sea al revés— y después se vuelve a teclear desde cero.
//   Cualquier actividad reinicia esa cuenta de 30 s. Y si llega mientras
//   el poema se está borrando, el borrado se FRENA en el acto y el poema
//   se completa desde donde había quedado (no reinicia de cero).
//   Con ESCRITURA_CONSTANTE en false se teclea una sola vez y queda fijo.
//   Tiempos del borrado (ms):
//     TYPE_ERASE_MS       - lo que tarda en borrarse cada letra (las
//                           pausas de punto y coma se respetan igual)
//     TYPE_IDLE_BORRAR_MS - cuánto hay que estar sin actividad para que
//                           el poema empiece a borrarse
//     TYPE_EMPTY_MS       - pausa con el poema vacío antes de reescribirlo
//     SCROLL_RESET_MS     - cada cuánto, como mucho, la actividad seguida
//                           (mousemove sobre todo) se procesa
// =====================================================================
const EFECTO_ESCRITURA = false;

const TYPE_CHAR_MS = 33;
const TYPE_LINE_PAUSE = 280;
const TYPE_SENTENCE_PAUSE = 900;
const TYPE_COMMA_PAUSE = 370;
const PUNTO = /[.!?…;]/;         // parada fuerte (. ! ? … ;): pausa larga
const COMA = /[,:]/;             // parada suave (, :): pausa media
const FIN_ORACION = /[.!?…;]$/;  // el verso cierra una oración (o punto y coma)

const ESCRITURA_CONSTANTE = true;
const TYPE_ERASE_MS = 32;
const TYPE_IDLE_BORRAR_MS = 30000;
const TYPE_EMPTY_MS = 700;
const SCROLL_RESET_MS = 200;
// prefersReducedMotion está definido arriba de todo (lo comparten los
// dos efectos).

// efecto escritura: decide qué hacer con un poema que acaba de entrar en
// pantalla. Si el efecto está apagado (o el sistema pide menos
// movimiento), vuelca el texto completo sin animar. Si el mosaico de
// fondo todavía se está armando, deja el poema en cola. Si ya está todo
// listo, lo empieza a teclear.
function startTypewriter(article) {
  const targets = (article && article._typeTargets) || [];
  if (targets.length === 0) return;

  if (!EFECTO_ESCRITURA || prefersReducedMotion) {
    targets.forEach(el => { el.textContent = el.dataset.full || ''; });
    return;
  }

  if (!mosaicReady) {
    pendingTypewriter.push(article);
    return;
  }

  runTypewriter(article);
}

// efecto escritura: se llama cuando el mosaico de fondo ya está dibujado.
// Marca la bandera y suelta el tecleo de todos los poemas que quedaron
// esperando en la cola.
function markMosaicReady() {
  if (mosaicReady) return;
  mosaicReady = true;
  pendingTypewriter.splice(0).forEach(runTypewriter);
  // recién con las fotos dibujadas se dejan aparecer los poemas y las fechas
  if (revealPendiente) { revealPendiente = false; revealOnScroll(); }
  // efecto texturas: recién ahora la página tiene su alto final (el
  // canvas del mosaico ya está dibujado), así que es el momento de armar
  // la capa de texturas. Si se armara antes, las fotos se repartirían
  // sobre un alto provisorio y después "saltarían" a otro lugar cuando
  // el mosaico agranda la página.
  construirTexturas();
}

// Red de seguridad: si el mosaico nunca llega a terminar (por ejemplo,
// si fallan las imágenes de assets/imagenes), igual arrancamos los
// poemas después de unos segundos para que la página no quede muda. Se
// da un margen amplio porque invierno carga más fotos y tarda más; si
// aun así salta antes de tiempo, construirTexturas reintenta hasta que
// el canvas existe, así las texturas no quedan desalineadas.
setTimeout(markMosaicReady, 12000);

// Cuánto esperar después de una letra según qué signo se acaba de tocar:
// pausa larga en las paradas fuertes (. ! ? … ;), media en las suaves
// (, :), y el ritmo `base` en cualquier otro caso. `base` es el ritmo
// normal: el del tecleo al escribir, o el del borrado al borrar.
function pausaTrasSigno(ch, base) {
  if (ch && PUNTO.test(ch)) return TYPE_SENTENCE_PAUSE;
  if (ch && COMA.test(ch)) return TYPE_COMMA_PAUSE;
  return base;
}

// efecto escritura: teclea de verdad un poema. Recorre en orden sus
// elementos "tecleables" (título y versos, guardados en
// article._typeTargets con su texto en dataset.full) y va escribiendo
// cada uno carácter a carácter. Mientras una línea se teclea (o se borra)
// lleva la clase .typing, que en style.css le dibuja un cursor
// parpadeante al final.
//
// Cada pasada (teclear o borrar) lleva un número de generación
// (article._twGen). Si algo la cancela —por ejemplo, la persona mueve el
// cursor mientras el poema se está borrando— se sube ese número y la
// pasada vieja, al despertar de su próximo setTimeout, ve que ya no es la
// vigente y se corta sola. article._twEstado lleva en qué anda el poema:
// 'escribiendo', 'listo' (tecleado y quieto) o 'borrando'.

// Teclea los targets de un poema. Reanuda desde lo que cada verso ya
// tenga escrito (útil cuando venimos de frenar un borrado a mitad de
// camino) y llama a onDone al terminar.
function escribirTodo(targets, gen, article, onDone) {
  let ti = 0;
  (function typeElement() {
    if (article._twGen !== gen) return;
    if (ti >= targets.length) { if (onDone) onDone(); return; }
    const el = targets[ti];
    const full = el.dataset.full || '';
    // Si lo que hay ya es un prefijo de full, seguí desde ahí; si no,
    // arrancá de cero. Un verso ya completo se saltea sin tocarlo.
    let ci = full.startsWith(el.textContent) ? el.textContent.length : 0;
    if (ci >= full.length) {
      el.classList.remove('typing');
      ti++;
      typeElement();
      return;
    }
    el.classList.add('typing');
    (function typeChar() {
      if (article._twGen !== gen) return;
      el.textContent = full.slice(0, ci);
      if (ci < full.length) {
        // si la letra recién tecleada fue un punto o una coma y todavía
        // queda verso por delante, frená un momento antes de seguir.
        const recien = ci > 0 ? full[ci - 1] : '';
        ci++;
        setTimeout(typeChar, pausaTrasSigno(recien, TYPE_CHAR_MS));
      } else {
        el.classList.remove('typing');
        ti++;
        // pausa larga si el verso cierra una oración, pausa corta si solo
        // es un salto de línea dentro de la frase.
        const cierraOracion = FIN_ORACION.test(full.replace(/["'»)\]]+$/, ''));
        setTimeout(typeElement, cierraOracion ? TYPE_SENTENCE_PAUSE : TYPE_LINE_PAUSE);
      }
    })();
  })();
}

// Borra los targets del último al primero, letra por letra. Aunque vaya
// al revés, se toma las mismas pausas: si al sacar una letra la que queda
// expuesta al final es un punto o una coma, frena igual que al escribir.
function borrarTodo(targets, gen, article, onDone) {
  let ti = targets.length - 1;
  (function eraseElement() {
    if (article._twGen !== gen) return;
    if (ti < 0) { if (onDone) onDone(); return; }
    const el = targets[ti];
    el.classList.add('typing');
    (function eraseChar() {
      if (article._twGen !== gen) return;
      const txt = el.textContent;
      if (txt.length > 0) {
        const quedan = txt.slice(0, -1);
        el.textContent = quedan;
        const ultimo = quedan ? quedan[quedan.length - 1] : '';
        setTimeout(eraseChar, pausaTrasSigno(ultimo, TYPE_ERASE_MS));
      } else {
        el.classList.remove('typing');
        ti--;
        // pausa entre versos, al revés: si el verso de arriba (el que sigue
        // en borrarse) cierra una oración, respirá antes de atacarlo.
        const prev = ti >= 0 ? (targets[ti].dataset.full || '') : '';
        const cierraOracion = FIN_ORACION.test(prev.replace(/["'»)\]]+$/, ''));
        setTimeout(eraseElement, cierraOracion ? TYPE_SENTENCE_PAUSE : TYPE_LINE_PAUSE);
      }
    })();
  })();
}

function runTypewriter(article) {
  const targets = (article && article._typeTargets) || [];
  if (targets.length === 0) return;
  // Ya se está tecleando o borrando: no arrancar otra pasada encima.
  if (article._twEstado === 'escribiendo' || article._twEstado === 'borrando') return;
  article._twEstado = 'escribiendo';
  article._twGen = (article._twGen || 0) + 1;
  const gen = article._twGen;
  escribirTodo(targets, gen, article, () => {
    if (article._twGen !== gen) return;
    article._twEstado = 'listo';
    programarBorradoOcioso(article);
  });
}

// BORRADO POR INACTIVIDAD: borra el poema y lo vuelve a teclear, y al
// terminar deja armada otra cuenta de inactividad. Solo aplica a un poema
// que ya terminó de escribirse ('listo').
function reescribirCiclo(article) {
  const targets = (article && article._typeTargets) || [];
  if (targets.length === 0) return;
  if (article._twEstado !== 'listo') return;
  article._twEstado = 'borrando';
  article._twGen = (article._twGen || 0) + 1;
  const gen = article._twGen;
  borrarTodo(targets, gen, article, () => {
    if (article._twGen !== gen) return;
    article._twEstado = 'escribiendo';
    setTimeout(() => {
      if (article._twGen !== gen) return;
      escribirTodo(targets, gen, article, () => {
        if (article._twGen !== gen) return;
        article._twEstado = 'listo';
        programarBorradoOcioso(article);
      });
    }, TYPE_EMPTY_MS);
  });
}

// Si el poema se está borrando y algo lo interrumpe (la persona mueve el
// cursor o scrollea), cortá el borrado y volvé a teclear desde donde
// quedó hasta completarlo.
function frenarBorradoYCompletar(article) {
  if (article._twEstado !== 'borrando') return;
  if (article._idleTimer) { clearTimeout(article._idleTimer); article._idleTimer = null; }
  article._twGen = (article._twGen || 0) + 1;
  const gen = article._twGen;
  article._twEstado = 'escribiendo';
  escribirTodo(article._typeTargets || [], gen, article, () => {
    if (article._twGen !== gen) return;
    article._twEstado = 'listo';
    programarBorradoOcioso(article);
  });
}

// BORRADO POR INACTIVIDAD: (re)arranca la cuenta de TYPE_IDLE_BORRAR_MS
// para un poema. Si al vencer el poema sigue 'listo' y visible, dispara el
// ciclo borrar + reescribir; si quedó fuera de pantalla, vuelve a esperar.
// Cualquier actividad de la persona llama a esto de nuevo y reinicia la cuenta.
function programarBorradoOcioso(article) {
  if (!EFECTO_ESCRITURA || !ESCRITURA_CONSTANTE || prefersReducedMotion) return;
  if (article._idleTimer) clearTimeout(article._idleTimer);
  article._idleTimer = setTimeout(() => {
    article._idleTimer = null;
    if (article._twEstado !== 'listo') return;
    if (!poemaEnPantalla(article)) { programarBorradoOcioso(article); return; }
    reescribirCiclo(article);
  }, TYPE_IDLE_BORRAR_MS);
}

// ¿Este poema está, aunque sea en parte, dentro de la pantalla?
function poemaEnPantalla(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
}

// BORRADO POR INACTIVIDAD: cualquier señal de que la persona está ahí
// —scroll, mover el cursor, la rueda del mouse, una tecla, un toque en la
// pantalla— cuenta como actividad. Con cada actividad:
//   - un poema que se está BORRANDO frena y vuelve a completarse;
//   - un poema 'listo' reinicia su cuenta de 30 s.
// Las señales que llegan seguidas (mousemove sobre todo) se juntan: como
// mucho un disparo cada SCROLL_RESET_MS.
let actividadPend = false;
function alHaberActividad() {
  if (!EFECTO_ESCRITURA || !ESCRITURA_CONSTANTE || prefersReducedMotion) return;
  if (actividadPend) return;
  actividadPend = true;
  setTimeout(() => {
    actividadPend = false;
    poemCard.querySelectorAll('.poem').forEach(article => {
      if (article._twEstado === 'borrando') frenarBorradoYCompletar(article);
      else if (article._twEstado === 'listo') programarBorradoOcioso(article);
    });
  }, SCROLL_RESET_MS);
}
['scroll', 'mousemove', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(ev => {
  window.addEventListener(ev, alHaberActividad, { passive: true });
});

function renderPoemList(poems) {
  poemCard.innerHTML = '';

  poems
    .slice()
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .forEach((poem, poemIndex) => {
      const article = document.createElement('article');
      article.className = 'poem';
      // efecto escritura: elementos que se van a teclear, en orden.
      const typeTargets = [];
      // Poemas impares (1º, 3º…) van pegados a la izquierda; los pares a la
      // derecha (ver .poem:nth-child en style.css). El escalonado diagonal
      // tiene que correrse hacia el lado contrario al margen de cada uno.
      const alignRight = poemIndex % 2 === 1;

      if (poem.fecha_texto) {
        const fecha = document.createElement('div');
        fecha.className = 'poem-fecha';
        fecha.textContent = poem.fecha_texto;
        article.appendChild(fecha);
      }

      if (poem.titulo) {
        const titulo = document.createElement('h2');
        titulo.className = 'poem-titulo';
        // efecto escritura: el texto real queda en dataset.full y el
        // elemento arranca vacío; startTypewriter lo va llenando.
        titulo.dataset.full = poem.titulo;
        article.appendChild(titulo);
        typeTargets.push(titulo);
      }

      // Escalonado diagonal: cada línea de una frase encabalgada se corre un
      // escalón más adentro que la anterior. La frase "abre" en cuanto una
      // línea NO termina en coma, dos puntos, punto y coma o punto, y sigue
      // escalonando en cada línea siguiente —incluida la que finalmente cierra
      // con esos signos, que arrastra la distancia acumulada— hasta que después
      // de esa línea de cierre se vuelve al margen.
      const STEP_EM = 1.6;          // ancho de cada escalón
      const MAX_LEVEL = 8;          // tope para que no se escape del recuadro
      const CIERRA = /[,;:.]$/;     // signos que cortan la diagonal
      let level = 0;
      let vieneAbierta = false;     // la línea anterior quedó sin cerrar

      (poem.texto || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
          const cierra = CIERRA.test(line.replace(/["'»)\]]+$/, ''));
          if (!cierra || vieneAbierta) level = Math.min(level + 1, MAX_LEVEL);

          const p = document.createElement('p');
          p.className = 'poem-linea';
          // efecto escritura: el verso arranca vacío; su texto vive en
          // dataset.full hasta que startTypewriter lo teclea.
          p.dataset.full = line;
          if (level > 0) {
            p.style[alignRight ? 'marginRight' : 'marginLeft'] = (level * STEP_EM) + 'em';
          }
          article.appendChild(p);
          typeTargets.push(p);

          vieneAbierta = !cierra;
          if (cierra) level = 0;
        });

      // efecto escritura: se dispara cuando el poema entra en pantalla
      // (ver revealOnScroll).
      article._typeTargets = typeTargets;
      poemCard.appendChild(article);
    });

  revealOnScroll();
}

// Muestra cada poema (título, fecha y versos) con un fundido cuando entra
// en el viewport. No arranca hasta que el mosaico de fotos terminó de
// dibujarse: si todavía no, se deja en espera y markMosaicReady() vuelve
// a llamar acá. Así los poemas y las fechas aparecen junto con las fotos.
function revealOnScroll() {
  if (!mosaicReady) { revealPendiente = true; return; }
  const items = poemCard.querySelectorAll('.poem');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => {
      el.classList.add('visible');
      startTypewriter(el);
    });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        startTypewriter(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' });
  items.forEach(el => io.observe(el));
}

function loadSeasonPoem(season) {
  if (!poemCard || typeof jsyaml === 'undefined') return;
  // ?t=... para que al actualizar los poemas se vean sin esperar la caché
  fetch('assets/poemas/' + season + '.yaml?t=' + Date.now(), { cache: 'no-store' })
    .then(res => res.text())
    .then(yamlText => {
      const poems = jsyaml.load(yamlText);
      if (!Array.isArray(poems) || poems.length === 0) return;
      renderPoemList(poems);
    })
    .catch(err => console.error('No se pudieron cargar los poemas:', err));
}

if (CURRENT_SEASON) loadSeasonPoem(CURRENT_SEASON);

// =====================================================================
// EFECTO TEXTURAS (opcional)
// ---------------------------------------------------------------------
// Una capa de fotos horizontales (rectángulos apaisados) SUPERPUESTA
// encima del mosaico: va por encima del mosaico y del velo turquesa, y
// por debajo de los poemas (ver .textura-capa en style.css, z-index 4).
// El mosaico y los poemas quedan igual que antes.
//
// No es una franja arriba de la web: la capa cubre toda la altura de la
// página (la misma que el mosaico) y las fotos se reparten a lo largo de
// todo el scroll, parejo de arriba a abajo (sin dejar más de 9 cuadrados
// del mosaico de hueco entre una y la siguiente, así no quedan zonas
// peladas, sobre todo el medio de la web). Cada foto sale con:
//   - una imagen elegida al azar de la lista: se pueden repetir;
//   - un `top` con un poco de jitter alrededor de su lugar del reparto,
//     pero ANCLADO a la grilla del mosaico, de una de dos maneras (al
//     azar por foto): o el borde de arriba arranca donde arranca un
//     recorte del mosaico, o arranca a la mitad de la altura de un
//     recorte. Las fotos PUEDEN encimarse entre ellas, pero nunca
//     tapándose más del 60% (control por solape vertical);
//   - el lado por el que entra al azar (mitad desde cada costado);
//   - una velocidad de deslizamiento propia: unas cruzan más rápido y
//     otras más lento, y si dos quedan verticalmente cerca se les fuerza
//     velocidades bien distintas para que no crucen la pantalla pegadas;
//   - un ancho al azar de 5 o 6 cuadrados de la grilla; el alto es fijo
//     en 2 cuadrados del mosaico (rectángulos 2x5 o 2x6; ver style.css).
//
// En los dos modos cada foto hace el mismo recorrido: CRUZA la pantalla
// de lado a lado. Entra por un extremo, la atraviesa entera y desaparece
// por el otro (la capa recorta lo que se sale con overflow: hidden). Lo
// que cambia entre modos es QUÉ mueve ese cruce, y se elige con
// TEXTURAS_MODO:
//
//   'scroll' (actual) - cada foto se queda quieta en su lugar y solo
//                avanza en su cruce cuando scrolleás. Su posición
//                horizontal está atada a qué tan arriba del viewport va:
//                centro abajo de la pantalla = recién asomando por un
//                costado; centro arriba = terminó de cruzar y desapareció
//                por el otro. Página quieta = fotos quietas.
//
//   'constante'       - el cruce lo maneja un reloj, no el scroll: las
//                fotos cruzan solas, sin parar y en bucle (marquesina),
//                aunque la página esté quieta. Cada una va desfasada de
//                las demás para que no crucen todas juntas.
//
// PARA DESACTIVARLO: poné EFECTO_TEXTURAS en false. La capa no se arma y
// no pasa nada más.
//
// PARA CAMBIAR LAS FOTOS: poné los archivos en assets/imagenes/ y editá
// TEXTURAS_IMAGE_PATHS. Como las fotos se eligen al azar y se pueden
// repetir, el orden de la lista no importa. Con la lista vacía, la capa
// queda oculta (ver .textura-capa:empty en style.css).
//
// Ajustes:
//   TEXTURAS_CANTIDAD     - cuántas fotos se colocan en total (pueden
//                           repetirse imágenes de la lista). Es un
//                           mínimo: si hicieran falta más para no dejar
//                           más de 9 cuadrados de hueco, se agregan.
//   TEXTURAS_SCROLL_TRAMO - solo modo 'scroll': en cuántas pantallas de
//                           scroll se completa el cruce de una foto. Más
//                           alto = la foto se desliza más lento (hay que
//                           scrollear más para que cruce). 1 = el cruce
//                           entra justo en una pantalla.
//   TEXTURAS_CICLO_MS     - solo modo 'constante': cuánto tarda una foto
//                           en cruzar toda la pantalla una vez (ms). Más
//                           alto = cruce más lento.
//
// Se apaga solo si el sistema pide menos movimiento
// (prefers-reduced-motion): las fotos quedan quietas en su lugar.
// =====================================================================
const EFECTO_TEXTURAS = true;
const TEXTURAS_MODO = 'scroll'; // 'scroll' | 'constante'
const TEXTURAS_CANTIDAD = 14;
const TEXTURAS_SCROLL_TRAMO = 4;
const TEXTURAS_IMAGE_PATHS = SEASON_CFG.texturas;
const TEXTURAS_CICLO_MS = 24000;

// Ajuste fino vertical de TODAS las texturas, en píxeles. 0 = sobre la
// línea de la grilla del mosaico. Negativo = suben; positivo = bajan.
// Quedaban sistemáticamente un poquito por debajo de los recortes, así
// que se las sube unos px. Si todavía no calzan, movés este número:
// más negativo = más arriba; hacia 0 = más abajo.
const TEXTURAS_AJUSTE_PX = -1.35;

const texturaCapa = document.getElementById('texturaCapa');

// Fisher-Yates: mezcla el array en el lugar.
function barajar(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function construirTexturas() {
  if (!EFECTO_TEXTURAS || !texturaCapa || TEXTURAS_IMAGE_PATHS.length === 0) return;
  if (texturaCapa.children.length) return; // ya armada: no duplicar

  // La capa se ancla a la grilla del mosaico, así que necesita el <canvas>
  // ya en el DOM y con su alto final. Si todavía no está (mosaico lento
  // —invierno tiene más fotos que otoño— o si saltó antes la red de
  // seguridad de markMosaicReady), reintenta en lugar de repartir las
  // texturas sobre un alto provisorio y dejarlas desalineadas.
  const canvasEl = document.querySelector('#canvas-holder canvas');
  if (!canvasEl || !canvasEl.height) {
    setTimeout(construirTexturas, 400);
    return;
  }

  // Medidas fijas de cada rectángulo, en cuadrados de la grilla:
  //   alto  = 2 cuadrados (recortes del mosaico). Cada recorte mide
  //           --col/2 de alto, así que 2 recortes = --col * 1.
  //   ancho = 5 o 6 cuadrados (columnas), al azar por foto.
  const ALTO_CUADRADOS = 1;          // en unidades de --col (= 2 recortes)
  const ALTO_FILAS = ALTO_CUADRADOS * 2;  // la textura ocupa 2 filas
  const anchos = [5, 6];

  // Hueco vertical máximo permitido entre una textura y la de al lado:
  // 9 cuadrados (recortes) = 9 filas del mosaico. Se usa para repartirlas
  // parejo y que no queden zonas peladas (sobre todo el medio de la web).
  const MAX_HUECO_FILAS = 9;

  // Tapado máximo: una textura no puede quedar sobre otra tapándola más
  // del 60% de su alto.
  const MAX_TAPADO = 0.6;

  // Velocidades: cada foto se desliza a su propio ritmo (factor sobre el
  // ritmo base; <1 más lenta, >1 más rápida). Además, si una foto queda
  // cerca de otra en vertical, se le busca una velocidad bien distinta
  // de esa vecina para que no crucen la pantalla pegadas.
  const VEL_MIN = 0.55, VEL_SPAN = 1.2;   // vel en [0.55, 1.75]
  const VEL_DIF_MIN = 0.45;               // separación mínima con una vecina

  // Geometría REAL del mosaico en pantalla, medida del propio <canvas> (no
  // se supone ni el nº de columnas ni el ancho del viewport). `rs` = qué
  // tanto se agranda/achica el canvas al mostrarse (px de pantalla por px
  // de canvas); de ahí, el ancho de una columna y el alto de una fila
  // (recorte) EXACTOS. Con tileW 120 : tileH 60, la fila es media columna.
  const layout = currentLayout || { tileW: 120, tileH: 60 };
  const canvasRect = canvasEl.getBoundingClientRect();
  const rs = canvasRect.width / (canvasEl.width || canvasRect.width || 1);
  const colPx = layout.tileW * rs;
  const filaPx = layout.tileH * rs;
  texturaCapa.style.setProperty('--col', colPx + 'px');

  // Dónde arranca el mosaico DENTRO de la capa. Normalmente 0 (las dos son
  // inset:0 sobre .contenido), pero si por layout el <canvas> quedara unos
  // px más abajo, esta medición lo compensa exacto. Más el ajuste fino
  // manual (TEXTURAS_AJUSTE_PX). El `top` de cada textura se calcula en px
  // a partir de acá, no con calc(var(--col) ...), para que caiga sobre la
  // línea de la grilla pase lo que pase con el layout.
  const capaRect = texturaCapa.getBoundingClientRect();
  const offsetY = (canvasRect.top - capaRect.top) + TEXTURAS_AJUSTE_PX;

  const pageH = canvasRect.height ||
                texturaCapa.offsetHeight ||
                document.documentElement.scrollHeight || 1;
  const filasTotal = Math.max(6, Math.floor(pageH / filaPx));

  // Cuántas texturas: las pedidas (por estación con texturasCantidad, o
  // TEXTURAS_CANTIDAD por defecto), pero nunca menos de las que hacen
  // falta para que ninguna quede a más de MAX_HUECO_FILAS de la siguiente.
  const cantidadPedida = (SEASON_CFG && SEASON_CFG.texturasCantidad) || TEXTURAS_CANTIDAD;
  const cuantasMin = 1 + Math.ceil((filasTotal - ALTO_FILAS) /
                                   (MAX_HUECO_FILAS + ALTO_FILAS));
  const cuantas = Math.max(1, cantidadPedida, cuantasMin);

  // Reparto vertical parejo: la textura i apunta a la fila i * pasoFilas,
  // desde la 0 (arriba de todo) hasta filasTotal - ALTO_FILAS (abajo de
  // todo). El jitter que se le permite alrededor es lo que sobra para
  // llegar justo al límite de hueco, así el reparto no queda rígido pero
  // tampoco deja zonas peladas.
  const pasoFilas = cuantas > 1 ? (filasTotal - ALTO_FILAS) / (cuantas - 1) : 0;
  const jitterFilas = Math.max(0, Math.min(
    pasoFilas / 2,
    // "- 1" para absorber el redondeo de k a fila entera en los dos extremos
    (MAX_HUECO_FILAS + ALTO_FILAS - pasoFilas - 1) / 2,
    3));

  // Lado de entrada: mitad desde cada costado, repartidos al azar.
  const dirs = [];
  for (let i = 0; i < cuantas; i++) dirs.push(i < cuantas / 2 ? -1 : 1);
  barajar(dirs);

  // Control de solape: se guarda el tramo vertical [a, b] en px y la vel
  // de cada textura ya puesta.
  const puestas = [];
  // ninguna textura tapa a otra más de MAX_TAPADO del alto de la más chica.
  function solapeOK(a, b) {
    return puestas.every(o => {
      const ov = Math.max(0, Math.min(b, o.b) - Math.max(a, o.a));
      return ov <= MAX_TAPADO * Math.min(b - a, o.b - o.a);
    });
  }
  // "vecinas" verticales: se enciman o quedan a menos de medio alto de
  // separación. Son las que se verían avanzar al lado de esta.
  function vecinas(a, b) {
    return puestas.filter(o => {
      const sep = Math.max(a, o.a) - Math.min(b, o.b); // >0 si hay hueco
      return sep < 0.5 * Math.min(b - a, o.b - o.a);
    });
  }

  for (let i = 0; i < cuantas; i++) {
    const fig = document.createElement('figure');
    fig.className = 'textura-slide';
    fig.dataset.dir = String(dirs[i]);
    // modo 'constante': desfasaje al azar para que no crucen sincronizadas.
    fig.dataset.fase = Math.random().toFixed(4);

    // ancho al azar (5 o 6 cuadrados); alto fijo en 2 cuadrados. Ver style.css.
    const w = anchos[Math.floor(Math.random() * anchos.length)];
    fig.style.setProperty('--w', 'calc(var(--col) * ' + w + ')');
    fig.style.setProperty('--h', 'calc(var(--col) * ' + ALTO_CUADRADOS + ')');

    // top ANCLADO a la grilla del mosaico: el borde de arriba arranca
    // donde arranca un recorte -> k filas -> top = --col * (k/2). La fila
    // k sale del reparto parejo (i * pasoFilas) más un jitter chico, y se
    // reintenta si taparía a otra textura más del 60% (MAX_TAPADO).
    //
    // Antes la mitad de las texturas arrancaban a MEDIA fila (a la mitad
    // de un recorte); se leía como que "parten un poco más abajo" de la
    // grilla. Ahora todas caen sobre una línea entera. Para volver a
    // permitir el arranque a media fila:
    //   const enMedio = Math.random() < 0.5;
    const hPx = ALTO_CUADRADOS * colPx;        // alto de la textura (2 filas)
    const enMedio = false;
    // la fila de arranque no puede pasar la última que deja entrar las
    // 2 filas de alto sin cortarse por abajo (media fila menos si arranca
    // "en la mitad").
    const kMax = filasTotal - ALTO_FILAS - (enMedio ? 1 : 0);
    const kIdeal = i * pasoFilas;
    let k, a, b, intento = 0;
    do {
      const jit = (Math.random() * 2 - 1) * jitterFilas;
      k = Math.round(kIdeal + jit);
      k = Math.max(0, Math.min(kMax, k));
      a = k * filaPx + (enMedio ? filaPx / 2 : 0);
      b = a + hPx;
    } while (!solapeOK(a, b) && ++intento < 40);
    // top en px, medido desde donde arranca el mosaico (offsetY) + k
    // filas reales. Cae sobre la línea k de la grilla del recorte.
    fig.style.top = (offsetY + k * filaPx).toFixed(2) + 'px';

    // velocidad: al azar, pero separada de la de sus vecinas verticales.
    const cerca = vecinas(a, b);
    let vel = VEL_MIN + Math.random() * VEL_SPAN;
    if (cerca.length) {
      let mejor = vel, mejorDif = -1;
      for (let t = 0; t < 30; t++) {
        const cand = VEL_MIN + Math.random() * VEL_SPAN;
        const dif = Math.min.apply(null, cerca.map(o => Math.abs(cand - o.vel)));
        if (dif >= VEL_DIF_MIN) { mejor = cand; break; }
        if (dif > mejorDif) { mejorDif = dif; mejor = cand; }
      }
      vel = mejor;
    }
    fig.dataset.vel = vel.toFixed(3);
    puestas.push({ a, b, vel });

    const img = new Image();
    // imagen al azar de la lista: se puede repetir.
    img.src = TEXTURAS_IMAGE_PATHS[Math.floor(Math.random() * TEXTURAS_IMAGE_PATHS.length)];
    img.alt = '';
    img.loading = 'lazy';
    fig.appendChild(img);
    texturaCapa.appendChild(fig);
  }
  if (TEXTURAS_MODO === 'scroll') iniciarDeslizScroll();
  else iniciarDeslizConstante();
  // fundido de entrada: ya colocadas las fotos, mostramos la capa (ver
  // .textura-capa / .textura-capa.lista en style.css).
  requestAnimationFrame(() => texturaCapa.classList.add('lista'));
}

// efecto texturas: coloca una foto en el punto `p` (0..1) de su cruce de
// lado a lado. p = 0 → fuera de la pantalla por un costado; p = 1 → fuera
// por el opuesto; p = 0,5 → centrada. Hacia qué lado cruza lo decide
// `dir` (+1 hacia la derecha, -1 hacia la izquierda). El recorrido es el
// ancho de la capa + el ancho de la foto, así entra y sale del todo. Es
// el paso común a los dos modos: lo que cambia es de dónde sale `p`.
function colocarCruce(slide, p, anchoCapa) {
  const dir = parseFloat(slide.dataset.dir) || -1;
  const w = slide.offsetWidth;
  const baseLeft = slide.offsetLeft; // posición natural dentro de la capa
  const recorrido = anchoCapa + w;
  // borde izquierdo buscado: de -w (fuera por la izquierda) a anchoCapa
  // (fuera por la derecha), o al revés.
  const objetivoLeft = dir > 0 ? -w + p * recorrido
                               : anchoCapa - p * recorrido;
  slide.style.transform = 'translateX(' + (objetivoLeft - baseLeft).toFixed(1) + 'px)';
}

// efecto texturas, modo 'constante': un único bucle de animación lleva el
// `p` de cada foto de 0 a 1 sin parar y en bucle (marquesina). `fase` la
// desincroniza del resto y `vel` le da su propio ritmo (divide la
// duración del ciclo: vel > 1 = ciclo más corto = cruza más rápido).
function iniciarDeslizConstante() {
  const slides = Array.from(texturaCapa.querySelectorAll('.textura-slide'));
  if (slides.length === 0) return;

  if (prefersReducedMotion) {
    slides.forEach(s => { s.style.transform = 'none'; });
    return;
  }

  const inicio = performance.now();
  function frame(ahora) {
    const anchoCapa = texturaCapa.clientWidth || window.innerWidth;
    const transcurrido = ahora - inicio;
    slides.forEach(slide => {
      const fase = parseFloat(slide.dataset.fase) || 0;
      const vel = parseFloat(slide.dataset.vel) || 1;
      const t = transcurrido / (TEXTURAS_CICLO_MS / vel);
      let p = (t + fase) % 1;
      if (p < 0) p += 1;
      colocarCruce(slide, p, anchoCapa);
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// efecto texturas, modo 'scroll': el `p` de cada foto sale de qué tan
// arriba del viewport va su centro, repartido en un tramo de pantallas
// de scroll. El tramo base es TEXTURAS_SCROLL_TRAMO, pero cada foto lo
// divide por su `vel` para deslizarse a su propio ritmo (vel > 1 = tramo
// más corto = cruza con menos scroll = más rápido). El cruce arranca con
// la foto media pantalla por debajo del borde inferior (p = 0) y termina
// media pantalla por encima del superior (p = 1). Con el scroll parado
// no se mueve.
function iniciarDeslizScroll() {
  const slides = Array.from(texturaCapa.querySelectorAll('.textura-slide'));
  if (slides.length === 0) return;

  if (prefersReducedMotion) {
    slides.forEach(s => { s.style.transform = 'none'; });
    return;
  }

  const tramoBase = Math.max(1, TEXTURAS_SCROLL_TRAMO);
  let ticking = false;
  function actualizar() {
    ticking = false;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const anchoCapa = texturaCapa.clientWidth || window.innerWidth;
    slides.forEach(slide => {
      const vel = parseFloat(slide.dataset.vel) || 1;
      const tramo = Math.max(1, tramoBase / vel);
      // ventana de scroll (en px) donde ocurre el cruce de ESTA foto:
      // `tramo` pantallas, centradas en cuando está en el medio vertical.
      const desde = vh * (tramo + 1) / 2; // centro acá → p = 0
      const rango = vh * tramo;           // desde - hasta
      const r = slide.getBoundingClientRect();
      const centro = r.top + r.height / 2;
      let p = (desde - centro) / rango;
      p = Math.max(0, Math.min(1, p));
      colocarCruce(slide, p, anchoCapa);
    });
  }
  function alScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(actualizar);
  }
  // El scroll ahora vive en .scroll-area (arranca debajo de la barra), no
  // en window. Escuchamos ahí; el resize sigue en window.
  const scroller = document.querySelector('.scroll-area') || window;
  scroller.addEventListener('scroll', alScroll, { passive: true });
  window.addEventListener('resize', alScroll, { passive: true });
  actualizar();
}

// La capa de texturas se arma desde markMosaicReady(), no acá: hay que
// esperar a que el mosaico termine de dibujarse para que la página tenga
// su alto final. Si no, las fotos se reparten sobre un alto provisorio y
// después saltan de lugar. (markMosaicReady tiene su propia red de
// seguridad a los 8 s por si el mosaico nunca termina.)

function renderFlowMosaic(tiles, rowHeight, minWidth, maxWidth, onDone) {
  // Fixed-height row flow: tiles keep whatever width they were extracted at
  // (already between minWidth and maxWidth) and simply wrap to a new row
  // once the current row would overflow the target canvas width.
  const n = tiles.length;
  const avgWidth = (minWidth + maxWidth) / 2;
  const targetWidth = Math.max(WORK_DIM, Math.round(Math.sqrt(n * avgWidth * rowHeight)));

  let x = 0, y = 0;
  const placements = [];
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    if (x > 0 && x + t.w > targetWidth) {
      x = 0;
      y += rowHeight;
    }
    placements.push({ x, y, tile: t });
    x += t.w;
  }
  const canvasHeight = y + rowHeight;

  const holder = document.getElementById('canvas-holder');
  holder.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffdf3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  holder.appendChild(canvas);
  mosaicCanvas = canvas;

  let i = 0;
  const BATCH = 80;
  function drawStep() {
    const end = Math.min(i + BATCH, placements.length);
    for (; i < end; i++) {
      const p = placements[i];
      ctx.putImageData(p.tile.imgData, p.x, p.y);
    }
    if (i < placements.length) {
      setTimeout(drawStep, 0);
    } else if (onDone) {
      onDone();
    }
  }
  drawStep();
}

// =====================================================================
// BARRA DE ESTACIONES
// ---------------------------------------------------------------------
// La barra de arriba (index.html, <nav class="topbar">) tiene 5 botones:
// "Estaciones" + las 4 estaciones, y se muestra SIEMPRE, en todas las
// vistas.
//
//   - "Estaciones" es la pestaña de entrada: sin ?estacion=... en la URL
//     se ve #estacionesHome (página en blanco con fotos, sin mosaico).
//     Es lo primero al abrir la web.
//   - "Otoño" / "Invierno" ponen ?estacion=... y recargan: se arma de
//     cero el mosaico + los poemas + las texturas de esa estación (desde
//     ESTACIONES y assets/poemas/<estacion>.yaml).
//   - "Primavera" / "Verano" todavía no tienen assets: no hacen nada.
//
// Cada botón navega cambiando la URL; el estado vive en el parámetro, no
// en memoria.
// =====================================================================
(function () {
  const barra = document.getElementById('topbar');
  if (!barra) return;

  // Marca visualmente la pestaña activa: la estación, o "Estaciones"
  // (data-accion="intro") cuando no hay ninguna elegida.
  const selActivo = CURRENT_SEASON
    ? '[data-season="' + CURRENT_SEASON + '"]'
    : '[data-accion="intro"]';
  const btnActual = barra.querySelector(selActivo);
  if (btnActual) btnActual.classList.add('is-active');

  // Navega a una vista: pone (o saca, para "Estaciones") ?estacion=... y
  // recarga. Ignora las estaciones sin assets (primavera, verano) y la
  // vista que ya se está mostrando.
  function irA(season) {
    if (season && (!ESTACIONES[season] || season === CURRENT_SEASON)) return;
    if (!season && !CURRENT_SEASON) return; // ya en "Estaciones"
    const url = new URL(location.href);
    if (season) url.searchParams.set('estacion', season);
    else url.searchParams.delete('estacion');
    location.assign(url);
  }

  barra.querySelectorAll('.topbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      irA(btn.dataset.accion === 'intro' ? null : btn.dataset.season);
    });
  });
})();

// =====================================================================
// BARRA DE SCROLL PROPIA
// ---------------------------------------------------------------------
// Chrome (Windows) le dibuja flechitas a la barra de scroll de los
// contenedores internos (.scroll-area) y no hay CSS que las saque. Así
// que ocultamos la barra nativa (ver style.css) y dibujamos la nuestra:
// un carril fijo pegado a la derecha, que arranca justo debajo de la
// barra de botones, con un pulgar redondeado. Sin flechitas, y se puede
// arrastrar o clickear el carril para saltar.
// =====================================================================
(function () {
  const area = document.querySelector('.scroll-area');
  const bar = document.getElementById('cscroll');
  const thumb = document.getElementById('cscrollThumb');
  if (!area || !bar || !thumb) return;

  const leerTop = () => parseFloat((thumb.style.transform.match(/-?[\d.]+/) || [0])[0]) || 0;

  // Ajusta alto y posición del pulgar según cuánto se scrolleó.
  function sync() {
    const vis = area.clientHeight;
    const total = area.scrollHeight;
    if (total <= vis + 1) { bar.hidden = true; return; }  // no hay nada que scrollear
    bar.hidden = false;
    const track = bar.clientHeight;
    const h = Math.max(24, Math.round(track * vis / total));
    const maxTop = Math.max(0, track - h);
    const top = maxTop * (area.scrollTop / (total - vis));
    thumb.style.height = h + 'px';
    thumb.style.transform = 'translateY(' + top + 'px)';
  }

  let raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; sync(); });
  }
  area.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', sync);
  // el mosaico cambia mucho el alto al dibujarse: re-medimos un rato.
  const remedir = setInterval(sync, 250);
  setTimeout(() => clearInterval(remedir), 12000);
  window.addEventListener('load', sync);

  // Llevar el scroll a la posición que corresponde a un `top` de pulgar.
  function scrollAtop(top) {
    const track = bar.clientHeight;
    const maxTop = Math.max(1, track - thumb.offsetHeight);
    const t = Math.max(0, Math.min(maxTop, top));
    area.scrollTop = (t / maxTop) * (area.scrollHeight - area.clientHeight);
  }

  // Arrastre del pulgar.
  let dragY = 0, dragTop = 0;
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { thumb.setPointerCapture(e.pointerId); } catch (_) {}
    thumb.classList.add('drag');
    dragY = e.clientY;
    dragTop = leerTop();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!thumb.classList.contains('drag')) return;
    scrollAtop(dragTop + (e.clientY - dragY));
  });
  const finDrag = (e) => {
    thumb.classList.remove('drag');
    try { thumb.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  thumb.addEventListener('pointerup', finDrag);
  thumb.addEventListener('pointercancel', finDrag);

  // Clic en el carril (fuera del pulgar): saltar ahí.
  bar.addEventListener('pointerdown', (e) => {
    if (e.target === thumb) return;
    const rect = bar.getBoundingClientRect();
    scrollAtop((e.clientY - rect.top) - thumb.offsetHeight / 2);
  });

  sync();
})();