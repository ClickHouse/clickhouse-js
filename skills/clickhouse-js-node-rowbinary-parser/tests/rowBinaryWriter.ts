/**
 * A tiny RowBinary(WithNamesAndTypes) ENCODER, just enough to drive the compiler
 * tests offline (the rest of the suite reads bytes from a live server). It
 * mirrors the wire the server would produce so these tests need no ClickHouse.
 */
export class Writer {
  private readonly parts: Buffer[] = [];

  uvarint(n: number): this {
    const out: number[] = [];
    let v = n;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      out.push(b);
    } while (v !== 0);
    this.parts.push(Buffer.from(out));
    return this;
  }

  string(s: string): this {
    const b = Buffer.from(s, "utf8");
    return this.uvarint(b.length).raw(b);
  }

  u8(n: number): this {
    return this.raw(Buffer.from([n & 0xff]));
  }

  u32(n: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return this.raw(b);
  }

  raw(b: Buffer): this {
    this.parts.push(b);
    return this;
  }

  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Encode just the WithNamesAndTypes header (count, names, types). */
export function header(w: Writer, names: string[], types: string[]): Writer {
  w.uvarint(names.length);
  for (const n of names) w.string(n);
  for (const t of types) w.string(t);
  return w;
}
