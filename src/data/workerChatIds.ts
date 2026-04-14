const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWorkerUserIdUuid(workerId: string): boolean {
  return UUID_RE.test(workerId);
}

/**
 * UUID de usuario en el backend para cada trabajador mock (alineado con server/scripts/initDb.js).
 */
export const MOCK_WORKER_BACKEND_USER_IDS: Record<string, string> = {
  w1: '10000000-0000-4000-8000-000000000001',
  w2: '10000000-0000-4000-8000-000000000002',
  w3: '10000000-0000-4000-8000-000000000003',
  w4: '10000000-0000-4000-8000-000000000004',
  w5: '10000000-0000-4000-8000-000000000005',
  w6: '10000000-0000-4000-8000-000000000006',
};

export function getWorkerBackendUserId(workerId: string): string | undefined {
  if (UUID_RE.test(workerId)) return workerId;
  return MOCK_WORKER_BACKEND_USER_IDS[workerId];
}
