import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import {
  quoterLeaveIosBackAction,
  quoterLeaveIosGestureEnabled,
  quoterLeavePreventRemove,
} from '../utils/quoterLeaveGuard';

type QuoterNavigation = {
  addListener: (event: 'beforeRemove', callback: (e: any) => void) => () => void;
  dispatch: (action: any) => void;
  goBack: () => void;
  setOptions?: (options: { gestureEnabled?: boolean }) => void;
};

type QuoterLeaveOptions = {
  /** iOS: pageSheet abierto. El gesto del stack no puede llevarse la pantalla de abajo. */
  iosBlockGesture?: boolean;
  /** iOS: cerrar ese sheet en lugar de sacar la pantalla. */
  onIosBlocked?: () => void;
};

/**
 * Pop-up si el cotizador está sucio.
 * Android: BackHandler + beforeRemove, igual que antes.
 * iOS: el swipe nativo saca la pantalla antes de que preventDefault alcance,
 * y el chat de abajo queda sin poder navegar. usePreventRemove lo frena en
 * nativo y el Modal se cierra antes del pop.
 */
export function useQuoterLeaveGuard(
  navigation: QuoterNavigation,
  isDirty: () => boolean,
  isBusy: () => boolean,
  options?: QuoterLeaveOptions,
) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
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
  const iosBlockRef = useRef(false);
  const onIosBlockedRef = useRef<(() => void) | undefined>(undefined);
  iosBlockRef.current = Boolean(options?.iosBlockGesture);
  onIosBlockedRef.current = options?.onIosBlocked;
  const iosActionRef = useRef<unknown>(null);
  const awaitingDismiss = useRef(false);
  const popScheduled = useRef(false);
  const iosFallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preventIos = quoterLeavePreventRemove({
    platform: Platform.OS,
    dirty: isDirty(),
    busy: isBusy(),
    leaving,
    blockGesture: iosBlockRef.current,
  });

  const beginIosPop = useCallback(() => {
    if (popScheduled.current) return;
    popScheduled.current = true;
    setLeaving(true);
  }, []);

  usePreventRemove(preventIos, ({ data }) => {
    if (allow.current || popScheduled.current) return;
    const decision = quoterLeaveIosBackAction({
      pickerOpen: iosBlockRef.current,
      dirty: dirtyRef.current(),
      busy: busyRef.current(),
    });
    if (decision === 'close-picker') {
      onIosBlockedRef.current?.();
      return;
    }
    if (decision !== 'ask' || visibleRef.current) return;
    const action = data?.action ?? null;
    pending.current = action;
    iosActionRef.current = action;
    setVisible(true);
  });

  useEffect(() => {
    if (Platform.OS !== 'ios' || !navigation.setOptions) return;
    navigation.setOptions({
      gestureEnabled: quoterLeaveIosGestureEnabled(preventIos),
    });
  }, [navigation, preventIos]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Platform.OS === 'ios') return false;
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
    if (Platform.OS === 'ios') return;
    return navigation.addListener('beforeRemove', (e) => {
      if (allow.current || busyRef.current() || !dirtyRef.current()) return;
      e.preventDefault();
      if (visibleRef.current) return;
      pending.current = e?.data?.action ?? null;
      setVisible(true);
    });
  }, [navigation]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !leaving) return;
    const timer = setTimeout(() => {
      const action = iosActionRef.current;
      iosActionRef.current = null;
      allow.current = true;
      if (action) navigation.dispatch(action);
      else navigation.goBack();
    }, 50);
    return () => clearTimeout(timer);
  }, [leaving, navigation]);

  useEffect(() => {
    return () => {
      if (iosFallback.current) clearTimeout(iosFallback.current);
    };
  }, []);

  const stay = useCallback(() => {
    pending.current = null;
    iosActionRef.current = null;
    awaitingDismiss.current = false;
    if (iosFallback.current) clearTimeout(iosFallback.current);
    setVisible(false);
  }, []);

  const leave = useCallback(() => {
    const action = pending.current;
    pending.current = null;
    if (Platform.OS !== 'ios') {
      setVisible(false);
      allow.current = true;
      if (action) navigation.dispatch(action);
      else navigation.goBack();
      allow.current = false;
      return;
    }
    iosActionRef.current = action;
    awaitingDismiss.current = true;
    setVisible(false);
    if (iosFallback.current) clearTimeout(iosFallback.current);
    iosFallback.current = setTimeout(() => {
      if (!awaitingDismiss.current) return;
      awaitingDismiss.current = false;
      beginIosPop();
    }, 400);
  }, [beginIosPop, navigation]);

  const onModalDismiss = useCallback(() => {
    if (Platform.OS !== 'ios' || !awaitingDismiss.current) return;
    awaitingDismiss.current = false;
    if (iosFallback.current) clearTimeout(iosFallback.current);
    beginIosPop();
  }, [beginIosPop]);

  const commitLeave = useCallback(() => {
    pending.current = null;
    iosActionRef.current = null;
    if (Platform.OS !== 'ios') {
      allow.current = true;
      navigation.goBack();
      allow.current = false;
      return;
    }
    beginIosPop();
  }, [beginIosPop, navigation]);

  return { visible, stay, leave, commitLeave, onModalDismiss };
}
