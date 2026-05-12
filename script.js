// ═══════════════════════════════════════════════
//  OposTest — PWA
//  Fuente única de verdad: IndexedDB (Dexie, ver db.js)
// ═══════════════════════════════════════════════

// ─── CONFIG ───────────────────────────────────────
let SMART_SESSION_LENGTH = 20;

// ─── CONFIG ───────────────────────────────────────
// Esperar a que el DOM esté cargado para evitar errores de referencia
document.addEventListener('DOMContentLoaded', () => {

// 1. Configuración de eventos al cargar el DOM
        const container = document.getElementById('home-actions');
        if (!container) return;

        container.addEventListener('click', (e) => {
            // Buscamos si el clic fue en un botón de modo o dentro de uno
            const btn = e.target.closest('.mode-btn');
            if (!btn) return;

            const mode = btn.dataset.mode;
            const target = btn.dataset.target;

            if (mode && target) {
                selectModeSecure(btn, mode, target);
            }
        });

        // Opcional: Activar el primero por defecto de forma segura
        const defaultBtn = document.querySelector('.mode-btn[data-mode="all"]');
        if (defaultBtn) selectModeSecure(defaultBtn, 'all', 'top');

    // 2. Botón Empezar
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startStudy();
        });
    }

    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if(clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearHistory)
    }

    // 3. Botón Historial
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            showScreen('history');
        });
    }

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

// 1. Vincular el nuevo botón (pon esto dentro del DOMContentLoaded)
const finishEarlyBtn = document.getElementById('finish-early-btn');
if (finishEarlyBtn) {
    finishEarlyBtn.addEventListener('click', () => {
        showModal("¿Quieres terminar la sesión y ver los resultados ahora?", {
            confirmText: 'Ver resultados',
            cancelText: 'Seguir',
            onConfirm: () => showResults()
        });
    });
}

// 2. Modificar la flecha de atrás para que no borre t.odo sin avisar
document.addEventListener('click', (e) => {
const btn = e.target.closest('.back-to-home');
if(!btn) return;

        // Si estamos en la pantalla de estudio y hay preguntas respondidas...
        const currentScreen = document.querySelector('.screen.active').id;
        if (currentScreen === 'study' && (session.correct > 0 || session.wrong > 0)) {
            showModal("¿Quieres terminar la sesión y ver los resultados actuales?", {
                confirmText: 'Ver resultados',
                cancelText: 'Seguir',
                onConfirm: () => showResults()
            });
            return;
        }
        showScreen('home');
    });
});

// ─── ESTADO EN MEMORIA ────────────────────────────
// Los datos persistentes viven en Dexie. Aquí solo vive la sesión actual.
let selectedMode = 'all'; // 'all' | 'shuffle' | 'smart' | 'wrong' | 'unseen'
let selectedTemario = 'todos'; // 'todos' | 'común' | 'específico'
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
    
    initServiceWorker();
}

// ═══════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════
async function selectModeSecure(el, mode, target) {
    if (!mode) return;

    // 1. Clases en botones
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');

    selectedMode = mode;
    console.log("📍 Modo cambiado a:", selectedMode);

    // 2. Identificar paneles
    const pTop = document.getElementById('settings-top');
    const pBottom = document.getElementById('settings-bottom');
    const activePanel = (target === 'top') ? pTop : pBottom;
    const inactivePanel = (target === 'top') ? pBottom : pTop;

    // 3. Cerrar el panel que no estamos usando
    if (inactivePanel) inactivePanel.classList.remove('active');

    // 4. Datos del banco
    const totalPregs = (typeof db !== 'undefined') ? await db.preguntas.count() : 200;
    
    const temarioSelectorHTML = `
    <div class="control-group" style="flex: 1 1 200px; min-width: 200px;">
        <label style="font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; text-transform: uppercase;">Bloque:</label>
        <select id="filter-temario" style="width: 100%; padding: 8px; border-radius: 6px; background: #1e1e2e; color: var(--text); border: 1px solid var(--accent-dim); font-size: 14px;">
            <option value="todos">📚 Todos</option>
            <option value="común">📘 Común</option>
            <option value="específico">📙 Específico</option>
        </select>
    </div>
`;
    
    const configs = {
        'all': {
            desc: "Estudio secuencial por rango.",
            html: `
        <div style="display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end;">
            ${temarioSelectorHTML}
            <div class="control-group" style="flex: 0 1 auto; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); height: 38px;">
                <span style="font-size: 12px; color: var(--muted);">Rango:</span>
                <input type="number" id="range-start" value="1" style="width: 55px; border: none; background: transparent; color: var(--accent); font-weight: bold; text-align: center;">
                <span style="color: var(--muted);">-</span>
                <input type="number" id="range-end" value="${totalPregs}" style="width: 55px; border: none; background: transparent; color: var(--accent); font-weight: bold; text-align: center;">
            </div>
        </div>`
        },
        'exam': {
            desc: "Simulacro oficial con tiempo limitado y corrección al final.",
            html: `
    <div style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; gap: 10px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px;">
            <div style="flex: 1;">
                <label style="font-size: 11px; color: var(--muted);">COMUNES</label>
                <input type="number" id="exam-comun" value="20" style="width: 100%; background: transparent; border: 1px solid #444; color: var(--accent); text-align: center; border-radius: 4px;">
            </div>
            <div style="flex: 1;">
                <label style="font-size: 11px; color: var(--muted);">ESPECÍFICAS</label>
                <input type="number" id="exam-especifico" value="40" style="width: 100%; background: transparent; border: 1px solid #444; color: var(--accent); text-align: center; border-radius: 4px;">
            </div>
            <div style="flex: 1;">
                <label style="font-size: 11px; color: var(--muted);">MINUTOS</label>
                <input type="number" id="exam-time" value="60" style="width: 100%; background: transparent; border: 1px solid #444; color: var(--accent); text-align: center; border-radius: 4px;">
            </div>
        </div>
        <p style="font-size: 11px; color: #ff9f43;">⚠️ Las respuestas se corregirán al terminar el examen.</p>
    </div>
    `
        },
        'smart': {
            desc: "Prioridad a fallos y nuevas.",
            html: `
        <div style="display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end;">
            ${temarioSelectorHTML}
            <div class="control-group" style="flex: 0 1 auto; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); height: 38px;">
                <span style="font-size: 12px; color: var(--muted);">Cantidad:</span>
                <input type="number" id="smart-limit" value="20" min="1" max="${totalPregs}" style="width: 50px; border: none; background: transparent; color: var(--accent); font-weight: bold; text-align: center;">
                <label style="display: flex; allign-items: center; gap: 6px; font-size: 12px">
                <input type="checkbox" id="smart-infinite">♾️
                </label>
            </div>
        </div>`
        },
        'shuffle': { desc: "Mezcla aleatoria total, con opcion a elegir rango.",
            html: `
            <div style="display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end;">
            ${temarioSelectorHTML}
             <div class="control-group" style="flex: 0 1 auto; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); height: 38px;">
                <span style="font-size: 12px; color: var(--muted);">Rango:</span>
                <input type="number" id="range-start" value="1" style="width: 55px; border: none; background: transparent; color: var(--accent); font-weight: bold; text-align: center;">
                <span style="color: var(--muted);">-</span>
                <input type="number" id="range-end" value="${totalPregs}" style="width: 55px; border: none; background: transparent; color: var(--accent); font-weight: bold; text-align: center;">
            </div>
            </div>` },
        'wrong': { desc: "Repasa tus errores.", html: `<div style="display: flex; flex-wrap: wrap; gap: 15px;">${temarioSelectorHTML}</div>` },
        'unseen': { desc: "Preguntas nuevas.", html: `<div style="display: flex; flex-wrap: wrap; gap: 15px;">${temarioSelectorHTML}</div>` }
    };

    const config = configs[mode];

    if (activePanel && config) {
        activePanel.innerHTML = `
            <div class="panel-content" style="border-left: 3px solid var(--accent); padding: 5px 0 10px 15px;;">
                <p style="margin:0 0 12px 0; font-size:12px; color:var(--muted); line-height:1.4;">${config.desc}</p>
                <div class="panel-controls" style="display:block; color:var(--accent); font-weight:bold;">
                    ${config.html}
                </div>
            </div>
        `;

        requestAnimationFrame(() => {
            activePanel.classList.add('active');
        });

        // ─── NUEVO CÓDIGO AQUÍ: Lógica de actualización dinámica ───
        const selector = activePanel.querySelector('#filter-temario');
        if (selector) {
            selector.addEventListener('change', async (e) => {
                const val = e.target.value;
                let count;

                // 1. Contar cuántas preguntas hay de ese bloque
                if (val === 'todos') {
                    count = await db.preguntas.count();
                } else {
                    count = await db.preguntas.where('temario').equals(val).count();
                }

                console.log(`📊 Filtro cambiado: ${val}. Disponibles: ${count}`);

                // 2. Actualizar inputs de rango (Modo All)
                const rStart = document.getElementById('range-start');
                const rEnd = document.getElementById('range-end');
                if (rStart && rEnd) {
                    rStart.value = 1;
                    rEnd.value = count;
                    rEnd.max = count;
                }

                // 3. Actualizar límite (Modo Smart)
                const sLimit = document.getElementById('smart-limit');
                if (sLimit) {
                    sLimit.max = count;
                    if (parseInt(sLimit.value) > count) sLimit.value = count;
                }
            });
        }
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
    if (rangeEnd) {
        rangeEnd.value = total;
        rangeEnd.max = total;
    }

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

function getQuestionCode(q) {
    if (!q || !q.temario || q.numero_temario === undefined) return "S/N";

    // Sacamos la inicial: "común" -> "C", "específico" -> "E"
    const letra = q.temario.toLowerCase().startsWith('e') ? 'E' : 'C';
    return `${q.numero_temario}-${letra}`;
}

// ═══════════════════════════════════════════════
//  STUDY — arranque de sesión
// ═══════════════════════════════════════════════
async function startStudy() {
    const total = await db.preguntas.count();
    if (total === 0) {
        showToast("No hay preguntas en la selección");
        return;
    }

    console.log("🚀 Iniciando sesión. Modo seleccionado:", selectedMode);

    const temarioInput = document.getElementById('filter-temario');
    selectedTemario = temarioInput ? temarioInput.value : 'todos';
    
    console.log("🎯 Filtrando por temario:", selectedTemario);

    // Reset de sesión
    session = {
        mode: selectedMode,
        queue: [],
        index: 0,
        correct: 0,
        wrong: 0,
        wrongAnswers: [],
        currentQuestion: null,
        nextBuffer: null,
        lastId: null
    };

    answered = false;

    if (selectedMode === 'smart') {
        console.log("🧠 Entrando en lógica Smart...");

/*        const cuentaPreguntas = document.getElementById('smart-limit');
        let userLimit = cuentaPreguntas ? parseInt(cuentaPreguntas.value, 10) : 20;*/

        let query = (selectedTemario !== 'todos') ? db.preguntas.where('temario').equals(selectedTemario) : db.preguntas.toCollection();
        const totalDisponible = await query.count();

        if(totalDisponible === 0) {
            showToast("No hay preguntas en la selección");
            return;
        }

        const infiniteCheckbox = document.getElementById('smart-infinite');
        const esInfinito = infiniteCheckbox && infiniteCheckbox.checked;

        if (esInfinito) {
            SMART_SESSION_LENGTH = Infinity;
        } else {
            let userLimit = parseInt(document.getElementById('smart-limit')?.value, 10);
        if (isNaN(userLimit) || userLimit < 1) userLimit = 1;

        SMART_SESSION_LENGTH = Math.min(userLimit, totalDisponible);
        }

        const first = await getSmartNextQuestion();
        if (!first) {
            showToast('No hay preguntas disponibles');
            return;
        }
        session.currentQuestion = first;
        session.lastId = first.id;
        console.log("✅ Primera pregunta elegida:", getQuestionCode(first), "ID:", first.id);
        prepareNextQuestion(); // fire-and-forget
        startTimer();
        showScreen('study');
        renderCurrentQuestion();
        return;
    }

    if (selectedMode === 'exam') {
        const numComun = parseInt(document.getElementById('exam-comun').value) || 0;
        const numEspec = parseInt(document.getElementById('exam-especifico').value) || 0;
        const examMinutes = parseInt(document.getElementById('exam-time').value) || 60;

        // 1. Obtener pools por separado
        let poolComun = await db.preguntas.where('temario').equals('común').toArray();
        let poolEspec = await db.preguntas.where('temario').equals('específico').toArray();

        // 2. Mezclar y recortar
        poolComun = poolComun.sort(() => Math.random() - 0.5).slice(0, numComun);
        poolEspec = poolEspec.sort(() => Math.random() - 0.5).slice(0, numEspec);

        const examPool = [...poolComun, ...poolEspec].sort(() => Math.random() - 0.5);

        if (examPool.length === 0) { showToast("No hay preguntas disponibles"); return; }

        // 3. Configurar sesión especial
        session.mode = 'exam';
        session.queue = examPool;
        session.isExam = true; // Flag para no corregir al momento
        session.answers = {}; // Guardaremos {preguntaId: respuestaElegida}
        session.timeLeft = examMinutes * 60;

        startExamTimer(); // Una nueva función de cronómetro
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

    // 2. APLICAR FILTRO DE TEMARIO
    if (selectedTemario !== 'todos') {
        pool = pool.filter(q => q.temario === selectedTemario);
    }

    // 3. APLICAR EL RANGO SOBRE LA LISTA FILTRADA
    if (selectedMode === 'all') {
        console.log("📋 Iniciando modo TODAS:", selectedMode);
        const startInput = document.getElementById('range-start');
        const endInput = document.getElementById('range-end');

        // Si el usuario puso 1 a 50, sacamos las 50 primeras del bloque elegido
        const startVal = startInput ? parseInt(startInput.value, 10) : 1;
        const endVal = endInput ? parseInt(endInput.value, 10) : pool.length;

        const start = Math.max(0, startVal - 1);
        const end = Math.min(pool.length, endVal);

        pool = pool.slice(start, end);
    } else if (selectedMode === 'wrong') {
        console.log("📋 Iniciando modo Falladas:", selectedMode);
        pool = pool.filter(q => {
            const s = statsMap.get(q.id);
            return s && (s.wrong || 0) > 0;
        });
    } else if (selectedMode === 'unseen') {
        console.log("📋 Iniciando modo NO-VISTAS:", selectedMode);
        pool = pool.filter(q => !statsMap.has(q.id));
        } else if (selectedMode === 'shuffle') {
    console.log("🔀 Iniciando modo ALEATORIO POR RANGO");
    const startInput = document.getElementById('range-start');
    const endInput = document.getElementById('range-end');

    const startVal = startInput ? parseInt(startInput.value, 10) : 1;
    const endVal = endInput ? parseInt(endInput.value, 10) : pool.length;

    const start = Math.max(0, startVal - 1);
    const end = Math.min(pool.length, endVal);

    // PRIMERO: Cortamos el rango que el usuario quiere
    pool = pool.slice(start, end);
    
    // SEGUNDO: Mezclamos SOLO ese rango
    pool = pool.sort(() => Math.random() - 0.5);
    }

    if (pool.length === 0) {
        const msg = selectedMode === 'wrong'  ? `No tienes preguntas falladas en ${selectedTemario} 🎉`
            : selectedMode === 'unseen' ? `Ya has visto todas las preguntas de ${selectedTemario}`
                :                             `No hay preguntas en ${selectedTemario}`;
        showToast(msg);
        return;
    }

    session.queue = pool;
    session.currentQuestion = pool[0];
    console.log("✅ Primera pregunta elegida:", getQuestionCode(pool[0]), "ID:", pool[0].id);
    startTimer();
    showScreen('study');
    renderCurrentQuestion();
}

// ═══════════════════════════════════════════════
//  STUDY — render
// ═══════════════════════════════════════════════
function renderCurrentQuestion() {
    const q = session.currentQuestion;
    const container = document.getElementById('question-scroll');
    if (!container || !q) return;

    answered = false;

    const idx = session.index;
    const isSmart = session.mode === 'smart';
    const isExam = session.mode === 'exam';
    const total = isSmart ? SMART_SESSION_LENGTH : session.queue.length;
    const esInfinito = total === Infinity;
    const code = getQuestionCode(q);

    // 1. Actualización de contadores y textos
    document.getElementById('q-num').textContent = esInfinito
        ? `Pregunta ${idx + 1}`
        : `Pregunta ${idx + 1} de ${total}`;
    document.getElementById('q-text').textContent = q.pregunta || q.texto; // Soporte para ambos nombres de campo
    document.getElementById('prog-current').textContent = `Pregunta ${idx + 1}`;
    document.getElementById('prog-of').textContent = esInfinito ? '∞' : `de ${total}`;
    document.getElementById('study-fill').style.width = esInfinito
        ? '0%'
        : (idx / total * 100) + '%';
    document.getElementById('question-scroll').scrollTop = 0;
    document.querySelector('.question-num').textContent = `PREGUNTA ${code}`;

    // 2. Gestión de Footer y Cronómetro
    const footer = document.getElementById('answer-footer');
    if (isExam) {
        footer.style.display = 'none'; // En examen no hay explicación inmediata
        document.getElementById('study').classList.remove('footer-visible');
        // Si tienes un badge de tiempo, lo actualizamos aquí
        updateTimerDisplay();
    } else {
        footer.style.display = 'none'; // Se mostrará al responder en modo normal
        document.getElementById('study').classList.remove('footer-visible');
    }

    // 3. Renderizado de opciones
    const list = document.getElementById('options-list');
    list.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    q.opciones.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';

        // --- LÓGICA DE EXAMEN (Recordar respuesta) ---
        if (isExam && session.answers[q.id] === i) {
            btn.classList.add('selected-exam');
        }

        btn.innerHTML =
            `<span class="option-letter">${letters[i]}</span>` +
            `<span class="option-text"></span>`;
        btn.querySelector('.option-text').textContent = opt;
        
        btn.onclick = () => selectAnswer(i);

        list.appendChild(btn);
    });

    // 4. Inyectar botones de navegación (solo si es examen)
    updateExamNavigation(idx, total);
}

function updateExamNavigation(idx, total) {
    // Buscamos o creamos un contenedor para los botones de navegación en el examen
    let navContainer = document.getElementById('exam-nav-controls');

    if (session.mode !== 'exam') {
        if (navContainer) navContainer.style.display = 'none';
        return;
    }

    if (!navContainer) {
        navContainer = document.createElement('div');
        navContainer.id = 'exam-nav-controls';
        navContainer.className = 'exam-nav-bar'; // Añade estilo en CSS
        document.getElementById('question-scroll').appendChild(navContainer);
    }

    navContainer.style.display = 'flex';
    navContainer.innerHTML = `
        <button onclick="examPrevQuestion()" ${idx === 0 ? 'disabled' : ''} class="btn-nav">⬅️ Anterior</button>
        <button onclick="confirmFinishExam()" class="btn-finish">Entregar Examen</button>
        <button onclick="examNextQuestion()" ${idx === total - 1 ? 'disabled' : ''} class="btn-nav">Siguiente ➡️</button>
    `;
}

function examNextQuestion() {
    if (session.index < session.queue.length - 1) {
        session.index++;
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    } else if (!session.isExam) {
        // Si no es examen y llegamos al final, quizás generar una nueva
        // o terminar sesión normal
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
    const respondidas = Object.keys(session.answers).length;
    const total = session.queue.length;

    const msg = `Has respondido ${respondidas} de ${total} preguntas.\n¿Estás seguro de que quieres entregar el examen?`;

    showModal(msg, {
        confirmText: 'Terminar el examen',
        cancelText: 'Seguir con el examen',
        onConfirm: () => finishExam()
    });
}

async function finishExam() {
    clearInterval(examTimerInterval);

    let aciertos = 0;
    let fallos = 0;
    let blancas = 0;

    session.queue.forEach(q => {
        const respuestaUser = session.answers[q.id];

        if (respuestaUser === undefined) {
            blancas++;
        } else if (respuestaUser === q.correcta) {
            aciertos++;
            // Opcional: Actualizar stats de la DB aquí al final
        } else {
            fallos++;
            // Opcional: Actualizar stats de la DB aquí al final
        }
    });

    // Fórmula típica de oposición: Aciertos - (Fallos / 3)
    // Suponiendo que cada pregunta vale 1 punto
    const notaFinal = (aciertos - (fallos / 3)).toFixed(2);

    // Mostramos resultados (puedes usar un modal o una pantalla nueva)
    showExamResults({
        nota: notaFinal,
        aciertos,
        fallos,
        blancas,
        total: session.queue.length
    });
}

async function selectAnswer(chosen) {
    if (answered) return;
    answered = true;

    const q = session.currentQuestion;
    if (!q) return;

    // SI ES MODO EXAMEN: Guardamos y pasamos
    if (session.isExam) {
        // --- LÓGICA DE ANULACIÓN ---
        if (session.answers[q.id] === chosen) {
            // Si pincha la que ya está marcada, la borramos del mapa
            delete session.answers[q.id];
            console.log(`Anulada respuesta de la pregunta ${q.id}`);
        } else {
            // Si pincha una nueva (o no había nada), guardamos
            session.answers[q.id] = chosen;
        }

        // Repintamos la pregunta actual para que los botones reflejen el cambio
        renderCurrentQuestion();
        return;
    }

    // --- LÓGICA NORMAL (No examen) ---
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

    // Persistir la respuesta (estadística)
    try {
        await recordAnswer(q.id, isCorrect);
    } catch(e) {
        console.error('Error guardando respuesta:', e);
    }
    
    //mostrar footer
    document.getElementById('answer-footer').style.display = 'block';
    document.getElementById('study').classList.add('footer-visible');
    const isLast = session.mode === 'smart'
        ? session.index + 1 >= SMART_SESSION_LENGTH
        : session.index >= session.queue.length - 1;
    document.getElementById('next-btn').textContent = isLast ? 'Ver resultados ✓' : 'Siguiente →';
}

async function nextQuestion() {
    console.log("⏭️ Click en Siguiente. Modo actual:", session.mode);
    if (session.mode === 'smart') {
        session.index++;
        if (session.index >= SMART_SESSION_LENGTH) {
            console.log("🏁 Fin de sesión smart.");
            showResults();
            return;
        }
        // Usamos el buffer precargado; si no está listo, cargamos en el momento
        let q = session.nextBuffer;
        if (q) {
            console.log("📦 Usando pregunta del BUFFER:", getQuestionCode(q));
        } else {
            console.warn("⚠️ Buffer vacío, calculando al vuelo...");
            q = await getSmartNextQuestion();
        }
        
        session.nextBuffer = null;
        session.currentQuestion = q;
        session.lastId = q ? q.id : null;

        prepareNextQuestion(); // precarga la siguiente
        renderCurrentQuestion();
    } else {
        // Modo normal
        session.index++;
        console.log("📑 Siguiente pregunta secuencial. Nuevo índice:", session.index);
        if (session.index >= session.queue.length) {
            showResults();
            return;
        }
        session.currentQuestion = session.queue[session.index];
        renderCurrentQuestion();
    }
}

// ═══════════════════════════════════════════════
//  SMART — selector de próxima pregunta
//  60% prioridad a nuevas, 40% repaso ordenado por peso
// ═══════════════════════════════════════════════
async function getSmartNextQuestion() {
    console.group("🔍 Buscando próxima pregunta Smart");

    let query = (selectedTemario !== 'todos')
        ? db.preguntas.where('temario').equals(selectedTemario)
        : db.preguntas.toCollection();

    const allIds = await query.primaryKeys();
    const allStats = await db.stats.toArray();
    
    if (allIds.length === 0) {
        console.groupEnd();
        return null;
    }

    const statsMap = new Map(allStats.map(s => [s.id, s]));

    // 1. Filtrar candidatas (excluir la actual para no repetir)
    const candidatasIds = allIds.filter(id => id !== session.lastId);
    if (candidatasIds.length === 0) return await db.preguntas.get(allIds[0]);

    // 2. Separar en "Nuevas" y "Repaso"
    const nuevas = candidatasIds.filter(id => !statsMap.has(id));
    const repaso = allStats
        .filter(s => candidatasIds.includes(s.id) && ((s.wrong || 0) > 0 || (s.peso || 1) > 1))
        .sort((a, b) => (b.peso || 1) - (a.peso || 1));

    console.log("📊 Estado del banco:", { total: allIds.length, nuevas: nuevas.length, repaso: repaso.length, lastId: session.lastId });
    
    let targetId;
    const azar = Math.random();

    // LÓGICA DE DECISIÓN
    if (nuevas.length > 0 && (repaso.length === 0 || azar < 0.6)) {
        // MODO NUEVAS: 60% de probabilidad o si no hay nada que repasar
        // Forzamos aleatoriedad total sobre el array de nuevas
        targetId = nuevas[Math.floor(Math.random() * nuevas.length)];
        console.log("🎲 Decisión: NUEVA al azar. ID elegido:", targetId);
    }
    else if (repaso.length > 0) {
        // MODO REPASO: Elegimos entre las 3 con más peso para variar un poco
        const topCount = Math.min(3, repaso.length);
        const topCandidatas = repaso.slice(0, topCount);
        targetId = topCandidatas[Math.floor(Math.random() * topCandidatas.length)].id;
        console.log("🔄 Decisión: REPASO (Top 3). ID elegido:", targetId);
    }
    else {
        // FALLBACK: Si no hay nuevas ni repaso con peso, aleatorio puro sobre t.odo el banco
        targetId = candidatasIds[Math.floor(Math.random() * candidatasIds.length)];
        console.log("⚠️ Decisión: FALLBACK aleatorio total. ID elegido:", targetId);
    }

    console.groupEnd();
    return await db.preguntas.get(targetId);
}

// Precarga en segundo plano — llena session.nextBuffer sin bloquear
async function prepareNextQuestion() {
    try {
        session.nextBuffer = await getSmartNextQuestion();
    } catch (e) {
        session.nextBuffer = null;
            console.log("Error localizando la siguiente pregunta");
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

    const mins = Math.floor(secondsElapsed /60);
    const secs = secondsElapsed % 60;
    const tiempoFormateado = `${mins}:${secs.toString().padStart(2,'0')}`;
    const media = total > 0 ? (secondsElapsed / total).toFixed(1) : 0;

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
    document.getElementById('res-time').textContent = tiempoFormateado;
    document.getElementById('res-avg').textContent = `${media}s`;
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
        const code = getQuestionCode(q);
        return `<div class="hist-item">
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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function clearHistory() {
    showModal("¿Quieres borrar todo el historial de respuestas? (Las preguntas se conservan)", {
        confirmText: 'Borrar el historial',
        cancelText: 'Cancelar',
        onConfirm: async () => {
            await db.stats.clear();
            await renderHistory();
            await refreshHome();
        }
    });
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

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!Array.isArray(data) || data.length === 0) throw new Error('El archivo está vacío');

        const sample = data[0];
        // Validamos el nuevo formato: pregunta, opciones, temario y numero_temario
        if (!sample.pregunta || !Array.isArray(sample.opciones) || !sample.temario || sample.numero_temario === undefined) {
            throw new Error('Formato JSON incorrecto (faltan campos de temario)');
        }

        // Limpieza y preparación de datos antes de insertar
        const cleanData = data.map(q => {
            // Creamos un objeto nuevo para asegurarnos de que NO tenga un ID previo
            // y que IndexedDB genere uno nuevo desde 1
            return {
                temario: q.temario,
                numero_temario: q.numero_temario,
                pregunta: q.pregunta,
                opciones: q.opciones,
                correcta: q.correcta !== undefined ? q.correcta : 0
            };
        });

        // 1. Borramos la base de datos actual para que el autoincremento empiece de 1
        await db.preguntas.clear();
        await db.stats.clear();

        // 2. Insertamos el bloque de preguntas. 
        // IndexedDB asignará los IDs internos automáticamente.
        await db.preguntas.bulkAdd(cleanData);

        await refreshHome();
        showStatus(`✓ ${cleanData.length} preguntas de temario importadas`, true);
        setTimeout(closeImport, 1800);
    } catch (err) {
        showStatus('✗ Error: ' + err.message, false);
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

/**
 * Gestiona el registro del SW y la detección de actualizaciones
 */
function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
        
        window.addEventListener('load', async () => {
                try {
                        const reg = await navigator.serviceWorker.register('./sw.js', {
                updateViaCache: 'none' // ← siempre busca sw.js en el servidor
            });
                        // Se dispara cuando el nuevo SW toma el control → recarga
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                const enEstudio = document.querySelector('#study.active');
                if (enEstudio) {
                    showToast('🚀 Actualización lista. Se aplicará al volver al inicio.');
                } else {
                    window.location.reload();
                }
            });

            // Fuerza chequeo al volver a primer plano (clave en iOS)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    reg.update();
                }
            });

        } catch (err) {
            console.error('SW error:', err);
        }
    });
}

/**
 * Muestra el aviso al usuario
 */
function lanzarAvisoActualizacion() {
    // Usamos un pequeño delay para no interrumpir si la app acaba de abrirse
    setTimeout(() => {
        const msg = "🚀 ¡Hay una nueva versión disponible con cambios o nuevas preguntas! \n\n ¿Quieres actualizar ahora?";
        showModal(msg, {
            confirmText: 'Sí',
            cancelText: 'No',
            onConfirm: () => window.location.reload()
        });
    }, 1000);
}

// ── MODAL (sustituye confirm()) ──────────────────────────────
function showModal(msg, { onConfirm, onCancel, confirmText = 'Aceptar', cancelText = 'Cancelar' } = {}) {
    const overlay = document.getElementById('modal-overlay');
    const msgEl = document.getElementById('modal-msg');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    msgEl.textContent = msg;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    overlay.style.display = 'flex';

    // Limpiar listeners anteriores (clonar para evitar acumulación)
    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newConfirm.addEventListener('click', () => {
        overlay.style.display = 'none';
        onConfirm?.();
    });
    newCancel.addEventListener('click', () => {
        overlay.style.display = 'none';
        onCancel?.();
    });
}

// ── TOAST (sustituye alert() cuando no se necesita respuesta) ──
let toastTimer = null;
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
