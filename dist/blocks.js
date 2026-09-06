"use strict";
// A sentence is not a line. Prose files are hard-wrapped, so one sentence
// normally spans two or three physical lines, and a checker that reads one line
// at a time cannot see it: a 30-word sentence wrapped over three lines shows
// that checker three short fragments and passes. This file joins the lines of a
// paragraph back into the text a reader sees, and keeps a map from each offset
// in that text to the line it came from, so every finding still names a line.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSkippableLine = isSkippableLine;
exports.isListLine = isListLine;
exports.stripMarkup = stripMarkup;
exports.lineAt = lineAt;
exports.blocks = blocks;
function isSkippableLine(line) {
    if (/^\s{0,3}#{1,6}\s/.test(line))
        return true; // a heading is a headline, not a sentence
    if (/^\s*>/.test(line))
        return true; // a blockquote is a verbatim quote
    if (/^\s*\|/.test(line))
        return true; // a table cell is a fragment
    if (/^\s*<!--/.test(line))
        return true; // a comment is markup, not prose
    return false;
}
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
function isListLine(line) {
    return LIST_MARKER_RE.test(line);
}
function stripMarkup(line) {
    return line
        .replace(LIST_MARKER_RE, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_]{1,3}/g, '')
        .trim();
}
// Reports the source line an offset in `block.text` came from.
function lineAt(block, index) {
    let line = block.startLine;
    for (const s of block.starts) {
        if (s.at > index)
            break;
        line = s.line;
    }
    return line;
}
const FRONTMATTER_FENCE_RE = /^---\s*$/;
// The YAML frontmatter fence, if `lines` opens with one: the index of its closing
// `---` line, or -1 if the file has no frontmatter. Frontmatter is data, not
// prose, and it is not a paragraph a reader wraps -- one key per line is the
// correct shape, so it is never read as an unjoined wrap.
function frontmatterEnd(lines) {
    if (!FRONTMATTER_FENCE_RE.test(lines[0] ?? ''))
        return -1;
    for (let i = 1; i < lines.length; i++) {
        if (FRONTMATTER_FENCE_RE.test(lines[i]))
            return i;
    }
    return -1;
}
// Groups lines into the units a reader reads. A blank line, a heading, a
// blockquote, and a table row all end a block. A list marker ends the previous
// block and opens its own, so one item never runs into the next.
function blocks(lines) {
    const out = [];
    let parts = [];
    let starts = [];
    let startLine = 0;
    let list = false;
    let length = 0;
    const frontmatterEndLine = frontmatterEnd(lines);
    const flush = () => {
        if (parts.length)
            out.push({ text: parts.join(' '), starts, startLine, list });
        parts = [];
        starts = [];
        length = 0;
    };
    for (let i = 0; i < lines.length; i++) {
        if (i <= frontmatterEndLine)
            continue;
        const line = lines[i];
        if (!line.trim() || isSkippableLine(line)) {
            flush();
            continue;
        }
        const cleaned = stripMarkup(line);
        if (!cleaned) {
            flush();
            continue;
        }
        if (isListLine(line))
            flush();
        if (!parts.length) {
            startLine = i + 1;
            list = isListLine(line);
        }
        starts.push({ at: length, line: i + 1 });
        length += cleaned.length + 1;
        parts.push(cleaned);
    }
    flush();
    return out;
}
