/* eslint-disable @typescript-eslint/ban-types */
// TODO: rest of the types

export type Primitive =
  | Bool
  | String
  | UInt8
  | UInt16
  | UInt32
  | UInt64
  | UInt128
  | UInt256
  | Int8
  | Int16
  | Int32
  | Int64
  | Int128
  | Int256
export type Type = Primitive | Array<any> | Nullable<Primitive> | Map<any, any>

export type UInt8 = {
  underlying: number
  type: 'UInt8'
}
export const UInt8 = {
  type: 'UInt8',
  toString(): string {
    return 'UInt8'
  },
} as UInt8
export type UInt16 = {
  type: 'UInt16'
  underlying: number
}
export const UInt16 = {
  type: 'UInt16',
  toString(): string {
    return 'UInt16'
  },
} as UInt16
export type UInt32 = {
  type: 'UInt32'
  underlying: number
}
export const UInt32 = {
  type: 'UInt32',
  toString(): string {
    return 'UInt32'
  },
} as UInt32

export type UInt64 = {
  // Max UInt64:               18446744073709551615
  // Number.MAX_SAFE_INTEGER:  9007199254740991
  // can be cast to number by disabling `output_format_json_quote_64bit_integers` CH setting
  underlying: string
  type: 'UInt64'
}
export const UInt64 = {
  type: 'UInt64',
  toString(): string {
    return 'UInt64'
  },
} as UInt64
export type UInt128 = {
  type: 'UInt128'
  underlying: string
}
export const UInt128 = {
  type: 'UInt128',
  toString(): string {
    return 'UInt128'
  },
} as UInt128
export type UInt256 = {
  type: 'UInt256'
  underlying: string
}
export const UInt256 = {
  type: 'UInt256',
  toString(): string {
    return 'UInt256'
  },
} as UInt256

export type Int8 = {
  underlying: number
  type: 'Int8'
}
export const Int8 = {
  type: 'Int8',
  toString(): string {
    return 'Int8'
  },
} as Int8
export type Int16 = {
  type: 'Int16'
  underlying: number
}
export const Int16 = {
  type: 'Int16',
  toString(): string {
    return 'Int16'
  },
} as Int16
export type Int32 = {
  type: 'Int32'
  underlying: number
}
export const Int32 = {
  type: 'Int32',
  toString(): string {
    return 'Int32'
  },
} as Int32

export type Int64 = {
  // Max Int64:                9223372036854775807
  // Number.MAX_SAFE_INTEGER:  9007199254740991
  // can be cast to number by disabling `output_format_json_quote_64bit_integers` CH setting
  underlying: string
  type: 'Int64'
}
export const Int64 = {
  type: 'Int64',
  toString(): string {
    return 'Int64'
  },
} as Int64
export type Int128 = {
  type: 'Int128'
  underlying: string
}
export const Int128 = {
  type: 'Int128',
  toString(): string {
    return 'Int128'
  },
} as Int128
export type Int256 = {
  type: 'Int256'
  underlying: string
}
export const Int256 = {
  type: 'Int256',
  toString(): string {
    return 'Int256'
  },
} as Int256

export type String = {
  type: 'String'
  underlying: string
}
export const String = {
  type: 'String',
  toString(): string {
    return 'String'
  },
} as String

export type Bool = {
  type: 'Bool'
  underlying: boolean
}
export const Bool = {
  type: 'Bool',
  toString(): string {
    return 'Bool'
  },
} as Bool

export type Array<T extends Type> = {
  type: 'Array'
  underlying: globalThis.Array<T['underlying']>
}
export const Array = <T extends Type>(inner: T) =>
  ({
    type: 'Array',
    toString(): string {
      return `Array(${inner.toString()})`
    },
  } as Array<T>)

export type Nullable<T extends Primitive> = {
  type: 'Nullable'
  underlying: T['underlying'] | null
}
export const Nullable = <T extends Primitive>(inner: T) =>
  ({
    type: 'Nullable',
    toString(): string {
      return `Nullable(${inner.toString()})`
    },
  } as Nullable<T>)

export type Map<K extends Primitive, V extends Type> = {
  type: 'Map'
  underlying: globalThis.Map<K['underlying'], V['underlying']>
}
export const Map = <K extends Primitive, V extends Type>(k: K, v: V) =>
  ({
    type: 'Map',
    toString(): string {
      return `Map(${k.toString()}, ${v.toString()})`
    },
  } as Map<K, V>)
