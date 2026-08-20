-- Permite al usuario ver bloqueos donde él es el bloqueado (para deshabilitar el chat en la UI).

DROP POLICY IF EXISTS user_blocks_select_peer ON public.user_blocks;
CREATE POLICY user_blocks_select_peer
ON public.user_blocks
FOR SELECT
TO authenticated
USING (blocked_id = auth.uid());
