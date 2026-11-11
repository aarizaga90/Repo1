// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
async function boot() {
    const pregCount = await db.preguntas.count();
    if (pregCount === 0 && typeof DEFAULT_QUESTIONS !== 'undefined' && DEFAULT_QUESTIONS.length > 0) {
        await db.preguntas.bulkPut(DEFAULT_QUESTIONS);
    }
    if (typeof applySpecificAnswers === 'function') await applySpecificAnswers();
    await refreshHome();
    await showAppVersion();
    initServiceWorker();
}