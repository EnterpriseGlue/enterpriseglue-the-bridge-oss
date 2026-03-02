/**
 * Backfill bpmnProcessId and dmnDecisionId for all files
 * 
 * Usage: cd backend && npx tsx src/scripts/backfill-file-ids.ts
 */

import 'dotenv/config';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';

function extractBpmnProcessId(xml: string): string | null {
  const match = String(xml || '').match(/<\s*(?:[a-zA-Z0-9_-]+:)?process\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? String(match[1]) : null;
}

function extractDmnDecisionId(xml: string): string | null {
  const match = String(xml || '').match(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? String(match[1]) : null;
}

async function main() {
  console.log('[backfill] Connecting to database...');
  const ds = await getDataSource();
  const fileRepo = ds.getRepository(File);

  console.log('[backfill] Fetching all files...');
  const files = await fileRepo.find({ select: ['id', 'name', 'type', 'xml', 'bpmnProcessId', 'dmnDecisionId'] });
  console.log(`[backfill] Found ${files.length} files`);

  let updatedBpmn = 0;
  let updatedDmn = 0;
  let skipped = 0;

  for (const file of files) {
    const type = String(file.type || '').toLowerCase();

    if (type === 'bpmn') {
      const extractedId = extractBpmnProcessId(String(file.xml || ''));
      if (extractedId && extractedId !== file.bpmnProcessId) {
        await fileRepo.update({ id: file.id }, { bpmnProcessId: extractedId });
        console.log(`  [bpmn] ${file.name}: ${file.bpmnProcessId || '(none)'} -> ${extractedId}`);
        updatedBpmn++;
      } else if (!extractedId) {
        console.log(`  [bpmn] ${file.name}: No process ID found in XML`);
        skipped++;
      }
    } else if (type === 'dmn') {
      const extractedId = extractDmnDecisionId(String(file.xml || ''));
      if (extractedId && extractedId !== file.dmnDecisionId) {
        await fileRepo.update({ id: file.id }, { dmnDecisionId: extractedId });
        console.log(`  [dmn] ${file.name}: ${file.dmnDecisionId || '(none)'} -> ${extractedId}`);
        updatedDmn++;
      } else if (!extractedId) {
        console.log(`  [dmn] ${file.name}: No decision ID found in XML`);
        skipped++;
      }
    }
  }

  console.log('\n[backfill] Complete!');
  console.log(`  BPMN files updated: ${updatedBpmn}`);
  console.log(`  DMN files updated:  ${updatedDmn}`);
  console.log(`  Skipped (no ID in XML): ${skipped}`);

  await ds.destroy();
}

main().catch((err) => {
  console.error('[backfill] Error:', err);
  process.exit(1);
});
