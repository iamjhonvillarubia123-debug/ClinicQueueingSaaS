export function formatQueueNumber(queueNumber: number): string {
  return String(queueNumber).padStart(3, '0');
}
