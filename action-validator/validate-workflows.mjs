// Validate workflow YAML against the LIVE GitHub workflow schema.

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as yaml from 'js-yaml';
import { readFileSync } from 'node:fs';

const [schemaPath, ...files] = process.argv.slice(2);
if (!schemaPath || files.length === 0) {
  console.error('usage: validate-workflows.mjs <schema.json> <workflow.yml>...');
  process.exit(2);
}

// strict:false because schemastore uses keywords ajv does not police.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

let validate;
try {
  validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
} catch (e) {
  console.error(`Could not compile the workflow schema: ${e.message}`);
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  let doc;
  try {
    doc = yaml.load(readFileSync(file, 'utf8'));
  } catch (e) {
    failed++;
    console.error(`FAIL ${file}\n      unparseable YAML: ${e.message}`);
    continue;
  }
  if (validate(doc)) {
    console.log(`OK   ${file}`);
    continue;
  }
  failed++;
  console.error(`FAIL ${file}`);
  for (const err of validate.errors) {
    console.error(`      ${err.instancePath || '/'} ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} workflow file(s) failed schema validation`);
  process.exit(1);
}
console.log(`\n${files.length} workflow file(s) validated`);
