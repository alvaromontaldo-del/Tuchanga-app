import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpandableText } from '../../components/common/ExpandableText';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import {
  aceptarDisponibilidadOpcion,
  aceptarPrecioCotizado,
  aceptarRecotizacion,
  aplicarSeñaConCredito,
  clienteNotificarPagoOffline,
  fetchContratacionById,
  fetchDisponibilidadOpciones,
  obtenerDireccionCliente,
  obtenerPinCliente,
  proponerDisponibilidadOpciones,
  rechazarDisponibilidad,
  rechazarPrecioCotizado,
  rechazarRecotizacion,
  subscribeContratacionById,
  trabajadorConfirmarRecepcionOffline,
  verificarPin,
} from '../../services/contratacionesSupabase';
import {
  computeSaldoPendiente,
  type Contratacion,
  type DisponibilidadOpcion,
} from '../../types/contrataciones';
import {
  formatContratacionEstado,
  formatContratacionEstadoPago,
  puedeNotificarSaldoOffline,
} from '../../utils/contratacionStatus';
import { formatMoneyCeilAr } from '../../utils/formatMoney';

export type DetalleServicioParams = {
  contratacionId: string;
  conversationId?: string;
};

type DetalleRoute = RouteProp<{ DetalleServicio: DetalleServicioParams }, 'DetalleServicio'>;

function toTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

function toDateIso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

type SlotDraft = {
  id: string;
  fecha: Date;
  horaInicio: Date;
  horaFin: Date;
};

function newSlotDraft(): SlotDraft {
  const now = new Date();
  const fin = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fecha: now,
    horaInicio: now,
    horaFin: fin,
  };
}

function parseTimeParts(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':');
  return { hours: Number(h), minutes: Number(m) };
}

function opcionesToSlotDrafts(opciones: DisponibilidadOpcion[]): SlotDraft[] {
  const drafts: SlotDraft[] = [];
  for (const op of opciones ?? []) {
    const fechaRaw = String(op?.fecha_trabajo ?? '');
    const parts = fechaRaw.split('-').map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) continue;
    if (!op?.hora_inicio || !op?.hora_fin) continue;
    const [y, mo, d] = parts;
    const fecha = new Date(y, mo - 1, d);
    if (Number.isNaN(fecha.getTime())) continue;
    const ini = parseTimeParts(op.hora_inicio);
    const fin = parseTimeParts(op.hora_fin);
    if (!Number.isFinite(ini.hours) || !Number.isFinite(fin.hours)) continue;
    const horaInicio = new Date(fecha);
    horaInicio.setHours(ini.hours, ini.minutes, 0, 0);
    const horaFin = new Date(fecha);
    horaFin.setHours(fin.hours, fin.minutes, 0, 0);
    drafts.push({
      id: op.id || `${y}-${mo}-${d}-${ini.hours}`,
      fecha,
      horaInicio,
      horaFin,
    });
  }
  return drafts;
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTimeDisplay(d: Date): string {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function timeToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function validateSlots(slots: SlotDraft[]): string | null {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (timeToMinutes(slot.horaFin) <= timeToMinutes(slot.horaInicio)) {
      return `Opción ${i + 1}: la hora de fin debe ser posterior a la de inicio.`;
    }
  }
  return null;
}

type PickerField = 'fecha' | 'horaInicio' | 'horaFin';

function pickerFieldTitle(field: PickerField): string {
  if (field === 'fecha') return 'Elegir fecha';
  if (field === 'horaInicio') return 'Hora de inicio';
  return 'Hora de fin';
}

type DireccionCliente = {
  direccion_texto: string;
  detalles_ubicacion: string | null;
  lat: number;
  lng: number;
};

function openGoogleMaps(lat: number, lng: number): void {
  const web = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const native =
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}`;
  void Linking.openURL(native).catch(() => {
    void Linking.openURL(web);
  });
}

export function DetalleServicioScreen() {
  const navigation = useNavigation();
  const route = useRoute<DetalleRoute>();
  const { contratacionId, conversationId } = route.params;
  const { user } = useAuth();
  const toast = useAppToast();
  const [row, setRow] = useState<Contratacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pinVisible, setPinVisible] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [direccionData, setDireccionData] = useState<DireccionCliente | null>(null);
  const [slots, setSlots] = useState<SlotDraft[]>(() => [newSlotDraft()]);
  const [opcionesAgenda, setOpcionesAgenda] = useState<DisponibilidadOpcion[]>([]);
  const [picker, setPicker] = useState<{
    slotId: string;
    field: PickerField;
    draft: Date;
  } | null>(null);

  const openPicker = useCallback(
    (slotId: string, field: PickerField) => {
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return;
      const value = field === 'fecha' ? slot.fecha : slot[field];
      setPicker({ slotId, field, draft: new Date(value) });
    },
    [slots],
  );

  const applyPicker = useCallback(
    (date: Date) => {
      if (!picker) return;
      setSlots((prev) =>
        prev.map((s) => {
          if (s.id !== picker.slotId) return s;
          const next = { ...s, [picker.field]: date };
          if (picker.field === 'horaInicio') {
            next.horaFin = new Date(date.getTime() + 60 * 60 * 1000);
          }
          return next;
        }),
      );
      setPicker(null);
    },
    [picker],
  );

  const myRole = useMemo(() => {
    if (!row || !user?.id) return null;
    if (row.client_id === user.id) return 'cliente' as const;
    if (row.worker_id === user.id) return 'trabajador' as const;
    return null;
  }, [row, user?.id]);

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const fmt = (n: number) => `$${currency.format(n)}`;

  const showNotificarPagoOffline = useMemo(() => {
    if (!row || myRole !== 'cliente') return false;
    return puedeNotificarSaldoOffline(row);
  }, [myRole, row]);

  const reload = useCallback(async () => {
    try {
      const data = await fetchContratacionById(contratacionId);
      setRow(data);
      if (data?.estado_trabajo === 'precio_aceptado') {
        const ops = await fetchDisponibilidadOpciones(contratacionId);
        setOpcionesAgenda(ops);
        if (data.worker_id === user?.id) {
          setSlots(ops.length > 0 ? opcionesToSlotDrafts(ops) : [newSlotDraft()]);
        }
      } else {
        setOpcionesAgenda([]);
      }
    } catch {
      /* red o fila incompleta: se mantiene lo ya cargado */
    }
  }, [contratacionId, user?.id]);

  const canShowDireccionTrabajador = Boolean(
    myRole === 'trabajador' &&
      row &&
      row.estado_pago !== 'pendiente_seña' &&
      row.fecha_trabajo &&
      ['aceptado', 'en_curso', 'pendiente_conformidad'].includes(row.estado_trabajo),
  );

  useEffect(() => {
    if (!canShowDireccionTrabajador || !row?.id) {
      setDireccionData(null);
      return;
    }
    let cancelled = false;
    void obtenerDireccionCliente(row.id)
      .then((d) => {
        if (!cancelled) setDireccionData(d);
      })
      .catch(() => {
        if (!cancelled) setDireccionData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canShowDireccionTrabajador, row?.id]);

  useEffect(() => {
    if (
      myRole !== 'cliente' ||
      row?.estado_pago !== 'seña_pagada' ||
      row.estado_trabajo === 'en_curso'
    ) {
      return;
    }
    let cancelled = false;
    void obtenerPinCliente(row.id)
      .then((pin) => {
        if (!cancelled) setPinVisible(pin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [myRole, row?.id, row?.estado_pago, row?.estado_trabajo]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const unsub = subscribeContratacionById(contratacionId, (c) => setRow(c));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [contratacionId, reload]);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured()) return;
      void reload();
    }, [reload]),
  );

  const runAction = async (fn: () => Promise<void>, okMsg?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (okMsg) toast.success(okMsg, 'Servicio');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo completar', 'Servicio');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (!row || !myRole) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.empty}>No se pudo cargar el servicio.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{formatContratacionEstado(row.estado_trabajo)}</Text>
          <Text style={styles.pagoBadge}>
            {row.estado_pago === 'totalmente_pagado'
              ? 'Pagado'
              : formatContratacionEstadoPago(row.estado_pago)}
          </Text>
        </View>

        {row.service_detail?.trim() ? (
          <ExpandableText
            text={row.service_detail.trim()}
            numberOfLinesCollapsed={3}
            textStyle={styles.detail}
          />
        ) : null}

        {myRole === 'trabajador' ? (
          <Text style={styles.priceLine}>
            Neto: <Text style={styles.strong}>{fmt(row.precio_trabajador)}</Text>
          </Text>
        ) : null}
        <Text style={styles.priceLine}>
          Precio final:{' '}
          <Text style={styles.strong}>{formatMoneyCeilAr(row.precio_final)}</Text>
        </Text>
        {myRole === 'cliente' ? (
          <>
            <Text style={styles.priceLine}>
              Costo de servicio de YaChanga:{' '}
              <Text style={styles.strong}>{formatMoneyCeilAr(row.comision_app)}</Text>
            </Text>
            <Text style={styles.priceLine}>
              Saldo pendiente:{' '}
              <Text style={styles.strong}>
                {formatMoneyCeilAr(computeSaldoPendiente(row.precio_final, row.comision_app))}
              </Text>
            </Text>
          </>
        ) : (
          <Text style={styles.priceLine}>
            Costo de servicio de YaChanga:{' '}
            <Text style={styles.strong}>{formatMoneyCeilAr(row.comision_app)}</Text>
          </Text>
        )}

        {row.fecha_trabajo ? (
          <Text style={styles.agendaLine}>
            Agenda: {row.fecha_trabajo.split('-').reverse().join('/')}
            {row.hora_inicio && row.hora_fin
              ? ` · ${String(row.hora_inicio).slice(0, 5)} – ${String(row.hora_fin).slice(0, 5)}`
              : ''}
          </Text>
        ) : null}

        {myRole === 'cliente' && row.estado_trabajo === 'precio_cotizado' ? (
          <View style={styles.actions}>
            <Pressable
              style={[styles.btnGhost, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void runAction(() => rechazarPrecioCotizado(row.id), 'Precio rechazado')}
            >
              <Text style={styles.btnGhostText}>Rechazar precio</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void runAction(() => aceptarPrecioCotizado(row.id), 'Precio aceptado')}
            >
              <Text style={styles.btnPrimaryText}>Aceptar precio</Text>
            </Pressable>
          </View>
        ) : null}

        {myRole === 'trabajador' && row.estado_trabajo === 'precio_aceptado' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {opcionesAgenda.length > 0
                ? 'Opciones enviadas al cliente'
                : 'Proponer disponibilidad (hasta 5)'}
            </Text>
            <Text style={styles.hint}>
              {opcionesAgenda.length > 0
                ? 'Podés agregar, quitar o modificar horarios y volver a enviar.'
                : 'El cliente elegirá una opción o rechazará todas.'}
            </Text>
            {slots.map((slot, index) => (
              <View key={slot.id} style={styles.slotCard}>
                <Text style={styles.slotTitle}>Opción {index + 1}</Text>
                <Pressable
                  style={({ pressed }) => [styles.pickerField, pressed && styles.pressed]}
                  onPress={() => openPicker(slot.id, 'fecha')}
                  accessibilityRole="button"
                  accessibilityLabel={`Fecha opción ${index + 1}`}
                >
                  <View style={styles.pickerFieldIcon}>
                    <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.pickerFieldBody}>
                    <Text style={styles.pickerFieldLabel}>Fecha</Text>
                    <Text style={styles.pickerFieldValue}>{formatDateDisplay(slot.fecha)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.pickerField, pressed && styles.pressed]}
                  onPress={() => openPicker(slot.id, 'horaInicio')}
                  accessibilityRole="button"
                  accessibilityLabel={`Hora de inicio opción ${index + 1}`}
                >
                  <View style={styles.pickerFieldIcon}>
                    <Ionicons name="time-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.pickerFieldBody}>
                    <Text style={styles.pickerFieldLabel}>Desde</Text>
                    <Text style={styles.pickerFieldValue}>{formatTimeDisplay(slot.horaInicio)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.pickerField, pressed && styles.pressed]}
                  onPress={() => openPicker(slot.id, 'horaFin')}
                  accessibilityRole="button"
                  accessibilityLabel={`Hora de fin opción ${index + 1}`}
                >
                  <View style={styles.pickerFieldIcon}>
                    <Ionicons name="time-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.pickerFieldBody}>
                    <Text style={styles.pickerFieldLabel}>Hasta</Text>
                    <Text style={styles.pickerFieldValue}>{formatTimeDisplay(slot.horaFin)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
                {slots.length > 1 ? (
                  <Pressable
                    style={styles.slotRemove}
                    onPress={() => setSlots((prev) => prev.filter((s) => s.id !== slot.id))}
                  >
                    <Text style={styles.slotRemoveText}>Quitar opción</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {slots.length < 5 ? (
              <Pressable
                style={[styles.btnGhost, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={() => setSlots((prev) => [...prev, newSlotDraft()])}
              >
                <Text style={styles.btnGhostText}>+ Agregar otra opción</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.btnPrimary, { marginTop: spacing.sm }, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => {
                const validationError = validateSlots(slots);
                if (validationError) {
                  toast.error(validationError, 'Agenda');
                  return;
                }
                if (busy) return;
                setBusy(true);
                void (async () => {
                  try {
                    await proponerDisponibilidadOpciones(
                      row.id,
                      slots.map((s) => ({
                        fechaTrabajo: toDateIso(s.fecha),
                        horaInicio: toTimeString(s.horaInicio),
                        horaFin: toTimeString(s.horaFin),
                      })),
                    );
                    toast.success(
                      opcionesAgenda.length > 0 ? 'Disponibilidad actualizada' : 'Disponibilidad enviada',
                      'Agenda',
                    );
                    await reload();
                    if (conversationId) {
                      navigation.goBack();
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'No se pudo enviar', 'Agenda');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <Text style={styles.btnPrimaryText}>
                {opcionesAgenda.length > 0 ? 'Reenviar opciones al cliente' : 'Enviar opciones al cliente'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {myRole === 'cliente' && row.estado_trabajo === 'precio_aceptado' && opcionesAgenda.length === 0 ? (
          <Text style={styles.hint}>
            Las opciones de horario aparecen en el chat cuando el profesional las envíe.
          </Text>
        ) : null}

        {myRole === 'trabajador' &&
        row.estado_trabajo === 'aceptado' &&
        row.estado_pago === 'seña_pagada' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Iniciar trabajo (PIN)</Text>
            <TextInput
              value={pinInput}
              onChangeText={(t) => setPinInput(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              placeholder="0000"
              maxLength={4}
              style={styles.pinInput}
            />
            <Pressable
              style={[styles.btnPrimary, busy && styles.btnDisabled]}
              disabled={busy || pinInput.length < 4}
              onPress={() =>
                void runAction(async () => {
                  const ok = await verificarPin(row.id, pinInput);
                  if (!ok) throw new Error('PIN incorrecto');
                  setPinInput('');
                }, 'Trabajo en curso')
              }
            >
              <Text style={styles.btnPrimaryText}>Verificar PIN</Text>
            </Pressable>
          </View>
        ) : null}

        {canShowDireccionTrabajador ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dirección del cliente</Text>
            {direccionData ? (
              <>
                <ExpandableText
                  text={[
                    direccionData.direccion_texto,
                    direccionData.detalles_ubicacion
                      ? `Referencias: ${direccionData.detalles_ubicacion}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                  numberOfLinesCollapsed={3}
                  textStyle={styles.hint}
                />
                <View style={styles.mapRow}>
                  <Pressable
                    style={[styles.btnGhost, styles.mapBtn, busy && styles.btnDisabled]}
                    disabled={busy}
                    onPress={() => openGoogleMaps(direccionData.lat, direccionData.lng)}
                  >
                    <Ionicons name="map-outline" size={18} color={colors.primary} />
                    <Text style={styles.btnGhostText}>Abrir en Google Maps</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.hint}>Cargando dirección…</Text>
            )}
          </View>
        ) : null}

        {row.estado_trabajo === 'pendiente_pago_diferencia' && myRole === 'cliente' ? (
          <View style={styles.actions}>
            <Pressable
              style={[styles.btnGhost, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void runAction(() => rechazarRecotizacion(row.id))}
            >
              <Text style={styles.btnGhostText}>Rechazar recotización</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void runAction(() => aceptarRecotizacion(row.id))}
            >
              <Text style={styles.btnPrimaryText}>Aceptar recotización</Text>
            </Pressable>
          </View>
        ) : null}

        {row.offline_pago_notificado_at && myRole === 'trabajador' && row.estado_pago !== 'totalmente_pagado' ? (
          <Pressable
            style={[styles.btnPrimary, { marginTop: spacing.md }, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => {
              const confirm = () =>
                void runAction(
                  () => trabajadorConfirmarRecepcionOffline(row.id),
                  'Pago offline confirmado',
                );
              if (row.estado_trabajo !== 'finalizado') {
                Alert.alert(
                  '¿Confirmar pago recibido?',
                  'El trabajo aún no está marcado como finalizado. ¿Confirmás que recibiste el pago del saldo?',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Sí, confirmar', onPress: confirm },
                  ],
                );
                return;
              }
              confirm();
            }}
          >
            <Text style={styles.btnPrimaryText}>Confirmar pago recibido</Text>
          </Pressable>
        ) : null}

        {showNotificarPagoOffline ? (
          <Pressable
            style={[styles.btnGhost, { marginTop: spacing.md }, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() =>
              void runAction(() => clienteNotificarPagoOffline(row.id), 'Pago offline notificado')
            }
          >
            <Text style={styles.btnGhostText}>Saldo pagado al profesional</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {picker && Platform.OS === 'android' ? (
        <DateTimePicker
          value={picker.draft}
          mode={picker.field === 'fecha' ? 'date' : 'time'}
          display="default"
          minimumDate={picker.field === 'fecha' ? new Date() : undefined}
          is24Hour
          onChange={(e: DateTimePickerEvent, selected?: Date) => {
            // Cerrar primero: si no, Android vuelve a abrir el diálogo (doble Aceptar).
            const field = picker?.field;
            const slotId = picker?.slotId;
            setPicker(null);
            if (e.type === 'dismissed') return;
            if (!selected || !field || !slotId) return;
            setSlots((prev) =>
              prev.map((s) => {
                if (s.id !== slotId) return s;
                const next = { ...s, [field]: selected };
                if (field === 'horaInicio') {
                  next.horaFin = new Date(selected.getTime() + 60 * 60 * 1000);
                }
                return next;
              }),
            );
          }}
        />
      ) : null}

      {picker && Platform.OS === 'ios' ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <View style={styles.pickerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <Pressable
                  onPress={() => setPicker(null)}
                  style={({ pressed }) => [styles.pickerHeaderBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                >
                  <Text style={styles.pickerHeaderBtnText}>Cancelar</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>{pickerFieldTitle(picker.field)}</Text>
                <Pressable
                  onPress={() => applyPicker(picker.draft)}
                  style={({ pressed }) => [styles.pickerHeaderBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar"
                >
                  <Text style={styles.pickerHeaderBtnText}>Listo</Text>
                </Pressable>
              </View>
              <View style={styles.pickerBodyIos}>
                <DateTimePicker
                  value={picker.draft}
                  mode={picker.field === 'fecha' ? 'date' : 'time'}
                  display="spinner"
                  locale="es-AR"
                  minimumDate={picker.field === 'fecha' ? new Date() : undefined}
                  onChange={(_e, selected) => {
                    if (!selected) return;
                    setPicker((prev) => (prev ? { ...prev, draft: selected } : prev));
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  loader: { marginTop: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.body, color: colors.textSecondary },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  badge: {
    backgroundColor: '#FEE2E2',
    color: colors.primary,
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.input,
  },
  pagoBadge: {
    backgroundColor: '#E5E7EB',
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.input,
  },
  detail: { ...typography.body, marginBottom: spacing.md },
  priceLine: { ...typography.body, marginBottom: spacing.xs },
  strong: { fontWeight: '800' },
  agendaLine: { ...typography.body, color: colors.textSecondary, marginVertical: spacing.sm },
  section: { marginTop: spacing.lg },
  sectionTitle: { ...typography.subtitle, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  btnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnGhostText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.88 },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  pickerFieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerFieldBody: { flex: 1 },
  pickerFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  pickerFieldValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pickerHeaderBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 72,
  },
  pickerHeaderBtnText: { fontSize: 16, fontWeight: '800', color: colors.primary },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  pickerBodyIos: {
    height: 220,
    justifyContent: 'center',
  },
  pinInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  hint: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.xs },
  mapRow: { flexDirection: 'row', marginTop: spacing.sm },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  slotCard: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  slotTitle: { fontWeight: '800', marginBottom: spacing.sm, color: colors.text },
  slotRemove: { alignSelf: 'flex-start', paddingVertical: 4 },
  slotRemoveText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
