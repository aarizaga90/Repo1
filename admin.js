let currentOffset = 0;
const limit = 20;
let allQuestions = [];
let filteredQuestions = []; // Nueva variable para manejar los filtros

// Esta función se llama al pulsar el botón de gestión
async function initAdminList() {
    const container = document.getElementById('questions-list-container');
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
        container.innerHTML = '';
        currentOffset = 0;
        renderMoreQuestions();
        
        // 4. Activar el buscador (si no estaba ya activado)
        setupSearchListener();
        
    } catch (err) {
        console.error("Error en admin:", err);
        container.innerHTML = `<p style="color:white">Error al cargar datos.</p>`;
    }
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

    const nextBatch = filteredQuestions.slice(currentOffset, currentOffset + limit);
    
    const fragment = document.createDocumentFragment();
    nextBatch.forEach(q => {
        const div = document.createElement('div');
        div.className = 'q-admin-card';
        div.innerHTML = `
            <div class="q-admin-header">#${q.id}</div>
            <div class="q-admin-text">${q.pregunta}</div>
            <button class="btn-edit" onclick="alert('ID: ' + ${q.id})">Editar</button>
        `;
        fragment.appendChild(div);
    });
    
    container.appendChild(fragment);
    currentOffset += limit;
}
