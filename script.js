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
    } catch {
        questions = [];
    }
    try { history = JSON.parse(localStorage.getItem(LS_H)) || {}; } catch { history = {}; }
    
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
    const q = session.queue[session.index];
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
    if (!history[id]) history[id] = { correct: 0, wrong: 0 };
    if (isCorrect) history[id].correct++;
    else history[id].wrong++;
    save();
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
window.addEventListener('DOMContentLoaded', () => {
    boot();
});