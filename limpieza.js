const { createClient } = require('@supabase/supabase-js');

// 1. CONFIGURACIÓN (Usa tus claves aquí)
const SUPABASE_URL = 'https://kyehrxcdealbujvvnxp.supabase.co';
const SERVICE_KEY = 'TU_SERVICE_ROLE_KEY_AQUI'; // ¡USA LA SERVICE_ROLE, NO LA ANON!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BUCKET = 'job-photos';
const LIMIT_SIZE = 512000; // 500KB

async function limpiarTodo() {
    console.log("🚀 Iniciando limpieza profunda...");

    // A. LISTAR ARCHIVOS GRANDES
    const { data: files, error: listError } = await supabase.storage.from(BUCKET).list('', {
        limit: 100,
        sortBy: { column: 'name', order: 'desc' }
    });

    if (listError) {
        console.error("❌ Error al listar:", listError);
        return;
    }

    // Filtrar por tamaño (Supabase list no filtra por tamaño en el servidor, lo hacemos acá)
    const heavyFiles = files.filter(f => f.metadata && f.metadata.size > LIMIT_SIZE);

    if (heavyFiles.length === 0) {
        console.log("✅ No se encontraron archivos de más de 500KB.");
        return;
    }

    console.log(`📂 Encontrados ${heavyFiles.length} archivos pesados.`);

    const pathsToDelete = heavyFiles.map(f => f.name);

    // B. BORRAR EN STORAGE
    const { data: deletedFiles, error: deleteError } = await supabase.storage
        .from(BUCKET)
        .remove(pathsToDelete);

    if (deleteError) {
        console.error("❌ Error al borrar archivos:", deleteError);
    } else {
        console.log(`🗑️ Archivos borrados del Storage: ${deletedFiles.length}`);
    }

    // C. LIMPIAR LA BASE DE DATOS (Opcional pero recomendado)
    // Cambia 'jobs' por tu tabla y 'image_url' por tu columna
    /*
    const { error: dbError } = await supabase
        .from('jobs')
        .update({ image_url: null }) 
        .in('image_url', pathsToDelete.map(p => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`));
    
    if (dbError) console.error("❌ Error al limpiar base de datos:", dbError);
    */
}

limpiarTodo();