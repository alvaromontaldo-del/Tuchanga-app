import { useEffect, useState } from 'react';
import { TermsAndConditionsModal } from './TermsAndConditionsModal';
import { useAuth } from '../../context/AuthContext';
import { acceptCurrentTerms, termsAcceptanceRequired } from '../../services/termsAcceptance';

/**
 * Usuarios ya registrados que nunca aceptaron, o que aceptaron una versión anterior.
 * Si faltan columnas o el RPC, no bloquea.
 */
export function TermsAcceptanceGate() {
  const { isAuthed, isRestoring, user } = useAuth();
  const [required, setRequired] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed || isRestoring || !user?.id) {
      setRequired(false);
      setAccepting(false);
      setError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const mustAccept = await termsAcceptanceRequired();
      if (!cancelled) setRequired(mustAccept);
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, isRestoring, user?.id]);

  if (!required) return null;

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
          if (result === 'saved' || result === 'unavailable') {
            setRequired(false);
            return;
          }
          setError('No se pudo guardar la aceptación. Probá de nuevo.');
        })();
      }}
    />
  );
}
