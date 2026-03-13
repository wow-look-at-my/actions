"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const glob_1 = require("glob");
function parseInputs() {
    const parseList = (input) => {
        return input
            .split(/[\n,]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    };
    return {
        path: core.getInput('path') || '.',
        exclude: parseList(core.getInput('exclude')),
        failOnViolation: core.getBooleanInput('fail-on-violation'),
    };
}
async function findPackageJsonFiles(inputs) {
    const matches = await (0, glob_1.glob)('**/package.json', {
        cwd: inputs.path,
        nodir: true,
        absolute: true,
        ignore: inputs.exclude,
    });
    return matches.sort();
}
function checkPackageJson(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const pkg = JSON.parse(content);
    return 'scripts' in pkg;
}
async function runCheck(inputs) {
    const files = await findPackageJsonFiles(inputs);
    const violations = [];
    for (const file of files) {
        try {
            if (checkPackageJson(file)) {
                violations.push(file);
            }
        }
        catch (error) {
            core.warning(`Failed to parse ${file}: ${error}`);
        }
    }
    return {
        filesChecked: files.length,
        filesWithScripts: violations.length,
        violations,
    };
}
function reportToConsole(result, workdir) {
    console.log('');
    console.log('No Scripts Check');
    console.log('================');
    console.log('');
    if (result.filesWithScripts === 0) {
        console.log(`\u2705 All ${result.filesChecked} package.json files are scripts-free`);
        return;
    }
    console.log(`\u274c Found ${result.filesWithScripts} package.json files with scripts sections:\n`);
    for (const file of result.violations) {
        const relPath = path.relative(workdir, file);
        console.log(`  \u2022 ${relPath}`);
        core.error('package.json contains scripts section - use a justfile instead', {
            file: relPath,
            startLine: 1,
            title: 'Scripts Section Found',
        });
    }
    console.log('\n\ud83d\udca1 Tip: Move scripts to a justfile and remove the scripts section from package.json');
}
async function run() {
    try {
        const inputs = parseInputs();
        const workdir = path.resolve(inputs.path);
        core.info(`Checking for scripts in package.json files in: ${workdir}`);
        const result = await runCheck(inputs);
        reportToConsole(result, workdir);
        core.setOutput('files-checked', result.filesChecked.toString());
        core.setOutput('files-with-scripts', result.filesWithScripts.toString());
        core.setOutput('violation-list', JSON.stringify(result.violations));
        if (inputs.failOnViolation && result.filesWithScripts > 0) {
            core.setFailed(`Found ${result.filesWithScripts} package.json files with scripts sections. ` +
                `Use justfiles instead.`);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed('An unexpected error occurred');
        }
    }
}
run();
