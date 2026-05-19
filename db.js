// ── DEBUG ──────────────────────────────────────────────────
// true en desarrollo, false en producción
const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

// ── BASE DE DATOS ──────────────────────────────────────────
const db = new Dexie('OposTest');

// v1 → v2: clave primaria a autoincrement + índices de temario
db.version(1).stores({
    preguntas: 'id',
    stats: 'id'
});

db.version(2).stores({
    preguntas: '++id, temario, numero_temario',
    stats: 'id'
}).upgrade(async tx => {
    log('DB: migrando a v2...');
    await tx.table('preguntas').clear();
    await tx.table('stats').clear();
});

// VERSION 3: campo dudosa indexado (sin limpiar datos — solo añade el índice)
db.version(3).stores({
    preguntas: '++id, temario, numero_temario, dudosa',
    stats: 'id'
});

db.open()
    .catch('UpgradeError', async () => {
        console.error('DB: esquema incompatible — reiniciando...');
        await db.delete();
        location.reload();
    })
    .catch(err => {
        console.error('DB: error al abrir —', err);
    });