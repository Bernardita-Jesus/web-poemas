// Lo usan varios efectos del sitio: si el sistema pide menos movimiento,
// se apagan solos.
const prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------------------------------------------------------------------
// ESTACIONES: qué fotos usa cada una. La estación que se
// muestra se elige con ?estacion=... en la URL; los botones de la barra
// de arriba y los de la pantalla "Estaciones" la cambian y recargan la
// página (ver "BARRA DE ESTACIONES" más abajo). Sin un parámetro válido
// NO hay estación elegida: la web arranca en la pantalla "Estaciones",
// donde se elige la estación.
//
// Los poemas de la estación salen de assets/poemas/<estacion>.yaml.
// Verano todavía no tiene assets, así que su botón no hace nada. Si
// sumás o sacás fotos de assets/imagenes, actualizá la lista
// correspondiente acá.
// ---------------------------------------------------------------------
const ESTACIONES = {
  otono: {
    // nombre y año para el rótulo del pase de fotos de la pestaña
    // "Estaciones" (ver "FOTOS DE LA PESTAÑA ESTACIONES").
    nombre: 'Otoño',
    anio: 2026,
    fotos: [
      'assets/imagenes/otono-01.jpg',
      'assets/imagenes/otono-02.jpg',
      'assets/imagenes/otono-03.jpg',
      'assets/imagenes/otono-04.jpg',
      'assets/imagenes/otono-05.jpg',
      'assets/imagenes/otono-06.jpg',
      'assets/imagenes/otono-07.jpeg',
      'assets/imagenes/otono-08.jpeg',
      'assets/imagenes/otono-09.jpeg',
    ],
    // Plantas prensadas (fondo ya quitado, PNG con transparencia): van
    // aparte de "fotos", no se mezclan con esas -ni intercalarFotos ni
    // el pase de la pestaña "Estaciones" las tocan todavía-.
    plantas: [
      'assets/imagenes/planta-otono-01.png',
      'assets/imagenes/planta-otono-02.png',
      'assets/imagenes/planta-otono-03.png',
    ],
  },
  invierno: {
    // nombre y año para el rótulo del pase de fotos de la pestaña
    // "Estaciones" (ver "FOTOS DE LA PESTAÑA ESTACIONES").
    nombre: 'Invierno',
    anio: 2026,
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
  },
  primavera: {
    // nombre y año para el rótulo del pase de fotos de la pestaña
    // "Estaciones" (ver "FOTOS DE LA PESTAÑA ESTACIONES").
    nombre: 'Primavera',
    anio: 2026,
    // todavía no hay fotos propias de primavera en assets/imagenes.
    fotos: [],
  },
};
// Estación pedida por la URL (?estacion=otono). Si no es una de las que
// tienen assets, queda null: no se cargan poemas y se muestra la
// pestaña "Estaciones" (página en blanco con fotos, la de entrada; ver
// "BARRA DE ESTACIONES" y .vista-estaciones en style.css).
const CURRENT_SEASON = (function () {
  const pedida = new URLSearchParams(location.search).get('estacion');
  return (pedida && ESTACIONES[pedida]) ? pedida : null;
})();

// Config de la estación actual. Si todavía no se eligió, un molde vacío
// para que lo de abajo no explote; igual no se usa, porque la carga de
// fotos y poemas se saltea cuando CURRENT_SEASON es null.
const SEASON_CFG = ESTACIONES[CURRENT_SEASON] || { fotos: [] };

// Marca la estación en el <body> para que el CSS pueda cambiar cosas por
// estación (por ahora, el color del velo; ver body[data-estacion] en
// style.css). Sin estación elegida no se marca nada (no hay velo).
if (CURRENT_SEASON) document.body.dataset.estacion = CURRENT_SEASON;

// Sin ?estacion=... se muestra la pestaña "Estaciones": una página
// aparte, en blanco, con fotos (index.html, #estacionesHome). Con una
// estación elegida es al revés. Ver .vista-estaciones en style.css.
document.body.classList.toggle('vista-estaciones', !CURRENT_SEASON);

// ---------------------------------------------------------------------
// Lectura de poemas: carga los poemas de la estación actual desde su
// YAML (assets/poemas/<estacion>.yaml), los ordena por fecha y los
// muestra en una columna, cada uno con su fecha. Cada poema entra con un
// fundido cuando aparece en pantalla al hacer scroll.
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
// prefersReducedMotion está definido arriba de todo (lo comparten varios
// efectos del sitio).

// efecto escritura: decide qué hacer con un poema que acaba de entrar en
// pantalla. Si el efecto está apagado (o el sistema pide menos
// movimiento), vuelca el texto completo sin animar. Si no, lo empieza a
// teclear.
function startTypewriter(article) {
  const targets = (article && article._typeTargets) || [];
  if (targets.length === 0) return;

  if (!EFECTO_ESCRITURA || prefersReducedMotion) {
    targets.forEach(el => { el.textContent = el.dataset.full || ''; });
    return;
  }

  runTypewriter(article);
}

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
    .filter(poem => !poem.oculto)   // poemas con "oculto: true" no se muestran
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .forEach((poem, poemIndex) => {
      const article = document.createElement('article');
      // Poemas impares (1º, 3º…) van pegados a la izquierda; los pares a la
      // derecha (ver .poem-izq/.poem-der en style.css). El lado se marca
      // con una clase, no con nth-child/nth-of-type: así no se desordena
      // si el poema termina emparejado con una foto dentro de un
      // .poem-con-foto (ver intercalarFotos) en vez de ser hijo directo
      // de .poem-card. El escalonado diagonal se corre hacia el lado
      // contrario al margen de cada uno.
      const alignRight = poemIndex % 2 === 1;
      article.className = 'poem ' + (alignRight ? 'poem-der' : 'poem-izq');
      // efecto escritura: elementos que se van a teclear, en orden.
      const typeTargets = [];

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

  intercalarFotos();
  intercalarPlantas();
  revealOnScroll();
}

// Reparte las fotos de la estación actual (ESTACIONES.<estacion>.fotos)
// entremedio de los poemas ya puestos en poemCard: cada foto elegida se
// empareja con un poema (uno cada tantos, repartidos a lo largo de toda
// la lista, no amontonados en un extremo) y los dos quedan uno al lado
// del otro en la misma fila -ver .poem-con-foto en style.css-, no la
// foto sola con el poema arriba/abajo. Si hay más fotos que poemas, se
// usan solo las que entran (nunca se repite ninguna); si hay menos (o
// ninguna, como primavera por ahora), quedan poemas sin foto al lado.
function intercalarFotos() {
  const fotos = (SEASON_CFG && SEASON_CFG.fotos) || [];
  if (fotos.length === 0) return;
  const poems = Array.from(poemCard.querySelectorAll('.poem'));
  if (poems.length === 0) return;

  const cantidad = Math.min(fotos.length, poems.length);
  const elegidas = barajar(fotos.slice()).slice(0, cantidad);

  // Reparto parejo: la foto i se empareja con el poema en la posición
  // redondeada de (i+0.5) * poems.length / cantidad.
  const usados = new Set();
  elegidas.forEach((ruta, i) => {
    let idx = Math.round((i + 0.5) * poems.length / cantidad);
    idx = Math.max(0, Math.min(poems.length - 1, idx));
    while (usados.has(idx) && idx < poems.length - 1) idx++;
    usados.add(idx);

    const poem = poems[idx];
    // el lado de la foto es el CONTRARIO al del poema -el poema se
    // queda en su margen de siempre (ver poem-izq/poem-der) y la foto
    // ocupa el otro costado de la fila, en vez de competir por el mismo
    // lado-.
    const poemEsIzq = poem.classList.contains('poem-izq');
    const fig = document.createElement('figure');
    fig.className = 'poem-foto';
    const img = document.createElement('img');
    img.src = ruta;
    img.alt = '';
    img.loading = 'lazy';
    fig.appendChild(img);

    const fila = document.createElement('div');
    // misma clase de lado que llevaría el poema solo, para que la fila
    // entera tenga el mismo margen de la orilla (ver style.css): si no,
    // quedaba pegada a todo el ancho, poema y foto tocando el borde.
    fila.className = 'poem-con-foto ' + (poemEsIzq ? 'poem-con-foto-izq' : 'poem-con-foto-der');
    poem.insertAdjacentElement('beforebegin', fila);
    if (poemEsIzq) {
      fila.appendChild(poem);
      fila.appendChild(fig);
    } else {
      fila.appendChild(fig);
      fila.appendChild(poem);
    }
  });
}

// Reparte las "plantas" de la estación actual (ESTACIONES.<estacion>.
// plantas: recortes con transparencia, fondo ya quitado -ver script de
// procesamiento, no en este repo-) en tres tipos de hueco:
//   - ENCIMA de una foto ya puesta por intercalarFotos, asomando por
//     arriba/abajo o izq/der de su borde.
//   - AL COSTADO VACÍO de un poema que quedó SIN foto al lado (no
//     siempre alcanzan las fotos para todos los poemas) -el costado
//     contrario a su margen, donde no hay nada más-.
//   - AL COSTADO VACÍO de cada FILA (poema solo, o poema+foto): cada
//     fila lleva el mismo margen de orilla que un poema suelto (ver
//     .poem-izq/.poem-der y .poem-con-foto-izq/-der en style.css), así
//     que en pantallas anchas el lado contrario a ese margen queda
//     vacío de punta a punta -mucho más ancho que el hueco de "poema
//     sin foto" de arriba, que es solo al lado del texto-.
// En los tres casos la planta es hija del objetivo (position: absolute,
// ver .poem-foto/.poem/.poem-con-foto position:relative y .poem-planta
// en style.css): así NO cuenta como un elemento más en la fila -no suma
// su propio "gap" ni corre nada- y la separación entre poemas/fotos
// queda exactamente igual que sin ninguna planta. Rotación al azar por
// planta (--rot) para que no se vean todas "derechas".
//
// Van en TODOS los huecos (todas las fotos, todos los poemas sin foto
// al lado, y todas las filas), no en unos pocos al azar: como hay menos
// fotos de planta que huecos, se repiten -cada hueco elige una al azar
// de la lista, sin descartarla para los demás-.
function intercalarPlantas() {
  const plantas = (SEASON_CFG && SEASON_CFG.plantas) || [];
  if (plantas.length === 0) return;

  const objetivos = [
    ...Array.from(poemCard.querySelectorAll('.poem-foto')).map(el => ({ el, tipo: 'foto' })),
    ...Array.from(poemCard.querySelectorAll(':scope > .poem')).map(el => ({ el, tipo: 'poema' })),
    ...Array.from(poemCard.querySelectorAll(':scope > .poem-con-foto')).map(el => ({ el, tipo: 'fila' })),
  ];
  if (objetivos.length === 0) return;

  objetivos.forEach(({ el: objetivo, tipo }) => {
    const ruta = plantas[Math.floor(Math.random() * plantas.length)];
    const fig = document.createElement('figure');
    fig.style.setProperty('--rot', (Math.random() * 30 - 15).toFixed(1) + 'deg');

    if (tipo === 'foto') {
      const vertical = Math.random() < 0.5 ? 'arriba' : 'abajo';
      // El lado horizontal NO es al azar: la fila que contiene esta foto
      // puede tener su propia planta "afuera" (ver más abajo) del lado
      // contrario a su margen. Si esta planta asomara hacia ESE mismo
      // lado, las dos quedarían superpuestas/cruzadas ahí -se ve como
      // una sola planta rara, como "acostada"-. Por eso siempre asoma
      // hacia ADENTRO de la fila (el lado donde está el poema).
      const fila = objetivo.closest('.poem-con-foto');
      const horizontal = fila
        ? (fila.classList.contains('poem-con-foto-izq') ? 'izq' : 'der')
        : (Math.random() < 0.5 ? 'izq' : 'der');
      fig.className = `poem-planta poem-planta-${vertical} poem-planta-${horizontal}`;
    } else {
      // poema sin foto, o fila entera: van al costado vacío, el
      // contrario al margen propio (.poem-izq/-der para un poema
      // suelto, .poem-con-foto-izq/-der para una fila).
      const esIzq = objetivo.classList.contains('poem-izq') || objetivo.classList.contains('poem-con-foto-izq');
      const lado = esIzq ? 'der' : 'izq';
      fig.className = `poem-planta poem-planta-afuera-${lado}`;
    }

    const img = document.createElement('img');
    img.src = ruta;
    img.alt = '';
    img.loading = 'lazy';
    fig.appendChild(img);
    objetivo.appendChild(fig);
  });
}

// Muestra cada poema (título, fecha y versos) con un fundido cuando entra
// en el viewport.
//
// En pantallas angostas (mismo corte que el resto del sitio, ver
// style.css) se muestran TODOS juntos de una, no de a uno a medida que
// cada uno entra en pantalla al scrollear -esto último es lo que hace
// el IntersectionObserver de más abajo, pensado para desktop-.
function revealOnScroll() {
  const items = poemCard.querySelectorAll('.poem, .poem-foto, .poem-planta');
  const revelarTodosJuntos = window.innerWidth <= 820;
  if (revelarTodosJuntos || !('IntersectionObserver' in window)) {
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

// Fisher-Yates: mezcla el array en el lugar. La usa el pase de fotos de
// la pestaña "Estaciones" (ver "FOTOS DE LA PESTAÑA ESTACIONES").
function barajar(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =====================================================================
// BARRA DE ESTACIONES
// ---------------------------------------------------------------------
// La barra de arriba (index.html, <nav class="topbar">) tiene 5 botones:
// "Estaciones" + las 4 estaciones, y se muestra SIEMPRE, en todas las
// vistas.
//
//   - "Estaciones" es la pestaña de entrada: sin ?estacion=... en la URL
//     se ve #estacionesHome (página en blanco con fotos). Es lo primero
//     al abrir la web.
//   - "Otoño" / "Invierno" / "Primavera" ponen ?estacion=... y recargan:
//     se arman de cero los poemas de esa estación (desde ESTACIONES y
//     assets/poemas/<estacion>.yaml).
//   - "Verano" todavía no tiene assets: no hace nada.
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
// EFECTO BARRA
// ---------------------------------------------------------------------
// Al scrollear para abajo dentro de .scroll-area (la única caja que
// scrollea, ver style.css), la barra de botones sube y se esconde; al
// scrollear para arriba —o al llegar arriba del todo— vuelve a bajar.
//
// En desktop es un toggle con transición propia (.topbar--oculta en
// style.css anima margin-top medio segundo): la barra se esconde y el
// contenido sube y ocupa su lugar. En celular la barra va PEGADA al
// dedo: cada píxel que se scrollea la corre ese mismo píxel (sin
// transición CSS de por medio, que quedaba a otra velocidad que el
// resto del scroll y se sentía desincronizada), hasta quedar
// completamente afuera de pantalla; al revés al scrollear para arriba,
// sea cual sea la posición.
//
// En las páginas de estación (invierno/otoño) la barra queda SUPERPUESTA
// -no reserva lugar propio, ver .scroll-area/#cscroll en el @media de
// style.css- y tapa/destapa su borde de arriba al aparecer/esconderse,
// en vez de correr el contenido.
//
// En la portada ("Estaciones") SÍ se sigue reservando el lugar de la
// barra (el título quedaría tapado si no) pero el contenido (.scroll-
// area) y la barra de scroll propia (#cscroll) suben con ella al
// esconderse, para no dejar tampoco ahí un hueco vacío: como el
// contenido de la portada es corto, el margen que queda libre abajo al
// subir es chico y no se nota.
//
// Al subir (mostrar) la barra reacciona más rápido que al bajar
// (esconder): FACTOR_SUBIDA multiplica cuánto se destapa por cada
// píxel que se scrollea para arriba, así no hace falta scrollear tanto
// para volver a verla.
// =====================================================================
const EFECTO_BARRA = true;
(function () {
  if (!EFECTO_BARRA || prefersReducedMotion) return;
  const barra = document.getElementById('topbar');
  const area = document.querySelector('.scroll-area');
  if (!barra || !area) return;

  if (window.matchMedia('(max-width: 820px)').matches) {
    const FACTOR_SUBIDA = 2.5;
    const esPortada = !CURRENT_SEASON;
    const cscroll = document.getElementById('cscroll');
    let ultimoScroll = area.scrollTop;
    let offset = 0; // 0 = barra en su lugar; -altoBarra = del todo afuera
    area.addEventListener('scroll', () => {
      const actual = area.scrollTop;
      const delta = actual - ultimoScroll;
      const altoBarra = barra.offsetHeight;
      const avance = delta > 0 ? delta : delta * FACTOR_SUBIDA;
      offset = Math.max(-altoBarra, Math.min(0, offset - avance));
      const t = 'translateY(' + offset + 'px)';
      barra.style.transform = t;
      if (esPortada) {
        area.style.transform = t;
        if (cscroll) cscroll.style.transform = t;
      }
      ultimoScroll = actual;
    }, { passive: true });
    return;
  }

  const UMBRAL_ARRIBA = 8; // px: cerca del tope, la barra siempre se ve
  let ultimoScroll = area.scrollTop;

  area.addEventListener('scroll', () => {
    const actual = area.scrollTop;
    if (actual <= UMBRAL_ARRIBA) {
      barra.classList.remove('topbar--oculta');
    } else if (actual > ultimoScroll) {
      barra.classList.add('topbar--oculta');       // bajando: se esconde
    } else if (actual < ultimoScroll) {
      barra.classList.remove('topbar--oculta');     // subiendo: vuelve
    }
    ultimoScroll = actual;
  }, { passive: true });
})();

// =====================================================================
// FOTOS DE LA PESTAÑA "ESTACIONES"
// ---------------------------------------------------------------------
// El recuadro de arriba a la derecha (#estacionesHome .estaciones-cuadro)
// pasa las fotos de cada estación —juntando las de todas
// (ESTACIONES.<x>.fotos)— de a UNA, cambiando cada
// ESTACIONES_FOTO_MS con un fundido cruzado (dos capas <img>). Debajo de
// cada foto, un rótulo con su estación y año ("Otoño 2026" / "Invierno
// 2026"), que sale de ESTACIONES.<x>.nombre y .anio. A los lados hay dos
// flechas para retroceder / avanzar a mano; cada clic reinicia la cuenta
// del pase automático. Solo corre en la pestaña de entrada (sin estación
// elegida).
// =====================================================================
const ESTACIONES_FOTO_MS = 5000;
(function () {
  if (CURRENT_SEASON) return;
  const cuadro = document.querySelector('.estaciones-cuadro');
  if (!cuadro) return;

  // Cada entrada: la ruta de la foto y el rótulo de su estación, para
  // poder escribir "Otoño 2026" / "Invierno 2026" debajo.
  const items = [];
  Object.keys(ESTACIONES).forEach(key => {
    const cfg = ESTACIONES[key];
    const etiqueta = (cfg.nombre || key) + (cfg.anio ? ' ' + cfg.anio : '');
    (cfg.fotos || []).forEach(r => items.push({ ruta: r, etiqueta }));
  });
  if (items.length === 0) return;
  barajar(items);

  // dos capas para el fundido cruzado
  const a = document.createElement('img');
  const b = document.createElement('img');
  a.alt = b.alt = '';
  cuadro.appendChild(a);
  cuadro.appendChild(b);

  // rótulo con la estación y el año de la foto visible: pegado a la
  // esquina inferior derecha de la foto (dentro de .estaciones-cuadro).
  const pie = document.createElement('div');
  pie.className = 'estaciones-cuadro-pie';
  cuadro.appendChild(pie);

  let i = 0;
  let visible = a, oculta = b;
  a.src = items[0].ruta;
  a.classList.add('visible');
  pie.textContent = items[0].etiqueta;
  pie.classList.add('visible');

  // Muestra la foto `nuevo` (con vuelta: -1 => la última). Precarga la
  // imagen y recién ahí hace el fundido cruzado. `pedido` descarta las
  // cargas que quedaron viejas si se aprietan las flechas rápido.
  let pedido = 0;
  function mostrar(nuevo) {
    nuevo = (nuevo % items.length + items.length) % items.length;
    if (nuevo === i) return;
    i = nuevo;
    const req = ++pedido;
    const pre = new Image();
    pre.onload = () => {
      if (req !== pedido) return;           // llegó primero una foto más nueva
      oculta.src = items[i].ruta;           // ya cacheada: sin parpadeo
      oculta.classList.add('visible');
      visible.classList.remove('visible');
      const t = visible; visible = oculta; oculta = t;
      pie.textContent = items[i].etiqueta;
    };
    pre.src = items[i].ruta;
  }

  // Pase automático: cada ESTACIONES_FOTO_MS avanza una foto. Se
  // (re)programa al arrancar y después de cada flecha, así un clic manual
  // no queda seguido de un salto inmediato. Con una sola foto, o si el
  // sistema pide menos movimiento, no hay pase automático (las flechas
  // igual andan).
  let timer = null;
  function programar() {
    if (timer) clearInterval(timer);
    timer = null;
    if (items.length < 2 || prefersReducedMotion) return;
    timer = setInterval(() => mostrar(i + 1), ESTACIONES_FOTO_MS);
  }

  // Flechas a ambos lados de la foto para retroceder / avanzar a mano.
  if (items.length >= 2) {
    const flechaPrev = document.createElement('button');
    const flechaNext = document.createElement('button');
    flechaPrev.type = flechaNext.type = 'button';
    flechaPrev.className = 'estaciones-flecha estaciones-flecha--prev';
    flechaNext.className = 'estaciones-flecha estaciones-flecha--next';
    flechaPrev.setAttribute('aria-label', 'Foto anterior');
    flechaNext.setAttribute('aria-label', 'Foto siguiente');
    // el triángulo lo dibuja el CSS (.estaciones-flecha::before), no es
    // texto: así sale igual en cualquier navegador (ver style.css).
    // DENTRO de .estaciones-cuadro (no tiene overflow:hidden, las <img>
    // ya calzan justo con object-fit): así quedan ancladas a la caja de
    // fotos de verdad -mismo padding-box- en vez de depender de un
    // cálculo aparte contra .estaciones-home, que se desalineaba según
    // cuánto sobrara de alto libre alrededor del texto.
    cuadro.appendChild(flechaPrev);
    cuadro.appendChild(flechaNext);
    flechaPrev.addEventListener('click', () => { mostrar(i - 1); programar(); });
    flechaNext.addEventListener('click', () => { mostrar(i + 1); programar(); });
  }

  programar();
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
  // fuentes e imágenes que todavía están cargando pueden cambiar el
  // alto de la página: re-medimos un rato por las dudas.
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