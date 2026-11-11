// Respuestas del bloque específico (preguntas 1–500).
// A=0, B=1, C=2, D=3. Cada fila contiene 10 respuestas consecutivas.
const SPECIFIC_ANSWER_ROWS = `
CBAACBACBD
CBADCCCBAB
CABBCCACBD
CCCDAADCBA
CBCBCBBBAB
CBBD CDBCDB
BABDACCCDD
DBADDCAADB
DABACBBBAB
ACABCDBABC
ACBACBCDAB
CABDBDDABB
CCCCBABABB
BBBCBCABBC
BBABABDDAD
BBCCCAABBB
CBBAAACABC
BBDBDBCBAC
ADDCBDCABB
DCBACDCDBB
BAACCDDDCC
BCABACBBBD
ACBDCDDBAC
CBCCDABBCC
DCDCADBACC
ACBCBDCBBA
CDBABDDADC
ABBBBDCADA
ACBCBBADAD
DCABBDDBAD
BACBAABABB
BCABABDACB
ADDBCDACDC
BBACBBDCBD
ACCDABAAAC
ABCCCBDCAC
ACCABCACBC
CBBCBCCBBB
BCBCDACABC
DBBCCCBABB
BCBCDDCBBD
CCBCBBCCCB
ABBCCDBDAC
DBADCABDAB
DABCCDABDC
ACBCACADCA
CBBBABCBBB
CBCBBBDCCB
BBCCDBBCBA
ACBBBBBBCC
`;

const SPECIFIC_ANSWERS = Object.freeze(
    SPECIFIC_ANSWER_ROWS.replace(/\s/g, '').split('').map(letter => ({
        A: 0, B: 1, C: 2, D: 3
    })[letter])
);

if (SPECIFIC_ANSWERS.length !== 500 || SPECIFIC_ANSWERS.some(answer => answer === undefined)) {
    throw new Error('Las respuestas del bloque específico deben contener exactamente 500 letras A–D.');
}

// Actualiza tanto el banco inicial como la base de datos local existente,
// conservando el resto de datos (estadísticas, preguntas comunes y casos).
async function applySpecificAnswers() {
    const apply = question => {
        if (question.temario === 'específico' && question.numero_temario >= 1 && question.numero_temario <= 500) {
            question.correcta = SPECIFIC_ANSWERS[question.numero_temario - 1];
            question.sugerida = false;
            question.confianza = null;
            question.justificacion = '';
        }
        return question;
    };

    if (typeof DEFAULT_QUESTIONS !== 'undefined') DEFAULT_QUESTIONS.forEach(cleanAsnwer);

    const questions = await db.preguntas.where('temario').equals('específico').toArray();
    const updates = questions
        .filter(question => question.numero_temario >= 1 && question.numero_temario <= 500)
        .map(question => ({
            key: question.id,
            changes: { 
                correcta: SPECIFIC_ANSWERS[question.numero_temario - 1],
                sugerida: false,
                confianza: null,
                justificacion: ''
            }
        }));

    if (updates.length) await db.preguntas.bulkUpdate(updates);
    console.info(`Respuestas del bloque específico aplicadas: ${updates.length}/500 preguntas encontradas.`);
}
