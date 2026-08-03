import type { FlowVariable, JsonValue } from "@ether/schema";

/** Variable names are intentionally small and explicit: they are identifiers,
 * not arbitrary object paths or expressions. */
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

export type VariableValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export class VariableDefinitionError extends Error {
  readonly code: "VARIABLE_NAME_INVALID" | "VARIABLE_DUPLICATE";
  readonly variableName: string;

  constructor(code: VariableDefinitionError["code"], variableName: string, message: string) {
    super(message);
    this.name = "VariableDefinitionError";
    this.code = code;
    this.variableName = variableName;
  }
}

export class VariableInterpolationError extends Error {
  readonly code: "VARIABLE_TOKEN_INVALID" | "VARIABLE_TOKEN_MISSING";
  readonly token: string;

  constructor(code: VariableInterpolationError["code"], token: string, message: string) {
    super(message);
    this.name = "VariableInterpolationError";
    this.code = code;
    this.token = token;
  }
}

export function variableValueType(value: JsonValue): VariableValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

/** Render JSON values in a stable form for prompts, previews, and plans. */
export function renderVariableValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key]!)])
    );
  }
  return value;
}

/** Validate definitions and return a deterministic name-to-value map. */
export function variableMap(variables: readonly FlowVariable[]): ReadonlyMap<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  for (const variable of variables) {
    const name = variable.name.trim();
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      throw new VariableDefinitionError(
        "VARIABLE_NAME_INVALID",
        variable.name,
        `Variable name ${JSON.stringify(variable.name)} must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.`
      );
    }
    if (result.has(name)) {
      throw new VariableDefinitionError(
        "VARIABLE_DUPLICATE",
        name,
        `Variable name ${JSON.stringify(name)} is declared more than once.`
      );
    }
    result.set(name, variable.value);
  }
  return result;
}

export function validateVariableDefinitions(variables: readonly FlowVariable[]): void {
  variableMap(variables);
}

/**
 * Replace explicit `${name}` tokens. `$${name}` is an intentional literal
 * escape and remains `${name}` in the result. Unknown or malformed tokens fail
 * closed so preview and execution cannot silently diverge.
 */
export function interpolateVariables(
  text: string,
  variables: readonly FlowVariable[] | ReadonlyMap<string, JsonValue>
): string {
  const values: ReadonlyMap<string, JsonValue> = Array.isArray(variables)
    ? variableMap(variables as readonly FlowVariable[])
    : variables as ReadonlyMap<string, JsonValue>;
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("$${", index)) {
      const end = text.indexOf("}", index + 3);
      if (end < 0) throw new VariableInterpolationError("VARIABLE_TOKEN_INVALID", text.slice(index), "A literal variable token is missing its closing brace.");
      const name = text.slice(index + 3, end);
      if (!VARIABLE_NAME_PATTERN.test(name)) {
        throw new VariableInterpolationError("VARIABLE_TOKEN_INVALID", text.slice(index, end + 1), `Variable token ${JSON.stringify(name)} is not a referenceable name.`);
      }
      result += `\${${name}}`;
      index = end + 1;
      continue;
    }
    if (text.startsWith("${", index)) {
      const end = text.indexOf("}", index + 2);
      if (end < 0) throw new VariableInterpolationError("VARIABLE_TOKEN_INVALID", text.slice(index), "A variable token is missing its closing brace.");
      const name = text.slice(index + 2, end);
      if (!VARIABLE_NAME_PATTERN.test(name)) {
        throw new VariableInterpolationError("VARIABLE_TOKEN_INVALID", text.slice(index, end + 1), `Variable token ${JSON.stringify(name)} is not a referenceable name.`);
      }
      const value = values.get(name);
      if (value === undefined && !values.has(name)) {
        throw new VariableInterpolationError("VARIABLE_TOKEN_MISSING", name, `Variable ${JSON.stringify(name)} is not defined.`);
      }
      result += renderVariableValue(value!);
      index = end + 1;
      continue;
    }
    result += text[index]!;
    index += 1;
  }
  return result;
}
