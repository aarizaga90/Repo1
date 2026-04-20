// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
let questions = [];
let session = { queue: [], index: 0, correct: 0, wrong: 0, mode: 'all' };
let history = {}; // { [id]: { correct: N, wrong: N } }
let answered = false;

const LS_Q = 'opos_questions';
const LS_H = 'opos_history';

// ═══════════════════════════════════════════════
//  DB
// ═══════════════════════════════════════════════

const db = new Dexie("OposDB");

// Definimos las tablas (Preguntas y Estadísticas)
db.version(1).stores({
    questions: 'id, pregunta, *opciones, correcta',
    stats: 'id, vistas, racha, last, weight'
});

async function initDatabase() {
    const count = await db.preguntas.count();
    if (count === 0 && typeof DEFAULT_QUESTIONS !== 'undefined') {
        console.log("Poblando base de datos con 700 preguntas...");
        await db.preguntas.bulkAdd(DEFAULT_QUESTIONS);
    }
}

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
function boot() {
    try {
        const saved = localStorage.getItem(LS_Q);
        if (saved) {
            questions = JSON.parse(saved);
        }
        else if (typeof DEFAULT_QUESTIONS !== 'undefined') {
            questions = DEFAULT_QUESTIONS;
        }
        else
        {
            questions = [];
        }
    } catch (e) {
        questions = [];
    }
    try { history = JSON.parse(localStorage.getItem(LS_H)) || {}; } catch (e) { history = {}; }
    
    refreshHome();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

function save() {
    localStorage.setItem(LS_Q, JSON.stringify(questions));
    localStorage.setItem(LS_H, JSON.stringify(history));
}

// ═══════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════
let selectedMode = 'all';

function selectMode(el, mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    selectedMode = mode;
}

function refreshHome() {
    const total = questions.length;
    const done = Object.keys(history).length;
    const totalCorrect = Object.values(history).reduce((a, h) => a + h.correct, 0);
    const totalAnswered = Object.values(history).reduce((a, h) => a + h.correct + h.wrong, 0);
    const pct = totalAnswered > 0 ? Math.round(totalCorrect / totalAnswered * 100) : null;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pct').textContent = pct !== null ? pct + '%' : '—';
    document.getElementById('stat-done').textContent = done;
    document.getElementById('prog-label').textContent = `${done} / ${total}`;
    document.getElementById('prog-fill').style.width = total > 0 ? (done / total * 100) + '%' : '0%';
    document.getElementById('range-end').value = questions.length;
    document.getElementById('range-end').max = questions.length;

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
//  STUDY
// ═══════════════════════════════════════════════

let nextQuestionBuffer = null; // Aquí guardamos la pregunta precargada
let currentSession = { mode: '', lastId: null };

// --- 3. ALGORITMO SMART (Basado en tu C#) ---
async function getSmartNextQuestion() {
    // Obtenemos todos los IDs y estadísticas de una vez (pesan poco)
    const [allIds, allStats] = await Promise.all([
        db.preguntas.toCollection().primaryKeys(),
        db.stats.toArray()
    ]);

    const statsMap = new Map(allStats.map(s => [s.id, s]));
    const nuevas = allIds.filter(id => !statsMap.has(id));

    // Excluir la que se acaba de ver para no repetir
    const candidatas = allIds.filter(id => id !== currentSession.lastId);

    let targetId;
    const azar = Math.random();

    if (nuevas.length > 0 && azar < 0.6) {
        // 60% prioridad a nuevas
        targetId = nuevas[Math.floor(Math.random() * nuevas.length)];
    } else {
        // 40% prioridad a repaso de falladas o menos vistas
        // Buscamos la que tenga mayor "peso" (fallos) o racha baja
        const repaso = allStats
            .filter(s => s.id !== currentSession.lastId)
            .sort((a, b) => (b.peso || 1) - (a.peso || 1));

        targetId = repaso.length > 0 ? repaso[0].id : candidatas[Math.floor(Math.random() * candidatas.length)];
    }

    // TRAEMOS EL CONTENIDO COMPLETO (el A4 de texto) SOLO DE LA ELEGIDA
    return await db.preguntas.get(targetId);
}

// --- 4. TÉCNICA DE PRECARGA (Prefetching) ---
async function prepareNextQuestion() {
    console.log("Precargando próxima pregunta en segundo plano...");
    nextQuestionBuffer = await getSmartNextQuestion();
}

// --- 5. FLUJO DE LA INTERFAZ ---
async function startSmartStudy() {
    currentSession.mode = 'smart';
    // Primera carga: necesitamos una pregunta YA
    const primera = await getSmartNextQuestion();
    renderQuestion(primera);

    // Inmediatamente precargamos la que vendrá después
    prepareNextQuestion();
    showScreen('study');
}

async function handleAnswer(isCorrect, qId) {
    // 1. Guardar estadística en la DB (Asíncrono)
    const stat = await db.stats.get(qId) || { id: qId, racha: 0, last: 0, peso: 1 };

    stat.last = Date.now();
    if (isCorrect) {
        stat.racha++;
        stat.peso *= 0.5; // Baja la probabilidad de salir
    } else {
        stat.racha = 0;
        stat.peso *= 2.5; // Sube mucho la probabilidad de salir (repaso urgente)
    }
    await db.stats.put(stat);

    // 2. Mostrar feedback al usuario (colores verde/rojo)
    // ... tu código de feedback visual ...

    // 3. Mientras el usuario ve el feedback, nos aseguramos de que el buffer esté listo
    if (!nextQuestionBuffer) {
        await prepareNextQuestion();
    }
}

function goToNext() {
    if (nextQuestionBuffer) {
        const q = nextQuestionBuffer;
        currentSession.lastId = q.id;
        renderQuestion(q);

        // Una vez mostrada, liberamos el buffer y precargamos la SIGUIENTE
        nextQuestionBuffer = null;
        prepareNextQuestion();
    }
}

function buildQueue(mode) {
    let pool = [...questions];
    if (mode === 'wrong') {
        pool = pool.filter(q => history[q.id] && history[q.id].wrong > 0);
    } else if (mode === 'unseen') {
        pool = pool.filter(q => !history[q.id]);
    }
    if (mode === 'shuffle' || mode === 'wrong' || mode === 'unseen') {
        pool = pool.sort(() => Math.random() - 0.5);
    }
    return pool;
}

function startStudy() {
    if (questions.length === 0) return;

    let queue = buildQueue(selectedMode);

    // Si el modo es "Todas" (en orden), aplicamos el rango
    if (selectedMode === 'all') {
        const start = parseInt(document.getElementById('range-start').value) - 1;
        const end = parseInt(document.getElementById('range-end').value);
        queue = queue.slice(start, end);
    }
    
    if (queue.length === 0) {
        alert(selectedMode === 'wrong' ? 'No tienes preguntas falladas 🎉' : 'No hay preguntas en esta categoría');
        return;
    }
    
    session = { queue, index: 0, correct: 0, wrong: 0, mode: selectedMode };
    
    startTimer();
    showScreen('study');
    renderQuestion();
}

function renderQuestion() {
    
    let q;
    if (selectedMode === 'smart') {
        q = getSmartQuestion();
        // Simulamos que la sesión es infinita o de X preguntas
        session.currentQuestion = q;
    } else {
        q = session.queue[session.index];
    }
    
    const total = session.queue.length;
    const idx = session.index;
    answered = false;

    document.getElementById('q-num').textContent = `Pregunta ${idx + 1} de ${total}`;
    document.getElementById('q-text').textContent = q.pregunta;
    document.getElementById('prog-current').textContent = `Pregunta ${idx + 1}`;
    document.getElementById('prog-of').textContent = `de ${total}`;
    document.getElementById('study-fill').style.width = ((idx) / total * 100) + '%';
    document.getElementById('answer-footer').style.display = 'none';
    document.getElementById('question-scroll').scrollTop = 0;

    const list = document.getElementById('options-list');
    list.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    q.opciones.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span class="option-text">${opt}</span>`;
        btn.onclick = () => selectAnswer(i);
        list.appendChild(btn);
    });
}

function selectAnswer(chosen) {
    if (answered) return;
    answered = true;
    const q = session.queue[session.index];
    const correct = q.correcta;
    const opts = document.querySelectorAll('.option');

    opts.forEach(o => { o.classList.add('disabled'); o.onclick = null; });

    if (chosen === correct) {
        opts[chosen].classList.add('selected-correct');
        session.correct++;
        showFeedback(true);
        recordHistory(q.id, true);
    } else {
        opts[chosen].classList.add('selected-wrong');
        opts[correct].classList.add('show-correct');
        session.wrong++;
        showFeedback(false);
        recordHistory(q.id, false);
    }

    const footer = document.getElementById('answer-footer');
    footer.style.display = 'block';
    const isLast = session.index >= session.queue.length - 1;
    document.getElementById('next-btn').textContent = isLast ? 'Ver resultados ✓' : 'Siguiente →';
}

function showFeedback(correct) {
    const el = document.getElementById('feedback-text');
    el.className = 'feedback-text ' + (correct ? 'correct' : 'wrong');
    el.textContent = correct ? '✓ ¡Correcto!' : '✗ Incorrecto';
}

function nextQuestion() {
    session.index++;
    if (session.index >= session.queue.length) {
        showResults();
    } else {
        renderQuestion();
    }
}

function recordHistory(id, isCorrect) {
    if (!history[id]) history[id] = { c: 0, w: 0, r: 0, t: 0 };

    history[id].t = Date.now(); // Ultima vez vista
    if (isCorrect) {
        history[id].c++; // Total correctas
        history[id].r++; // Racha actual
    } else {
        history[id].w++; // Total fallos
        history[id].r = 0; // Reset racha
    }
    save();
}

// Función para guardar una respuesta con lógica "Smart"
async function recordSmartAnswer(qId, isCorrect) {
    const stat = await db.stats.get(qId) || { id: qId, vistas: 0, racha: 0, last: 0, weight: 1.0 };

    stat.vistas++;
    stat.last = Date.now();

    if (isCorrect) {
        stat.racha++;
        // Si acierta, bajamos la prioridad (peso)
        stat.weight *= 0.8;
    } else {
        stat.racha = 0;
        // Si falla, subimos la prioridad mucho
        stat.weight *= 2.0;
    }

    await db.stats.put(stat);
}

async function getSmartNextId() {
    const allStats = await db.stats.toArray();
    const idsVistos = allStats.map(s => s.id);

    // 1. IDs que nunca has visto
    const todasLasPreguntas = await db.preguntas.toCollection().primaryKeys();
    const nuevas = todasLasPreguntas.filter(id => !idsVistos.includes(id));

    // 2. Cascada de selección (Lógica C#)
    let idElegido;
    const azar = Math.random();

    if (nuevas.length > 0 && azar < 0.7) {
        // Prioridad 70% a las nuevas (por el gran volumen de texto)
        idElegido = nuevas[Math.floor(Math.random() * nuevas.length)];
    } else {
        // Prioridad a falladas (peso alto) o repaso
        const repaso = allStats.sort((a, b) => b.peso - a.peso);
        idElegido = repaso.length > 0 ? repaso[0].id : todasLasPreguntas[0];
    }

    // 3. Traer SOLO la pregunta elegida (ahorra memoria)
    return await db.preguntas.get(idElegido);
}

function getSmartQuestion() {
    const now = Date.now();
    // Filtramos para no repetir la última (distancia mínima)
    let pool = questions.filter(q => q.id !== session.lastId);

    // 1. Población: NUNCA VISTAS
    const nuevas = pool.filter(q => !history[q.id]);

    // 2. Población: REPASO URGENTE (Falladas o con racha baja)
    const repaso = pool.filter(q => history[q.id] && history[q.id].r < 3);

    // 3. Población: DOMINADAS (Racha de 3 o más)
    const dominadas = pool.filter(q => history[q.id] && history[q.id].r >= 3);

    let seleccionada;
    const azar = Math.random();

    // Simulamos la "Cuota de nuevas" del algoritmo de C#
    if (nuevas.length > 0 && azar < 0.6) {
        // 60% probabilidad de priorizar nuevas hasta que se acaben
        seleccionada = nuevas[Math.floor(Math.random() * nuevas.length)];
    } else if (repaso.length > 0) {
        // Si no toca nueva, vamos a por las falladas/pendientes
        seleccionada = repaso[Math.floor(Math.random() * repaso.length)];
    } else {
        // Si todo está dominado, sacamos de la bolsa de dominadas
        seleccionada = dominadas[Math.floor(Math.random() * dominadas.length)] || pool[0];
    }

    session.lastId = seleccionada.id;
    return seleccionada;
}

// ═══════════════════════════════════════════════
//  CRONÓMETRO
// ═══════════════════════════════════════════════
let timerInterval;
let secondsElapsed = 0;

function startTimer() {
    stopTimer(); // Limpiamos por si acaso
    secondsElapsed = 0;
    timerInterval = setInterval(() => {
        secondsElapsed++;
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function updateTimerDisplay() {
    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const display = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    // Asegúrate de añadir un id="timer" en tu HTML
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
    if (pct >= 90) { emoji = '🏆'; title = '¡Sobresaliente!'; }
    else if (pct >= 70) { emoji = '🎯'; title = '¡Muy bien!'; }
    else if (pct >= 50) { emoji = '📚'; title = 'Sigue practicando'; }
    else { emoji = '💪'; title = 'Hay que repasar'; }

    document.getElementById('res-emoji').textContent = emoji;
    document.getElementById('res-title').textContent = title;
    document.getElementById('res-sub').textContent = `Has respondido ${total} preguntas en esta sesión`;
    document.getElementById('res-pct').textContent = pct + '%';
    document.getElementById('res-correct').textContent = session.correct;
    document.getElementById('res-wrong').textContent = session.wrong;
    showScreen('results');
}

// ═══════════════════════════════════════════════
//  HISTORY SCREEN
// ═══════════════════════════════════════════════
function renderHistory() {
    const list = document.getElementById('hist-list');
    const answered = questions.filter(q => history[q.id]);
    if (answered.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Sin historial</div><div class="empty-sub">Las preguntas respondidas aparecerán aquí</div></div>';
        return;
    }
    list.innerHTML = answered.map(q => {
        const h = history[q.id];
        return `<div class="hist-item">
      <span class="hist-num">#${q.id}</span>
      <span class="hist-q">${q.pregunta}</span>
      <div class="hist-badges">
        <span class="badge c">✓ ${h.correct}</span>
        <span class="badge w">✗ ${h.wrong}</span>
      </div>
    </div>`;
    }).join('');
}

function clearHistory() {
    if (!confirm('¿Borrar todo el historial?')) return;
    history = {};
    save();
    renderHistory();
    refreshHome();
}

// ═══════════════════════════════════════════════
//  IMPORT
// ═══════════════════════════════════════════════
function openImport() {
    document.getElementById('import-overlay').classList.add('open');
    document.getElementById('import-status').className = 'import-status';
    document.getElementById('import-status').textContent = '';
}
function closeImport() {
    document.getElementById('import-overlay').classList.remove('open');
}
function closeImportOutside(e) {
    if (e.target === document.getElementById('import-overlay')) closeImport();
}

function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data) || data.length === 0) throw new Error('Array vacío');
            // Validate first item
            const sample = data[0];
            if (!sample.pregunta || !Array.isArray(sample.opciones) || sample.opciones.length < 2) {
                throw new Error('Formato incorrecto');
            }
            // Ensure correcta field exists
            data.forEach((q, i) => {
                if (q.id === undefined) q.id = i + 1;
                if (q.correcta === undefined) q.correcta = 0;
            });
            questions = data;
            save();
            refreshHome();
            showStatus(`✓ ${data.length} preguntas importadas correctamente`, true);
            setTimeout(closeImport, 1800);
        } catch (err) {
            showStatus('✗ Error al leer el fichero: ' + err.message, false);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function showStatus(msg, ok) {
    const el = document.getElementById('import-status');
    el.textContent = msg;
    el.className = 'import-status ' + (ok ? 'ok' : 'err');
}

//guardar import en DB
async function importarPreguntas(jsonArray) {
    await db.preguntas.bulkPut(jsonArray);
    console.log("700 preguntas guardadas en la DB del iPhone");
}

// ═══════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'history') renderHistory();
    if (id === 'home') refreshHome();
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
    boot();