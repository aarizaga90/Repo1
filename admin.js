let currentOffset = 0;
const limit = 20;
let allQuestions = [];
let filteredQuestions = []; // Nueva variable para manejar los filtros

// Esta función se llama al pulsar el botón de gestión
async function initAdminList() {
    const container = document.getElementById('questions-list-container');
    const countEl = document.getElementById('search-count');
    const searchInput = document.getElementById('search-input');
    
    if (!container) return;

    // 1. Limpiar todo y mostrar carga
    container.innerHTML = '<div class="skeleton"></div>'.repeat(5);
    if (searchInput) searchInput.value = ''; // Limpiar buscador al entrar

    try {
        if (!db.isOpen()) await db.open();
        
        // 2. Cargar todas las preguntas en memoria
        allQuestions = await db.preguntas.toArray();
        filteredQuestions = [...allQuestions]; // Al principio, el filtro son todas
        
        // 3. Resetear scroll y pintar
        countEl.textContent = '${allQuestions.lenght} preguntas';

        container.innerHTML = '';
        currentOffset = 0;

        // Escuchador de clics (Delegación)
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-edit');
            if (btn) {
                const id = parseInt(btn.dataset.id);
                abrirEditorCompleto(id);
            }
        });

        renderMoreQuestions();
        setupSearchListener();
        setupScrollTop();
        
    } catch (err) {
        console.error("Error en admin:", err);
        container.innerHTML = `<p style="color:white">Error al cargar datos.</p>`;
    }
}

//saca el botón de navegación al top
function setupScrollTop() {
    let btn = document.getElementById('scroll-top-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'scroll-top-btn';
        btn.innerHTML = '↑';
        document.body.appendChild(btn);
        btn.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
    }

    window.onscroll = () => {
        if (window.scrollY > 500) btn.style.display = 'block';
        else btn.style.display = 'none';
    };
}

// Escucha el teclado en tiempo real
function setupSearchListener() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput || searchInput.dataset.hooked) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        // Filtrar el array global
        filteredQuestions = allQuestions.filter(q => 
            q.id.toString().includes(query) || 
            q.pregunta.toLowerCase().includes(query)
        );

        // Actualizar contador visual
        const countEl = document.getElementById('search-count');
        if (countEl) countEl.textContent = `${filteredQuestions.length} preguntas`;

        // Reiniciar la lista visual
        const container = document.getElementById('questions-list-container');
        container.innerHTML = '';
        currentOffset = 0;
        renderMoreQuestions();
    });

    searchInput.dataset.hooked = "true"; // Marcamos para no duplicar el evento
}

// Pinta el siguiente bloque de preguntas (del array filtrado)
function renderMoreQuestions() {
    const container = document.getElementById('questions-list-container');
    if (!container) return;

    const oldSentinel = document.getElementById('sentinel');
    if(oldSentinel) oldSentinel.remove();

    const nextBatch = filteredQuestions.slice(currentOffset, currentOffset + limit);
    
    const fragment = document.createDocumentFragment();
    nextBatch.forEach(q => {
        const div = document.createElement('div');
        div.className = 'q-admin-card';
        div.innerHTML = `
            <div class="q-admin-header">
                <span class="q-code">${code}</span>
            </div>
            <div class="q-admin-text">${q.pregunta}</div>
            <button class="btn-edit" data-id="${q.id}">Editar</button>
        `;
        fragment.appendChild(div);
        div.querySelector('.btn-edit').addEventListener('click', () => {
            abrirEditorCompleto(q.Id)
        });
    });
    
    container.appendChild(fragment);
    currentOffset += limit;
    
    if (currentOffset < filteredQuestions.length)
{
    const sentinel = document.createElement('div');
    sentinel.id = 'sentinel';
sentinel.style.height = '20px';
container.appendChild(sentinel);
setupInfiniteScroll(sentinel);
}
}

function setupInfiniteScroll(target) {
const observer = new
IntersectionObserver((entries) => {
if (entries[0].isIntersecting) {
observer.disconnect();
//Dejamos de observar este centinela 
renderMoreQuestions();
}
}, { rootMargin: '200px' }); 
// Carga 200px antes de llegar al final para que sea fluido
observer. observe(target);
}

async function abrirEditorCompleto(id) {
    const q = await db.preguntas.get(id);
    if (!q) return;

    document.getElementById('edit-text').value = q.pregunta;
    const optsContainer = document.getElementById('edit-options-list');
    optsContainer.innerHTML = '<label style="color:var(--muted); font-size:12px;">OPCIONES (Marca la correcta)</label>';

    q.opciones.forEach((opt, i) => {
        const div = document.createElement('div');
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.gap = "10px";
        div.style.marginTop = "10px";
        
        div.innerHTML = `
            <input type="radio" name="correcta" value="${i}" ${q.correcta === i ? 'checked' : ''}>
            <input type="text" class="edit-opt-input" value="${opt}" style="flex:1; background:var(--surface2); color:white; border:1px solid var(--border); border-radius:8px; padding:8px;">
        `;
        optsContainer.appendChild(div);
    });

    // Guardar el ID en el botón de guardar para saber cuál actualizar
    document.getElementById('save-edit').onclick = () => guardarCambios(id);
    document.getElementById('cancel-edit').onclick = () => showScreen('admin-list');

    showScreen('edit-screen');
}

async function guardarCambios(id) {
    const nuevoTexto = document.getElementById('edit-text').value;
    const nuevasOpciones = Array.from(document.querySelectorAll('.edit-opt-input')).map(input => input.value);
    const nuevaCorrecta = parseInt(document.querySelector('input[name="correcta"]:checked').value);

    await db.preguntas.update(id, {
        pregunta: nuevoTexto,
        opciones: nuevasOpciones,
        correcta: nuevaCorrecta
    });

    alert("¡Pregunta actualizada!");
    initAdminList(); // Refresca la lista
    showScreen('admin-list');
}
