/** ESLint rule. */

'use strict';

/** Keyword primitive nodes that count as "the primitive side" of the intersection. */
const PRIMITIVE_KEYWORDS = new Set([
  'TSStringKeyword',
  'TSNumberKeyword',
  'TSBooleanKeyword',
  'TSBigIntKeyword',
]);

/** Is this intersection member a "primitive" for our purposes? */
function isPrimitiveMember(node) {
  if (PRIMITIVE_KEYWORDS.has(node.type)) return true;
  if (node.type === 'TSLiteralType') {
    const lit = node.literal;
    // String / numeric / boolean literal => `lit.value` is a JS
    // string/number/boolean.
    if (lit && lit.type === 'Literal') {
      const t = typeof lit.value;
      return t === 'string' || t === 'number' || t === 'boolean';
    }
  }
  return false;
}

/** Does a single object *member* node constitute a CALLABLE member? - TSMethodSignature
 * -> `foo(): T` - TSCallSignatureDeclaration -> `(): T` -
 * TSConstructSignatureDeclaration-> `new (): T`. This is TSPropertySignature whose
 * value annotation is a TSFunctionType / TSConstructorType -> `run: () => void` /
 * `make: new () => T` */
function isCallableMember(member) {
  switch (member.type) {
    case 'TSMethodSignature':
    case 'TSCallSignatureDeclaration':
    case 'TSConstructSignatureDeclaration':
      return true;
    case 'TSPropertySignature': {
      const inner = member.typeAnnotation && member.typeAnnotation.typeAnnotation;
      return !!inner && (inner.type === 'TSFunctionType' || inner.type === 'TSConstructorType');
    }
    default:
      return false;
  }
}

/** Given an object-ish intersection member, decide whether it is "object members
 * worth" under the current options. Returns one of: 'callable' -> contains. At
 * least one callable member 'nonempty' -> has >=1 member but none callable (only
 * matters in blunt mode) null -> not an object member type, or an empty `{}`
 * Handles: - TSTypeLiteral : an inline `{ ... }` with a `members` array. */
function classifyObjectMember(node) {
  if (node.type === 'TSTypeLiteral') {
    if (!node.members || node.members.length === 0) return null; // empty `{}`
    if (node.members.some(isCallableMember)) return 'callable';
    return 'nonempty';
  }
  if (node.type === 'TSMappedType') {
    const value = node.typeAnnotation; // value type of the mapped type (already unwrapped)
    if (value && (value.type === 'TSFunctionType' || value.type === 'TSConstructorType')) {
      return 'callable';
    }
    // A mapped type always introduces members; treat as non-empty for blunt mode.
    return 'nonempty';
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow intersecting a primitive type with an inline object that has a callable member, ' +
        'which forces the runtime value to be a boxed object that lies about being a primitive.',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          requireCallable: {
            type: 'boolean',
            description:
              'When true (default), only flag intersections whose object part has a callable member. ' +
              'When false ("blunt" mode), flag a primitive intersected with ANY non-empty inline object ' +
              'members -- note this also flags legitimate phantom brands (false positives).',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      callable:
        '`string & { ... }` intersects a primitive with a callable member, so its runtime value must be a ' +
        'boxed object -- it then lies about being a primitive (`=== "x"` is always false; it fails ' +
        '`fs`/strict-typeof APIs). Define the helper as a separate type or wrapper instead of intersecting ' +
        'it onto the primitive.',
      blunt:
        '`string & { ... }` intersects a primitive with object members (blunt mode). If any member must ' +
        'exist at runtime, the value becomes a boxed object that lies about being a primitive. (If this is ' +
        'a type-only phantom brand it is safe -- enable the default `requireCallable: true` to allow it.)',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const requireCallable = options.requireCallable !== false; // default TRUE

    return {
      TSIntersectionType(node) {
        const members = node.types || [];

        // (a) the primitive side
        const hasPrimitive = members.some(isPrimitiveMember);
        if (!hasPrimitive) return;

        // (b) the object side -- classify every object-ish member
        let sawCallable = false;
        let sawNonEmpty = false;
        for (const m of members) {
          const kind = classifyObjectMember(m);
          if (kind === 'callable') sawCallable = true;
          else if (kind === 'nonempty') sawNonEmpty = true;
        }

        if (sawCallable) {
          context.report({ node, messageId: 'callable' });
        } else if (!requireCallable && sawNonEmpty) {
          context.report({ node, messageId: 'blunt' });
        }
      },
    };
  },
};
