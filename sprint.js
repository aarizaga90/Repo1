// ═══════════════════════════════════════════════
//  OposTest — Modo Sprint (cuenta atrás al examen)
//
//  Garantiza ver y fijar TODAS las preguntas antes de la fecha del examen:
//   · Cobertura: cuota diaria de preguntas nuevas (se recalcula cada día).
//   · Aprendizaje en sesión: una fallada vuelve a las 4 preguntas hasta
//     acertarla (máx. 3 intentos al día; si se resiste, vuelve en la siguiente
//     sesión). Después se repasa al día siguiente.
//   · Repasos comprimidos al plazo: +3 días si salió a la primera;
//     +1 y +3 días si costó. Nunca se programan después de la víspera.
//   · Consolidación: los 2 últimos días —o antes, en cuanto se hayan visto
//     todas— solo frágiles (falladas alguna vez,
//     no dominadas o marcadas como duda), las más falladas primero.
//   · Nunca se programa nada para el día del examen.
//
//  Datos independientes del modo inteligente: tablas `sprint` y `sprintCfg`.
// ═══════════════════════════════════════════════

const SPRINT_EXAMEN_DEFECTO   = '2026-11-27';
const SPRINT_DIAS_CONSOLIDA   = 2;
const SPRINT_VUELVE_FALLO     = 4;   // una fallada reaparece tras N preguntas
const SPRINT_MAX_FALLOS_DIA   = 3;
const SPRINT_PRESUPUESTO_DIA  = 240; // respuestas/día que el plan intenta no superar
const SPRINT_COSTE_NUEVA      = 1.6; // cada nueva cuesta ~1,6 respuestas (incluye reintentos)   // si se resiste, se aparca hasta la próxima sesión
const SPRINT_OFFSETS_FACIL    = [3];
const SPRINT_OFFSETS_DIFICIL  = [1, 3];

// ─── Fechas (claves locales YYYY-MM-DD) ───────
function sprintDia(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function sprintFecha(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function sprintSumarDias(key, n) {
    const f = sprintFecha(key);
    f.setDate(f.getDate() + n);
    return sprintDia(f);
}
function sprintDiferencia(desde, hasta) {
    return Math.round((sprintFecha(hasta) - sprintFecha(desde)) / 86400000);
}
function sprintFechaLarga(key) {
    return sprintFecha(key).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ─── Configuración y orden de estudio ─────────
async function sprintCargarCfg() {
    let cfg = await db.sprintCfg.get('cfg');
    const totalBanco = await db.preguntas.count();

    if (!cfg) {
        cfg = { key: 'cfg', examen: SPRINT_EXAMEN_DEFECTO, inicio: sprintDia(), orden: [], hoy: null };
    }
    if (!Array.isArray(cfg.orden) || cfg.totalBanco !== totalBanco || cfg.orden.length === 0) {
        const preguntas = (await db.preguntas.toArray())
            .filter(q => q.correcta !== null && q.correcta !== undefined);
        cfg.orden = sprintConstruirOrden(preguntas);
        cfg.totalBanco = totalBanco;
        await db.sprintCfg.put(cfg);
    }
    return cfg;
}

// Intercala común, específico teórico y casos prácticos (caso completo como
// bloque) de forma proporcional, para que cada día haya de todo y los casos
// no se queden para el final.
function sprintConstruirOrden(preguntas) {
    const porNumero = (a, b) => a.numero_temario - b.numero_temario;
    const comun  = preguntas.filter(q => q.temario === 'común').sort(porNumero);
    const espec  = preguntas.filter(q => q.temario === 'específico').sort(porNumero);
    const teoria = espec.filter(q => !q.caso);
    const casosMap = new Map();
    espec.filter(q => q.caso).forEach(q => {
        if (!casosMap.has(q.caso.id)) casosMap.set(q.caso.id, []);
        casosMap.get(q.caso.id).push(q.id);
    });

    const flujos = [
        comun.map(q => [q.id]),
        teoria.map(q => [q.id]),
        [...casosMap.keys()].sort((a, b) => a - b).map(k => casosMap.get(k))
    ];

    const unidades = [];
    flujos.forEach((flujo, f) => {
        const total = flujo.reduce((s, u) => s + u.length, 0);
        let acumulado = 0;
        flujo.forEach(u => {
            unidades.push({ ids: u, pos: (acumulado + u.length / 2) / total, f });
            acumulado += u.length;
        });
    });
    unidades.sort((a, b) => a.pos - b.pos || a.f - b.f);
    return unidades.flatMap(u => u.ids);
}

function sprintFase(cfg, hoy) {
    const faltan = sprintDiferencia(hoy, cfg.examen);
    if (faltan <= 0) return { fase: 'examen', faltan };
    if (cfg.inicioConsolida && hoy >= cfg.inicioConsolida) return { fase: 'consolidacion', faltan };
    if (faltan <= SPRINT_DIAS_CONSOLIDA) return { fase: 'consolidacion', faltan };
    return { fase: 'cobertura', faltan };
}

// Día en que empezó (o empieza) la consolidación: antes de tiempo si ya se
// vieron todas, o los últimos días antes del examen.
function sprintInicioFase(cfg) {
    const porFecha = sprintSumarDias(cfg.examen, -SPRINT_DIAS_CONSOLIDA);
    return cfg.inicioConsolida && cfg.inicioConsolida < porFecha ? cfg.inicioConsolida : porFecha;
}

// Frágil = aún no dominada, fallada 2+ veces o marcada como duda.
function sprintEsFragil(st, q) {
    return st.estado !== 'dominada' || (st.fallos || 0) >= 2 || q?.dudosa === 1;
}

// Frágiles que aún no se han repasado en la fase de consolidación.
function sprintFragilesPendientes(cfg, estados, preguntas) {
    const inicioFase = sprintInicioFase(cfg);
    return [...estados.values()]
        .filter(st => st.estado !== 'aprendiendo' &&
            sprintEsFragil(st, preguntas.get(st.id)) &&
            (!st.consolidada || st.consolidada < inicioFase))
        .sort((a, b) => (b.fallos || 0) - (a.fallos || 0));
}

// Lo que se puede repasar en fase 2: primero frágiles pendientes; después,
// para «Repasar 20 más», las que hace más tiempo que no se ven (no las de hoy).
function sprintPoolConsolida(cfg, estados, preguntas, hoy) {
    const fragiles = sprintFragilesPendientes(cfg, estados, preguntas);
    const ya = new Set(fragiles.map(st => st.id));
    const resto = [...estados.values()]
        .filter(st => !ya.has(st.id) && st.estado !== 'aprendiendo' && st.ultimoDia !== hoy)
        .sort((a, b) => (a.ultimoDia || '').localeCompare(b.ultimoDia || ''));
    return fragiles.concat(resto);
}

// Calcula (una vez al día) la cuota de nuevas y de consolidación.
async function sprintPrepararDia() {
    const cfg  = await sprintCargarCfg();
    const hoy  = sprintDia();
    const todasVistas = (await db.sprint.count()) >= cfg.orden.length;
    if (cfg.hoy?.dia === hoy && cfg.hoy.totalOrden === cfg.orden.length &&
        !(cfg.hoy.fase === 'cobertura' && todasVistas)) return cfg;
    const previo = cfg.hoy?.dia === hoy ? cfg.hoy : null; // recálculo a mitad de día

    const estados = new Map((await db.sprint.toArray()).map(s => [s.id, s]));
    const sinVer  = cfg.orden.filter(id => !estados.has(id)).length;

    // Si ya no queda nada por ver, la fase 2 empieza ya (aunque sea a mitad de día)
    if (sinVer === 0 && !cfg.inicioConsolida && sprintFase(cfg, hoy).fase === 'cobertura') {
        cfg.inicioConsolida = hoy;
    }
    const { fase, faltan } = sprintFase(cfg, hoy);

    let cuotaNuevas = 0;
    if (fase === 'cobertura') {
        // Mínimo: lo justo para terminar a tiempo. Si hoy hay hueco en el
        // presupuesto, se adelantan nuevas para que los repasos no se
        // amontonen al final.
        const diasCobertura = Math.max(1, faltan - SPRINT_DIAS_CONSOLIDA);
        const minimo   = Math.ceil(sinVer / diasCobertura);
        const repasos  = [...estados.values()].filter(st =>
            st.estado === 'aprendiendo' || (st.estado === 'repaso' && st.due && st.due <= hoy)).length;
        const hueco    = Math.floor((SPRINT_PRESUPUESTO_DIA - repasos) / SPRINT_COSTE_NUEVA);
        cuotaNuevas = Math.min(sinVer, Math.max(minimo, hueco));
    } else if (fase === 'consolidacion') {
        cuotaNuevas = sinVer; // si quedara alguna sin ver, entra sí o sí
    }

    let cuotaConsolida = 0;
    // Si la fase 2 empieza a mitad de día, hoy no se impone cuota: el día ya
    // estaba lleno. Queda disponible «Repasar 20 más» y la cuota empieza mañana.
    const empiezaAhora = previo?.fase === 'cobertura' && fase === 'consolidacion';
    if (fase === 'consolidacion' && !empiezaAhora) {
        const preguntas  = new Map((await db.preguntas.toArray()).map(q => [q.id, q]));
        const pendientes = sprintFragilesPendientes(cfg, estados, preguntas).length;
        cuotaConsolida = Math.ceil(pendientes / Math.max(1, faltan));
    }

    cfg.hoy = {
        dia: hoy, fase, totalOrden: cfg.orden.length,
        cuotaNuevas:        cuotaNuevas + (previo?.nuevasHechas || 0),
        nuevasHechas:       previo?.nuevasHechas || 0,
        cuotaConsolida:     cuotaConsolida + (previo?.consolidadasHechas || 0),
        consolidadasHechas: previo?.consolidadasHechas || 0,
        respondidas:        previo?.respondidas || 0
    };
    await db.sprintCfg.put(cfg);
    return cfg;
}

// ─── Resumen para el panel ─────────────────────
async function sprintResumen() {
    const cfg     = await sprintPrepararDia();
    const hoy     = sprintDia();
    const estados = await db.sprint.toArray();
    const preguntas = new Map((await db.preguntas.toArray()).map(q => [q.id, q]));
    const { fase, faltan } = sprintFase(cfg, hoy);

    const vistas     = estados.length;
    const dominadas  = estados.filter(s => s.estado === 'dominada').length;
    const fragiles   = estados.filter(s =>
        (s.dificil && s.estado !== 'dominada') || (s.fallos || 0) >= 2 || preguntas.get(s.id)?.dudosa === 1).length;
    const aprendiendo = estados.filter(s => s.estado === 'aprendiendo').length;
    const repasosHoy = estados.filter(s => s.estado === 'repaso' && s.due && s.due <= hoy).length;
    const atrasados  = estados.filter(s => s.estado === 'repaso' && s.due && s.due < hoy).length;
    const sinVerAhora = Math.max(0, cfg.orden.length - estados.length);
    const nuevasHoy  = Math.min(sinVerAhora, Math.max(0, cfg.hoy.cuotaNuevas - cfg.hoy.nuevasHechas));
    const consolidaHoy = fase === 'consolidacion'
        ? Math.min(Math.max(0, cfg.hoy.cuotaConsolida - cfg.hoy.consolidadasHechas),
                   sprintPoolConsolida(cfg, new Map(estados.map(s => [s.id, s])), preguntas, hoy).length)
        : 0;
    const pendientesHoy = repasosHoy + aprendiendo + nuevasHoy + consolidaHoy;

    return {
        cfg, fase, faltan, total: cfg.orden.length, vistas, dominadas, fragiles,
        repasosHoy: repasosHoy + aprendiendo, atrasados, nuevasHoy, consolidaHoy,
        pendientesHoy, respondidasHoy: cfg.hoy.respondidas || 0
    };
}

async function sprintActualizarBoton() {
    const sub = document.getElementById('sprint-sub');
    if (!sub || typeof db === 'undefined' || !db.sprint) return;

    // Si el panel del sprint está abierto, se refresca también
    const panel = document.getElementById('sprint-panel')?.closest('.settings-panel');
    if (panel) renderSprintPanel(panel).catch(e => console.error('Sprint: panel', e));

    try {
        const r = await sprintResumen();
        if (r.fase === 'examen') { sub.textContent = r.faltan === 0 ? '¡Hoy es el examen!' : 'Examen pasado'; return; }
        const dias = `Faltan ${r.faltan} día${r.faltan !== 1 ? 's' : ''}`;
        sub.textContent = r.pendientesHoy > 0
            ? `${dias} · ${r.pendientesHoy} para hoy`
            : `${dias} · hoy completado ✓`;
    } catch (e) {
        console.error('Sprint: resumen', e);
    }
}

async function renderSprintPanel(panel) {
    const cont = panel.querySelector('#sprint-panel');
    if (!cont) return;
    const r = await sprintResumen();

    const faseTxt = {
        cobertura:     'Fase 1 · Ver y fijar todas',
        consolidacion: 'Fase 2 · Solo frágiles + simulacro',
        examen:        'Día del examen'
    }[r.fase];

    const pctVistas = r.total ? Math.round(r.vistas / r.total * 100) : 0;
    const pctDom    = r.total ? Math.round(r.dominadas / r.total * 100) : 0;

    let estadoTxt, estadoCls;
    if (r.fase === 'examen') {
        estadoTxt = '¡Mucha suerte! Hoy toca repasar solo lo que quieras.'; estadoCls = 'ok';
    } else if (r.atrasados > 0) {
        estadoTxt = `${r.atrasados} repaso${r.atrasados !== 1 ? 's' : ''} atrasado${r.atrasados !== 1 ? 's' : ''} de días anteriores`; estadoCls = 'warn';
    } else if (r.pendientesHoy === 0) {
        estadoTxt = 'Hoy completado. Vas al día ✓'; estadoCls = 'ok';
    } else {
        estadoTxt = 'Vas al día. Completa la cuota de hoy.'; estadoCls = 'ok';
    }

    const consejo = r.fase === 'consolidacion'
        ? '<p class="sprint-tip">💡 Buen momento para un simulacro en modo ⏱️ Examen.</p>'
        : '';

    cont.innerHTML = `
        <div class="sprint-head">
            <div>
                <div class="sprint-dias">${r.fase === 'examen' ? '🎓' : r.faltan}<span>${r.fase === 'examen' ? '' : (r.faltan === 1 ? ' día' : ' días')}</span></div>
                <div class="sprint-fase">${faseTxt}</div>
            </div>
            <label class="sprint-fecha">
                <span>Examen</span>
                <input type="date" id="sprint-examen" value="${r.cfg.examen}">
            </label>
        </div>

        <div class="sprint-hoy">
            <div class="sprint-hoy-item"><b>${r.repasosHoy}</b><span>repasos</span></div>
            <div class="sprint-hoy-item"><b>${r.nuevasHoy}</b><span>nuevas</span></div>
            ${r.fase === 'consolidacion' ? `<div class="sprint-hoy-item"><b>${r.consolidaHoy}</b><span>frágiles</span></div>` : ''}
            <div class="sprint-hoy-item total"><b>${r.pendientesHoy}</b><span>para hoy</span></div>
        </div>

        <div class="sprint-barra" aria-label="Progreso del sprint">
            <div class="sprint-barra-vistas" style="width:${pctVistas}%"></div>
            <div class="sprint-barra-dom" style="width:${pctDom}%"></div>
        </div>
        <div class="sprint-leyenda">
            <span><i class="dot vistas"></i>Vistas ${r.vistas}/${r.total}</span>
            <span><i class="dot dom"></i>Dominadas ${r.dominadas}</span>
            <span><i class="dot fragil"></i>Frágiles ${r.fragiles}</span>
        </div>

        <p class="sprint-estado ${estadoCls}">${estadoTxt}</p>
        ${consejo}
        <button type="button" class="btn-link sprint-reset" id="sprint-reset">Reiniciar sprint</button>`;

    cont.querySelector('#sprint-examen')?.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (!val) return;
        const cfg = await sprintCargarCfg();
        cfg.examen = val;
        cfg.hoy = null;
        await db.sprintCfg.put(cfg);
        await renderSprintPanel(panel);
        sprintActualizarBoton();
    });

    cont.querySelector('#sprint-reset')?.addEventListener('click', () => {
        showModal('¿Reiniciar el sprint? Se borra el progreso del Modo Sprint (el resto de estadísticas se conserva).', {
            confirmText: 'Reiniciar',
            cancelText:  'Cancelar',
            onConfirm:   async () => {
                const cfg = await sprintCargarCfg();
                await db.sprint.clear();
                await db.sprintCfg.put({ key: 'cfg', examen: cfg.examen, inicio: sprintDia(), orden: cfg.orden, hoy: null });
                await renderSprintPanel(panel);
                sprintActualizarBoton();
            }
        });
    });
}

// ─── Sesión ────────────────────────────────────
async function startSprintSession(adelantar = false) {
    const cfg = await sprintPrepararDia();
    const { fase } = sprintFase(cfg, sprintDia());

    if (adelantar && fase !== 'examen') {
        if (fase === 'consolidacion') cfg.hoy.cuotaConsolida += 20;
        else cfg.hoy.cuotaNuevas += 20;
        await db.sprintCfg.put(cfg);
    }

    // Las que quedaron a medio aprender en sesiones anteriores vuelven primero.
    const pendientes = (await db.sprint.where('estado').equals('aprendiendo').toArray()).map(s => s.id);

    session = {
        mode: 'sprint', queue: [], index: 0,
        correct: 0, wrong: 0, wrongAnswers: [],
        currentQuestion: null, nextBuffer: null, lastId: null,
        sprint: {
            n: 0,
            cola: pendientes.map((id, i) => ({ id, at: i * 2, racha: 0 })),
            ultimoCaso: null,
            origen: null,
            goal: 0,
            mapa: new Map((await db.preguntas.toArray()).map(q => [q.id, q]))
        }
    };

    const restante = await sprintRestanteHoy();
    session.sprint.goal = restante;

    const first = await sprintSiguiente();
    if (!first) {
        const r = await sprintResumen();
        if (fase === 'examen') { showToast('Hoy es el examen. ¡Mucha suerte! 🎓'); return; }
        if (r.fase === 'consolidacion') {
            showModal('✅ Cuota de hoy completada.\n\n¿Repasar 20 más? Primero frágiles; si no quedan, las que hace más tiempo que no ves.', {
                confirmText: 'Repasar 20',
                cancelText:  'Hoy no',
                onConfirm:   () => startSprintSession(true)
            });
        } else if (r.vistas < r.total) {
            showModal('✅ Cuota de hoy completada.\n\n¿Quieres adelantar 20 preguntas nuevas de mañana?', {
                confirmText: 'Adelantar 20',
                cancelText:  'Hoy no',
                onConfirm:   () => startSprintSession(true)
            });
        } else {
            showToast('✅ Hoy está todo hecho. ¡Descansa!');
        }
        return;
    }

    session.currentQuestion = first.q;
    session.sprint.origen   = first.origen;
    session.lastId          = first.q.id;
    startTimer();
    showScreen('study');
    renderCurrentQuestion();
}

async function sprintRestanteHoy() {
    const r = await sprintResumen();
    const enCola = session?.sprint?.cola?.length || 0;
    // `repasosHoy` ya incluye las «aprendiendo» que están en la cola inicial.
    return Math.max(r.pendientesHoy, enCola);
}

// Devuelve { q, origen } o null si no queda nada para hoy.
async function sprintSiguiente() {
    const s   = session.sprint;
    const cfg = await sprintPrepararDia();
    const hoy = sprintDia();
    const preguntas = s.mapa;
    const estados   = new Map((await db.sprint.toArray()).map(st => [st.id, st]));
    const enCola    = new Set(s.cola.map(c => c.id));
    const actual    = session.currentQuestion?.id;

    const tomarCola = (soloVencidas, permitirActual = false) => {
        const candidatos = s.cola
            .filter(c => (permitirActual || c.id !== actual) && (!soloVencidas || c.at <= s.n))
            .sort((a, b) => a.at - b.at);
        if (!candidatos.length) return null;
        const c = candidatos[0];
        s.cola = s.cola.filter(x => x !== c);
        s.actualCola = c;
        return { q: preguntas.get(c.id), origen: 'otra' };
    };

    // 0. Terminar el caso práctico en curso antes de cambiar de tema
    if (s.ultimoCaso) {
        const sigCaso = cfg.orden.find(id =>
            !estados.has(id) && preguntas.get(id)?.caso?.id === s.ultimoCaso);
        if (sigCaso) return { q: preguntas.get(sigCaso), origen: 'nueva' };
        s.ultimoCaso = null;
    }

    // 1. Falladas que ya toca volver a ver
    const vencida = tomarCola(true);
    if (vencida?.q) return vencida;

    // 2. Repasos programados para hoy (los más atrasados primero)
    const repaso = [...estados.values()]
        .filter(st => st.estado === 'repaso' && st.due && st.due <= hoy && !enCola.has(st.id) && st.id !== actual)
        .sort((a, b) => a.due.localeCompare(b.due))[0];
    if (repaso) return { q: preguntas.get(repaso.id), origen: 'repaso' };

    // 3. Consolidación (fase 2): frágiles aún no repasadas en esta fase
    if (cfg.hoy.fase === 'consolidacion' && cfg.hoy.consolidadasHechas < cfg.hoy.cuotaConsolida) {
        const fragil = sprintPoolConsolida(cfg, estados, preguntas, hoy)
            .find(st => !enCola.has(st.id) && st.id !== actual);
        if (fragil) return { q: preguntas.get(fragil.id), origen: 'consolida' };
    }

    // 4. Nuevas según la cuota del día (en el orden intercalado)
    if (cfg.hoy.nuevasHechas < cfg.hoy.cuotaNuevas) {
        const id = cfg.orden.find(x => !estados.has(x) && x !== actual);
        if (id) return { q: preguntas.get(id), origen: 'nueva' };
    }

    // 5. Falladas pendientes aunque aún no les toque: no se sale con fallos sin fijar
    const resto = tomarCola(false) || tomarCola(false, true);
    if (resto?.q) return resto;

    return null;
}

// Devuelve la fecha del próximo repaso, o null si ya no hay días antes del examen.
function sprintLimiteDue(cfg, hoy, dias) {
    const ultimo = sprintSumarDias(cfg.examen, -1);
    const due = sprintSumarDias(hoy, dias);
    if (due <= ultimo) return due;
    return hoy < ultimo ? ultimo : null;
}

async function sprintRegistrar(q, ok) {
    const s   = session.sprint;
    const cfg = await sprintPrepararDia();
    const hoy = sprintDia();
    const origen = s.origen;

    const previo = await db.sprint.get(q.id);
    const eraFragil = !!previo && previo.estado !== 'aprendiendo' && sprintEsFragil(previo, q);
    const st = previo ? { ...previo, diasAcierto: [...(previo.diasAcierto || [])] } : {
        id: q.id, estado: 'aprendiendo', paso: 0, dificil: false,
        aciertos: 0, fallos: 0, diasAcierto: [], primerDia: hoy, due: null, consolidada: null
    };

    st.ultimo = ok ? 'ok' : 'ko';
    st.ultimoDia = hoy;
    if (ok) {
        st.aciertos++;
        if (!st.diasAcierto.includes(hoy)) st.diasAcierto.push(hoy);
    } else {
        st.fallos++;
    }

    if (!s.fallosHoy) s.fallosHoy = {};
    const aCola = () => {
        s.fallosHoy[q.id] = (s.fallosHoy[q.id] || 0) + 1;
        if (s.fallosHoy[q.id] >= SPRINT_MAX_FALLOS_DIA) return; // se aparca: queda «aprendiendo»
        s.cola.push({ id: q.id, at: s.n + SPRINT_VUELVE_FALLO });
        s.goal++;
    };

    const programarRepaso = () => {
        const offsets = st.dificil ? SPRINT_OFFSETS_DIFICIL : SPRINT_OFFSETS_FACIL;
        const due = st.paso < offsets.length ? sprintLimiteDue(cfg, hoy, offsets[st.paso]) : null;
        if (due) {
            st.estado = 'repaso';
            st.due = due;
        } else {
            st.estado = 'dominada';
            st.due = null;
        }
    };

    if (origen === 'nueva') {
        cfg.hoy.nuevasHechas++;
        if (q.caso) s.ultimoCaso = q.caso.id;
        if (ok) {
            st.paso = 0;
            programarRepaso();
        } else {
            st.dificil = true;
            st.estado = 'aprendiendo';
            aCola();
        }
    } else if (origen === 'otra') {
        if (ok) {
            st.paso = 0;
            programarRepaso();
        } else {
            st.estado = 'aprendiendo';
            aCola();
        }
    } else if (origen === 'repaso' || origen === 'consolida') {
        if (ok) {
            if (st.estado === 'repaso' && st.due && st.due <= hoy) {
                st.paso++;
                programarRepaso();
            }
        } else {
            st.dificil = true;
            st.paso = 0;
            st.estado = 'aprendiendo';
            aCola();
        }
    }

    // En la fase 2, cualquier respuesta a una frágil pendiente cuenta como consolidada
    if (cfg.hoy.fase === 'consolidacion') {
        const pendiente = !st.consolidada || st.consolidada < sprintInicioFase(cfg);
        // Toda respuesta de consolidación cuenta (también las de «Repasar 20 más»),
        // y una frágil pendiente que salga como repaso también cuenta.
        if (origen === 'consolida' || (pendiente && eraFragil)) {
            if (pendiente) st.consolidada = hoy;
            cfg.hoy.consolidadasHechas = Math.min(cfg.hoy.cuotaConsolida, cfg.hoy.consolidadasHechas + 1);
        }
    }

    s.actualCola = null;
    s.n++;
    cfg.hoy.respondidas = (cfg.hoy.respondidas || 0) + 1;

    await db.sprint.put(st);
    await db.sprintCfg.put(cfg);
}

function sprintEtiqueta(origen) {
    return {
        nueva:     '🆕 Nueva',
        repaso:    '🔁 Repaso',
        otra:      '↩️ Otra vez',
        consolida: '🎯 Frágil'
    }[origen] || '';
}

async function sprintResultado() {
    const r = await sprintResumen();
    if (r.pendientesHoy === 0) {
        return {
            emoji: '✅',
            title: '¡Cuota de hoy completada!',
            sub:   `Vistas ${r.vistas}/${r.total} · Dominadas ${r.dominadas}`
        };
    }
    return {
        emoji: '💾',
        title: 'Progreso guardado',
        sub:   `Te quedan ${r.pendientesHoy} para hoy · Vistas ${r.vistas}/${r.total}`
    };
}
