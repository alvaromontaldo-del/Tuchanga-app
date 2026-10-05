import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    baseLocation?: { address: string; lat: number; lng: number };
  },
  isRestoring: false,
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host =
    (name: string) =>
    function Host(props: { children?: React.ReactNode }) {
      return React.createElement(name, props, props.children);
    };
  const FlatList = React.forwardRef(function FlatList(
    props: {
      data?: unknown[];
      ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    },
    _ref: React.Ref<unknown>,
  ) {
    const data = props.data ?? [];
    if (data.length === 0) {
      const empty = props.ListEmptyComponent;
      return typeof empty === 'function' ? empty() : (empty ?? null);
    }
    return React.createElement(
      React.Fragment,
      null,
      data.map((item, index) =>
        React.createElement(React.Fragment, { key: index }, props.renderItem({ item, index })),
      ),
    );
  });
  return {
    ActivityIndicator: host('ActivityIndicator'),
    FlatList,
    Image: host('Image'),
    Linking: { openSettings: () => Promise.resolve() },
    Platform: { OS: 'web', select: (spec: { web?: unknown }) => spec.web },
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('@react-navigation/native', () => ({
  useScrollToTop: () => {},
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('../../config/supabase', () => ({
  isSupabaseConfigured: () => false,
}));

vi.mock('../../navigation/openAuthModal', () => ({
  openAuthModal: () => {},
}));

vi.mock('../../components/layout/AppScreen', () => ({
  AppScreen: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../components/search/RubroMultiSelectModal', () => ({
  RubroMultiSelectModal: () => null,
}));

vi.mock('../../components/search/WorkerResultCard', () => ({
  WorkerResultCard: ({ worker }: { worker: { firstName: string } }) =>
    React.createElement('span', null, worker.firstName),
}));

vi.mock('../../components/search/SearchHeaderBar', () => ({
  SearchHeaderBar: (props: {
    urgenciasFilter?: { active: boolean; onToggle: () => void };
  }) =>
    React.createElement(
      'button',
      {
        accessibilityLabel: 'Atiende urgencias',
        onPress: () => props.urgenciasFilter?.onToggle(),
      },
      props.urgenciasFilter?.active ? 'on' : 'off',
    ),
}));

vi.mock('../../services/searchWorkersSupabase', () => ({
  fetchSearchWorkerHitsFromSupabase: async () => [],
}));

vi.mock('../../services/workerTradesSupabase', () => ({
  fetchActiveTradeNamesFromSupabase: async () => [],
}));

import { SearchWorkerScreen } from './SearchWorkerScreen';

const FORBIDDEN = ['Supabase', 'Diagnosticar', 'Diagnosticando', 'excluye:', 'resultado(s)'];

function treeText(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function renderSearch(initialQuery = ''): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(SearchWorkerScreen, {
        route: {
          key: 'SearchWorker',
          name: 'SearchWorker',
          params: { initialQuery },
        },
        navigation: { navigate: () => {} },
      } as never),
    );
  });
  return renderer;
}

describe('estado vacío de la búsqueda de profesionales', () => {
  it('muestra el mensaje corto cuando no hay coincidencias', () => {
    auth.user = {
      id: 'cliente-1',
      email: 'cliente@example.com',
      baseLocation: {
        address: 'Av. Corrientes 1234, CABA',
        lat: -34.6037,
        lng: -58.3816,
      },
    };
    auth.isRestoring = false;

    const renderer = renderSearch('qqqqqq');
    const text = treeText(renderer);

    expect(text).toContain('Sin resultados');
    expect(text).toContain('No se encontraron profesionales relacionados con tu búsqueda.');
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain('María');
  });

  it('lista profesionales cuando la búsqueda coincide y no muestra el vacío', () => {
    auth.user = {
      id: 'cliente-1',
      email: 'cliente@example.com',
      baseLocation: {
        address: 'Av. Corrientes 1234, CABA',
        lat: -34.6037,
        lng: -58.3816,
      },
    };
    auth.isRestoring = false;

    const renderer = renderSearch('electric');
    const text = treeText(renderer);

    expect(text).toContain('María');
    expect(text).not.toContain('No se encontraron profesionales relacionados con tu búsqueda.');
    expect(text).not.toContain('Diagnosticar búsqueda');
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('con el filtro de urgencias y sin coincidencias deja el aviso de urgencias', () => {
    auth.user = {
      id: 'cliente-1',
      email: 'cliente@example.com',
      baseLocation: {
        address: 'Av. Corrientes 1234, CABA',
        lat: -34.6037,
        lng: -58.3816,
      },
    };
    auth.isRestoring = false;

    const renderer = renderSearch('electric');
    const chip = renderer.root.findByProps({ accessibilityLabel: 'Atiende urgencias' });
    act(() => {
      chip.props.onPress();
    });
    const text = treeText(renderer);

    expect(text).toContain('Sin urgencias en estos resultados');
    expect(text).toContain(
      'Ningún profesional de esta búsqueda marcó que atiende urgencias. Quitá el filtro para ver el listado completo.',
    );
    expect(text).not.toContain('No se encontraron profesionales relacionados con tu búsqueda.');
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});
