export function formatQueueNumber(queueNumber: number): string {
  return String(queueNumber).padStart(2, '0');
}
