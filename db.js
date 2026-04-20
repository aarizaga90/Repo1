const db = new Dexie('OposTest');
db.version(1).stores({
    preguntas: 'id',
    stats: 'id'
});