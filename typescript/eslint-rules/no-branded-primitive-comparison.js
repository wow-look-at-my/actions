// @ts-check
'use strict';

/** ESLint rule: no-branded-primitive-comparison --------------------------------------------- Flags equality comparisons. */

const { ESLintUtils } = require('@typescript-eslint/utils');

// We talk to the TypeScript compiler API directly for the type-flag checks.
const ts = require('typescript');

const createRule = ESLintUtils.RuleCreator(
	(name) =>
		`https://github.com/your-org/eslint-rules/blob/main/docs/${name}.md`,
);

/** Primitive type flags whose presence. */
const PRIMITIVE_FLAGS =
	ts.TypeFlags.StringLike |
	ts.TypeFlags.NumberLike |
	ts.TypeFlags.BooleanLike;

/** Classify the primitive *kind* wrapped by a branded primitive, so we can
 * offer a coercion suggestion that is correct for that kind: - a boxed String
 * -> `String(x)` recovers the primitive, - a boxed Number -> `String(x)` would
 * give "42", which is wrong; the right coercion is `x.valueOf()` (or
 * `Number(x)`), - a boxed Boolean -> `Boolean(x)` is always `true` for any
 * object, also wrong; the right coercion is `x.valueOf()`. */
function brandedPrimitiveKind(type) {
	let sawString = false;
	let sawNumber = false;
	let sawBoolean = false;

	/** @param {import('typescript').Type} t */
	const visit = (t) => {
		if (t.isUnion() || t.isIntersection()) {
			t.types.forEach(visit);
			return;
		}
		if (t.flags & ts.TypeFlags.StringLike) sawString = true;
		if (t.flags & ts.TypeFlags.NumberLike) sawNumber = true;
		if (t.flags & ts.TypeFlags.BooleanLike) sawBoolean = true;
	};
	visit(type);

	const kinds = [sawString, sawNumber, sawBoolean].filter(Boolean).length;
	if (kinds !== 1) return 'mixed';
	if (sawString) return 'string';
	if (sawNumber) return 'number';
	return 'boolean';
}

/** A "plain primitive" for the *other* operand (the low-false-positive gate):
 * a string/number/boolean, a literal of one of those, or the bigint/symbol
 * primitives. */
const PLAIN_PRIMITIVE_FLAGS =
	ts.TypeFlags.StringLike |
	ts.TypeFlags.NumberLike |
	ts.TypeFlags.BooleanLike |
	ts.TypeFlags.BigIntLike |
	ts.TypeFlags.ESSymbolLike |
	ts.TypeFlags.Null |
	ts.TypeFlags.Undefined;

/** Does this individual (non-intersection, non-union) type contribute object
 * "members" -- i.e. is it the `{ ...members }` side of a branded primitive?
 *
 * We count it as member-contributing if it exposes any of:
 *   - own/declared properties (`getProperties()` non-empty),
 *   - call signatures (e.g. `string & (() => void)`),
 *   - construct signatures,
 *   - index signatures (string/number). */
function contributesObjectMembers(t, checker) {
	// Properties declared by the object literal / interface side.
	if (t.getProperties().length > 0) return true;

	// Call / construct signatures (function-shaped intersection members).
	if (checker.getSignaturesOfType(t, ts.SignatureKind.Call).length > 0) {
		return true;
	}
	if (checker.getSignaturesOfType(t, ts.SignatureKind.Construct).length > 0) {
		return true;
	}

	// Index signatures: `string & { [k: string]: unknown }`.
	if (checker.getIndexInfoOfType(t, ts.IndexKind.String)) return true;
	if (checker.getIndexInfoOfType(t, ts.IndexKind.Number)) return true;

	return false;
}

/** Is a single INTERSECTION type a branded primitive: does it have BOTH
 *   (a) at least one primitive constituent (string/number/boolean, incl.
 *       literals), AND
 *   (b) at least one constituent that contributes object members?
 *
 * That shape is exactly `primitive & { ...members }` -- a value that the type
 * system treats as a string/number/boolean but that is a boxed object at
 * runtime. */
function intersectionIsBranded(type, checker) {
	if (!type.isIntersection()) return false;

	let hasPrimitiveSide = false;
	let hasObjectMemberSide = false;

	for (const constituent of type.types) {
		if (constituent.flags & PRIMITIVE_FLAGS) {
			hasPrimitiveSide = true;
		}
		// A constituent counts as the object "members" side only if it is NOT
		// itself flagged primitive.
		if (
			!(constituent.flags & PRIMITIVE_FLAGS) &&
			contributesObjectMembers(constituent, checker)
		) {
			hasObjectMemberSide = true;
		}
	}

	return hasPrimitiveSide && hasObjectMemberSide;
}

/** Is `type` a "branded primitive"? A direct intersection `primitive & {
 *...members }` (covers `string`/`number` brands -- see {@link
 *intersectionIsBranded}). */
function isBrandedPrimitive(type, checker) {
	if (type.isIntersection()) {
		return intersectionIsBranded(type, checker);
	}
	if (type.isUnion()) {
		return type.types.every((member) =>
			intersectionIsBranded(member, checker),
		);
	}
	return false;
}

/** Is `type` a "plain primitive" suitable as the OTHER operand -- i.e. a value
 * that is genuinely a primitive (or null/undefined) at runtime, so that
 * `brandedPrimitive === thisOperand` is provably always false? */
function isPlainPrimitiveOperand(type, checker) {
	if (isBrandedPrimitive(type, checker)) return false;

	/** @param {import('typescript').Type} t */
	const everyConstituentIsPlain = (t) => {
		if (t.isUnion()) return t.types.every(everyConstituentIsPlain);
		// An intersection that is NOT a branded primitive but still mixes in an object is not a plain primitive.
		if (t.isIntersection()) return false;
		return (t.flags & PLAIN_PRIMITIVE_FLAGS) !== 0;
	};

	return everyConstituentIsPlain(type);
}

const rule = createRule({
	name: 'no-branded-primitive-comparison',
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow equality comparisons against branded primitive ' +
				'("fake string/number/boolean") types, which are boxed objects ' +
				'at runtime and therefore always compare unequal to a primitive.',
		},
		hasSuggestions: true,
		schema: [],
		messages: {
			brandedComparison:
				"`{{typeText}}` is a branded primitive (a primitive intersected " +
				'with object members) -- at runtime it is a boxed object, so this ' +
				'comparison is always false. Coerce with `String(x)` (or read its ' +
				'primitive value) before comparing.',
			coerce:
				'Wrap the operand in `{{coercion}}` to compare its primitive value.',
		},
	},
	defaultOptions: [],
	create(context) {
		// Parser services give us the bridge from ESTree nodes to TS nodes and the program's TypeChecker.
		const services = ESLintUtils.getParserServices(context);
		const checker = services.program.getTypeChecker();

		/** Resolve the TS type of an ESTree node via parser services. */
		const typeOf = (node) => services.getTypeAtLocation(node);

		/**
		 * Inspect a pair of operand nodes. If exactly one side is a branded
		 * primitive and the other side is a plain primitive, report on the
		 * branded operand (the always-false footgun).
		 *
		 * @param {import('@typescript-eslint/utils').TSESTree.Node} left
		 * @param {import('@typescript-eslint/utils').TSESTree.Node} right
		 */
		function checkOperandPair(left, right) {
			const leftType = typeOf(left);
			const rightType = typeOf(right);

			const leftBranded = isBrandedPrimitive(leftType, checker);
			const rightBranded = isBrandedPrimitive(rightType, checker);

			// If BOTH sides are branded primitives, identity could in principle hold (same boxed object), so we do not flag.
			if (leftBranded === rightBranded) return;

			const brandedNode = leftBranded ? left : right;
			const brandedType = leftBranded ? leftType : rightType;
			const otherType = leftBranded ? rightType : leftType;

			// Precision gate: the OTHER operand must be a genuine primitive, so the comparison is guaranteed false at runtime.
			if (!isPlainPrimitiveOperand(otherType, checker)) return;

			const typeText = checker.typeToString(brandedType);

			// Tailor the coercion suggestion to the wrapped primitive kind so the autofix is correct.
			const kind = brandedPrimitiveKind(brandedType);
			const sourceCode = context.sourceCode;
			const text = sourceCode.getText(brandedNode);
			const needsParens =
				brandedNode.type !== 'Identifier' &&
				brandedNode.type !== 'MemberExpression' &&
				brandedNode.type !== 'CallExpression';
			const wrapped = needsParens ? `(${text})` : text;
			const coercion =
				kind === 'string' ? `String(${text})` : `${wrapped}.valueOf()`;

			context.report({
				node: brandedNode,
				messageId: 'brandedComparison',
				data: { typeText },
				suggest: [
					{
						messageId: 'coerce',
						data: { coercion },
						fix(fixer) {
							return fixer.replaceText(brandedNode, coercion);
						},
					},
				],
			});
		}

		return {
			// `a === b`, `a !== b`, `a == b`, `a != b`
			BinaryExpression(node) {
				if (
					node.operator !== '===' &&
					node.operator !== '!==' &&
					node.operator !== '==' &&
					node.operator !== '!='
				) {
					return;
				}
				checkOperandPair(node.left, node.right);
			},

			// `switch (disc) { case test: ... }` -- each `case` test is compared
			// against the discriminant with `===` semantics at runtime.
			SwitchStatement(node) {
				for (const switchCase of node.cases) {
					if (switchCase.test == null) continue; // `default:` has no test
					checkOperandPair(node.discriminant, switchCase.test);
				}
			},
		};
	},
});

module.exports = rule;
