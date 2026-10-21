/* =============================================================================
   data.js  ·  SERCA Consultora · Tablero de ejemplo
   -----------------------------------------------------------------------------
   DATOS 100% FICTICIOS con fines ilustrativos. "Cooperativa Ejemplo Ltda." no
   existe; ninguna cifra corresponde a una obra ni a una entidad real.

   CÓMO EDITAR
   - Sección 1: parámetros generales (cantidad de viviendas, presupuesto, plazo,
     mes actual, etc.).
   - Sección 2: etapas, rubros y materiales (tablas fáciles de modificar).
   - Sección 3: series de índices (variación mensual del costo real de la
     construcción y del índice de actualización de cuotas).
   - Sección 4: supuestos de proyección (inflación futura, aportes pendientes).
   - Sección 5 en adelante: el "motor" que genera las series mensuales a partir
     de los parámetros (con ruido determinístico: siempre da los mismos números).

   CONVENCIONES
   - Todas las series mensuales son arrays indexados por NÚMERO DE MES: el mes 1
     es el mes base (sep-25) y el índice 0 es un valor "previo" (cero / 1).
   - Los meses <= CONFIG.mesActual son datos "históricos"; los posteriores son
     proyecciones del modelo.
   - Montos en pesos argentinos. "Pesos del mes base" = pesos constantes de sep-25.
     "Pesos corrientes" = pesos nominales de cada mes.
   ============================================================================= */

const DATA = (function () {
  'use strict';

  /* ===========================================================================
     1) PARÁMETROS GENERALES
     =========================================================================== */
  const CONFIG = {
    cooperativa: 'Cooperativa Ejemplo Ltda.',
    viviendas: 48,                    // total del plan
    presupuestoTotal: 2400e6,         // $ 2.400 millones, a valores del mes base
    mesBase: { anio: 2025, mes: 9 },  // mes 1 = septiembre 2025
    plazoMeses: 24,                   // plazo contractual de obra
    mesActual: 14,                    // meses transcurridos (14 -> octubre 2026)
    horizonte: 27,                    // meses que cubre el modelo (con proyección)
    semilla: 2027                     // semilla del generador de "ruido"
  };

  /* ===========================================================================
     2) ETAPAS, RUBROS Y MATERIALES
     =========================================================================== */

  // Cada etapa: 16 viviendas, 12 meses de duración, empiezan escalonadas.
  //  - rezago:   meses de atraso que acumula el avance real respecto del previsto
  //  - ritmoProy: ritmo de avance proyectado hacia adelante (1 = igual al previsto)
  //  - cuotaBase: cuota mensual por vivienda en pesos del mes base
  //  - moraInicial / moraActual: % de beneficiarios del grupo con atraso (inicio y hoy)
  //  - entregadas: viviendas ya entregadas a sus familias (<= terminadas)
  const ETAPAS = [
    { id: 1, nombre: 'Etapa 1', viviendas: 16, inicio: 1,  duracion: 12, rezago: 0.6, ritmoProy: 1.00,
      presupuesto: 800e6, cuotaBase: 1.80e6, moraInicial: 0.03, moraActual: 0.12, entregadas: 8 },
    { id: 2, nombre: 'Etapa 2', viviendas: 16, inicio: 7,  duracion: 12, rezago: 1.6, ritmoProy: 1.00,
      presupuesto: 800e6, cuotaBase: 1.75e6, moraInicial: 0.04, moraActual: 0.25, entregadas: 0 },
    { id: 3, nombre: 'Etapa 3', viviendas: 16, inicio: 13, duracion: 12, rezago: 0.8, ritmoProy: 0.93,
      presupuesto: 800e6, cuotaBase: 1.70e6, moraInicial: 0.02, moraActual: 0.07, entregadas: 0 }
  ];

  // Rubros de obra. 'peso' = incidencia sobre el presupuesto de cada etapa (suma 1).
  // 'a' y 'b' = tramo del avance de la etapa (0-1) en que se ejecuta el rubro.
  // 'mix' = composición del costo: [materiales, mano de obra, subcontratos, gastos generales].
  // 'fMat' = sensibilidad del rubro al sobreprecio de materiales (1 = promedio).
  const RUBROS = [
    { id: 'suelos',        nombre: 'Suelos y fundaciones', peso: 0.09, a: 0.00, b: 0.18, mix: [0.35, 0.30, 0.28, 0.07], fMat: 0.8 },
    { id: 'estructura',    nombre: 'Estructura',                   peso: 0.20, a: 0.08, b: 0.45, mix: [0.58, 0.28, 0.08, 0.06], fMat: 1.5 },
    { id: 'mamposteria',   nombre: 'Mampostería',                  peso: 0.14, a: 0.30, b: 0.62, mix: [0.55, 0.33, 0.06, 0.06], fMat: 0.9 },
    { id: 'instalaciones', nombre: 'Instalaciones',                peso: 0.18, a: 0.40, b: 0.82, mix: [0.50, 0.20, 0.24, 0.06], fMat: 1.2 },
    { id: 'terminaciones', nombre: 'Terminaciones',                peso: 0.21, a: 0.58, b: 0.97, mix: [0.52, 0.30, 0.12, 0.06], fMat: 0.8 },
    { id: 'aberturas',     nombre: 'Aberturas y carpintería',      peso: 0.08, a: 0.62, b: 0.95, mix: [0.62, 0.10, 0.22, 0.06], fMat: 1.0 },
    { id: 'exteriores',    nombre: 'Infraestructura y exteriores', peso: 0.10, a: 0.75, b: 1.00, mix: [0.42, 0.22, 0.30, 0.06], fMat: 0.9 }
  ];

  const CATEGORIAS = ['Materiales', 'Mano de obra', 'Subcontratos', 'Gastos generales'];

  // Sobrecostos "propios" (en pesos constantes) sobre lo presupuestado, por categoría.
  // Los materiales NO se definen acá: su sobrecosto sale de la evolución de precios (más abajo).
  const SOBRECOSTOS = {
    manoDeObra:  { base: 0.015, porMes: 0.0010 },
    subcontratos:{ base: 0.030, porMes: 0.0000 },
    gastosGen:   { base: 0.030, porMes: 0.0035 },
    desperdicioMateriales: 0.010
  };

  // Materiales clave.
  //  - precio0:        precio unitario en el mes base (sep-25)
  //  - delta:          puntos porcentuales por mes que el precio sube POR ENCIMA de la inflación general
  //  - necesidadTotal: cantidad total para las 48 viviendas
  //  - desperdicio:    % adicional de compra por mermas
  //  - uso:            en qué rubros se consume (proporciones; suman 1)
  //  - coberturaObj:   meses de cobertura del stock HOY (stock = cobertura x consumo promedio)
  //  - reposicion:     plazo (en meses) de reposición del proveedor
  //  - stockActual:    (opcional) fija el stock actual en unidades en lugar de usar coberturaObj
  const MATERIALES = [
    { id: 'cemento',   nombre: 'Cemento portland',    unidad: 'bolsa 50 kg', precio0: 9000,    delta: 0.65, necesidadTotal: 11500,  desperdicio: 0.03,
      uso: { suelos: 0.20, estructura: 0.40, mamposteria: 0.25, terminaciones: 0.15 }, coberturaObj: 1.4, reposicion: 0.5 },
    { id: 'hierro',    nombre: 'Hierro ADN 420',      unidad: 'tn',          precio0: 1150000, delta: 1.15, necesidadTotal: 120,    desperdicio: 0.04,
      uso: { suelos: 0.15, estructura: 0.85 }, coberturaObj: 0.7, reposicion: 1.0 },
    { id: 'ladrillos', nombre: 'Ladrillos huecos',    unidad: 'unidad',      precio0: 780,     delta: 0.35, necesidadTotal: 190000, desperdicio: 0.05,
      uso: { mamposteria: 1.0 }, coberturaObj: 2.6, reposicion: 0.75 },
    { id: 'arena',     nombre: 'Arena fina',          unidad: 'm³',          precio0: 28000,   delta: 0.10, necesidadTotal: 2400,   desperdicio: 0.03,
      uso: { suelos: 0.10, estructura: 0.20, mamposteria: 0.35, terminaciones: 0.35 }, coberturaObj: 1.8, reposicion: 0.25 },
    { id: 'canerias',  nombre: 'Cañerías PVC / PPR',  unidad: 'metro',       precio0: 5500,    delta: 1.00, necesidadTotal: 10000,  desperdicio: 0.04,
      uso: { instalaciones: 1.0 }, coberturaObj: 1.5, reposicion: 1.0 },
    { id: 'cables',    nombre: 'Cables eléctricos',   unidad: 'metro',       precio0: 1600,    delta: 0.85, necesidadTotal: 43000,  desperdicio: 0.04,
      uso: { instalaciones: 1.0 }, coberturaObj: 2.2, reposicion: 0.75 },
    { id: 'aberturas', nombre: 'Aberturas (juego)',   unidad: 'juego',       precio0: 320000,  delta: 0.60, necesidadTotal: 336,    desperdicio: 0.01,
      uso: { aberturas: 1.0 }, coberturaObj: 2.4, reposicion: 2.0 },
    { id: 'ceramicos', nombre: 'Cerámicos y porcelanatos', unidad: 'm²',     precio0: 16000,   delta: 0.25, necesidadTotal: 5300,   desperdicio: 0.06,
      uso: { terminaciones: 1.0 }, coberturaObj: 3.5, reposicion: 1.0 },
    { id: 'pintura',   nombre: 'Pintura látex',       unidad: 'litro',       precio0: 6000,    delta: 0.15, necesidadTotal: 6700,   desperdicio: 0.05,
      uso: { terminaciones: 1.0 }, coberturaObj: 5.0, reposicion: 0.5 }
  ];

  // Materiales que se grafican en "evolución del stock" y "evolución de precios".
  const MATERIALES_CRITICOS = ['hierro', 'cemento', 'canerias', 'aberturas'];
  const MATERIALES_PRECIO   = ['hierro', 'cemento', 'canerias', 'cables', 'ladrillos'];
  const VENTANA_CONSUMO = 6; // meses para el "consumo mensual promedio"

  /* ===========================================================================
     3) ÍNDICES (variación mensual, en %)
        Posición del array = número de mes (mes 1 = base, sin variación).
     =========================================================================== */
  // Costo REAL de la construcción que enfrenta la cooperativa (sus precios efectivos).
  const CCI_VAR = [0, 0, 2.9, 2.4, 2.1, 2.8, 2.6, 3.1, 2.2, 2.7, 2.5, 2.9, 2.3, 2.6, 2.8];
  // Índice de actualización de las cuotas (tipo ICC; llega con rezago y algo por debajo).
  const IAC_VAR = [0, 0, 2.0, 2.6, 2.2, 1.9, 2.4, 2.2, 2.6, 2.1, 2.3, 2.2, 2.5, 2.1, 2.2];

  /* ===========================================================================
     4) CUOTAS, APORTES Y SUPUESTOS DE PROYECCIÓN
     =========================================================================== */
  // Peso del impago del mes según tramo de atraso: [al día, 1-30, 31-60, +60 días]
  const PESO_IMPAGO_TRAMO = [0, 0.35, 0.80, 1.00];
  const TRAMOS = ['Al día', '1-30 días', '31-60 días', '+60 días'];

  // Aportes que no son cuotas, en pesos corrientes (monto fijo, no se actualiza).
  const APORTES = [
    { mes: 1,  monto: 70e6, concepto: 'Aporte inicial de socios' },
    { mes: 3,  monto: 200e6, concepto: 'Programa provincial · 1.ª tramo' },
    { mes: 8,  monto: 160e6, concepto: 'Programa provincial · 2.º tramo' },
    { mes: 13, monto: 140e6, concepto: 'Programa provincial · 3.º tramo' },
    { mes: 19, monto: 130e6, concepto: 'Programa provincial · 4.º tramo (programado)' },
    { mes: 24, monto: 100e6, concepto: 'Programa provincial · 5.º tramo (programado)' }
  ];

  // Supuestos por defecto hacia adelante (se pueden mover en el simulador).
  const SUPUESTOS = {
    inflacionMensual: 2.4,     // % mensual del costo real de la construcción
    iacMensual: 2.1,           // % mensual del índice de actualización de cuotas
    // Escenarios de morosidad para la proyección de cobranza (a 12 meses):
    // multiplicadores de la morosidad actual que se alcanzan al mes 12.
    escenariosMora: { base: 1.0, optimista: 0.45, pesimista: 1.9 },
    mesesProyeccion: 12
  };

  /* ===========================================================================
     5) MOTOR DE GENERACIÓN (no hace falta tocar de acá en adelante)
     =========================================================================== */
  const H = CONFIG.horizonte;
  const CUR = CONFIG.mesActual;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = t => t * t * (3 - 2 * t);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(CONFIG.semilla);
  const ruido = amp => (rnd() - 0.5) * 2 * amp;
  const phi = (x, r) => smooth(clamp((x - r.a) / (r.b - r.a), 0, 1));

  const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const meses = [{ n: 0, label: 'Previo', anio: 0, mes: 0 }];
  for (let m = 1; m <= H; m++) {
    const idx = (CONFIG.mesBase.mes - 1) + (m - 1);
    const anio = CONFIG.mesBase.anio + Math.floor(idx / 12);
    meses.push({ n: m, label: MESES_ES[idx % 12] + '-' + String(anio).slice(2), anio: anio, mes: (idx % 12) + 1 });
  }

  /* --- 5.1 Índices acumulados (base = 1 en el mes 1) --- */
  const cci = [1, 1], iac = [1, 1];
  for (let m = 2; m <= H; m++) {
    const vc = m <= CUR ? CCI_VAR[m] : SUPUESTOS.inflacionMensual;
    const vi = m <= CUR ? IAC_VAR[m] : SUPUESTOS.iacMensual;
    cci.push(cci[m - 1] * (1 + vc / 100));
    iac.push(iac[m - 1] * (1 + vi / 100));
  }

  /* --- 5.2 Avance físico por etapa y rubro --- */
  // xPlan / xReal: "reloj" de cada etapa (0-1). El avance físico de cada rubro es una
  // curva suave (S) dentro de su tramo [a, b] y el avance de la etapa es el promedio
  // ponderado de sus rubros por incidencia en el presupuesto.
  const xPlan = [], xReal = [];
  ETAPAS.forEach(e => {
    const xp = [0], xr = [0];
    let prev = 0;
    for (let m = 1; m <= H; m++) {
      const t = m - e.inicio + 1;
      xp.push(clamp(t / e.duracion, 0, 1));
      let x;
      if (m <= CUR) {
        if (t <= 0) x = 0;
        else {
          const lag = e.rezago * Math.min(1, t / 6);
          x = clamp((t - lag + ruido(0.2)) / e.duracion, 0, 1);
        }
        x = Math.max(x, prev);
      } else {
        x = Math.min(1, xr[CUR] + (m - CUR) * e.ritmoProy / e.duracion);
      }
      prev = x;
      xr.push(x);
    }
    xPlan.push(xp);
    xReal.push(xr);
  });

  // rubPlan[s][r][m] y rubReal[s][r][m]: avance (0-1) del rubro r en la etapa s.
  const rubPlan = ETAPAS.map((e, s) => RUBROS.map(r => xPlan[s].map(x => phi(x, r))));
  const rubReal = ETAPAS.map((e, s) => RUBROS.map(r => xReal[s].map(x => phi(x, r))));
  // avPlan[s][m] y avReal[s][m]: avance físico (0-1) de la etapa.
  const sumaPond = (rub, s, m) => RUBROS.reduce((acc, r, i) => acc + r.peso * rub[s][i][m], 0);
  const avPlan = ETAPAS.map((e, s) => Array.from({ length: H + 1 }, (_, m) => sumaPond(rubPlan, s, m)));
  const avReal = ETAPAS.map((e, s) => Array.from({ length: H + 1 }, (_, m) => sumaPond(rubReal, s, m)));

  /* --- 5.3 Precios de materiales --- */
  MATERIALES.forEach(mat => {
    const precio = [mat.precio0, mat.precio0];
    for (let m = 2; m <= H; m++) {
      const pi = (cci[m] / cci[m - 1] - 1) * 100;                 // inflación general del mes (%)
      const var_ = pi + mat.delta + ruido(0.45);                  // + sobreprecio propio + ruido
      precio.push(precio[m - 1] * (1 + var_ / 100));
    }
    mat.precio = precio;
  });
  const gastoMat0 = MATERIALES.reduce((a, k) => a + k.necesidadTotal * k.precio0, 0);
  // Índice ponderado de precios de materiales (base 1 en mes 1).
  const idxMateriales = Array.from({ length: H + 1 }, (_, m) =>
    m === 0 ? 1 : MATERIALES.reduce((a, k) => a + (k.necesidadTotal * k.precio0) * (k.precio[m] / k.precio0), 0) / gastoMat0);

  /* --- 5.4 Sobrecosto sobre lo presupuestado, por categoría y mes (en pesos constantes) --- */
  // oCat[c][m]; para los meses proyectados se mantiene el promedio de los últimos 3 reales.
  const oCat = [[], [], [], []];
  for (let m = 0; m <= H; m++) {
    if (m <= CUR) {
      oCat[0][m] = Math.max(0, idxMateriales[m] / cci[m] - 1) + SOBRECOSTOS.desperdicioMateriales + (m ? ruido(0.004) : 0);
      oCat[1][m] = SOBRECOSTOS.manoDeObra.base + SOBRECOSTOS.manoDeObra.porMes * m + (m ? ruido(0.006) : 0);
      oCat[2][m] = SOBRECOSTOS.subcontratos.base + SOBRECOSTOS.subcontratos.porMes * m + (m ? ruido(0.010) : 0);
      oCat[3][m] = SOBRECOSTOS.gastosGen.base + SOBRECOSTOS.gastosGen.porMes * m + (m ? ruido(0.008) : 0);
    } else {
      for (let c = 0; c < 4; c++) oCat[c][m] = (oCat[c][CUR] + oCat[c][CUR - 1] + oCat[c][CUR - 2]) / 3;
    }
  }

  /* --- 5.5 Presupuesto, valor ganado y costo real (en pesos del mes base) --- */
  // plan[s][r][m]   : presupuesto previsto devengado en el mes (según avance previsto)
  // ganado[s][r][m] : presupuesto correspondiente al avance REAL del mes (valor ganado)
  // costo[s][c][m]  : costo real del mes por categoría (c = 0..3)
  // costoRub[s][r][m]: costo real del mes por rubro
  const plan = [], ganado = [], costo = [], costoRub = [];
  ETAPAS.forEach((e, s) => {
    const p = RUBROS.map(() => [0]), g = RUBROS.map(() => [0]);
    const cc = [0, 1, 2, 3].map(() => [0]), cr = RUBROS.map(() => [0]);
    for (let m = 1; m <= H; m++) {
      RUBROS.forEach((r, i) => {
        const dPlan = e.presupuesto * r.peso * (rubPlan[s][i][m] - rubPlan[s][i][m - 1]);
        const dReal = e.presupuesto * r.peso * (rubReal[s][i][m] - rubReal[s][i][m - 1]);
        p[i].push(dPlan);
        g[i].push(dReal);
        let tot = 0;
        for (let c = 0; c < 4; c++) {
          const o = c === 0 ? oCat[0][m] * r.fMat : oCat[c][m];
          const v = dReal * r.mix[c] * (1 + o);
          cc[c][m] = (cc[c][m] || 0) + v;
          tot += v;
        }
        cr[i].push(tot);
      });
    }
    plan.push(p); ganado.push(g); costo.push(cc); costoRub.push(cr);
  });

  /* --- 5.6 Cuotas de beneficiarios (en pesos corrientes) --- */
  // emitidas[s][m], cobradas[s][m] (cobradas solo hasta el mes actual) y
  // tramos[s][t][m] = cantidad de beneficiarios por tramo de atraso.
  const emitidas = [], cobradas = [], tramos = [];
  ETAPAS.forEach(e => {
    const em = [0], co = [0];
    const tr = [0, 1, 2, 3].map(() => [0]);
    for (let m = 1; m <= H; m++) {
      em.push(e.viviendas * e.cuotaBase * iac[m]);
      if (m <= CUR) {
        const tasa = e.moraInicial + (e.moraActual - e.moraInicial) * (m - 1) / (CUR - 1) + ruido(0.02);
        const n = Math.round(clamp(tasa, 0, 1) * e.viviendas);
        const p3 = 0.05 + 0.17 * (m - 1) / (CUR - 1);
        const n3 = Math.round(n * p3);
        const n2 = Math.min(n - n3, Math.round(n * 0.25));
        const n1 = n - n3 - n2;
        const cnt = [e.viviendas - n, n1, n2, n3];
        for (let t = 0; t < 4; t++) tr[t].push(cnt[t]);
        const impago = cnt.reduce((a, v, t) => a + v * PESO_IMPAGO_TRAMO[t], 0) / e.viviendas;
        co.push(em[m] * (1 - impago));
      } else {
        for (let t = 0; t < 4; t++) tr[t].push(null);
        co.push(null);
      }
    }
    emitidas.push(em); cobradas.push(co); tramos.push(tr);
  });

  /* --- 5.7 Stock de materiales --- */
  // consumo[m]: unidades consumidas en el mes según el avance real de los rubros donde se usa
  // (promedio de las 3 etapas, que pesan igual). Proyectado después del mes actual.
  MATERIALES.forEach((mat, k) => {
    const totalCompra = mat.necesidadTotal * (1 + mat.desperdicio);
    const cons = [0];
    for (let m = 1; m <= H; m++) {
      let d = 0;
      RUBROS.forEach((r, i) => {
        const sh = mat.uso[r.id];
        if (!sh) return;
        let dm = 0;
        for (let s = 0; s < ETAPAS.length; s++) dm += rubReal[s][i][m] - rubReal[s][i][m - 1];
        d += sh * dm / ETAPAS.length;
      });
      cons.push(totalCompra * d);
    }
    mat.consumo = cons;
    const prom = (m) => {
      let a = 0, n = 0;
      for (let j = Math.max(1, m - VENTANA_CONSUMO + 1); j <= m; j++) { a += cons[j]; n++; }
      return n ? a / n : 0;
    };
    mat.consumoProm = Array.from({ length: H + 1 }, (_, m) => prom(m));
    const stockHoy = mat.stockActual != null ? mat.stockActual : mat.coberturaObj * mat.consumoProm[CUR];
    // Stock histórico reconstruido hacia atrás desde el stock actual, con compras "a saltos".
    const stock = new Array(CUR + 1).fill(0);
    const compras = new Array(CUR + 1).fill(0);
    stock[CUR] = stockHoy;
    let acum = 0; for (let m = 1; m <= CUR; m++) acum += cons[m];
    let acumHasta = acum;
    for (let m = CUR; m >= 1; m--) {
      const f = ((m + k) % 2 === 0 ? 1.45 : 0.55) * (0.8 + 0.4 * rnd());
      const c0 = f * cons[m];
      const piso = acumHasta - cons[m] > 0 ? 0.25 * mat.consumoProm[CUR] : 0;
      let prev = stock[m] - c0 + cons[m];
      prev = Math.min(stock[m] + cons[m], Math.max(Math.min(piso, stock[m] * 0.9), prev));
      stock[m - 1] = prev;
      compras[m] = stock[m] - prev + cons[m];
      acumHasta -= cons[m];
    }
    mat.stock = stock;       // índice m = stock al cierre del mes m
    mat.compras = compras;
    mat.consumido = cons.slice(0, CUR + 1).reduce((a, v) => a + v, 0);
    mat.totalCompra = totalCompra;
  });

  /* --- 5.8 Caja histórica (pesos corrientes) --- */
  const aportesPorMes = new Array(H + 1).fill(0);
  APORTES.forEach(a => { aportesPorMes[a.mes] += a.monto; });
  const sumaS = (arr3, m) => arr3.reduce((a, row) => a + (row[m] || 0), 0);
  const costoBaseTot = Array.from({ length: H + 1 }, (_, m) => costo.reduce((a, cs) => a + cs.reduce((b, row) => b + row[m], 0), 0));
  const cajaHist = [0];
  for (let m = 1; m <= CUR; m++) {
    cajaHist.push(cajaHist[m - 1] + sumaS(cobradas, m) + aportesPorMes[m] - costoBaseTot[m] * cci[m]);
  }

  return {
    CONFIG, ETAPAS, RUBROS, CATEGORIAS, MATERIALES, MATERIALES_CRITICOS, MATERIALES_PRECIO,
    TRAMOS, PESO_IMPAGO_TRAMO, APORTES, SUPUESTOS, SOBRECOSTOS, VENTANA_CONSUMO,
    meses, cci, iac, cciVar: CCI_VAR, iacVar: IAC_VAR, idxMateriales,
    avance: { xPlan, xReal, rubPlan, rubReal, avPlan, avReal },
    costos: { plan, ganado, costo, costoRub, oCat, costoBaseTot },
    cuotas: { emitidas, cobradas, tramos },
    caja: { hist: cajaHist, aportesPorMes }
  };
})();

if (typeof module !== 'undefined') module.exports = DATA;
