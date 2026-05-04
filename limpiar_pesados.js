const { createClient } = require('@supabase/supabase-js');

// Configuración
const SUPABASE_URL = 'https://kyehrxcdealbujvvnxp.supabase.co/';
// IMPORTANTE: Pegá acá tu SERVICE_ROLE_KEY (la larga que empieza con eyJ...)
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5eGVocnhjZGVhbGJ1anZ2bnhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3OTY5MSwiZXhwIjoyMDkxMjU1NjkxfQ.Qtu1JprRA2GsbUA01_4dCHIKyWeE9kNlOg6Q1CapMpQ'; 

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BUCKET = 'job-photos';

async function ejecutarLimpieza() {
  console.log("🔍 Buscando archivos mayores a 500KB...");

  // 1. Listar archivos del bucket
  const { data: files, error: listError } = await supabase.storage.from(BUCKET).list();

  if (listError) {
    console.error("❌ Error al listar archivos:", listError.message);
    return;
  }

  // 2. Filtrar los que pesan más de 500KB (512,000 bytes)
  const pesados = files
    .filter(f => f.metadata && f.metadata.size > 512000)
    .map(f => f.name);

  if (pesados.length === 0) {
    console.log("✅ No hay archivos pesados para borrar.");
    return;
  }

  console.log(`⚠️ Se encontraron ${pesados.length} archivos pesados. Borrando...`);
  console.log(pesados);

  // 3. Borrar
  const { data: borrados, error: deleteError } = await supabase.storage
    .from(BUCKET)
    .remove(pesados);

  if (deleteError) {
    console.error("❌ Error al borrar:", deleteError.message);
  } else {
    console.log("🎉 ¡Limpieza exitosa! Archivos eliminados:", borrados.length);
  }
}

ejecutarLimpieza();