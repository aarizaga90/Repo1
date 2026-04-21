const db = new Dexie('OposTest');

// VERSION 1: El pasado (como estaba antes)
db.version(1).stores({
    preguntas: 'id',
    stats: 'id'
});

// VERSION 2: El cambio controlado
// Al definir una versión superior, Dexie intenta migrar.
// Si el cambio de clave primaria falla, usamos 'upgrade' para limpiar.
db.version(2).stores({
    preguntas: '++id, temario, numero_temario',
    stats: 'id'
}).upgrade(async tx => {
    // Este código solo se ejecuta UNA VEZ al pasar de v1 a v2
    console.log("Migrando base de datos a v2...");
    // Si la estructura de la clave primaria cambia y da error, 
    // a veces es necesario limpiar la tabla en el proceso
    return tx.table("preguntas").clear();
});

db.open().catch("UpgradeError", async err => {
    // Si incluso con el upgrade falla (porque IndexedDB bloquea el cambio de PK)
    // Forzamos el borrado y reinicio automático para el usuario
    console.error("Cambio de clave primaria no soportado. Reiniciando esquema...");
    await db.delete();
    location.reload();
});