/* =============================================================================
   app.js · SERCA Consultora · Tablero de ejemplo
   Toda la información sale de data.js (objeto DATA). Acá solo hay lógica de
   cálculo, filtros y gráficos. Datos 100% ficticios.
   ============================================================================= */
(function () {
  'use strict';

  const D = DATA;
  const CUR = D.CONFIG.mesActual;          // mes actual (14)
  const H = D.CONFIG.horizonte;
  const VIEW_END = 26;                     // último mes que se muestra en gráficos con proyección
  const NS = D.ETAPAS.length;

  /* ---------- Colores ---------- */
  const COL = {
    navy: '#0B2A4A', blue: '#1380E4', light: '#8CC1F5', grey: '#9FB3C8', soft: '#D7E3F0',
    green: '#2E9E5B', amber: '#E69A0B', red: '#D64545', teal: '#14A3A3', violet: '#7C6BD6', orange: '#E8742C'
  };
  const SERIES = [COL.blue, COL.navy, COL.teal, COL.amber, COL.violet, COL.red];

  /* ---------- Umbrales de semáforo (editables) ---------- */
  const UMB = {
    avance:    { ok: -0.02, warn: -0.06 },   // avance real menos previsto (fracción)
    ejec:      { ok: 0.02,  warn: 0.04 },    // ejecución presupuestaria menos avance físico
    desvio:    { ok: 0.02,  warn: 0.06 },    // costo real / valor ganado - 1
    cobranza:  { ok: 0.95,  warn: 0.88 },    // cobrado / emitido del mes
    mora:      { ok: 0.08,  warn: 0.15 },    // % de beneficiarios con atraso
    cobertura: { ok: 1.00,  warn: 0.95 },    // fondos proyectados / inversión remanente
    atraso:    { ok: 20,    warn: 60 }       // días de desvío de cronograma
  };

  /* ---------- Formato argentino ---------- */
  function nf(v, d) {
    d = d || 0;
    if (v == null || isNaN(v)) return '—';
    const neg = v < 0 && Math.round(Math.abs(v) * Math.pow(10, d)) > 0;
    const parts = Math.abs(v).toFixed(d).split('.');
    const ent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + ent + (parts[1] ? ',' + parts[1] : '');
  }
  const pct = (f, d) => nf(f * 100, d == null ? 1 : d) + '%';
  const signo = (v, d) => (v > 0 ? '+' : '') + nf(v, d);
  const money = v => '$ ' + nf(v, 0);
  const mM = (v, d) => '$ ' + nf(v / 1e6, d == null ? 0 : d) + ' M';
  const mMs = (v, d) => (v > 0 ? '+' : v < 0 ? '-' : '') + '$ ' + nf(Math.abs(v) / 1e6, d == null ? 0 : d) + ' M';
  const lab = m => D.meses[Math.round(m)].label;
  const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const ESTADO = { ok: 'En orden', warn: 'Atención', bad: 'Crítico' };
  const chip = st => '<span class="chip ' + st + '">' + ESTADO[st] + '</span>';
  // Semáforo: valores donde "más alto es peor"
  const stHigh = (v, lim) => (v <= lim.ok ? 'ok' : v <= lim.warn ? 'warn' : 'bad');
  // Semáforo: valores donde "más alto es mejor"
  const stLow = (v, lim) => (v >= lim.ok ? 'ok' : v >= lim.warn ? 'warn' : 'bad');

  /* ---------- Estado de filtros ---------- */
  const state = { etapa: 'todas', periodo: 'todo', tab: 'resumen' };
  const selIdx = () => (state.etapa === 'todas' ? range(0, NS - 1) : [Number(state.etapa) - 1]);
  const fromM = () => (state.periodo === 'todo' ? 1 : Math.max(1, CUR - Number(state.periodo) + 1));
  const el = id => document.getElementById(id);

  /* ===========================================================================
     CÁLCULOS COMPARTIDOS
     =========================================================================== */
  const presup = sel => sum(sel, s => D.ETAPAS[s].presupuesto);

  // Avance físico (fracción 0-1) de las etapas seleccionadas, ponderado por presupuesto.
  function avance(kind, sel, m) {
    return sum(sel, s => D.avance[kind][s][m] * D.ETAPAS[s].presupuesto) / presup(sel);
  }
  function avanceRubro(kind, r, sel, m) {
    return sum(sel, s => D.avance[kind][s][r][m] * D.ETAPAS[s].presupuesto) / presup(sel);
  }

  // Flujos mensuales (pesos del mes base) de las etapas seleccionadas.
  function flujos(sel) {
    const z = () => new Array(H + 1).fill(0);
    const f = { plan: z(), gan: z(), real: z(), cat: [z(), z(), z(), z()],
      ganRub: D.RUBROS.map(z), realRub: D.RUBROS.map(z), ganCat: [z(), z(), z(), z()] };
    sel.forEach(s => {
      for (let m = 1; m <= H; m++) {
        D.RUBROS.forEach((r, i) => {
          const p = D.costos.plan[s][i][m], g = D.costos.ganado[s][i][m];
          f.plan[m] += p; f.gan[m] += g;
          f.ganRub[i][m] += g;
          f.realRub[i][m] += D.costos.costoRub[s][i][m];
          for (let c = 0; c < 4; c++) f.ganCat[c][m] += g * r.mix[c];
        });
        for (let c = 0; c < 4; c++) { const v = D.costos.costo[s][c][m]; f.real[m] += v; f.cat[c][m] += v; }
      }
    });
    return f;
  }
  const cum = arr => { let t = 0; return arr.map(v => (t += v)); };
  const cumTo = (arr, m) => { let t = 0; for (let i = 1; i <= m; i++) t += arr[i]; return t; };

  // Estado de las viviendas de una etapa al mes actual.
  function estadoViviendas(s) {
    const e = D.ETAPAS[s];
    const x = D.avance.xReal[s][CUR];
    const iTer = D.RUBROS.findIndex(r => r.id === 'terminaciones');
    const done = Math.round(e.viviendas * D.avance.rubReal[s][iTer][CUR]);
    const ini = x > 0 ? Math.min(e.viviendas, Math.ceil(e.viviendas * Math.min(1, x / 0.55))) : 0;
    const entreg = Math.min(e.entregadas, done);
    return {
      entregadas: entreg,
      terminadas: done - entreg,
      enObra: Math.max(0, ini - done),
      sinIniciar: e.viviendas - Math.max(ini, done)
    };
  }

  // Cronograma por etapa: fin previsto, fin proyectado y desvíos en días (1 mes = 30 días).
  function cronograma(s) {
    const e = D.ETAPAS[s];
    const x = D.avance.xReal[s];
    const planEnd = e.inicio + e.duracion - 1;
    let projEnd, nowDelay, finished = false;
    if (x[CUR] >= 0.999) {
      let m = 1; while (x[m] < 0.999) m++;
      projEnd = m; nowDelay = (m - planEnd) * 30; finished = true;
    } else {
      projEnd = CUR + (1 - x[CUR]) * e.duracion / e.ritmoProy;
      const tEq = x[CUR] * e.duracion + e.inicio - 1;
      nowDelay = x[CUR] > 0 ? (CUR - tEq) * 30 : 0;
    }
    return { planEnd, projEnd, nowDelay: Math.max(0, Math.round(nowDelay)), finDelay: Math.round((projEnd - planEnd) * 30), finished };
  }

  // Cuotas de un mes para un conjunto de etapas.
  function cuotasMes(sel, m) {
    m = m || CUR;
    const emi = sum(sel, s => D.cuotas.emitidas[s][m]);
    const cob = sum(sel, s => D.cuotas.cobradas[s][m]);
    const viv = sum(sel, s => D.ETAPAS[s].viviendas);
    const tr = [0, 1, 2, 3].map(t => sum(sel, s => D.cuotas.tramos[s][t][m]));
    const mora = tr[1] + tr[2] + tr[3];
    return { emi, cob, viv, tr, mora, moraShare: mora / viv, cobShare: cob / emi };
  }
  // Factor que convierte "% de beneficiarios en mora" en "% de la cuota no cobrada".
  function factorImpago(sel) {
    const q = cuotasMes(sel);
    return q.mora > 0 ? (1 - q.cobShare) / q.moraShare : 0.6;
  }
  const ALL = range(0, NS - 1);
  const K_GLOBAL = factorImpago(ALL);

  /* ---------- Modelo de suficiencia financiera (pesos corrientes) ---------- */
  const END_MONTH = (() => { let e = CUR; for (let m = CUR + 1; m <= H; m++) if (D.costos.costoBaseTot[m] > 1) e = m; return e; })();
  const CUOTA_BASE_TOT = sum(D.ETAPAS, e => e.viviendas * e.cuotaBase);
  const DEFAULTS = () => ({
    inf: D.SUPUESTOS.inflacionMensual,
    iac: D.SUPUESTOS.iacMensual,
    mora: cuotasMes(ALL).moraShare
  });
  function finModel(p) {
    const unpaid = Math.min(1, p.mora * K_GLOBAL);
    let cciF = D.cci[CUR], iacF = D.iac[CUR];
    const saldoIni = D.caja.hist[CUR];
    let saldo = saldoIni, sumIng = 0, sumEgr = 0, minSaldo = saldoIni, minMes = CUR, efecto = 0;
    const rows = [];
    for (let m = CUR + 1; m <= END_MONTH; m++) {
      cciF *= 1 + p.inf / 100;
      iacF *= 1 + p.iac / 100;
      const egreso = D.costos.costoBaseTot[m] * cciF;
      const cobr = CUOTA_BASE_TOT * iacF * (1 - unpaid);
      const aportes = D.caja.aportesPorMes[m];
      const ingreso = cobr + aportes;
      saldo += ingreso - egreso;
      sumIng += ingreso; sumEgr += egreso;
      efecto += cobr * (cciF / iacF - 1);
      if (saldo < minSaldo) { minSaldo = saldo; minMes = m; }
      rows.push({ m, cobr, aportes, ingreso, egreso, saldo });
    }
    return { rows, saldoIni, saldoFinal: saldo, sumIng, sumEgr, minSaldo, minMes, efecto,
      cobertura: (saldoIni + sumIng) / sumEgr, disponibles: saldoIni + sumIng };
  }

  /* ===========================================================================
     CHART.JS · configuración común
     =========================================================================== */
  Chart.defaults.font.family = "'Montserrat', system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = '#4B5B6E';
  Chart.defaults.animation = { duration: 250 };

  const charts = {};
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  function merge(a, b) {
    const out = Object.assign({}, a);
    Object.keys(b || {}).forEach(k => { out[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; });
    return out;
  }
  function baseOpts(extra) {
    return merge({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 11 } } },
        tooltip: { backgroundColor: '#0B2A4A', padding: 10, titleFont: { weight: '700' }, bodySpacing: 4, boxPadding: 4 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 10.5 } } },
        y: { grid: { color: '#E6ECF2' }, ticks: { font: { size: 10.5 } } }
      }
    }, extra || {});
  }
  // Línea vertical punteada "Hoy" (mes actual).
  Chart.register({
    id: 'hoy',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || opts.index == null || opts.index < 0) return;
      const x = chart.scales.x.getPixelForValue(opts.index);
      const area = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#0B2A4A'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#0B2A4A'; ctx.font = '600 10px Montserrat, sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('HOY', x, area.top - 3);
      ctx.restore();
    }
  });
  function mk(id, cfg) {
    const canvas = el(id);
    if (!canvas) return null;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas, cfg);
    return charts[id];
  }
  const tickNum = (d, suf) => v => nf(v, d) + (suf || '');
  const tipVal = (f, axis) => c => {
    const v = axis === 'x' ? c.parsed.x : c.parsed.y;
    return ' ' + c.dataset.label + ': ' + f(v);
  };
  const line = (label, data, color, extra) => Object.assign({
    type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2.5,
    pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: false
  }, extra || {});
  const bar = (label, data, color, extra) => Object.assign({
    type: 'bar', label, data, backgroundColor: color, borderRadius: 4, maxBarThickness: 38
  }, extra || {});

  /* ===========================================================================
     1) RESUMEN EJECUTIVO
     =========================================================================== */
  function kpi(estado, label, val, sub) {
    const tag = estado === 'neutral' ? '<span class="chip neutral">Dato</span>' : chip(estado);
    return '<div class="kpi ' + estado + '"><div class="k-label">' + label + '</div>' + tag +
      '<div class="k-val">' + val + '</div><div class="k-sub">' + sub + '</div></div>';
  }

  function renderResumen() {
    const sel = selIdx();
    const B = presup(sel);
    const f = flujos(sel);

    // Datos del proyecto
    const c = D.CONFIG;
    const avRealAll = avance('avReal', ALL, CUR);
    el('proyecto').innerHTML =
      '<div class="dato"><small>Cooperativa</small><b>' + esc(c.cooperativa) + '</b></div>' +
      '<div class="dato"><small>Plan</small><b>' + c.viviendas + ' viviendas · ' + NS + ' etapas</b></div>' +
      '<div class="dato"><small>Presupuesto total</small><b>' + mM(c.presupuestoTotal) + '</b><br><small style="text-transform:none;letter-spacing:0">a valores del mes base (' + lab(1) + ')</small></div>' +
      '<div class="dato"><small>Plazo de obra</small><b>' + c.plazoMeses + ' meses</b></div>' +
      '<div class="dato"><small>Mes actual</small><b>' + lab(CUR) + ' · mes ' + CUR + '</b></div>' +
      '<div class="timeline"><div class="bar"><i style="width:' + (CUR / c.plazoMeses * 100).toFixed(1) + '%"></i></div>' +
      '<small>Transcurrió el <b>' + pct(CUR / c.plazoMeses) + '</b> del plazo (' + CUR + ' de ' + c.plazoMeses + ' meses) · avance físico del plan completo: <b>' + pct(avRealAll) + '</b></small></div>';

    // KPI 1: avance físico
    const aR = avance('avReal', sel, CUR), aP = avance('avPlan', sel, CUR);
    const stAv = stLow(aR - aP, UMB.avance);
    // KPI 2 y 3: ejecución presupuestaria y desvío de costos
    const costoAc = cumTo(f.real, CUR), ganAc = cumTo(f.gan, CUR);
    const ejec = costoAc / B;
    const desvio = costoAc / ganAc - 1;
    const stEj = stHigh(ejec - aR, UMB.ejec);
    const stDe = stHigh(desvio, UMB.desvio);
    // KPI 4 y 5: cuotas
    const q = cuotasMes(sel);
    const stCo = stLow(q.cobShare, UMB.cobranza);
    const stMo = stHigh(q.moraShare, UMB.mora);
    // KPI 6: cobertura financiera (siempre total del plan, escenario base)
    const fin = finModel(DEFAULTS());
    const stCb = stLow(fin.cobertura, UMB.cobertura);

    el('kpis').innerHTML =
      kpi(stAv, 'Avance físico (real vs. previsto)', pct(aR),
        'Previsto <b>' + pct(aP) + '</b> · desvío <b>' + signo((aR - aP) * 100, 1) + ' p.p.</b>') +
      kpi(stEj, 'Ejecución presupuestaria', pct(ejec),
        '<b>' + mM(costoAc) + '</b> de ' + mM(B) + ' (mes base) · avance físico ' + pct(aR)) +
      kpi(stDe, 'Desvío de costos', signo(desvio * 100, 1) + '%',
        'Costo real <b>' + mMs(costoAc - ganAc) + '</b> sobre lo presupuestado para el avance logrado') +
      kpi(stCo, 'Cobranza del mes (' + lab(CUR) + ')', mM(q.cob),
        '<b>' + pct(q.cobShare) + '</b> de lo emitido (' + mM(q.emi) + ')') +
      kpi(stMo, 'Morosidad', pct(q.moraShare),
        '<b>' + q.mora + ' de ' + q.viv + '</b> beneficiarios con atraso (' + (q.tr[2] + q.tr[3]) + ' con más de 30 días)') +
      kpi(stCb, 'Cobertura financiera proyectada', pct(fin.cobertura, 1),
        fin.saldoFinal < 0 ? 'Faltante estimado <b>' + mM(-fin.saldoFinal) + '</b> · total del plan' : 'Excedente estimado <b>' + mM(fin.saldoFinal) + '</b> · total del plan');

    // Alertas tempranas
    const al = [];
    // 1) financiera / índice
    const brecha = D.cci[CUR] - D.iac[CUR];
    al.push({ sev: stCb, t: 'Suficiencia financiera',
      x: 'El índice de actualización de las cuotas va <b>' + nf(brecha * 100, 1) + ' p.p.</b> por debajo del costo real de la construcción. ' +
        (fin.saldoFinal < 0
          ? 'Con los supuestos actuales <b>faltarían ' + mM(-fin.saldoFinal) + '</b> para terminar la obra (cobertura de ' + pct(fin.cobertura) + ').'
          : 'Con los supuestos actuales la cobranza alcanza para terminar la obra.') });
    // 2) costos de materiales y stock
    const matReal = cumTo(f.cat[0], CUR), matGan = cumTo(f.ganCat[0], CUR);
    const oMat = matReal / matGan - 1;
    const sube = D.MATERIALES.map(k => ({ k, v: k.precio[CUR] / k.precio[1] / D.cci[CUR] - 1 })).sort((a, b) => b.v - a.v);
    const rojos = D.MATERIALES.filter(k => stockEstado(k).st === 'bad');
    let txtMat = 'El costo de materiales viene <b>' + pct(oMat) + ' por encima</b> de lo presupuestado para el avance logrado; los que más se encarecieron son ' +
      sube[0].k.nombre + ' y ' + sube[1].k.nombre + '.';
    if (rojos.length) txtMat += ' Además, el stock de ' + rojos.map(k => k.nombre).join(' y ') + ' está por debajo del plazo de reposición.';
    al.push({ sev: oMat >= 0.06 ? 'bad' : oMat >= 0.03 ? 'warn' : 'ok', t: 'Costos y abastecimiento', x: txtMat });
    // 3) cronograma
    const cr = sel.map(s => ({ s, c: cronograma(s) })).sort((a, b) => b.c.nowDelay - a.c.nowDelay);
    const peor = cr[0];
    const finProy = Math.max.apply(null, sel.map(s => cronograma(s).projEnd));
    const finPlan = Math.max.apply(null, sel.map(s => cronograma(s).planEnd));
    const demora = Math.round((finProy - finPlan) * 30);
    al.push({ sev: stHigh(Math.max(peor.c.nowDelay, demora), UMB.atraso), t: 'Cronograma',
      x: 'La <b>' + D.ETAPAS[peor.s].nombre + '</b> acumula <b>' + peor.c.nowDelay + ' días</b> de atraso respecto del cronograma. Al ritmo actual ' +
        (sel.length > 1 ? 'la obra' : 'la etapa') + ' terminaría en <b>' + lab(Math.ceil(finProy)) + '</b>, unos <b>' + demora + ' días</b> después de lo previsto.' });
    // 4) morosidad
    const mo = sel.map(s => ({ s, qq: cuotasMes([s]) })).sort((a, b) => b.qq.moraShare - a.qq.moraShare)[0];
    al.push({ sev: stHigh(mo.qq.moraShare, UMB.mora), t: 'Cobranza y morosidad',
      x: 'En la <b>' + D.ETAPAS[mo.s].nombre + '</b>, ' + mo.qq.mora + ' de ' + mo.qq.viv + ' beneficiarios están en mora (<b>' + pct(mo.qq.moraShare) + '</b>)' +
        (mo.qq.tr[3] ? ' y ' + mo.qq.tr[3] + ' supera' + (mo.qq.tr[3] > 1 ? 'n' : '') + ' los 60 días' : '') +
        '. La cobranza del mes cubrió ' + pct(q.cobShare) + ' de lo emitido.' });
    const orden = { bad: 0, warn: 1, ok: 2 };
    al.sort((a, b) => orden[a.sev] - orden[b.sev]);
    el('alertas').innerHTML = al.map(a =>
      '<li class="' + a.sev + '"><span class="dot"></span><div><span class="a-t">' + a.t + ' · ' + ESTADO[a.sev] + '</span>' + a.x + '</div></li>').join('');
  }

  /* ===========================================================================
     2) AVANCE DE OBRA
     =========================================================================== */
  function renderAvance() {
    const sel = selIdx();
    const from = fromM();
    const meses = range(from, VIEW_END);

    // Curva S
    mk('c-scurve', {
      data: {
        labels: meses.map(lab),
        datasets: [
          line('Previsto', meses.map(m => avance('avPlan', sel, m) * 100), COL.navy, { borderWidth: 2.5 }),
          line('Real', meses.map(m => m <= CUR ? avance('avReal', sel, m) * 100 : null), COL.blue,
            { borderWidth: 3.5, fill: true, backgroundColor: 'rgba(19,128,228,.12)' }),
          line('Proyección al ritmo actual', meses.map(m => m >= CUR ? avance('avReal', sel, m) * 100 : null), COL.blue,
            { borderDash: [6, 5], borderWidth: 2.5 })
        ]
      },
      options: baseOpts({
        plugins: { hoy: { index: CUR - from }, tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%') } } },
        scales: { y: { min: 0, max: 100, ticks: { callback: tickNum(0, '%') } } }
      })
    });

    // Avance por etapa
    const lblE = sel.map(s => D.ETAPAS[s].nombre).concat(sel.length > 1 ? ['Total'] : []);
    const dP = sel.map(s => avance('avPlan', [s], CUR) * 100).concat(sel.length > 1 ? [avance('avPlan', sel, CUR) * 100] : []);
    const dR = sel.map(s => avance('avReal', [s], CUR) * 100).concat(sel.length > 1 ? [avance('avReal', sel, CUR) * 100] : []);
    mk('c-etapas', {
      data: { labels: lblE, datasets: [bar('Previsto', dP, COL.grey), bar('Real', dR, COL.blue)] },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%') } } },
        scales: { y: { min: 0, max: 100, ticks: { callback: tickNum(0, '%') } } }
      })
    });

    // Avance por rubro
    mk('c-rubros', {
      data: {
        labels: D.RUBROS.map(r => r.nombre),
        datasets: [
          bar('Previsto', D.RUBROS.map((r, i) => avanceRubro('rubPlan', i, sel, CUR) * 100), COL.grey, { maxBarThickness: 16 }),
          bar('Real', D.RUBROS.map((r, i) => avanceRubro('rubReal', i, sel, CUR) * 100), COL.blue, { maxBarThickness: 16 })
        ]
      },
      options: baseOpts({
        indexAxis: 'y',
        plugins: { tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%', 'x') } } },
        scales: { x: { min: 0, max: 100, ticks: { callback: tickNum(0, '%') } }, y: { grid: { display: false }, ticks: { font: { size: 10.5 } } } }
      })
    });

    // Viviendas por estado
    const est = sel.map(estadoViviendas);
    mk('c-estados', {
      data: {
        labels: sel.map(s => D.ETAPAS[s].nombre),
        datasets: [
          bar('Entregadas', est.map(e => e.entregadas), COL.green, { borderRadius: 0 }),
          bar('Terminadas', est.map(e => e.terminadas), COL.teal, { borderRadius: 0 }),
          bar('En obra', est.map(e => e.enObra), COL.blue, { borderRadius: 0 }),
          bar('Sin iniciar', est.map(e => e.sinIniciar), COL.soft, { borderRadius: 0 })
        ]
      },
      options: baseOpts({
        indexAxis: 'y',
        plugins: { tooltip: { callbacks: { label: tipVal(v => nf(v, 0) + ' viv.', 'x') } } },
        scales: { x: { stacked: true, max: Math.max.apply(null, sel.map(s => D.ETAPAS[s].viviendas)), ticks: { callback: tickNum(0) }, title: { display: true, text: 'Viviendas', font: { size: 10.5 } } },
                  y: { stacked: true, grid: { display: false } } }
      })
    });
    const tot = k => sum(est, e => e[k]);
    el('estado-tot').innerHTML = '<b>Total:</b> ' + tot('entregadas') + ' entregadas · ' + tot('terminadas') + ' terminadas (pendientes de entrega) · ' +
      tot('enObra') + ' en obra · ' + tot('sinIniciar') + ' sin iniciar (' + sum(est, e => e.entregadas + e.terminadas + e.enObra + e.sinIniciar) + ' viviendas).';

    // Desvío de cronograma
    const dClass = d => stHigh(d, UMB.atraso);
    const filas = sel.map(s => ({ n: D.ETAPAS[s].nombre, c: cronograma(s) }));
    let html = '<tr><th>Etapa</th><th>Fin previsto</th><th>Fin proyectado</th><th>Desvío actual</th><th>Desvío al fin</th></tr>';
    filas.forEach(r => {
      html += '<tr><td>' + r.n + (r.c.finished ? '<br><small style="font-weight:500;color:#1E7A43">terminada</small>' : '') + '</td><td>' + lab(r.c.planEnd) + '</td><td>' + lab(Math.ceil(r.c.projEnd)) +
        '</td><td><span class="chip ' + dClass(r.c.nowDelay) + '">' + nf(r.c.nowDelay) + ' días</span></td><td><span class="chip ' + dClass(Math.max(0, r.c.finDelay)) + '">' + signo(r.c.finDelay) + ' días</span></td></tr>';
    });
    const finProy = Math.max.apply(null, filas.map(r => r.c.projEnd));
    const finPlan = Math.max.apply(null, filas.map(r => r.c.planEnd));
    const dem = Math.round((finProy - finPlan) * 30);
    if (filas.length > 1) {
      html += '<tr class="tot"><td>Obra completa</td><td>' + lab(finPlan) + '</td><td>' + lab(Math.ceil(finProy)) + '</td><td>—</td><td><span class="chip ' + dClass(Math.max(0, dem)) + '">' + signo(dem) + ' días</span></td></tr>';
    }
    el('tbl-desvio').innerHTML = html;
    el('desvio-total').innerHTML = 'Fin de obra proyectado: <b>' + lab(Math.ceil(finProy)) + '</b> · <b>' + signo(dem) + ' días</b> respecto de lo previsto (' + lab(finPlan) + ').';
  }

  /* ===========================================================================
     3) STOCK DE MATERIALES
     =========================================================================== */
  function stockEstado(mat) {
    const cons = mat.consumoProm[CUR];
    const cob = cons > 0 ? mat.stock[CUR] / cons : null;
    let st = 'ok';
    if (cob != null) st = cob < mat.reposicion ? 'bad' : cob < mat.reposicion + 1 ? 'warn' : 'ok';
    return { cob, st };
  }

  function renderStock() {
    const from = fromM();
    const dec = mat => (mat.unidad === 'tn' ? 1 : 0);
    let html = '<tr><th>Material</th><th>Stock actual</th><th>Consumo mensual</th><th>Cobertura (meses)</th><th>Necesidad restante</th><th>A comprar</th><th>Precio actual</th><th>Reposición</th><th class="c">Estado</th></tr>';
    const avisos = [];
    D.MATERIALES.forEach(mat => {
      const e = stockEstado(mat);
      const rest = mat.totalCompra - mat.consumido;
      const comprar = Math.max(0, rest - mat.stock[CUR]);
      const d = dec(mat);
      html += '<tr><td>' + mat.nombre + '<br><small style="font-weight:500;color:#5B6B7D">' + mat.unidad + '</small></td>' +
        '<td>' + nf(mat.stock[CUR], d) + '</td><td>' + nf(mat.consumoProm[CUR], d) + '</td>' +
        '<td><b>' + (e.cob == null ? '—' : nf(e.cob, 1)) + '</b></td><td>' + nf(rest, d) + '</td><td>' + nf(comprar, d) + '</td>' +
        '<td>' + money(mat.precio[CUR]) + '</td><td>' + nf(mat.reposicion * 30) + ' días</td><td class="c">' + chip(e.st) + '</td></tr>';
      if (e.st !== 'ok') avisos.push({ mat, e, comprar, d });
    });
    el('tbl-stock').innerHTML = html;
    const rojos = avisos.filter(a => a.e.st === 'bad'), ambar = avisos.filter(a => a.e.st === 'warn');
    el('stock-alert').innerHTML =
      rojos.map(a => '<div class="aviso">⚠ <b>' + a.mat.nombre + '</b>: el stock cubre solo ' + nf(a.e.cob, 1) + ' meses y el proveedor tarda ' + nf(a.mat.reposicion * 30) +
        ' días en reponer. Conviene emitir la orden de compra ya (faltan comprar ' + nf(a.comprar, a.d) + ' ' + a.mat.unidad + ').</div>').join('') +
      (ambar.length ? '<div class="aviso warn">En seguimiento: ' + ambar.map(a => a.mat.nombre + ' (' + nf(a.e.cob, 1) + ' meses)').join(', ') + '.</div>' : '');

    // Evolución del stock, expresado en meses de consumo al ritmo actual
    const meses = range(from, CUR);
    const crit = D.MATERIALES_CRITICOS.map(id => D.MATERIALES.find(k => k.id === id));
    mk('c-stock', {
      data: {
        labels: meses.map(lab),
        datasets: crit.map((mat, i) => line(mat.nombre, meses.map(m => {
          const c = mat.consumoProm[CUR];
          return c > 0 ? mat.stock[m] / c : null;
        }), SERIES[i], { borderWidth: 2.5 })).concat([
          line('Mínimo recomendado (1 mes)', meses.map(() => 1), '#7A8B9D', { borderDash: [5, 4], borderWidth: 1.5 })
        ])
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: {
          label: c => {
            if (c.datasetIndex >= crit.length) return ' ' + c.dataset.label;
            const mat = crit[c.datasetIndex];
            return ' ' + c.dataset.label + ': ' + nf(c.parsed.y, 1) + ' meses (' + nf(mat.stock[meses[c.dataIndex]], dec(mat)) + ' ' + mat.unidad + ')';
          } } } },
        scales: { y: { min: 0, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Meses de consumo', font: { size: 10.5 } } } }
      })
    });

    // Evolución de precios (índice base 100)
    const pr = D.MATERIALES_PRECIO.map(id => D.MATERIALES.find(k => k.id === id));
    mk('c-precios', {
      data: {
        labels: meses.map(lab),
        datasets: pr.map((mat, i) => line(mat.nombre, meses.map(m => mat.precio[m] / mat.precio[1] * 100), SERIES[i], { borderWidth: 2 })).concat([
          line('Costo real de la construcción', meses.map(m => D.cci[m] * 100), '#6B7C8F', { borderDash: [6, 4], borderWidth: 2.5 })
        ])
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: {
          label: c => {
            if (c.datasetIndex >= pr.length) return ' ' + c.dataset.label + ': ' + nf(c.parsed.y, 1);
            const mat = pr[c.datasetIndex];
            return ' ' + c.dataset.label + ': ' + nf(c.parsed.y, 1) + ' (' + money(mat.precio[meses[c.dataIndex]]) + ' / ' + mat.unidad + ')';
          } } } },
        scales: { y: { ticks: { callback: tickNum(0) }, title: { display: true, text: 'Índice (sep-25 = 100)', font: { size: 10.5 } } } }
      })
    });
  }

  /* ===========================================================================
     4) PRESUPUESTO VS COSTOS REALES (millones de pesos del mes base)
     =========================================================================== */
  function renderCostos() {
    const sel = selIdx();
    const f = flujos(sel);
    const from = fromM();
    const M = v => v / 1e6;

    // Por rubro
    const filas = D.RUBROS.map((r, i) => {
      const tot = presup(sel) * r.peso;
      const gan = cumTo(f.ganRub[i], CUR), real = cumTo(f.realRub[i], CUR);
      return { r, tot, gan, real, dif: real - gan, pct: gan > 0 ? real / gan - 1 : 0 };
    });
    mk('c-rubro-costo', {
      data: {
        labels: filas.map(x => x.r.nombre),
        datasets: [
          bar('Presupuestado al avance real', filas.map(x => M(x.gan)), COL.grey, { maxBarThickness: 16 }),
          bar('Costo real', filas.map(x => M(x.real)), COL.blue, { maxBarThickness: 16 })
        ]
      },
      options: baseOpts({
        indexAxis: 'y',
        plugins: { tooltip: { callbacks: {
          label: tipVal(v => '$ ' + nf(v, 1) + ' M', 'x'),
          afterBody: items => { const x = filas[items[0].dataIndex]; return 'Desvío: ' + mMs(x.dif, 1) + ' (' + signo(x.pct * 100, 1) + '%)'; }
        } } },
        scales: { x: { ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $ (mes base)', font: { size: 10.5 } } },
                  y: { grid: { display: false }, ticks: { font: { size: 10.5 } } } }
      })
    });
    let t = '<tr><th>Rubro</th><th>Presupuesto total</th><th>Presup. al avance real</th><th>Costo real</th><th>Desvío $ M</th><th>Desvío %</th></tr>';
    filas.forEach(x => {
      t += '<tr><td>' + x.r.nombre + '</td><td>' + nf(M(x.tot), 0) + '</td><td>' + nf(M(x.gan), 1) + '</td><td>' + nf(M(x.real), 1) + '</td>' +
        '<td class="' + (x.dif > 0 ? 'pos' : 'neg') + '">' + signo(M(x.dif), 1) + '</td><td class="' + (x.pct > 0.005 ? 'pos' : 'neg') + '">' + signo(x.pct * 100, 1) + '%</td></tr>';
    });
    const T = { tot: sum(filas, x => x.tot), gan: sum(filas, x => x.gan), real: sum(filas, x => x.real) };
    t += '<tr class="tot"><td>Total</td><td>' + nf(M(T.tot), 0) + '</td><td>' + nf(M(T.gan), 1) + '</td><td>' + nf(M(T.real), 1) + '</td><td>' + signo(M(T.real - T.gan), 1) + '</td><td>' + signo((T.real / T.gan - 1) * 100, 1) + '%</td></tr>';
    el('tbl-rubros').innerHTML = t;

    // Evolución mensual acumulada
    const meses = range(from, VIEW_END);
    const cPlan = cum(f.plan), cGan = cum(f.gan), cReal = cum(f.real);
    mk('c-costo-acum', {
      data: {
        labels: meses.map(lab),
        datasets: [
          line('Presupuesto previsto', meses.map(m => M(cPlan[m])), COL.navy),
          line('Presupuesto del avance real', meses.map(m => m <= CUR ? M(cGan[m]) : null), COL.grey, { borderWidth: 2 }),
          line('Costo real', meses.map(m => m <= CUR ? M(cReal[m]) : null), COL.blue, { borderWidth: 3.5, fill: true, backgroundColor: 'rgba(19,128,228,.10)' }),
          line('Costo real proyectado', meses.map(m => m >= CUR ? M(cReal[m]) : null), COL.blue, { borderDash: [6, 5] })
        ]
      },
      options: baseOpts({
        plugins: { hoy: { index: CUR - from }, tooltip: { callbacks: { label: tipVal(v => '$ ' + nf(v, 0) + ' M') } } },
        scales: { y: { min: 0, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $ (mes base)', font: { size: 10.5 } } } }
      })
    });

    // Composición del costo
    const cats = D.CATEGORIAS.map((n, c) => ({ n, real: cumTo(f.cat[c], CUR), gan: cumTo(f.ganCat[c], CUR) }));
    const catCol = [COL.blue, COL.navy, COL.teal, COL.amber];
    mk('c-composicion', {
      type: 'doughnut',
      data: { labels: cats.map(c => c.n), datasets: [{ data: cats.map(c => M(c.real)), backgroundColor: catCol, borderWidth: 2, borderColor: '#fff' }] },
      options: baseOpts({
        cutout: '58%',
        interaction: { mode: 'nearest', intersect: true },
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.label + ': $ ' + nf(c.parsed, 0) + ' M (' + nf(c.parsed / M(cumTo(f.real, CUR)) * 100, 1) + '%)' } },
                   legend: { position: 'right' } },
        scales: { x: { display: false }, y: { display: false } }
      })
    });
    let tc = '<tr><th>Categoría</th><th>Presup. al avance</th><th>Costo real</th><th>Desvío %</th></tr>';
    cats.forEach(c => {
      const d = c.real / c.gan - 1;
      tc += '<tr><td>' + c.n + '</td><td>' + nf(M(c.gan), 1) + '</td><td>' + nf(M(c.real), 1) + '</td><td class="' + (d > 0.005 ? 'pos' : 'neg') + '">' + signo(d * 100, 1) + '%</td></tr>';
    });
    el('tbl-comp').innerHTML = tc;

    // Estimación a terminación (EAC)
    const bCat = D.CATEGORIAS.map((n, c) => sum(f.ganCat[c], v => v));          // presupuesto original por categoría
    const eCat = D.CATEGORIAS.map((n, c) => sum(f.cat[c], v => v));             // costo real + proyectado por categoría
    const B = sum(bCat, v => v), E = sum(eCat, v => v);
    mk('c-eac', {
      data: {
        labels: ['Presupuesto original', 'Estimación a terminación'],
        datasets: D.CATEGORIAS.map((n, c) => bar(n, [M(bCat[c]), M(eCat[c])], catCol[c], { borderRadius: 0, maxBarThickness: 90, stack: 's' }))
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => '$ ' + nf(v, 0) + ' M'),
          footer: items => 'Total: $ ' + nf(sum(items, i => i.parsed.y), 0) + ' M' } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $ (mes base)', font: { size: 10.5 } } } }
      })
    });
    el('eac-txt').innerHTML = 'Costo a fin de obra estimado: <b>' + mM(E) + '</b> vs. presupuesto original <b>' + mM(B) + '</b> → <b>' + mMs(E - B) + ' (' + signo((E / B - 1) * 100, 1) + '%)</b>. ' +
      'Se proyecta el avance restante manteniendo los sobrecostos de los últimos 3 meses.';
  }

  /* ===========================================================================
     5) CUOTAS DE BENEFICIARIOS (pesos corrientes)
     =========================================================================== */
  function renderCuotas() {
    const sel = selIdx();
    const from = fromM();
    const meses = range(from, CUR);
    const M = v => v / 1e6;
    const emi = m => sum(sel, s => D.cuotas.emitidas[s][m]);
    const cob = m => sum(sel, s => D.cuotas.cobradas[s][m]);
    const viv = sum(sel, s => D.ETAPAS[s].viviendas);

    mk('c-cobranza', {
      data: {
        labels: meses.map(lab),
        datasets: [
          bar('Cuotas emitidas', meses.map(m => M(emi(m))), COL.soft, { order: 3 }),
          bar('Cuotas cobradas', meses.map(m => M(cob(m))), COL.blue, { order: 2 }),
          line('% de cobranza', meses.map(m => cob(m) / emi(m) * 100), COL.amber, { yAxisID: 'y2', order: 1, pointRadius: 3, borderWidth: 2.5 })
        ]
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + (c.dataset.yAxisID === 'y2' ? nf(c.parsed.y, 1) + '%' : '$ ' + nf(c.parsed.y, 1) + ' M') } } },
        scales: {
          y: { min: 0, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $', font: { size: 10.5 } } },
          y2: { position: 'right', min: 60, max: 105, grid: { drawOnChartArea: false }, ticks: { callback: v => (v > 100 ? '' : nf(v, 0) + '%'), stepSize: 10 } }
        }
      })
    });

    // Morosidad por tramos
    const q = cuotasMes(sel);
    el('chips-tramos').innerHTML = D.TRAMOS.map((n, t) =>
      '<div style="border-top-color:' + [COL.green, COL.amber, COL.orange, COL.red][t] + '"><small>' + n + '</small><b>' + q.tr[t] + '</b><span>' + pct(q.tr[t] / q.viv, 0) + '</span></div>').join('');
    const pctT = (t, m) => sum(sel, s => D.cuotas.tramos[s][t][m]) / viv * 100;
    mk('c-tramos', {
      data: {
        labels: meses.map(lab),
        datasets: [1, 2, 3].map(t => bar(D.TRAMOS[t], meses.map(m => pctT(t, m)), [COL.amber, COL.orange, COL.red][t - 1], { borderRadius: 0, stack: 'm', maxBarThickness: 30 }))
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%'), footer: items => 'Total en mora: ' + nf(sum(items, i => i.parsed.y), 1) + '%' } } },
        scales: { x: { stacked: true }, y: { stacked: true, min: 0, ticks: { callback: tickNum(0, '%') }, title: { display: true, text: '% de beneficiarios', font: { size: 10.5 } } } }
      })
    });

    // Por etapa
    const qs = ALL.map(s => cuotasMes([s]));
    mk('c-cuota-etapa', {
      data: {
        labels: D.ETAPAS.map(e => e.nombre),
        datasets: [
          bar('Cobranza del mes (% de lo emitido)', qs.map(x => x.cobShare * 100), COL.blue, { maxBarThickness: 36 }),
          bar('Beneficiarios en mora (%)', qs.map(x => x.moraShare * 100), COL.red, { maxBarThickness: 36 })
        ]
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%') } } },
        scales: { y: { min: 0, max: 100, ticks: { callback: tickNum(0, '%') } } }
      })
    });
    let tb = '<tr><th>Etapa</th><th>Cuota mensual</th><th>Emitido</th><th>Cobrado</th><th>% cobr.</th><th>En mora</th></tr>';
    ALL.forEach(s => {
      const x = qs[s], e = D.ETAPAS[s];
      tb += '<tr><td>' + e.nombre + '</td><td>' + money(e.cuotaBase * D.iac[CUR]) + '</td><td>' + mM(x.emi, 1) + '</td><td>' + mM(x.cob, 1) + '</td><td>' + pct(x.cobShare) + '</td>' +
        '<td><span class="chip ' + stHigh(x.moraShare, UMB.mora) + '">' + x.mora + ' de ' + x.viv + '</span></td></tr>';
    });
    el('tbl-cuota-etapa').innerHTML = tb;

    // Proyección a 12 meses
    const N = D.SUPUESTOS.mesesProyeccion;
    const mp = range(CUR + 1, CUR + N);
    const k = q.mora > 0 ? (1 - q.cobShare) / q.moraShare : K_GLOBAL;
    const esc3 = [
      { id: 'base', n: 'Base (la morosidad se mantiene)', col: COL.blue },
      { id: 'optimista', n: 'Optimista (la morosidad baja)', col: COL.green },
      { id: 'pesimista', n: 'Pesimista (la morosidad sube)', col: COL.red }
    ];
    const proy = esc3.map(e => {
      const mult = D.SUPUESTOS.escenariosMora[e.id];
      const serie = mp.map((m, i) => {
        const mora = Math.min(1, q.moraShare * (1 + (mult - 1) * (i + 1) / N));
        return emi(m) * (1 - Math.min(1, mora * k));
      });
      return { e, serie, total: sum(serie, v => v), moraFin: Math.min(1, q.moraShare * mult) };
    });
    mk('c-proy', {
      data: {
        labels: mp.map(lab),
        datasets: proy.map(p => line(p.e.n, p.serie.map(M), p.e.col, { borderWidth: 3 })).concat([
          line('Cuotas emitidas', mp.map(m => M(emi(m))), '#6B7C8F', { borderDash: [5, 4], borderWidth: 1.8 })
        ])
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => '$ ' + nf(v, 1) + ' M') } } },
        scales: { y: { ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $ corrientes', font: { size: 10.5 } } } }
      })
    });
    const base = proy[0].total;
    const emiTot = sum(mp, emi);
    let tp = '<tr><th>Escenario</th><th>Mora a 12 meses</th><th>Cobranza acumulada</th><th>vs. base</th><th>% de lo emitido</th></tr>';
    proy.forEach(p => {
      tp += '<tr><td>' + p.e.n.split(' (')[0] + '</td><td>' + pct(p.moraFin) + '</td><td>' + mM(p.total) + '</td><td class="' + (p.total - base < 0 ? 'pos' : p.total - base > 0 ? 'neg' : '') + '">' + (p.e.id === 'base' ? '—' : mMs(p.total - base)) + '</td><td>' + pct(p.total / emiTot) + '</td></tr>';
    });
    el('tbl-proy').innerHTML = tp;
    el('nota-proy').textContent = 'Proyección de ' + lab(CUR + 1) + ' a ' + lab(CUR + N) + ', en pesos corrientes, con el índice de actualización creciendo ' + nf(D.SUPUESTOS.iacMensual, 1) +
      '% por mes. Morosidad actual: ' + pct(q.moraShare) + ' de los beneficiarios; en el escenario optimista llega a ' + pct(proy[1].moraFin) + ' y en el pesimista a ' + pct(proy[2].moraFin) + '.';
  }

  /* ===========================================================================
     6) ÍNDICE DE ACTUALIZACIÓN VS COSTO REAL
     =========================================================================== */
  function renderIndices() {
    const from = fromM();
    const M = v => v / 1e6;
    const vc = D.cci[CUR] - 1, vi = D.iac[CUR] - 1, br = vc - vi;
    const efMes = m => sum(ALL, s => D.cuotas.cobradas[s][m]) * (D.cci[m] / D.iac[m] - 1);
    const efAcum = sum(range(1, CUR), efMes);
    const fin = finModel(DEFAULTS());
    const stBr = br <= 0.02 ? 'ok' : br <= 0.06 ? 'warn' : 'bad';

    el('kpis-idx').innerHTML =
      kpi('neutral', 'Costo real de la construcción', signo(vc * 100, 1) + '%', 'Variación acumulada ' + lab(1) + ' → ' + lab(CUR)) +
      kpi('neutral', 'Índice de actualización de cuotas', signo(vi * 100, 1) + '%', 'Variación acumulada ' + lab(1) + ' → ' + lab(CUR)) +
      kpi(stBr, 'Brecha', nf(br * 100, 1) + ' p.p.', 'El índice va por debajo del costo real') +
      kpi(stBr, 'Efecto en el flujo de fondos', mM(efAcum), 'Cobranza no percibida por la brecha, a la fecha · hasta fin de obra: <b>' + mM(efAcum + fin.efecto) + '</b>');

    const meses = range(from, VIEW_END);
    const cv = m => (D.cci[m] - 1) * 100, iv = m => (D.iac[m] - 1) * 100;
    mk('c-indices', {
      data: {
        labels: meses.map(lab),
        datasets: [
          line('Costo real de la construcción', meses.map(m => m <= CUR ? cv(m) : null), COL.navy, { borderWidth: 3.5 }),
          line('Índice de actualización de cuotas', meses.map(m => m <= CUR ? iv(m) : null), COL.blue, { borderWidth: 3.5 }),
          line('Costo real (proyección)', meses.map(m => m >= CUR ? cv(m) : null), COL.navy, { borderDash: [6, 5], borderWidth: 2 }),
          line('Índice (proyección)', meses.map(m => m >= CUR ? iv(m) : null), COL.blue, { borderDash: [6, 5], borderWidth: 2 })
        ]
      },
      options: baseOpts({
        plugins: { hoy: { index: CUR - from }, tooltip: { callbacks: { label: tipVal(v => nf(v, 1) + '%') } } },
        scales: { y: { ticks: { callback: tickNum(0, '%') }, title: { display: true, text: 'Variación acumulada desde sep-25', font: { size: 10.5 } } } }
      })
    });

    const mc = range(from, CUR);
    mk('c-brecha', {
      data: {
        labels: mc.map(lab),
        datasets: [
          bar('Brecha (p.p.)', mc.map(m => (D.cci[m] - D.iac[m]) * 100), COL.red, { order: 2, maxBarThickness: 26 }),
          line('Efecto mensual en el flujo ($ M)', mc.map(m => M(efMes(m))), COL.navy, { yAxisID: 'y2', order: 1, pointRadius: 3 })
        ]
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label.split(' (')[0] + ': ' + (c.dataset.yAxisID === 'y2' ? '$ ' + nf(c.parsed.y, 1) + ' M' : nf(c.parsed.y, 1) + ' p.p.') } } },
        scales: {
          y: { min: 0, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Puntos porcentuales', font: { size: 10.5 } } },
          y2: { position: 'right', min: 0, grid: { drawOnChartArea: false }, ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $', font: { size: 10.5 } } }
        }
      })
    });

    el('interpreta-txt').innerHTML =
      '<p>Desde ' + lab(1) + ' el costo real de la construcción acumula <b>' + signo(vc * 100, 1) + '%</b>, mientras que el índice con el que se actualizan las cuotas acumula <b>' + signo(vi * 100, 1) + '%</b>.</p>' +
      '<p class="destacado">Si el índice va por debajo del costo real, la cooperativa financia la diferencia: hoy ' + nf(br * 100, 1) + ' p.p.</p>' +
      '<p>Efecto estimado: de haberse actualizado las cuotas al ritmo del costo real, se habrían cobrado unos <b>' + mM(efAcum) + '</b> más hasta hoy y <b>' + mM(efAcum + fin.efecto) + '</b> en total hasta el fin de obra.</p>' +
      '<p>Una brecha chica pero sostenida se acumula mes a mes. Revisar la fórmula de actualización (rezago, índice mixto de materiales y mano de obra) o prever un fondo de reserva ayuda a cerrarla.</p>';
  }

  /* ===========================================================================
     7) SUFICIENCIA FINANCIERA + SIMULADOR
     =========================================================================== */
  let sim = DEFAULTS();
  function renderFinanciera() {
    const def = DEFAULTS();
    const base = finModel(def);
    const r = finModel(sim);
    const M = v => v / 1e6;
    const esBase = Math.abs(sim.inf - def.inf) < 1e-9 && Math.abs(sim.iac - def.iac) < 1e-9 && Math.abs(sim.mora - def.mora) < 1e-9;
    const st = stLow(r.cobertura, UMB.cobertura);
    const dif = r.saldoFinal;

    el('suf-resultado').className = 'card resultado ' + st;
    el('suf-resultado').innerHTML =
      '<div class="veredicto">' + (dif >= 0 ? 'Sí alcanza: excedente estimado de ' + mM(dif) : 'Con estos supuestos no alcanza: faltante estimado de ' + mM(-dif)) +
      '<small>¿Alcanza la cobranza proyectada para terminar la obra? · ' + (esBase ? 'Escenario base' : 'Escenario simulado') + ' · fin de obra ' + lab(END_MONTH) + '</small></div>' +
      '<div class="dato"><small>Caja a ' + lab(CUR) + '</small><b>' + mM(r.saldoIni) + '</b></div>' +
      '<div class="dato"><small>Ingresos proyectados</small><b>' + mM(r.sumIng) + '</b></div>' +
      '<div class="dato"><small>Inversión remanente</small><b>' + mM(r.sumEgr) + '</b></div>' +
      '<div class="dato"><small>Cobertura</small><b>' + pct(r.cobertura) + '</b> ' + chip(st) + '</div>' +
      '<div class="dato"><small>' + (r.minSaldo < 0 ? 'Pico de necesidad (' + lab(r.minMes) + ')' : 'Saldo mínimo') + '</small><b>' + mM(r.minSaldo) + '</b></div>';

    const ms = r.rows.map(x => x.m);
    mk('c-flujo', {
      data: {
        labels: ms.map(lab),
        datasets: [
          bar('Ingresos (cuotas + aportes)', r.rows.map(x => M(x.ingreso)), COL.blue, { order: 3, maxBarThickness: 28 }),
          bar('Egresos (inversión de obra)', r.rows.map(x => M(x.egreso)), COL.grey, { order: 2, maxBarThickness: 28 }),
          line('Saldo acumulado', r.rows.map(x => M(x.saldo)), COL.navy, { order: 1, pointRadius: 3, borderWidth: 3 })
        ]
      },
      options: baseOpts({
        plugins: { tooltip: { callbacks: { label: tipVal(v => '$ ' + nf(v, 1) + ' M') } } },
        scales: { y: { ticks: { callback: tickNum(0) }, title: { display: true, text: 'Millones de $ corrientes', font: { size: 10.5 } } } }
      })
    });

    // Salidas del simulador
    el('o-inf').textContent = nf(sim.inf, 1) + '% mensual';
    el('o-mora').textContent = nf(sim.mora * 100, 1) + '%';
    el('o-iac').textContent = nf(sim.iac, 1) + '% mensual';
    el('sim-out').innerHTML =
      '<div class="res-big ' + st + '"><small>Saldo final de caja</small><span class="v">' + mMs(r.saldoFinal) + '</span><small>Cobertura ' + pct(r.cobertura) + ' · ' + ESTADO[st] + '</small></div>' +
      '<div class="cmp">Escenario base: saldo final <b>' + mMs(base.saldoFinal) + '</b>, cobertura <b>' + pct(base.cobertura) + '</b>.<br>' +
      'Diferencia con el base: <b>' + mMs(r.saldoFinal - base.saldoFinal) + '</b>.</div>' +
      '<div class="cmp">Movés los controles y se recalcula el flujo de fondos y el resultado. La morosidad se mide como % de beneficiarios con atraso; en el escenario base es ' + pct(def.mora) + '.</div>';
  }

  function initSimulador() {
    const sInf = el('s-inf'), sMora = el('s-mora'), sIac = el('s-iac');
    const sync = () => { sInf.value = sim.inf; sMora.value = sim.mora * 100; sIac.value = sim.iac; };
    sync();
    const upd = () => {
      sim = { inf: parseFloat(sInf.value), mora: parseFloat(sMora.value) / 100, iac: parseFloat(sIac.value) };
      renderFinanciera();
    };
    [sInf, sMora, sIac].forEach(i => i.addEventListener('input', upd));
    el('sim-reset').addEventListener('click', () => { sim = DEFAULTS(); sync(); renderFinanciera(); });
  }

  /* ===========================================================================
     NAVEGACIÓN, FILTROS E IMPRESIÓN
     =========================================================================== */
  const TABS = [
    { id: 'resumen',    label: 'Resumen',                fn: renderResumen,    etapa: true,  periodo: false },
    { id: 'avance',     label: 'Avance de obra',         fn: renderAvance,     etapa: true,  periodo: true },
    { id: 'stock',      label: 'Stock de materiales',    fn: renderStock,      etapa: false, periodo: true },
    { id: 'costos',     label: 'Presupuesto vs. costos', fn: renderCostos,     etapa: true,  periodo: true },
    { id: 'cuotas',     label: 'Cuotas',                 fn: renderCuotas,     etapa: true,  periodo: true },
    { id: 'indices',    label: 'Índice vs. costos',      fn: renderIndices,    etapa: false, periodo: true },
    { id: 'financiera', label: 'Suficiencia financiera', fn: renderFinanciera, etapa: false, periodo: false }
  ];
  const dirty = {};
  TABS.forEach(t => { dirty[t.id] = true; });

  function renderTab(id) {
    const t = TABS.find(x => x.id === id);
    if (!t) return;
    t.fn();
    dirty[id] = false;
  }

  function showTab(id, noScroll) {
    if (!TABS.some(t => t.id === id)) id = 'resumen';
    state.tab = id;
    TABS.forEach(t => {
      el('p-' + t.id).classList.toggle('active', t.id === id);
    });
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    if (dirty[id]) renderTab(id);
    // Nota de alcance de los filtros
    const t = TABS.find(x => x.id === id);
    const notas = [];
    if (!t.etapa) notas.push('El filtro de etapa no aplica a esta sección (total del plan).');
    if (!t.periodo) notas.push('El filtro de período no aplica a esta sección.');
    const n = el('f-note');
    n.hidden = !notas.length;
    n.textContent = notas.join(' ');
    if (!noScroll) {
      const top = document.querySelector('main').offsetTop - el('tabs').parentNode.offsetHeight;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    }
    if (history.replaceState) history.replaceState(null, '', '#' + id);
  }

  function markAllDirty() { TABS.forEach(t => { dirty[t.id] = true; }); }

  function initNav() {
    el('tabs').innerHTML = TABS.map((t, i) => '<button type="button" data-tab="' + t.id + '"><span class="n">' + (i + 1) + '</span>' + t.label + '</button>').join('');
    el('tabs').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) showTab(b.dataset.tab);
    });
    el('f-etapa').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      state.etapa = b.dataset.v;
      el('f-etapa').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      markAllDirty();
      showTab(state.tab, true);
    });
    el('f-periodo').addEventListener('change', e => {
      state.periodo = e.target.value;
      markAllDirty();
      showTab(state.tab, true);
    });
  }

  // Impresión: se muestran todas las secciones y se redibujan todos los gráficos.
  let impresionActiva = false;
  function prepararImpresion() {
    if (impresionActiva) return;
    impresionActiva = true;
    document.body.classList.add('print-all');
    Chart.defaults.animation = false;
    TABS.forEach(t => renderTab(t.id));
  }
  function terminarImpresion() {
    if (!impresionActiva) return;
    impresionActiva = false;
    document.body.classList.remove('print-all');
    Chart.defaults.animation = { duration: 250 };
    markAllDirty();
    showTab(state.tab, true);
  }

  function init() {
    el('hdr-coop').textContent = D.CONFIG.cooperativa;
    initNav();
    initSimulador();
    const h = (location.hash || '').replace('#', '');
    showTab(h || 'resumen', true);
    el('btn-pdf').addEventListener('click', () => {
      prepararImpresion();
      setTimeout(() => {
        window.print();
        setTimeout(terminarImpresion, 500);
      }, 400);
    });
    window.addEventListener('hashchange', () => {
      const id = (location.hash || '').replace('#', '');
      if (id && id !== state.tab) showTab(id);
    });
    window.addEventListener('beforeprint', prepararImpresion);
    window.addEventListener('afterprint', terminarImpresion);
    if (window.matchMedia) {
      const mq = window.matchMedia('print');
      const onChange = e => { if (e.matches) Object.keys(charts).forEach(k => charts[k].resize()); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  init();
})();
