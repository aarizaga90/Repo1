let currentOffset = 0;
const limit = 20; // Cargamos de 20 en 20
let allQuestions = []; // Aquí guardaremos el resultado del filtro

async function initAdminList() {
    // 1. Limpiar contenedor y mostrar skeletons
    const container = document.getElementById('questions-list-container');
    container.innerHTML = '<div class="skeleton"></div>'.repeat(5);
    
    // 2. Obtener datos de Dexie (solo IDs y texto para ir rápido)
    allQuestions = await db.preguntas.toArray();
    
    // 3. Renderizar los primeros 20
    container.innerHTML = '';
    renderMoreQuestions();
    
    // 4. Configurar el observador del final de página
    setupInfiniteScroll();
}

function renderMoreQuestions() {
    const container = document.getElementById('questions-list-container');
    const fragment = document.createDocumentFragment();
    
    const nextBatch = allQuestions.slice(currentOffset, currentOffset + limit);
    
    nextBatch.forEach(q => {
        const div = document.createElement('div');
        div.className = 'q-admin-card';
        div.innerHTML = `
            <div class="q-admin-header">Pregunta #${q.id}</div>
            <div class="q-admin-text">${q.pregunta}</div>
            <button class="btn-edit" onclick="abrirEdicionCompleta(${q.id})">Editar Todo</button>
        `;
        fragment.appendChild(div);
    });
    
    container.appendChild(fragment);
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
