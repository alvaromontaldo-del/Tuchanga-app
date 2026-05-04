-- #19/#XX: Hasta 5 fotos por oficio + read receipts tipo WhatsApp.

-- ---------------------------------------------------------------------------
-- Jobs: múltiples fotos por oficio
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Backfill desde foto_url legacy (si existía).
UPDATE public.jobs
SET photo_urls = CASE
  WHEN foto_url IS NOT NULL AND trim(foto_url) <> '' THEN ARRAY[foto_url]
  ELSE '{}'::text[]
END
WHERE (photo_urls IS NULL OR array_length(photo_urls, 1) IS NULL);

-- ---------------------------------------------------------------------------
-- Read receipts: conversación leída por usuario (para badge + visto)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_reads_user ON public.conversation_reads (user_id);
CREATE INDEX IF NOT EXISTS idx_conv_reads_conv ON public.conversation_reads (conversation_id);

ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

-- Participante puede ver reads del hilo (necesario para “visto”)
DROP POLICY IF EXISTS "conv_reads_select_participant" ON public.conversation_reads;
CREATE POLICY "conv_reads_select_participant" ON public.conversation_reads
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.cliente_id = auth.uid() OR c.trabajador_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "conv_reads_upsert_own" ON public.conversation_reads;
CREATE POLICY "conv_reads_upsert_own" ON public.conversation_reads
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "conv_reads_update_own" ON public.conversation_reads;
CREATE POLICY "conv_reads_update_own" ON public.conversation_reads
FOR UPDATE TO authenticated
USING (user_id = auth.uid());

