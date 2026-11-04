import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMaterialRequestDraftStore } from '../utils/materialRequestDraft';

const store = createMaterialRequestDraftStore({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
});

export const loadMaterialRequestDraft = store.load;
export const saveMaterialRequestDraft = store.save;
export const clearMaterialRequestDraft = store.clear;
