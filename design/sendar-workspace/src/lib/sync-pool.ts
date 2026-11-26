export async function runSyncPool<T>(items: T[], work: (item: T, index: number) => Promise<void>, limit = 100): Promise<void> {
  let next = 0;
  const count = Math.max(1, Math.min(100, Math.floor(limit)));
  await Promise.all(Array.from({ length: Math.min(items.length, count) }, async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index], index);
    }
  }));
}
