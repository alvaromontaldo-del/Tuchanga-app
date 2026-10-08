import { useEffect, useRef, useState } from 'react';
import { TERMS_VERSION } from '../../constants/terms';
import { useAuth } from '../../context/AuthContext';
import {
  acceptCurrentTerms,
  dismissedKeyAfterAccept,
  readMyTermsAcceptance,
  termsPromptRequired,
  termsSessionKey,
} from '../../services/termsAcceptance';
import { TermsAndConditionsModal } from './TermsAndConditionsModal';

/**
 * Usuarios ya registrados que no aceptaron esta versión.
 * El cartel vive en la raíz: cambiar de rol no lo desmonta ni lo vuelve a abrir.
 * Si la tabla todavía no está, no se muestra. Si ya se aceptó en esta sesión, una
 * lectura que llegue tarde no lo reabre.
 */
export function TermsAcceptanceGate() {
  const { isAuthed, isRestoring, user } = useAuth();
  const [required, setRequired] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthed || isRestoring || !user?.id) {
      setRequired(false);
      setAccepting(false);
      setError(null);
      return;
    }

    const sessionKey = termsSessionKey(user.id, TERMS_VERSION);
    if (dismissedKey.current === sessionKey) {
      setRequired(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const read = await readMyTermsAcceptance();
      if (cancelled || dismissedKey.current === sessionKey) return;
      setRequired(
        termsPromptRequired({
          authed: true,
          sessionKey,
          dismissedKey: dismissedKey.current,
          backendUnavailable: read.status === 'unavailable',
          readFailed: read.status === 'failed',
          row: read.status === 'ok' ? read.row : null,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, isRestoring, user?.id]);

  if (!required || !user?.id) return null;

  const sessionKey = termsSessionKey(user.id, TERMS_VERSION);

  return (
    <TermsAndConditionsModal
      visible
      mode="accept"
      accepting={accepting}
      acceptError={error}
      onAccept={() => {
        if (accepting) return;
        setAccepting(true);
        setError(null);
        void (async () => {
          const result = await acceptCurrentTerms();
          setAccepting(false);
          const nextDismissed = dismissedKeyAfterAccept(result, sessionKey, dismissedKey.current);
          if (nextDismissed === sessionKey) {
            dismissedKey.current = nextDismissed;
            setRequired(false);
            return;
          }
          setError('No se pudo guardar la aceptación. Probá de nuevo.');
        })();
      }}
    />
  );
}
