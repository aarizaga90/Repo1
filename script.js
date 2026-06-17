// ═══════════════════════════════════════════════
//  OposTest — Lógica principal
//  Datos persistentes: IndexedDB via Dexie (db.js)
//  DEBUG y log() definidos en db.js
// ═══════════════════════════════════════════════

// ─── Estado global ────────────────────────────
let SMART_SESSION_LENGTH = 20;
let selectedMode    = 'all';
let selectedTemario = 'todos';
let answered        = false;
let homeDirty       = true;  // true = home necesita refrescar al volver
let timerInterval   = null;
let examTimerInterval = null;
let secondsElapsed  = 0;
let toastTimer      = null;

let session = {
    mode:            'all',
    queue:           [],
    index:           0,
    correct:         0,
    wrong:           0,
    wrongAnswers:    [],
    currentQuestion: null,
    nextBuffer:      null,
    lastId:          null
};

window.smartLog = [];

// ═══════════════════════════════════════════════
//  EVENTOS DOM
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    // ── Botones de modo (delegación en #home-actions) ──
    const homeActions = document.getElementById('home-actions');
    if (!homeActions) return;

    homeActions.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;
        const { mode, target } = btn.dataset;
        if (mode && target) selectModeSecure(btn, mode, target);
    });

    const defaultBtn = document.querySelector('.mode-btn[data-mode="all"]');
    if (defaultBtn) selectModeSecure(defaultBtn, 'all', 'top');

    // ── Home ──────────────────────────────────────────
    document.getElementById('start-btn')
        ?.addEventListener('click', startStudy);
    document.getElementById('history-btn')
        ?.addEventListener('click', () => showScreen('history'));
    document.getElementById('admin-btn')
        ?.addEventListener('click', () => { showScreen('admin-list'); initAdminList(); });
    document.getElementById('clear-history-btn')
        ?.addEventListener('click', clearHistory);
    document.getElementById('open-import-btn')
        ?.addEventListener('click', openImport);

    // ── Import ────────────────────────────────────────
    document.getElementById('close-import-btn')
        ?.addEventListener('click', closeImport);
    document.getElementById('file-input')
        ?.addEventListener('change', handleFileImport);
    document.getElementById('import-overlay')
        ?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeImport();
        });

    // ── Study ─────────────────────────────────────────
    document.getElementById('next-btn')
        ?.addEventListener('click', nextQuestion);
    document.getElementById('finish-early-btn')
        ?.addEventListener('click', () => {
            showModal('¿Quieres terminar la sesión y ver los resultados ahora?', {
                confirmText: 'Ver resultados',
                cancelText:  'Seguir',
                onConfirm:   () => showResults()
            });
        });
    document.getElementById('dudosa-btn')
        ?.addEventListener('click', toggleDudosa);

    // ── Results ───────────────────────────────────────
    document.getElementById('finish-btn')
        ?.addEventListener('click', () => showScreen('home'));
    document.getElementById('retry-btn')
        ?.addEventListener('click', startStudy);
    document.getElementById('review-btn')
        ?.addEventListener('click', () => { renderReview(); showScreen('review'); });

    // ── Navegación global (back-to-home, back-to-results) ──
    document.addEventListener('click', (e) => {
        // Volver a resultados desde revisión
        if (e.target.closest('.back-to-results')) {
            showScreen('results');
            return;
        }

        if (!e.target.closest('.back-to-home')) return;

        const currentScreen = document.querySelector('.screen.active')?.id;
        if (currentScreen === 'study') {
            if (session.isExam) {
                showModal('¿Quieres abandonar el examen? Perderás todo el progreso.', {
                    confirmText: 'Abandonar',
                    cancelText:  'Seguir',
                    onConfirm:   () => { stopExamTimer(); showScreen('home'); }
                });
                return;
            }
            if (session.correct > 0 || session.wrong > 0) {
                showModal('¿Quieres terminar la sesión y ver los resultados?', {
                    confirmText: 'Ver resultados',
                    cancelText:  'Seguir',
                    onConfirm:   () => showResults()
                });
                return;
            }
        }
        showScreen('home');
    });
});

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
async function boot() {
    const pregCount = await db.preguntas.count();
    if (pregCount === 0 && typeof DEFAULT_QUESTIONS !== 'undefined' && DEFAULT_QUESTIONS.length > 0) {
        await db.preguntas.bulkPut(DEFAULT_QUESTIONS);
    }
    await refreshHome();
    await showAppVersion();
    initServiceWorker();
}

// ═══════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════
async function selectModeSecure(el, mode, target) {
    if (!mode) return;

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    selectedMode = mode;
    log('Modo seleccionado:', mode);

    const pTop    = document.getElementById('settings-top');
    const pBottom = document.getElementById('settings-bottom');
    const activePanel   = target === 'top' ? pTop : pBottom;
    const inactivePanel = target === 'top' ? pBottom : pTop;

    if (inactivePanel) {
        inactivePanel.classList.remove('active');
        inactivePanel.innerHTML = '';
    }

    const totalPregs = typeof db !== 'undefined' ? await db.preguntas.count() : 200;

    const temarioSelectorHTML = `
        <div class="control-group" style="flex:1 1 200px; min-width:200px;">
            <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px; text-transform:uppercase;">Bloque:</label>
            <select id="filter-temario" style="width:100%; padding:8px; border-radius:6px; background:#1e1e2e; color:var(--text); border:1px solid var(--accent-dim); font-size:14px;">
                <option value="todos">📚 Todos</option>
                <option value="común">📘 Común</option>
                <option value="específico">📙 Específico</option>
            </select>
        </div>`;

    const rangeHTML = `
        <div class="control-group" style="flex:0 1 auto; display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); height:38px;">
            <span style="font-size:12px; color:var(--muted);">Rango:</span>
            <input type="number" id="range-start" value="1" style="width:55px; border:none; background:transparent; color:var(--accent); font-weight:bold; text-align:center;">
            <span style="color:var(--muted);">-</span>
            <input type="number" id="range-end" value="${totalPregs}" style="width:55px; border:none; background:transparent; color:var(--accent); font-weight:bold; text-align:center;">
        </div>`;

    const configs = {
        all: {
            desc: 'Estudio secuencial por rango.',
            html: `<div style="display:flex; flex-wrap:wrap; gap:15px; align-items:flex-end;">${temarioSelectorHTML}${rangeHTML}</div>`
        },
        exam: {
            desc: 'Simulacro oficial · 100 preguntas proporcionales · bloque 450-500 al final.',
            html: `
                <div style="display:flex; gap:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; align-items:flex-end;">
                    <div style="flex:1;">
                        <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">MINUTOS</label>
                        <input type="number" id="exam-time" value="75" min="10" max="180"
                            style="width:100%; background:transparent; border:1px solid #444; color:var(--accent); text-align:center; border-radius:4px; padding:8px; font-size:16px;">
                    </div>
                </div>
                <p style="font-size:11px; color:#ff9f43; margin-top:8px;">⚠️ Sin corrección inmediata · Resultados al entregar.</p>`
        },
        smart: {
            desc: 'Prioridad a fallos y preguntas nuevas.',
            html: `
                <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:flex-end;">
                    ${temarioSelectorHTML}
                    <div class="control-group" style="flex:0 1 auto; display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); height:38px;">
                        <span style="font-size:12px; color:var(--muted);">Cantidad:</span>
                        <input type="number" id="smart-limit" value="20" min="1" max="${totalPregs}" style="width:50px; border:none; background:transparent; color:var(--accent); font-weight:bold; text-align:center;">
                        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
                            <input type="checkbox" id="smart-infinite"> ♾️
                        </label>
                    </div>
                </div>`
        },
        shuffle: {
            desc: 'Mezcla aleatoria con opción a elegir rango.',
            html: `<div style="display:flex; flex-wrap:wrap; gap:15px; align-items:flex-end;">${temarioSelectorHTML}${rangeHTML}</div>`
        },
        wrong:  { desc: 'Repasa tus errores.',   html: `<div style="display:flex; flex-wrap:wrap; gap:15px;">${temarioSelectorHTML}</div>` },
        unseen: { desc: 'Preguntas sin responder.', html: `<div style="display:flex; flex-wrap:wrap; gap:15px;">${temarioSelectorHTML}</div>` },
        dudosas: {
            desc: 'Repaso de tus preguntas marcadas con 🔖 durante el estudio.',
            html: `<p id="dudosas-panel-info" style="font-size:13px; color:var(--accent); margin:0;"></p>`
        }
    };

    const config = configs[mode];
    if (!activePanel || !config) return;

    activePanel.innerHTML = `
        <div class="panel-content" style="border-left:3px solid var(--accent); padding:5px 0 10px 15px;">
            <p style="margin:0 0 12px; font-size:12px; color:var(--muted); line-height:1.4;">${config.desc}</p>
            <div class="panel-controls" style="display:block; color:var(--accent); font-weight:bold;">
                ${config.html}
            </div>
        </div>`;

    requestAnimationFrame(() => activePanel.classList.add('active'));
    if (mode === 'dudosas') {
        db.preguntas.where('dudosa').equals(1).count().then(n => {
            const el = activePanel.querySelector('#dudosas-panel-info');
            if (el) el.textContent = n > 0 ? `${n} preguntas marcadas listas para repasar.` : 'Aún no has marcado ninguna pregunta como duda.';
        });
    }

    // Actualización dinámica al cambiar bloque
    activePanel.querySelector('#filter-temario')?.addEventListener('change', async (e) => {
        const val = e.target.value;
        const count = val === 'todos'
            ? await db.preguntas.count()
            : await db.preguntas.where('temario').equals(val).count();

        log('Filtro temario:', val, '→', count, 'preguntas');

        const rStart = document.getElementById('range-start');
        const rEnd   = document.getElementById('range-end');
        if (rStart && rEnd) { rStart.value = 1; rEnd.value = count; rEnd.max = count; }

        const sLimit = document.getElementById('smart-limit');
        if (sLimit) {
            sLimit.max = count;
            if (parseInt(sLimit.value) > count) sLimit.value = count;
        }
    });
}

async function refreshHome() {
    const [total, allStats] = await Promise.all([
        db.preguntas.count(),
        db.stats.toArray()
    ]);

    const done          = allStats.length;
    const totalCorrect  = allStats.reduce((s, h) => s + (h.correct || 0), 0);
    const totalAnswered = allStats.reduce((s, h) => s + (h.correct || 0) + (h.wrong || 0), 0);
    const pct           = totalAnswered > 0 ? Math.round(totalCorrect / totalAnswered * 100) : null;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pct').textContent   = pct !== null ? `${pct}%` : '—';
    document.getElementById('stat-done').textContent  = done;
    document.getElementById('prog-label').textContent = `${done} / ${total}`;
    document.getElementById('prog-fill').style.width  = total > 0 ? `${done / total * 100}%` : '0%';

    const rangeEnd = document.getElementById('range-end');
    if (rangeEnd) { rangeEnd.value = total; rangeEnd.max = total; }

    const emptyEl   = document.getElementById('empty-home');
    const actionsEl = document.getElementById('home-actions');
    emptyEl.style.display   = total === 0 ? 'block' : 'none';
    actionsEl.style.display = total === 0 ? 'none'  : 'block';
    
    loadDudasCount();
}

function getQuestionCode(q) {
    if (!q || !q.temario || q.numero_temario === undefined) return 'S/N';
    const letra = q.temario.toLowerCase().startsWith('e') ? 'E' : 'C';
    return `${q.numero_temario}-${letra}`;
}

// ── Dudosas ─────────────────────────────────────
async function toggleDudosa() {
    const q = session.currentQuestion;
    if (!q) return;
    const nuevoVal = q.dudosa ? 0 : 1;
    await db.preguntas.update(q.id, { dudosa: nuevoVal });
    q.dudosa = nuevoVal;
    updateDudosaBtn();
    loadDudasCount();
}

function updateDudosaBtn() {
    const btn = document.getElementById('dudosa-btn');
    if (!btn) return;
    const marcada = !!(session.currentQuestion?.dudosa);
    btn.classList.toggle('marcada', marcada);
    btn.setAttribute('aria-label', marcada ? 'Quitar marca de duda' : 'Marcar como duda');
}

async function loadDudasCount() {
    const count = await db.preguntas.where('dudosa').equals(1).count();
    const el = document.getElementById('dudosas-count');
    if (el) el.textContent = count > 0 ? `${count} preguntas` : 'Sin marcar';
}

// ═══════════════════════════════════════════════
//  STUDY — enrutador
// ═══════════════════════════════════════════════
async function startStudy() {
    const total = await db.preguntas.count();
    if (total === 0) { showToast('No hay preguntas cargadas'); return; }

    selectedTemario = document.getElementById('filter-temario')?.value ?? 'todos';

    session = {
        mode: selectedMode, queue: [], index: 0,
        correct: 0, wrong: 0, wrongAnswers: [],
        currentQuestion: null, nextBuffer: null, lastId: null
    };
    answered = false;

    if (selectedMode === 'smart') return startSmartSession();
    if (selectedMode === 'dudosas') return startDudosasSession();
    if (selectedMode === 'exam')  return startExamSession();
    return startStandardSession();
}

// ── Dudosas ──────────────────────────────────────

async function startDudosasSession() {
// ── Modo DUDOSAS: carga directa desde DB ────
        const pool = await db.preguntas.where('dudosa').equals(1).toArray();
        if (pool.length === 0) {
            showToast('No tienes preguntas marcadas como duda 👍');
            return;
        }
        pool.sort(() => Math.random() - 0.5);
        session = {
            mode: 'dudosas',
            queue: pool,
            index: 0,
            currentQuestion: pool[0],
            correct: 0,
            wrong: 0,
            wrongAnswers: [],
            lastId: pool[0].id,
            nextBuffer: null,
            isExam: false,
            timeLeft: 0,
            answers: {}
        };
        startTimer();
        showScreen('study');
        renderCurrentQuestion();
        return;
}

// ── Smart ──────────────────────────────────────
async function startSmartSession() {
    const query = selectedTemario !== 'todos'
        ? db.preguntas.where('temario').equals(selectedTemario)
        : db.preguntas.toCollection();

    const totalDisponible = await query.count();
    if (totalDisponible === 0) { showToast('No hay preguntas en la selección'); return; }

    const esInfinito = document.getElementById('smart-infinite')?.checked;
    if (esInfinito) {
        SMART_SESSION_LENGTH = Infinity;
    } else {
        let userLimit = parseInt(document.getElementById('smart-limit')?.value, 10);
        if (isNaN(userLimit) || userLimit < 1) userLimit = 1;
        SMART_SESSION_LENGTH = Math.min(userLimit, totalDisponible);
    }

    const first = await getSmartNextQuestion();
    if (!first) { showToast('No hay preguntas disponibles'); return; }

    session.currentQuestion = first;
    session.lastId = first.id;
    prepareNextQuestion();
    startTimer();
    showScreen('study');
    renderCurrentQuestion();
}

// ── Examen ─────────────────────────────────────
async function startExamSession() {
    const examMinutes  = parseInt(document.getElementById('exam-time')?.value) || 75;
    const TARGET_TEORICO = 80;
    const TARGET_PRACTICO    = 20;

    const [allComun, allEspec] = await Promise.all([
        db.preguntas.where('temario').equals('común').toArray(),
        db.preguntas.where('temario').equals('específico').toArray()
    ]);

    const tieneRespuesta = q => q.correcta !== null && q.correcta !== undefined;
    const comunValid = allComun.filter(tieneRespuesta);
    const especValid = allEspec.filter(tieneRespuesta);

    if (comunValid.length + especValid.length === 0) {
        showToast('No hay preguntas disponibles');
        return;
    }

    // Bloque 450-500 (preguntas prácticas)
    const tramo450 = especValid
        .filter(q => q.numero_temario >= 450 && q.numero_temario <= 500)
        .sort(() => Math.random() - 0.5);

   const selectedPractico = tramo450
        .slice(0, Math.min(TARGET_PRACTICO, tramo450.length))
        .sort((a, b) => a.numero_temario - b.numero_temario);

    const especTeorico = especValid.filter(q => q.numero_temario < 450);
    const totalTeorico = comunValid.length + especTeorico.length;

    if (totalTeorico + tramo450.length === 0) {
        showToast('No hay preguntas disponibles');
        return;
    }

    const numComun = totalTeorico > 0
        ? Math.round(TARGET_TEORICO * comunValid.length / totalTeorico)
        : 0;
    const numEspec = TARGET_TEORICO - numComun;

    const selectedComun = comunValid
        .sort(() => Math.random() - 0.5)
        .slice(0, numComun);

    const selectedEspec = especTeorico
        .sort(() => Math.random() - 0.5)
        .slice(0, numEspec);

    const poolBase  = [...selectedComun, ...selectedEspec].sort(() => Math.random() - 0.5);
    const examPool  = [...poolBase, ...selectedPractico];

    if (examPool.length === 0) { showToast('No hay preguntas disponibles'); return; }

    log(`Examen: ${selectedComun.length}C + ${selectedEspec.length}E + ${selectedPractico.length} prac = ${examPool.length}`);

    Object.assign(session, {
        mode: 'exam', queue: examPool, isExam: true,
        answers: {}, timeLeft: examMinutes * 60,
        originalTime: examMinutes * 60, currentQuestion: examPool[0]
    });

    startExamTimer();
    showScreen('study');
    renderCurrentQuestion();
}

// ── Modos estándar ─────────────────────────────
async function startStandardSession() {
    const [allQuestions, allStats] = await Promise.all([
        db.preguntas.orderBy('numero_temario').toArray(),
        db.stats.toArray()
    ]);
    const statsMap = new Map(allStats.map(s => [s.id, s]));

    let pool = allQuestions.filter(q => q.correcta !== null && q.correcta !== undefined);

    if (selectedTemario !== 'todos') {
        pool = pool.filter(q => q.temario === selectedTemario);
    }

    pool = applyModeFilter(pool, statsMap);

    if (pool.length === 0) {
        const msgs = {
            wrong:  `No tienes preguntas falladas en "${selectedTemario}" 🎉`,
            unseen: `Ya has visto todas las preguntas de "${selectedTemario}"`
        };
        showToast(msgs[selectedMode] || `No hay preguntas en "${selectedTemario}"`);
        return;
    }

    session.queue           = pool;
    session.currentQuestion = pool[0];
    startTimer();
    showScreen('study');
    renderCurrentQuestion();
}

function applyModeFilter(pool, statsMap) {
    const s = parseInt(document.getElementById('range-start')?.value, 10) || 1;
    const e = parseInt(document.getElementById('range-end')?.value, 10)   || arr.length;

    const getRange = (arr) => {
        if (selectedTemario !== 'todos') {
            // Filtrar por numero_temario — el rango referencia el número real de pregunta
            return arr.filter(q => q.numero_temario >= s && q.numero_temario <= e);
        }
        // Para 'todos': slice por posición (los numero_temario se solapan entre bloques)
        return arr.slice(Math.max(0, s - 1), Math.min(arr.length, e));
    };

    switch (selectedMode) {
        case 'all':     return getRange(pool);
        case 'shuffle': return getRange(pool).sort(() => Math.random() - 0.5);
        case 'wrong':   return pool.filter(q => (statsMap.get(q.id)?.wrong || 0) > 0);
        case 'unseen':  return pool.filter(q => !statsMap.has(q.id));
        default:        return pool;
    }
}

// ═══════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════
function renderCurrentQuestion() {
    const q         = session.currentQuestion;
    const container = document.getElementById('question-scroll');
    if (!container || !q) return;

    answered = false;
    updateDudosaBtn();

    const idx       = session.index;
    const isSmart   = session.mode === 'smart';
    const isExam    = session.mode === 'exam';
    const total     = isSmart ? SMART_SESSION_LENGTH : session.queue.length;
    const esInfinito = total === Infinity;
    const code      = getQuestionCode(q);

    // Contadores
    document.getElementById('q-text').textContent      = q.pregunta || q.texto || '';
    document.getElementById('prog-current').textContent = code;                             // "181-C" en el header izquierda
    document.getElementById('prog-of').textContent      = esInfinito ? String(idx + 1) : `${idx + 1} / ${total}`; // "15 / 698" derecha
    document.getElementById('study-fill').style.width   = esInfinito ? '0%' : `${idx / total * 100}%`;
    document.getElementById('dudosa-btn').style.display = isExam ? 'none' : 'flex'
    document.getElementById('question-scroll').scrollTop = 0;

    // Footers
    const answerFooter = document.getElementById('answer-footer');
    const examFooter   = document.getElementById('exam-footer');

    if (isExam) {
        answerFooter.style.display = 'none';
        document.getElementById('study').classList.remove('footer-visible');
        updateExamTimerDisplay();
    } else {
        examFooter.style.display   = 'none';
        answerFooter.style.display = 'none';
        document.getElementById('study').classList.remove('footer-visible');
    }

    // Opciones
    const list    = document.getElementById('options-list');
    const letters = ['A', 'B', 'C', 'D'];
    list.innerHTML = '';

    q.opciones.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        if (isExam && session.answers[q.id] === i) btn.classList.add('selected-exam');

        btn.innerHTML =
            `<span class="option-letter">${letters[i]}</span>` +
            `<span class="option-text"></span>`;
        btn.querySelector('.option-text').textContent = opt;
        btn.onclick = () => selectAnswer(i);
        list.appendChild(btn);
    });

    // Nav examen
    if (isExam) {
        document.getElementById('study').classList.add('footer-visible');
        updateExamNavigation(idx, total);
    }
}

// ── Examen: navegación ────────────────────────
function updateExamNavigation(idx, total) {
    if (session.mode !== 'exam') return;

    const footer      = document.getElementById('exam-footer');
    const respondidas = Object.keys(session.answers || {}).length;
    const sinResponder = total - respondidas;

    footer.style.display = 'block';
    footer.innerHTML = `
        <div class="exam-footer-inner">
            <div class="exam-footer-count ${sinResponder > 0 ? 'exam-nav-count--warn' : 'exam-nav-count--ok'}">
                ${sinResponder > 0 ? `${sinResponder} sin responder` : '✓ Todas respondidas'}
            </div>
            <div class="exam-footer-nav">
                <button id="exam-prev-btn" class="btn-nav" ${idx === 0 ? 'disabled' : ''}>← Atrás</button>
                <div class="exam-nav-center-col">
                    <button id="exam-finish-btn" class="btn-finish">Entregar</button>
                </div>
                <button id="exam-next-btn" class="btn-nav" ${idx === total - 1 ? 'disabled' : ''}>Siguiente →</button>
            </div>
        </div>`;

    document.getElementById('exam-prev-btn')?.addEventListener('click', examPrevQuestion);
    document.getElementById('exam-finish-btn')?.addEventListener('click', confirmFinishExam);
    document.getElementById('exam-next-btn')?.addEventListener('click', examNextQuestion);
}

function examNextQuestion() {
    if (session.index < session.queue.length - 1) {
        session.index++;
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    }
}

function examPrevQuestion() {
    if (session.index > 0) {
        session.index--;
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    }
}

function confirmFinishExam() {
    const respondidas  = Object.keys(session.answers || {}).length;
    const total        = session.queue.length;
    const sinResponder = total - respondidas;

    if (sinResponder > 0) {
        showModal(
            `⚠️ Tienes ${sinResponder} pregunta${sinResponder !== 1 ? 's' : ''} sin responder.\n\nLas respuestas en blanco no restan. ¿Seguro que quieres entregar?`,
            { confirmText: '📨 Entregar así', cancelText: '← Seguir', onConfirm: finishExam }
        );
    } else {
        showModal(
            `✅ Has respondido las ${total} preguntas.\n\n¿Entregar o repasar antes?`,
            { confirmText: '📨 Entregar', cancelText: '← Repasar', onConfirm: finishExam }
        );
    }
}

async function finishExam() {
    stopExamTimer();

    try{

    let aciertosT = 0, fallosT = 0, blancasT = 0;
    let aciertosP = 0, fallosP = 0, blancasP = 0;

    for (const q of session.queue) {
        const respuesta = session.answers[q.id];
        const esPractica = q.numero_temario >= 450;
        const esBlanca   = respuesta === undefined || respuesta === null;
        const esCorrecta = !esBlanca && respuesta === q.correcta;

        if (esPractica) {
            if (esBlanca)       blancasP++;
            else if (esCorrecta) aciertosP++;
            else                 fallosP++;
        } else {
            if (esBlanca)       blancasT++;
            else if (esCorrecta) aciertosT++;
            else                 fallosT++;
        }

        if (!esBlanca) {
            await recordAnswer(q.id, esCorrecta);
            if (!esCorrecta) session.wrongAnswers.push({ question: q, chosen: respuesta, correct: q.correcta });
        }
    }

    const totalT = aciertosT + fallosT + blancasT;
    const totalP = aciertosP + fallosP + blancasP;

    // Notas sobre 100 (aciertos / total * 100, sin penalización)
    const N1 = totalT > 0 ? (aciertosT / totalT) * 100 : 0;
    const N2 = totalP > 0 ? (aciertosP / totalP) * 100 : 0;
    const MP = (N1 * 65 + N2 * 35) / 100;


    showExamResults({
        MP: MP.toFixed(2),
        N1: N1.toFixed(2), aciertosT, fallosT, blancasT, totalT,
        N2: N2.toFixed(2), aciertosP, fallosP, blancasP, totalP,
    });

} catch (err) {
        console.error('finishExam error:', err);
        showToast('Error al calcular resultados: ' + err.message);
    }
}

function showExamResults({ MP, N1, aciertosT, fallosT, blancasT, totalT,
                                N2, aciertosP, fallosP, blancasP, totalP }) {
    const aprobado = parseFloat(MP) >= 50;
    const elapsed  = session.originalTime - Math.max(0, session.timeLeft || 0);
    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;

   document.getElementById('res-emoji').textContent      = aprobado ? '🎓' : '📖';
    document.getElementById('res-title').textContent      = aprobado ? '¡Aprobado!' : 'No aprobado';
    document.getElementById('res-sub').textContent        =
        `${aciertosT + aciertosP} correctas · ${fallosT + fallosP} incorrectas · ${blancasT + blancasP} en blanco`;
    document.getElementById('res-pct').textContent        = `${MP}`;
    document.getElementById('res-score-label').textContent = 'Media ponderada (sobre 100)';
    document.getElementById('res-n1').textContent         = N1;
    document.getElementById('res-n2').textContent         = N2;
    document.getElementById('res-exam-detail').style.display = '';

    document.getElementById('res-correct').textContent    = aciertosT + aciertosP;
    document.getElementById('res-wrong').textContent      = fallosT + fallosP;
    document.getElementById('res-time').textContent       = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('res-avg').textContent        =
        `${(totalT + totalP) > 0 ? (elapsed / (totalT + totalP)).toFixed(1) : 0}s`;

    showScreen('results');
}

// ═══════════════════════════════════════════════
//  RESPUESTA
// ═══════════════════════════════════════════════
async function selectAnswer(chosen) {
    if (answered) return;
    answered = true;

    const q = session.currentQuestion;
    if (!q) return;

    // Salvaguarda: pregunta sin respuesta (no debería llegar aquí)
    if (!session.isExam && (q.correcta === null || q.correcta === undefined)) {
        nextQuestion();
        return;
    }

    // Modo examen: guardar/anular respuesta sin feedback
    if (session.isExam) {
        if (session.answers[q.id] === chosen) {
            delete session.answers[q.id];
        } else {
            session.answers[q.id] = chosen;
        }
        document.querySelectorAll('#options-list .option').forEach((btn, i) => {
            btn.classList.toggle('selected-exam', session.answers[q.id] === i);
        });
        updateExamNavigation(session.index, session.queue.length);
        answered = false;
        return;
    }

    // Modo estudio: feedback inmediato
    const correct = q.correcta;
    const opts    = document.querySelectorAll('.option');
    opts.forEach(o => { o.classList.add('disabled'); o.onclick = null; });

    const isCorrect = chosen === correct;
    if (isCorrect) {
        opts[chosen].classList.add('selected-correct');
        session.correct++;
    } else {
        opts[chosen].classList.add('selected-wrong');
        if (opts[correct]) opts[correct].classList.add('show-correct');
        session.wrong++;
        session.wrongAnswers.push({ question: q, chosen, correct });
    }

    try {
        await recordAnswer(q.id, isCorrect);
    } catch (e) {
        console.error('Error guardando respuesta:', e);
    }

    document.getElementById('exam-footer').style.display   = 'none';
    document.getElementById('answer-footer').style.display = 'block';
    document.getElementById('study').classList.add('footer-visible');

    const isLast = session.mode === 'smart'
        ? session.index + 1 >= SMART_SESSION_LENGTH
        : session.index >= session.queue.length - 1;
    document.getElementById('next-btn').textContent = isLast ? 'Ver resultados ✓' : 'Siguiente →';
}

async function nextQuestion() {
    if (session.mode === 'smart') {
        session.index++;
        if (session.index >= SMART_SESSION_LENGTH) { showResults(); return; }

        let q = session.nextBuffer;
        if (!q) {
            log('Smart: buffer vacío, calculando al vuelo...');
            q = await getSmartNextQuestion();
        }

        session.nextBuffer      = null;
        session.currentQuestion = q;
        session.lastId          = q?.id ?? null;
        prepareNextQuestion();
        renderCurrentQuestion();
    } else {
        session.index++;
        if (session.index >= session.queue.length) { showResults(); return; }
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    }
}

// ═══════════════════════════════════════════════
//  SMART — selección de próxima pregunta
// ═══════════════════════════════════════════════
async function getSmartNextQuestion() {
    const query = selectedTemario !== 'todos'
        ? db.preguntas.where('temario').equals(selectedTemario)
        : db.preguntas.toCollection();

    const validQuestions = (await query.toArray())
        .filter(q => q.correcta !== null && q.correcta !== undefined);

    if (validQuestions.length === 0) return null;

    const allStats = await db.stats.toArray();
    const statsMap = new Map(allStats.map(s => [s.id, s]));

    // Historial reciente: evitar repetir las últimas N preguntas
    const RECIENTES_MAX = Math.max(4, Math.floor(validQuestions.length * 0.1));
    if (!session.recentIds) session.recentIds = [];

    let candidatas = validQuestions.filter(q => !session.recentIds.includes(q.id));
    if (candidatas.length === 0) {
        session.recentIds = [];
        candidatas = validQuestions;
    }

    // Calcular peso de cada candidata
    const weighted = candidatas.map(q => {
        const s = statsMap.get(q.id);
        let peso;

        if (!s) {
            // Nunca vista: peso base
            peso = 5;
        } else {
            // Usar el peso acumulado de recordAnswer (refleja historial completo)
            peso = s.peso || 1;

            // Bonus por tiempo sin ver (s.last es timestamp)
            const racha = s.racha || 0;
            if (racha >= 5) peso *= 0.2;
            else if (racha >= 3) peso *= 0.5;

            if (s.last) {
                const diasDesde = (Date.now() - s.last) / (1000 * 60 * 60 * 24);
                const BonusAntiguedad = 1 + Math.min(diasDesde/10,1);
                peso *= BonusAntiguedad; // máximo +3 por antigüedad
            }
        }

        return { q, peso };
    });

    // Lotería ponderada
    const totalPeso = weighted.reduce((acc, w) => acc + w.peso, 0);
    let r = Math.random() * totalPeso;
    let selected = weighted[weighted.length - 1].q;

    for (const { q, peso } of weighted) {
        r -= peso;
        if (r <= 0) { selected = q; break; }
    }

    // Actualizar historial reciente
    session.recentIds.push(selected.id);
    if (session.recentIds.length > RECIENTES_MAX) session.recentIds.shift();

    const logEntry = {
    t: new Date().toISOString(),
    id: selected.id,
    numero: selected.numero_temario,
    texto: selected.pregunta?.slice(0, 60),
    peso: weighted.find(w => w.q.id === selected.id)?.peso.toFixed(2),
    correct: statsMap.get(selected.id)?.correct ?? 0,
    wrong:   statsMap.get(selected.id)?.wrong   ?? 0,
    racha:   statsMap.get(selected.id)?.racha   ?? 0,
    lastDias: statsMap.get(selected.id)?.last
        ? Math.round((Date.now() - statsMap.get(selected.id).last) / 86400000)
        : null,
    candidatas: candidatas.length,
    recentIds: session.recentIds.length
};
window.smartLog.push(logEntry);

    return selected;
}

async function prepareNextQuestion() {
    try {
        session.nextBuffer = await getSmartNextQuestion();
    } catch {
        session.nextBuffer = null;
    }
}

window.downloadSmartLog = function() {
    if (!window.smartLog?.length) { console.log('Log vacío'); return; }

    const header = 'tiempo\tid\tnumero\tpeso\tcorrect\twrong\tracha\tlastDias\tcandidatas\ttexto\n';
    const rows = window.smartLog.map(e =>
        `${e.t}\t${e.id}\t${e.numero}\t${e.peso}\t${e.correct}\t${e.wrong}\t${e.racha}\t${e.lastDias ?? 'nunca'}\t${e.candidatas}\t${e.texto}`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smart_log_${Date.now()}.tsv`;
    a.click();
};

// ═══════════════════════════════════════════════
//  ESTADÍSTICAS
// ═══════════════════════════════════════════════
async function recordAnswer(qId, isCorrect) {
    const existing = await db.stats.get(qId);
    const stat     = existing || { id: qId, correct: 0, wrong: 0, racha: 0, peso: 1, last: 0 };

    stat.last = Date.now();
    if (isCorrect) {
        stat.correct = (stat.correct || 0) + 1;
        stat.racha   = (stat.racha   || 0) + 1;
        stat.peso    = Math.max(0.1, (stat.peso || 1) * 0.5);
    } else {
        stat.wrong = (stat.wrong || 0) + 1;
        stat.racha = 0;
        stat.peso  = Math.min(20, (stat.peso || 1) * 2.5);
    }

    await db.stats.put(stat);
    homeDirty = true;
}

// ═══════════════════════════════════════════════
//  CRONÓMETROS
// ═══════════════════════════════════════════════
function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    updateTimerDisplay();
    timerInterval = setInterval(() => { secondsElapsed++; updateTimerDisplay(); }, 1000);
}
function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function updateTimerDisplay() {
    const el = document.getElementById('timer');
    if (!el) return;

    const h = Math.floor(secondsElapsed / 3600);
    const m = Math.floor((secondsElapsed % 3600) / 60);
    const s = secondsElapsed % 60;

    el.textContent = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')};
}

function startExamTimer() {
    stopExamTimer();
    updateExamTimerDisplay();
    examTimerInterval = setInterval(() => {
        session.timeLeft--;
        updateExamTimerDisplay();
        if (session.timeLeft <= 0) {
            stopExamTimer();
            showToast('⏱ Tiempo agotado — corrigiendo...');
            setTimeout(finishExam, 1500);
        }
    }, 1000);
}
function stopExamTimer() {
    if (examTimerInterval) { clearInterval(examTimerInterval); examTimerInterval = null; }
}
function updateExamTimerDisplay() {
    const el = document.getElementById('timer');
    if (!el) return;
    const t    = Math.max(0, session.timeLeft || 0);
    const mins = Math.floor(t / 60);
    const secs = t % 60;
    el.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    el.style.color = t <= 60 ? 'var(--wrong)' : 'var(--accent)';
}

// ═══════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════
function showResults() {
    stopTimer();
    const total = session.correct + session.wrong;
    const pct   = total > 0 ? Math.round(session.correct / total * 100) : 0;
    const mins  = Math.floor(secondsElapsed / 60);
    const secs  = secondsElapsed % 60;
    const media = total > 0 ? (secondsElapsed / total).toFixed(1) : 0;

    let emoji = '😐', title = 'Sesión completada';
    if      (pct >= 90) { emoji = '🏆'; title = '¡Sobresaliente!'; }
    else if (pct >= 70) { emoji = '🎯'; title = '¡Muy bien!'; }
    else if (pct >= 50) { emoji = '📚'; title = 'Sigue practicando'; }
    else                { emoji = '💪'; title = 'Hay que repasar'; }

    document.getElementById('res-exam-detail').style.display = 'none';
document.getElementById('res-score-label').textContent   = 'Tasa de acierto';

    document.getElementById('res-emoji').textContent   = emoji;
    document.getElementById('res-title').textContent   = title;
    document.getElementById('res-sub').textContent     = `Has respondido ${total} preguntas`;
    document.getElementById('res-pct').textContent     = `${pct}%`;
    document.getElementById('res-correct').textContent = session.correct;
    document.getElementById('res-wrong').textContent   = session.wrong;
    document.getElementById('res-time').textContent    = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('res-avg').textContent     = `${media}s`;

    const reviewBtn = document.getElementById('review-btn');
    if (reviewBtn) reviewBtn.style.display = session.wrongAnswers?.length > 0 ? 'block' : 'none';

    if(session.mode === 'smart')
    {
        downloadSmartLog()
    }

    showScreen('results');
}

// ═══════════════════════════════════════════════
//  REVISIÓN DE FALLOS
// ═══════════════════════════════════════════════
function renderReview() {
    const list    = document.getElementById('review-list');
    const countEl = document.getElementById('review-count');
    const letters = ['A', 'B', 'C', 'D'];
    const fallos  = session.wrongAnswers || [];

    if (countEl) countEl.textContent = fallos.length > 0 ? `${fallos.length} fallos` : '';

    if (fallos.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="margin-top:40px;">
                <div class="empty-icon">🎉</div>
                <div class="empty-title">Sin errores</div>
                <div class="empty-sub">No fallaste ninguna pregunta en esta sesión</div>
            </div>`;
        return;
    }

    list.innerHTML = fallos.map(({ question: q, chosen, correct }, i) => `
    <div class="review-card">
        <div class="review-card-meta">
            <span class="review-code">${escapeHtml(getQuestionCode(q))}</span>
            <span class="review-num">Fallo ${i + 1} de ${fallos.length}</span>
        </div>
        <p class="review-question">${escapeHtml(q.pregunta)}</p>
            <div class="review-choice review-wrong">
                <span class="option-letter">${letters[chosen]}</span>
                <span class="review-choice-text">${escapeHtml(q.opciones[chosen])}</span>
            </div>
            <div class="review-choice review-correct">
                <span class="option-letter">${letters[correct]}</span>
                <span class="review-choice-text">${escapeHtml(q.opciones[correct])}</span>
            </div>
        </div>`
    ).join('');
}

// ═══════════════════════════════════════════════
//  HISTORIAL
// ═══════════════════════════════════════════════
async function renderHistory() {
    const list = document.getElementById('hist-list');
    const [allQuestions, allStats] = await Promise.all([
        db.preguntas.orderBy('id').toArray(),
        db.stats.toArray()
    ]);
    const statsMap   = new Map(allStats.map(s => [s.id, s]));
    const answeredQs = allQuestions.filter(q => statsMap.has(q.id));

    if (answeredQs.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <div class="empty-title">Sin historial</div>
                <div class="empty-sub">Las preguntas respondidas aparecerán aquí</div>
            </div>`;
        return;
    }

    list.innerHTML = answeredQs.map(q => {
        const s    = statsMap.get(q.id);
        const code = getQuestionCode(q);
        return `
            <div class="hist-item">
                <span class="hist-num">${code}</span>
                <span class="hist-q">${escapeHtml(q.pregunta)}</span>
                <div class="hist-badges">
                    <span class="badge c">✓ ${s.correct || 0}</span>
                    <span class="badge w">✗ ${s.wrong || 0}</span>
                </div>
            </div>`;
    }).join('');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

async function clearHistory() {
    showModal('¿Borrar todo el historial? (Las preguntas se conservan)', {
        confirmText: 'Borrar',
        cancelText:  'Cancelar',
        onConfirm:   async () => {
            await db.stats.clear();
            homeDirty = true;
            await renderHistory();
            await refreshHome();
        }
    });
}

// ═══════════════════════════════════════════════
//  IMPORTAR PREGUNTAS
// ═══════════════════════════════════════════════
function openImport() {
    document.getElementById('import-overlay').classList.add('open');
    const st = document.getElementById('import-status');
    st.className = 'import-status';
    st.textContent = '';
}

function closeImport() {
    document.getElementById('import-overlay').classList.remove('open');
}

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data) || data.length === 0) throw new Error('El archivo está vacío');

        const sample = data[0];
        if (!sample.pregunta || !Array.isArray(sample.opciones) ||
            !sample.temario  || sample.numero_temario === undefined) {
            throw new Error('Formato incorrecto (faltan campos requeridos)');
        }

        const cleanData = data.map(q => ({
            temario:        q.temario,
            numero_temario: q.numero_temario,
            pregunta:       q.pregunta,
            opciones:       q.opciones,
            correcta:       q.correcta !== undefined ? q.correcta : null
        }));

        await db.preguntas.clear();
        await db.stats.clear();
        await db.preguntas.bulkAdd(cleanData);

        homeDirty = true;
        await refreshHome();
        showStatus(`✓ ${cleanData.length} preguntas importadas`, true);
        setTimeout(closeImport, 1800);

    } catch (err) {
        showStatus(`✗ Error: ${err.message}`, false);
    } finally {
        e.target.value = '';
    }
}

async function showAppVersion() {
    const el = document.getElementById('app-version');
    if (!el) return;

    try {
        const keys  = await caches.keys();
        const cache = keys.find(k => k.startsWith('opos-'));
        el.textContent = cache ?? 'sin caché';
    } catch {
        el.textContent = '?';
    }
}

function showStatus(msg, ok) {
    const el = document.getElementById('import-status');
    el.textContent = msg;
    el.className   = `import-status ${ok ? 'ok' : 'err'}`;
}

// ═══════════════════════════════════════════════
//  NAVEGACIÓN
// ═══════════════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');

    if (id === 'history') renderHistory();
    if (id === 'home' && homeDirty) { refreshHome(); homeDirty = false; }
    if (id !== 'study') { stopTimer(); stopExamTimer(); }

    // Limpiar FAB del admin al salir
    if (id !== 'admin-list') {
        const fab = document.getElementById('scroll-top-btn');
        if (fab?._scrollHandler) {
            window.removeEventListener('scroll', fab._scrollHandler);
            fab.style.display = 'none';
        }
    }
}

// ═══════════════════════════════════════════════
//  SERVICE WORKER
// ═══════════════════════════════════════════════
function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js', {
                updateViaCache: 'none'
            });

            await navigator.serviceWorker.ready;
            showAppVersion();

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                const enEstudio = document.querySelector('#study.active');
                showModal(
                    enEstudio
                        ? '🚀 Nueva versión disponible.\n\nSi actualizas ahora perderás la sesión en curso.'
                        : '🚀 Nueva versión disponible. ¿Actualizas ahora?',
                    {
                        confirmText: 'Actualizar',
                        cancelText:  'Luego',
                        onConfirm:   () => window.location.reload()
                    }
                );
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') reg.update();
            });

        } catch (err) {
            console.error('SW: error —', err);
            const el = document.getElementById('app-version');
            if (el) el.textContent = `SW err: ${err.message}`;
        }
    };

    // Si load ya ocurrió (carga rápida en PWA), registrar inmediatamente
    if (document.readyState === 'complete') {
        register();
    } else {
        window.addEventListener('load', register);
    }
}

// ═══════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════
function showModal(msg, { onConfirm, onCancel, confirmText = 'Aceptar', cancelText = 'Cancelar' } = {}) {
    const overlay    = document.getElementById('modal-overlay');
    const msgEl      = document.getElementById('modal-msg');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn  = document.getElementById('modal-cancel');

    msgEl.textContent      = msg;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent  = cancelText;
    overlay.style.display  = 'flex';

    // Clonar para limpiar listeners anteriores
    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel  = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newConfirm.addEventListener('click', () => { overlay.style.display = 'none'; onConfirm?.(); });
    newCancel.addEventListener('click',  () => { overlay.style.display = 'none'; onCancel?.(); });
}

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
function showToast(msg, duration = 2500) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
boot();