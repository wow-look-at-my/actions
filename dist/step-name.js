"use strict";
// An unnamed step shows in the log as the action it runs, so every unnamed
// typescript step reads `Run wow-look-at-my/actions@typescript#latest`. The
// script is the whole point of the step and the name is the only place its
// purpose can appear.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runsTypescriptAction = runsTypescriptAction;
exports.unnamedSteps = unnamedSteps;
exports.unnamedStepMessage = unnamedStepMessage;
/** True for a `uses:` that runs this action, published or as a local path. */
function runsTypescriptAction(uses) {
    if (typeof uses !== 'string')
        return false;
    const ref = uses.trim();
    return /(^|\/)actions@typescript(#|$)/.test(ref) || /(^|\/)typescript\/?$/.test(ref);
}
/**
 * The 1-based positions, among a job's steps, of every typescript step with no
 * `name:`. A step reached through a composite action does not appear in the
 * workflow file, so that case yields nothing and the caller stays quiet.
 */
function unnamedSteps(doc, job) {
    const steps = doc.jobs?.[job]?.steps;
    if (!Array.isArray(steps))
        return [];
    const found = [];
    steps.forEach((raw, i) => {
        const step = raw;
        if (!step || !runsTypescriptAction(step.uses))
            return;
        const name = step.name;
        if (typeof name === 'string' && name.trim())
            return;
        found.push(i + 1);
    });
    return found;
}
function unnamedStepMessage(workflow, job, positions) {
    const where = positions.map((p) => `step ${p}`).join(', ');
    return (`${workflow}: job '${job}' runs this action with no \`name:\` (${where}). ` +
        'An unnamed step logs as the action, so the log says nothing about what the script does. ' +
        'Give the step a `name:` describing the script.');
}
