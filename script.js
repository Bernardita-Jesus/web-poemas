let uploadedImages = [];
let mosaicCanvas = null;

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
        tiles.push({ imgData: tileData, w: job.w, h: job.h, h_: hsb.h, s: hsb.s, bri: hsb.bri });
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
    } else if (onDone) {
      onDone();
    }
  }
  drawStep();
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
// de fondo (ver style.css) y cada poema aparece con un fundido cuando
// entra en pantalla al hacer scroll. Sin efecto de escritura.
// ---------------------------------------------------------------------
const CURRENT_SEASON = 'otono';
const poemCard = document.getElementById('poemCard');

function renderPoemList(poems) {
  poemCard.innerHTML = '';

  poems
    .slice()
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .forEach((poem, poemIndex) => {
      const article = document.createElement('article');
      article.className = 'poem';
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
        titulo.textContent = poem.titulo;
        article.appendChild(titulo);
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
          p.textContent = line;
          if (level > 0) {
            p.style[alignRight ? 'marginRight' : 'marginLeft'] = (level * STEP_EM) + 'em';
          }
          article.appendChild(p);

          vieneAbierta = !cierra;
          if (cierra) level = 0;
        });

      poemCard.appendChild(article);
    });

  revealOnScroll();
}

// Muestra cada poema con un fundido cuando entra en el viewport.
function revealOnScroll() {
  const items = poemCard.querySelectorAll('.poem');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
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