"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const inputs_1 = require("./inputs");
(0, node_test_1.test)('an empty input takes the default', () => {
    strict_1.default.equal((0, inputs_1.capped)('warn-max-words', '', 20), 20);
    strict_1.default.equal((0, inputs_1.capped)('warn-max-words', '   ', 20), 20);
});
(0, node_test_1.test)('a stricter value is accepted, because a house style may be stricter', () => {
    strict_1.default.equal((0, inputs_1.capped)('hard-max-words', '15', 25), 15);
    strict_1.default.equal((0, inputs_1.capped)('warn-max-words', '25', 20), 25);
});
// The loophole this closes: nothing stopped a workflow raising the cap until
// its own prose passed, in one line of YAML that read like a setting.
(0, node_test_1.test)('a value above the standard is refused, by name and by number', () => {
    strict_1.default.throws(() => (0, inputs_1.capped)('hard-max-words', '26', 25), /hard-max-words=26 is above ASD-STE100's own cap of 25/);
    strict_1.default.throws(() => (0, inputs_1.capped)('hard-max-words', '500', 25), /removes it/);
    strict_1.default.throws(() => (0, inputs_1.capped)('warn-max-words', '40', 20), /warn-max-words=40/);
});
(0, node_test_1.test)('a value that is not a positive whole number is refused', () => {
    for (const bad of ['0', '-3', '2.5', 'twenty', 'true']) {
        strict_1.default.throws(() => (0, inputs_1.capped)('hard-max-words', bad, 25), /positive whole number/, bad);
    }
});
(0, node_test_1.test)('the ceiling is the standard s number', () => {
    strict_1.default.equal(inputs_1.STE_MAX_WORDS, 25);
});
