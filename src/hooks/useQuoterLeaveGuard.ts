import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

type QuoterNavigation = {
  addListener: (event: 'beforeRemove', callback: (e: any) => void) => () => void;
  dispatch: (action: any) => void;
  goBack: () => void;
};

/**
 * Pop-up si el cotizador está sucio.
 * El atrás de Android lo toma BackHandler; el del header y el gesto, beforeRemove.
 */
export function useQuoterLeaveGuard(
  navigation: QuoterNavigation,
  isDirty: () => boolean,
  isBusy: () => boolean,
) {
  const [visible, setVisible] = useState(false);
  const focused = useIsFocused();
  const pending = useRef<unknown>(null);
  const allow = useRef(false);
  const visibleRef = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const dirtyRef = useRef(isDirty);
  const busyRef = useRef(isBusy);
  dirtyRef.current = isDirty;
  busyRef.current = isBusy;
  visibleRef.current = visible;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!focusedRef.current || allow.current) return false;
      if (visibleRef.current) return true;
      if (busyRef.current() || !dirtyRef.current()) return false;
      pending.current = null;
      setVisible(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (allow.current || busyRef.current() || !dirtyRef.current()) return;
      e.preventDefault();
      if (visibleRef.current) return;
      pending.current = e?.data?.action ?? null;
      setVisible(true);
    });
  }, [navigation]);

  function stay() {
    pending.current = null;
    setVisible(false);
  }

  function leave() {
    const action = pending.current;
    pending.current = null;
    setVisible(false);
    allow.current = true;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
    allow.current = false;
  }

  return { visible, stay, leave };
}
