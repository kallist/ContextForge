import type { Node as SyntaxNode } from "web-tree-sitter";

import type { SupportedLanguage } from "../../core/language-analysis.js";

type BindingGuard = "SHADOWED" | "UNPROVEN" | null;
interface LocalScope {
  readonly parent: LocalScope | null;
  readonly kind: "module" | "function" | "block" | "python-class" | "comprehension";
  readonly names: Set<string>;
  uncertain: boolean;
}

const JS_FUNCTIONS = new Set([
  "function_declaration", "generator_function_declaration", "function_expression",
  "generator_function", "arrow_function", "method_definition",
]);
const JS_BLOCKS = new Set(["statement_block", "for_statement", "for_in_statement", "switch_body", "catch_clause", "class_body"]);
const JS_DECLARATIONS = new Set(["function_declaration", "generator_function_declaration", "function_signature", "class_declaration", "abstract_class_declaration", "enum_declaration", "internal_module"]);
const PY_COMPREHENSIONS = new Set(["list_comprehension", "set_comprehension", "dictionary_comprehension", "generator_expression"]);

function scope(parent: LocalScope | null, kind: LocalScope["kind"]): LocalScope {
  return { parent, kind, names: new Set(), uncertain: false };
}

function functionScope(current: LocalScope): LocalScope {
  while (current.parent !== null && current.kind !== "function") current = current.parent;
  return current;
}

/** Binding positions only: never walk initializer expressions, object keys or types. */
function bindPattern(node: SyntaxNode | null, target: LocalScope): void {
  if (node === null) return;
  switch (node.type) {
    case "identifier":
    case "type_identifier": // Only reached from runtime declaration-name positions.
    case "shorthand_property_identifier_pattern":
      // Escaped identifiers need language decoding; reject rather than guess.
      if (node.text.includes("\\")) target.uncertain = true;
      else target.names.add(node.text);
      return;
    case "required_parameter":
    case "optional_parameter":
      bindPattern(node.childForFieldName("pattern"), target);
      return;
    case "pair_pattern":
      bindPattern(node.childForFieldName("value"), target);
      return;
    case "assignment_pattern":
    case "object_assignment_pattern":
      bindPattern(node.childForFieldName("left"), target);
      return;
    case "default_parameter":
    case "typed_default_parameter":
      bindPattern(node.childForFieldName("name"), target);
      return;
    case "typed_parameter":
      bindPattern(node.namedChild(0), target);
      return;
    case "formal_parameters":
    case "parameters":
    case "lambda_parameters":
    case "object_pattern":
    case "array_pattern":
    case "rest_pattern":
    case "list_splat_pattern":
    case "dictionary_splat_pattern":
    case "pattern_list":
    case "tuple_pattern":
    case "list_pattern":
    case "as_pattern_target":
      for (const child of node.namedChildren) bindPattern(child, target);
      return;
    case "keyword_separator":
    case "positional_separator":
    case "comment":
    case "this": // TypeScript's explicit this parameter is not a local value binding.
    case "attribute":
    case "subscript":
    case "member_expression":
    case "subscript_expression":
      return; // Separators and property assignment targets introduce no bare binding.
    default:
      target.uncertain = true;
  }
}

/**
 * Transient rejection guard, not a symbol resolver. Collect local binding-name
 * sets once, then inspect only enclosing scopes per bare call. Full scopes are
 * collected before queries, so hoisting/TDZ never depend on textual position.
 */
export function bareCallShadowGuard(
  root: SyntaxNode,
  language: SupportedLanguage,
  collectNode: (node: SyntaxNode, type: string) => void,
): (call: SyntaxNode, name: string) => BindingGuard {
  const python = language === "python";
  const module = scope(null, "module");
  const callScopes = new Map<number, LocalScope>();

  function visit(node: SyntaxNode, enclosing: LocalScope): void {
    // The Tree-sitter type getter crosses the WASM boundary on every access.
    const type = node.type;
    let current = enclosing;
    if (python) {
      if (type === "function_definition" || type === "class_definition") {
        bindPattern(node.childForFieldName("name"), enclosing);
      }
      if (PY_COMPREHENSIONS.has(type)) {
        current = scope(enclosing, "comprehension");
      } else if (type === "function_definition" || type === "lambda") {
        current = scope(enclosing, "function");
        bindPattern(node.childForFieldName("parameters"), current);
      } else if (type === "class_definition") {
        current = scope(enclosing, "python-class");
      }
      if (type === "assignment" || type === "augmented_assignment" || type === "for_statement" || type === "for_in_clause") {
        bindPattern(node.childForFieldName("left"), current);
      } else if (type === "named_expression") {
        bindPattern(node.childForFieldName("name"), current.kind === "comprehension" ? functionScope(current) : current);
      } else if (type === "as_pattern") {
        bindPattern(node.childForFieldName("alias"), current);
      } else if (type === "global_statement" || type === "nonlocal_statement") {
        // Resolving declarations across scopes is intentionally outside this guard.
        for (const child of node.namedChildren) bindPattern(child, current);
      } else if (type === "import_statement" || type === "import_from_statement") {
        const moduleName = node.childForFieldName("module_name");
        for (const child of node.namedChildren) {
          if (child.id === moduleName?.id) continue;
          if (child.type === "aliased_import") bindPattern(child.childForFieldName("alias"), current);
          else if (child.type === "identifier" || child.type === "dotted_name") current.names.add(child.text.split(".")[0] ?? child.text);
          else current.uncertain = true;
        }
      } else if (type === "match_statement" || type === "delete_statement") {
        // Pattern capture / deletion makes function-local binding resolution unsafe.
        current.uncertain = true;
      }
    } else {
      if (JS_DECLARATIONS.has(type)) bindPattern(node.childForFieldName("name"), enclosing);
      if (JS_FUNCTIONS.has(type)) {
        current = scope(enclosing, "function");
        bindPattern(node.childForFieldName("parameters") ?? node.childForFieldName("parameter"), current);
        if (type === "function_expression" || type === "generator_function") {
          const name = node.childForFieldName("name");
          const ownTopLevelBinding = enclosing.kind === "module" && node.parent?.type === "variable_declarator" && node.parent.childForFieldName("name")?.text === name?.text;
          if (!ownTopLevelBinding) bindPattern(name, current);
        }
      } else if (JS_BLOCKS.has(type)) {
        current = scope(enclosing, "block");
      } else if (type === "class") {
        current = scope(enclosing, "block");
        bindPattern(node.childForFieldName("name"), current);
      } else if (type === "class_static_block") {
        current = scope(enclosing, "function"); // Static-block var declarations cannot escape it.
      }
      if (type === "variable_declarator") {
        bindPattern(node.childForFieldName("name"), node.parent?.type === "variable_declaration" ? functionScope(current) : current);
      } else if (type === "catch_clause") {
        bindPattern(node.childForFieldName("parameter"), current);
      } else if (type === "for_in_statement") {
        const kind = node.childForFieldName("kind")?.text;
        if (kind === "var" || kind === "let" || kind === "const") {
          bindPattern(node.childForFieldName("left"), kind === "var" ? functionScope(current) : current);
        }
      } else if (type === "with_statement") {
        current = scope(enclosing, "block");
        current.uncertain = true;
      }
    }
    if (type === (python ? "call" : "call_expression")) callScopes.set(node.id, current);
    collectNode(node, type);
    for (const child of node.namedChildren) visit(child, current);
  }
  visit(root, module);

  return (call, name) => {
    let current = callScopes.get(call.id);
    let insidePythonFunction = false;
    while (current !== undefined && current.parent !== null) {
      if (current.kind === "function" || current.kind === "comprehension") insidePythonFunction = true;
      // Python class bodies are not lexical enclosures of method bodies.
      if (!(python && insidePythonFunction && current.kind === "python-class")) {
        if (current.names.has(name)) return "SHADOWED";
        if (current.uncertain) return "UNPROVEN";
      }
      current = current.parent;
    }
    return null;
  };
}
