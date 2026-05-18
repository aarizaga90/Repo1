// ═══════════════════════════════════════════════
//  OposTest — Admin
// ═══════════════════════════════════════════════

// Estado encapsulado — evita contaminar el scope global
const adminState = {
    allQuestions:      [],
    filteredQuestions: [],
    currentOffset:     0,
    PAGE_SIZE:         20
};

// ── Init ──────────────────────────────────────────────────────
async function initAdminList() {
    const container   = document.getElementById('questions-list-container');
    const countEl     = document.getElementById('search-count');
    const searchInput = document.getElementById('search-input');

    if (!container) return;

    container.innerHTML = '<div class="skeleton"></div>'.repeat(5);
    if (searchInput) searchInput.value = '';

    try {
        if (!db.isOpen()) await db.open();

        adminState.allQuestions      = await db.preguntas.toArray();
        adminState.filteredQuestions = [...adminState.allQuestions];
        adminState.currentOffset     = 0;

        if (countEl) countEl.textContent = `${adminState.allQuestions.length} preguntas`;
        container.innerHTML = '';

        // Delegación de clics — solo se registra una vez
        if (!container.dataset.hooked) {
            container.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-edit');
                if (btn) abrirEditorCompleto(parseInt(btn.dataset.id));
            });
            container.dataset.hooked = 'true';
        }

        renderMoreQuestions();
        setupSearchListener();
        setupScrollTop();

    } catch (err) {
        console.error('Admin: error al cargar datos —', err);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-title">Error al cargar</div>
                <div class="empty-sub">Recarga la app e inténtalo de nuevo</div>
            </div>`;
    }
}

// ── FAB scroll-to-top ────────────────────────────────────────
function setupScrollTop() {
    let btn = document.getElementById('scroll-top-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'scroll-top-btn';
        btn.innerHTML = '↑';
        btn.setAttribute('aria-label', 'Volver al inicio de la lista');
        document.body.appendChild(btn);
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // Handler nombrado para poder limpiarlo al salir del admin
    const scrollHandler = () => {
        btn.style.display = window.scrollY > 500 ? 'block' : 'none';
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });
    btn._scrollHandler = scrollHandler;
}

// ── Buscador con debounce ─────────────────────────────────────
function setupSearchListener() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput || searchInput.dataset.hooked) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const query = e.target.value.toLowerCase().trim();

            adminState.filteredQuestions = adminState.allQuestions.filter(q =>
                q.id.toString().includes(query) ||
                q.pregunta.toLowerCase().includes(query)
            );

            const countEl = document.getElementById('search-count');
            if (countEl) countEl.textContent = `${adminState.filteredQuestions.length} preguntas`;

            const container = document.getElementById('questions-list-container');
            if (container) container.innerHTML = '';
            adminState.currentOffset = 0;
            renderMoreQuestions();
        }, 180);
    });

    searchInput.dataset.hooked = 'true';
}

// ── Renderizado por lotes (infinite scroll) ──────────────────
function renderMoreQuestions() {
    const container = document.getElementById('questions-list-container');
    if (!container) return;

    document.getElementById('sentinel')?.remove();

    const batch = adminState.filteredQuestions.slice(
        adminState.currentOffset,
        adminState.currentOffset + adminState.PAGE_SIZE
    );

    const fragment = document.createDocumentFragment();

    batch.forEach(q => {
        const letra       = q.temario?.toLowerCase().startsWith('e') ? 'E' : 'C';
        const code        = `${q.numero_temario || 'S/N'}-${letra}`;
        const sinRespuesta = q.correcta === null || q.correcta === undefined;

        const div = document.createElement('div');
        div.className = 'q-admin-card';
        div.innerHTML = `
            <div class="q-admin-header">
                <span class="q-code">${code}</span>
                ${sinRespuesta ? '<span class="badge-no-answer">Sin respuesta</span>' : ''}
                <button class="btn-edit" data-id="${q.id}">Editar</button>
            </div>
            <div class="q-admin-text"></div>
        `;
        div.querySelector('.q-admin-text').textContent = q.pregunta;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
    adminState.currentOffset += adminState.PAGE_SIZE;

    if (adminState.currentOffset < adminState.filteredQuestions.length) {
        const sentinel = document.createElement('div');
        sentinel.id = 'sentinel';
        sentinel.style.height = '20px';
        container.appendChild(sentinel);
        setupInfiniteScroll(sentinel);
    }
}

function setupInfiniteScroll(target) {
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            observer.disconnect();
            renderMoreQuestions();
        }
    }, { rootMargin: '200px' });

    observer.observe(target);
}

// ── Editor de pregunta ───────────────────────────────────────
async function abrirEditorCompleto(id) {
    const q = await db.preguntas.get(id);
    if (!q) return;

    document.getElementById('edit-text').value = q.pregunta;

    const optsContainer = document.getElementById('edit-options-list');
    optsContainer.innerHTML = '';

    // Label
    const label = document.createElement('label');
    label.className = 'edit-label';
    label.style.cssText = 'display:block; margin-bottom:10px;';
    label.textContent = 'OPCIONES (marca la correcta — opcional)';
    optsContainer.appendChild(label);

    // Opciones A–D
    q.opciones.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'edit-option-row';

        const radio = document.createElement('input');
        radio.type    = 'radio';
        radio.name    = 'correcta';
        radio.value   = i;
        radio.checked = (q.correcta === i);
        radio.style.marginTop = '5px';

        const ta = document.createElement('textarea');
        ta.className = 'edit-opt-input edit-opt-textarea';
        ta.rows      = 2;
        ta.value     = opt; // textContent — nunca innerHTML, evita XSS

        ta.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = `${this.scrollHeight}px`;
        });
        setTimeout(() => { ta.style.height = `${ta.scrollHeight}px`; }, 10);

        div.appendChild(radio);
        div.appendChild(ta);
        optsContainer.appendChild(div);
    });

    // Opción "ninguna respuesta correcta"
    const noneDiv = document.createElement('div');
    noneDiv.className = 'edit-option-row';
    if (q.correcta === null || q.correcta === undefined) {
        noneDiv.style.borderColor = 'var(--wrong)';
    }

    const noneRadio = document.createElement('input');
    noneRadio.type    = 'radio';
    noneRadio.name    = 'correcta';
    noneRadio.value   = 'none';
    noneRadio.checked = (q.correcta === null || q.correcta === undefined);
    noneRadio.style.cssText = 'margin-top:2px; flex-shrink:0;';

    const noneLabel = document.createElement('span');
    noneLabel.style.cssText = 'font-size:14px; color:var(--muted); align-self:center;';
    noneLabel.textContent = '❌ Ninguna respuesta es correcta';

    noneDiv.appendChild(noneRadio);
    noneDiv.appendChild(noneLabel);
    optsContainer.appendChild(noneDiv);

    document.getElementById('save-edit').onclick   = () => guardarCambios(id);
    document.getElementById('cancel-edit').onclick = () => showScreen('admin-list');

    showScreen('edit-screen');
}

async function guardarCambios(id) {
    const nuevoTexto    = document.getElementById('edit-text').value.trim();
    const optsContainer = document.getElementById('edit-options-list');

    const nuevasOpciones = Array.from(
        optsContainer.querySelectorAll('.edit-opt-input')
    ).map(input => input.value);

    const checkedRadio  = optsContainer.querySelector('input[name="correcta"]:checked');
    const nuevaCorrecta = (!checkedRadio || checkedRadio.value === 'none')
        ? null
        : parseInt(checkedRadio.value);

    await db.preguntas.update(id, {
        pregunta: nuevoTexto,
        opciones: nuevasOpciones,
        correcta: nuevaCorrecta
    });

    homeDirty = true;
    await initAdminList();
    showScreen('admin-list');
    showToast(nuevaCorrecta === null
        ? 'Guardada sin respuesta correcta ✓'
        : 'Pregunta actualizada ✓');
}