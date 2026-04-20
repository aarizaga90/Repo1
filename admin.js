let currentOffset = 0;
const limit = 20; // Cargamos de 20 en 20
let allQuestions = []; // Aquí guardaremos el resultado del filtro

async function initAdminList() {
    // 1. Limpiar contenedor y mostrar skeletons
    const container = document.getElementById('questions-list-container');
    if(!container) return;

    container.innerHTML = '<div class="skeleton"></div>'.repeat(5);
    
    // 2. Obtener datos de Dexie (solo IDs y texto para ir rápido)
    try
    {
        if (!db.isOpen()) await db.Open();

    allQuestions = await db.preguntas.toArray();
    
    // 3. Renderizar los primeros 20
    container.innerHTML = '';
    currentOffset = 0;
    renderMoreQuestions();
    
    // 4. Configurar el observador del final de página
    if(!document.getElementById('sentinel'))
    {setupInfiniteScroll();}
} catch (err) {
    console.error("Error en admin:", err);
    container.innerHTML = '<p style="color:white">Error al cargar datos.</p>';
}
}

function renderMoreQuestions() {
    const fragment = document.createDocumentFragment();
    const container = document.getElementById('questions-list-container');
    
    const nextBatch = allQuestions.slice(currentOffset, currentOffset + limit);
    
    nextBatch.forEach(q => {
        const div = document.createElement('div');
        div.className = 'q-admin-card';
        div.innerHTML = `
            <div class="q-admin-header">Pregunta #${q.id}</div>
            <div class="q-admin-text">${q.pregunta}</div>
            <button class="btn-edit" onclick="abrirEdicionCompleta(${q.id})">Editar Todo</button>
        `;
        container.appendChild(div);
    });

    currentOffset += limit;
}

function setupInfiniteScroll() {
    // Creamos un div invisible al final de la lista
    const sentinel = document.createElement('div');
    sentinel.id = 'sentinel';
    document.getElementById('questions-list-container').appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && currentOffset < allQuestions.length) {
            renderMoreQuestions();
            // Movemos el centinela al final de nuevo
            document.getElementById('questions-list-container').appendChild(sentinel);
        }
    }, { threshold: 1.0 });

    observer.observe(sentinel);
}
