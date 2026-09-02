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

// Único ordenamiento del mosaico: por brillo, de claro a oscuro, con una
// pizca de aleatoriedad para que las bandas no queden perfectamente lisas.
const SORT_MODE = 'brightness';
const SORT_JITTER = 0.15;

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
//
// PORCENTAJE vs. CUADRADOS MOVIÉNDOSE A LA VEZ (modo 'desliz'):
//   El porcentaje es cuántos EMPIEZAN a deslizarse por ciclo, no cuántos
//   se ven en movimiento en un instante. Como cada deslizamiento (17,5 s)
//   dura más que el ciclo (5 s), se van solapando y acumulando. La
//   cantidad que hay moviéndose a la vez, en régimen, es:
//
//       PORCENTAJE * (MOSAICO_DESLIZ_MS / MOSAICO_CAMBIO_INTERVALO)
//       = 5% * (17500 / 5000) = 5% * 3,5 = 17,5% del mosaico
//
//   Sobre ~780 cuadrados son ~135 deslizándose simultáneamente (un poco
//   menos por los que se saltean si les toca uno que ya está en marcha).
//   El arranque "en caliente" larga de una esa misma tanda de ~135, así
//   ese 17,5% ya está presente desde el primer momento en vez de tardar
//   17,5 s en acumularse.
//
//   Para que se vean MENOS en movimiento a la vez: bajá PORCENTAJE.
//   Para que cambien más seguido: bajá INTERVALO.
// =====================================================================
const EFECTO_MOSAICO = true;
const MOSAICO_MODO = 'desliz'; // 'desliz' | 'intercambio'
const MOSAICO_CAMBIO_PORCENTAJE = 5;
const MOSAICO_CAMBIO_INTERVALO = 5000;
const MOSAICO_DESLIZ_MS = 17500;

// El ciclo se reparte en pasos chiquitos de este tamaño para que los
// cambios se sientan graduales y no como un parpadeo de golpe.
const MOSAICO_PASO_MS = 260;

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

  // Pre-render each uploaded photo onto its own normalized square canvas at full working resolution.
  const normalized = uploadedImages.map(img => {
    const c = document.createElement('canvas');
    c.width = WORK_DIM;
    c.height = WORK_DIM;
    const cx = c.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(WORK_DIM / img.width, WORK_DIM / img.height) * ZOOM;
    const sw = WORK_DIM / scale, sh = WORK_DIM / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, WORK_DIM, WORK_DIM);
    return cx;
  });

  // efecto mosaico (modo 'desliz'): guardamos las fotos normalizadas para
  // poder deslizarnos dentro de ellas más tarde.
  mosaicSources = normalized.map(cx => cx.canvas);

  const colsUnits = Math.floor(WORK_DIM / tileW);
  const rowsUnits = Math.floor(WORK_DIM / tileH);

  const jobs = [];
  normalized.forEach((cx, imgIdx) => {
    if (variable) {
      const plan = planVariableWidths(WORK_DIM, rowHeight, minWidth, maxWidth);
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
    applySort(tiles, SORT_MODE, SORT_JITTER);

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
    else if (mode === 'brightness') key = (1 - t.bri) * 360; // flip so low = bright, scale to 360
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
  const rows = Math.ceil(n / cols);
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
      // relleno usa los recortes más oscuros, que es donde termina el degradado,
      // y no los más claros del arranque.
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

  const state = { ctx, tileW, tileH, cols, total, cellPan, seedTimers: [] };
  const paso = MOSAICO_MODO === 'desliz' ? deslizarEnLaFoto : intercambiarConVecino;
  state.timer = setInterval(() => {
    acum += porPaso;
    let cuantos = Math.floor(acum);
    acum -= cuantos;
    while (cuantos-- > 0) paso(state);
  }, MOSAICO_PASO_MS);
  mosaicoDrift = state;

  // Arranque "en caliente" (modo 'desliz'): en vez de esperar a que el
  // reloj vaya sumando deslizamientos de a poco, largamos ya una tanda del
  // tamaño que tendría en régimen, con demoras al azar repartidas en la
  // duración de un deslizamiento. Así, apenas se dibuja el mosaico, ya hay
  // cuadrados en movimiento y a distintas alturas del recorrido.
  if (MOSAICO_MODO === 'desliz') {
    const enRegimen = Math.round((total * MOSAICO_CAMBIO_PORCENTAJE / 100) *
                                 (MOSAICO_DESLIZ_MS / MOSAICO_CAMBIO_INTERVALO));
    for (let k = 0; k < enRegimen; k++) {
      state.seedTimers.push(setTimeout(() => paso(state), Math.random() * MOSAICO_DESLIZ_MS));
    }
  }
}

function stopMosaicDrift() {
  if (mosaicoDrift) {
    if (mosaicoDrift.timer) clearInterval(mosaicoDrift.timer);
    (mosaicoDrift.seedTimers || []).forEach(clearTimeout);
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

// efecto mosaico (modo 'desliz'): elige una celda al azar y desliza
// despacio su ventana de recorte dentro de la foto original, un cuadrado
// hacia arriba, abajo, izquierda o derecha, revelando el recorte que en
// esa foto está pegado al lado. El paneo es acumulativo: la celda queda
// apuntando al recorte nuevo y la próxima vez sigue desde ahí.
function deslizarEnLaFoto(state) {
  const { ctx, tileW, tileH, cols, total, cellPan } = state;
  if (!cellPan) return;

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

  const cellX = (celda % cols) * tileW;
  const cellY = Math.floor(celda / cols) * tileH;
  const fromX = pan.srcX, fromY = pan.srcY;
  const toX = fromX + dx, toY = fromY + dy;
  pan.moviendo = true;
  const inicio = performance.now();

  function frame(ahora) {
    let t = Math.min(1, (ahora - inicio) / MOSAICO_DESLIZ_MS);
    // Mezcla mitad lineal, mitad suavizado en las puntas: se mueve bastante
    // parejo pero sin que se note del todo el salto al arrancar y frenar.
    // Subí el 0.5 del easeInOut para un desliz más gradual; bajalo a 0 para
    // lineal puro.
    const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const e = 0.5 * t + 0.5 * easeInOut;
    const sX = fromX + (toX - fromX) * e;
    const sY = fromY + (toY - fromY) * e;
    ctx.drawImage(src, sX, sY, tileW, tileH, cellX, cellY, tileW, tileH);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      pan.srcX = toX;
      pan.srcY = toY;
      pan.moviendo = false;
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------
// Carga automática de fondo: en "modo fondo de home" el panel de
// controles está oculto (ver style.css), así que en vez de esperar a
// que alguien arrastre fotos, cargamos directamente las imágenes que
// están en assets/imagenes y armamos el mosaico apenas terminan de
// cargar. Si sumás o sacás fotos de esa carpeta, actualizá esta lista.
// ---------------------------------------------------------------------
const ASSET_IMAGE_PATHS = [
  'assets/imagenes/otono-07.jpg',
  'assets/imagenes/otono-08.jpg',
  'assets/imagenes/otono-09.jpg',
  'assets/imagenes/otono-10.jpeg',
  'assets/imagenes/otono-11.jpeg',
  'assets/imagenes/otono-12.jpeg',
];

function loadAssetBackground() {
  let settled = 0;
  ASSET_IMAGE_PATHS.forEach(path => {
    const img = new Image();
    const onSettle = () => {
      settled++;
      updateCount();
      if (settled === ASSET_IMAGE_PATHS.length && uploadedImages.length > 0) {
        buildMosaic();
      }
    };
    img.onload = () => {
      uploadedImages.push(img);
      const t = document.createElement('img');
      t.src = path;
      thumbrow.appendChild(t);
      onSettle();
    };
    img.onerror = () => {
      console.error('No se pudo cargar la imagen de fondo:', path);
      onSettle();
    };
    img.src = path;
  });
}

loadAssetBackground();

// ---------------------------------------------------------------------
// Lectura de poemas: carga los poemas de la estación actual desde su
// YAML (assets/poemas/<estacion>.yaml), los ordena por fecha y los
// muestra en una columna, cada uno con su fecha. El mosaico queda fijo
// de fondo (ver style.css) y cada poema entra con un fundido cuando
// aparece en pantalla al hacer scroll.
// ---------------------------------------------------------------------
const CURRENT_SEASON = 'otono';
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
const EFECTO_ESCRITURA = true;

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
  // efecto texturas: recién ahora la página tiene su alto final (el
  // canvas del mosaico ya está dibujado), así que es el momento de armar
  // la capa de texturas. Si se armara antes, las fotos se repartirían
  // sobre un alto provisorio y después "saltarían" a otro lugar cuando
  // el mosaico agranda la página.
  construirTexturas();
}

// Red de seguridad: si el mosaico nunca llega a terminar (por ejemplo,
// si fallan las imágenes de assets/imagenes), igual arrancamos los
// poemas después de unos segundos para que la página no quede muda.
setTimeout(markMosaicReady, 8000);

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

// Muestra cada poema con un fundido cuando entra en el viewport y, al
// mismo tiempo, arranca el efecto escritura sobre su título y sus versos.
function revealOnScroll() {
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
  fetch('assets/poemas/' + season + '.yaml')
    .then(res => res.text())
    .then(yamlText => {
      const poems = jsyaml.load(yamlText);
      if (!Array.isArray(poems) || poems.length === 0) return;
      renderPoemList(poems);
    })
    .catch(err => console.error('No se pudieron cargar los poemas:', err));
}

loadSeasonPoem(CURRENT_SEASON);

// =====================================================================
// EFECTO TEXTURAS (opcional)
// ---------------------------------------------------------------------
// Una capa de fotos horizontales (rectángulos apaisados) SUPERPUESTA
// encima del mosaico: va por encima del mosaico y del velo turquesa, y
// por debajo de los poemas (ver .textura-capa en style.css, z-index 4).
// El mosaico y los poemas quedan igual que antes.
//
// No es una franja arriba de la web: la capa cubre toda la altura de la
// página (la misma que el mosaico) y se colocan TEXTURAS_CANTIDAD fotos
// en posiciones AL AZAR a lo largo de todo el scroll. Cada foto sale con:
//   - una imagen elegida al azar de la lista: se pueden repetir;
//   - un `top` al azar pero ANCLADO a la grilla del mosaico: el borde de
//     arriba cae en una línea de fila, o en el medio de una fila ("en la
//     mitad de un mosaico"). Las fotos PUEDEN encimarse entre ellas, pero
//     nunca tapándose más del 50% (control por solape vertical);
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
//                           repetirse imágenes de la lista).
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
const TEXTURAS_CANTIDAD = 10;
const TEXTURAS_SCROLL_TRAMO = 4;
const TEXTURAS_IMAGE_PATHS = [
  'assets/imagenes/textura-otono-01.jpeg',
  'assets/imagenes/textura-otono-02.jpeg',
  'assets/imagenes/textura-otono-03.jpeg',
  'assets/imagenes/textura-otono-04.jpeg',
  'assets/imagenes/textura-otono-05.jpeg',
  'assets/imagenes/textura-otono-06.jpeg',
  'assets/imagenes/textura-otono-07.jpg',
  'assets/imagenes/textura-otono-08.jpg',
];
const TEXTURAS_CICLO_MS = 24000;

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

  const cuantas = Math.max(1, TEXTURAS_CANTIDAD);

  // Lado de entrada: mitad desde cada costado, repartidos al azar.
  const dirs = [];
  for (let i = 0; i < cuantas; i++) dirs.push(i < cuantas / 2 ? -1 : 1);
  barajar(dirs);

  // Medidas fijas de cada rectángulo, en cuadrados de la grilla:
  //   alto  = 2 cuadrados (recortes del mosaico). Cada recorte mide
  //           --col/2 de alto, así que 2 recortes = --col * 1.
  //   ancho = 5 o 6 cuadrados (columnas), al azar por foto.
  const ALTO_CUADRADOS = 1;          // en unidades de --col (= 2 recortes)
  const anchos = [5, 6];

  // Velocidades: cada foto se desliza a su propio ritmo (factor sobre el
  // ritmo base; <1 más lenta, >1 más rápida). Además, si una foto queda
  // cerca de otra en vertical, se le busca una velocidad bien distinta
  // de esa vecina para que no crucen la pantalla pegadas.
  const VEL_MIN = 0.55, VEL_SPAN = 1.2;   // vel en [0.55, 1.75]
  const VEL_DIF_MIN = 0.45;               // separación mínima con una vecina

  // Control de solape: trabajamos en px sobre el alto real de la capa
  // (que ya es el de la página: el mosaico terminó de dibujarse). Se
  // guarda el tramo vertical [a, b] y la vel de cada foto ya puesta.
  const colPx = (window.innerWidth || document.documentElement.clientWidth) / 13;
  const pageH = texturaCapa.offsetHeight || document.documentElement.scrollHeight || 1;
  const puestas = [];
  // ninguna foto tapa a otra más del 50% de la más chica de las dos.
  function solapeOK(a, b) {
    return puestas.every(o => {
      const ov = Math.max(0, Math.min(b, o.b) - Math.max(a, o.a));
      return ov <= 0.5 * Math.min(b - a, o.b - o.a);
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

    // top: al azar, pero ANCLADO a la grilla del mosaico. Las filas del
    // mosaico miden --col/2 (tileH 60), así que el borde de arriba de la
    // textura cae justo en una línea de fila; en la mitad de las texturas
    // se corre --col/4 para que quede centrada en una fila ("en la mitad
    // de un mosaico"). Se reintenta hasta 40 veces si taparía a otra
    // textura más del 50%.
    const hPx = ALTO_CUADRADOS * colPx;
    const filaPx = colPx / 2;                 // alto de una fila del mosaico
    const enMedio = Math.random() < 0.5;      // centrada en una fila, no en la línea
    let topPx, a, b, intento = 0;
    do {
      const crudo = (1 + Math.random() * 90) / 100 * pageH;
      topPx = Math.round(crudo / filaPx) * filaPx + (enMedio ? filaPx / 2 : 0);
      a = topPx;
      b = a + hPx;
    } while (!solapeOK(a, b) && ++intento < 40);
    // se guarda en % para que siga anclada al reescalar la ventana (la
    // grilla y la página escalan las dos con el ancho del viewport).
    fig.style.top = (topPx / pageH * 100).toFixed(3) + '%';

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
  window.addEventListener('scroll', alScroll, { passive: true });
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