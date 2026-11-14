import { pool } from '@workspace/db';
import { applyWriterCleanup, previewWriterCleanup } from '../src/lib/writer-retention';
import { getWriterCleanupHealth } from '../src/lib/writer-cleanup-health';

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--status' && arg !== '--apply' && !/^--limit=\d+$/.test(arg)) ||
      new Set(args).size !== args.length ||
      args.filter(arg => arg.startsWith('--limit=')).length > 1 ||
      (args.includes('--status') && args.length !== 1)) {
    console.error('Kullanım: writer-cleanup [--apply] [--limit=1..100] veya writer-cleanup --status');
    process.exitCode = 1;
  } else {
    const limit = Number(args.find(arg => arg.startsWith('--limit='))?.slice(8) ?? 25);
    const apply = args.includes('--apply');
    let preview;
    if (!args.includes('--status')) {
      if (apply) await applyWriterCleanup(limit);
      else {
        const items = await previewWriterCleanup(limit);
        preview = { candidates: items.length,
          observe: items.filter(i => i.action === 'observe').length,
          delete: items.filter(i => i.action === 'delete').length,
          expire: items.filter(i => i.action === 'expire').length };
      }
    }
    const health = await getWriterCleanupHealth();
    console.log(JSON.stringify({ mode: args.includes('--status') ? 'status' : apply ? 'apply' : 'read-only',
      ...(args.includes('--status') ? {} : { limit }), ...(preview ? { preview } : {}), health }, null, 2));
    if (health.warnings.length) {
      console.error(`UYARI: ${health.warnings.join(', ')}. Ayrıntılar: docs/writer-retention.md`);
      process.exitCode = apply && health.outcome === 'retry_required' ? 1 : 2;
    }
  }
} catch {
  // Raw DB/storage errors can contain private text, IDs and signed URLs.
  console.error('Temizlik veya durum sorgusu tamamlanamadı (cleanup_unavailable). Özel hata ayrıntıları bastırıldı; şema, bağlantı ve başka çalışma olup olmadığını denetleyin.');
  process.exitCode = 1;
} finally { await pool.end(); }
