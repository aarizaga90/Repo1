// ═══════════════════════════════════════════════
//  OposTest — PWA
//  Fuente única de verdad: IndexedDB (Dexie, ver db.js)
// ═══════════════════════════════════════════════

// ─── CONFIG ───────────────────────────────────────
const SMART_SESSION_LENGTH = 20;

// ─── CONFIG ───────────────────────────────────────
// Esperar a que el DOM esté cargado para evitar errores de referencia
document.addEventListener('DOMContentLoaded', () => {

    // 1. Manejo de los botones de Modo de Estudio
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const mode = this.getAttribute('data-mode');
            selectMode(this, mode);
        });
    });

    // 2. Botón Empezar
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startStudy();
        });
    }

    // 3. Botón Historial
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            showScreen('history');
        });
    }

    // 4. Botones de "Atrás" (si les pusiste una clase común como .back-btn)
    const backButtons = document.querySelectorAll('.back-btn');
    backButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen('home');
        });
    });

    // 1. Botones de "Atrás" (todos los que vuelven a Home)
    document.querySelectorAll('.back-to-home').forEach(btn => {
        btn.addEventListener('click', () => showScreen('home'));
    });

    // 2. Pantalla de Estudio: Botón Siguiente
    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', nextQuestion);
    }

    // 3. Pantalla de Resultados: Volver al inicio y refrescar
    const finishBtn = document.getElementById('finish-btn');
    if (finishBtn) {
        finishBtn.addEventListener('click', () => {
            showScreen('home');
            if (typeof refreshHome === 'function') refreshHome();
        });
    }

    // 4. Pantalla de Resultados: Repetir sesión
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', startStudy);
    }

    // 1. Abrir el panel de importación
    const openImportBtn = document.getElementById('open-import-btn');
    if (openImportBtn) {
        openImportBtn.addEventListener('click', () => {
            if (typeof openImport === 'function') openImport();
        });
    }

    // 2. Cerrar el panel (botón Cancelar)
    const closeImportBtn = document.getElementById('close-import-btn');
    if (closeImportBtn) {
        closeImportBtn.addEventListener('click', () => {
            if (typeof closeImport === 'function') closeImport();
        });
    }

    // 3. Procesar el archivo seleccionado (el input invisible)
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            if (typeof handleFileImport === 'function') handleFileImport(event);
        });
    }

    // 4. Cerrar al hacer clic fuera del panel (en el fondo oscuro)
    const importOverlay = document.getElementById('import-overlay');
    if (importOverlay) {
        importOverlay.addEventListener('click', (event) => {
            // Solo cerramos si se hace clic en el fondo, no en el cuadro blanco
            if (event.target === importOverlay) {
                if (typeof closeImport === 'function') closeImport();
            }
        });
    }

    //boton gestion preguntas
    const adminBtn = document.getElementById('admin-btn');
if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        showScreen('admin-list'); // Cambia a la pantalla de lista
        if (typeof initAdminList === 'function') {
            initAdminList(); // Carga las 700 preguntas con scroll infinito
        }
    });
}

});

// ─── ESTADO EN MEMORIA ────────────────────────────
// Todo dato persistente vive en Dexie. Aquí solo vive la sesión actual.
let selectedMode = 'all'; // 'all' | 'shuffle' | 'smart' | 'wrong' | 'unseen'
let answered = false;

let session = {
    mode: 'all',
    queue: [],            // para modos no-smart: array de preguntas completas
    index: 0,
    correct: 0,
    wrong: 0,
    currentQuestion: null,
    nextBuffer: null,     // precarga para modo smart
    lastId: null
};

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
async function boot() {
    // Seed inicial: si no hay preguntas en la DB, volcamos DEFAULT_QUESTIONS
    const pregCount = await db.preguntas.count();
    if (pregCount === 0 && typeof DEFAULT_QUESTIONS !== 'undefined' && DEFAULT_QUESTIONS.length > 0) {
        await db.preguntas.bulkPut(DEFAULT_QUESTIONS);
    }

    await refreshHome();

    // Registro del SW SIEMPRE (no solo en la primera carga)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

// ═══════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════
function selectMode(el, mode) {
    document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-checked', 'false');
    });
    
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    
    selectedMode = mode;

    const rangeSelector = document.getElementById('range-selector');
    if (rangeSelector) {
        rangeSelector.style.display = mode === 'all' ? 'flex' : 'none';
    }
}

async function refreshHome() {
    const [total, allStats] = await Promise.all([
        db.preguntas.count(),
        db.stats.toArray()
    ]);

    const done = allStats.length;
    const totalCorrect = allStats.reduce((s, h) => s + (h.correct || 0), 0);
    const totalAnswered = allStats.reduce((s, h) => s + (h.correct || 0) + (h.wrong || 0), 0);
    const pct = totalAnswered > 0 ? Math.round(totalCorrect / totalAnswered * 100) : null;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pct').textContent = pct !== null ? pct + '%' : '—';
    document.getElementById('stat-done').textContent = done;
    document.getElementById('prog-label').textContent = `${done} / ${total}`;
    document.getElementById('prog-fill').style.width = total > 0 ? (done / total * 100) + '%' : '0%';

    const rangeEnd = document.getElementById('range-end');
    rangeEnd.value = total;
    rangeEnd.max = total;

    const emptyEl = document.getElementById('empty-home');
    const actionsEl = document.getElementById('home-actions');
    if (total === 0) {
        emptyEl.style.display = 'block';
        actionsEl.style.display = 'none';
    } else {
        emptyEl.style.display = 'none';
        actionsEl.style.display = 'block';
    }
}

// ═══════════════════════════════════════════════
//  STUDY — arranque de sesión
// ═══════════════════════════════════════════════
async function startStudy() {
    const total = await db.preguntas.count();
    if (total === 0) return;

    // Reset de sesión
    session = {
        mode: selectedMode,
        queue: [],
        index: 0,
        correct: 0,
        wrong: 0,
        currentQuestion: null,
        nextBuffer: null,
        lastId: null
    };

    if (selectedMode === 'smart') {
        const first = await getSmartNextQuestion();
        if (!first) {
            alert('No hay preguntas disponibles');
            return;
        }
        session.currentQuestion = first;
        session.lastId = first.id;
        prepareNextQuestion(); // fire-and-forget
        startTimer();
        showScreen('study');
        renderCurrentQuestion();
        return;
    }

    // Modos no-smart: construimos la cola completa
    const [allQuestions, allStats] = await Promise.all([
        db.preguntas.orderBy('id').toArray(),
        db.stats.toArray()
    ]);
    const statsMap = new Map(allStats.map(s => [s.id, s]));

    let pool = allQuestions;

    if (selectedMode === 'wrong') {
        pool = pool.filter(q => {
            const s = statsMap.get(q.id);
            return s && (s.wrong || 0) > 0;
        });
    } else if (selectedMode === 'unseen') {
        pool = pool.filter(q => !statsMap.has(q.id));
    }

    if (selectedMode === 'shuffle' || selectedMode === 'wrong' || selectedMode === 'unseen') {
        pool = pool.slice().sort(() => Math.random() - 0.5);
    } else if (selectedMode === 'all') {
        const startVal = parseInt(document.getElementById('range-start').value, 10);
        const endVal = parseInt(document.getElementById('range-end').value, 10);
        const start = Number.isFinite(startVal) && startVal > 0 ? startVal - 1 : 0;
        const end = Number.isFinite(endVal) && endVal > 0 ? endVal : pool.length;
        pool = pool.slice(start, end);
    }

    if (pool.length === 0) {
        const msg = selectedMode === 'wrong'  ? 'No tienes preguntas falladas 🎉'
            : selectedMode === 'unseen' ? 'Ya has visto todas las preguntas'
                :                             'No hay preguntas en esta selección';
        alert(msg);
        return;
    }

    session.queue = pool;
    session.currentQuestion = pool[0];
    startTimer();
    showScreen('study');
    renderCurrentQuestion();
}

// ═══════════════════════════════════════════════
//  STUDY — render
// ═══════════════════════════════════════════════
function renderCurrentQuestion() {
    const q = session.currentQuestion;
    if (!q) return;

    answered = false;
    const idx = session.index;
    const isSmart = session.mode === 'smart';
    const total = isSmart ? SMART_SESSION_LENGTH : session.queue.length;

    document.getElementById('q-num').textContent = `Pregunta ${idx + 1} de ${total}`;
    document.getElementById('q-text').textContent = q.pregunta;
    document.getElementById('prog-current').textContent = `Pregunta ${idx + 1}`;
    document.getElementById('prog-of').textContent = `de ${total}`;
    document.getElementById('study-fill').style.width = (idx / total * 100) + '%';
    document.getElementById('answer-footer').style.display = 'none';
    document.getElementById('question-scroll').scrollTop = 0;

    const list = document.getElementById('options-list');
    list.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    q.opciones.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.innerHTML =
            `<span class="option-letter">${letters[i]}</span>` +
            `<span class="option-text"></span>`;
        btn.querySelector('.option-text').textContent = opt; // evita XSS en opciones
        btn.onclick = () => selectAnswer(i);
        list.appendChild(btn);
    });
}

async function selectAnswer(chosen) {
    if (answered) return;
    answered = true;

    const q = session.currentQuestion;
    const correct = q.correcta;
    const opts = document.querySelectorAll('.option');
    opts.forEach(o => { o.classList.add('disabled'); o.onclick = null; });

    const isCorrect = chosen === correct;
    if (isCorrect) {
        opts[chosen].classList.add('selected-correct');
        session.correct++;
    } else {
        opts[chosen].classList.add('selected-wrong');
        if (opts[correct]) opts[correct].classList.add('show-correct');
        session.wrong++;
    }

    showFeedback(isCorrect);

    // Persistir la respuesta (estadística)
    await recordAnswer(q.id, isCorrect);

    // Mostrar footer con botón Siguiente / Ver resultados
    document.getElementById('answer-footer').style.display = 'block';
    const isLast = session.mode === 'smart'
        ? session.index + 1 >= SMART_SESSION_LENGTH
        : session.index >= session.queue.length - 1;
    document.getElementById('next-btn').textContent = isLast ? 'Ver resultados ✓' : 'Siguiente →';
}

async function nextQuestion() {
    if (session.mode === 'smart') {
        session.index++;
        if (session.index >= SMART_SESSION_LENGTH) {
            showResults();
            return;
        }
        // Usamos el buffer precargado; si no está listo, cargamos en el momento
        let q = session.nextBuffer;
        session.nextBuffer = null;
        if (!q) q = await getSmartNextQuestion();
        if (!q) { showResults(); return; }
        session.currentQuestion = q;
        session.lastId = q.id;
        prepareNextQuestion(); // precarga la siguiente
        renderCurrentQuestion();
    } else {
        session.index++;
        if (session.index >= session.queue.length) {
            showResults();
            return;
        }
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    }
}

function showFeedback(correct) {
    const el = document.getElementById('feedback-text');
    el.className = 'feedback-text ' + (correct ? 'correct' : 'wrong');
    el.textContent = correct ? '✓ ¡Correcto!' : '✗ Incorrecto';
}

// ═══════════════════════════════════════════════
//  SMART — selector de próxima pregunta
//  60% prioridad a nuevas, 40% repaso ordenado por peso
// ═══════════════════════════════════════════════
async function getSmartNextQuestion() {
    const [allIds, allStats] = await Promise.all([
        db.preguntas.toCollection().primaryKeys(),
        db.stats.toArray()
    ]);
    if (allIds.length === 0) return null;

    const statsMap = new Map(allStats.map(s => [s.id, s]));
    const nuevas = allIds.filter(id => !statsMap.has(id) && id !== session.lastId);

    let targetId;
    const azar = Math.random();

    if (nuevas.length > 0 && azar < 0.6) {
        targetId = nuevas[Math.floor(Math.random() * nuevas.length)];
    } else {
        const repaso = allStats
            .filter(s => s.id !== session.lastId)
            .sort((a, b) => (b.peso || 1) - (a.peso || 1));

        if (repaso.length > 0) {
            targetId = repaso[0].id;
        } else {
            const candidatas = allIds.filter(id => id !== session.lastId);
            targetId = candidatas.length > 0
                ? candidatas[Math.floor(Math.random() * candidatas.length)]
                : allIds[0];
        }
    }

    return await db.preguntas.get(targetId);
}

// Precarga en segundo plano — llena session.nextBuffer sin bloquear
async function prepareNextQuestion() {
    try {
        session.nextBuffer = await getSmartNextQuestion();
    } catch (e) {
        session.nextBuffer = null;
    }
}

// ═══════════════════════════════════════════════
//  RESPUESTA — único punto de persistencia de stats
// ═══════════════════════════════════════════════
async function recordAnswer(qId, isCorrect) {
    const existing = await db.stats.get(qId);
    const stat = existing || { id: qId, correct: 0, wrong: 0, racha: 0, peso: 1, last: 0 };

    stat.last = Date.now();
    if (isCorrect) {
        stat.correct = (stat.correct || 0) + 1;
        stat.racha = (stat.racha || 0) + 1;
        // Acierto: baja la prioridad de repaso (pero no a cero)
        stat.peso = Math.max(0.1, (stat.peso || 1) * 0.5);
    } else {
        stat.wrong = (stat.wrong || 0) + 1;
        stat.racha = 0;
        // Fallo: sube la prioridad (con tope para no desbordar)
        stat.peso = Math.min(20, (stat.peso || 1) * 2.5);
    }

    await db.stats.put(stat);
}

// ═══════════════════════════════════════════════
//  CRONÓMETRO
// ═══════════════════════════════════════════════
let timerInterval = null;
let secondsElapsed = 0;

function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        secondsElapsed++;
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimerDisplay() {
    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const display = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const el = document.getElementById('timer');
    if (el) el.textContent = display;
}

// ═══════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════
function showResults() {
    stopTimer();
    const total = session.correct + session.wrong;
    const pct = total > 0 ? Math.round(session.correct / total * 100) : 0;
    let emoji = '😐', title = 'Sesión completada';
    if (pct >= 90)      { emoji = '🏆'; title = '¡Sobresaliente!'; }
    else if (pct >= 70) { emoji = '🎯'; title = '¡Muy bien!'; }
    else if (pct >= 50) { emoji = '📚'; title = 'Sigue practicando'; }
    else                { emoji = '💪'; title = 'Hay que repasar'; }

    document.getElementById('res-emoji').textContent = emoji;
    document.getElementById('res-title').textContent = title;
    document.getElementById('res-sub').textContent = `Has respondido ${total} preguntas en esta sesión`;
    document.getElementById('res-pct').textContent = pct + '%';
    document.getElementById('res-correct').textContent = session.correct;
    document.getElementById('res-wrong').textContent = session.wrong;
    showScreen('results');
}

// ═══════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════
async function renderHistory() {
    const list = document.getElementById('hist-list');
    const [allQuestions, allStats] = await Promise.all([
        db.preguntas.orderBy('id').toArray(),
        db.stats.toArray()
    ]);
    const statsMap = new Map(allStats.map(s => [s.id, s]));
    const answeredQs = allQuestions.filter(q => statsMap.has(q.id));

    if (answeredQs.length === 0) {
        list.innerHTML =
            '<div class="empty-state">' +
            '<div class="empty-icon">📊</div>' +
            '<div class="empty-title">Sin historial</div>' +
            '<div class="empty-sub">Las preguntas respondidas aparecerán aquí</div>' +
            '</div>';
        return;
    }

    list.innerHTML = answeredQs.map(q => {
        const s = statsMap.get(q.id);
        return `<div class="hist-item">
            <span class="hist-num">#${q.id}</span>
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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function clearHistory() {
    if (!confirm('¿Borrar todo el historial de respuestas? (Las preguntas se conservan)')) return;
    await db.stats.clear();
    await renderHistory();
    await refreshHome();
}

// ═══════════════════════════════════════════════
//  IMPORT
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

function closeImportOutside(e) {
    if (e.target === document.getElementById('import-overlay')) closeImport();
}

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!Array.isArray(data) || data.length === 0) throw new Error('Array vacío');
        const sample = data[0];
        if (!sample.pregunta || !Array.isArray(sample.opciones) || sample.opciones.length < 2) {
            throw new Error('Formato incorrecto');
        }
        data.forEach((q, i) => {
            if (q.id === undefined) q.id = i + 1;
            if (q.correcta === undefined) q.correcta = 0;
        });

        // Reemplazo completo (coherente con el texto del overlay de importar)
        await db.preguntas.clear();
        await db.preguntas.bulkPut(data);

        await refreshHome();
        showStatus(`✓ ${data.length} preguntas importadas correctamente`, true);
        setTimeout(closeImport, 1800);
    } catch (err) {
        showStatus('✗ Error al leer el fichero: ' + err.message, false);
    } finally {
        e.target.value = '';
    }
}

function showStatus(msg, ok) {
    const el = document.getElementById('import-status');
    el.textContent = msg;
    el.className = 'import-status ' + (ok ? 'ok' : 'err');
}

// ═══════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'history') renderHistory();
    if (id === 'home') refreshHome();
    if (id !== 'study') stopTimer(); // si salimos del estudio, paramos el timer
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
boot();
