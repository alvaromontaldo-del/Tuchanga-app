import { isSupabaseConfigured } from './supabase';

/**
 * URL base del API de chat (Node en /server). En desarrollo: misma máquina o IP de la PC.
 * Ej.: EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
 */
const raw = process.env.EXPO_PUBLIC_API_URL ?? '';

export function getApiBaseUrl(): string {
  return raw.replace(/\/$/, '');
}

export function isChatApiConfigured(): boolean {
  return Boolean(getApiBaseUrl());
}

/** Chat por Supabase (prioritario) o servidor Node legacy. */
export function isMessagingAvailable(): boolean {
  return isSupabaseConfigured() || isChatApiConfigured();
}
