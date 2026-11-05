# Parche admin #77 / #214

No pude abrir `https://github.com/alvaromontaldo-del/yachanga-admin`.
Con la credencial de este agente el remoto responde `Repository not found` y `gh repo list` solo ve `Tuchanga-app` y `Yachanga-landing`. No hay PR de admin. Este directorio es el parche para que otro agente lo aplique en ese repo.

No aplicar el SQL desde el admin. La migración está en la app:

`supabase/card_77_214_matriculas_por_oficio.sql`

No mergear. No ejecutar ese archivo en producción salvo el dry-run `BEGIN` … `ROLLBACK`.

## Qué cambiar en «Aprobar matrículas»

Hoy la pantalla llama `admin_list_matriculas_pendientes` y muestra el oficio principal de `jobs`. Eso deja de ser el oficio de la matrícula.

Usar `admin_list_matriculas_revision`. Cada ítem trae:

- `oficio_codigo`: `gas`, `electricidad`, `plomeria`, `fumigacion` o `sin_vincular`
- `oficio`: nombre para mostrar. Si es legado, dice `Sin vínculo demostrable`
- `vinculo`: `oficio` o `sin_evidencia`
- `numero`, `entidad`, `status`
- `fotos[]`: `id`, `status`, `motivo`, `storage_path`
- `archivo_url`: null. El admin arma el link firmado de 10 minutos (`archivo_url_expira_en_segundos` = 600) con el bucket `matriculas`, igual que hoy. La policy `matriculas_select_admin` no cambió.

No asignar `sin_vincular` a gas, electricidad, plomería ni fumigación. Aprobar esa fila solo aprueba el legado.

## Llamadas

| Acción | RPC |
| --- | --- |
| Listar | `admin_list_matriculas_revision()` |
| Aprobar una foto | `admin_aprobar_matricula_foto(p_foto_id)` |
| Rechazar una foto | `admin_rechazar_matricula_foto(p_foto_id, p_motivo)` |
| Aprobar el envío de ese oficio | `admin_aprobar_matricula_oficio(p_user_id, p_oficio)` |
| Rechazar el envío de ese oficio | `admin_rechazar_matricula_oficio(p_user_id, p_oficio, p_motivo)` |

`p_oficio` acepta también `sin_vincular`. Rechazar un envío marca las fotos de ese oficio y dispara el mismo push `notify_matricula_rechazo` → `push_on_matricula`. No toca otros oficios.

`admin_list_matriculas_pendientes`, `admin_aprobar_matricula(uuid)` y `admin_rechazar_matricula(uuid, text)` siguen existiendo y solo ven el legado, para la pantalla vieja durante el despliegue. La pantalla nueva no debería usarlas: aprobar por `user_id` no elige el oficio.

La revisión de antecedentes no cambia: `admin_list_antecedentes_pendientes`, `admin_aprobar_antecedentes_penales`, `admin_rechazar_antecedentes_penales`.

## Archivos

Copiar al admin, ajustando el import del cliente Supabase:

- `matriculasRevision.ts`
- `MatriculasRevisionPanel.tsx`

Montar el panel en la ruta actual de «Aprobar matrículas». No hace falta otra pantalla.

El panel no pide vencimientos ni muestra el archivo al cliente final. El link firmado queda en el navegador del admin.
