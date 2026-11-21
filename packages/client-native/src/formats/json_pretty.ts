const TABS: string[] = [""];

export function tabs(count: number): string {
  for (let i = TABS.length; i <= count; i++) {
    TABS.push((TABS[i - 1] as string) + "\t");
  }
  return TABS[count] as string;
}

/** A value of a JSON text: the text of a scalar, an object or an array. */
type JSONNode =
  | string
  | { object: Array<[key: string, value: JSONNode]> }
  | { array: JSONNode[] };

/** Reads the structure of a JSON text. The scalars and the keys stay as
 *  they are in the text. */
export class JSONTextReader {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  read(): JSONNode {
    const node = this.value();
    this.space();
    if (this.pos !== this.text.length) throw new Error("Unexpected JSON text");
    return node;
  }

  private space(): void {
    while (/\s/.test(this.text[this.pos] ?? "")) this.pos++;
  }

  private value(): JSONNode {
    this.space();
    const c = this.text[this.pos];
    if (c === "{") {
      this.pos++;
      const object: Array<[string, JSONNode]> = [];
      this.space();
      if (this.text[this.pos] === "}") {
        this.pos++;
        return { object };
      }
      for (;;) {
        this.space();
        const key = this.string();
        this.space();
        this.expect(":");
        object.push([key, this.value()]);
        this.space();
        if (this.text[this.pos] === ",") {
          this.pos++;
        } else {
          this.expect("}");
          return { object };
        }
      }
    }
    if (c === "[") {
      this.pos++;
      const array: JSONNode[] = [];
      this.space();
      if (this.text[this.pos] === "]") {
        this.pos++;
        return { array };
      }
      for (;;) {
        array.push(this.value());
        this.space();
        if (this.text[this.pos] === ",") {
          this.pos++;
        } else {
          this.expect("]");
          return { array };
        }
      }
    }
    if (c === '"') return this.string();
    const start = this.pos;
    while (
      this.pos < this.text.length &&
      !/[\s,\]}]/.test(this.text[this.pos] as string)
    ) {
      this.pos++;
    }
    if (this.pos === start) throw new Error("Unexpected JSON text");
    return this.text.slice(start, this.pos);
  }

  private string(): string {
    const start = this.pos;
    this.expect('"');
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) throw new Error("Unexpected end of the JSON text");
      this.pos += c === "\\" ? 2 : 1;
      if (c === '"') return this.text.slice(start, this.pos);
    }
  }

  private expect(c: string): void {
    if (this.text[this.pos] !== c) throw new Error("Unexpected JSON text");
    this.pos++;
  }
}

function isArrayNode(node: JSONNode): node is { array: JSONNode[] } {
  return typeof node !== "string" && "array" in node;
}

function isObjectNode(
  node: JSONNode,
): node is { object: Array<[string, JSONNode]> } {
  return typeof node !== "string" && "object" in node;
}

/**
 * Writes a JSON value on more than one line, as the `JSON` format of the
 * server writes a `JSON` column. The server knows the type of each array:
 * it writes an array of arrays or of objects with one element on each line,
 * and other arrays on one line. The client sees only the text, so it uses
 * the elements of the array to make the decision.
 */
export function prettyJSONNode(node: JSONNode, indent: number): string {
  if (typeof node === "string") return node;
  if (isObjectNode(node)) {
    if (node.object.length === 0) return "{\n\n" + tabs(indent) + "}";
    const inner = tabs(indent + 1);
    return (
      "{\n" +
      node.object
        .map(
          ([key, value]) =>
            inner + key + ": " + prettyJSONNode(value, indent + 1),
        )
        .join(",\n") +
      "\n" +
      tabs(indent) +
      "}"
    );
  }
  const items = node.array;
  if (items.length === 0) return "[]";
  const nested =
    items.every(isArrayNode) ||
    (items.some(isObjectNode) &&
      items.every((item) => item === "null" || isObjectNode(item)));
  if (!nested) {
    return (
      "[" +
      items.map((item) => prettyJSONNode(item, indent + 1)).join(",") +
      "]"
    );
  }
  const inner = tabs(indent + 1);
  return (
    "[\n" +
    items.map((item) => inner + prettyJSONNode(item, indent + 1)).join(",\n") +
    "\n" +
    tabs(indent) +
    "]"
  );
}
