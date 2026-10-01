import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { FAQ_ITEMS } from '../../content/faq';
import { colors, spacing } from '../../constants/theme';
import { accountUi } from './accountUi';

/**
 * Acordeón de preguntas frecuentes. Cada fila se abre o se cierra al tocarla.
 * El mismo componente sirve en Cuenta de cliente/profesional y en la del comercio.
 */
export function FaqScreen() {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  return (
    <AppScreen style={accountUi.screenBg} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Tocá una pregunta para leer la respuesta. Volvé a tocarla para cerrarla.
        </Text>
        <View style={accountUi.card}>
          {FAQ_ITEMS.map((item, index) => {
            const open = openId === item.id;
            const isLast = index === FAQ_ITEMS.length - 1;
            return (
              <View key={item.id} style={!isLast && !open ? styles.itemBorder : undefined}>
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={({ pressed }) => [styles.header, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={item.question}
                >
                  <Text style={styles.question}>{item.question}</Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {open ? (
                  <View style={[styles.body, !isLast && styles.itemBorder]}>
                    <Text style={styles.answer}>{item.answer}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  lead: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  question: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 22,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  answer: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.92 },
});
