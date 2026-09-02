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
exports.findCommentBlocks = findCommentBlocks;
const ts = __importStar(require("typescript"));
/** Start offset of every line in `text` (index 0 = line 1). */
function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10)
            starts.push(i + 1);
    }
    return starts;
}
/** 0-based index into `starts` of the line containing `pos`. */
function lineOf(starts, pos) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
/**
 * 1-based lines holding nothing but a `//` comment. Found with the TypeScript
 * scanner, so `//` inside a string, template literal or regex is not one.
 */
function commentOnlyLines(script) {
    const starts = lineStarts(script);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, script);
    const lines = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if (kind !== ts.SyntaxKind.SingleLineCommentTrivia)
            continue;
        const start = scanner.getTokenStart();
        const line = lineOf(starts, start);
        if (script.slice(starts[line], start).trim() !== '')
            continue;
        lines.push(line + 1);
    }
    return lines;
}
/**
 * Runs of two or more consecutive `//`-only lines — the shape a paragraph of
 * prose takes once it is pasted into a script.
 */
function findCommentBlocks(script) {
    const lines = commentOnlyLines(script);
    const blocks = [];
    for (let i = 0; i < lines.length;) {
        let j = i;
        while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1)
            j++;
        if (j > i)
            blocks.push({ startLine: lines[i], endLine: lines[j] });
        i = j + 1;
    }
    return blocks;
}
